import { QC_CATEGORIES, QcVisionReplySchema, type QcVisionReply } from "./schemas";

function balancedObjectAt(text: string, start: number): string | null {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return text.slice(start, index + 1);
  }
  return null;
}

function firstJsonObject(text: string): string | null {
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    const candidate = balancedObjectAt(text, start);
    if (!candidate) continue;
    try {
      const value: unknown = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) return candidate;
    } catch {
      // A prose brace pair is not a JSON object; continue to the next candidate.
    }
  }
  return null;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function normalizeReply(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const reply = value as Record<string, unknown>;
  const rawScores = reply.scores;
  const scores =
    rawScores && typeof rawScores === "object" && !Array.isArray(rawScores)
      ? { ...(rawScores as Record<string, unknown>) }
      : rawScores;
  if (scores && typeof scores === "object" && !Array.isArray(scores)) {
    const scoreRecord = scores as Record<string, unknown>;
    for (const category of QC_CATEGORIES) {
      const value = scoreRecord[category];
      if (typeof value === "number" && Number.isFinite(value)) {
        scoreRecord[category] = Math.round(clamp(value, 0, 100));
      }
    }
  }
  const artifacts = Array.isArray(reply.artifacts)
    ? reply.artifacts.map((rawArtifact) => {
        if (!rawArtifact || typeof rawArtifact !== "object" || Array.isArray(rawArtifact)) {
          return rawArtifact;
        }
        const artifact = { ...(rawArtifact as Record<string, unknown>) };
        if (Array.isArray(artifact.box)) {
          artifact.box = artifact.box.map((coordinate) =>
            typeof coordinate === "number" && Number.isFinite(coordinate)
              ? clamp(coordinate, 0, 1)
              : coordinate,
          );
        }
        return artifact;
      })
    : reply.artifacts;
  return { ...reply, scores, artifacts };
}

/** Parse the first balanced JSON object in a vision model reply and normalize numeric ranges. */
export function parseVisionReply(text: string): QcVisionReply {
  try {
    const objectText = firstJsonObject(text);
    if (!objectText) throw new Error("no complete JSON object found");
    return QcVisionReplySchema.parse(normalizeReply(JSON.parse(objectText)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Vision reply is not valid QC JSON: ${message}`, { cause: error });
  }
}
