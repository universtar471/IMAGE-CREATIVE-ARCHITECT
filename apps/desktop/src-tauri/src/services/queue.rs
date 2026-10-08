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

use std::collections::HashMap;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::Duration;

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
/// `retryable: true`, which only means the user can usefully press Retry.
pub fn auto_retries(kind: &str) -> bool {
    [ProviderErrorKind::RateLimited, ProviderErrorKind::Network, ProviderErrorKind::Timeout]
        .iter()
        .any(|k| k.as_str() == kind)
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

/// Run one claimed attempt to its end and record the outcome.
pub fn run(core: &AppCore, claim: Claim) {
    let _slot = SlotGuard { core, job_id: &claim.job_id };
    let outcome = generations::run_job(core, &claim.job_id);
    if let Err(e) = settle(core, &claim.job_id, outcome) {
        eprintln!("[queue] could not record the result of job {}: {}", claim.job_id, e.message);
    }
    emit(core, &claim.job_id);
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
    let backoff = usize::try_from(job.attempt - 1).ok().and_then(|i| RETRY_BACKOFF_SECS.get(i));
    match backoff {
        Some(secs) if auto_retries(&error.kind) && job.attempt < job.max_attempts => {
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
        match claim(&core, core.clock.now()) {
            Ok(claims) => {
                for c in claims {
                    let name = format!("job-{}", c.job_id);
                    let spawned = std::thread::Builder::new().name(name).spawn({
                        let core = Arc::clone(&core);
                        move || run(&core, c)
                    });
                    if let Err(e) = spawned {
                        eprintln!("[queue] cannot start a job thread: {e}");
                    }
                }
            }
            Err(e) => eprintln!("[queue] dispatch failed: {}", e.message),
        }
        let wait = until_next_retry(&core).unwrap_or(IDLE_RECHECK).min(IDLE_RECHECK);
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

fn until_next_retry(core: &AppCore) -> Option<Duration> {
    let next = repo::next_retry_at(&*core.conn().ok()?).ok()??;
    let next = DateTime::parse_from_rfc3339(&next).ok()?.with_timezone(&Utc);
    // Never zero: a due retry is claimed on the next pass right away anyway.
    Some((next - core.clock.now()).to_std().unwrap_or(Duration::ZERO).max(Duration::from_millis(10)))
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
