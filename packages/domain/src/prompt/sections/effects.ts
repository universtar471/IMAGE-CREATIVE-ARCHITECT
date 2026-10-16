/**
 * EFFECTS section (ADR-036 P2c, SRS §6.2).
 *
 * Keeps the architecture static and sharp, then one apply sentence per selected effect
 * (primary first) with its guard. An effect the matrix blocks is never compiled; a
 * conditional one is worded "only where … present in the approved references". The SRS
 * camera wording (long exposure, f/11–f/16) describes the look only, so the section says
 * it is not a physical camera setting. No selected effect: no section (the prompt is
 * byte-identical to a shot without effects).
 */
import type { ProjectDNA } from "../../schemas/projectDna";
import { effectPromptEn, effectDefinition } from "../../effects/catalog";
import {
  effectScene,
  effectsCompatibility,
  selectedEffects,
  type EffectShotInput,
} from "../../effects/compatibility";
import type { ShotEffectsInput } from "../../effects/schemas";

export const EFFECTS_HEADING = "EFFECTS:";

/** The EFFECTS lines of a shot (empty without a compilable effect). */
export function effectsLines(
  dna: ProjectDNA,
  shot: EffectShotInput & { effects?: ShotEffectsInput | null },
): string[] {
  const chosen = selectedEffects(shot.effects);
  if (!chosen.length) return [];
  const matrix = effectsCompatibility(dna, shot);
  const compiled = chosen.flatMap((choice) => {
    const entry = matrix.find((m) => m.effectId === choice.id)!;
    return entry.status === "blocked"
      ? []
      : [{ choice, conditional: entry.status === "conditional" }];
  });
  if (!compiled.length) return [];
  const lines = [
    effectScene(dna, shot).enclosed
      ? "Keep all architecture, walls, openings and fixed furniture static and sharply defined."
      : "Keep all architecture, roads and neighboring buildings static and sharply defined.",
  ];
  for (const { choice, conditional } of compiled) {
    const apply = effectPromptEn(choice.id, choice.intensity);
    lines.push(
      conditional
        ? `${apply.slice(0, -1)}, only where that source is present in the approved references.`
        : apply,
    );
    lines.push(effectDefinition(choice.id).guardEn);
  }
  lines.push(
    "These effects describe the look only, not exact camera settings; never add a new source for an effect.",
  );
  return lines;
}

export function effectsSection(
  dna: ProjectDNA,
  shot: EffectShotInput & { effects?: ShotEffectsInput | null },
): string | null {
  const lines = effectsLines(dna, shot);
  return lines.length ? [EFFECTS_HEADING, ...lines].join("\n") : null;
}
