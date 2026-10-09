import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import {
  createInitialDNA,
  DEFAULT_SUBTYPE,
  ProjectTypeSchema,
  type ProjectDTO,
  type ProjectType,
  type WizardStarter,
} from "@arch/domain";
import { createProject } from "../../app/services";
import { Dialog } from "../../components/common/Dialog";
import { NumberField, SelectField, TextField } from "../../components/panels/fields";
import { toBridgeError } from "../../lib/bridge";
import { knowledge } from "../../lib/knowledge";
import { useT, type TFunction } from "../../i18n";
import { translateDomainMessage } from "../../i18n/domain";
import { contextPresetLabel, packDescription, packLabel, styleLabel } from "../../i18n/knowledge";

const STEPS = ["stepBasics", "stepArchitecture", "stepContext", "stepCreate"] as const;

type Draft = {
  name: string;
  projectType: ProjectType;
  subtype: string;
  style?: string;
  floors?: number;
  widthM?: number;
  depthM?: number;
  siteWidthM?: number;
  siteDepthM?: number;
  contextPresetId?: string;
};

/** Short wizard: nothing beyond a name is mandatory; everything is editable later. */
export function NewProjectWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (p: ProjectDTO) => void;
}) {
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>({ name: "", projectType: "villa", subtype: DEFAULT_SUBTYPE });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useT();
  const typeOptions = ProjectTypeSchema.options.map((type) => ({
    value: type,
    label: t(`labels.projectType.${type}`),
  }));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((prev) => ({ ...prev, [k]: v }));

  const subtypes = knowledge.listSubtypes(d.projectType);
  const { pack, match } = knowledge.resolve(d.projectType, d.subtype);
  const isInterior = d.projectType === "interior";

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
  const stepValid =
    step === 0 ? !nameError : step === 1 ? Object.values(archErrors).every((e) => !e) : true;

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
    if (step !== 3) return null;
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
      });
      onCreated(project);
    } catch (err) {
      setError(translateDomainMessage(toBridgeError(err).message, t));
      setBusy(false);
    }
  };

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
          {step < STEPS.length - 1 ? (
            <button
              className="btn btn-primary"
              onClick={() => setStep(step + 1)}
              disabled={!stepValid}
            >
              {t("wizard.next")} <ArrowRight size={14} />
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => void create()}
              disabled={busy || !!nameError}
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
          <SelectField
            label={t("wizard.type")}
            options={typeOptions}
            allowEmpty={false}
            value={d.projectType}
            onChange={(v) =>
              setD((prev) => ({
                ...prev,
                projectType: v ?? "custom",
                subtype: DEFAULT_SUBTYPE,
                contextPresetId: undefined,
              }))
            }
          />
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
        </>
      )}

      {step === 1 && (
        <>
          <p className="field-hint" style={{ margin: 0 }}>
            {t("wizard.optional")} {t("dna.englishHint")}
          </p>
          <TextField
            label={t("wizard.style")}
            value={d.style}
            suggestions={pack?.styleSuggestions}
            suggestionLabel={styleLabel}
            placeholder={pack?.defaults.building.architecturalStyle ?? pack?.styleSuggestions[0]}
            onChange={(v) => set("style", v)}
          />
          <div className="field-row">
            <NumberField
              label={isInterior ? t("wizard.levels") : t("wizard.floors")}
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
          {!isInterior && (
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
          )}
        </>
      )}

      {step === 2 && (
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
      )}

      {step === 3 && (
        <table className="summary-table">
          <tbody>
            <tr>
              <th>{t("wizard.sumName")}</th>
              <td>{d.name.trim()}</td>
            </tr>
            <tr>
              <th>{t("wizard.sumType")}</th>
              <td>
                {t(`labels.projectType.${d.projectType}`)} · {pack ? packLabel(pack) : d.subtype}
              </td>
            </tr>
            {preview ? (
              <>
                <tr>
                  <th>{t("wizard.sumStyle")}</th>
                  <td>{preview.building.architecturalStyle ?? t("wizard.setLater")}</td>
                </tr>
                <tr>
                  <th>{isInterior ? t("wizard.levels") : t("wizard.floors")}</th>
                  <td>{preview.building.floors ?? "—"}</td>
                </tr>
                <tr>
                  <th>{t("wizard.sumDimensions")}</th>
                  <td>{dimText(preview.building.dimensions, t)}</td>
                </tr>
                <tr>
                  <th>{t("wizard.sumContext")}</th>
                  <td>
                    {[preview.context.macroContext, preview.context.climateContext]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </td>
                </tr>
                <tr>
                  <th>{t("wizard.sumFrontRear")}</th>
                  <td>
                    {[preview.context.front.spaceType, preview.context.rear.spaceType]
                      .filter(Boolean)
                      .join(" / ") || "—"}
                  </td>
                </tr>
                <tr>
                  <th>{t("wizard.sumNegative")}</th>
                  <td>{preview.context.negativeConstraints.join(", ") || "—"}</td>
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
      )}
    </Dialog>
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
