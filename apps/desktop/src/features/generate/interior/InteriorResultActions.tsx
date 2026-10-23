import { ScanLine, Layers, Sun, Scan, Wand2, Undo2, Columns2 } from "lucide-react";
import {
  generationWithSource,
  initialInteriorGeneration,
  selectGenerationGoal,
  type GenerationDTO,
  type GenerationGoal,
} from "@arch/domain";
import { selectReadOnly, useStudio } from "../../../app/store";
import { useT } from "../../../i18n";

/** Continue from a result through the existing tools. No button here submits a paid job. */
export function InteriorResultActions({
  generation: g,
  assetId,
}: {
  generation: GenerationDTO;
  assetId: string;
}) {
  const ws = useStudio((s) => s.workspace!);
  const readOnly = useStudio(selectReadOnly);
  const t = useT();
  const sourceId = ws.assets.find(
    (a) =>
      a.id ===
      (g.prompt.shotIntent?.interiorGeneration?.input.assetId ??
        ws.assets.find((a) => a.id === assetId)?.parentAssetId ??
        g.referenceAssetIds[0]),
  )?.id;
  const prepare = (goal: GenerationGoal) => {
    const s = useStudio.getState();
    if (goal === "variations") {
      s.startVariation(assetId);
      return;
    }
    s.setGeneratePanelMode("create");
    const state = selectGenerationGoal(
      generationWithSource(
        s.workspace?.shotIntent?.interiorGeneration ?? initialInteriorGeneration(),
        assetId,
      ),
      goal,
    );
    s.setShotIntent({
      ...s.workspace!.shotIntent,
      projectType: "interior",
      interiorGeneration: state,
    });
    s.setGenerateDraft({
      source: "sketch",
      referenceAssetIds: [assetId, ...(state.reference ? [state.reference.assetId] : [])],
      purpose: "hero",
      params: null,
      extraPrompt: state.instruction,
    });
    s.selectAsset(assetId, { keepView: true });
    s.setModule("generate");
  };
  const open = (module: "regions" | "enhance") => {
    const s = useStudio.getState();
    s.selectAsset(assetId, { keepView: true });
    if (module === "regions") s.setRegionAction("edit");
    s.setModule(module);
  };
  const undo = () => {
    if (!sourceId) return;
    const s = useStudio.getState();
    if (g.prompt.shotIntent?.interiorGeneration) s.reuseGeneration(g);
    s.selectAsset(sourceId, { keepView: true });
  };
  return (
    <div className="interior-result-actions" data-testid="interior-result-actions">
      <button className="btn btn-sm" disabled={readOnly} onClick={() => open("regions")}>
        <Scan size={16} />
        {t("modules.regions.label")}
      </button>
      <button className="btn btn-sm" disabled={readOnly} onClick={() => prepare("variations")}>
        <Layers size={16} />
        {t("interiorFlow.resultVariation")}
      </button>
      <button className="btn btn-sm" disabled={readOnly} onClick={() => prepare("photorealistic")}>
        <ScanLine size={16} />
        {t("interiorFlow.resultRealism")}
      </button>
      <button className="btn btn-sm" disabled={readOnly} onClick={() => prepare("ambience")}>
        <Sun size={16} />
        {t("interiorFlow.resultLighting")}
      </button>
      <button className="btn btn-sm" disabled={readOnly} onClick={() => open("enhance")}>
        <Wand2 size={16} />
        {t("interiorFlow.resultUpscale")}
      </button>
      <button className="btn btn-sm" disabled={readOnly || !sourceId} onClick={undo}>
        <Undo2 size={16} />
        {t("interiorFlow.resultUndo")}
      </button>
      <button
        className="btn btn-sm"
        disabled={!sourceId}
        onClick={() =>
          useStudio
            .getState()
            .openViewer({ assetIds: [assetId], index: 0, compareWithId: sourceId })
        }
      >
        <Columns2 size={16} />
        {t("interiorFlow.resultCompare")}
      </button>
    </div>
  );
}
