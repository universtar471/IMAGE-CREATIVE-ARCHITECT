/**
 * `CONTEXT SUGGESTIONS` section (ADR-034 amendment 1, SRS P1d). Context Library V4 is the
 * lowest-priority context source (upgrade plan §3, rule 5): it only suggests, and site
 * evidence always wins. The section is absent without `context.library`, so such a DNA
 * compiles exactly as before.
 *
 * - Required cues are worded "only when consistent with verified site evidence".
 * - Optional cues appear only when the user approved them (`approvedOptional`).
 * - Cues that contradict the resolved site adjacency (`droppedForEvidence`) never appear,
 *   so the section cannot argue with `SITE & OCCLUSION`.
 */
import type { ProjectType } from "../../schemas/enums";
import type { ProjectDNA } from "../../schemas/projectDna";
import { CONTEXT_LIBRARY, suggestContext } from "../../contextLibrary";

export const CONTEXT_SUGGESTIONS_HEADING = "CONTEXT SUGGESTIONS";

/** The library selection the compiler uses, or null when absent, interior or unknown. */
export function usedContextLibrary(
  dna: Pick<ProjectDNA, "context">,
  projectType: ProjectType,
): NonNullable<ProjectDNA["context"]["library"]> | null {
  const library = dna.context.library;
  if (!library || projectType === "interior") return null;
  // A preset removed from a later library version is ignored rather than failing the compile.
  return CONTEXT_LIBRARY.preset(library.presetId) ? library : null;
}

export function contextSuggestionsSection(
  dna: Pick<ProjectDNA, "site" | "context">,
  projectType: ProjectType,
): string | null {
  const library = usedContextLibrary(dna, projectType);
  if (!library) return null;
  const preset = CONTEXT_LIBRARY.preset(library.presetId)!;
  const region = CONTEXT_LIBRARY.region(library.regionId);
  const suggestion = suggestContext(
    dna,
    library.presetId,
    region ? region.id : "unspecified",
    projectType,
  );
  const approved = new Set(library.approvedOptional);
  const optional = suggestion.optionalLines.filter((line) => approved.has(line));

  const lines = [
    `${CONTEXT_SUGGESTIONS_HEADING} (lowest priority; verified site evidence, the master image and the site and occlusion rules always win): ${preset.nameEn}${
      region && region.id !== "unspecified" ? `, ${region.nameEn} (${region.climate})` : ""
    }.`,
  ];
  if (suggestion.requiredLines.length)
    lines.push(
      `Include only when consistent with verified site evidence: ${suggestion.requiredLines.join("; ")}.`,
    );
  if (optional.length) lines.push(`Approved optional cues: ${optional.join("; ")}.`);
  if (suggestion.regionDetails.length)
    lines.push(`Regional details where supported: ${suggestion.regionDetails.join("; ")}.`);
  if (suggestion.regionAvoid.length)
    lines.push(`Regional avoids: ${suggestion.regionAvoid.join("; ")}.`);
  if (suggestion.forbiddenLines.length)
    lines.push(`Do not introduce: ${suggestion.forbiddenLines.join("; ")}.`);
  return lines.length > 1 ? lines.join(" ") : null;
}
