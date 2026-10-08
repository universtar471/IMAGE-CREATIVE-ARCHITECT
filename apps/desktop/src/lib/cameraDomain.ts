/**
 * TODO(p3-domain): local stand-ins for the camera helpers, camera prompt section and batch
 * builders that P3-B builds in `packages/domain` (docs/agent-tasks/p3-domain.md). Same
 * names and call shapes, so the swap at merge is an import change. Keep this file small and
 * pure; delete it once `@arch/domain` exports these.
 */
import {
  compilePrompt,
  orderReferenceIds,
  sortReferences,
  type BatchItem,
  type CameraAnchorDTO,
  type CameraDNA,
  type CameraPreset,
  type GenerationParams,
  type ModelCapabilities,
  type ProjectDNA,
  type PromptBundle,
  type PromptCompileInput,
  type PromptReference,
  type ReadinessItem,
  type ReferenceCandidate,
} from "@arch/domain";

// ---------------------------------------------------------------- ids + cameras

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** TODO(p3-domain): `CAM_` + a time-ordered ULID (Crockford base32). */
export function newCameraId(nowMs = Date.now()): string {
  let time = "";
  let t = nowMs;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const rand = [...bytes].map((b) => CROCKFORD[b % 32]).join("");
  return `CAM_${time}${rand}`;
}

/** First free "Name", "Name 2", "Name 3"… (case-insensitive). */
export function uniqueCameraName(base: string, existingNames: readonly string[]): string {
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const root = base.trim() || "Camera";
  if (!taken.has(root.toLowerCase())) return root;
  for (let i = 2; ; i++) {
    const name = `${root} ${i}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** TODO(p3-domain) — same signature as `@arch/domain` on wt/p3-domain. */
export function cameraFromPreset(
  preset: CameraPreset,
  existingNames: readonly string[] = [],
  id: string = newCameraId(),
): CameraDNA {
  const camera: CameraDNA = {
    schemaVersion: 1,
    id,
    name: uniqueCameraName(preset.label, existingNames),
    viewType: preset.viewType,
    presetId: preset.id,
    isAnchorView: preset.anchorRecommended,
    notes: "",
  };
  if (preset.azimuthDeg !== undefined) camera.azimuthDeg = preset.azimuthDeg;
  if (preset.elevationDeg !== undefined) camera.elevationDeg = preset.elevationDeg;
  if (preset.heightM !== undefined) camera.heightM = preset.heightM;
  if (preset.distanceM !== undefined) camera.distanceM = preset.distanceM;
  if (preset.lensMm !== undefined) camera.lensMm = preset.lensMm;
  if (preset.aspectRatio !== undefined) camera.aspectRatio = preset.aspectRatio;
  if (preset.composition !== undefined) camera.composition = preset.composition;
  return camera;
}

/** TODO(p3-domain) — same signature as `@arch/domain` on wt/p3-domain. */
export function blankCamera(
  existingNames: readonly string[] = [],
  id: string = newCameraId(),
): CameraDNA {
  return {
    schemaVersion: 1,
    id,
    name: uniqueCameraName(`Camera ${existingNames.length + 1}`, existingNames),
    viewType: "custom",
    isAnchorView: false,
    notes: "",
  };
}

/**
 * TODO(p3-domain): a copy with a fresh id and unique name. The anchor-view flag is NOT
 * copied (it would silently add a required anchor), as on wt/p3-domain.
 */
export function duplicateCamera(
  camera: CameraDNA,
  existingNames: readonly string[] = [],
  id: string = newCameraId(),
): CameraDNA {
  return {
    ...structuredClone(camera),
    id,
    name: uniqueCameraName(`${camera.name} copy`, existingNames),
    isAnchorView: false,
  };
}

/** TODO(p3-domain) */
export function anchorViews(dna: Pick<ProjectDNA, "cameras">): CameraDNA[] {
  return dna.cameras.filter((c) => c.isAnchorView);
}

/** TODO(p3-domain): what a camera still lacks for a precise prompt. */
export function cameraReadiness(camera: CameraDNA): ReadinessItem[] {
  return [
    { key: "azimuthDeg", label: "Azimuth", done: camera.azimuthDeg !== undefined },
    {
      key: "elevationDeg",
      label: "Elevation or height",
      done: camera.elevationDeg !== undefined || camera.heightM !== undefined,
    },
    { key: "distanceM", label: "Distance", done: camera.distanceM !== undefined },
    { key: "lensMm", label: "Lens", done: camera.lensMm !== undefined },
  ];
}

/**
 * TODO(p3-domain): fallback presets for packs that have no `cameraPresets` yet. P3-B adds
 * real presets to every pack; then this list is no longer reached.
 */
export const FALLBACK_CAMERA_PRESETS: readonly CameraPreset[] = [
  {
    id: "fallback-front",
    label: "Front elevation",
    viewType: "exterior_front",
    azimuthDeg: 0,
    elevationDeg: 0,
    heightM: 1.6,
    distanceM: 22,
    lensMm: 35,
    aspectRatio: "3:2",
    anchorRecommended: true,
  },
  {
    id: "fallback-front-left",
    label: "Front-left corner",
    viewType: "exterior_corner",
    azimuthDeg: 40,
    elevationDeg: 2,
    heightM: 1.6,
    distanceM: 24,
    lensMm: 28,
    aspectRatio: "3:2",
    anchorRecommended: true,
  },
  {
    id: "fallback-front-right",
    label: "Front-right corner",
    viewType: "exterior_corner",
    azimuthDeg: -40,
    elevationDeg: 2,
    heightM: 1.6,
    distanceM: 24,
    lensMm: 28,
    aspectRatio: "3:2",
    anchorRecommended: false,
  },
  {
    id: "fallback-aerial",
    label: "Aerial three-quarter",
    viewType: "aerial",
    azimuthDeg: 35,
    elevationDeg: 32,
    distanceM: 40,
    lensMm: 35,
    aspectRatio: "16:9",
    anchorRecommended: false,
  },
];

// ---------------------------------------------------------------- prompt camera section

const VIEW_TYPE_WORDS: Record<CameraDNA["viewType"], string> = {
  exterior_front: "exterior front view",
  exterior_corner: "exterior corner view",
  exterior_side: "exterior side view",
  exterior_rear: "exterior rear view",
  aerial: "aerial view",
  street_level: "street-level view",
  detail: "architectural detail view",
  interior_wide: "wide interior view",
  interior_detail: "interior detail view",
  custom: "custom view",
};

/** "front-left three-quarter view" etc. (azimuth 0 = facing the front, + = clockwise from above). */
export function azimuthWords(azimuthDeg: number): string {
  const a = ((((azimuthDeg + 180) % 360) + 360) % 360) - 180;
  const side = a > 0 ? "left" : "right";
  const abs = Math.abs(a);
  if (abs < 15) return "frontal view";
  if (abs < 75) return `front-${side} three-quarter view`;
  if (abs <= 105) return `${side} side view`;
  if (abs < 165) return `rear-${side} three-quarter view`;
  return "rear view";
}

function elevationWords(c: CameraDNA): string | null {
  if (c.elevationDeg !== undefined) {
    const e = c.elevationDeg;
    if (e < -5) return "from a low angle";
    if (e < 5) return "from eye level";
    if (e < 20) return "from slightly above";
    if (e < 50) return "from an elevated viewpoint";
    return "from a bird's-eye viewpoint";
  }
  if (c.heightM !== undefined) {
    return c.heightM <= 2.2 ? "from eye level" : `from about ${round(c.heightM)} m above ground`;
  }
  return null;
}

const round = (n: number) => String(Math.round(n * 10) / 10);

/** TODO(p3-domain): the "camera" section P3-B adds to the compiler (after context). */
export function cameraSectionText(c: CameraDNA): string {
  const parts: string[] = [VIEW_TYPE_WORDS[c.viewType]];
  const viewpoint = [
    c.azimuthDeg !== undefined ? azimuthWords(c.azimuthDeg) : null,
    elevationWords(c),
  ]
    .filter(Boolean)
    .join(" ");
  if (viewpoint) parts.push(`viewpoint: ${viewpoint}`);
  if (c.lensMm !== undefined) {
    const feel =
      c.lensMm < 20
        ? "ultra-wide"
        : c.lensMm < 35
          ? "wide-angle"
          : c.lensMm < 70
            ? "natural"
            : "telephoto";
    parts.push(`lens: ${round(c.lensMm)} mm ${feel}`);
  }
  if (c.distanceM !== undefined) parts.push(`distance about ${round(c.distanceM)} m`);
  if (c.composition?.trim()) parts.push(`composition: ${c.composition.trim()}`);
  if (c.notes.trim()) parts.push(`camera notes: ${c.notes.trim()}`);
  return `Camera: ${parts.join("; ")}.`;
}

/** TODO(p3-domain): `PromptReference` gains `isAnchor` on P3-B's branch. */
export type CameraPromptReference = PromptReference & { isAnchor?: boolean };

/** TODO(p3-domain): `PromptCompileInput` gains `cameraId` on P3-B's branch. */
export type CameraCompileInput = Omit<PromptCompileInput, "references"> & {
  references: readonly CameraPromptReference[];
  cameraId?: string | null;
};

const ANCHOR_INSTRUCTION =
  "is the APPROVED ANCHOR view for this camera: match its viewpoint, framing and design exactly; the master stays authoritative for the architecture.";

/**
 * Reference order used for both the prompt numbering and the submitted IDs:
 * master, then the anchor, then the rest in role order.
 */
export function orderCameraReferences(
  refs: readonly CameraPromptReference[],
): CameraPromptReference[] {
  const master = refs.filter((r) => r.role === "master_architecture" && !r.isAnchor);
  const anchor = refs.filter((r) => r.isAnchor);
  const rest = sortReferences(refs.filter((r) => !master.includes(r) && !anchor.includes(r)));
  return [...master.slice(0, 1), ...anchor.slice(0, 1), ...master.slice(1), ...rest];
}

/** TODO(p3-domain): compilePrompt with a camera section and anchor references. */
export function compileCameraPrompt(input: CameraCompileInput): PromptBundle {
  const ordered = orderCameraReferences(input.references);
  const base = compilePrompt({ ...input, references: ordered });
  const camera = input.cameraId ? input.dna.cameras.find((c) => c.id === input.cameraId) : null;
  const hasAnchor = ordered.some((r) => r.isAnchor);
  if (!camera && !hasAnchor) return base;

  let positivePrompt = base.positivePrompt;
  const sections = [...((base.metadata.sections as string[] | undefined) ?? [])];
  if (camera) {
    // Insert after the context section (ARCHITECTURE §7), else before lighting/quality.
    const paragraphs = positivePrompt.split("\n\n");
    const after = sections.indexOf("context");
    const insertAt =
      after >= 0
        ? after + 1
        : sections.findIndex((s) => s === "lighting" || s === "quality") >= 0
          ? sections.findIndex((s) => s === "lighting" || s === "quality")
          : paragraphs.length;
    paragraphs.splice(insertAt, 0, cameraSectionText(camera));
    sections.splice(insertAt, 0, "camera");
    positivePrompt = paragraphs.join("\n\n");
  }
  const referenceInstructions = ordered.length
    ? ordered
        .map((r, i) => {
          const line = base.referenceInstructions.split("\n")[i] ?? "";
          if (!r.isAnchor) return line;
          return `Image ${i + 1}${r.label ? ` (${r.label})` : ""} ${ANCHOR_INSTRUCTION}`;
        })
        .join("\n")
    : base.referenceInstructions;
  return {
    ...base,
    positivePrompt,
    referenceInstructions,
    metadata: {
      ...base.metadata,
      sections,
      cameraId: camera?.id ?? null,
      anchorReference: hasAnchor,
    },
  };
}

// ---------------------------------------------------------------- batch builders

export type BatchAsset = ReferenceCandidate & { originalName?: string | null };

/** TODO(p3-domain): the input shape of P3-B's batch builders. */
export type BatchBuildInput = Omit<CameraCompileInput, "references" | "cameraId"> & {
  assets: readonly BatchAsset[];
  masterAssetId: string | null;
  model: ModelCapabilities;
  params: GenerationParams;
  /** Other references for production renders (beyond master + anchor). */
  extraReferenceIds?: readonly string[];
};

/** The camera's aspect ratio when the model offers it, else the chosen one. */
export function paramsForCamera(
  params: GenerationParams,
  camera: CameraDNA,
  model: ModelCapabilities,
): GenerationParams {
  return camera.aspectRatio && model.aspectRatios.includes(camera.aspectRatio)
    ? { ...params, aspectRatio: camera.aspectRatio }
    : params;
}

function buildItem(
  input: BatchBuildInput,
  camera: CameraDNA,
  refs: CameraPromptReference[],
  label: string,
): BatchItem {
  const ordered = orderCameraReferences(refs);
  return {
    cameraId: camera.id,
    label,
    prompt: compileCameraPrompt({ ...input, references: ordered, cameraId: camera.id }),
    referenceAssetIds: ordered.map((r) => r.assetId),
    params: paramsForCamera(input.params, camera, input.model),
  };
}

const refOf = (a: BatchAsset, isAnchor = false): CameraPromptReference => ({
  assetId: a.id,
  role: a.role,
  label: a.originalName,
  isAnchor,
});

/** TODO(p3-domain): one item per anchor view, master as the reference. */
export function buildAnchorBatchItems(input: BatchBuildInput): BatchItem[] {
  const master = input.assets.find((a) => a.id === input.masterAssetId);
  return anchorViews(input.dna).map((camera) =>
    buildItem(input, camera, master ? [refOf(master)] : [], `${camera.name} — anchor`),
  );
}

/**
 * TODO(p3-domain): per camera — master, that camera's anchor, then the selected extras, capped
 * at `maxReferenceImages` with master and anchor never dropped. Unknown camera IDs are skipped.
 */
export function buildProductionBatchItems(
  input: BatchBuildInput,
  cameraIds: readonly string[],
  anchors: readonly Pick<CameraAnchorDTO, "cameraId" | "assetId">[],
): BatchItem[] {
  const byId = new Map(input.assets.map((a) => [a.id, a]));
  const master = byId.get(input.masterAssetId ?? "");
  const cap = input.model.imageToImage ? input.model.maxReferenceImages : 0;
  return input.dna.cameras
    .filter((c) => cameraIds.includes(c.id))
    .map((camera) => {
      const anchorAsset = byId.get(anchors.find((a) => a.cameraId === camera.id)?.assetId ?? "");
      const fixed: CameraPromptReference[] = [];
      if (master) fixed.push(refOf(master));
      if (anchorAsset && anchorAsset.id !== master?.id) fixed.push(refOf(anchorAsset, true));
      const used = new Set(fixed.map((r) => r.assetId));
      const extras = orderReferenceIds(input.extraReferenceIds ?? [], input.assets)
        .filter((id) => !used.has(id))
        .map((id) => refOf(byId.get(id)!))
        .slice(0, Math.max(0, cap - fixed.length));
      return buildItem(input, camera, [...fixed, ...extras], `${camera.name} — production`);
    });
}
