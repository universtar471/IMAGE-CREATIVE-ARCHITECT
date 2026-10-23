/** Geometric preview only. No photos, network calls, depth estimation or paid rendering. */
import { useRef, type PointerEvent } from "react";
import { useT } from "../../i18n";
import type { CameraPose, CameraScope } from "./multiAngleModel";
import { cameraPosition, normalizeCameraPose } from "./multiAngleModel";

export type OrbitViewportProps = {
  scope: CameraScope;
  bounds?: { widthM: number; depthM: number };
  pose: CameraPose;
  disabled?: boolean;
  onChange: (next: CameraPose) => void;
  onCommit?: () => void;
  label: string;
};

export function OrbitViewport({
  scope,
  bounds = scope === "building" ? { widthM: 12, depthM: 10 } : { widthM: 5, depthM: 4 },
  pose,
  disabled = false,
  onChange,
  onCommit,
  label,
}: OrbitViewportProps) {
  const t = useT();
  const drag = useRef<{ x: number; y: number; origin: CameraPose; pointerId: number } | null>(null);
  const scale = Math.min(
    65 / Math.max(bounds.widthM, bounds.depthM, 1),
    75 / Math.max(pose.distanceM, 1),
  );
  const shapeScale = scale;
  const height = (scope === "building" ? Math.max(bounds.widthM, bounds.depthM) * 0.6 : 3) * scale;
  const w = bounds.widthM * shapeScale;
  const d = bounds.depthM * shapeScale;
  const floor = [
    [150 - w, 138],
    [150, 138 - d * 0.5],
    [150 + w, 138],
    [150, 138 + d * 0.5],
  ];
  const points = (indices: number[], height = 0) =>
    indices.map((i) => `${floor[i]![0]},${floor[i]![1]! - height}`).join(" ");
  const wall = (a: number, b: number) => `${points([a, b])} ${points([b, a], height)}`;
  const position = cameraPosition(pose);
  const projectedX = 150 + Math.max(-86, Math.min(86, position.x * scale));
  const projectedY =
    138 + Math.max(-50, Math.min(50, position.y * scale * 0.4)) - position.z * scale * 0.5;

  function pointerStart(event: PointerEvent<SVGSVGElement>) {
    if (disabled || event.button !== 0 || drag.current) return;
    drag.current = { x: event.clientX, y: event.clientY, origin: pose, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!drag.current || disabled || drag.current.pointerId !== event.pointerId) return;
    const { x, y, origin } = drag.current;
    onChange(
      normalizeCameraPose(
        {
          ...origin,
          azimuthDeg: Math.round((origin.azimuthDeg + (event.clientX - x) * 0.5) * 10) / 10,
          elevationDeg: Math.round((origin.elevationDeg - (event.clientY - y) * 0.35) * 10) / 10,
        },
        scope,
      ),
    );
  }
  function pointerEnd(event: PointerEvent<SVGSVGElement>) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    onCommit?.();
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <svg
      viewBox="0 0 300 210"
      className="multi-angle-viewport"
      role="img"
      aria-label={label}
      style={{
        width: "100%",
        minHeight: 200,
        display: "block",
        cursor: disabled ? "default" : "grab",
        touchAction: "none",
      }}
      onPointerDown={pointerStart}
      onPointerMove={pointerMove}
      onPointerUp={pointerEnd}
      onPointerCancel={pointerEnd}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
    >
      <rect x="0" y="0" width="300" height="210" rx="10" fill="var(--surface-secondary, #20242a)" />
      <ellipse
        cx="150"
        cy="151"
        rx="104"
        ry="37"
        fill="none"
        stroke="#55aa88"
        strokeDasharray="5 4"
        strokeWidth="1.5"
      />
      <g
        stroke="#a8b5c1"
        strokeWidth="1.5"
        data-testid="orbit-proxy"
        data-width-m={bounds.widthM}
        data-depth-m={bounds.depthM}
      >
        <polygon points={points([0, 1, 2, 3])} fill="#46546a" />
        {scope === "building" ? (
          <>
            <polygon points={wall(0, 3)} fill="#64748b" />
            <polygon points={wall(3, 2)} fill="#94a3b8" />
            <polygon points={points([0, 1, 2, 3], height)} fill="#7b8ca0" />
          </>
        ) : (
          <>
            <polygon points={wall(0, 1)} fill="#7b8ca0" />
            <polygon points={wall(1, 2)} fill="#8a9cad" />
            <path d="M129 142 L155 128 L176 139 L150 153Z" fill="#d3b18a" stroke="none" />
          </>
        )}
      </g>
      <polygon
        points={`${projectedX},${projectedY} 128,119 172,139`}
        fill="#a3e635"
        opacity="0.15"
      />
      <path
        d={`M${projectedX.toFixed(1)} ${projectedY.toFixed(1)} L150 129`}
        stroke="#a3e635"
        strokeWidth="2"
        strokeDasharray="4 3"
      />
      <g transform={`translate(${projectedX.toFixed(1)},${projectedY.toFixed(1)})`}>
        <rect
          x="-10"
          y="-6"
          width="20"
          height="12"
          rx="3"
          fill="#3b82f6"
          stroke="#bfdbfe"
          strokeWidth="1.4"
        />
        <circle r="3.2" fill="#bfdbfe" />
      </g>
      <text x="10" y="18" fontSize="10" fill="#cbd5e1">
        {t("multiAngle.estimated")}
      </text>
      <text x="290" y="196" fontSize="10" fill="#cbd5e1" textAnchor="end">
        {Number(pose.azimuthDeg.toFixed(2))}° · {Number(pose.elevationDeg.toFixed(2))}°
      </text>
    </svg>
  );
}
