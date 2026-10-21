import {
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Sparkles,
  Wand2,
  Box,
  Palette,
  Trees,
  Camera,
  Expand,
} from "lucide-react";
import { HelpPopover } from "../../components/common/HelpPopover";
import { useEffect, useState } from "react";
import type { EnhanceCheck } from "@arch/domain";
import { FieldGroup } from "../../components/panels/fields";
import { useT } from "../../i18n";
import { call } from "../../lib/bridge";
import type { RegionDTO } from "@arch/domain";
import {
  IF_ALREADY_LARGER,
  LOCK_KEYS,
  PRESERVATION_MODES,
  SIZE_TARGET_KINDS,
  sizeTargetKind,
  withSizeTarget,
  type EnhanceParams,
  type IfAlreadyLarger,
  type PreservationMode,
  type SizeTargetKind,
  type UpscaleSize,
  type UpscaleTarget,
} from "./enhance";

type T = ReturnType<typeof useT>;

const modeLabel = (t: T, mode: PreservationMode) =>
  t(`enhance.${mode}Mode` as "enhance.strictMode");
const modeHint = (t: T, mode: PreservationMode) => t(`enhance.${mode}Hint` as "enhance.strictHint");
const lockLabel = (t: T, lock: (typeof LOCK_KEYS)[number]) =>
  t(`enhance.lock${lock[0]!.toUpperCase()}${lock.slice(1)}` as "enhance.lockGeometry");
const sizeLabel = (t: T, kind: SizeTargetKind) =>
  t(`enhance.size_${kind}` as "enhance.size_custom");
const ifLargerLabel = (t: T, choice: IfAlreadyLarger) =>
  t(`enhance.ifLarger_${choice}` as "enhance.ifLarger_keep");

/** "Giữ nguyên chi tiết" / "Nâng cấp thông minh" / "Nâng cấp mạnh" (ADR-035). */
export function PreservationModeSelector({
  value,
  onChange,
}: {
  value: PreservationMode;
  onChange: (mode: PreservationMode) => void;
}) {
  const t = useT();
  return (
    <>
      <div className="segmented enhance-segmented" role="group" aria-label={t("enhance.mode")}>
        {PRESERVATION_MODES.map((mode) => {
          const Icon = mode === "strict" ? ShieldCheck : mode === "balanced" ? Sparkles : Wand2;
          return (
            <button
              key={mode}
              type="button"
              aria-pressed={value === mode}
              title={modeHint(t, mode)}
              aria-label={modeLabel(t, mode)}
              data-testid={`enhance-mode-${mode}`}
              onClick={() => onChange(mode)}
            >
              <Icon size={23} aria-hidden="true" />
              {t(`enhance.${mode}Short`)}
            </button>
          );
        })}
      </div>
      <HelpPopover topic={t("enhance.mode")}>{modeHint(t, value)}</HelpPopover>
    </>
  );
}

/** Geometry / material / context / camera locks; strict mode shows them all locked. */
export function LockToggles({
  params,
  onChange,
}: {
  params: EnhanceParams;
  onChange: (params: EnhanceParams) => void;
}) {
  const t = useT();
  const strict = params.preservationMode === "strict";
  return (
    <FieldGroup
      label={t("enhance.locks")}
      hint={strict ? t("enhance.strictLocked") : t("enhance.locksHint")}
    >
      <div className="field-row">
        {LOCK_KEYS.map((lock) => {
          const Icon = { geometry: Box, material: Palette, context: Trees, camera: Camera }[lock];
          return (
            <label key={lock} className="toggle-row">
              <input
                type="checkbox"
                disabled={strict}
                data-testid={`enhance-lock-${lock}`}
                checked={strict || (params.locks?.[lock] ?? true)}
                onChange={(event) =>
                  onChange({
                    ...params,
                    locks: {
                      geometry: true,
                      material: true,
                      context: true,
                      camera: true,
                      ...params.locks,
                      [lock]: event.target.checked,
                    },
                  })
                }
              />{" "}
              <Icon size={16} aria-hidden="true" />
              {lockLabel(t, lock)}
            </label>
          );
        })}
      </div>
    </FieldGroup>
  );
}

const DEFAULT_CUSTOM: UpscaleTarget = { width: 3000, height: 2000, fit: "contain" };

/** 2K / 4K / UHD (contain) / Custom, plus what to do with a source that is already larger. */
export function SizeTargetSelector({
  params,
  onChange,
  allowKeepSize,
  size,
}: {
  params: EnhanceParams;
  onChange: (params: EnhanceParams) => void;
  /** Generative modes may keep the source size (no size target). */
  allowKeepSize: boolean;
  /** The resolved size for the current source, if known. */
  size?: UpscaleSize | null;
}) {
  const t = useT();
  const target = params.upscale?.target ?? null;
  const kind = target === null ? null : sizeTargetKind(target);
  const custom = typeof target === "object" && target !== null ? target : null;
  const setCustom = (key: "width" | "height", value: number) => {
    const base = custom ?? (DEFAULT_CUSTOM as Exclude<UpscaleTarget, string>);
    const next = Math.min(8192, Math.max(1, Math.round(value) || 1));
    onChange(withSizeTarget(params, { ...base, [key]: next }));
  };
  return (
    <FieldGroup label={t("enhance.sizeTarget")} hint={t("enhance.sizeTargetHint")}>
      <div
        className="segmented enhance-segmented"
        role="group"
        aria-label={t("enhance.sizeTarget")}
      >
        {allowKeepSize && (
          <button
            type="button"
            aria-pressed={kind === null}
            onClick={() => onChange(withSizeTarget(params, null))}
          >
            {t("enhance.keepSize")}
          </button>
        )}
        {SIZE_TARGET_KINDS.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={kind === item}
            data-testid={`enhance-size-${item}`}
            onClick={() =>
              onChange(
                withSizeTarget(params, item === "custom" ? (custom ?? DEFAULT_CUSTOM) : item),
              )
            }
          >
            <Expand size={18} aria-hidden="true" />
            {sizeLabel(t, item)}
          </button>
        ))}
      </div>
      {custom && (
        <div className="field-row">
          <label className="field-label enhance-field">
            {t("enhance.customWidth")}
            <input
              type="number"
              min={1}
              max={8192}
              value={custom.width}
              onChange={(event) => setCustom("width", Number(event.target.value))}
            />
          </label>
          <label className="field-label enhance-field">
            {t("enhance.customHeight")}
            <input
              type="number"
              min={1}
              max={8192}
              value={custom.height}
              onChange={(event) => setCustom("height", Number(event.target.value))}
            />
          </label>
        </div>
      )}
      {target !== null && (
        <label className="field-label enhance-field">
          {t("enhance.ifLarger")}
          <select
            value={params.upscale?.ifAlreadyLarger ?? "keep"}
            data-testid="enhance-if-larger"
            onChange={(event) =>
              onChange(withSizeTarget(params, target, event.target.value as IfAlreadyLarger))
            }
          >
            {IF_ALREADY_LARGER.map((choice) => (
              <option key={choice} value={choice}>
                {ifLargerLabel(t, choice)}
              </option>
            ))}
          </select>
        </label>
      )}
      {size && <SizeSummary size={size} />}
    </FieldGroup>
  );
}

function SizeSummary({ size }: { size: UpscaleSize }) {
  const t = useT();
  if (size.action === "skip")
    return (
      <span className="field-hint" role="status" data-testid="enhance-size-summary">
        {t("enhance.sizeSkipped")}
      </span>
    );
  if (size.action !== "upscale")
    return (
      <span className="field-hint" data-testid="enhance-size-summary">
        {t("enhance.sizeAlreadyLarger", { action: ifLargerLabel(t, size.action) })}
      </span>
    );
  return (
    <span className="field-hint" data-testid="enhance-size-summary">
      {size.letterbox
        ? t("enhance.sizeLetterbox", {
            width: size.width,
            height: size.height,
            canvasWidth: size.canvasWidth,
            canvasHeight: size.canvasHeight,
          })
        : t("enhance.sizeResult", { width: size.width, height: size.height })}
    </span>
  );
}

/** Regions of the source the AI may edit (balanced/creative). None = the whole frame. */
export function AllowedRegionPicker({
  projectId,
  assetId,
  params,
  onChange,
}: {
  projectId: string;
  assetId: string;
  params: EnhanceParams;
  onChange: (params: EnhanceParams) => void;
}) {
  const t = useT();
  const [regions, setRegions] = useState<RegionDTO[]>([]);
  useEffect(() => {
    let live = true;
    call("region_list", { projectId, assetId })
      .then((list) => {
        if (live) setRegions(list);
      })
      .catch(() => {
        if (live) setRegions([]);
      });
    return () => {
      live = false;
    };
  }, [projectId, assetId]);
  const selected = (params.allowedRegionIds ?? []).filter((id) =>
    regions.some((region) => region.id === id),
  );
  const toggle = (id: string, on: boolean) => {
    const next = on ? [...selected, id] : selected.filter((item) => item !== id);
    const updated = { ...params, allowedRegionIds: next.length ? next : undefined };
    if (!next.length) delete updated.allowedRegionIds;
    onChange(updated);
  };
  return (
    <FieldGroup label={t("enhance.allowedRegions")} hint={t("enhance.allowedRegionsHint")}>
      {regions.length === 0 ? (
        <span className="field-hint">{t("enhance.noRegions")}</span>
      ) : (
        <div className="field-row">
          {regions.map((region) => (
            <label key={region.id} className="toggle-row">
              <input
                type="checkbox"
                checked={selected.includes(region.id)}
                onChange={(event) => toggle(region.id, event.target.checked)}
              />{" "}
              {region.label}
            </label>
          ))}
        </div>
      )}
    </FieldGroup>
  );
}

/** "Đạt kiểm tra" / "Cần xem lại" with the reasons of the local check (ADR-035). */
export function EnhanceCheckBadge({ check }: { check: EnhanceCheck }) {
  const t = useT();
  const pass = check.status === "pass";
  return (
    <div className="enhance-check" data-testid="enhance-check" role="status">
      <span className={`badge ${pass ? "badge-success" : "badge-warning"}`}>
        {pass ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}{" "}
        {pass ? t("enhance.checkPass") : t("enhance.checkWarn")}
      </span>
      {check.reasons.length > 0 && (
        <ul aria-label={t("enhance.checkReasons")}>
          {check.reasons.map((reason) => (
            <li key={reason}>
              {t(`enhance.checkReason.${reason}` as "enhance.checkReason.size_mismatch")}
            </li>
          ))}
        </ul>
      )}
      <span className="field-hint">
        {check.lockedSsim !== null &&
          t("enhance.checkSsim", { value: check.lockedSsim.toFixed(3) })}
        {check.lockedSsim !== null && " · "}
        {t("enhance.checkShift", { value: check.registration.shiftPx })}
      </span>
      <span className="field-hint">{t("enhance.checkNote")}</span>
    </div>
  );
}
