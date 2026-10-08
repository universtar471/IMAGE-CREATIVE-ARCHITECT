import {
  CONTEXT_DIRECTIONS,
  DENSITY_LABELS,
  DensitySchema,
  type ContextDirection,
} from "@arch/domain";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { DnaSelect, DnaTags, DnaText, DnaTextArea } from "./DnaFields";
import { LockToggle } from "./LockToggle";

const DIRECTION_TITLES: Record<ContextDirection, string> = {
  front: "Front",
  rear: "Rear",
  left: "Left side",
  right: "Right side",
};

const DENSITY_OPTIONS = DensitySchema.options.map((d) => ({ value: d, label: DENSITY_LABELS[d] }));

export function ContextDnaPanel() {
  return (
    <>
      <SectionPanel title="Setting" aside={<LockToggle section="context" />}>
        <DnaText
          path="context.macroContext"
          label="Macro context"
          placeholder="e.g. new urban residential area"
        />
        <DnaText
          path="context.climateContext"
          label="Climate"
          placeholder="e.g. tropical monsoon"
        />
        <DnaSelect path="context.density" label="Density" options={DENSITY_OPTIONS} />
      </SectionPanel>

      {CONTEXT_DIRECTIONS.map((dir) => (
        <SectionPanel
          key={dir}
          title={DIRECTION_TITLES[dir]}
          defaultOpen={dir === "front" || dir === "rear"}
        >
          <div className="field-row">
            <DnaText path={`context.${dir}.spaceType`} label="Space" placeholder="e.g. garden" />
            <DnaText path={`context.${dir}.roadType`} label="Road" placeholder="e.g. alley" />
          </div>
          <DnaTags
            path={`context.${dir}.elements`}
            label="Elements"
            placeholder="e.g. gate, lamp posts"
          />
          <DnaTags path={`context.${dir}.vegetation`} label="Vegetation" placeholder="e.g. palms" />
          <DnaTags path={`context.${dir}.adjacentBuildings`} label="Adjacent buildings" />
          <DnaTextArea path={`context.${dir}.notes`} label="Notes" />
        </SectionPanel>
      ))}

      <SectionPanel title="Background & atmosphere" defaultOpen={false}>
        <DnaTags
          path="context.distantBackground"
          label="Distant background"
          placeholder="e.g. hills"
        />
        <DnaTextArea path="context.atmosphereNotes" label="Atmosphere notes" />
      </SectionPanel>

      <SectionPanel title="Negative constraints">
        <DnaTags
          path="context.negativeConstraints"
          label="Must not appear"
          hint="Compiled into the negative prompt."
          placeholder="e.g. snow"
        />
      </SectionPanel>
    </>
  );
}
