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
import { CAMERA_ASPECT_RATIOS, VIEW_TYPE_LABELS, isMasterApproved } from "./labels";

/** Right panel of the Camera module: camera list, field editor, prompt, anchors/production. */
export function CameraPanel() {
  const ws = useStudio((s) => s.workspace!);
  const selectedId = useStudio((s) => s.selectedCameraId);
  const cameras = ws.draftDna.cameras;
  const selectedIndex = cameras.findIndex((c) => c.id === selectedId);
  const selected = selectedIndex >= 0 ? cameras[selectedIndex]! : null;
  const [dialog, setDialog] = useState<BatchMode | null>(null);

  return (
    <div className="camera-panel">
      <WorkflowSection onOpen={setDialog} />
      <CameraListSection />
      {selected ? (
        <>
          <CameraEditor key={selected.id} camera={selected} index={selectedIndex} />
          <SectionPanel title="Camera prompt" defaultOpen={false}>
            <CameraPromptPreview camera={selected} />
          </SectionPanel>
        </>
      ) : (
        cameras.length > 0 && (
          <span className="field-hint">Select a camera in the list or on the diagram.</span>
        )
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
  const views = anchorViews(ws.draftDna);
  const anchored = views.filter((c) => ws.anchors.some((a) => a.cameraId === c.id));
  const anchorReason = readOnly
    ? "Archived projects are read-only."
    : !ws.project.activeMasterAssetId
      ? "Set a master image first (References)."
      : !approved
        ? "Approve the master first (Overview)."
        : views.length === 0
          ? "Mark at least one camera as an anchor view."
          : null;
  const renderReason = readOnly
    ? "Archived projects are read-only."
    : !ws.project.activeMasterAssetId
      ? "Set a master image first."
      : ws.draftDna.cameras.length === 0
        ? "Add a camera first."
        : null;

  return (
    <SectionPanel
      title="Anchors & production"
      aside={
        views.length > 0 && (
          <span
            className={`badge ${anchored.length === views.length ? "badge-success" : "badge-warning"}`}
          >
            {anchored.length}/{views.length} anchored
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
          <Anchor size={13} /> Generate anchors
        </button>
        <button
          className="btn btn-sm"
          disabled={renderReason !== null}
          onClick={() => onOpen("production")}
          data-testid="render-cameras"
        >
          <Clapperboard size={13} /> Render cameras
        </button>
        <button
          className="btn btn-sm"
          disabled={ws.batches.length === 0}
          onClick={() => showContactSheet(null)}
        >
          <LayoutGrid size={13} /> Contact Sheet
        </button>
      </div>
      {(anchorReason ?? renderReason) && (
        <span className="field-hint" data-testid="anchor-disabled-reason">
          {anchorReason ?? renderReason}
        </span>
      )}
      {views.length > 0 && anchored.length < views.length && !anchorReason && (
        <span className="field-hint">
          Approve one result per anchor view on the Contact Sheet; production renders then use it as
          a reference.
        </span>
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
      title="Cameras"
      aside={<span className="badge badge-neutral">{cameras.length}</span>}
    >
      {!readOnly && (
        <div className="camera-add">
          <select
            className="select"
            aria-label="Add camera from preset"
            value=""
            onChange={(e) => {
              const preset = presets.find((p) => p.id === e.target.value);
              if (preset) add(cameraFromPreset(preset, names));
            }}
          >
            <option value="">Add from preset…</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.anchorRecommended ? " (anchor)" : ""}
              </option>
            ))}
          </select>
          <button className="btn btn-sm" onClick={() => add(blankCamera(names))}>
            <Plus size={13} /> Blank
          </button>
        </div>
      )}
      {cameras.length === 0 ? (
        <span className="field-hint">
          No cameras yet. Presets give realistic viewpoints for a{" "}
          {ws.project.projectType.replace(/_/g, " ")}; anchor views get an approved image before
          production.
        </span>
      ) : (
        <ul className="camera-list" aria-label="Cameras">
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
                      {VIEW_TYPE_LABELS[c.viewType]}
                      {c.azimuthDeg !== undefined ? ` · ${Math.round(c.azimuthDeg)}°` : ""}
                      {c.distanceM !== undefined ? ` · ${c.distanceM} m` : ""}
                    </span>
                  </span>
                  {anchor ? (
                    <span className="badge badge-success">anchored</span>
                  ) : c.isAnchorView ? (
                    <span className="badge badge-warning">anchor view</span>
                  ) : null}
                </button>
                <RowAction
                  icon={Anchor}
                  label={c.isAnchorView ? "Unmark anchor view" : "Mark as anchor view"}
                  pressed={c.isAnchorView}
                  disabled={readOnly}
                  onClick={() => toggleAnchorView(c)}
                />
                <RowAction
                  icon={Copy}
                  label="Duplicate"
                  disabled={readOnly}
                  onClick={() => duplicate(c)}
                />
                <RowAction
                  icon={Trash2}
                  label="Delete"
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
          title="Delete camera?"
          danger
          message={
            <>
              <p style={{ marginTop: 0 }}>
                “{confirmDelete.name}” is removed from the camera set.
                {ws.anchors.some((a) => a.cameraId === confirmDelete.id)
                  ? " Its approved anchor is released (the image itself stays in the project)."
                  : ""}
              </p>
              <p className="field-hint">Renders already made for it stay in the history.</p>
            </>
          }
          confirmLabel="Delete camera"
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

  return (
    <SectionPanel title={`Camera — ${c.name || "unnamed"}`}>
      <TextField
        label="Name"
        value={c.name}
        error={err("name")}
        disabled={readOnly}
        onChange={(v) => edit("name")(v ?? "")}
      />
      <SelectField
        label="View type"
        allowEmpty={false}
        value={c.viewType}
        disabled={readOnly}
        options={CameraViewTypeSchema.options.map((v) => ({
          value: v,
          label: VIEW_TYPE_LABELS[v],
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
        Anchor view — gets an approved anchor image before production renders
      </label>
      <div className="field-row">
        <NumberField
          label="Azimuth"
          suffix="°"
          hint="0 = front, + = clockwise"
          value={c.azimuthDeg}
          error={err("azimuthDeg")}
          disabled={readOnly}
          onChange={edit("azimuthDeg")}
        />
        <NumberField
          label="Elevation"
          suffix="°"
          value={c.elevationDeg}
          error={err("elevationDeg")}
          disabled={readOnly}
          onChange={edit("elevationDeg")}
        />
      </div>
      <div className="field-row">
        <NumberField
          label="Height"
          suffix="m"
          value={c.heightM}
          error={err("heightM")}
          disabled={readOnly}
          onChange={edit("heightM")}
        />
        <NumberField
          label="Distance"
          suffix="m"
          hint="From the building centre"
          value={c.distanceM}
          error={err("distanceM")}
          disabled={readOnly}
          onChange={edit("distanceM")}
        />
      </div>
      <div className="field-row">
        <NumberField
          label="Lens"
          suffix="mm"
          value={c.lensMm}
          error={err("lensMm")}
          disabled={readOnly}
          onChange={edit("lensMm")}
        />
        <SelectField
          label="Aspect ratio"
          value={c.aspectRatio}
          disabled={readOnly}
          options={CAMERA_ASPECT_RATIOS.map((r) => ({ value: r, label: r }))}
          onChange={edit("aspectRatio")}
        />
      </div>
      <TextField
        label="Composition"
        value={c.composition}
        placeholder="e.g. rule of thirds, entrance on the left third"
        disabled={readOnly}
        onChange={edit("composition")}
      />
      <TextAreaField
        label="Notes"
        value={c.notes}
        disabled={readOnly}
        onChange={(v) => edit("notes")(v)}
      />
      {missing.length > 0 && (
        <span className="field-hint">
          Not set yet: {missing.map((m) => m.label.toLowerCase()).join(", ")}. The prompt describes
          only what is set.
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

  if (!result) return <span className="field-hint">Compiling…</span>;
  if (result.error) return <span className="field-error">{result.error}</span>;
  const b = result.bundle!;
  const cameraSection = b.positivePrompt.split("\n\n").find((p) => p.startsWith("Camera:"));
  return (
    <div
      className={`gen-prompt ${result.key !== key ? "is-stale" : ""}`}
      data-testid="camera-prompt"
    >
      <span className="field-label">
        <Sparkles size={11} /> Camera section
      </span>
      <pre>{cameraSection ?? "(saved camera not found — waiting for autosave)"}</pre>
      <span className="field-label">References</span>
      <pre>{b.referenceInstructions}</pre>
      <span className="field-label">Full positive prompt</span>
      <pre>{b.positivePrompt}</pre>
      <span className="field-hint">
        Compiler {b.compilerVersion} · compiled from saved DNA with the master
        {anchorId ? " and this camera's anchor" : ""}.
      </span>
    </div>
  );
}
