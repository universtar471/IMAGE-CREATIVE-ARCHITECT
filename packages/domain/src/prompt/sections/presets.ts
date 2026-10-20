/**
 * PRESETS section (ADR-039, M1).
 *
 * One line per selected preset that carries its own sentence, in catalog order. The compiler
 * records which preset wrote which line in `metadata.presetSources`, so the Prompt Preview can
 * show where every sentence comes from without tagging the text sent to the provider. Presets
 * whose patch compiles elsewhere (effects, scene objects) add no line here. A camera preset
 * adds a viewpoint line only when no DNA camera is compiled: Camera DNA stays the owner of
 * the viewpoint. Time and weather lines are left out while that DNA section is locked (the
 * validator reports LOCKED_LIGHTING_CONFLICT / LOCKED_WEATHER_CONFLICT). No line: no section.
 */
import type { ProjectDNA } from "../../schemas/projectDna";
import type { ShotIntent } from "../../validation/shotIntent";
import { resolveVisualIntent } from "../../camera/intent";
import { compiledPresets } from "../../presets/apply";

export const PRESETS_HEADING = "PRESETS:";

export type PresetLine = { presetId: string; text: string };

export function presetLines(
  dna: ProjectDNA,
  shot: ShotIntent | undefined,
  cameraCompiled: boolean,
): PresetLine[] {
  const lines: PresetLine[] = [];
  for (const preset of compiledPresets(shot, dna)) {
    if (preset.patch.timeOfDay && dna.locks.lighting) continue;
    if (preset.patch.weather && dna.locks.weather) continue;
    if (preset.patch.view) {
      if (cameraCompiled || !shot?.visualIntent) continue;
      const camera = resolveVisualIntent(shot.visualIntent, dna);
      const lens = camera.lensMm ? `, about ${camera.lensMm} mm lens feel` : "";
      lines.push({ presetId: preset.id, text: `Viewpoint: ${camera.composition}${lens}.` });
      continue;
    }
    if (!preset.promptEn) continue;
    const text = preset.keepEn ? `${preset.promptEn} ${preset.keepEn}` : preset.promptEn;
    lines.push({ presetId: preset.id, text });
  }
  return lines;
}

export function presetsSection(
  dna: ProjectDNA,
  shot: ShotIntent | undefined,
  cameraCompiled: boolean,
): string | null {
  const lines = presetLines(dna, shot, cameraCompiled);
  if (!lines.length) return null;
  return [PRESETS_HEADING, ...lines.map((l) => l.text)].join("\n");
}
