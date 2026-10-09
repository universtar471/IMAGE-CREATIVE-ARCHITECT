import { CONTEXT_DIRECTIONS, DensitySchema } from "@arch/domain";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { DnaSelect, DnaTags, DnaText, DnaTextArea } from "./DnaFields";
import { LockToggle } from "./LockToggle";
import { useT } from "../../i18n";

export function ContextDnaPanel() {
  const t = useT();
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
