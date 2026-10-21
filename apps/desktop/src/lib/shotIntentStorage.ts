/**
 * The per-project ShotIntent across app restarts (ADR-036). It is a UI choice, so it lives in
 * `localStorage` keyed by project id and is never written into the DNA. A stored value that
 * no longer parses with `ShotIntentSchema` (corrupt, or from an older build) is dropped.
 * Storage can be missing or throw (private mode, blocked site data): every access is guarded
 * and the app then simply keeps the intent for the session only.
 */
import { ShotIntentSchema, shotPreset, type ShotIntent } from "@arch/domain";

export const SHOT_INTENT_STORAGE_PREFIX = "arch.shotIntent.";

const keyOf = (projectId: string) => `${SHOT_INTENT_STORAGE_PREFIX}${projectId}`;

/** The stored intent of a project, or undefined when absent or invalid (invalid is removed). */
export function loadShotIntent(projectId: string): ShotIntent | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(keyOf(projectId));
    if (raw == null) return undefined;
    const parsed = ShotIntentSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      const shot = parsed.data as ShotIntent;
      // Upgrade only objects contributed by selected presets. Explicit positions and
      // hand-authored scene requests retain their existing placement rules.
      const contributed = (shot.presetIds ?? []).flatMap(
        (id) => shotPreset(id)?.patch.objects ?? [],
      );
      return {
        ...shot,
        ...(shot.sceneObjects
          ? {
              sceneObjects: shot.sceneObjects.map((r) => {
                if (r.placementZoneId || r.autoPlacement !== undefined) return r;
                const i = contributed.findIndex(
                  (o) =>
                    o.presetId === r.presetId &&
                    o.quantity === r.quantity &&
                    o.state === r.state &&
                    o.visibility === r.visibility,
                );
                if (i < 0) return r;
                contributed.splice(i, 1);
                return { ...r, autoPlacement: true };
              }),
            }
          : {}),
      };
    }
  } catch {
    // Unreadable JSON or storage: fall through and drop it.
  }
  clearShotIntent(projectId);
  return undefined;
}

export function saveShotIntent(projectId: string, shotIntent: ShotIntent): void {
  try {
    globalThis.localStorage?.setItem(keyOf(projectId), JSON.stringify(shotIntent));
  } catch {
    // Storage full or blocked: the intent stays for this session only.
  }
}

export function clearShotIntent(projectId: string): void {
  try {
    globalThis.localStorage?.removeItem(keyOf(projectId));
  } catch {
    // Nothing to do.
  }
}
