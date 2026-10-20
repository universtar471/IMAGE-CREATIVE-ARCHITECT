/**
 * Image to video (phase B1, ADR-043).
 *
 * A clip animates one image the user picked (a result, the master, a SketchUp viewport…).
 * The motion presets are the app's own wording. Each one says how the camera or the scene
 * moves and keeps the architecture rigid, because video models tend to bend walls, add
 * floors or melt openings while the camera moves.
 *
 * `compileVideoPrompt` is deterministic for the same DNA, shot and compiler version. It keeps
 * the prompt short (video models follow short prompts better), and records the source of each
 * part in `metadata.sections`. The prompt is derived output; nothing is written to the DNA.
 */
import { z } from "zod";
import type { ProjectDNA } from "../schemas/projectDna";
import type { ModelCapabilities } from "../schemas/generation";
import type { PromptBundle } from "../schemas/prompt";

export const VIDEO_COMPILER_VERSION = "vc-1.0.0";

export const MOTION_PRESET_IDS = [
  "dolly_in",
  "dolly_out",
  "orbit_left",
  "orbit_right",
  "drone_rise",
  "parallax_pan",
  "cinemagraph",
  "day_to_night",
] as const;
export const MotionPresetIdSchema = z.enum(MOTION_PRESET_IDS);
export type MotionPresetId = z.infer<typeof MotionPresetIdSchema>;

export type MotionPreset = {
  id: MotionPresetId;
  /** The motion, in English (the language every video model follows best). */
  motionEn: string;
  /** Extra things the model must not do with this motion. */
  avoidEn: readonly string[];
};

/** Kept with every preset: the building is a rigid object. */
export const VIDEO_RIGID_ARCHITECTURE =
  "The building is a rigid, solid structure: keep its geometry, floor count, openings, roof and materials exactly as in the first frame, with no bending, melting or morphing.";

export const VIDEO_BASE_AVOID: readonly string[] = [
  "warping or bending walls",
  "extra or missing floors",
  "changing windows or doors",
  "morphing architecture",
  "flicker",
  "text or watermark",
];

export const MOTION_PRESETS: readonly MotionPreset[] = [
  {
    id: "dolly_in",
    motionEn: "The camera glides slowly forward toward the building on a smooth, steady dolly.",
    avoidEn: ["camera shake"],
  },
  {
    id: "dolly_out",
    motionEn:
      "The camera pulls back slowly and smoothly, revealing more of the surroundings around the building.",
    avoidEn: ["camera shake"],
  },
  {
    id: "orbit_left",
    motionEn:
      "The camera orbits slowly to the left around the building at a constant height and distance, keeping it centered.",
    avoidEn: ["the building rotating on its own"],
  },
  {
    id: "orbit_right",
    motionEn:
      "The camera orbits slowly to the right around the building at a constant height and distance, keeping it centered.",
    avoidEn: ["the building rotating on its own"],
  },
  {
    id: "drone_rise",
    motionEn:
      "A drone shot rising slowly and steadily, tilting down a little to keep the building in view.",
    avoidEn: ["sudden jumps in height"],
  },
  {
    id: "parallax_pan",
    motionEn:
      "A slow lateral tracking move parallel to the facade, foreground planting passing gently in front with natural parallax.",
    avoidEn: ["the facade sliding or stretching"],
  },
  {
    id: "cinemagraph",
    motionEn:
      "The camera stays completely still. Only living things move: leaves sway lightly, clouds drift, a few people walk by.",
    avoidEn: ["any camera movement", "the building moving"],
  },
  {
    id: "day_to_night",
    motionEn:
      "Static camera time-lapse from late afternoon to night: shadows lengthen, the sky turns to dusk and the interior lights come on.",
    avoidEn: ["any camera movement", "the building changing shape as the light changes"],
  },
];

export const motionPreset = (id: string): MotionPreset | undefined =>
  MOTION_PRESETS.find((preset) => preset.id === id);

export const VideoShotSchema = z.object({
  motionPresetId: MotionPresetIdSchema,
  /** Seconds; must be one of the model's `imageSizes` ("5s"…). */
  durationSec: z.number().int().positive(),
  /** Null = the provider follows the first frame. */
  aspectRatio: z.string().nullable(),
  sourceAssetId: z.string(),
  /** Optional free text from the user, appended last. */
  note: z.string().max(400).optional(),
});
export type VideoShot = z.infer<typeof VideoShotSchema>;

/** `imageSizes` value of a duration. */
export const durationSize = (durationSec: number): string => `${durationSec}s`;

/** Durations a video model offers, in seconds. */
export const modelDurations = (model: Pick<ModelCapabilities, "imageSizes">): number[] =>
  model.imageSizes
    .map((size) => /^(\d+)s$/.exec(size)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number);

/** Price of one clip in VND from `priceHint["<n>s"]`, or null when the model has no price. */
export function estimateVideoCost(
  model: Pick<ModelCapabilities, "priceHint">,
  durationSec: number,
): number | null {
  const price = model.priceHint?.[durationSize(durationSec)];
  return typeof price === "number" ? price : null;
}

function buildingSummary(dna: ProjectDNA): string {
  const b = dna.building;
  const what = [b.architecturalStyle, b.buildingType].filter(Boolean).join(" ").trim();
  const parts: string[] = [];
  if (b.floors !== undefined) parts.push(`${b.floors} ${b.floors === 1 ? "floor" : "floors"}`);
  if (b.roof.type) parts.push(`${b.roof.type} roof`);
  const materials = b.materials
    .slice(0, 3)
    .map((m) => m.description.trim())
    .filter(Boolean);
  if (materials.length) parts.push(materials.join(", "));
  const subject = what ? `A ${what}` : "The building";
  return parts.length ? `${subject} (${parts.join("; ")}).` : `${subject} in the first frame.`;
}

/** A short, deterministic video prompt for one clip. */
export function compileVideoPrompt(dna: ProjectDNA, shot: VideoShot): PromptBundle {
  const preset = motionPreset(shot.motionPresetId);
  if (!preset) throw new Error(`Unknown motion preset '${shot.motionPresetId}'.`);
  const note = shot.note?.trim();
  const subject = buildingSummary(dna);
  const positive = [subject, preset.motionEn, note].filter(Boolean).join(" ");
  const negative = [...VIDEO_BASE_AVOID, ...preset.avoidEn].join(", ");
  const sections = [
    { id: "subject", source: "dna.building" },
    { id: "motion", source: `motion:${preset.id}` },
    ...(note ? [{ id: "note", source: "user" }] : []),
    { id: "preservation", source: "video:rigid_architecture" },
  ];
  return {
    compilerVersion: VIDEO_COMPILER_VERSION,
    positivePrompt: positive,
    negativePrompt: negative,
    referenceInstructions: "Image 1 is the first frame of the clip.",
    preservationInstructions: VIDEO_RIGID_ARCHITECTURE,
    metadata: {
      kind: "video",
      motionPresetId: preset.id,
      durationSec: shot.durationSec,
      aspectRatio: shot.aspectRatio,
      sourceAssetId: shot.sourceAssetId,
      sections,
    },
  };
}
