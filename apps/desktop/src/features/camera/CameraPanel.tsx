import { useEffect, useState } from "react";
import {
  Anchor,
  Clapperboard,
  Copy,
  LayoutGrid,
  Plus,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  anchorViews,
  blankCamera,
  cameraFromPreset,
  cameraReadiness,
  CameraViewTypeSchema,
  duplicateCamera,
  type CameraDNA,
  type PromptBundle,
} from "@arch/domain";
import { compilePromptPreview } from "../../app/services";
import { selectReadOnly, useStudio } from "../../app/store";
import { ConfirmDialog } from "../../components/common/Dialog";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { NumberField, SelectField, TextAreaField, TextField } from "../../components/panels/fields";
import { toBridgeError } from "../../lib/bridge";
import { knowledge } from "../../lib/knowledge";
import { fileUrl } from "../../lib/files";
import { BatchDialog } from "./BatchDialog";
import type { BatchMode } from "./batch";
import { CAMERA_ASPECT_RATIOS, isMasterApproved } from "./labels";
import { useT } from "../../i18n";
import { readinessLabel } from "../../i18n/domain";
import { cameraPresetLabel } from "../../i18n/knowledge";

/** Right panel of the Camera module: camera list, field editor, prompt, anchors/production. */
export function CameraPanel() {
  const ws = useStudio((s) => s.workspace!);
  const selectedId = useStudio((s) => s.selectedCameraId);
  const cameras = ws.draftDna.cameras;
  const selectedIndex = cameras.findIndex((c) => c.id === selectedId);
  const selected = selectedIndex >= 0 ? cameras[selectedIndex]! : null;
  const [dialog, setDialog] = useState<BatchMode | null>(null);
  const t = useT();

  return (
    <div className="camera-panel">
      <WorkflowSection onOpen={setDialog} />
      <CameraListSection />
      {selected ? (
        <>
          <CameraEditor key={selected.id} camera={selected} index={selectedIndex} />
          <SectionPanel title={t("camera.prompt")} defaultOpen={false}>
            <CameraPromptPreview camera={selected} />
          </SectionPanel>
        </>
      ) : (
        cameras.length > 0 && <span className="field-hint">{t("camera.selectHint")}</span>
      )}
      {dialog && <BatchDialog mode={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

function WorkflowSection({ onOpen }: { onOpen: (m: BatchMode) => void }) {
  const ws = useStudio((s) => s.workspace!);
  const readOnly = useStudio(selectReadOnly);
  const showContactSheet = useStudio((s) => s.showContactSheet);
  const approved = isMasterApproved(ws.project.status);
  const t = useT();
  const views = anchorViews(ws.draftDna);
  const anchored = views.filter((c) => ws.anchors.some((a) => a.cameraId === c.id));
  const anchorReason = readOnly
    ? t("camera.reasonArchived")
    : !ws.project.activeMasterAssetId
      ? t("camera.reasonMasterRefs")
      : !approved
        ? t("camera.reasonApprove")
        : views.length === 0
          ? t("camera.reasonAnchorView")
          : null;
  const renderReason = readOnly
    ? t("camera.reasonArchived")
    : !ws.project.activeMasterAssetId
      ? t("camera.reasonMaster")
      : ws.draftDna.cameras.length === 0
        ? t("camera.reasonAddCamera")
        : null;

  return (
    <SectionPanel
      title={t("camera.workflow")}
      aside={
        views.length > 0 && (
          <span
            className={`badge ${anchored.length === views.length ? "badge-success" : "badge-warning"}`}
          >
            {t("camera.anchoredCount", { done: anchored.length, total: views.length })}
          </span>
        )
      }
    >
      <div className="btn-row">
        <button
          className="btn btn-sm btn-primary"
          disabled={anchorReason !== null}
          onClick={() => onOpen("anchor")}
          data-testid="generate-anchors"
        >
          <Anchor size={13} /> {t("camera.generateAnchors")}
        </button>
        <button
          className="btn btn-sm"
          disabled={renderReason !== null}
          onClick={() => onOpen("production")}
          data-testid="render-cameras"
        >
          <Clapperboard size={13} /> {t("camera.renderCameras")}
        </button>
        <button
          className="btn btn-sm"
          disabled={ws.batches.length === 0}
          onClick={() => showContactSheet(null)}
        >
          <LayoutGrid size={13} /> {t("camera.contactSheet")}
        </button>
      </div>
      {(anchorReason ?? renderReason) && (
        <span className="field-hint" data-testid="anchor-disabled-reason">
          {anchorReason ?? renderReason}
        </span>
      )}
      {views.length > 0 && anchored.length < views.length && !anchorReason && (
        <span className="field-hint">{t("camera.approveHint")}</span>
      )}
    </SectionPanel>
  );
}

function CameraListSection() {
  const ws = useStudio((s) => s.workspace!);
  const selectedId = useStudio((s) => s.selectedCameraId);
  const selectCamera = useStudio((s) => s.selectCamera);
  const setCameras = useStudio((s) => s.setCameras);
  const readOnly = useStudio(selectReadOnly);
  const [confirmDelete, setConfirmDelete] = useState<CameraDNA | null>(null);
  const cameras = ws.draftDna.cameras;
  const names = cameras.map((c) => c.name);
  const presets = knowledge.cameraPresets(ws.project.projectType, ws.project.subtype);
  const t = useT();

  const add = (camera: CameraDNA) => {
    setCameras([...cameras, camera]);
    selectCamera(camera.id);
  };
  const duplicate = (c: CameraDNA) => {
    const copy = duplicateCamera(c, names);
    const i = cameras.findIndex((x) => x.id === c.id);
    setCameras([...cameras.slice(0, i + 1), copy, ...cameras.slice(i + 1)]);
    selectCamera(copy.id);
  };
  const remove = (c: CameraDNA) => {
    setConfirmDelete(null);
    const i = cameras.findIndex((x) => x.id === c.id);
    const next = cameras.filter((x) => x.id !== c.id);
    setCameras(next);
    if (selectedId === c.id) selectCamera(next[Math.min(i, next.length - 1)]?.id ?? null);
  };
  const toggleAnchorView = (c: CameraDNA) =>
    setCameras(cameras.map((x) => (x.id === c.id ? { ...x, isAnchorView: !x.isAnchorView } : x)));

  return (
    <SectionPanel
      title={t("camera.cameras")}
      aside={<span className="badge badge-neutral">{cameras.length}</span>}
    >
      {!readOnly && (
        <div className="camera-add">
          <select
            className="select"
            aria-label={t("camera.addFromPresetLabel")}
            value=""
            onChange={(e) => {
              const preset = presets.find((p) => p.id === e.target.value);
              if (preset) add(cameraFromPreset(preset, names));
            }}
          >
            <option value="">{t("camera.addFromPreset")}</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {cameraPresetLabel(p)}
                {p.anchorRecommended ? t("camera.anchorSuffix") : ""}
              </option>
            ))}
          </select>
          <button className="btn btn-sm" onClick={() => add(blankCamera(names))}>
            <Plus size={13} /> {t("camera.blank")}
          </button>
        </div>
      )}
      {cameras.length === 0 ? (
        <span className="field-hint">
          {t("camera.noCameras", {
            type: t(`labels.projectType.${ws.project.projectType}`).toLowerCase(),
          })}
        </span>
      ) : (
        <ul className="camera-list" aria-label={t("camera.cameras")}>
          {cameras.map((c) => {
            const anchor = ws.anchors.find((a) => a.cameraId === c.id);
            const anchorAsset = anchor ? ws.assets.find((a) => a.id === anchor.assetId) : null;
            const thumb = anchorAsset ? fileUrl(anchorAsset.thumbnailPath) : null;
            return (
              <li
                key={c.id}
                className={`camera-row ${c.id === selectedId ? "is-selected" : ""}`}
                data-testid="camera-row"
              >
                <button
                  className="camera-row-main"
                  aria-pressed={c.id === selectedId}
                  onClick={() => selectCamera(c.id)}
                >
                  <span className="camera-thumb">
                    {thumb ? <img src={thumb} alt="" /> : <Anchor size={12} />}
                  </span>
                  <span className="camera-row-text">
                    <strong>{c.name}</strong>
                    <span className="field-hint">
                      {t(`labels.viewType.${c.viewType}`)}
                      {c.azimuthDeg !== undefined ? ` · ${Math.round(c.azimuthDeg)}°` : ""}
                      {c.distanceM !== undefined ? ` · ${c.distanceM} m` : ""}
                    </span>
                  </span>
                  {anchor ? (
                    <span className="badge badge-success">{t("camera.anchored")}</span>
                  ) : c.isAnchorView ? (
                    <span className="badge badge-warning">{t("camera.anchorView")}</span>
                  ) : null}
                </button>
                <RowAction
                  icon={Anchor}
                  label={c.isAnchorView ? t("camera.unmarkAnchor") : t("camera.markAnchor")}
                  pressed={c.isAnchorView}
                  disabled={readOnly}
                  onClick={() => toggleAnchorView(c)}
                />
                <RowAction
                  icon={Copy}
                  label={t("camera.duplicate")}
                  disabled={readOnly}
                  onClick={() => duplicate(c)}
                />
                <RowAction
                  icon={Trash2}
                  label={t("common.delete")}
                  disabled={readOnly}
                  onClick={() => setConfirmDelete(c)}
                />
              </li>
            );
          })}
        </ul>
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={t("camera.deleteTitle")}
          danger
          message={
            <>
              <p style={{ marginTop: 0 }}>
                {t("camera.deleteMessage", { name: confirmDelete.name })}
                {ws.anchors.some((a) => a.cameraId === confirmDelete.id)
                  ? ` ${t("camera.deleteAnchorNote")}`
                  : ""}
              </p>
              <p className="field-hint">{t("camera.deleteHistoryNote")}</p>
            </>
          }
          confirmLabel={t("camera.deleteConfirm")}
          onConfirm={() => remove(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </SectionPanel>
  );
}

function RowAction({
  icon: Icon,
  label,
  pressed,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="btn btn-ghost btn-sm btn-icon"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={13} />
    </button>
  );
}

function CameraEditor({ camera: c, index }: { camera: CameraDNA; index: number }) {
  const editDna = useStudio((s) => s.editDna);
  const errors = useStudio((s) => s.save.fieldErrors);
  const readOnly = useStudio(selectReadOnly);
  const base = `cameras.${index}`;
  const edit = (field: keyof CameraDNA) => (value: unknown) => editDna(`${base}.${field}`, value);
  const err = (field: string) => errors[`${base}.${field}`];
  const missing = cameraReadiness(c).filter((r) => !r.done);
  const t = useT();

  return (
    <SectionPanel title={t("camera.editorTitle", { name: c.name || t("camera.unnamed") })}>
      <TextField
        label={t("camera.name")}
        value={c.name}
        error={err("name")}
        disabled={readOnly}
        onChange={(v) => edit("name")(v ?? "")}
      />
      <SelectField
        label={t("camera.viewType")}
        allowEmpty={false}
        value={c.viewType}
        disabled={readOnly}
        options={CameraViewTypeSchema.options.map((v) => ({
          value: v,
          label: t(`labels.viewType.${v}`),
        }))}
        onChange={(v) => edit("viewType")(v ?? "custom")}
      />
      <label className="check-row">
        <input
          type="checkbox"
          checked={c.isAnchorView}
          disabled={readOnly}
          onChange={(e) => edit("isAnchorView")(e.target.checked)}
        />
        {t("camera.anchorViewCheck")}
      </label>
      <div className="field-row">
        <NumberField
          label={t("camera.azimuth")}
          suffix="°"
          hint={t("camera.azimuthHint")}
          value={c.azimuthDeg}
          error={err("azimuthDeg")}
          disabled={readOnly}
          onChange={edit("azimuthDeg")}
        />
        <NumberField
          label={t("camera.elevation")}
          suffix="°"
          value={c.elevationDeg}
          error={err("elevationDeg")}
          disabled={readOnly}
          onChange={edit("elevationDeg")}
        />
      </div>
      <div className="field-row">
        <NumberField
          label={t("camera.height")}
          suffix="m"
          value={c.heightM}
          error={err("heightM")}
          disabled={readOnly}
          onChange={edit("heightM")}
        />
        <NumberField
          label={t("camera.distance")}
          suffix="m"
          hint={t("camera.distanceHint")}
          value={c.distanceM}
          error={err("distanceM")}
          disabled={readOnly}
          onChange={edit("distanceM")}
        />
      </div>
      <div className="field-row">
        <NumberField
          label={t("camera.lens")}
          suffix="mm"
          value={c.lensMm}
          error={err("lensMm")}
          disabled={readOnly}
          onChange={edit("lensMm")}
        />
        <SelectField
          label={t("camera.aspectRatio")}
          value={c.aspectRatio}
          disabled={readOnly}
          options={CAMERA_ASPECT_RATIOS.map((r) => ({ value: r, label: r }))}
          onChange={edit("aspectRatio")}
        />
      </div>
      <TextField
        label={t("camera.composition")}
        value={c.composition}
        placeholder={t("camera.compositionPlaceholder")}
        disabled={readOnly}
        onChange={edit("composition")}
      />
      <TextAreaField
        label={t("camera.notes")}
        value={c.notes}
        disabled={readOnly}
        onChange={(v) => edit("notes")(v)}
      />
      {missing.length > 0 && (
        <span className="field-hint">
          {t("camera.notSetYet", {
            list: missing.map((m) => readinessLabel(m, t).toLowerCase()).join(", "),
          })}
        </span>
      )}
    </SectionPanel>
  );
}

/**
 * The prompt a render of this camera sends, compiled from SAVED data (pending edits are
 * flushed first) with the master and this camera's anchor as references.
 */
function CameraPromptPreview({ camera }: { camera: CameraDNA }) {
  const projectId = useStudio((s) => s.workspace!.project.id);
  const masterId = useStudio((s) => s.workspace!.project.activeMasterAssetId);
  const anchorId = useStudio(
    (s) => s.workspace!.anchors.find((a) => a.cameraId === camera.id)?.assetId ?? null,
  );
  const revision = useStudio((s) => s.dataRevision);
  const flushDna = useStudio((s) => s.flushDna);
  const [result, setResult] = useState<{ key: string; bundle?: PromptBundle; error?: string }>();
  const refs = [masterId, anchorId].filter((x): x is string => !!x).join(",");
  const key = `${projectId}|${revision}|${camera.id}|${refs}`;
  const t = useT();

  useEffect(() => {
    let alive = true;
    void flushDna()
      .then(() =>
        compilePromptPreview(projectId, refs ? refs.split(",") : [], {
          cameraId: camera.id,
          anchorAssetId: anchorId,
        }),
      )
      .then(
        (bundle) => alive && setResult({ key, bundle }),
        (e: unknown) => alive && setResult({ key, error: toBridgeError(e).message }),
      );
    return () => {
      alive = false;
    };
  }, [flushDna, projectId, camera.id, refs, anchorId, key]);

  if (!result) return <span className="field-hint">{t("common.compiling")}</span>;
  if (result.error) return <span className="field-error">{result.error}</span>;
  const b = result.bundle!;
  const cameraSection = b.positivePrompt.split("\n\n").find((p) => p.startsWith("Camera:"));
  return (
    <div
      className={`gen-prompt ${result.key !== key ? "is-stale" : ""}`}
      data-testid="camera-prompt"
    >
      <span className="field-hint">{t("prompt.englishNote")}</span>
      <span className="field-label">
        <Sparkles size={11} /> {t("camera.section")}
      </span>
      <pre lang="en">{cameraSection ?? t("camera.notFound")}</pre>
      <span className="field-label">{t("camera.references")}</span>
      <pre lang="en">{b.referenceInstructions}</pre>
      <span className="field-label">{t("camera.fullPositive")}</span>
      <pre lang="en">{b.positivePrompt}</pre>
      <span className="field-hint">
        {anchorId
          ? t("camera.footerAnchor", { version: b.compilerVersion })
          : t("camera.footer", { version: b.compilerVersion })}
      </span>
    </div>
  );
}
