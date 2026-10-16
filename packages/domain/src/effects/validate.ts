/**
 * Effect rules of the single validator (ADR-036 P2c, SRS §12.4). Registered in
 * `validateShot`; they never edit the DNA.
 *
 * - EFFECT_SOURCE_MISSING (BLOCK): the effect has no real source in the shot, e.g. soft
 *   clouds in a closed interior (AC-09), silky water without water, a sunstar without a
 *   light source, or light trails without a road or a moving vehicle.
 * - EFFECT_MOTION_CONFLICT (BLOCK): a motion effect while its only subject is static, e.g.
 *   light trails while the only vehicle is parked (AC-08).
 *
 * Only the effects the selection really turns on are checked (`selectedEffects`).
 */
import type { ProjectDNA } from "../schemas/projectDna";
import {
  effectsCompatibility,
  selectedEffects,
  type EffectBlockCode,
  type EffectShotInput,
} from "./compatibility";
import type { ShotEffectsInput } from "./schemas";

export type EffectIssue = {
  code: EffectBlockCode;
  severity: "BLOCK";
  path: string;
  params: Record<string, string>;
};

export function validateEffects(
  dna: ProjectDNA,
  shot: EffectShotInput & { effects?: ShotEffectsInput | null },
): EffectIssue[] {
  const chosen = selectedEffects(shot.effects);
  if (!chosen.length) return [];
  const matrix = effectsCompatibility(dna, shot);
  const secondary = shot.effects?.secondary ?? [];
  return chosen.flatMap((choice, index) => {
    const entry = matrix.find((m) => m.effectId === choice.id)!;
    if (entry.status !== "blocked") return [];
    const path =
      index === 0
        ? "shotIntent.effects.primary"
        : `shotIntent.effects.secondary[${secondary.indexOf(choice)}]`;
    return [
      {
        code: entry.code!,
        severity: "BLOCK" as const,
        path,
        params: { effectId: choice.id, reason: entry.reason },
      },
    ];
  });
}
