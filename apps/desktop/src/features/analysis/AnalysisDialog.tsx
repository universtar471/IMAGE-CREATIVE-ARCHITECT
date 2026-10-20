import { useState } from "react";
import { ScanSearch } from "lucide-react";
import {
  analysisSystemPrompt,
  analysisBoardSvg,
  parseImageAnalysis,
  type AnalysisBoardLabels,
  type AssetDTO,
  type ImageAnalysis,
} from "@arch/domain";
import { useStudio } from "../../app/store";
import { Dialog } from "../../components/common/Dialog";
import { call, toBridgeError } from "../../lib/bridge";
import { assetDataUrl, rasterizeSvg, svgDataUrl } from "../diagram/raster";
import { useLocale, useT, type TFunction } from "../../i18n";

const boardLabels = (t: TFunction): AnalysisBoardLabels => ({
  title: t("analysis.boardTitle"),
  inferred: t("analysis.inferred"),
  materials: t("analysis.materials"),
  palette: t("analysis.palette"),
  composition: t("analysis.composition"),
  viewpoint: t("analysis.viewpoint"),
  lighting: t("analysis.lighting"),
  focus: t("analysis.focus"),
  observations: t("analysis.observations"),
  confidence: {
    low: t("analysis.confidence.low"),
    medium: t("analysis.confidence.medium"),
    high: t("analysis.confidence.high"),
  },
  footer: t("analysis.footer"),
});

/**
 * Evidence board of one image (ADR-042): one text call to the vision model (HHTECH assist
 * model), then the app draws the board itself. Nothing runs until "Analyse" is pressed, and
 * the board is saved as a new asset only on "Save as image".
 */
export function AnalysisDialog({ asset, onClose }: { asset: AssetDTO; onClose: () => void }) {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const notify = useStudio((s) => s.notify);
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "running" }
    | { kind: "done"; analysis: ImageAnalysis; svg: string; href: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [saving, setSaving] = useState(false);

  const analyse = async () => {
    setState({ kind: "running" });
    try {
      const result = await call("dna_assist", {
        projectId: asset.projectId,
        mode: "images",
        scope: "analysis",
        referenceAssetIds: [asset.id],
        catalog: { scope: "analysis", fields: [] },
        systemPrompt: analysisSystemPrompt(locale === "vi" ? "Vietnamese" : "English"),
      });
      const parsed = parseImageAnalysis(result.raw);
      if (!parsed.ok) {
        setState({ kind: "error", message: t("analysis.badReply") });
        return;
      }
      const href = await assetDataUrl(asset.projectId, asset.id, 1600);
      setState({
        kind: "done",
        analysis: parsed.analysis,
        href,
        svg: analysisBoardSvg(parsed.analysis, href, boardLabels(t)),
      });
    } catch (e) {
      setState({ kind: "error", message: toBridgeError(e).message });
    }
  };

  const save = async () => {
    if (state.kind !== "done") return;
    setSaving(true);
    try {
      const png = await rasterizeSvg(state.svg, { longEdge: 2400 });
      await call("diagram_image_save", {
        projectId: asset.projectId,
        parentAssetId: asset.id,
        pngBase64: png.base64,
        label: t("analysis.assetLabel", { name: asset.originalName ?? asset.id }),
        kind: "sheet",
        meta: { type: "analysis_board", inferred: true },
      });
      const assets = await call("asset_list", { projectId: asset.projectId });
      await useStudio.getState().adoptAssets(asset.projectId, assets);
      notify("success", t("analysis.saved"));
    } catch (e) {
      notify("error", toBridgeError(e).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      title={t("analysis.title")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("common.close")}
          </button>
          {state.kind === "done" ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => void save()}
            >
              {t("analysis.save")}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={state.kind === "running"}
              onClick={() => void analyse()}
            >
              <ScanSearch size={14} />{" "}
              {state.kind === "running" ? t("analysis.running") : t("analysis.run")}
            </button>
          )}
        </>
      }
    >
      <p className="field-hint">{t("analysis.explain")}</p>
      {state.kind === "error" && (
        <div className="callout callout-error" role="alert">
          {state.message}
        </div>
      )}
      {state.kind === "done" && (
        <img
          className="analysis-board"
          src={svgDataUrl(state.svg)}
          alt={t("analysis.boardTitle")}
          data-testid="analysis-board"
        />
      )}
    </Dialog>
  );
}
