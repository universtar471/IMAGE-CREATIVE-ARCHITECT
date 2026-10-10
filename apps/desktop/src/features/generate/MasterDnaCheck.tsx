import { useStudio } from "../../app/store";
import { useT } from "../../i18n";

/**
 * Reminder next to master approval: the building facts the DNA text states. When they differ
 * from the master image (e.g. 2 floors vs a single-storey master), the prompt carries both and
 * models tend to follow the text, so anchors drift away from the master.
 */
export function MasterDnaCheck() {
  const building = useStudio((s) => s.workspace!.persistedDna.building);
  const setModule = useStudio((s) => s.setModule);
  const t = useT();
  const facts = [
    building.floors !== undefined ? t("masterCheck.floors", { n: building.floors }) : null,
    building.materials.length
      ? building.materials.map((m) => `${m.zone}: ${m.description}`).join(", ")
      : null,
  ].filter((x): x is string => !!x);
  if (!facts.length) return null;
  return (
    <span className="field-hint" role="note">
      {t("masterCheck.text", { facts: facts.join(" · ") })}{" "}
      <button className="link-btn" onClick={() => setModule("design_dna")}>
        {t("masterCheck.edit")}
      </button>
    </span>
  );
}
