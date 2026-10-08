import { Plus, Trash2 } from "lucide-react";
import type { MaterialEntry } from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { knowledge } from "../../lib/knowledge";
import { DnaNumber, DnaTags, DnaText, DnaTextArea, useDnaLock } from "./DnaFields";
import { LockToggle } from "./LockToggle";

export function BuildingDnaPanel() {
  const project = useStudio((s) => s.workspace!.project);
  const isInterior = project.projectType === "interior";
  const { pack } = knowledge.resolve(project.projectType, project.subtype);

  return (
    <>
      <SectionPanel title="Identity" aside={<LockToggle section="building" />}>
        <DnaText path="building.buildingType" label="Building type" />
        <DnaText
          path="building.architecturalStyle"
          label="Architectural style"
          placeholder="e.g. Modern tropical"
          suggestions={pack?.styleSuggestions}
        />
        <div className="field-row">
          <DnaNumber path="building.floors" label={isInterior ? "Levels" : "Floors"} integer />
          <DnaText path="building.subtype" label="Subtype" />
        </div>
      </SectionPanel>

      <SectionPanel title="Dimensions">
        <div className="field-row">
          <DnaNumber path="building.dimensions.widthM" label="Width" suffix="m" />
          <DnaNumber path="building.dimensions.depthM" label="Depth" suffix="m" />
        </div>
        <div className="field-row">
          <DnaNumber path="building.dimensions.heightM" label="Height" suffix="m" />
          <span />
        </div>
        {!isInterior && (
          <div className="field-row">
            <DnaNumber path="building.dimensions.siteWidthM" label="Site width" suffix="m" />
            <DnaNumber path="building.dimensions.siteDepthM" label="Site depth" suffix="m" />
          </div>
        )}
      </SectionPanel>

      <SectionPanel title="Massing" defaultOpen={false}>
        <DnaText
          path="building.massing.composition"
          label="Composition"
          placeholder="e.g. two interlocking boxes"
        />
        <DnaText path="building.massing.mainVolume" label="Main volume" />
        <DnaText path="building.massing.secondaryVolume" label="Secondary volume" />
        <DnaTags
          path="building.massing.voids"
          label="Voids"
          placeholder="e.g. double-height living"
        />
        <DnaText path="building.massing.cantilever" label="Cantilever" />
      </SectionPanel>

      <SectionPanel title="Roof" defaultOpen={false}>
        <DnaText
          path="building.roof.type"
          label="Roof type"
          placeholder="e.g. flat roof with terrace"
        />
        <div className="field-row">
          <DnaText path="building.roof.pitch" label="Pitch" />
          <DnaText path="building.roof.overhang" label="Overhang" />
        </div>
      </SectionPanel>

      <SectionPanel title="Openings" defaultOpen={false}>
        <DnaText path="building.openings.windowType" label="Window type" />
        <div className="field-row">
          <DnaText path="building.openings.frame" label="Frame" />
          <DnaText path="building.openings.glazing" label="Glazing" />
        </div>
        <DnaText path="building.openings.rhythm" label="Rhythm" />
      </SectionPanel>

      <SectionPanel title="Materials & colors">
        <MaterialsEditor />
        <DnaTags
          path="building.colorPalette"
          label="Color palette"
          placeholder="e.g. white, beige"
        />
      </SectionPanel>

      <SectionPanel title="Features & notes" defaultOpen={false}>
        <DnaTags
          path="building.specialFeatures"
          label="Special features"
          placeholder="e.g. green wall"
        />
        <DnaTextArea path="building.notes" label="Notes" />
      </SectionPanel>
    </>
  );
}

function MaterialsEditor() {
  const materials = useStudio((s) => s.workspace!.draftDna.building.materials) as MaterialEntry[];
  const errors = useStudio((s) => s.save.fieldErrors);
  const editDna = useStudio((s) => s.editDna);
  const readOnly = useStudio(selectReadOnly);
  const { locked } = useDnaLock("building");
  const disabled = readOnly || locked;

  const update = (next: MaterialEntry[]) => editDna("building.materials", next);
  const patch = (i: number, field: "zone" | "description", value: string) =>
    update(materials.map((m, j) => (j === i ? { ...m, [field]: value } : m)));

  return (
    <div className="field">
      <span className="field-label">Materials by zone</span>
      {materials.length === 0 && <span className="field-hint">No materials yet.</span>}
      {materials.map((m, i) => {
        const zoneErr = errors[`building.materials.${i}.zone`];
        const descErr = errors[`building.materials.${i}.description`];
        return (
          <div key={i} className="material-row">
            <input
              className={`input ${zoneErr ? "has-error" : ""}`}
              placeholder="Zone"
              aria-label={`Material ${i + 1} zone`}
              value={m.zone}
              disabled={disabled}
              onChange={(e) => patch(i, "zone", e.target.value)}
            />
            <input
              className={`input ${descErr ? "has-error" : ""}`}
              placeholder="e.g. travertine cladding"
              aria-label={`Material ${i + 1} description`}
              value={m.description}
              disabled={disabled}
              onChange={(e) => patch(i, "description", e.target.value)}
            />
            <button
              className="btn btn-ghost btn-icon"
              aria-label={`Remove material ${i + 1}`}
              disabled={disabled}
              onClick={() => update(materials.filter((_, j) => j !== i))}
            >
              <Trash2 size={14} />
            </button>
            {(zoneErr || descErr) && (
              <span className="field-error" style={{ gridColumn: "1 / -1" }}>
                {zoneErr ? "Zone is required." : "Description is required."}
              </span>
            )}
          </div>
        );
      })}
      <button
        className="btn btn-sm"
        style={{ alignSelf: "flex-start" }}
        disabled={disabled}
        onClick={() => update([...materials, { zone: "", description: "" }])}
      >
        <Plus size={14} /> Add material
      </button>
    </div>
  );
}
