/** Shared test helpers for the desktop UI tests (mock backend + store). */
import type { AssetDTO, GenerationDTO } from "@arch/domain";
import { call, type Transport } from "../src/lib/bridge";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll `cond` until it is truthy (real timers). Throws with `what` on timeout. */
export async function waitFor<T>(
  cond: () => T | null | undefined | false,
  what = "condition",
  timeoutMs = 3000,
): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = cond();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

/** Wait until a generation is no longer queued/running (polls the backend). */
export async function settled(projectId: string, generationId: string): Promise<GenerationDTO> {
  const end = Date.now() + 3000;
  for (;;) {
    const g = await call("generation_get", { projectId, generationId });
    if (g.status !== "queued" && g.status !== "running") return g;
    if (Date.now() > end) throw new Error(`generation ${generationId} did not finish`);
    await sleep(5);
  }
}

export function asset(projectId: string, id: string, over: Partial<AssetDTO> = {}): AssetDTO {
  return {
    id,
    projectId,
    source: "external",
    role: "architecture_reference",
    status: "ready",
    originalName: `${id}.jpg`,
    managedRelPath: `assets/original/${id}.jpg`,
    absolutePath: `blob:${id}`,
    thumbnailPath: `data:${id}`,
    mimeType: "image/jpeg",
    fileSizeBytes: 10,
    widthPx: 1600,
    heightPx: 1000,
    sha256: id,
    parentAssetId: null,
    operation: "import",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

/** A transport wrapper whose responses can be held per command (race tests). */
export function deferredTransport(base: Transport) {
  const holds = new Map<string, Array<() => void>>();
  const held = new Set<string>();
  const wrapped: Transport = async (command, args) => {
    const result = base(command, args);
    if (held.has(command)) {
      await new Promise<void>((resolve) => {
        const list = holds.get(command) ?? [];
        list.push(resolve);
        holds.set(command, list);
      });
    }
    return result;
  };
  wrapped.connectEvents = base.connectEvents;
  return {
    transport: wrapped,
    hold: (command: string) => held.add(command),
    /** Stop holding `command` and release every held response of it. */
    release: (command: string) => {
      held.delete(command);
      for (const r of holds.get(command) ?? []) r();
      holds.delete(command);
    },
    pending: (command: string) => holds.get(command)?.length ?? 0,
  };
}
