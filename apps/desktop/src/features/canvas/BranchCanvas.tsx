import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useInternalNode,
  useStore,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertTriangle, LayoutGrid } from "lucide-react";
import {
  buildBranchGraph,
  deepAiChain,
  isVideoAsset,
  layoutBranchGraph,
  type AssetDTO,
  type BranchNode,
  type CanvasLayout,
  type CanvasPosition,
  type GenerationDTO,
} from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { RoleBadge } from "../../components/common/StatusBadge";
import { VideoBadge } from "../../components/common/VideoBadge";
import { GenerationStatusBadge } from "../generate/GenerationStatusBadge";
import { call, toBridgeError } from "../../lib/bridge";
import { fileUrl } from "../../lib/files";
import { useElementSize } from "../../lib/useElementSize";
import { useLocale, useT } from "../../i18n";
import { presetLabels } from "../presets/labels";
import { ContextualToolbar } from "../selection/ContextualToolbar";
import { nodeScreenRect, placeToolbar } from "../selection/placement";
import { isReferenceAsset } from "../selection/selection";
import { draftSourceOf, useSelection } from "../selection/useSelection";
import { viewerSetFor } from "../selection/viewerSet";
import { useWorkspaceLayout } from "../workspace/layout";

const SAVE_DELAY_MS = 600;
/** From this many nodes only the visible ones render (large projects stay responsive). */
const VIRTUALIZE_FROM = 100;

type NodeData = {
  node: BranchNode;
  asset?: AssetDTO;
  generation?: GenerationDTO;
};
type FlowNode = Node<NodeData>;

/**
 * Node Canvas (ADR-041, V6.1 ADR-044): images → generations → outputs, derived from the
 * project's lineage. Selection lives in the store (`canvasSelection`) so the floating toolbar,
 * the inspector and the viewer all follow it, and the pan/zoom is kept per project so leaving
 * and coming back (or opening the viewer) restores the same view. Nothing here spends credit:
 * actions go through the registry, and paid ones through the spend confirm.
 */
export function BranchCanvas() {
  const t = useT();
  const ws = useStudio((s) => s.workspace!);
  const draft = useStudio((s) => s.generateDraft);
  const readOnly = useStudio(selectReadOnly);
  const selection = useStudio((s) => s.canvasSelection);
  const setSelection = useStudio((s) => s.setCanvasSelection);
  const projectId = ws.project.id;
  const savedViewport = useStudio((s) => s.nodeViewport[projectId]);

  const [layout, setLayout] = useState<CanvasLayout | null>(null);
  const [dragged, setDragged] = useState<Record<string, CanvasPosition>>({});
  // Sizes React Flow measured. Passing them back keeps rebuilt node objects measured, so a
  // selection change never hides a node for a frame (that broke double clicks).
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read once: the canvas owns its viewport while mounted; the store only remembers it.
  const [initialViewport] = useState(savedViewport);

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
  const draftSource = draftSourceOf(draft, ws.project.activeMasterAssetId ?? null);
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
  // Node data keeps its identity across selection changes, so selecting a node never makes
  // React Flow re-measure (and briefly hide) it between the two clicks of a double click.
  const dataById = useMemo(
    () =>
      new Map<string, NodeData>(
        graph.nodes.map((node) => [
          node.id,
          {
            node,
            asset: node.kind === "image" ? assets.get(node.assetId) : undefined,
            generation: node.kind === "generation" ? generations.get(node.generationId) : undefined,
          },
        ]),
      ),
    [graph, assets, generations],
  );
  const nodes: FlowNode[] = useMemo(
    () =>
      graph.nodes.map((node) => ({
        id: node.id,
        type: node.kind,
        position: dragged[node.id] ?? positions[node.id] ?? { x: 0, y: 0 },
        selected: selection.includes(node.id),
        draggable: !readOnly && node.kind !== "draft",
        data: dataById.get(node.id)!,
        ...(measured[node.id] ? { measured: measured[node.id] } : {}),
      })),
    [graph, dragged, positions, selection, readOnly, dataById, measured],
  );
  const edges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.from,
        target: e.to,
        className: e.primary ? "branch-edge" : "branch-edge branch-edge-secondary",
        animated: e.to === "draft",
      })),
    [graph],
  );

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
    let next = useStudio.getState().canvasSelection;
    for (const change of changes) {
      if (change.type === "dimensions" && change.dimensions) {
        const { id, dimensions } = change;
        setMeasured((m) =>
          m[id]?.width === dimensions.width && m[id]?.height === dimensions.height
            ? m
            : { ...m, [id]: dimensions },
        );
      }
      if (change.type === "position" && change.position) {
        const { id, position } = change;
        setDragged((d) => ({ ...d, [id]: position }));
        if (change.dragging === false && layout) {
          persist({ ...layout, positions: { ...layout.positions, [id]: position } });
        }
      }
      if (change.type === "select") {
        next = change.selected
          ? [...next.filter((id) => id !== change.id), change.id]
          : next.filter((id) => id !== change.id);
      }
    }
    if (next !== useStudio.getState().canvasSelection) {
      setSelection(next);
      // One image node selected: Studio, the tray and the inspector follow it.
      const only = next.length === 1 && next[0]!.startsWith("asset:") ? next[0]! : null;
      if (only) useStudio.getState().selectAsset(only.slice("asset:".length), { keepView: true });
    }
  };

  const rearrange = () => {
    setDragged({});
    persist({ version: 1, positions: {} });
  };

  const openLarge = (node: FlowNode) => {
    if (node.data.node.kind !== "image") return;
    const id = node.data.node.assetId;
    const assetIds = viewerSetFor(id, ws.assets, ws.generations);
    useStudio
      .getState()
      .openViewer({ assetIds, index: Math.max(0, assetIds.indexOf(id)), compareWithId: null });
  };

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
            onNodeDoubleClick={(_event, node) => openLarge(node)}
            onMoveEnd={(_event, viewport) =>
              useStudio.getState().setNodeViewport(projectId, viewport)
            }
            nodesConnectable={false}
            multiSelectionKeyCode="Shift"
            {...(initialViewport ? { defaultViewport: initialViewport } : { fitView: true })}
            minZoom={0.2}
            onlyRenderVisibleElements={graph.nodes.length >= VIRTUALIZE_FROM}
            zoomOnDoubleClick={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} />
            <Controls position="top-right" showInteractive={false} />
            <FloatingNodeToolbar />
          </ReactFlow>
        </div>
      )}
      {graph.nodes.length === 0 && <StaticToolbar />}
    </div>
  );
}

/** Nothing on the canvas yet: the "nothing selected" actions, pinned top-left. */
function StaticToolbar() {
  const selection = useSelection();
  return <ContextualToolbar selection={selection} className="is-static" />;
}

/**
 * Toolbar over the last selected node (ADR-044): follows pan, zoom and drags, prefers the
 * space above the node, falls back below, and is clamped inside the canvas. With nothing
 * selected it sits at the top-left corner, clear of the zoom controls.
 */
function FloatingNodeToolbar() {
  const selection = useSelection();
  const layout = useWorkspaceLayout();
  const anchorId = useStudio((s) => s.canvasSelection.at(-1) ?? null);
  const internal = useInternalNode(anchorId ?? "");
  const transform = useStore((s) => s.transform);
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const ref = useRef<HTMLDivElement>(null);
  const size = useElementSize(ref);
  const maxVisible = layout.tier === "wide" || layout.tier === "regular" ? 4 : 3;

  let style: CSSProperties = { left: 8, top: 8 };
  let menuUp = false;
  if (anchorId && internal && selection.kind !== "none") {
    const rect = nodeScreenRect(
      internal.internals.positionAbsolute,
      {
        width: internal.measured.width ?? 0,
        height: internal.measured.height ?? 0,
      },
      transform,
    );
    const place = placeToolbar(rect, size, { width, height });
    style = { left: place.left, top: place.top };
    menuUp = place.side === "below" && place.top > height / 2;
  }
  return (
    <ContextualToolbar
      ref={ref}
      selection={selection}
      maxVisible={maxVisible}
      menuUp={menuUp}
      className="is-floating"
      style={style}
    />
  );
}

function ImageNodeView({ data }: NodeProps<FlowNode>) {
  const t = useT();
  const node = data.node as Extract<BranchNode, { kind: "image" }>;
  const thumb = fileUrl(data.asset?.thumbnailPath ?? data.asset?.absolutePath);
  return (
    <div className="branch-node branch-node-image" data-node={node.id}>
      <Handle type="target" position={Position.Left} />
      <div className="branch-thumb">
        {thumb ? <img src={thumb} alt="" loading="lazy" decoding="async" /> : null}
        {data.asset && isVideoAsset(data.asset) && (
          <VideoBadge durationMs={data.asset.durationMs} />
        )}
      </div>
      <div className="branch-node-label" title={node.label}>
        {deepAiChain(node) && <AlertTriangle size={11} aria-label={t("branches.deepChain")} />}{" "}
        {node.label}
      </div>
      {isReferenceAsset(node) && (
        <span className="branch-role" data-testid="branch-role">
          <RoleBadge role={node.role} short />
        </span>
      )}
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
      {(node.status === "queued" || node.status === "running") && (
        <div className="branch-pending field-hint">{t("branches.noResultYet")}</div>
      )}
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
      <div className="branch-node-head">
        {t("branches.draft")} <span className="field-hint">· {t("branches.notCreated")}</span>
      </div>
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
