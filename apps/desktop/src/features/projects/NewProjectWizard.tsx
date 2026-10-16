import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Building2, Check, Sofa } from "lucide-react";
import {
  createInitialDNA,
  DEFAULT_SUBTYPE,
  type ProjectDTO,
  type ProjectType,
  type WizardStarter,
} from "@arch/domain";
import { createProject } from "../../app/services";
import { Dialog } from "../../components/common/Dialog";
import { NumberField, SelectField, TextField } from "../../components/panels/fields";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { toBridgeError } from "../../lib/bridge";
import { knowledge } from "../../lib/knowledge";
import { useT, type TFunction } from "../../i18n";
import { translateDomainMessage } from "../../i18n/domain";
import { contextPresetLabel, packDescription, packLabel, styleLabel } from "../../i18n/knowledge";
import {
  BUILDING_USES,
  INTERIOR_STYLES,
  ROOMS,
  applyStyleDefaults,
  catalogLabel,
  defaultInteriorDNA,
  roomsForUse,
  type BuildingUseId,
  type InteriorStyleId,
  type RoomId,
} from "../../lib/interior";
import { useLocale } from "../../i18n";

const STEPS = ["stepBasics", "stepClassify"] as const;

export type WizardTheme = "architecture" | "interior";

/** Building types the wizard offers for "Công trình" (ADR-034 amendment 2, ADR-039). */
export const ARCHITECTURE_TYPES = [
  "townhouse",
  "single_storey_house",
  "villa",
  "urban_villa",
  "prefab_modular",
  "hotel",
  "resort",
  "custom",
] as const satisfies readonly ProjectType[];

type Classification = {
  projectType: ProjectType;
  subtype: string;
  style?: string;
  floors?: number;
  widthM?: number;
  depthM?: number;
  siteWidthM?: number;
  siteDepthM?: number;
  contextPresetId?: string;
  buildingUseId: BuildingUseId;
  roomId: RoomId;
  interiorStyleId: InteriorStyleId;
};

type Draft = Classification & { name: string; theme?: WizardTheme };

/** Step-2 values a theme starts from; picking a theme resets step 2 to these. */
function themeDefaults(theme: WizardTheme): Classification {
  return {
    projectType: theme === "interior" ? "interior" : "villa",
    subtype: DEFAULT_SUBTYPE,
    style: undefined,
    floors: undefined,
    widthM: undefined,
    depthM: undefined,
    siteWidthM: undefined,
    siteDepthM: undefined,
    contextPresetId: undefined,
    buildingUseId: "apartment",
    roomId: "living_room",
    interiorStyleId: "japandi",
  };
}

/** Short wizard (ADR-039): name and theme, then the theme's classification; create from step 2. */
export function NewProjectWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (p: ProjectDTO) => void;
}) {
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>({ name: "", ...themeDefaults("architecture") });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useT();
  const locale = useLocale((state) => state.locale);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((prev) => ({ ...prev, [k]: v }));
  const pickTheme = (theme: WizardTheme) =>
    setD((prev) => ({ ...prev, ...themeDefaults(theme), theme }));

  const subtypes = knowledge.listSubtypes(d.projectType);
  const { pack, match } = knowledge.resolve(d.projectType, d.subtype);
  const isInterior = d.theme === "interior";

  const numberError = (v: number | undefined, integer = false) =>
    v === undefined
      ? undefined
      : Number.isNaN(v)
        ? t("validation.validNumber")
        : v <= 0
          ? t("validation.greaterThan", { min: 0 })
          : integer && !Number.isInteger(v)
            ? t("validation.wholeNumber")
            : undefined;
  const archErrors = {
    floors: numberError(d.floors, true),
    widthM: numberError(d.widthM),
    depthM: numberError(d.depthM),
    siteWidthM: numberError(d.siteWidthM),
    siteDepthM: numberError(d.siteDepthM),
  };
  const nameError = d.name.trim() ? undefined : t("wizard.nameRequired");
  const basicsValid = !nameError && !!d.theme;
  const interiorStepValid =
    BUILDING_USES.some(({ id }) => id === d.buildingUseId) &&
    roomsForUse(d.buildingUseId).includes(d.roomId) &&
    INTERIOR_STYLES.some(({ id }) => id === d.interiorStyleId);
  const classifyValid = isInterior ? interiorStepValid : Object.values(archErrors).every((e) => !e);

  const starter: WizardStarter = useMemo(
    () => ({
      architecturalStyle: d.style,
      floors: d.floors,
      dimensions: {
        widthM: d.widthM,
        depthM: d.depthM,
        siteWidthM: d.siteWidthM,
        siteDepthM: d.siteDepthM,
      },
      contextPresetId: d.contextPresetId,
    }),
    [d],
  );

  const preview = useMemo(() => {
    if (step !== 1) return null;
    try {
      return createInitialDNA({ projectType: d.projectType, subtype: d.subtype, pack, starter });
    } catch {
      return null;
    }
  }, [step, d.projectType, d.subtype, pack, starter]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const project = await createProject({
        name: d.name.trim(),
        projectType: d.projectType,
        subtype: d.subtype === DEFAULT_SUBTYPE ? null : d.subtype,
        starter,
        interior:
          d.projectType === "interior"
            ? applyStyleDefaults(
                defaultInteriorDNA(d.buildingUseId, d.roomId, d.interiorStyleId),
                d.interiorStyleId,
              )
            : undefined,
      });
      onCreated(project);
    } catch (err) {
      setError(translateDomainMessage(toBridgeError(err).message, t));
      setBusy(false);
    }
  };

  const contextPicker = (
    <>
      <p className="field-hint" style={{ margin: 0 }}>
        {t("wizard.pickContext", {
          type: t(`labels.projectType.${d.projectType}`).toLowerCase(),
        })}
      </p>
      <div className="choice-grid">
        <button
          className="choice"
          aria-pressed={!d.contextPresetId}
          onClick={() => set("contextPresetId", undefined)}
        >
          <strong>{t("wizard.packDefaults")}</strong>
          <small>{pack?.defaults.context.macroContext ?? t("wizard.noContext")}</small>
        </button>
        {(pack?.contextPresets ?? []).map((preset) => (
          <button
            key={preset.id}
            className="choice"
            aria-pressed={d.contextPresetId === preset.id}
            onClick={() => set("contextPresetId", preset.id)}
          >
            <strong>{pack ? contextPresetLabel(pack, preset) : preset.label}</strong>
            <small>
              {[
                preset.context.front?.spaceType,
                preset.context.rear?.spaceType,
                ...(preset.context.distantBackground ?? []),
              ]
                .filter(Boolean)
                .join(" · ") || "—"}
            </small>
          </button>
        ))}
      </div>
    </>
  );

  return (
    <Dialog
      title={t("wizard.title")}
      onClose={onClose}
      footer={
        <>
          {error && (
            <span className="field-error" style={{ flex: 1 }}>
              {error}
            </span>
          )}
          {!error && <span className="spacer" />}
          {step > 0 && (
            <button className="btn" onClick={() => setStep(step - 1)} disabled={busy}>
              <ArrowLeft size={14} /> {t("wizard.back")}
            </button>
          )}
          {step === 0 ? (
            <button className="btn btn-primary" onClick={() => setStep(1)} disabled={!basicsValid}>
              {t("wizard.next")} <ArrowRight size={14} />
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => void create()}
              disabled={busy || !basicsValid || !classifyValid}
            >
              <Check size={14} /> {busy ? t("wizard.creating") : t("wizard.create")}
            </button>
          )}
        </>
      }
    >
      <ol className="steps" style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={`step ${i === step ? "is-active" : ""} ${i < step ? "is-done" : ""}`}
          >
            <span className="step-dot">{i < step ? <Check size={12} /> : i + 1}</span>
            {t(`wizard.${s}`)}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <>
          <TextField
            label={t("wizard.name")}
            value={d.name}
            error={d.name ? nameError : undefined}
            placeholder={t("wizard.namePlaceholder")}
            onChange={(v) => set("name", v ?? "")}
          />
          <CardGroup legend={t("wizard.theme")} className="theme-grid">
            <RadioCard
              name="wizard-theme"
              checked={d.theme === "architecture"}
              onSelect={() => pickTheme("architecture")}
              icon={<Building2 size={28} />}
              label={t("wizard.themeArchitecture")}
              description={t("wizard.themeArchitectureHint")}
            />
            <RadioCard
              name="wizard-theme"
              checked={d.theme === "interior"}
              onSelect={() => pickTheme("interior")}
              icon={<Sofa size={28} />}
              label={t("wizard.themeInterior")}
              description={t("wizard.themeInteriorHint")}
            />
          </CardGroup>
        </>
      )}

      {step === 1 && (
        <>
          {isInterior ? (
            <>
              <SelectField
                label={t("interior.buildingUse")}
                allowEmpty={false}
                value={d.buildingUseId}
                options={BUILDING_USES.map((item) => ({ value: item.id, label: item[locale] }))}
                onChange={(value) => {
                  if (!value) return;
                  const rooms = roomsForUse(value);
                  setD((previous) => ({
                    ...previous,
                    buildingUseId: value,
                    roomId: rooms.includes(previous.roomId)
                      ? previous.roomId
                      : rooms.includes("other")
                        ? "other"
                        : rooms[0]!,
                  }));
                }}
              />
              <SelectField
                label={t("interior.room")}
                allowEmpty={false}
                value={d.roomId}
                options={roomsForUse(d.buildingUseId).map((id) => ({
                  value: id,
                  label: catalogLabel(ROOMS, id, locale),
                }))}
                onChange={(value) => value && set("roomId", value)}
              />
              <SelectField
                label={t("interior.style")}
                allowEmpty={false}
                value={d.interiorStyleId}
                options={INTERIOR_STYLES.map((item) => ({ value: item.id, label: item[locale] }))}
                onChange={(value) => value && set("interiorStyleId", value)}
              />
              <SectionPanel title={t("wizard.paramsSection")} defaultOpen={false}>
                {contextPicker}
              </SectionPanel>
            </>
          ) : (
            <>
              <CardGroup legend={t("wizard.type")} className="choice-grid">
                {ARCHITECTURE_TYPES.map((type) => (
                  <RadioCard
                    key={type}
                    name="wizard-project-type"
                    checked={d.projectType === type}
                    onSelect={() =>
                      setD((prev) => ({
                        ...prev,
                        projectType: type,
                        subtype: DEFAULT_SUBTYPE,
                        contextPresetId: undefined,
                      }))
                    }
                    label={
                      type === "custom" ? t("wizard.typeOther") : t(`labels.projectType.${type}`)
                    }
                  />
                ))}
              </CardGroup>
              <SelectField
                label={t("wizard.subtype")}
                hint={
                  match === "custom_fallback"
                    ? t("wizard.noPack")
                    : pack
                      ? packDescription(pack)
                      : undefined
                }
                options={
                  subtypes.length
                    ? subtypes.map((p) => ({ value: p.subtype, label: packLabel(p) }))
                    : [{ value: DEFAULT_SUBTYPE, label: t("wizard.generic") }]
                }
                allowEmpty={false}
                value={d.subtype}
                onChange={(v) =>
                  setD((prev) => ({
                    ...prev,
                    subtype: v ?? DEFAULT_SUBTYPE,
                    contextPresetId: undefined,
                  }))
                }
              />
              <TextField
                label={t("wizard.style")}
                value={d.style}
                suggestions={pack?.styleSuggestions}
                suggestionLabel={styleLabel}
                placeholder={
                  pack?.defaults.building.architecturalStyle ?? pack?.styleSuggestions[0]
                }
                onChange={(v) => set("style", v)}
              />
              <SectionPanel title={t("wizard.paramsSection")} defaultOpen={false}>
                <p className="field-hint" style={{ margin: 0 }}>
                  {t("wizard.optional")} {t("dna.englishHint")}
                </p>
                <div className="field-row">
                  <NumberField
                    label={t("wizard.floors")}
                    value={d.floors}
                    error={archErrors.floors}
                    hint={
                      pack?.defaults.building.floors
                        ? t("wizard.defaultValue", { value: pack.defaults.building.floors })
                        : undefined
                    }
                    onChange={(v) => set("floors", v)}
                  />
                  <span />
                </div>
                <div className="field-row">
                  <NumberField
                    label={t("wizard.buildingWidth")}
                    suffix="m"
                    value={d.widthM}
                    error={archErrors.widthM}
                    onChange={(v) => set("widthM", v)}
                  />
                  <NumberField
                    label={t("wizard.buildingDepth")}
                    suffix="m"
                    value={d.depthM}
                    error={archErrors.depthM}
                    onChange={(v) => set("depthM", v)}
                  />
                </div>
                <div className="field-row">
                  <NumberField
                    label={t("wizard.siteWidth")}
                    suffix="m"
                    value={d.siteWidthM}
                    error={archErrors.siteWidthM}
                    onChange={(v) => set("siteWidthM", v)}
                  />
                  <NumberField
                    label={t("wizard.siteDepth")}
                    suffix="m"
                    value={d.siteDepthM}
                    error={archErrors.siteDepthM}
                    onChange={(v) => set("siteDepthM", v)}
                  />
                </div>
                {contextPicker}
              </SectionPanel>
            </>
          )}

          <table className="summary-table wizard-summary" aria-label={t("wizard.summary")}>
            <tbody>
              <tr>
                <th>{t("wizard.sumType")}</th>
                <td>
                  {t(`labels.projectType.${d.projectType}`)} · {pack ? packLabel(pack) : d.subtype}
                </td>
              </tr>
              {preview ? (
                <>
                  {isInterior ? (
                    <tr>
                      <th>{t("interior.space")}</th>
                      <td>
                        {catalogLabel(BUILDING_USES, d.buildingUseId, locale)} ·{" "}
                        {catalogLabel(ROOMS, d.roomId, locale)} ·{" "}
                        {catalogLabel(INTERIOR_STYLES, d.interiorStyleId, locale)}
                      </td>
                    </tr>
                  ) : (
                    <>
                      <tr>
                        <th>{t("wizard.sumStyle")}</th>
                        <td>{preview.building.architecturalStyle ?? t("wizard.setLater")}</td>
                      </tr>
                      <tr>
                        <th>{t("wizard.floors")}</th>
                        <td>{preview.building.floors ?? "—"}</td>
                      </tr>
                      <tr>
                        <th>{t("wizard.sumDimensions")}</th>
                        <td>{dimText(preview.building.dimensions, t)}</td>
                      </tr>
                    </>
                  )}
                  <tr>
                    <th>{t("wizard.sumContext")}</th>
                    <td>
                      {[preview.context.macroContext, preview.context.climateContext]
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </td>
                  </tr>
                </>
              ) : (
                <tr>
                  <td colSpan={2} className="field-error">
                    {t("wizard.invalidStart")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </Dialog>
  );
}

/** A labelled group of radio cards (native radios: arrow keys move, Space selects). */
function CardGroup({
  legend,
  className,
  children,
}: {
  legend: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="card-group" role="radiogroup" aria-label={legend}>
      <legend className="field-label">{legend}</legend>
      <div className={className}>{children}</div>
    </fieldset>
  );
}

function RadioCard({
  name,
  checked,
  onSelect,
  icon,
  label,
  description,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  icon?: ReactNode;
  label: string;
  description?: string;
}) {
  return (
    <label className={`choice radio-card ${checked ? "is-selected" : ""}`}>
      <input
        type="radio"
        className="choice-radio"
        name={name}
        checked={checked}
        onChange={onSelect}
      />
      {icon && <span className="radio-card-icon">{icon}</span>}
      <strong>{label}</strong>
      {description && <small>{description}</small>}
    </label>
  );
}

function dimText(
  d: {
    widthM?: number;
    depthM?: number;
    siteWidthM?: number;
    siteDepthM?: number;
  },
  t: TFunction,
) {
  const parts = [];
  if (d.widthM || d.depthM)
    parts.push(t("wizard.dimBuilding", { w: d.widthM ?? "?", d: d.depthM ?? "?" }));
  if (d.siteWidthM || d.siteDepthM)
    parts.push(t("wizard.dimSite", { w: d.siteWidthM ?? "?", d: d.siteDepthM ?? "?" }));
  return parts.join(", ") || "—";
}
