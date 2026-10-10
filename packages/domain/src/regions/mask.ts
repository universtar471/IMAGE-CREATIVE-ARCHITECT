import type { RegionShape } from "./schemas";

type PixelPoint = [number, number];

/** Rasterise normalised shapes using pixel centres and a union (255 max). */
export function rasterizeMask(
  shapes: readonly RegionShape[],
  width: number,
  height: number,
): Uint8Array {
  assertSize(width, height);
  const output = new Uint8Array(width * height);
  for (const shape of shapes) {
    if (shape.type === "rect") {
      forEachPixel(width, height, (x, y, index) => {
        const nx = (x + 0.5) / width;
        const ny = (y + 0.5) / height;
        if (nx >= shape.x && nx <= shape.x + shape.w && ny >= shape.y && ny <= shape.y + shape.h)
          output[index] = 255;
      });
    } else if (shape.type === "polygon") {
      forEachPixel(width, height, (x, y, index) => {
        if (pointInPolygon((x + 0.5) / width, (y + 0.5) / height, shape.points))
          output[index] = 255;
      });
    } else {
      const radiusScale = Math.max(width, height);
      for (const stroke of shape.strokes) {
        const points = stroke.points.map(([x, y]) => [x * width, y * height] as PixelPoint);
        const radius = stroke.radius * radiusScale;
        forEachPixel(width, height, (x, y, index) => {
          const centre: PixelPoint = [x + 0.5, y + 0.5];
          for (let i = 0; i < points.length; i += 1) {
            const a = points[i]!;
            const b = points[i + 1] ?? a;
            if (distanceToSegment(centre, a, b) <= radius) {
              output[index] = 255;
              break;
            }
          }
        });
      }
    }
  }
  return output;
}

/** Apply a clamped box blur three times. Radius is measured in source pixels. */
export function featherMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radiusPx: number,
): Uint8Array {
  assertSize(width, height);
  if (mask.length !== width * height)
    throw new RangeError("Mask length does not match dimensions.");
  const radius = Math.max(0, Math.round(radiusPx));
  if (radius === 0) return new Uint8Array(mask);
  let current: Uint8Array<ArrayBufferLike> = new Uint8Array(mask);
  for (let pass = 0; pass < 3; pass += 1) current = boxBlur(current, width, height, radius);
  return current;
}

function boxBlur(input: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const horizontal = new Uint8Array(input.length);
  const size = radius * 2 + 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let dx = -radius; dx <= radius; dx += 1)
        sum += input[y * width + clamp(x + dx, 0, width - 1)]!;
      horizontal[y * width + x] = Math.round(sum / size);
    }
  }
  const output = new Uint8Array(input.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let dy = -radius; dy <= radius; dy += 1)
        sum += horizontal[clamp(y + dy, 0, height - 1) * width + x]!;
      output[y * width + x] = Math.round(sum / size);
    }
  }
  return output;
}

function pointInPolygon(x: number, y: number, points: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]!;
    const [xj, yj] = points[j]!;
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function distanceToSegment(
  [px, py]: PixelPoint,
  [ax, ay]: PixelPoint,
  [bx, by]: PixelPoint,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function forEachPixel(
  width: number,
  height: number,
  fn: (x: number, y: number, index: number) => void,
): void {
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) fn(x, y, y * width + x);
}
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
function assertSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    throw new RangeError("Mask dimensions must be positive integers.");
}
