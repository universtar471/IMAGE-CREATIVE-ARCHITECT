import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertTriangle, ArrowLeft, Columns2, LayoutGrid, ScanSearch } from "lucide-react";
import { AnalysisDialog } from "../analysis/AnalysisDialog";
import {
  buildBranchGraph,
  deepAiChain,
  layoutBranchGraph,
  setShotPresets,
  type AssetDTO,
  type BranchNode,
  type CanvasLayout,
  type CanvasPosition,
  type GenerationDTO,
  type ProjectDNA,
} from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { CompareCanvas } from "../../components/canvas/CompareCanvas";
import { useSpendConfirm } from "../../components/common/SpendConfirm";
import { GenerationStatusBadge } from "../generate/GenerationStatusBadge";
import { call, toBridgeError } from "../../lib/bridge";
import { fileUrl } from "../../lib/files";
import { spendRequestForGeneration } from "../../lib/spend";
import { useLocale, useT } from "../../i18n";
import { presetLabels } from "../presets/labels";

const SAVE_DELAY_MS = 600;

type NodeData = {
  node: BranchNode;
  asset?: AssetDTO;
  generation?: GenerationDTO;
};
type FlowNode = Node<NodeData>;

/**
 * Branch canvas (ADR-041): images → generations → outputs, derived from the project's
 * lineage. Clicking an image makes it the next source; the Generate panel on the right still
 * runs everything, so the canvas never spends credit on its own. Dragged positions are saved.
 */
export function BranchCanvas() {
  const t = useT();
  const ws = useStudio((s) => s.workspace!);
  const draft = useStudio((s) => s.generateDraft);
  const readOnly = useStudio(selectReadOnly);
  const projectId = ws.project.id;

  const [layout, setLayout] = useState<CanvasLayout | null>(null);
  const [dragged, setDragged] = useState<Record<string, CanvasPosition>>({});
  const [selection, setSelection] = useState<string[]>([]);
  const [compare, setCompare] = useState<[string, string] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    call("canvas_layout_get", { projectId }).then(
      (dto) => alive && setLayout(dto.layout),
      (e: unknown) => alive && setError(toBridgeError(e).message),
    );
    return () => {
      alive = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [projectId]);

  // What the Generate button would send now (shown dashed after its source).
  const draftSource =
    draft.source === "sketch"
      ? (draft.referenceAssetIds?.[0] ?? null)
      : (ws.project.activeMasterAssetId ?? null);
  const graph = useMemo(
    () =>
      buildBranchGraph({
        assets: ws.assets,
        generations: ws.generations,
        draft: draftSource
          ? { sourceAssetId: draftSource, presetIds: ws.shotIntent?.presetIds ?? [] }
          : null,
      }),
    [ws.assets, ws.generations, draftSource, ws.shotIntent?.presetIds],
  );
  const positions = useMemo(
    () => (layout ? layoutBranchGraph(graph, layout) : {}),
    [graph, layout],
  );

  const assets = useMemo(() => new Map(ws.assets.map((a) => [a.id, a])), [ws.assets]);
  const generations = useMemo(
    () => new Map(ws.generations.map((g) => [g.id, g])),
    [ws.generations],
  );
  const nodes: FlowNode[] = graph.nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    position: dragged[node.id] ?? positions[node.id] ?? { x: 0, y: 0 },
    selected: selection.includes(node.id),
    draggable: !readOnly && node.kind !== "draft",
    data: {
      node,
      asset: node.kind === "image" ? assets.get(node.assetId) : undefined,
      generation: node.kind === "generation" ? generations.get(node.generationId) : undefined,
    },
  }));
  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    className: e.primary ? "branch-edge" : "branch-edge branch-edge-secondary",
    animated: e.to === "draft",
  }));

  const persist = (next: CanvasLayout) => {
    setLayout(next);
    if (readOnly) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      call("canvas_layout_save", { projectId, layout: next }).catch((e: unknown) =>
        setError(toBridgeError(e).message),
      );
    }, SAVE_DELAY_MS);
  };

  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
    for (const change of changes) {
      if (change.type === "position" && change.position) {
        const { id, position } = change;
        setDragged((d) => ({ ...d, [id]: position }));
        if (change.dragging === false && layout) {
          persist({ ...layout, positions: { ...layout.positions, [id]: position } });
        }
      }
      if (change.type === "select") {
        setSelection((sel) =>
          change.selected
            ? [...sel.filter((id) => id !== change.id), change.id]
            : sel.filter((id) => id !== change.id),
        );
      }
    }
  };

  const rearrange = () => {
    setDragged({});
    persist({ version: 1, positions: {} });
  };

  const selectedImages = selection.filter((id) => id.startsWith("asset:"));
  const focused = graph.nodes.find((n) => n.id === selection.at(-1));

  if (compare) {
    const [a, b] = compare.map((id) => assets.get(id) ?? null);
    return (
      <div className="branch-compare" data-testid="branch-compare">
        <div className="branch-toolbar">
          <button type="button" className="btn btn-sm" onClick={() => setCompare(null)}>
            <ArrowLeft size={13} /> {t("branches.back")}
          </button>
        </div>
        <CompareCanvas source={a ?? null} result={b ?? null} projectId={projectId} />
      </div>
    );
  }

  return (
    <div className="branch-canvas" data-testid="branch-canvas">
      <div className="branch-toolbar">
        <button
          type="button"
          className="btn btn-sm"
          disabled={readOnly || !layout}
          onClick={rearrange}
        >
          <LayoutGrid size={13} /> {t("branches.rearrange")}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={selectedImages.length !== 2}
          data-testid="branch-compare-button"
          onClick={() =>
            setCompare([
              selectedImages[0]!.slice("asset:".length),
              selectedImages[1]!.slice("asset:".length),
            ])
          }
        >
          <Columns2 size={13} /> {t("branches.compare")}
        </button>
        <span className="field-hint">{t("branches.hint")}</span>
      </div>
      {error && (
        <div className="callout callout-error" role="alert">
          {error}
        </div>
      )}
      {graph.nodes.length === 0 ? (
        <div className="branch-empty field-hint">{t("branches.empty")}</div>
      ) : (
        <div className="branch-flow">
          <ReactFlow<FlowNode>
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            nodesConnectable={false}
            multiSelectionKeyCode="Shift"
            fitView
            minZoom={0.2}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} />
            <Controls position="top-right" showInteractive={false} />
          </ReactFlow>
        </div>
      )}
      {focused && <NodeActions node={focused} />}
    </div>
  );
}

/** Actions for the last selected node; nothing here spends credit without the usual confirm. */
function NodeActions({ node }: { node: BranchNode }) {
  const t = useT();
  const ws = useStudio((s) => s.workspace!);
  const readOnly = useStudio(selectReadOnly);
  const setDraft = useStudio((s) => s.setGenerateDraft);
  const setShotIntent = useStudio((s) => s.setShotIntent);
  const setCenterView = useStudio((s) => s.setCenterView);
  const notify = useStudio((s) => s.notify);
  const retry = useStudio((s) => s.retryGeneration);
  const providers = useStudio((s) => s.providers);
  const spend = useSpendConfirm();
  const [analysing, setAnalysing] = useState<AssetDTO | null>(null);

  if (node.kind === "image") {
    return (
      <div className="branch-actions" data-testid="branch-actions">
        <strong>
          {ws.assets.find((a) => a.id === node.assetId)?.originalName ?? node.assetId}
        </strong>
        {deepAiChain(node) && (
          <span className="field-hint branch-warning">
            <AlertTriangle size={12} /> {t("branches.deepChain")}
          </span>
        )}
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={readOnly}
          onClick={() => {
            setDraft({
              source: "sketch",
              purpose: "hero",
              referenceAssetIds: [node.assetId],
              params: null,
            });
            notify("success", t("branches.sourceSet"));
          }}
        >
          {t("branches.useAsSource")}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            useStudio.setState({ selectedAssetId: node.assetId });
            setCenterView("canvas");
          }}
        >
          {t("branches.viewLarge")}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={readOnly}
          onClick={() => setAnalysing(ws.assets.find((a) => a.id === node.assetId) ?? null)}
        >
          <ScanSearch size={13} /> {t("analysis.open")}
        </button>
        {analysing && <AnalysisDialog asset={analysing} onClose={() => setAnalysing(null)} />}
      </div>
    );
  }
  if (node.kind === "generation") {
    const g = ws.generations.find((x) => x.id === node.generationId);
    const canRetry =
      !!g && (g.status === "cancelled" || (g.status === "failed" && !!g.error?.retryable));
    return (
      <div className="branch-actions" data-testid="branch-actions">
        <GenerationStatusBadge status={node.status} />
        <span className="field-hint">
          {node.providerId} · {node.modelId}
        </span>
        <button
          type="button"
          className="btn btn-sm"
          disabled={readOnly || node.presetIds.length === 0}
          onClick={() => {
            const shot = { ...(ws.shotIntent ?? {}), projectType: ws.project.projectType };
            const result = setShotPresets(shot, node.presetIds, ws.draftDna as ProjectDNA);
            setShotIntent(result.shotIntent);
          }}
        >
          {t("branches.reusePresets")}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!g}
          onClick={() => {
            void navigator.clipboard
              ?.writeText(g!.prompt.positivePrompt)
              .then(() => notify("success", t("branches.promptCopied")));
          }}
        >
          {t("branches.copyPrompt")}
        </button>
        {canRetry && (
          <button
            type="button"
            className="btn btn-sm"
            disabled={readOnly}
            onClick={async () => {
              if (!(await spend.request(spendRequestForGeneration(g!, providers, t)))) return;
              await retry(g!);
            }}
          >
            {t("branches.retry")}
          </button>
        )}
        {spend.dialog}
      </div>
    );
  }
  return (
    <div className="branch-actions" data-testid="branch-actions">
      <span className="field-hint">{t("branches.draftHint")}</span>
    </div>
  );
}

function ImageNodeView({ data }: NodeProps<FlowNode>) {
  const t = useT();
  const node = data.node as Extract<BranchNode, { kind: "image" }>;
  const thumb = fileUrl(data.asset?.thumbnailPath ?? data.asset?.absolutePath);
  return (
    <div className="branch-node branch-node-image" data-node={node.id}>
      <Handle type="target" position={Position.Left} />
      <div className="branch-thumb">{thumb ? <img src={thumb} alt="" /> : null}</div>
      <div className="branch-node-label" title={node.label}>
        {deepAiChain(node) && <AlertTriangle size={11} aria-label={t("branches.deepChain")} />}{" "}
        {node.label}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function GenerationNodeView({ data }: NodeProps<FlowNode>) {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const node = data.node as Extract<BranchNode, { kind: "generation" }>;
  return (
    <div className="branch-node branch-node-generation" data-node={node.id}>
      <Handle type="target" position={Position.Left} />
      <div className="branch-node-head">
        <GenerationStatusBadge status={node.status} />
        <span>{t(`labels.purpose.${node.purpose}`)}</span>
      </div>
      <div className="branch-chips">
        {presetLabels(node.presetIds, locale).map((label) => (
          <span className="branch-chip" key={label}>
            {label}
          </span>
        ))}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function DraftNodeView({ data }: NodeProps<FlowNode>) {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const node = data.node as Extract<BranchNode, { kind: "draft" }>;
  return (
    <div className="branch-node branch-node-draft" data-node={node.id}>
      <Handle type="target" position={Position.Left} />
      <div className="branch-node-head">{t("branches.draft")}</div>
      <div className="branch-chips">
        {presetLabels(node.presetIds, locale).map((label) => (
          <span className="branch-chip" key={label}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

const NODE_TYPES = {
  image: ImageNodeView,
  generation: GenerationNodeView,
  draft: DraftNodeView,
};
