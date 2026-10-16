import { siteCameraPlan, type CameraDNA, type ProjectDNA, type ProjectType } from "@arch/domain";
import { useStudio, selectReadOnly } from "../../app/store";
import { useT } from "../../i18n";
import { editSiteSide } from "../site/siteEdit";

export function SiteTopologyChip({ camera }: { camera: CameraDNA }) {
  const t = useT();
  const project = useStudio((s) => s.workspace!.project);
  // The resolved site adjacency (ADR-034): an explicit `site` wins over the older toggles.
  const draftDna = useStudio((s) => s.workspace!.draftDna as ProjectDNA);
  const readOnly = useStudio(selectReadOnly);
  const editDna = useStudio((s) => s.editDna);
  if (project.projectType === "interior") return null;
  const plan = siteCameraPlan(camera, draftDna, project.projectType as ProjectType);
  const sideLabel = plan.side ? t(`topology.${plan.side}Label`) : "";
  const label =
    plan.mode === "oblique_street"
      ? t("topology.obliqueStreet")
      : plan.mode === "aerial_block"
        ? t("topology.aerialBlock")
        : plan.mode === "corner_side"
          ? t("topology.cornerSideChip", { side: sideLabel })
          : plan.mode === "unknown_side"
            ? t("topology.unknownSide", { side: sideLabel })
            : t("topology.normal");

  if (plan.mode !== "unknown_side" || !plan.side) {
    return (
      <span className={`topology-chip topology-chip-${plan.mode}`} data-testid="topology-chip">
        {label}
      </span>
    );
  }

  // Writes `site` and the synced toggles (ADR-034), like the site editor.
  const resolve = (mode: "attached" | "corner") => {
    const dna = useStudio.getState().workspace!.draftDna as ProjectDNA;
    editSiteSide(
      editDna,
      dna,
      plan.side!,
      {
        kind: mode === "attached" ? "attached_building" : "street",
        status: "user_declared",
      },
      project.projectType,
    );
  };

  return (
    <span className="topology-chip topology-chip-unknown" data-testid="topology-chip">
      <span>{label}</span>
      {!readOnly && (
        <span className="topology-chip-actions">
          <button type="button" className="btn btn-xs" onClick={() => resolve("attached")}>
            {t("topology.resolveAttached")}
          </button>
          <button type="button" className="btn btn-xs" onClick={() => resolve("corner")}>
            {t("topology.resolveCorner")}
          </button>
        </span>
      )}
    </span>
  );
}
