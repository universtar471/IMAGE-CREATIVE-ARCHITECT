import { useMemo } from "react";
import type { GenerateDraft } from "../../app/store";
import { selectReadOnly, useStudio } from "../../app/store";
import { resolveGenerateForm } from "../generate/form";
import { resolveSelection, type Selection } from "./selection";

/** The source the Generate button would use now (the dashed draft node's source). */
export function draftSourceOf(draft: GenerateDraft, masterId: string | null): string | null {
  return draft.source === "sketch" ? (draft.referenceAssetIds?.[0] ?? null) : masterId;
}

/** The one normalised selection every surface reads (ADR-044). */
export function useSelection(): Selection {
  const ws = useStudio((s) => s.workspace);
  const mode = useStudio((s) => s.workspaceMode);
  const canvasSelection = useStudio((s) => s.canvasSelection);
  const selectedAssetId = useStudio((s) => s.selectedAssetId);
  const draft = useStudio((s) => s.generateDraft);
  const providers = useStudio((s) => s.providers);
  const readOnly = useStudio(selectReadOnly);
  return useMemo(() => {
    if (!ws) return { kind: "none", readOnly };
    const master = ws.project.activeMasterAssetId;
    const draftReferenceIds = resolveGenerateForm(
      draft,
      providers ?? [],
      ws.assets,
      master,
    ).referenceIds;
    const source = draftSourceOf(draft, master);
    return resolveSelection({
      mode,
      canvasSelection,
      selectedAssetId,
      assets: ws.assets,
      generations: ws.generations,
      draftReferenceIds,
      draft: source ? { sourceAssetId: source, presetIds: ws.shotIntent?.presetIds ?? [] } : null,
      readOnly,
    });
  }, [ws, mode, canvasSelection, selectedAssetId, draft, providers, readOnly]);
}
