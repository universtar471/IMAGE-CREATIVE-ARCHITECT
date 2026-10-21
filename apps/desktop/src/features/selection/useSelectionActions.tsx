/**
 * Binds the action registry to the store (ADR-044) and owns the dialogs some actions open:
 * the spend confirm (Retry), the duplicate-import prompt and the evidence analysis.
 */
import { useState, type ReactNode } from "react";
import { setShotPresets, type AssetDTO, type ProjectDNA } from "@arch/domain";
import { useStudio } from "../../app/store";
import { ConfirmDialog } from "../../components/common/Dialog";
import { useSpendConfirm } from "../../components/common/SpendConfirm";
import { spendRequestForGeneration } from "../../lib/spend";
import { useT } from "../../i18n";
import { AnalysisDialog } from "../analysis/AnalysisDialog";
import { useAssetImport } from "../assets/useAssetImport";
import { resolveGenerateForm } from "../generate/form";
import { actionsFor, type ActionEnv, type ResolvedAction } from "./actions";
import { viewerSetFor } from "./viewerSet";
import type { Selection } from "./selection";

export function useSelectionActions(selection: Selection): {
  actions: ResolvedAction[];
  env: ActionEnv;
  dialogs: ReactNode;
} {
  const t = useT();
  const spend = useSpendConfirm();
  const { duplicate, pickAndImport } = useAssetImport();
  const [analysing, setAnalysing] = useState<AssetDTO | null>(null);

  const env: ActionEnv = {
    setModule: (id) => useStudio.getState().setModule(id),
    setMode: (mode) => useStudio.getState().setWorkspaceMode(mode),
    focusAsset: (assetId) => {
      const s = useStudio.getState();
      s.selectAsset(assetId, { keepView: true });
      if (s.workspaceMode === "node") s.setCanvasSelection([`asset:${assetId}`]);
    },
    useAsSource: (assetId, variation = false) => {
      const s = useStudio.getState();
      s.setGenerateDraft({
        source: "sketch",
        purpose: variation ? "variation" : "hero",
        referenceAssetIds: [assetId],
        params: null,
      });
      if (variation && s.workspace) {
        s.setShotIntent(
          setShotPresets(
            { projectType: s.workspace.project.projectType },
            [],
            s.workspace.draftDna as ProjectDNA,
          ).shotIntent,
        );
      }
      s.notify("success", t("branches.sourceSet"));
    },
    toggleDraftReference: (assetId, include) => {
      const s = useStudio.getState();
      const ws = s.workspace;
      if (!ws) return;
      const current = resolveGenerateForm(
        s.generateDraft,
        s.providers ?? [],
        ws.assets,
        ws.project.activeMasterAssetId,
      ).referenceIds;
      const next = include
        ? [...current.filter((id) => id !== assetId), assetId]
        : current.filter((id) => id !== assetId);
      s.setGenerateDraft({ referenceAssetIds: next });
    },
    showLibrary: () => useStudio.getState().setTrayTab("assets"),
    importImages: () => void pickAndImport(),
    openViewer: (assetId, options) => {
      const s = useStudio.getState();
      const ws = s.workspace;
      if (!ws) return;
      const assetIds = viewerSetFor(assetId, ws.assets, ws.generations);
      s.openViewer({
        assetIds,
        index: Math.max(0, assetIds.indexOf(assetId)),
        compareWithId: options?.compareWithId ?? null,
      });
    },
    openAnalysis: (asset) => setAnalysing(asset),
    copyPrompt: (generation) => {
      void navigator.clipboard
        ?.writeText(generation.prompt.positivePrompt)
        .then(() => useStudio.getState().notify("success", t("branches.promptCopied")));
    },
    reusePresets: (presetIds) => {
      const s = useStudio.getState();
      const ws = s.workspace;
      if (!ws) return;
      const shot = { ...(ws.shotIntent ?? {}), projectType: ws.project.projectType };
      s.setShotIntent(setShotPresets(shot, presetIds, ws.draftDna as ProjectDNA).shotIntent);
    },
    cancelJob: (jobId) => void useStudio.getState().cancelJob(jobId),
    retryGeneration: async (generation) => {
      const s = useStudio.getState();
      if (!(await spend.request(spendRequestForGeneration(generation, s.providers, t)))) return;
      await s.retryGeneration(generation);
    },
    clearSelection: () => useStudio.getState().setCanvasSelection([]),
  };

  const dialogs = (
    <>
      {spend.dialog}
      {duplicate && (
        <ConfirmDialog
          title={t("assets.duplicateTitle")}
          message={duplicate.message}
          confirmLabel={t("assets.importAnyway")}
          onConfirm={() => duplicate.resolve(true)}
          onCancel={() => duplicate.resolve(false)}
        />
      )}
      {analysing && <AnalysisDialog asset={analysing} onClose={() => setAnalysing(null)} />}
    </>
  );

  return { actions: actionsFor(selection), env, dialogs };
}
