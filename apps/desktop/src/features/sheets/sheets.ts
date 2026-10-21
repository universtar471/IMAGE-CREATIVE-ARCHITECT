import type { PromptBundle } from "@arch/domain";
import { COMPILER_VERSION } from "@arch/domain";

export type SheetKind = "diagram" | "publishing";
export const SHEET_PRESETS = {
  diagram: [
    {
      id: "massing",
      icon: "isometric",
      instruction:
        "An exploded axonometric massing diagram explaining the visible architectural volumes, with restrained arrows and concise callouts.",
    },
    {
      id: "facade",
      icon: "view",
      instruction:
        "A facade analysis diagram highlighting visible openings, facade layers, materials and proportions.",
    },
    {
      id: "environment",
      icon: "sunset",
      instruction:
        "A conceptual environmental diagram about visible shading, planting and openings. Use indicative arrows, never claim a measured simulation.",
    },
    {
      id: "concept",
      icon: "create-image",
      instruction:
        "A single concept presentation sheet combining the source architecture, simplified masses and a clear visual hierarchy.",
    },
  ],
  publishing: [
    {
      id: "cover",
      icon: "create-image",
      instruction:
        "A polished architectural portfolio cover: one strong hero image, generous negative space and a clear editorial grid.",
    },
    {
      id: "board",
      icon: "wide-view",
      instruction:
        "A professional architectural presentation board: a dominant source image, secondary close-up crops from that same image and a restrained layout.",
    },
    {
      id: "editorial",
      icon: "color",
      instruction:
        "An elegant magazine spread for this architectural project: balanced image placement, consistent margins and a refined typographic hierarchy.",
    },
    {
      id: "social",
      icon: "people",
      instruction:
        "A concise architectural social publication with a clear hero image, bold hierarchy and mobile-readable spacing.",
    },
  ],
} as const;

export function compileSheetPrompt(
  kind: SheetKind,
  presetId: string,
  note: string,
  title: string,
  language: string,
): PromptBundle {
  const preset = SHEET_PRESETS[kind].find((p) => p.id === presetId) ?? SHEET_PRESETS[kind][0];
  return {
    compilerVersion: COMPILER_VERSION,
    positivePrompt: `${kind === "diagram" ? "Create ONE architectural diagram sheet from Image 1." : "Create ONE publication-ready architectural artwork from Image 1."}\n${preset.instruction}\nProject title: ${title}. Label language: ${language}. Use only short legible labels supported by the image or user-provided facts. Do not invent dimensions, internal floor plans, hidden structure, project location, performance claims or certifications.\n${note.trim() ? `User direction: ${note.trim()}` : "Use a clean restrained palette, crisp lines and a readable composition."}`,
    negativePrompt:
      "distorted building, stretched image, fabricated floor plan, illegible dense text, watermark",
    referenceInstructions:
      "Image 1 is the authoritative architecture. Preserve its design, visible proportions, openings, roof, materials and site. Secondary images must be crops or diagrammatic abstractions of this same design.",
    preservationInstructions:
      "Keep the source architecture recognizable and proportionally accurate. Fit images without stretching. Use only visible or explicitly supplied facts; omit unsupported labels.",
    metadata: { sheetKind: kind, sheetPreset: preset.id, sourceInstructionVersion: 1 },
  };
}
