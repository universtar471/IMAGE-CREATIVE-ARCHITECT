/**
 * Geometry-only Orbit tab connected to the existing Camera DNA.
 * No render-generation calls are performed from this component.
 */
import { fileUrl } from "../../lib/files";
import { CameraSyncStatus } from "./CameraSyncStatus";
import type { ReactNode } from "react";
import type { CameraDNA } from "@arch/domain";
import { useState } from "react";
import {
  Building2,
  Camera,
  Eye,
  Focus,
  House,
  MoveHorizontal,
  Orbit,
  Plane,
  Plus,
  RotateCcw,
  Sofa,
  type LucideIcon,
} from "lucide-react";
import { blankCamera, resolveActiveSpace, isConfirmed } from "@arch/domain";
import { useStudio, selectReadOnly } from "../../app/store";
import { HelpPopover } from "../../components/common/HelpPopover";
import { useT } from "../../i18n";
import type { en } from "../../i18n/en";
import {
  cameraPresetsFor,
  cameraScopeFromDna,
  normalizeCameraPose,
  samePose,
  type CameraPose,
  type CameraPresetId,
  type CameraScope,
} from "./multiAngleModel";
import { footprintOf } from "./geometry";
import { OrbitViewport } from "./OrbitViewport";
import "./multi-angle.css";

const presetIcons: Record<CameraPresetId, LucideIcon> = {
  front: House,
  front_left: MoveHorizontal,
  front_right: Building2,
  aerial: Plane,
  wide_room: Sofa,
  room_corner: Building2,
  eye_level: Eye,
  detail_focus: Focus,
};

type CameraPoseMetadata = Pick<CameraDNA, "viewType" | "lensMm" | "composition" | "presetId">;

export type MultiAngleStudioProps = {
  scope: CameraScope;
  bounds?: { widthM: number; depthM: number };
  cameraId: string;
  pose: CameraPose;
  metadata: CameraPoseMetadata;
  status?: ReactNode;
  sourcePreview?: ReactNode;
  onCommit: (pose: CameraPose, metadata?: CameraPoseMetadata) => void;
  onAddCamera?: () => void;
  readOnly?: boolean;
};

export function MultiAngleStudio({
  scope,
  bounds,
  pose,
  metadata,
  status,
  sourcePreview,
  onCommit,
  onAddCamera,
  readOnly = false,
}: MultiAngleStudioProps) {
  const translate = useT();
  const t = (key: keyof typeof en.multiAngle) => translate(`multiAngle.${key}`);
  const draft = normalizeCameraPose(pose, scope);
  const [resetPose] = useState(() => draft);
  const [resetMetadata] = useState(() => metadata);
  const commit = (next: CameraPose, nextMetadata?: CameraPoseMetadata) => {
    const normal = normalizeCameraPose(next, scope);
    if (
      !readOnly &&
      (!samePose(normal, pose) ||
        (nextMetadata &&
          Object.keys(nextMetadata).some(
            (k) =>
              nextMetadata[k as keyof CameraPoseMetadata] !==
              metadata[k as keyof CameraPoseMetadata],
          )))
    )
      onCommit(normal, nextMetadata);
  };
  const update = (key: keyof CameraPose, value: number) => commit({ ...draft, [key]: value });
  const presets = cameraPresetsFor(scope);
  const closestPreset = presets.find((p) => samePose(p.pose, draft))?.id;

  return (
    <section
      className="multi-angle-studio"
      aria-label={t("title")}
      data-testid="multi-angle-studio"
      data-camera-scope={scope}
    >
      <header className="multi-angle-head">
        <span className="multi-angle-heading">
          <Orbit size={20} aria-hidden />
          {t("title")}
        </span>
        <div className="multi-angle-actions">
          {onAddCamera && (
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              title={t("newCamera")}
              aria-label={t("newCamera")}
              disabled={readOnly}
              onClick={onAddCamera}
            >
              <Plus size={18} aria-hidden />
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            title={t("reset")}
            aria-label={t("reset")}
            disabled={readOnly}
            onClick={() => commit(resetPose, resetMetadata)}
          >
            <RotateCcw size={18} aria-hidden />
          </button>
          <HelpPopover topic={t("controls")}>{t("controlsHelp")}</HelpPopover>
        </div>
      </header>
      <div className="multi-angle-scope" aria-label={t("source")}>
        {scope === "interior" ? (
          <Sofa size={17} aria-hidden />
        ) : (
          <Building2 size={17} aria-hidden />
        )}
        <span>{scope === "interior" ? t("interior") : t("building")}</span>
        {status}
      </div>
      {sourcePreview}
      <OrbitViewport
        scope={scope}
        bounds={bounds}
        pose={draft}
        disabled={readOnly}
        label={`${t("orbit")}: ${t("azimuth")} ${Number(draft.azimuthDeg.toFixed(2))}°, ${t("elevation")} ${Number(draft.elevationDeg.toFixed(2))}°`}
        onChange={commit}
      />
      <div className="multi-angle-group">
        <div className="multi-angle-group-title">
          <span>{t("preset")}</span>
          <HelpPopover topic={t("preset")}>{t("presetHelp")}</HelpPopover>
        </div>
        <div className="multi-angle-presets" role="group" aria-label={t("preset")}>
          {presets.map((preset) => {
            const Icon = presetIcons[preset.id];
            return (
              <button
                type="button"
                key={preset.id}
                className={`multi-angle-preset${closestPreset === preset.id ? " is-selected" : ""}`}
                title={t(preset.id)}
                aria-label={t(preset.id)}
                aria-pressed={closestPreset === preset.id}
                disabled={readOnly}
                onClick={() =>
                  commit(preset.pose, {
                    viewType:
                      scope === "interior"
                        ? preset.id === "detail_focus"
                          ? "interior_detail"
                          : "interior_wide"
                        : preset.id === "aerial"
                          ? "aerial"
                          : preset.id === "front"
                            ? "exterior_front"
                            : "exterior_corner",
                    lensMm: preset.lensMm ?? metadata.lensMm,
                    composition: undefined,
                    presetId: undefined,
                  })
                }
              >
                <Icon size={21} aria-hidden />
              </button>
            );
          })}
        </div>
      </div>
      <div className="multi-angle-group">
        <div className="multi-angle-group-title">
          <span>{t("camera")}</span>
          <HelpPopover topic={t("distance")}>{t("distanceHelp")}</HelpPopover>
        </div>
        {(
          [
            ["azimuthDeg", t("azimuth"), -180, 180, 0.5, "°"],
            ["elevationDeg", t("elevation"), -75, 75, 0.1, "°"],
            ["distanceM", t("distance"), 0.5, 1000, 0.5, "m"],
          ] as const
        ).map(([key, title, min, max, step, unit]) => (
          <label key={key} className="multi-angle-range">
            <span>{title}</span>
            <output>
              {key === "distanceM" ? draft[key].toFixed(1) : Number(draft[key].toFixed(2))}
              {unit}
            </output>
            <input
              type="range"
              aria-label={title}
              disabled={readOnly}
              min={min}
              max={max}
              step={step}
              value={draft[key]}
              onChange={(e) => update(key, Number(e.target.value))}
              onPointerUp={() => commit(draft)}
              onKeyUp={() => commit(draft)}
              onBlur={() => commit(draft)}
            />
          </label>
        ))}
      </div>
    </section>
  );
}

/** Connects the M1 tool to existing Camera DNA; no new source of truth. */
export function ConnectedMultiAngleStudio() {
  const ws = useStudio((s) => s.workspace!);
  const selectedId = useStudio((s) => s.selectedCameraId);
  const setCameras = useStudio((s) => s.setCameras);
  const selectCamera = useStudio((s) => s.selectCamera);
  const readOnly = useStudio(selectReadOnly);
  const t = useT();
  const addLabel = t("multiAngle.newCamera");
  const scope: CameraScope = cameraScopeFromDna(ws.draftDna);
  const fp = footprintOf(ws.draftDna);
  const space = resolveActiveSpace(ws.draftDna)?.space;
  const dimension = (key: string, fallback: number) => {
    const fact = space?.facts[key];
    return fact &&
      isConfirmed(fact.evidence) &&
      typeof fact.value === "number" &&
      Number.isFinite(fact.value) &&
      fact.value > 0
      ? fact.value
      : fallback;
  };
  const bounds =
    scope === "building" ? fp : { widthM: dimension("widthM", 5), depthM: dimension("depthM", 4) };
  const draft = useStudio((s) => s.generateDraft);
  const selectedAsset = useStudio((s) => s.selectedAssetId);
  const sourceId = draft.referenceAssetIds?.[0] ?? selectedAsset ?? ws.project.activeMasterAssetId;
  const source = ws.assets.find((a) => a.id === sourceId && a.status === "ready");
  const cameras = ws.draftDna.cameras;
  const camera = cameras.find((c) => c.id === selectedId) ?? cameras[0];
  const add = () => {
    if (readOnly) return;
    const newCamera = {
      ...blankCamera(cameras.map((c) => c.name)),
      viewType: scope === "interior" ? ("interior_wide" as const) : ("exterior_front" as const),
      ...normalizeCameraPose({}, scope),
    };
    setCameras([...cameras, newCamera]);
    selectCamera(newCamera.id);
  };
  if (!camera) {
    return (
      <div className="multi-angle-empty">
        <Camera size={23} aria-hidden />
        <button
          type="button"
          className="btn btn-icon"
          aria-label={addLabel}
          title={addLabel}
          disabled={readOnly}
          onClick={add}
        >
          <Plus size={15} aria-hidden />
        </button>
      </div>
    );
  }
  const pose = normalizeCameraPose(
    {
      azimuthDeg: camera.azimuthDeg,
      elevationDeg: camera.elevationDeg,
      distanceM: camera.distanceM,
    },
    scope,
  );
  return (
    <MultiAngleStudio
      key={`${camera.id}:${scope}`}
      scope={scope}
      bounds={bounds}
      cameraId={camera.id}
      pose={pose}
      metadata={{
        viewType: camera.viewType,
        lensMm: camera.lensMm,
        composition: camera.composition,
        presetId: camera.presetId,
      }}
      sourcePreview={
        source && (
          <figure className="multi-angle-source">
            <img
              src={fileUrl(source.absolutePath) ?? undefined}
              alt={source.originalName ?? source.id}
            />
            <figcaption>{t("generate.source")}</figcaption>
          </figure>
        )
      }
      status={<CameraSyncStatus />}
      readOnly={readOnly}
      onAddCamera={add}
      onCommit={(next, nextMetadata) =>
        setCameras(
          useStudio.getState().workspace!.draftDna.cameras.map((c) =>
            c.id === camera.id
              ? {
                  ...c,
                  ...nextMetadata,
                  azimuthDeg: next.azimuthDeg,
                  elevationDeg: next.elevationDeg,
                  distanceM: next.distanceM,
                }
              : c,
          ),
        )
      }
    />
  );
}
