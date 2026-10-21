/**
 * Camera Director: top-down plan of the building footprint with every camera, its view cone
 * and elevation. Drag a camera (or use the arrow keys on a focused one) to change its
 * azimuth and distance; click selects it (synced with the camera list).
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Camera } from "lucide-react";
import type { CameraDNA } from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { EmptyState } from "../../components/common/states";
import { useT, type TFunction } from "../../i18n";
import {
  cameraPlacement,
  footprintOf,
  horizontalFovDeg,
  nudge,
  planHalfExtent,
  snapPosition,
  viewCone,
  type PlanPoint,
} from "./geometry";

export function CameraDirector() {
  const dna = useStudio((s) => s.workspace!.draftDna);
  const anchors = useStudio((s) => s.workspace!.anchors);
  const selectedId = useStudio((s) => s.selectedCameraId);
  const selectCamera = useStudio((s) => s.selectCamera);
  const setCameras = useStudio((s) => s.setCameras);
  const readOnly = useStudio(selectReadOnly);
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: string; extent: number } | null>(null);
  const t = useT();

  const cameras = dna.cameras;
  const fp = footprintOf(dna);
  const placements = cameras.map((c) => cameraPlacement(c, fp));
  // While dragging, keep the frame fixed so the camera does not run away from the pointer.
  const extent = drag?.extent ?? planHalfExtent(placements, fp);
  const unit = extent / 50; // ~1/100 of the view: base size for icons and text

  const move = (id: string, next: { azimuthDeg: number; distanceM: number }) =>
    setCameras(
      cameras.map((c) =>
        c.id === id ? { ...c, azimuthDeg: next.azimuthDeg, distanceM: next.distanceM } : c,
      ),
    );

  const toPlan = (e: PointerEvent): PlanPoint | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  };

  if (!cameras.length) {
    return (
      <EmptyState icon={<Camera size={32} />} title={t("director.empty")}>
        {t("director.emptyHint")}
      </EmptyState>
    );
  }

  return (
    <div className="director" data-testid="camera-director">
      <svg
        ref={svgRef}
        className="director-svg"
        viewBox={`${-extent} ${-extent} ${extent * 2} ${extent * 2}`}
        role="group"
        aria-label={t("director.label")}
        onPointerMove={(e) => {
          if (!drag) return;
          const p = toPlan(e);
          if (p) move(drag.id, snapPosition(p));
        }}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
      >
        <DistanceRings extent={extent} unit={unit} />
        <rect
          className="director-footprint"
          x={-fp.widthM / 2}
          y={-fp.depthM / 2}
          width={fp.widthM}
          height={fp.depthM}
        />
        <line
          className="director-front"
          x1={-fp.widthM / 2}
          x2={fp.widthM / 2}
          y1={fp.depthM / 2}
          y2={fp.depthM / 2}
        />
        <text
          className="director-label"
          x={0}
          y={fp.depthM / 2 + unit * 3}
          fontSize={unit * 2.2}
          textAnchor="middle"
        >
          {t("director.front")}
        </text>
        <text
          className="director-hint"
          x={0}
          y={0}
          fontSize={unit * 1.8}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {fp.widthM} × {fp.depthM} m{fp.fromDna ? "" : t("director.defaultSize")}
        </text>

        {cameras.map((c, i) => (
          <CameraMark
            key={c.id}
            camera={c}
            pos={placements[i]!}
            unit={unit}
            selected={c.id === selectedId}
            anchored={anchors.some((a) => a.cameraId === c.id)}
            readOnly={readOnly}
            t={t}
            onSelect={() => selectCamera(c.id)}
            onDragStart={(e) => {
              selectCamera(c.id);
              if (readOnly) return;
              (e.target as Element).setPointerCapture?.(e.pointerId);
              setDrag({ id: c.id, extent });
            }}
            onKey={(e) => {
              if (readOnly) return;
              const p = placements[i]!;
              const next = nudge(p, e.key, e.shiftKey);
              if (!next) return;
              e.preventDefault();
              move(c.id, next);
            }}
          />
        ))}
      </svg>
      <div className="director-legend">
        <span>
          <i className="dot" /> {t("director.camera")}
        </span>
        <span>
          <i className="dot is-anchor-view" /> {t("director.anchorView")}
        </span>
        <span>
          <i className="dot is-anchored" /> {t("director.anchored")}
        </span>
        <span className="field-hint">{t("director.hint")}</span>
      </div>
    </div>
  );
}

function DistanceRings({ extent, unit }: { extent: number; unit: number }) {
  const step = extent > 60 ? 20 : extent > 25 ? 10 : 5;
  const rings: number[] = [];
  for (let r = step; r < extent; r += step) rings.push(r);
  return (
    <g className="director-rings" aria-hidden="true">
      {rings.map((r) => (
        <g key={r}>
          <circle r={r} />
          <text x={r * 0.71 + unit * 0.5} y={-r * 0.71} fontSize={unit * 1.5}>
            {r} m
          </text>
        </g>
      ))}
      <line x1={-extent} x2={extent} y1={0} y2={0} />
      <line x1={0} x2={0} y1={-extent} y2={extent} />
    </g>
  );
}

function CameraMark({
  camera: c,
  pos,
  unit,
  selected,
  anchored,
  readOnly,
  t,
  onSelect,
  onDragStart,
  onKey,
}: {
  camera: CameraDNA;
  pos: ReturnType<typeof cameraPlacement>;
  unit: number;
  selected: boolean;
  anchored: boolean;
  readOnly: boolean;
  t: TFunction;
  onSelect: () => void;
  onDragStart: (e: PointerEvent<SVGGElement>) => void;
  onKey: (e: KeyboardEvent<SVGGElement>) => void;
}) {
  const cone = viewCone(pos, horizontalFovDeg(c.lensMm), Math.max(pos.distanceM * 0.55, unit * 6));
  const r = unit * 1.8;
  const cls = [
    "director-camera",
    selected ? "is-selected" : "",
    c.isAnchorView ? "is-anchor-view" : "",
    anchored ? "is-anchored" : "",
    pos.placed ? "" : "is-unplaced",
  ]
    .filter(Boolean)
    .join(" ");
  const elevation =
    c.elevationDeg !== undefined
      ? `${Math.round(c.elevationDeg)}°`
      : c.heightM !== undefined
        ? `${c.heightM} m`
        : null;
  return (
    <g
      className={cls}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${t("director.markLabel", {
        name: c.name,
        azimuth: Math.round(pos.azimuthDeg),
        distance: pos.distanceM,
      })}${c.isAnchorView ? t("director.markAnchorView") : ""}${
        anchored ? t("director.markAnchored") : ""
      }${readOnly ? "" : t("director.markMove")}`}
      data-testid="director-camera"
      onPointerDown={onDragStart}
      onClick={onSelect}
      onKeyDown={onKey}
    >
      <polygon className="director-cone" points={cone.map((p) => `${p.x},${p.y}`).join(" ")} />
      {c.isAnchorView ? (
        <rect
          className="director-icon"
          x={pos.x - r}
          y={pos.y - r}
          width={r * 2}
          height={r * 2}
          transform={`rotate(45 ${pos.x} ${pos.y})`}
        />
      ) : (
        <circle className="director-icon" cx={pos.x} cy={pos.y} r={r} />
      )}
      {anchored && <circle className="director-anchored" cx={pos.x} cy={pos.y} r={r * 0.55} />}
      <text
        className="director-name"
        x={pos.x}
        y={pos.y + r + unit * 2.2}
        fontSize={unit * 1.9}
        textAnchor="middle"
      >
        {c.name}
      </text>
      {elevation && (
        <g className="director-elev">
          <rect
            x={pos.x + r * 0.9}
            y={pos.y - r * 2.1}
            width={unit * (elevation.length * 1.05 + 1.6)}
            height={unit * 2.3}
            rx={unit * 0.6}
          />
          <text
            x={pos.x + r * 0.9 + unit * 0.8}
            y={pos.y - r * 2.1 + unit * 1.7}
            fontSize={unit * 1.6}
          >
            ↑{elevation}
          </text>
        </g>
      )}
    </g>
  );
}
