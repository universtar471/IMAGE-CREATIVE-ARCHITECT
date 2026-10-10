import type { CameraDNA, ProjectType } from "@arch/domain";
import { useStudio, selectReadOnly } from "../../app/store";
import { useT } from "../../i18n";
import {
  cameraSitePlan,
  resolveSiteTopology,
  type CornerSide,
  type SiteTopology,
  type TopologyContext,
} from "../../lib/siteTopology";

export function SiteTopologyChip({ camera }: { camera: CameraDNA }) {
  const t = useT();
  const project = useStudio((s) => s.workspace!.project);
  const context = useStudio((s) => s.workspace!.draftDna.context as unknown as TopologyContext);
  const readOnly = useStudio(selectReadOnly);
  const editDna = useStudio((s) => s.editDna);
  if (project.projectType === "interior") return null;
  const plan = cameraSitePlan(camera, context, project.projectType as ProjectType);
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

  const resolve = (mode: "attached" | "corner") => {
    const current = resolveSiteTopology(context);
    const raw = context.siteTopology ?? {};
    const next: SiteTopology = {
      left: raw.left ?? current.left,
      right: raw.right ?? current.right,
      cornerLot: raw.cornerLot === true,
      ...(raw.cornerSide ? { cornerSide: raw.cornerSide } : {}),
    };
    if (mode === "attached") {
      next[plan.side!] = "attached";
      if (next.cornerSide === plan.side) {
        next.cornerLot = false;
        delete next.cornerSide;
      }
    } else {
      next.cornerLot = true;
      next.cornerSide = plan.side as CornerSide;
      next[plan.side!] = "open";
    }
    editDna("context.siteTopology", next);
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
