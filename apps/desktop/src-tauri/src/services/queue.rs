//! Persistent job queue (ADR-017).
//!
//! Every generation runs as a job. One dispatcher thread ([`start_worker`]) claims runnable
//! jobs — `queued`, or `retrying` whose `next_attempt_at` has passed — highest priority first,
//! then oldest, as long as the job's provider has a free slot ([`slots_for`]). Each claimed job
//! runs on its own thread ([`run`]); the provider call never holds the DB lock.
//!
//! Retryable provider errors (`rate_limited`, `network`, `timeout`) are retried after
//! [`RETRY_BACKOFF_SECS`] until [`MAX_ATTEMPTS`] attempts have started; any other error fails
//! the job at once. Cancel ends a queued/retrying job immediately; a running job is marked
//! `cancelled` at once and its result is discarded when the provider returns.
//!
//! Tests drive the same code deterministically with [`tick`] and an injected [`Clock`].

use std::any::Any;
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::Connection;
use serde::Deserialize;

use crate::domain::{GenerationStatus, JobStatus};
use crate::dto::{GenerationDto, JobDto};
use crate::error::{AppError, AppResult};
use crate::providers::{ProviderErrorKind, ProviderKind};
use crate::repositories::{self as repo, GenerationErrorRow, JobRow};
use crate::services::generations::{self, JobOptions, RunOutcome};
use crate::services::AppCore;

/// Concurrent jobs per provider: local renderers share the machine, remote APIs are
/// rate-limited and cost money. The only place these limits are defined.
pub const LOCAL_SLOTS: usize = 2;
pub const REMOTE_SLOTS: usize = 1;
/// Attempts a job may start (the first one included).
pub const MAX_ATTEMPTS: i64 = 3;
/// Wait before attempt 2 and attempt 3.
pub const RETRY_BACKOFF_SECS: [i64; 2] = [15, 60];
/// `job_list` returns every active job plus this many recent finished ones.
pub const TERMINAL_HISTORY: i64 = 100;
/// The dispatcher re-checks the queue at least this often, even without a wake-up.
const IDLE_RECHECK: Duration = Duration::from_secs(30);

pub const JOB_UPDATED_EVENT: &str = "job://updated";
pub const GENERATION_UPDATED_EVENT: &str = "generation://updated";

pub fn slots_for(kind: ProviderKind) -> usize {
    match kind {
        ProviderKind::Local => LOCAL_SLOTS,
        ProviderKind::Remote => REMOTE_SLOTS,
    }
}

/// Error kinds the queue retries by itself (ADR-017). Other errors may still carry
/// `retryable: true`, which only means the user can usefully press Retry. A timeout is retried
/// only for providers that allow it ([`ImageProvider::auto_retries_timeouts`]).
pub fn auto_retries(kind: &str, timeouts: bool) -> bool {
    kind == ProviderErrorKind::RateLimited.as_str()
        || kind == ProviderErrorKind::Network.as_str()
        || (timeouts && kind == ProviderErrorKind::Timeout.as_str())
}

// ------------------------------------------------------------------ injectable clock + events

pub trait Clock: Send + Sync {
    fn now(&self) -> DateTime<Utc>;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}

/// Same format as `util::now_iso`, so stored timestamps compare as strings.
pub fn iso(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// Receives every job/generation change. The app emits Tauri events; tests record.
pub trait Notifier: Send + Sync {
    fn job_updated(&self, job: &JobDto);
    fn generation_updated(&self, generation: &GenerationDto);
}

pub struct NoopNotifier;

impl Notifier for NoopNotifier {
    fn job_updated(&self, _: &JobDto) {}
    fn generation_updated(&self, _: &GenerationDto) {}
}

// ------------------------------------------------------------------ in-memory slots

/// Which jobs hold a provider slot right now. In memory on purpose: a job cancelled while
/// its provider call runs is `cancelled` in the DB but keeps its slot until the call returns.
#[derive(Default)]
pub struct QueueState {
    inner: Mutex<Slots>,
    wake: Condvar,
}

#[derive(Default)]
struct Slots {
    /// job id -> provider id
    running: HashMap<String, String>,
    pending_wake: bool,
    shutdown: bool,
}

impl QueueState {
    fn lock(&self) -> MutexGuard<'_, Slots> {
        // The map stays consistent even if a holder panicked (single inserts/removes).
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Ask the dispatcher to look at the queue again (enqueue, cancel, retry, slot freed).
    pub fn wake(&self) {
        self.lock().pending_wake = true;
        self.wake.notify_all();
    }

    fn release(&self, job_id: &str) {
        let mut slots = self.lock();
        slots.running.remove(job_id);
        slots.pending_wake = true;
        drop(slots);
        self.wake.notify_all();
    }

    /// Jobs currently holding a slot (for tests and diagnostics).
    pub fn running_jobs(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.lock().running.keys().cloned().collect();
        ids.sort();
        ids
    }
}

// ------------------------------------------------------------------ dispatch

/// A job marked `running` that holds a slot; [`run`] must be called exactly once with it.
#[derive(Debug)]
pub struct Claim {
    pub job_id: String,
    pub provider_id: String,
}

/// Claim every job that may start at `now`, in pick order, as long as its provider has a
/// free slot. Claimed jobs are `running` (attempt + 1) when this returns.
pub fn claim(core: &AppCore, now: DateTime<Utc>) -> AppResult<Vec<Claim>> {
    let now = iso(now);
    let mut claims = Vec::new();
    let mut unavailable = Vec::new();
    {
        // Lock order everywhere: queue slots, then the DB.
        let mut slots = core.queue.lock();
        let mut conn = core.conn()?;
        let mut busy: HashMap<String, usize> = HashMap::new();
        for provider in slots.running.values() {
            *busy.entry(provider.clone()).or_default() += 1;
        }
        for job in repo::runnable_jobs(&conn, &now)? {
            let tx = conn.transaction()?;
            let Some(provider) = core.providers.get(&job.provider_id) else {
                // A provider removed from this build can never run: fail instead of waiting forever.
                if repo::start_job(&tx, &job.id, &now)? {
                    let error = GenerationErrorRow {
                        kind: "invalid_request".into(),
                        message: format!("Provider '{}' is not available in this build.", job.provider_id),
                        retryable: false,
                    };
                    fail(&tx, &job, &error, None, &now)?;
                    unavailable.push(job.id.clone());
                }
                tx.commit()?;
                continue;
            };
            let used = busy.entry(job.provider_id.clone()).or_default();
            if *used >= slots_for(provider.info().kind) {
                continue;
            }
            if !repo::start_job(&tx, &job.id, &now)? {
                continue;
            }
            repo::start_generation(&tx, &job.generation_id, &now)?;
            tx.commit()?;
            *used += 1;
            slots.running.insert(job.id.clone(), job.provider_id.clone());
            claims.push(Claim { job_id: job.id, provider_id: job.provider_id });
        }
    }
    for id in claims.iter().map(|c| &c.job_id).chain(&unavailable) {
        emit(core, id);
    }
    Ok(claims)
}

/// Frees the slot even if the attempt panics, so one bad job never blocks its provider.
struct SlotGuard<'a> {
    core: &'a AppCore,
    job_id: &'a str,
}

impl Drop for SlotGuard<'_> {
    fn drop(&mut self) {
        self.core.queue.release(self.job_id);
    }
}

/// Run one claimed attempt to its end and record the outcome. A panicking attempt (an
/// adapter bug) fails the job like any other error instead of leaving it `running`.
pub fn run(core: &AppCore, claim: Claim) {
    let _slot = SlotGuard { core, job_id: &claim.job_id };
    let started = Instant::now();
    let outcome =
        catch_unwind(AssertUnwindSafe(|| generations::run_job(core, &claim.job_id))).unwrap_or_else(|panic| {
            RunOutcome::Failed {
                error: stopped(format!("The render stopped on an internal error: {}", panic_text(&*panic))),
                duration_ms: i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX),
            }
        });
    if let Err(e) = settle(core, &claim.job_id, outcome) {
        eprintln!("[queue] could not record the result of job {}: {}", claim.job_id, e.message);
    }
    emit(core, &claim.job_id);
}

/// The attempt ended for a reason of our own, not the provider's: the job fails (no automatic
/// retry) and the user may press Retry.
fn stopped(message: String) -> GenerationErrorRow {
    GenerationErrorRow { kind: "interrupted".into(), message, retryable: true }
}

fn panic_text(panic: &(dyn Any + Send)) -> &str {
    panic
        .downcast_ref::<&str>()
        .copied()
        .or_else(|| panic.downcast_ref::<String>().map(String::as_str))
        .unwrap_or("unknown panic")
}

/// Start every claim on its own thread via `spawn`. A thread that cannot start fails its job
/// at once: the slot is released, the dispatcher woken and the events sent, so nothing is
/// left `running` without a thread.
fn start_claims<F>(core: &Arc<AppCore>, claims: Vec<Claim>, spawn: F)
where
    F: Fn(String, Box<dyn FnOnce() + Send>) -> std::io::Result<()>,
{
    for c in claims {
        let job_id = c.job_id.clone();
        let task: Box<dyn FnOnce() + Send> = {
            let core = Arc::clone(core);
            Box::new(move || run(&core, c))
        };
        if let Err(e) = spawn(format!("job-{job_id}"), task) {
            eprintln!("[queue] cannot start a thread for job {job_id}: {e}");
            let _slot = SlotGuard { core, job_id: &job_id };
            let outcome =
                RunOutcome::Failed { error: stopped(format!("The render could not start: {e}")), duration_ms: 0 };
            if let Err(e) = settle(core, &job_id, outcome) {
                eprintln!("[queue] could not record the failed start of job {job_id}: {}", e.message);
            }
            emit(core, &job_id);
        }
    }
}

fn spawn_thread(name: String, task: Box<dyn FnOnce() + Send>) -> std::io::Result<()> {
    std::thread::Builder::new().name(name).spawn(task).map(drop)
}

/// Claim and run on the calling thread, one after another. Deterministic: tests use it
/// instead of the dispatcher thread. Returns how many attempts ran.
pub fn tick(core: &AppCore, now: DateTime<Utc>) -> AppResult<usize> {
    let claims = claim(core, now)?;
    let n = claims.len();
    for c in claims {
        run(core, c);
    }
    Ok(n)
}

fn fail(
    conn: &Connection,
    job: &JobRow,
    error: &GenerationErrorRow,
    duration_ms: Option<i64>,
    now: &str,
) -> AppResult<bool> {
    if !repo::finish_running_job(conn, &job.id, JobStatus::Failed, Some(error), now)? {
        return Ok(false);
    }
    repo::finish_generation(conn, &job.generation_id, GenerationStatus::Failed, Some(error), now, duration_ms)?;
    Ok(true)
}

/// Retry or fail after a failed attempt. A job cancelled meanwhile stays cancelled.
fn settle(core: &AppCore, job_id: &str, outcome: RunOutcome) -> AppResult<()> {
    let RunOutcome::Failed { error, duration_ms } = outcome else {
        return Ok(()); // completed rows were written by the run; discarded writes nothing
    };
    let now = core.clock.now();
    let mut conn = core.conn()?;
    let tx = conn.transaction()?;
    let job = repo::get_job(&tx, job_id)?;
    if job.status != JobStatus::Running {
        return Ok(());
    }
    let timeouts = core.providers.get(&job.provider_id).is_none_or(|p| p.auto_retries_timeouts());
    let backoff = usize::try_from(job.attempt - 1).ok().and_then(|i| RETRY_BACKOFF_SECS.get(i));
    match backoff {
        Some(secs) if auto_retries(&error.kind, timeouts) && job.attempt < job.max_attempts => {
            let next = iso(now + chrono::Duration::seconds(*secs));
            repo::retry_running_job(&tx, job_id, &error, &next, &iso(now))?;
            repo::requeue_generation(&tx, &job.generation_id, &iso(now))?;
        }
        _ => {
            fail(&tx, &job, &error, Some(duration_ms), &iso(now))?;
        }
    }
    tx.commit()?;
    Ok(())
}

// ------------------------------------------------------------------ dispatcher thread

/// Start the dispatcher thread (app setup). It sleeps until woken or a retry is due.
pub fn start_worker(core: Arc<AppCore>) -> std::io::Result<JoinHandle<()>> {
    std::thread::Builder::new().name("job-dispatcher".into()).spawn(move || dispatch_loop(core))
}

/// Stop the dispatcher after its current pass (running attempts finish on their own).
pub fn stop_worker(core: &AppCore) {
    core.queue.lock().shutdown = true;
    core.queue.wake.notify_all();
}

fn dispatch_loop(core: Arc<AppCore>) {
    loop {
        let claimed_at = core.clock.now();
        match claim(&core, claimed_at) {
            Ok(claims) => start_claims(&core, claims, spawn_thread),
            Err(e) => eprintln!("[queue] dispatch failed: {}", e.message),
        }
        let wait = until_next_retry(&core, claimed_at).unwrap_or(IDLE_RECHECK).min(IDLE_RECHECK);
        let mut slots = core.queue.lock();
        if !slots.pending_wake && !slots.shutdown {
            slots = core.queue.wake.wait_timeout(slots, wait).unwrap_or_else(|e| e.into_inner()).0;
        }
        if slots.shutdown {
            return;
        }
        slots.pending_wake = false;
    }
}

/// Time until the next retry that was not yet due at `claimed_at` (the last claim pass).
/// A retry that was due then but is still waiting lacks a free slot: the slot's release wakes
/// the dispatcher, so it is not polled (at worst [`IDLE_RECHECK`] picks it up).
fn until_next_retry(core: &AppCore, claimed_at: DateTime<Utc>) -> Option<Duration> {
    let next = repo::next_retry_after(&*core.conn().ok()?, &iso(claimed_at)).ok()??;
    let next = DateTime::parse_from_rfc3339(&next).ok()?.with_timezone(&Utc);
    Some((next - core.clock.now()).to_std().unwrap_or(Duration::ZERO))
}

// ------------------------------------------------------------------ commands

pub(crate) fn job_dto(j: JobRow) -> JobDto {
    JobDto {
        id: j.id,
        project_id: j.project_id,
        batch_id: j.batch_id,
        generation_id: j.generation_id,
        camera_id: j.camera_id,
        provider_id: j.provider_id,
        model_id: j.model_id,
        label: j.label,
        status: j.status,
        priority: j.priority,
        attempt: j.attempt,
        max_attempts: j.max_attempts,
        next_attempt_at: j.next_attempt_at,
        error: generations::error_dto(j.error_kind, j.error_message, j.error_retryable),
        created_at: j.created_at,
        started_at: j.started_at,
        finished_at: j.finished_at,
    }
}

/// Request of `job_list`: `projectId: null` lists every project.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobListRequest {
    #[serde(default)]
    pub project_id: Option<String>,
}

/// All non-terminal jobs plus the most recent terminal ones, newest first.
pub fn list(core: &AppCore, project_id: Option<&str>) -> AppResult<Vec<JobDto>> {
    let conn = core.conn()?;
    if let Some(id) = project_id {
        repo::get_project(&conn, id)?;
    }
    Ok(repo::list_jobs(&conn, project_id, TERMINAL_HISTORY)?.into_iter().map(job_dto).collect())
}

pub fn get(core: &AppCore, job_id: &str) -> AppResult<JobDto> {
    Ok(job_dto(repo::get_job(&*core.conn()?, job_id)?))
}

/// Cancel a job that has not ended. A running attempt keeps its slot until the provider
/// returns; its result is then discarded.
pub fn cancel(core: &AppCore, job_id: &str) -> AppResult<JobDto> {
    {
        let now = core.now_iso();
        let mut conn = core.conn()?;
        let tx = conn.transaction()?;
        let job = repo::get_job(&tx, job_id)?;
        if !repo::cancel_job(&tx, job_id, &now)? {
            return Err(AppError::invalid_state(format!("This job has already ended ({}).", job.status.as_str())));
        }
        repo::finish_generation(&tx, &job.generation_id, GenerationStatus::Cancelled, None, &now, None)?;
        tx.commit()?;
    }
    core.queue.wake();
    emit(core, job_id);
    get(core, job_id)
}

/// Run a finished job's request again as a new generation + job (same label, priority,
/// batch and camera). The request is validated again like a new submit.
pub fn retry(core: &AppCore, job_id: &str) -> AppResult<JobDto> {
    let (job, request) = {
        let conn = core.conn()?;
        let job = repo::get_job(&conn, job_id)?;
        if !matches!(job.status, JobStatus::Failed | JobStatus::Cancelled | JobStatus::Interrupted) {
            return Err(AppError::invalid_state(format!(
                "Only failed, cancelled or interrupted jobs can be retried; this one is {}.",
                job.status.as_str()
            )));
        }
        let request = generations::request_of(&conn, &job.generation_id)?;
        (job, request)
    };
    let validated = generations::validate(core, request)?;
    let options = JobOptions { label: job.label, priority: job.priority, batch_id: job.batch_id };
    let new_job_id = {
        let mut conn = core.conn()?;
        let tx = conn.transaction()?;
        let (_, new_job_id) = generations::insert_queued(core, &tx, &validated, &options, &core.now_iso())?;
        tx.commit()?;
        new_job_id
    };
    enqueued(core, std::slice::from_ref(&new_job_id));
    get(core, &new_job_id)
}

/// New jobs were committed: tell the UI and wake the dispatcher.
pub(crate) fn enqueued(core: &AppCore, job_ids: &[String]) {
    for id in job_ids {
        emit(core, id);
    }
    core.queue.wake();
}

/// Send `job://updated` and `generation://updated` with the current DTOs. Never called with
/// the DB lock held; a failure to read is logged, never surfaced.
pub(crate) fn emit(core: &AppCore, job_id: &str) {
    let dtos = (|| -> AppResult<(JobDto, GenerationDto)> {
        let conn = core.conn()?;
        let job = repo::get_job(&conn, job_id)?;
        let generation = generations::dto_by_id(&conn, &job.generation_id)?;
        Ok((job_dto(job), generation))
    })();
    match dtos {
        Ok((job, generation)) => {
            core.notifier.job_updated(&job);
            core.notifier.generation_updated(&generation);
        }
        Err(e) => eprintln!("[queue] cannot read job {job_id} for its update event: {}", e.message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::GenerationStatus as G;
    use crate::error::ErrorCode;
    use crate::providers::local_preview;
    use crate::services::tests_support::{
        open_queue_core, queue_harness, run_queue, test_create_villa, test_import, test_request, QueueHarness,
        TestBehavior, TestProvider, TEST_LOCAL_PROVIDER, TEST_PROVIDER,
    };
    use crate::services::{assets, batches, generations, provider_settings};

    fn remote(h: &QueueHarness, project_id: &str) -> String {
        generations::submit(&h.core, test_request(project_id, TEST_PROVIDER, "full", &[], None))
            .unwrap()
            .job_id
            .unwrap()
    }

    fn local(h: &QueueHarness, project_id: &str) -> String {
        generations::submit(&h.core, test_request(project_id, TEST_LOCAL_PROVIDER, "full", &[], None))
            .unwrap()
            .job_id
            .unwrap()
    }

    fn setup() -> (QueueHarness, String) {
        let h = queue_harness();
        provider_settings::set_api_key(&h.core, TEST_PROVIDER, "k").unwrap();
        let p = test_create_villa(&h.core, "Queue villa");
        (h, p.id)
    }

    fn job(h: &QueueHarness, id: &str) -> JobDto {
        get(&h.core, id).unwrap()
    }

    fn generation(h: &QueueHarness, j: &JobDto) -> GenerationDto {
        generations::get(&h.core, &j.project_id, &j.generation_id).unwrap()
    }

    fn tick_now(h: &QueueHarness) -> usize {
        tick(&h.core, h.clock.now()).unwrap()
    }

    fn count(h: &QueueHarness, table: &str) -> i64 {
        h.core.conn().unwrap().query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap()
    }

    fn managed_files(h: &QueueHarness, project_id: &str) -> usize {
        ["assets/original", "previews"]
            .iter()
            .map(|d| std::fs::read_dir(h.core.storage.project_dir(project_id).join(d)).map(|r| r.count()).unwrap_or(0))
            .sum()
    }

    fn batch_item(label: &str) -> serde_json::Value {
        serde_json::json!({ "cameraId": null, "label": label, "referenceAssetIds": [],
            "prompt": { "compilerVersion": "1", "positivePrompt": "p", "negativePrompt": "",
                        "referenceInstructions": "", "preservationInstructions": "", "metadata": {} },
            "params": { "aspectRatio": null, "imageSize": null, "outputCount": 1, "seed": null } })
    }

    #[test]
    fn submit_only_enqueues_and_returns_the_queued_generation() {
        let (h, pid) = setup();
        h.events.take();
        let g = generations::submit(&h.core, test_request(&pid, TEST_PROVIDER, "full", &[], None)).unwrap();
        assert_eq!(g.status, G::Queued);
        assert!(g.started_at.is_none() && g.finished_at.is_none() && g.error.is_none());
        assert_eq!(g.created_at, "2026-10-01T08:00:00.000Z", "queue time from the injected clock");
        assert_eq!(h.remote.calls(), 0, "nothing runs before the queue does");
        let j = job(&h, g.job_id.as_deref().unwrap());
        assert_eq!((j.status, j.attempt, j.max_attempts, j.priority), (JobStatus::Queued, 0, MAX_ATTEMPTS, 0));
        assert_eq!(j.label, "Test full — hero");
        assert_eq!(j.generation_id, g.id);
        assert_eq!(h.events.take(), [("job", j.id.clone(), "queued".into()), ("generation", g.id, "queued".into())]);
    }

    #[test]
    fn picks_highest_priority_then_oldest() {
        let (h, pid) = setup();
        let first = remote(&h, &pid);
        let batch = |name: &str, priority: i64, labels: &[&str]| {
            let items: Vec<serde_json::Value> = labels.iter().map(|l| batch_item(l)).collect();
            batches::create(
                &h.core,
                serde_json::from_value(serde_json::json!({ "projectId": pid, "name": name,
                    "providerId": TEST_PROVIDER, "modelId": "full", "purpose": "anchor", "priority": priority,
                    "items": items }))
                .unwrap(),
            )
            .unwrap()
        };
        let urgent = batch("Urgent", 5, &["u1", "u2"]);
        let later = remote(&h, &pid);
        let low = batch("Low", -3, &["l1"]);

        let mut order = Vec::new();
        loop {
            let claims = claim(&h.core, h.clock.now()).unwrap();
            assert!(claims.len() <= 1, "one remote slot");
            let Some(c) = claims.into_iter().next() else { break };
            order.push(c.job_id.clone());
            run(&h.core, c);
        }
        let expected = [urgent.job_ids[0].clone(), urgent.job_ids[1].clone(), first, later, low.job_ids[0].clone()];
        assert_eq!(order, expected);
    }

    #[test]
    fn slots_are_per_provider_two_local_one_remote() {
        let (h, pid) = setup();
        let locals: Vec<String> = (0..3).map(|_| local(&h, &pid)).collect();
        let remotes: Vec<String> = (0..2).map(|_| remote(&h, &pid)).collect();
        let preview =
            generations::submit(&h.core, test_request(&pid, local_preview::ID, local_preview::MODEL_ID, &[], None))
                .unwrap()
                .job_id
                .unwrap();

        let claims = claim(&h.core, h.clock.now()).unwrap();
        let mut claimed: Vec<String> = claims.iter().map(|c| c.job_id.clone()).collect();
        claimed.sort();
        let mut expected = vec![locals[0].clone(), locals[1].clone(), remotes[0].clone(), preview.clone()];
        expected.sort();
        assert_eq!(claimed, expected, "2 test_local + 1 test_remote + 1 local_preview (its own slots)");
        assert!(claim(&h.core, h.clock.now()).unwrap().is_empty(), "every provider is at its limit");
        assert_eq!(job(&h, &locals[2]).status, JobStatus::Queued);
        assert_eq!(job(&h, &remotes[1]).status, JobStatus::Queued);

        // Finishing one local job frees exactly one local slot.
        let mut rest: Vec<Claim> = Vec::new();
        for c in claims {
            if c.job_id == locals[0] {
                run(&h.core, c);
            } else {
                rest.push(c);
            }
        }
        let next = claim(&h.core, h.clock.now()).unwrap();
        assert_eq!(next.iter().map(|c| c.job_id.as_str()).collect::<Vec<_>>(), [locals[2].as_str()]);
        for c in rest.into_iter().chain(next) {
            run(&h.core, c);
        }
        run_queue(&h.core);
        assert!(list(&h.core, Some(&pid)).unwrap().iter().all(|j| j.status == JobStatus::Completed));
        assert!(h.core.queue.running_jobs().is_empty());
    }

    /// Calls of the test doubles block here until the test opens the gate, so overlaps are
    /// observed by explicit synchronisation instead of sleeps.
    #[derive(Default)]
    struct Gate {
        state: Mutex<GateState>,
        changed: Condvar,
    }

    #[derive(Default)]
    struct GateState {
        open: bool,
        /// provider id -> calls inside the double right now / at most at once
        inside: HashMap<&'static str, usize>,
        max: HashMap<&'static str, usize>,
    }

    impl Gate {
        fn hold(self: &Arc<Self>, double: &TestProvider, provider: &'static str) {
            let gate = Arc::clone(self);
            double.set_hook(move || {
                let mut s = gate.state.lock().unwrap();
                let n = s.inside.entry(provider).or_default();
                *n += 1;
                let n = *n;
                let m = s.max.entry(provider).or_default();
                *m = (*m).max(n);
                gate.changed.notify_all();
                while !s.open {
                    s = gate.changed.wait(s).unwrap();
                }
                *s.inside.get_mut(provider).unwrap() -= 1;
            });
        }

        /// Wait until `want` calls per provider are blocked inside the doubles.
        fn wait_inside(&self, want: &[(&'static str, usize)]) {
            let deadline = Instant::now() + Duration::from_secs(20);
            let mut s = self.state.lock().unwrap();
            while !want.iter().all(|(p, n)| s.inside.get(p).copied().unwrap_or(0) == *n) {
                let left = deadline.checked_duration_since(Instant::now()).expect("calls did not start in time");
                s = self.changed.wait_timeout(s, left).unwrap().0;
            }
        }

        fn open(&self) {
            self.state.lock().unwrap().open = true;
            self.changed.notify_all();
        }

        fn max(&self, provider: &str) -> usize {
            self.state.lock().unwrap().max.get(provider).copied().unwrap_or(0)
        }
    }

    #[test]
    fn worker_runs_local_and_remote_in_parallel_within_limits() {
        let (h, pid) = setup();
        let gate = Arc::new(Gate::default());
        gate.hold(&h.local, TEST_LOCAL_PROVIDER);
        gate.hold(&h.remote, TEST_PROVIDER);
        let locals: Vec<String> = (0..3).map(|_| local(&h, &pid)).collect();
        let remotes: Vec<String> = (0..2).map(|_| remote(&h, &pid)).collect();

        let worker = start_worker(h.core.clone()).unwrap();
        // Two local calls and one remote call are inside the providers at the same time...
        gate.wait_inside(&[(TEST_LOCAL_PROVIDER, LOCAL_SLOTS), (TEST_PROVIDER, REMOTE_SLOTS)]);
        // ...and every slot is taken, so the rest wait in the queue (claims happen before calls).
        assert_eq!(job(&h, &locals[2]).status, JobStatus::Queued);
        assert_eq!(job(&h, &remotes[1]).status, JobStatus::Queued);
        assert_eq!(h.core.queue.running_jobs().len(), LOCAL_SLOTS + REMOTE_SLOTS);
        gate.open();

        let deadline = Instant::now() + Duration::from_secs(20);
        let ids: Vec<&String> = locals.iter().chain(&remotes).collect();
        loop {
            let jobs: Vec<JobDto> = ids.iter().map(|id| job(&h, id)).collect();
            if jobs.iter().all(|j| j.status == JobStatus::Completed) {
                break;
            }
            assert!(Instant::now() < deadline, "jobs did not finish: {jobs:?}");
            std::thread::sleep(Duration::from_millis(5));
        }
        stop_worker(&h.core);
        worker.join().unwrap();
        assert_eq!(gate.max(TEST_LOCAL_PROVIDER), LOCAL_SLOTS, "local jobs run 2 at a time");
        assert_eq!(gate.max(TEST_PROVIDER), REMOTE_SLOTS, "one remote call per provider");
        assert_eq!(count(&h, "assets"), 5);
    }

    #[test]
    fn retryable_errors_back_off_15_then_60_seconds_then_succeed() {
        let (h, pid) = setup();
        h.remote.script(&[
            TestBehavior::Fail(ProviderErrorKind::RateLimited),
            TestBehavior::Fail(ProviderErrorKind::Network),
        ]);
        let id = remote(&h, &pid);
        let start = h.clock.now();

        assert_eq!(tick_now(&h), 1);
        let j = job(&h, &id);
        assert_eq!((j.status, j.attempt), (JobStatus::Retrying, 1));
        assert_eq!(j.next_attempt_at.as_deref(), Some(iso(start + chrono::Duration::seconds(15)).as_str()));
        let e = j.error.clone().unwrap();
        assert_eq!((e.kind.as_str(), e.retryable), ("rate_limited", true));
        let g = generation(&h, &j);
        assert_eq!(g.status, G::Queued, "the generation waits for its next attempt");
        assert!(g.started_at.is_none() && g.error.is_none() && g.output_asset_ids.is_empty());

        h.clock.advance_secs(14);
        assert_eq!(tick_now(&h), 0, "not due yet");
        h.clock.advance_secs(1);
        assert_eq!(tick_now(&h), 1);
        let j = job(&h, &id);
        assert_eq!((j.status, j.attempt), (JobStatus::Retrying, 2));
        assert_eq!(j.next_attempt_at.as_deref(), Some(iso(h.clock.now() + chrono::Duration::seconds(60)).as_str()));
        assert_eq!(j.error.unwrap().kind, "network");

        h.clock.advance_secs(59);
        assert_eq!(tick_now(&h), 0);
        h.clock.advance_secs(1);
        assert_eq!(tick_now(&h), 1);
        let j = job(&h, &id);
        assert_eq!((j.status, j.attempt), (JobStatus::Completed, 3));
        assert!(j.error.is_none() && j.next_attempt_at.is_none() && j.finished_at.is_some());
        let g = generation(&h, &j);
        assert_eq!(g.status, G::Completed);
        assert_eq!(g.output_asset_ids.len(), 1);
        assert_eq!(g.started_at, j.started_at, "latest attempt start");
        assert_eq!(h.remote.calls(), 3);
        assert_eq!(
            h.events.job_statuses(&id),
            ["queued", "running", "retrying", "running", "retrying", "running", "completed"]
        );
    }

    #[test]
    fn retries_stop_after_three_attempts() {
        let (h, pid) = setup();
        h.remote.set_behavior(TestBehavior::Fail(ProviderErrorKind::Timeout));
        let id = remote(&h, &pid);
        for _ in 0..3 {
            assert_eq!(tick_now(&h), 1);
            h.clock.advance_secs(60);
        }
        assert_eq!(tick_now(&h), 0);
        let j = job(&h, &id);
        assert_eq!((j.status, j.attempt), (JobStatus::Failed, 3));
        assert!(j.next_attempt_at.is_none());
        assert_eq!(j.error.as_ref().unwrap().kind, "timeout");
        let g = generation(&h, &j);
        assert_eq!(g.status, G::Failed);
        assert_eq!(g.error.unwrap().kind, "timeout");
        assert!(g.duration_ms.is_some() && g.finished_at.is_some());
        assert_eq!(h.remote.calls(), 3);
    }

    #[test]
    fn timeouts_are_not_retried_for_providers_that_opt_out() {
        let (h, pid) = setup();
        h.remote.retry_timeouts.store(false, std::sync::atomic::Ordering::SeqCst);
        h.remote.set_behavior(TestBehavior::Fail(ProviderErrorKind::Timeout));
        let id = remote(&h, &pid);
        assert_eq!(tick_now(&h), 1);
        h.clock.advance_secs(60);
        assert_eq!(tick_now(&h), 0, "no automatic second attempt");
        let j = job(&h, &id);
        assert_eq!((j.status, j.attempt), (JobStatus::Failed, 1));
        let error = j.error.as_ref().unwrap();
        assert_eq!(error.kind, "timeout");
        assert!(error.retryable, "the user can still press Retry");
        assert_eq!(h.remote.calls(), 1);

        // A rate limit is still retried automatically for the same provider.
        h.remote.set_behavior(TestBehavior::Fail(ProviderErrorKind::RateLimited));
        let id = remote(&h, &pid);
        assert_eq!(tick_now(&h), 1);
        assert_eq!(job(&h, &id).status, JobStatus::Retrying);
    }

    #[test]
    fn non_retryable_errors_fail_at_once() {
        let (h, pid) = setup();
        for (behavior, kind) in [
            (TestBehavior::Fail(ProviderErrorKind::Auth), "auth"),
            (TestBehavior::Fail(ProviderErrorKind::Blocked), "blocked"),
            // `retryable: true` (the user may retry) but not an automatic retry kind.
            (TestBehavior::NotAnImage, "bad_response"),
        ] {
            h.remote.set_behavior(behavior);
            let id = remote(&h, &pid);
            assert_eq!(tick_now(&h), 1);
            let j = job(&h, &id);
            assert_eq!((j.status, j.attempt), (JobStatus::Failed, 1), "{kind}");
            assert_eq!(j.error.unwrap().kind, kind);
        }
        assert_eq!(h.remote.calls(), 3);
    }

    #[test]
    fn key_removed_after_enqueue_fails_the_job_as_auth() {
        let (h, pid) = setup();
        let id = remote(&h, &pid);
        provider_settings::clear_api_key(&h.core, TEST_PROVIDER).unwrap();
        tick_now(&h);
        let j = job(&h, &id);
        assert_eq!(j.status, JobStatus::Failed);
        let e = j.error.unwrap();
        assert_eq!((e.kind.as_str(), e.retryable), ("auth", false));
        assert_eq!(h.remote.calls(), 0);
    }

    #[test]
    fn reference_removed_after_enqueue_fails_without_a_call() {
        let (h, pid) = setup();
        let r = test_import(&h.core, h.tmp.path(), &pid, "r.png", "regular_image");
        let g = generations::submit(&h.core, test_request(&pid, TEST_PROVIDER, "full", &[&r.id], None)).unwrap();
        assets::remove(&h.core, &pid, &r.id).unwrap();
        tick_now(&h);
        let j = job(&h, g.job_id.as_deref().unwrap());
        assert_eq!((j.status, j.error.unwrap().kind.as_str()), (JobStatus::Failed, "invalid_request"));
        assert_eq!(h.remote.calls(), 0);
    }

    #[test]
    fn cancel_queued_and_retrying_jobs_at_once() {
        let (h, pid) = setup();
        let queued = remote(&h, &pid);
        let c = cancel(&h.core, &queued).unwrap();
        assert_eq!(c.status, JobStatus::Cancelled);
        assert!(c.finished_at.is_some());
        let g = generation(&h, &c);
        assert_eq!(g.status, G::Cancelled);
        assert!(g.started_at.is_none(), "never started");

        h.remote.script(&[TestBehavior::Fail(ProviderErrorKind::RateLimited)]);
        let retrying = remote(&h, &pid);
        tick_now(&h);
        assert_eq!(job(&h, &retrying).status, JobStatus::Retrying);
        let c = cancel(&h.core, &retrying).unwrap();
        assert_eq!((c.status, c.next_attempt_at.clone()), (JobStatus::Cancelled, None));
        assert_eq!(generation(&h, &c).status, G::Cancelled);

        h.clock.advance_secs(3600);
        assert_eq!(tick_now(&h), 0, "cancelled jobs never run");
        assert_eq!(h.remote.calls(), 1);
        let err = cancel(&h.core, &retrying).unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidState, "already terminal");
        assert_eq!(cancel(&h.core, "JOB_nope").unwrap_err().code, ErrorCode::NotFound);
    }

    #[test]
    fn cancel_while_running_discards_the_result_and_leaves_no_files() {
        let (h, pid) = setup();
        let id = remote(&h, &pid);
        let weak = Arc::downgrade(&h.core);
        let job_id = id.clone();
        h.remote.set_hook(move || {
            let core = weak.upgrade().unwrap();
            let c = cancel(&core, &job_id).unwrap();
            assert_eq!(c.status, JobStatus::Cancelled, "cancel answers at once while the call runs");
        });
        assert_eq!(tick_now(&h), 1);
        let j = job(&h, &id);
        assert_eq!((j.status, j.attempt), (JobStatus::Cancelled, 1));
        let g = generation(&h, &j);
        assert_eq!(g.status, G::Cancelled);
        assert!(g.output_asset_ids.is_empty());
        for table in ["assets", "versions", "generation_outputs"] {
            assert_eq!(count(&h, table), 0, "{table}");
        }
        assert_eq!(managed_files(&h, &pid), 0);
        assert!(h.core.queue.running_jobs().is_empty(), "slot released");
        let statuses = h.events.job_statuses(&id);
        assert_eq!(statuses.last().map(String::as_str), Some("cancelled"));
        assert!(!statuses.contains(&"completed".to_string()));
    }

    #[test]
    fn cancel_landing_between_file_write_and_commit_removes_the_files() {
        let (h, pid) = setup();
        let id = remote(&h, &pid);
        let weak = Arc::downgrade(&h.core);
        let job_id = id.clone();
        generations::BEFORE_COMMIT.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                cancel(&weak.upgrade().unwrap(), &job_id).unwrap();
            }))
        });
        tick_now(&h);
        assert_eq!(job(&h, &id).status, JobStatus::Cancelled);
        assert_eq!(count(&h, "assets"), 0);
        assert_eq!(managed_files(&h, &pid), 0, "written outputs are removed");
    }

    #[test]
    fn retry_copies_the_request_into_a_new_job() {
        let (h, pid) = setup();
        h.remote.set_behavior(TestBehavior::Fail(ProviderErrorKind::Auth));
        let id = remote(&h, &pid);
        assert_eq!(retry(&h.core, &id).unwrap_err().code, ErrorCode::InvalidState, "queued is not retryable");
        tick_now(&h);
        let failed = job(&h, &id);
        assert_eq!(failed.status, JobStatus::Failed);

        h.remote.set_behavior(TestBehavior::Images);
        let again = retry(&h.core, &id).unwrap();
        assert_ne!(again.id, id);
        assert_ne!(again.generation_id, failed.generation_id);
        assert_eq!((again.status, again.attempt), (JobStatus::Queued, 0));
        assert_eq!((again.label.as_str(), again.priority), (failed.label.as_str(), failed.priority));
        let (old_g, new_g) = (generation(&h, &failed), generation(&h, &again));
        assert_eq!(new_g.prompt, old_g.prompt);
        assert_eq!(new_g.params, old_g.params);
        assert_eq!(new_g.reference_asset_ids, old_g.reference_asset_ids);
        tick_now(&h);
        assert_eq!(job(&h, &again.id).status, JobStatus::Completed);
        assert_eq!(retry(&h.core, &again.id).unwrap_err().code, ErrorCode::InvalidState, "completed");
        assert_eq!(job(&h, &id).status, JobStatus::Failed, "the old job keeps its history");
    }

    #[test]
    fn job_list_covers_all_projects_or_one_newest_first() {
        let (h, pid) = setup();
        let other = test_create_villa(&h.core, "Other").id;
        let a = remote(&h, &pid);
        let b = local(&h, &other);
        let c = remote(&h, &pid);
        let all: Vec<String> = list(&h.core, None).unwrap().into_iter().map(|j| j.id).collect();
        assert_eq!(all, [c.clone(), b, a.clone()]);
        let mine: Vec<String> = list(&h.core, Some(&pid)).unwrap().into_iter().map(|j| j.id).collect();
        assert_eq!(mine, [c, a]);
        assert_eq!(list(&h.core, Some("PRJ_nope")).unwrap_err().code, ErrorCode::NotFound);
        let req: JobListRequest = serde_json::from_value(serde_json::json!({ "projectId": null })).unwrap();
        assert!(req.project_id.is_none());
    }

    #[test]
    fn job_list_keeps_active_jobs_and_caps_finished_history() {
        let (h, pid) = setup();
        let total = TERMINAL_HISTORY as usize + 5;
        for _ in 0..total {
            let id = local(&h, &pid);
            cancel(&h.core, &id).unwrap();
        }
        let active = remote(&h, &pid);
        let listed = list(&h.core, None).unwrap();
        assert_eq!(listed.len(), TERMINAL_HISTORY as usize + 1);
        assert_eq!(listed[0].id, active);
    }

    #[test]
    fn restart_interrupts_running_jobs_and_resumes_queued_and_retrying() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("data");
        let (pid, running, queued, retrying) = {
            let (core, remote_double, _) = open_queue_core(&root);
            provider_settings::set_api_key(&core, TEST_PROVIDER, "k").unwrap();
            let pid = test_create_villa(&core, "Restart").id;
            let submit = |provider: &str| {
                generations::submit(&core, test_request(&pid, provider, "full", &[], None)).unwrap().job_id.unwrap()
            };
            remote_double.script(&[TestBehavior::Fail(ProviderErrorKind::RateLimited)]);
            let retrying = submit(TEST_PROVIDER);
            tick(&core, core.clock.now()).unwrap();
            let running = submit(TEST_LOCAL_PROVIDER);
            let claims = claim(&core, core.clock.now()).unwrap();
            assert_eq!(claims.len(), 1);
            let queued = submit(TEST_LOCAL_PROVIDER);
            drop(claims); // the app dies mid-call: the attempt never reports back
            (pid, running, queued, retrying)
        };
        let (core, _, _) = open_queue_core(&root);
        let j = get(&core, &running).unwrap();
        assert_eq!((j.status, j.attempt), (JobStatus::Interrupted, 1));
        let e = j.error.unwrap();
        assert_eq!((e.kind.as_str(), e.retryable), ("interrupted", true));
        let g = generations::get(&core, &pid, &j.generation_id).unwrap();
        assert_eq!(g.status, G::Interrupted);
        assert_eq!(get(&core, &queued).unwrap().status, JobStatus::Queued);
        let r = get(&core, &retrying).unwrap();
        assert_eq!((r.status, r.attempt), (JobStatus::Retrying, 1));

        // Interrupted jobs are never re-sent by themselves; the others run.
        provider_settings::set_api_key(&core, TEST_PROVIDER, "k").unwrap(); // fresh memory store
        let later = core.clock.now() + chrono::Duration::seconds(20);
        while tick(&core, later).unwrap() > 0 {}
        assert_eq!(get(&core, &running).unwrap().status, JobStatus::Interrupted);
        assert_eq!(get(&core, &queued).unwrap().status, JobStatus::Completed);
        assert_eq!(get(&core, &retrying).unwrap().status, JobStatus::Completed);
        assert_eq!(retry(&core, &running).unwrap().status, JobStatus::Queued, "the user can retry it");
    }

    #[test]
    fn events_follow_every_state_change() {
        let (h, pid) = setup();
        h.events.take();
        let id = remote(&h, &pid);
        let gid = job(&h, &id).generation_id;
        tick_now(&h);
        let expected: Vec<(&str, String, String)> = [
            ("job", &id, "queued"),
            ("generation", &gid, "queued"),
            ("job", &id, "running"),
            ("generation", &gid, "running"),
            ("job", &id, "completed"),
            ("generation", &gid, "completed"),
        ]
        .into_iter()
        .map(|(e, i, s)| (e, i.clone(), s.to_string()))
        .collect();
        assert_eq!(h.events.take(), expected);
        assert_eq!(JOB_UPDATED_EVENT, "job://updated");
        assert_eq!(GENERATION_UPDATED_EVENT, "generation://updated");
    }

    #[test]
    fn a_panicking_attempt_fails_the_job_and_frees_its_slot() {
        let (h, pid) = setup();
        h.remote.set_hook(|| panic!("simulated adapter bug"));
        let id = remote(&h, &pid);
        let c = claim(&h.core, h.clock.now()).unwrap().pop().unwrap();
        h.events.take();
        let core = h.core.clone();
        assert!(std::thread::spawn(move || run(&core, c)).join().is_ok(), "the panic stays inside the attempt");
        assert!(h.core.queue.running_jobs().is_empty());
        let j = job(&h, &id);
        assert_eq!((j.status, j.attempt), (JobStatus::Failed, 1));
        let e = j.error.clone().unwrap();
        assert_eq!((e.kind.as_str(), e.retryable), ("interrupted", true));
        assert!(e.message.contains("simulated adapter bug"), "{}", e.message);
        let g = generation(&h, &j);
        assert_eq!(g.status, G::Failed);
        assert_eq!(h.events.job_statuses(&id), ["failed"]);
        assert_eq!(retry(&h.core, &id).unwrap().status, JobStatus::Queued, "the user can retry it");
    }

    #[test]
    fn a_job_thread_that_cannot_start_fails_the_job_and_frees_its_slot() {
        let (h, pid) = setup();
        let id = remote(&h, &pid);
        let waiting = remote(&h, &pid);
        let claims = claim(&h.core, h.clock.now()).unwrap();
        assert_eq!(claims.len(), 1);
        h.events.take();
        h.core.queue.lock().pending_wake = false;
        start_claims(&h.core, claims, |_, _| Err(std::io::Error::other("no threads left")));
        assert!(h.core.queue.running_jobs().is_empty(), "slot released");
        assert!(h.core.queue.lock().pending_wake, "dispatcher woken to use the free slot");
        let j = job(&h, &id);
        assert_eq!(j.status, JobStatus::Failed);
        let e = j.error.clone().unwrap();
        assert_eq!((e.kind.as_str(), e.retryable), ("interrupted", true));
        assert!(e.message.contains("no threads left"), "{}", e.message);
        assert_eq!(generation(&h, &j).status, G::Failed);
        assert_eq!(h.events.job_statuses(&id), ["failed"]);
        // The other job gets the slot on the next pass.
        assert_eq!(tick_now(&h), 1);
        assert_eq!(job(&h, &waiting).status, JobStatus::Completed);
    }

    #[test]
    fn an_overdue_retry_waiting_for_a_slot_does_not_busy_poll() {
        let (h, pid) = setup();
        h.remote.script(&[TestBehavior::Fail(ProviderErrorKind::RateLimited)]);
        let retrying = remote(&h, &pid);
        tick_now(&h);
        assert_eq!(job(&h, &retrying).status, JobStatus::Retrying);
        let start = h.clock.now();
        assert_eq!(until_next_retry(&h.core, start), Some(Duration::from_secs(15)), "future retry: its time");

        // The retry is due but a higher-priority job takes the only remote slot first.
        let blocker = remote(&h, &pid);
        // Raise the blocker above the retry so it takes the slot first.
        h.core.conn().unwrap().execute("UPDATE jobs SET priority = 10 WHERE id = ?1", [&blocker]).unwrap();
        h.clock.advance_secs(20);
        let claimed_at = h.clock.now();
        let claims = claim(&h.core, claimed_at).unwrap();
        assert_eq!(claims.iter().map(|c| c.job_id.as_str()).collect::<Vec<_>>(), [blocker.as_str()]);
        assert_eq!(job(&h, &retrying).status, JobStatus::Retrying, "due but no free slot");
        assert_eq!(
            until_next_retry(&h.core, claimed_at),
            None,
            "an overdue retry waits for the slot-release wake, not a 10 ms poll"
        );
        for c in claims {
            run(&h.core, c);
        }
        assert!(h.core.queue.lock().pending_wake, "the freed slot wakes the dispatcher");
        assert_eq!(tick_now(&h), 1);
        assert_eq!(job(&h, &retrying).status, JobStatus::Completed);
    }

    #[test]
    fn job_dto_json_keys_match_zod_schema() {
        let (h, pid) = setup();
        let id = remote(&h, &pid);
        let value = serde_json::to_value(job(&h, &id)).unwrap();
        let mut keys: Vec<&str> = value.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "attempt",
                "batchId",
                "cameraId",
                "createdAt",
                "error",
                "finishedAt",
                "generationId",
                "id",
                "label",
                "maxAttempts",
                "modelId",
                "nextAttemptAt",
                "priority",
                "projectId",
                "providerId",
                "startedAt",
                "status"
            ]
        );
    }
}
