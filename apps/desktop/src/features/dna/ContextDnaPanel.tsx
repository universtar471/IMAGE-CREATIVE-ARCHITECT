import { CONTEXT_DIRECTIONS, DensitySchema, type ProjectDNA } from "@arch/domain";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { SelectField } from "../../components/panels/fields";
import { DnaSelect, DnaTags, DnaText, DnaTextArea } from "./DnaFields";
import { LockToggle } from "./LockToggle";
import { useT } from "../../i18n";
import { selectReadOnly, useStudio } from "../../app/store";

export function ContextDnaPanel() {
  const t = useT();
  const projectType = useStudio((state) => state.workspace!.project.projectType);
  if (projectType === "interior") return <InteriorContextPanel />;
  const densityOptions = DensitySchema.options.map((d) => ({
    value: d,
    label: t(`labels.density.${d}`),
  }));
  return (
    <>
      <p className="field-hint dna-hint">{t("dna.englishHint")}</p>
      <SectionPanel title={t("context.setting")} aside={<LockToggle section="context" />}>
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
  return (
    <>
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
