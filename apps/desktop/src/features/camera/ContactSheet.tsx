/**
 * Contact Sheet: one batch's outputs side by side, grouped per camera, with live job status.
 * Actions per output: approve as the camera's anchor, compare with the master, open in the
 * canvas. Failed items can be retried here.
 */
import { useState } from "react";
import {
  Anchor,
  Ban,
  Columns2,
  ImageOff,
  LayoutGrid,
  Layers,
  Maximize2,
  RotateCcw,
  X,
} from "lucide-react";
import { costHintText, type AssetDTO, type BatchDTO, type ProjectDNA } from "@arch/domain";
import { isTerminalJob, selectReadOnly, useStudio } from "../../app/store";
import { EmptyState } from "../../components/common/states";
import { fileUrl } from "../../lib/files";
import { formatRelativeTime } from "../../lib/format";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { useT } from "../../i18n";
import { translateDomainMessage } from "../../i18n/domain";
import { knowledge } from "../../lib/knowledge";
import { adoptMoodPresetSections, type MoodVariationPreset } from "../mood/variation";
import { ActiveGenerationStatus } from "../generate/GenerationResult";
import { EnhanceBatchDialog } from "../enhance/EnhanceBatchDialog";
import { resolveEnhancePair, type EnhancePair } from "../enhance/enhance";
import { CompareCanvas } from "../../components/canvas/CompareCanvas";
import { GENERATION_STATUS_TONE, JOB_STATUS_TONE, isActiveGeneration } from "../generate/labels";
import { QcBadge } from "../qc/QcBadge";
import { useSpendConfirm } from "../../components/common/SpendConfirm";
import {
  groupContactSheet,
  groupMoodContactSheet,
  resolveMoodPreset,
  type ContactEntry,
  type ContactGroup,
} from "./contactGroups";
import { anchorRerunRequest } from "./batch";

export function adoptContactMood(dna: ProjectDNA, preset: MoodVariationPreset) {
  return adoptMoodPresetSections(dna, preset);
}

export function ContactSheet() {
  const ws = useStudio((s) => s.workspace!);
  const jobs = useStudio((s) => s.jobs);
  const chosenId = useStudio((s) => s.contactBatchId);
  const showContactSheet = useStudio((s) => s.showContactSheet);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const t = useT();

  const batch = ws.batches.find((b) => b.id === chosenId) ?? ws.batches[0] ?? null;
  if (!batch) {
    return (
      <EmptyState icon={<LayoutGrid size={32} />} title={t("contact.empty")}>
        {t("contact.emptyHint")}
      </EmptyState>
    );
  }
  const groups = groupContactSheet(batch, ws.generations, jobs, ws.draftDna.cameras);
  const master = ws.assets.find((a) => a.id === ws.project.activeMasterAssetId) ?? null;
  const compare = compareId ? ws.assets.find((a) => a.id === compareId) : null;
  const comparePair = compareId ? resolveEnhancePair(compareId, ws.generations, ws.assets) : null;
  const selectedSources = ws.assets.filter(
    (asset) => selectedIds.includes(asset.id) && asset.status === "ready",
  );

  return (
    <div className="contact-sheet" data-testid="contact-sheet">
      <div className="contact-toolbar">
        <select
          className="select"
          aria-label={t("contact.batch")}
          value={batch.id}
          onChange={(e) => showContactSheet(e.target.value)}
        >
          {ws.batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} · {t(`labels.purpose.${b.purpose}`)} ·{" "}
              {t("common.items", { count: b.jobIds.length })}
            </option>
          ))}
        </select>
        <BatchCounts batch={batch} />
        <span className="field-hint">{formatRelativeTime(batch.createdAt)}</span>
        {selectedSources.length >= 2 && (
          <button className="btn btn-sm btn-primary" onClick={() => setBatchOpen(true)}>
            <Layers size={12} /> {t("enhance.batch")} ({selectedSources.length})
          </button>
        )}
      </div>
      {compare ? (
        comparePair ? (
          <EnhanceCompareView pair={comparePair} onClose={() => setCompareId(null)} />
        ) : (
          <CompareView master={master} candidate={compare} onClose={() => setCompareId(null)} />
        )
      ) : (
        <div className="contact-groups">
          {groups.length === 0 && <span className="field-hint">{t("contact.loading")}</span>}
          {batch.purpose === "variation" ? (
            <MoodGroups
              batch={batch}
              selectedIds={selectedIds}
              onToggle={(id) =>
                setSelectedIds((current) =>
                  current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
                )
              }
            />
          ) : (
            groups.map((g) => (
              <CameraGroup
                key={g.cameraId ?? "none"}
                group={g}
                enhance={batch.purpose === "enhance"}
                onCompare={setCompareId}
                selectedIds={selectedIds}
                onToggle={(id) =>
                  setSelectedIds((current) =>
                    current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
                  )
                }
              />
            ))
          )}
        </div>
      )}
      {batchOpen && selectedSources.length >= 2 && (
        <EnhanceBatchDialog sources={selectedSources} onClose={() => setBatchOpen(false)} />
      )}
    </div>
  );
}

function MoodGroups({
  batch,
  selectedIds,
  onToggle,
}: {
  batch: BatchDTO;
  selectedIds: readonly string[];
  onToggle: (assetId: string) => void;
}) {
  const ws = useStudio((s) => s.workspace!);
  const jobs = useStudio((s) => s.jobs);
  const editDna = useStudio((s) => s.editDna);
  const readOnly = useStudio(selectReadOnly);
  const presets = knowledge.moodPresets(ws.project.projectType, ws.project.subtype);
  return (
    <>
      {groupMoodContactSheet(batch, ws.generations, jobs).map((group) => (
        <MoodGroup
          key={group.label}
          group={group}
          presets={presets}
          readOnly={readOnly}
          selectedIds={selectedIds}
          onToggle={onToggle}
          onAdopt={(preset) => {
            for (const [section, value] of Object.entries(adoptContactMood(ws.draftDna, preset))) {
              if (value) editDna(section, value);
            }
          }}
        />
      ))}
    </>
  );
}

function MoodGroup({
  group,
  presets,
  readOnly,
  selectedIds,
  onToggle,
  onAdopt,
}: {
  group: ReturnType<typeof groupMoodContactSheet>[number];
  presets: ReturnType<typeof knowledge.moodPresets>;
  readOnly: boolean;
  selectedIds: readonly string[];
  onToggle: (assetId: string) => void;
  onAdopt: (preset: (typeof presets)[number]) => void;
}) {
  const t = useT();
  const preset = resolveMoodPreset(group.label, presets);
  const ws = useStudio((s) => s.workspace!);
  const selectAsset = useStudio((s) => s.selectAsset);
  return (
    <section className="contact-group" aria-label={group.label}>
      <header>
        <strong>{group.label}</strong>
        {preset && (
          <button className="btn btn-sm" disabled={readOnly} onClick={() => onAdopt(preset)}>
            {t("moodGrade.adopt")}
          </button>
        )}
      </header>
      <div className="contact-cards">
        {group.entries.map(({ generation, job }) =>
          generation.outputAssetIds.map((id) => {
            const asset = ws.assets.find((item) => item.id === id);
            if (!asset)
              return (
                <div className="contact-card is-pending" key={id}>
                  <span className="field-hint">{job?.status ?? t("contact.loading")}</span>
                </div>
              );
            return (
              <div className="contact-card" key={id}>
                <label className="asset-select-check">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(asset.id)}
                    onChange={() => onToggle(asset.id)}
                  />{" "}
                  {t("assets.batchSelect")}
                </label>
                <button className="contact-image" onClick={() => selectAsset(id)}>
                  <img
                    src={fileUrl(asset.thumbnailPath) ?? ""}
                    alt={asset.originalName ?? group.label}
                  />
                </button>
                <span>{t("contact.openInCanvas")}</span>
              </div>
            );
          }),
        )}
      </div>
    </section>
  );
}

/** Live counts from the job list (falls back to the batch's own counts). */
function BatchCounts({ batch }: { batch: BatchDTO }) {
  const jobs = useStudio((s) => s.jobs);
  const t = useT();
  const mine = jobs.filter((j) => j.batchId === batch.id);
  const count = (pred: (s: string) => boolean) =>
    mine.length
      ? mine.filter((j) => pred(j.status)).length
      : Object.entries(batch.counts)
          .filter(([s]) => pred(s))
          .reduce((n, [, v]) => n + v, 0);
  const active = count((s) => s === "queued" || s === "running" || s === "retrying");
  const done = count((s) => s === "completed");
  const failed = count((s) => s === "failed" || s === "interrupted" || s === "cancelled");
  return (
    <span className="contact-counts">
      {active > 0 && (
        <span className="badge badge-info">{t("contact.inProgress", { count: active })}</span>
      )}
      <span className="badge badge-success">{t("contact.done", { count: done })}</span>
      {failed > 0 && (
        <span className="badge badge-danger">{t("contact.notFinished", { count: failed })}</span>
      )}
    </span>
  );
}

function CameraGroup({
  group,
  enhance,
  onCompare,
  selectedIds,
  onToggle,
}: {
  group: ContactGroup;
  enhance: boolean;
  onCompare: (assetId: string) => void;
  selectedIds: readonly string[];
  onToggle: (assetId: string) => void;
}) {
  const anchor = useStudio((s) =>
    s.workspace!.anchors.find((a) => group.cameraId && a.cameraId === group.cameraId),
  );
  const cam = group.camera;
  const t = useT();
  const createBatch = useStudio((s) => s.createBatch);
  const readOnly = useStudio(selectReadOnly);
  const spend = useSpendConfirm();
  const rerun = async () => {
    if (!group.cameraId || readOnly || !group.entries.length) return;
    const source = group.entries[0]!.generation;
    const provider = useStudio.getState().providers?.find((item) => item.id === source.providerId);
    const model = provider?.models.find((item) => item.id === source.modelId);
    const count = source.params.outputCount;
    const unit = source.params.imageSize ? model?.priceHint?.[source.params.imageSize] : undefined;
    if (
      !(await spend.request({
        providerId: source.providerId,
        provider: provider?.label ?? source.providerId,
        model: model?.label ?? source.modelId,
        imageCount: count,
        costText: model
          ? translateDomainMessage(costHintText(model, source.params.imageSize, count) ?? "", t)
          : null,
        estimatedTotal: unit === undefined ? null : unit * count,
      }))
    )
      return;
    const cameraName = cam?.name ?? group.cameraId;
    await createBatch(
      anchorRerunRequest(
        source,
        group.cameraId,
        cameraName,
        `${t("contact.rerunAnchor")} · ${cameraName}`,
      ),
    );
  };
  return (
    <section className="contact-group" aria-label={cam?.name ?? t("contact.noCamera")}>
      <header>
        <strong>
          {cam?.name ?? (group.cameraId ? t("contact.removedCamera") : t("contact.noCamera"))}
        </strong>
        {cam?.isAnchorView && (
          <span className={`badge ${anchor ? "badge-success" : "badge-warning"}`}>
            <Anchor size={10} /> {anchor ? t("camera.anchored") : t("contact.pickOne")}
          </span>
        )}
        {cam?.isAnchorView && group.entries.length > 0 && (
          <button className="btn btn-sm" disabled={readOnly} onClick={() => void rerun()}>
            {t("contact.rerunAnchor")}
          </button>
        )}
      </header>
      <div className="contact-cards">
        {group.entries.map((e) => (
          <EntryCards
            key={e.generation.id}
            entry={e}
            group={group}
            anchorAssetId={anchor?.assetId ?? null}
            onCompare={onCompare}
            enhance={enhance}
            selectedIds={selectedIds}
            onToggle={onToggle}
          />
        ))}
      </div>
      {spend.dialog}
    </section>
  );
}

function EntryCards({
  entry: { generation: g, job },
  group,
  anchorAssetId,
  onCompare,
  enhance,
  selectedIds,
  onToggle,
}: {
  entry: ContactEntry;
  group: ContactGroup;
  anchorAssetId: string | null;
  onCompare: (assetId: string) => void;
  enhance: boolean;
  selectedIds: readonly string[];
  onToggle: (assetId: string) => void;
}) {
  const assets = useStudio((s) => s.workspace!.assets);
  const retryJob = useStudio((s) => s.retryJob);
  const cancelJob = useStudio((s) => s.cancelJob);
  const readOnly = useStudio(selectReadOnly);
  const t = useT();
  const outputs = g.outputAssetIds
    .map((id) => assets.find((a) => a.id === id))
    .filter((a): a is AssetDTO => !!a);

  if (g.status === "completed" && outputs.length) {
    return (
      <>
        {outputs.map((a) => (
          <OutputCard
            key={a.id}
            asset={a}
            canAnchor={!!group.camera?.isAnchorView}
            cameraId={group.cameraId}
            isAnchor={a.id === anchorAssetId}
            onCompare={() => onCompare(a.id)}
            enhance={enhance}
            selected={selectedIds.includes(a.id)}
            onToggle={() => onToggle(a.id)}
          />
        ))}
      </>
    );
  }
  const active = isActiveGeneration(g.status) || (job !== null && !isTerminalJob(job));
  const status = job ? (
    <span className={`badge ${JOB_STATUS_TONE[job.status]}`}>
      {t(`labels.jobStatus.${job.status}`)}
    </span>
  ) : (
    <span className={`badge ${GENERATION_STATUS_TONE[g.status]}`}>
      {t(`labels.generationStatus.${g.status}`)}
    </span>
  );
  return (
    <div className="contact-card is-pending" data-testid="contact-pending">
      <div className="contact-image">
        {active ? <ActiveGenerationStatus generation={g} compact /> : <ImageOff size={22} />}
      </div>
      <div className="contact-meta">
        {status}
        {g.error && (
          <span className="field-hint" title={g.error.message}>
            <ErrorMessage kind={g.error.kind} message={g.error.message} />
          </span>
        )}
        {g.status === "completed" && (
          <span className="field-hint">{t("contact.outputsRemoved")}</span>
        )}
      </div>
      <div className="btn-row">
        {active && job && (
          <button className="btn btn-sm" disabled={readOnly} onClick={() => void cancelJob(job.id)}>
            <Ban size={12} /> {t("common.cancel")}
          </button>
        )}
        {!active && job && job.status !== "completed" && (
          <button className="btn btn-sm" disabled={readOnly} onClick={() => void retryJob(job.id)}>
            <RotateCcw size={12} /> {t("common.retry")}
          </button>
        )}
      </div>
    </div>
  );
}

function OutputCard({
  asset,
  canAnchor,
  cameraId,
  isAnchor,
  onCompare,
  enhance,
  selected,
  onToggle,
}: {
  asset: AssetDTO;
  canAnchor: boolean;
  cameraId: string | null;
  isAnchor: boolean;
  onCompare: () => void;
  enhance: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const setAnchor = useStudio((s) => s.setAnchor);
  const selectAsset = useStudio((s) => s.selectAsset);
  const notify = useStudio((s) => s.notify);
  const readOnly = useStudio(selectReadOnly);
  const [busy, setBusy] = useState(false);
  const t = useT();
  const src = asset.status === "ready" ? fileUrl(asset.thumbnailPath) : null;

  const approve = async () => {
    if (!cameraId) return;
    setBusy(true);
    if (await setAnchor(cameraId, asset.id)) notify("success", t("contact.anchorApproved"));
    setBusy(false);
  };

  return (
    <div className={`contact-card ${isAnchor ? "is-anchor" : ""}`} data-testid="contact-output">
      <label className="asset-select-check">
        <input type="checkbox" checked={selected} onChange={onToggle} /> {t("assets.batchSelect")}
      </label>
      <button
        className="contact-image"
        onClick={() => selectAsset(asset.id)}
        title={t("contact.openInCanvas")}
      >
        {src ? <img src={src} alt={asset.originalName ?? ""} /> : <ImageOff size={22} />}
        <QcBadge assetId={asset.id} projectId={asset.projectId} />
        {isAnchor && (
          <span className="badge badge-success contact-anchor-badge">
            <Anchor size={10} /> {t("common.anchor")}
          </span>
        )}
      </button>
      <div className="btn-row">
        {canAnchor && (
          <button
            className="btn btn-sm btn-primary"
            disabled={isAnchor || busy || readOnly}
            onClick={() => void approve()}
          >
            <Anchor size={12} /> {isAnchor ? t("common.anchor") : t("contact.approve")}
          </button>
        )}
        <button
          className="btn btn-sm"
          onClick={onCompare}
          title={enhance ? t("enhance.compareSource") : t("contact.compareTitle")}
        >
          <Columns2 size={12} /> {enhance ? t("enhance.compareSource") : t("contact.compare")}
        </button>
        <button
          className="btn btn-sm btn-icon"
          onClick={() => selectAsset(asset.id)}
          title={t("contact.openInCanvas")}
          aria-label={t("contact.openInCanvas")}
        >
          <Maximize2 size={12} />
        </button>
      </div>
    </div>
  );
}

function CompareView({
  master,
  candidate,
  onClose,
}: {
  master: AssetDTO | null;
  candidate: AssetDTO;
  onClose: () => void;
}) {
  const t = useT();
  const pane = (a: AssetDTO | null, title: string) => {
    const src = a && a.status === "ready" ? fileUrl(a.absolutePath) : null;
    return (
      <figure className="compare-pane">
        <figcaption>{title}</figcaption>
        {src ? <img src={src} alt={a?.originalName ?? title} /> : <ImageOff size={28} />}
      </figure>
    );
  };
  return (
    <div className="compare" data-testid="compare-view">
      <div className="compare-head">
        <strong>{t("contact.compareTitle")}</strong>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={onClose}>
          <X size={13} /> {t("contact.back")}
        </button>
      </div>
      <div className="compare-panes">
        {pane(
          master,
          master
            ? t("contact.masterPane", { name: master.originalName ?? "" })
            : t("contact.noMaster"),
        )}
        {pane(candidate, candidate.originalName ?? t("contact.candidate"))}
      </div>
    </div>
  );
}

function EnhanceCompareView({ pair, onClose }: { pair: EnhancePair; onClose: () => void }) {
  const t = useT();
  return (
    <div className="compare" data-testid="compare-view">
      <div className="compare-head">
        <strong>{t("enhance.compareSource")}</strong>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={onClose}>
          <X size={13} /> {t("contact.back")}
        </button>
      </div>
      <CompareCanvas source={pair.source} result={pair.result} />
    </div>
  );
}
