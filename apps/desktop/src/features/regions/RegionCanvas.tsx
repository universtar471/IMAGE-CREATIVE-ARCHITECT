import {
  Eye,
  EyeOff,
  MousePointer2,
  Pencil,
  Pentagon,
  RectangleHorizontal,
  WandSparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceCanvas } from "../../components/canvas/WorkspaceCanvas";
import type { ImageDisplayRect } from "../../components/canvas/ImageViewer";
import { call } from "../../lib/bridge";
import {
  isRegionResponseCurrent,
  normalisePoint,
  rasterizeMask,
  type RegionDTO,
  type RegionDraft,
  type RegionShape,
} from "../../lib/regions";
import { useStudio } from "../../app/store";
import { useT } from "../../i18n";

type Tool = "select" | "rect" | "polygon" | "brush";
type DrawState =
  | { kind: "rect"; start: [number, number]; current: [number, number] }
  | { kind: "polygon"; points: [number, number][] }
  | { kind: "brush"; points: [number, number][] };

const defaultLabel = (tool: Tool, count: number) =>
  `${tool === "rect" ? "Rectangle" : tool === "polygon" ? "Polygon" : "Brush"} ${count + 1}`;

function shapeBounds(shape: RegionShape) {
  if (shape.type === "rect") return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  const points =
    shape.type === "polygon" ? shape.points : shape.strokes.flatMap((stroke) => stroke.points);
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

function pointInShape(
  [x, y]: [number, number],
  shape: RegionShape,
  width: number,
  height: number,
): boolean {
  if (shape.type === "rect")
    return x >= shape.x && x <= shape.x + shape.w && y >= shape.y && y <= shape.y + shape.h;
  if (shape.type === "polygon") {
    let inside = false;
    for (let i = 0, j = shape.points.length - 1; i < shape.points.length; j = i++) {
      const [xi, yi] = shape.points[i]!;
      const [xj, yj] = shape.points[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const scale = Math.max(width, height);
  const px = x * width;
  const py = y * height;
  return shape.strokes.some((stroke) => {
    const radius = stroke.radius * scale;
    const points = stroke.points.map(([sx, sy]) => [sx * width, sy * height] as const);
    return points.some(([sx, sy], index) => {
      const next = points[index + 1] ?? [sx, sy];
      const [ex, ey] = next;
      const dx = ex - sx;
      const dy = ey - sy;
      const t =
        dx === 0 && dy === 0
          ? 0
          : Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(px - (sx + t * dx), py - (sy + t * dy)) <= radius;
    });
  });
}

export function RegionCanvas() {
  const ws = useStudio((state) => state.workspace!);
  const selectedId = useStudio((state) => state.selectedAssetId) ?? ws.project.activeMasterAssetId;
  const asset = ws.assets.find((item) => item.id === selectedId) ?? null;
  const t = useT();
  const [tool, setTool] = useState<Tool>("select");
  const [brushSize, setBrushSize] = useState(0.04);
  const [maskVisible, setMaskVisible] = useState(false);
  const [regions, setRegions] = useState<RegionDTO[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draw, setDraw] = useState<DrawState | null>(null);
  const loadToken = useRef(0);
  const saveTimers = useRef(new Map<string, number>());
  const projectId = ws.project.id;

  const load = useCallback(async () => {
    if (!selectedId) return;
    const token = ++loadToken.current;
    const result = (await call("region_list", { projectId, assetId: selectedId }).catch(
      () => [],
    )) as RegionDTO[];
    const current = useStudio.getState();
    if (
      token === loadToken.current &&
      isRegionResponseCurrent(
        projectId,
        selectedId,
        current.workspace?.project.id,
        current.selectedAssetId ?? current.workspace?.project.activeMasterAssetId ?? undefined,
      )
    )
      setRegions(result);
  }, [projectId, selectedId]);

  useEffect(() => {
    const tokenRef = loadToken;
    const timers = saveTimers.current;
    void load();
    return () => {
      tokenRef.current++;
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, [load]);

  const save = useCallback(
    (draft: RegionDraft) => {
      if (!selectedId) return;
      const key = draft.id ?? `new-${JSON.stringify(draft.shape)}`;
      const previous = saveTimers.current.get(key);
      if (previous) window.clearTimeout(previous);
      const timer = window.setTimeout(() => {
        const requestToken = ++loadToken.current;
        void call("region_save", { projectId, assetId: selectedId, region: draft })
          .then((saved) => {
            const current = useStudio.getState();
            if (
              requestToken !== loadToken.current ||
              !isRegionResponseCurrent(
                projectId,
                selectedId,
                current.workspace?.project.id,
                current.selectedAssetId ??
                  current.workspace?.project.activeMasterAssetId ??
                  undefined,
              )
            )
              return;
            setRegions((items) => {
              const without = items.filter((item) => item.id !== saved.id);
              return [saved as RegionDTO, ...without];
            });
          })
          .catch(() => undefined);
      }, 250);
      saveTimers.current.set(key, timer);
    },
    [projectId, selectedId],
  );

  const finishDraw = useCallback(
    (shape: RegionShape) => {
      const draft: RegionDraft = {
        label: defaultLabel(tool, regions.length),
        kind: "zone",
        objectId: null,
        shape,
      };
      save(draft);
      setDraw(null);
    },
    [regions.length, save, tool],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDraw(null);
      if (event.key === "Enter" && draw?.kind === "polygon" && draw.points.length >= 3)
        finishDraw({ type: "polygon", points: draw.points });
      if (event.key === "Delete" && selected.size) {
        const ids = [...selected];
        setRegions((items) => items.filter((item) => !selected.has(item.id)));
        setSelected(new Set());
        for (const id of ids)
          void call("region_delete", { projectId, regionId: id }).catch(() => undefined);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draw, finishDraw, projectId, selected]);

  const mask = useMemo(() => {
    if (!maskVisible || !asset) return null;
    return rasterizeMask(
      regions
        .filter((region) => selected.size === 0 || selected.has(region.id))
        .map((region) => region.shape),
      asset.widthPx ?? 1,
      asset.heightPx ?? 1,
    );
  }, [asset, maskVisible, regions, selected]);
  const maskPreviewRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = maskPreviewRef.current;
    if (!canvas || !mask || !asset) return;
    canvas.width = asset.widthPx ?? 1;
    canvas.height = asset.heightPx ?? 1;
    const context = canvas.getContext("2d");
    if (!context) return;
    const pixels = new Uint8ClampedArray(mask.length * 4);
    for (let i = 0; i < mask.length; i += 1) {
      pixels[i * 4] = 248;
      pixels[i * 4 + 1] = 113;
      pixels[i * 4 + 2] = 113;
      pixels[i * 4 + 3] = Math.round((mask[i]! / 255) * 92);
    }
    context.putImageData(new ImageData(pixels, canvas.width, canvas.height), 0, 0);
  }, [asset, mask]);

  const overlay = (rect: ImageDisplayRect) => {
    const toPx = (point: [number, number]) =>
      [rect.left + point[0] * rect.width, rect.top + point[1] * rect.height] as const;
    return (
      <div
        className="region-overlay"
        data-testid="region-overlay"
        style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        onPointerDown={(event) => {
          event.stopPropagation();
          const point = normalisePoint(event.clientX, event.clientY, rect);
          if (tool === "select") {
            const hit = regions.find((region) =>
              pointInShape(point, region.shape, asset?.widthPx ?? 1, asset?.heightPx ?? 1),
            );
            setSelected((current) => (hit ? new Set(current).add(hit.id) : new Set()));
          } else if (tool === "rect") setDraw({ kind: "rect", start: point, current: point });
          else if (tool === "polygon")
            setDraw((current) =>
              current?.kind === "polygon"
                ? { kind: "polygon", points: [...current.points, point] }
                : { kind: "polygon", points: [point] },
            );
          else setDraw({ kind: "brush", points: [point] });
          (event.currentTarget as Element).setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!draw) return;
          event.stopPropagation();
          const point = normalisePoint(event.clientX, event.clientY, rect);
          if (draw.kind === "rect") setDraw({ ...draw, current: point });
          if (draw.kind === "brush") setDraw({ ...draw, points: [...draw.points, point] });
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
          if (!draw) return;
          const point = normalisePoint(event.clientX, event.clientY, rect);
          if (draw.kind === "rect")
            finishDraw({
              type: "rect",
              x: Math.min(draw.start[0], point[0]),
              y: Math.min(draw.start[1], point[1]),
              w: Math.abs(point[0] - draw.start[0]),
              h: Math.abs(point[1] - draw.start[1]),
            });
          else if (draw.kind === "brush")
            finishDraw({ type: "brush", strokes: [{ points: draw.points, radius: brushSize }] });
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (draw?.kind === "polygon" && draw.points.length >= 3)
            finishDraw({ type: "polygon", points: draw.points });
        }}
      >
        {regions.map((region) => {
          const bounds = shapeBounds(region.shape);
          const [left, top] = toPx([bounds.x, bounds.y]);
          return (
            <span
              key={region.id}
              data-testid={`region-${region.id}`}
              data-shape-type={region.shape.type}
              className={`region-mark ${selected.has(region.id) ? "is-selected" : ""}`}
              style={{
                left: left - rect.left,
                top: top - rect.top,
                width: bounds.w * rect.width,
                height: bounds.h * rect.height,
              }}
            >
              <span>{region.label}</span>
            </span>
          );
        })}
        {draw?.kind === "rect" && (
          <span
            className="region-drawing"
            style={{
              left: Math.min(draw.start[0], draw.current[0]) * rect.width,
              top: Math.min(draw.start[1], draw.current[1]) * rect.height,
              width: Math.abs(draw.current[0] - draw.start[0]) * rect.width,
              height: Math.abs(draw.current[1] - draw.start[1]) * rect.height,
            }}
          />
        )}
        {draw?.kind === "polygon" && (
          <svg className="region-drawing-svg" viewBox="0 0 1 1" preserveAspectRatio="none">
            <polyline points={draw.points.map((point) => point.join(",")).join(" ")} />
          </svg>
        )}
        {draw?.kind === "brush" && (
          <span
            className="region-brush-cursor"
            style={{
              left: draw.points.at(-1)?.[0] ? `${draw.points.at(-1)![0] * 100}%` : 0,
              top: draw.points.at(-1)?.[1] ? `${draw.points.at(-1)![1] * 100}%` : 0,
            }}
          />
        )}
        {mask && asset && (
          <canvas
            ref={maskPreviewRef}
            className="region-mask-preview"
            data-testid="mask-preview"
            data-mask-bytes={mask.length}
          />
        )}
      </div>
    );
  };

  return (
    <WorkspaceCanvas
      mode={{ kind: "single", asset }}
      overlay={overlay}
      extraTools={
        <RegionTools
          tool={tool}
          setTool={setTool}
          brushSize={brushSize}
          setBrushSize={setBrushSize}
          maskVisible={maskVisible}
          setMaskVisible={setMaskVisible}
          t={t}
        />
      }
    />
  );
}

function RegionTools({
  tool,
  setTool,
  brushSize,
  setBrushSize,
  maskVisible,
  setMaskVisible,
  t,
}: {
  tool: Tool;
  setTool: (tool: Tool) => void;
  brushSize: number;
  setBrushSize: (size: number) => void;
  maskVisible: boolean;
  setMaskVisible: (visible: boolean) => void;
  t: ReturnType<typeof useT>;
}) {
  return (
    <div className="region-tools" role="toolbar" aria-label={t("regions.tool")}>
      <button
        className={`btn btn-ghost btn-sm btn-icon ${tool === "select" ? "is-active" : ""}`}
        onClick={() => setTool("select")}
        title={t("regions.select")}
        aria-label={t("regions.select")}
      >
        <MousePointer2 size={13} />
      </button>
      <button
        className={`btn btn-ghost btn-sm btn-icon ${tool === "rect" ? "is-active" : ""}`}
        onClick={() => setTool("rect")}
        title={t("regions.rectangle")}
        aria-label={t("regions.rectangle")}
      >
        <RectangleHorizontal size={13} />
      </button>
      <button
        className={`btn btn-ghost btn-sm btn-icon ${tool === "polygon" ? "is-active" : ""}`}
        onClick={() => setTool("polygon")}
        title={t("regions.polygon")}
        aria-label={t("regions.polygon")}
      >
        <Pentagon size={13} />
      </button>
      <button
        className={`btn btn-ghost btn-sm btn-icon ${tool === "brush" ? "is-active" : ""}`}
        onClick={() => setTool("brush")}
        title={t("regions.brush")}
        aria-label={t("regions.brush")}
      >
        <Pencil size={13} />
      </button>
      {tool === "brush" && (
        <label className="region-brush-size">
          <span>{t("regions.brushSize")}</span>
          <input
            type="range"
            min="0.005"
            max="0.2"
            step="0.005"
            value={brushSize}
            onChange={(event) => setBrushSize(Number(event.target.value))}
          />
        </label>
      )}
      <button
        className="btn btn-ghost btn-sm"
        disabled
        title={t("regions.autoSelectLater")}
        aria-label={t("regions.autoSelectLater")}
      >
        <WandSparkles size={13} /> {t("regions.autoSelect")}
      </button>
      <button
        className="btn btn-ghost btn-sm btn-icon"
        onClick={() => setMaskVisible(!maskVisible)}
        title={maskVisible ? t("regions.hideMask") : t("regions.showMask")}
        aria-label={maskVisible ? t("regions.hideMask") : t("regions.showMask")}
      >
        <>{maskVisible ? <EyeOff size={13} /> : <Eye size={13} />}</>
      </button>
    </div>
  );
}
