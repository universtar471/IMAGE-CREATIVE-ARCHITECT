import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import {
  createInitialDNA,
  DEFAULT_SUBTYPE,
  PROJECT_TYPE_LABELS,
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

const STEPS = ["Basics", "Architecture", "Context", "Create"] as const;
const TYPE_OPTIONS = ProjectTypeSchema.options.map((t) => ({
  value: t,
  label: PROJECT_TYPE_LABELS[t],
}));

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
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((prev) => ({ ...prev, [k]: v }));

  const subtypes = knowledge.listSubtypes(d.projectType);
  const { pack, match } = knowledge.resolve(d.projectType, d.subtype);
  const isInterior = d.projectType === "interior";

  const numberError = (v: number | undefined, integer = false) =>
    v === undefined
      ? undefined
      : Number.isNaN(v)
        ? "Enter a valid number."
        : v <= 0
          ? "Must be greater than 0."
          : integer && !Number.isInteger(v)
            ? "Enter a whole number."
            : undefined;
  const archErrors = {
    floors: numberError(d.floors, true),
    widthM: numberError(d.widthM),
    depthM: numberError(d.depthM),
    siteWidthM: numberError(d.siteWidthM),
    siteDepthM: numberError(d.siteDepthM),
  };
  const nameError = d.name.trim() ? undefined : "Give the project a name.";
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
      setError(toBridgeError(err).message);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="New Project"
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
              <ArrowLeft size={14} /> Back
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button
              className="btn btn-primary"
              onClick={() => setStep(step + 1)}
              disabled={!stepValid}
            >
              Next <ArrowRight size={14} />
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => void create()}
              disabled={busy || !!nameError}
            >
              <Check size={14} /> {busy ? "Creating…" : "Create project"}
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
            {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <>
          <TextField
            label="Project name"
            value={d.name}
            error={d.name ? nameError : undefined}
            placeholder="e.g. Villa Tropical Test"
            onChange={(v) => set("name", v ?? "")}
          />
          <SelectField
            label="Project type"
            options={TYPE_OPTIONS}
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
            label="Subtype"
            hint={
              match === "custom_fallback"
                ? "No dedicated knowledge pack yet — generic defaults will be used."
                : pack?.description
            }
            options={
              subtypes.length
                ? subtypes.map((p) => ({ value: p.subtype, label: p.label }))
                : [{ value: DEFAULT_SUBTYPE, label: "Generic" }]
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
            Optional. Leave blank to use the knowledge-pack defaults shown as placeholders.
          </p>
          <TextField
            label="Architectural style"
            value={d.style}
            suggestions={pack?.styleSuggestions}
            placeholder={pack?.defaults.building.architecturalStyle ?? pack?.styleSuggestions[0]}
            onChange={(v) => set("style", v)}
          />
          <div className="field-row">
            <NumberField
              label={isInterior ? "Levels" : "Floors"}
              value={d.floors}
              error={archErrors.floors}
              hint={
                pack?.defaults.building.floors
                  ? `Default: ${pack.defaults.building.floors}`
                  : undefined
              }
              onChange={(v) => set("floors", v)}
            />
            <span />
          </div>
          <div className="field-row">
            <NumberField
              label="Building width"
              suffix="m"
              value={d.widthM}
              error={archErrors.widthM}
              onChange={(v) => set("widthM", v)}
            />
            <NumberField
              label="Building depth"
              suffix="m"
              value={d.depthM}
              error={archErrors.depthM}
              onChange={(v) => set("depthM", v)}
            />
          </div>
          {!isInterior && (
            <div className="field-row">
              <NumberField
                label="Site width"
                suffix="m"
                value={d.siteWidthM}
                error={archErrors.siteWidthM}
                onChange={(v) => set("siteWidthM", v)}
              />
              <NumberField
                label="Site depth"
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
            Pick a starting context for a {PROJECT_TYPE_LABELS[d.projectType].toLowerCase()}. You
            can refine every direction later.
          </p>
          <div className="choice-grid">
            <button
              className="choice"
              aria-pressed={!d.contextPresetId}
              onClick={() => set("contextPresetId", undefined)}
            >
              <strong>Pack defaults only</strong>
              <small>{pack?.defaults.context.macroContext ?? "No context yet"}</small>
            </button>
            {(pack?.contextPresets ?? []).map((preset) => (
              <button
                key={preset.id}
                className="choice"
                aria-pressed={d.contextPresetId === preset.id}
                onClick={() => set("contextPresetId", preset.id)}
              >
                <strong>{preset.label}</strong>
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
              <th>Name</th>
              <td>{d.name.trim()}</td>
            </tr>
            <tr>
              <th>Type</th>
              <td>
                {PROJECT_TYPE_LABELS[d.projectType]} · {pack?.label ?? d.subtype}
              </td>
            </tr>
            {preview ? (
              <>
                <tr>
                  <th>Style</th>
                  <td>{preview.building.architecturalStyle ?? "— (set later)"}</td>
                </tr>
                <tr>
                  <th>{isInterior ? "Levels" : "Floors"}</th>
                  <td>{preview.building.floors ?? "—"}</td>
                </tr>
                <tr>
                  <th>Dimensions</th>
                  <td>{dimText(preview.building.dimensions)}</td>
                </tr>
                <tr>
                  <th>Context</th>
                  <td>
                    {[preview.context.macroContext, preview.context.climateContext]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </td>
                </tr>
                <tr>
                  <th>Front / rear</th>
                  <td>
                    {[preview.context.front.spaceType, preview.context.rear.spaceType]
                      .filter(Boolean)
                      .join(" / ") || "—"}
                  </td>
                </tr>
                <tr>
                  <th>Negative constraints</th>
                  <td>{preview.context.negativeConstraints.join(", ") || "—"}</td>
                </tr>
              </>
            ) : (
              <tr>
                <td colSpan={2} className="field-error">
                  The starting values are not valid. Go back and check the numbers.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}

function dimText(d: {
  widthM?: number;
  depthM?: number;
  siteWidthM?: number;
  siteDepthM?: number;
}) {
  const parts = [];
  if (d.widthM || d.depthM) parts.push(`building ${d.widthM ?? "?"} × ${d.depthM ?? "?"} m`);
  if (d.siteWidthM || d.siteDepthM)
    parts.push(`site ${d.siteWidthM ?? "?"} × ${d.siteDepthM ?? "?"} m`);
  return parts.join(", ") || "—";
}
