import type { ProjectDNA } from "../../schemas/projectDna";
import { CONTEXT_LIBRARY, suggestContext } from "../../contextLibrary";

export function contextSuggestionsSection(dna: ProjectDNA): string | null {
  const library = dna.context.library;
  if (!library) return null;

  const suggestion = suggestContext(dna, library.presetId, library.regionId);
  const dropped = new Set(suggestion.droppedForEvidence);
  const keep = (lines: readonly string[]) => lines.filter((line) => !dropped.has(line));
  const preset = CONTEXT_LIBRARY.preset(library.presetId);
  const lines = [`CONTEXT SUGGESTIONS: ${preset?.nameEn ?? library.presetId}.`];
  const required = keep(suggestion.requiredLines);
  const optional = keep(suggestion.optionalLines).filter((line) =>
    library.approvedOptional.includes(line),
  );
  const forbidden = keep(suggestion.forbiddenLines);
  const regionDetails = keep(suggestion.regionDetails);
  const regionAvoid = keep(suggestion.regionAvoid);

  if (required.length)
    lines.push(`Required site cues, only when consistent with verified site evidence: ${required.join(", ")}.`);
  if (optional.length) lines.push(`Approved optional cues: ${optional.join(", ")}.`);
  if (regionDetails.length) lines.push(`Region details: ${regionDetails.join(", ")}.`);
  if (regionAvoid.length) lines.push(`Region avoids: ${regionAvoid.join(", ")}.`);
  if (forbidden.length) lines.push(`Do not introduce: ${forbidden.join(", ")}.`);

  return lines.join("\n");
}
