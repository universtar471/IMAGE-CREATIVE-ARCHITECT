import {
  CONTEXT_DIRECTIONS,
  DensitySchema,
  type ContextDNA,
  type ContextPreset,
  type ProjectDNA,
} from "@arch/domain";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { SelectField } from "../../components/panels/fields";
import { DnaSelect, DnaTags, DnaText, DnaTextArea } from "./DnaFields";
import { LockToggle } from "./LockToggle";
import { useT } from "../../i18n";
import { selectReadOnly, useStudio } from "../../app/store";
import { knowledge } from "../../lib/knowledge";
import { ContextPresetCards, ContextPreview } from "../previews/ContextPreview";
import { AssistControl } from "../assist/AssistControl";
import { SiteAdjacencyEditor } from "../site/SiteAdjacencyEditor";
import { ContextLibraryPanel } from "../contextLibrary/ContextLibraryPanel";
import { applyAssistToDraft } from "../../lib/assist";

export function ContextDnaPanel() {
  const t = useT();
  const project = useStudio((state) => state.workspace!.project);
  const projectType = project.projectType;
  const context = useStudio((state) => state.workspace!.draftDna.context as ContextDNA);
  const editDna = useStudio((state) => state.editDna);
  const readOnly = useStudio(selectReadOnly);
  const contextLocked = useStudio((state) => !!state.workspace?.draftDna.locks.context);
  const presets =
    knowledge.resolve(project.projectType, project.subtype).pack?.contextPresets ?? [];
  if (projectType === "interior") return <InteriorContextPanel />;
  const applyContextPreset = (preset: ContextPreset) => {
    const next = { ...context, ...preset.context };
    for (const dir of CONTEXT_DIRECTIONS) {
      if (preset.context[dir]) next[dir] = { ...context[dir], ...preset.context[dir] };
    }
    editDna("context", next);
  };
  const densityOptions = DensitySchema.options.map((d) => ({
    value: d,
    label: t(`labels.density.${d}`),
  }));
  return (
    <>
      <ContextPreview context={context} />
      {presets.length > 0 && (
        <ContextPresetCards
          presets={presets}
          context={context}
          disabled={readOnly || contextLocked}
          onChoose={applyContextPreset}
        />
      )}
      <p className="field-hint dna-hint">{t("dna.englishHint")}</p>
      <SectionPanel title={t("context.setting")} aside={<LockToggle section="context" />}>
        <AssistControl
          scope="context"
          stepId="dna.context"
          projectType={projectType}
          projectId={useStudio.getState().workspace!.project.id}
          dna={useStudio.getState().workspace!.draftDna}
          assets={useStudio.getState().workspace!.assets}
          hasMaster={!!useStudio.getState().workspace!.project.activeMasterAssetId}
          onApply={applyAssistToDraft}
        />
        <DnaText
          path="context.macroContext"
          label={t("context.macro")}
          placeholder={t("context.macroPlaceholder")}
        />
        <DnaText
          path="context.climateContext"
          label={t("context.climate")}
          placeholder={t("context.climatePlaceholder")}
        />
        <DnaSelect path="context.density" label={t("context.density")} options={densityOptions} />
      </SectionPanel>

      <SiteAdjacencyEditor />

      <ContextLibraryPanel />

      {CONTEXT_DIRECTIONS.map((dir) => (
        <SectionPanel
          key={dir}
          title={t(`labels.contextDirection.${dir}`)}
          defaultOpen={dir === "front" || dir === "rear"}
        >
          <div className="field-row">
            <DnaText
              path={`context.${dir}.spaceType`}
              label={t("context.space")}
              placeholder={t("context.spacePlaceholder")}
            />
            <DnaText
              path={`context.${dir}.roadType`}
              label={t("context.road")}
              placeholder={t("context.roadPlaceholder")}
            />
          </div>
          <DnaTags
            path={`context.${dir}.elements`}
            label={t("context.elements")}
            placeholder={t("context.elementsPlaceholder")}
          />
          <DnaTags
            path={`context.${dir}.vegetation`}
            label={t("context.vegetation")}
            placeholder={t("context.vegetationPlaceholder")}
          />
          <DnaTags path={`context.${dir}.adjacentBuildings`} label={t("context.adjacent")} />
          <DnaTextArea path={`context.${dir}.notes`} label={t("context.notes")} />
        </SectionPanel>
      ))}

      <SectionPanel title={t("context.background")} defaultOpen={false}>
        <DnaTags
          path="context.distantBackground"
          label={t("context.distant")}
          placeholder={t("context.distantPlaceholder")}
        />
        <DnaTextArea path="context.atmosphereNotes" label={t("context.atmosphere")} />
      </SectionPanel>

      <SectionPanel title={t("context.negative")}>
        <DnaTags
          path="context.negativeConstraints"
          label={t("context.mustNotAppear")}
          hint={t("context.negativeHint")}
          placeholder={t("context.negativePlaceholder")}
        />
      </SectionPanel>
    </>
  );
}

function InteriorContextPanel() {
  const t = useT();
  const editDna = useStudio((state) => state.editDna);
  const dna = useStudio((state) => state.workspace!.draftDna as ProjectDNA);
  const readOnly = useStudio(selectReadOnly);
  const locked = useStudio((state) => !!state.workspace?.draftDna.locks.context);
  const interior = dna.interior;
  if (!interior) return <span className="field-hint">{t("interior.legacyContextHint")}</span>;
  const disabled = readOnly || locked;
  const context = dna.context as ContextDNA;
  return (
    <>
      <ContextPreview
        context={context}
        projectType="interior"
        daylightDirection={interior.daylightDirection}
      />
      <p className="field-hint dna-hint">{t("dna.englishHint")}</p>
      <SectionPanel title={t("interior.window")}>
        <DnaText path="building.openings.windowType" label={t("interior.windowType")} />
        <div className="field-row">
          <DnaText path="building.openings.frame" label={t("interior.windowFrame")} />
          <DnaText path="building.openings.glazing" label={t("interior.glazing")} />
        </div>
      </SectionPanel>
      <SectionPanel title={t("interior.view")}>
        <DnaText path="context.front.spaceType" label={t("interior.viewType")} />
        <DnaTags path="context.front.elements" label={t("interior.viewElements")} />
        <DnaTextArea path="context.front.notes" label={t("context.notes")} />
      </SectionPanel>
      <SectionPanel title={t("interior.daylight")}>
        <SelectField
          label={t("interior.daylightDirection")}
          value={interior.daylightDirection}
          disabled={disabled}
          options={(["front", "left", "right", "rear", "diffuse", "none"] as const).map(
            (value) => ({
              value,
              label: t(`interior.daylightDirections.${value}`),
            }),
          )}
          onChange={(value) => editDna("interior.daylightDirection", value)}
        />
        <SelectField
          label={t("interior.daylightAmount")}
          value={interior.daylightAmount}
          disabled={disabled}
          options={(["low", "medium", "high"] as const).map((value) => ({
            value,
            label: t(`interior.daylightAmounts.${value}`),
          }))}
          onChange={(value) => editDna("interior.daylightAmount", value)}
        />
      </SectionPanel>
    </>
  );
}
