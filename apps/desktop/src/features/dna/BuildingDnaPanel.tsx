import { Plus, Trash2 } from "lucide-react";
import type { MaterialEntry } from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { knowledge } from "../../lib/knowledge";
import { useT } from "../../i18n";
import { styleLabel } from "../../i18n/knowledge";
import { DnaNumber, DnaTags, DnaText, DnaTextArea, useDnaLock } from "./DnaFields";
import { LockToggle } from "./LockToggle";

export function BuildingDnaPanel() {
  const project = useStudio((s) => s.workspace!.project);
  const isInterior = project.projectType === "interior";
  const { pack } = knowledge.resolve(project.projectType, project.subtype);
  const t = useT();

  return (
    <>
      <p className="field-hint dna-hint">{t("dna.englishHint")}</p>
      <SectionPanel title={t("dna.identity")} aside={<LockToggle section="building" />}>
        <DnaText path="building.buildingType" label={t("dna.buildingType")} />
        <DnaText
          path="building.architecturalStyle"
          label={t("dna.style")}
          placeholder={t("dna.stylePlaceholder")}
          suggestions={pack?.styleSuggestions}
          suggestionLabel={styleLabel}
        />
        <div className="field-row">
          <DnaNumber
            path="building.floors"
            label={isInterior ? t("dna.levels") : t("dna.floors")}
            integer
          />
          <DnaText path="building.subtype" label={t("dna.subtype")} />
        </div>
      </SectionPanel>

      <SectionPanel title={t("dna.dimensions")}>
        <div className="field-row">
          <DnaNumber path="building.dimensions.widthM" label={t("dna.width")} suffix="m" />
          <DnaNumber path="building.dimensions.depthM" label={t("dna.depth")} suffix="m" />
        </div>
        <div className="field-row">
          <DnaNumber path="building.dimensions.heightM" label={t("dna.height")} suffix="m" />
          <span />
        </div>
        {!isInterior && (
          <div className="field-row">
            <DnaNumber
              path="building.dimensions.siteWidthM"
              label={t("dna.siteWidth")}
              suffix="m"
            />
            <DnaNumber
              path="building.dimensions.siteDepthM"
              label={t("dna.siteDepth")}
              suffix="m"
            />
          </div>
        )}
      </SectionPanel>

      <SectionPanel title={t("dna.massing")} defaultOpen={false}>
        <DnaText
          path="building.massing.composition"
          label={t("dna.composition")}
          placeholder={t("dna.compositionPlaceholder")}
        />
        <DnaText path="building.massing.mainVolume" label={t("dna.mainVolume")} />
        <DnaText path="building.massing.secondaryVolume" label={t("dna.secondaryVolume")} />
        <DnaTags
          path="building.massing.voids"
          label={t("dna.voids")}
          placeholder={t("dna.voidsPlaceholder")}
        />
        <DnaText path="building.massing.cantilever" label={t("dna.cantilever")} />
      </SectionPanel>

      <SectionPanel title={t("dna.roof")} defaultOpen={false}>
        <DnaText
          path="building.roof.type"
          label={t("dna.roofType")}
          placeholder={t("dna.roofPlaceholder")}
        />
        <div className="field-row">
          <DnaText path="building.roof.pitch" label={t("dna.pitch")} />
          <DnaText path="building.roof.overhang" label={t("dna.overhang")} />
        </div>
      </SectionPanel>

      <SectionPanel title={t("dna.openings")} defaultOpen={false}>
        <DnaText path="building.openings.windowType" label={t("dna.windowType")} />
        <div className="field-row">
          <DnaText path="building.openings.frame" label={t("dna.frame")} />
          <DnaText path="building.openings.glazing" label={t("dna.glazing")} />
        </div>
        <DnaText path="building.openings.rhythm" label={t("dna.rhythm")} />
      </SectionPanel>

      <SectionPanel title={t("dna.materialsColors")}>
        <MaterialsEditor />
        <DnaTags
          path="building.colorPalette"
          label={t("dna.colorPalette")}
          placeholder={t("dna.colorPlaceholder")}
        />
      </SectionPanel>

      <SectionPanel title={t("dna.featuresNotes")} defaultOpen={false}>
        <DnaTags
          path="building.specialFeatures"
          label={t("dna.specialFeatures")}
          placeholder={t("dna.featuresPlaceholder")}
        />
        <DnaTextArea path="building.notes" label={t("dna.notes")} />
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
  const t = useT();
  const disabled = readOnly || locked;

  const update = (next: MaterialEntry[]) => editDna("building.materials", next);
  const patch = (i: number, field: "zone" | "description", value: string) =>
    update(materials.map((m, j) => (j === i ? { ...m, [field]: value } : m)));

  return (
    <div className="field">
      <span className="field-label">{t("dna.materialsByZone")}</span>
      {materials.length === 0 && <span className="field-hint">{t("dna.noMaterials")}</span>}
      {materials.map((m, i) => {
        const zoneErr = errors[`building.materials.${i}.zone`];
        const descErr = errors[`building.materials.${i}.description`];
        return (
          <div key={i} className="material-row">
            <input
              className={`input ${zoneErr ? "has-error" : ""}`}
              placeholder={t("dna.zone")}
              aria-label={t("dna.materialZone", { n: i + 1 })}
              value={m.zone}
              disabled={disabled}
              onChange={(e) => patch(i, "zone", e.target.value)}
            />
            <input
              className={`input ${descErr ? "has-error" : ""}`}
              placeholder={t("dna.materialPlaceholder")}
              aria-label={t("dna.materialDescription", { n: i + 1 })}
              value={m.description}
              disabled={disabled}
              onChange={(e) => patch(i, "description", e.target.value)}
            />
            <button
              className="btn btn-ghost btn-icon"
              aria-label={t("dna.removeMaterial", { n: i + 1 })}
              disabled={disabled}
              onClick={() => update(materials.filter((_, j) => j !== i))}
            >
              <Trash2 size={14} />
            </button>
            {(zoneErr || descErr) && (
              <span className="field-error" style={{ gridColumn: "1 / -1" }}>
                {zoneErr ? t("dna.zoneRequired") : t("dna.descriptionRequired")}
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
        <Plus size={14} /> {t("dna.addMaterial")}
      </button>
    </div>
  );
}
