import { z } from "zod";
import type { SpaceZone } from "../spaceCatalog/schemas";
import type { CameraDNA, CameraViewType } from "../schemas/future";
import type { ProjectDNA } from "../schemas/projectDna";
import { resolveActiveSpace } from "../spaceCatalog/resolve";
import { resolveSiteAdjacency } from "../site/adjacency";

export const VISUAL_INTENT_VIEWS = [
  "front",
  "street_oblique",
  "pedestrian",
  "overview",
  "approach",
  "detail",
  "aerial",
] as const;
export type VisualIntentView = (typeof VISUAL_INTENT_VIEWS)[number];

export const VISUAL_INTENT_PURPOSES = ["landscape", "portrait", "square"] as const;
export type VisualIntentPurpose = (typeof VISUAL_INTENT_PURPOSES)[number];

export const VisualIntentViewSchema = z.enum(VISUAL_INTENT_VIEWS);
export const VisualIntentPurposeSchema = z.enum(VISUAL_INTENT_PURPOSES);

export const VisualIntentSchema = z.object({
  view: VisualIntentViewSchema,
  purpose: VisualIntentPurposeSchema,
  distance: z.number().int().min(0).max(100).optional(),
  height: z.number().int().min(0).max(100).optional(),
  focus: z.number().int().min(0).max(100).optional(),
});
export type VisualIntent = z.infer<typeof VisualIntentSchema>;

const DEFAULT_VIEWS: readonly VisualIntentView[] = VISUAL_INTENT_VIEWS;

/**
 * View choices that are meaningful for the selected space and site. The resolver is
 * intentionally conservative: an attached side remains unavailable as a side-reveal, while
 * a street oblique remains a valid front-facade viewpoint for an attached townhouse.
 */
export function availableIntents(
  dna: Pick<ProjectDNA, "interior" | "spaceCatalog" | "site" | "context">,
  spaceZone?: SpaceZone,
): VisualIntentView[] {
  const zone = spaceZone ?? resolveActiveSpace(dna)?.preset?.zone;
  const interior = zone === "interior" || dna.interior !== undefined;
  const adjacency = resolveSiteAdjacency(dna);
  const attachedTownhouse =
    adjacency.left.kind === "attached_building" || adjacency.right.kind === "attached_building";

  return DEFAULT_VIEWS.filter((view) => {
    if (interior && view === "aerial") return false;
    // `street_oblique` is front-facade oblique, not a side-reveal. A future explicit side
    // intent must be filtered here whenever it is added to the public enum.
    if (attachedTownhouse && view === "street_oblique")
      return adjacency.front.kind !== "attached_building";
    return true;
  });
}

const VIEW_SUGGESTIONS: Record<
  VisualIntentView,
  Pick<CameraDNA, "viewType" | "presetId" | "lensMm" | "composition">
> = {
  front: {
    viewType: "exterior_front",
    presetId: "visual_intent_front",
    lensMm: 50,
    composition: "front facade dominant",
  },
  street_oblique: {
    viewType: "exterior_corner",
    presetId: "visual_intent_street_oblique",
    lensMm: 35,
    composition: "front facade dominant, oblique street view; attached side walls remain hidden behind neighbouring buildings",
  },
  pedestrian: {
    viewType: "street_level",
    presetId: "visual_intent_pedestrian",
    lensMm: 35,
    composition: "street-level framing with believable pedestrian eye-height perspective",
  },
  overview: {
    viewType: "exterior_front",
    presetId: "visual_intent_overview",
    lensMm: 24,
    composition: "building and immediate site context fully readable",
  },
  approach: {
    viewType: "exterior_front",
    presetId: "visual_intent_approach",
    lensMm: 35,
    composition: "approach view with the entry sequence leading toward the building",
  },
  detail: {
    viewType: "detail",
    presetId: "visual_intent_detail",
    lensMm: 85,
    composition: "focused architectural detail with restrained surrounding context",
  },
  aerial: {
    viewType: "aerial",
    presetId: "visual_intent_aerial",
    lensMm: 24,
    composition: "high overview of the building and its immediate site",
  },
};

const ASPECT_BY_PURPOSE: Record<VisualIntentPurpose, string> = {
  landscape: "16:9",
  portrait: "4:5",
  square: "1:1",
};

/** Convert a shot-level intent into camera suggestions without inventing measured coordinates. */
export function resolveVisualIntent(
  intent: VisualIntent,
  dna: Pick<ProjectDNA, "interior" | "spaceCatalog" | "site" | "context">,
): Partial<CameraDNA> {
  const zone = resolveActiveSpace(dna)?.preset?.zone;
  const view = availableIntents(dna, zone).includes(intent.view) ? intent.view : "overview";
  const suggestion = VIEW_SUGGESTIONS[view];
  const aspectRatio = ASPECT_BY_PURPOSE[intent.purpose];
  const next: Partial<CameraDNA> = {
    ...suggestion,
    aspectRatio,
  };
  // Slider values express a feeling only. They deliberately do not become measured camera
  // fields; Camera Director remains the owner of azimuth, distance and height.
  if (intent.focus !== undefined && intent.focus >= 70)
    next.lensMm = Math.max(next.lensMm ?? 35, 85);
  if (intent.focus !== undefined && intent.focus <= 30)
    next.lensMm = Math.min(next.lensMm ?? 35, 24);
  return next;
}

export function suggestedCameraViewType(intent: VisualIntent): CameraViewType {
  return VIEW_SUGGESTIONS[intent.view].viewType;
}
