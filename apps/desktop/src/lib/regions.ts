/** UI stand-ins for the Phase 7 domain region helpers (TODO(p7-domain)). */
import type { ProjectDNA } from "@arch/domain";

export type RegionKind = "object" | "zone" | "material";
export type SceneObjectCategory =
  "wall" | "roof" | "window" | "door" | "floor" | "landscape" | "furniture" | "sky" | "other";
export type SceneRelationType = "on" | "next_to" | "inside" | "above" | "below";
export type RegionShape =
  | { type: "rect"; x: number; y: number; w: number; h: number }
  | { type: "polygon"; points: [number, number][] }
  | { type: "brush"; strokes: { points: [number, number][]; radius: number }[] };

export type SceneObject = {
  id: string;
  name: string;
  category: SceneObjectCategory;
  material?: string;
  relations: { type: SceneRelationType; targetId: string }[];
};
export type SceneDNA = { schemaVersion: 1; objects: SceneObject[] };
export type RegionDTO = {
  id: string;
  projectId: string;
  assetId: string;
  label: string;
  kind: RegionKind;
  objectId: string | null;
  shape: RegionShape;
  createdAt: string;
  updatedAt: string;
};
export type RegionDraft = Omit<
  RegionDTO,
  "id" | "projectId" | "assetId" | "createdAt" | "updatedAt"
> & {
  id?: string;
};
export type RegionEditParams = {
  regionIds: string[];
  instruction: string;
  mode: "edit" | "material_replace";
  material?: string;
};
export type RegionPromptBundle = {
  compilerVersion: "pc-1.3.0";
  positivePrompt: string;
  negativePrompt: string;
  referenceInstructions: string;
  preservationInstructions: string;
  metadata: Record<string, string>;
};

const ULID_CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function ulid(): string {
  let value = Date.now().toString(32).toUpperCase().padStart(10, "0").slice(-10);
  for (let i = 0; i < 16; i++) value += ULID_CHARS[Math.floor(Math.random() * ULID_CHARS.length)];
  return value.replace(/[ILOU]/g, "X");
}
export const newRegionId = () => `RGN_${ulid()}`;
export const newSceneObjectId = () => `OBJ_${ulid()}`;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const distanceToSegment = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) => {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

/** Rasterise normalised shapes using pixel centres and an even-odd polygon fill. */
export function rasterizeMask(
  shapes: readonly RegionShape[],
  width: number,
  height: number,
): Uint8Array {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  const output = new Uint8Array(w * h);
  const insidePolygon = (x: number, y: number, points: readonly [number, number][]) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i]!;
      const [xj, yj] = points[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  for (let py = 0; py < h; py++) {
    const y = (py + 0.5) / Math.max(1, h);
    for (let px = 0; px < w; px++) {
      const x = (px + 0.5) / Math.max(1, w);
      let hit = false;
      for (const shape of shapes) {
        if (shape.type === "rect") {
          const x0 = clamp01(Math.min(shape.x, shape.x + shape.w));
          const x1 = clamp01(Math.max(shape.x, shape.x + shape.w));
          const y0 = clamp01(Math.min(shape.y, shape.y + shape.h));
          const y1 = clamp01(Math.max(shape.y, shape.y + shape.h));
          hit ||= x >= x0 && x <= x1 && y >= y0 && y <= y1;
        } else if (shape.type === "polygon") {
          hit ||= shape.points.length >= 3 && insidePolygon(x, y, shape.points);
        } else {
          const pointX = px + 0.5;
          const pointY = py + 0.5;
          const longEdge = Math.max(w, h);
          hit ||= shape.strokes.some((stroke) => {
            const radius = Math.max(0, stroke.radius) * longEdge;
            return stroke.points.some((point, index) => {
              const ax = clamp01(point[0]) * w;
              const ay = clamp01(point[1]) * h;
              if (distanceToSegment(pointX, pointY, ax, ay, ax, ay) <= radius) return true;
              const next = stroke.points[index + 1];
              if (!next) return false;
              return (
                distanceToSegment(
                  pointX,
                  pointY,
                  ax,
                  ay,
                  clamp01(next[0]) * w,
                  clamp01(next[1]) * h,
                ) <= radius
              );
            });
          });
        }
        if (hit) break;
      }
      if (hit) output[py * w + px] = 255;
    }
  }
  return output;
}

/** Three repeated box-blur passes, matching the Phase 7 feathering contract. */
export function featherMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radiusPx: number,
): Uint8Array {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  if (w * h !== mask.length || !mask.length || radiusPx <= 0) return new Uint8Array(mask);
  const radius = Math.max(1, Math.round(radiusPx));
  let current = new Uint8Array(mask);
  for (let pass = 0; pass < 3; pass++) {
    const next = new Uint8Array(current.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let count = 0;
        for (let yy = Math.max(0, y - radius); yy <= Math.min(h - 1, y + radius); yy++) {
          for (let xx = Math.max(0, x - radius); xx <= Math.min(w - 1, x + radius); xx++) {
            sum += current[yy * w + xx]!;
            count++;
          }
        }
        next[y * w + x] = Math.round(sum / count);
      }
    }
    current = next;
  }
  return current;
}

export function sceneObjectLines(
  dna: Partial<Pick<ProjectDNA, "locks">> & { scene?: SceneDNA },
): string[] {
  const objects = dna.scene?.objects ?? [];
  const pinned = new Set(dna.locks?.objectIds ?? []);
  return objects
    .filter((object) => pinned.has(object.id))
    .map(
      (object) =>
        `Preserve pinned object "${object.name}" (${object.category})${object.material ? `, material ${object.material}` : ""}.`,
    );
}

export function buildRegionEditPrompt(input: {
  dna: Partial<Pick<ProjectDNA, "locks">> & { scene?: SceneDNA };
  regions: readonly Pick<RegionDTO, "id" | "label" | "kind" | "objectId">[];
  params: RegionEditParams;
  nativeMask: boolean;
}): RegionPromptBundle {
  const selected = input.regions.filter((region) => input.params.regionIds.includes(region.id));
  const labels =
    selected.map((region) => region.label || region.kind).join(", ") || "the selected region";
  const objectNames = selected
    .map((region) => input.dna.scene?.objects.find((object) => object.id === region.objectId)?.name)
    .filter((name): name is string => Boolean(name));
  const target = objectNames.length ? `${labels} (${objectNames.join(", ")})` : labels;
  const operation =
    input.params.mode === "material_replace"
      ? `Replace the material in ${target} with ${input.params.material ?? "the requested material"}.`
      : input.params.instruction.trim() || `Edit ${target}.`;
  const maskNote = input.nativeMask
    ? "Use the supplied native mask; transparent alpha (0) is the area to edit."
    : "The second image is a white-on-black mask; white is the area to edit.";
  const preservation = [
    "Keep everything outside the selected region untouched, including geometry, camera and composition.",
    maskNote,
    ...sceneObjectLines(input.dna),
  ].join(" ");
  return {
    compilerVersion: "pc-1.3.0",
    positivePrompt: `${operation} ${maskNote}`,
    negativePrompt: "",
    referenceInstructions: "The source image is the only reference image.",
    preservationInstructions: preservation,
    metadata: { purpose: "region_edit", regionIds: input.params.regionIds.join(",") },
  };
}

export function buildRegionGenerationRequest(input: {
  projectId: string;
  providerId: string;
  modelId: string;
  sourceAssetId: string;
  params: RegionEditParams;
  dna: Partial<Pick<ProjectDNA, "locks">> & { scene?: SceneDNA };
  regions: readonly Pick<RegionDTO, "id" | "label" | "kind" | "objectId">[];
  nativeMask: boolean;
}) {
  const prompt = buildRegionEditPrompt({
    dna: input.dna,
    regions: input.regions,
    params: input.params,
    nativeMask: input.nativeMask,
  });
  return {
    projectId: input.projectId,
    providerId: input.providerId,
    modelId: input.modelId,
    purpose: "region_edit" as const,
    prompt,
    referenceAssetIds: [input.sourceAssetId],
    params: {
      aspectRatio: null,
      imageSize: null,
      outputCount: 1,
      seed: null,
      quality: null,
      region: input.params,
    },
    cameraId: null,
  };
}

export const isRegionResponseCurrent = (
  projectId: string,
  assetId: string,
  responseProjectId: string | undefined,
  responseAssetId: string | undefined,
) => projectId === responseProjectId && assetId === responseAssetId;

export function normalisePoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): [number, number] {
  return [
    clamp01((clientX - rect.left) / Math.max(1, rect.width)),
    clamp01((clientY - rect.top) / Math.max(1, rect.height)),
  ];
}
