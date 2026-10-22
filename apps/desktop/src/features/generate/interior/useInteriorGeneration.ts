import { useEffect } from "react";
import {
  generationFromLegacy,
  generationWithSource,
  type InteriorGenerationState,
} from "@arch/domain";
import { selectReadOnly, useStudio } from "../../../app/store";

export function useInteriorGeneration() {
  const ws = useStudio((s) => s.workspace!);
  const draft = useStudio((s) => s.generateDraft);
  const readOnly = useStudio(selectReadOnly);
  const stored = ws.shotIntent?.interiorGeneration;
  const state =
    stored ??
    generationFromLegacy(ws.draftDna.interior?.roomId ?? "living_room", draft.extraPrompt ?? "");
  const set = (next: InteriorGenerationState) => {
    const current = useStudio.getState();
    if (
      !current.workspace ||
      current.workspace.project.id !== ws.project.id ||
      selectReadOnly(current)
    )
      return;
    current.setShotIntent({
      ...current.workspace.shotIntent,
      projectType: "interior",
      interiorGeneration: next,
    });
    current.setGenerateDraft({
      source: next.input.assetId ? "sketch" : "dna",
      referenceAssetIds: [next.input.assetId, next.reference?.assetId].filter(
        (id): id is string => !!id,
      ),
      extraPrompt: next.instruction,
    });
  };
  useEffect(() => {
    if (readOnly) return;
    const current = useStudio.getState();
    const workspace = current.workspace;
    if (!workspace || workspace.project.id !== ws.project.id) return;
    const previous = workspace.shotIntent?.interiorGeneration;
    const sourceId =
      current.generateDraft.source === "sketch"
        ? current.generateDraft.referenceAssetIds?.[0]
        : null;
    // Contextual "Create variation" can select a new source without resetting the workflow.
    if (!previous || (sourceId && sourceId !== previous.input.assetId)) {
      const next =
        previous ??
        generationFromLegacy(
          workspace.draftDna.interior?.roomId ?? "living_room",
          current.generateDraft.extraPrompt ?? "",
        );
      set(sourceId ? generationWithSource(next, sourceId) : next);
    }
    // set reads the current store; it must not re-initialize choices on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.project.id, readOnly, draft.source, draft.referenceAssetIds?.[0]]);
  return { state, set };
}
