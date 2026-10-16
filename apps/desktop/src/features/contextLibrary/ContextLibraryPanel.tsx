import { useState } from "react";
import {
  CONTEXT_ARCHETYPE_IDS,
  CONTEXT_LIBRARY,
  contextSuggestionsFor,
  suggestArchetype,
  suggestContext,
  type ContextArchetype,
  type ContextLibrarySelection,
  type ProjectDNA,
} from "@arch/domain";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { SelectField } from "../../components/panels/fields";
import { useLocale, useT } from "../../i18n";
import { selectReadOnly, useStudio } from "../../app/store";

const UNSPECIFIED_REGION = "unspecified";

const isArchetype = (value: string | null | undefined): value is ContextArchetype =>
  !!value && (CONTEXT_ARCHETYPE_IDS as readonly string[]).includes(value);

/**
 * "Gợi ý bối cảnh (thư viện V4)" (SRS P1d, ADR-034 amendment 1). The only writer of
 * `context.library`. Context Library V4 sits below site evidence: cues the site contradicts
 * are listed as dropped and never reach the prompt.
 */
export function ContextLibraryPanel() {
  const t = useT();
  const locale = useLocale((state) => state.locale);
  const editDna = useStudio((state) => state.editDna);
  const workspace = useStudio((state) => state.workspace!);
  const readOnly = useStudio(selectReadOnly);
  const dna = workspace.draftDna as ProjectDNA;
  const projectType = workspace.project.projectType;
  const disabled = readOnly || dna.locks.context;
  const library = dna.context.library;
  const preset = library ? CONTEXT_LIBRARY.preset(library.presetId) : null;
  const projectArchetype =
    dna.spaceCatalog?.buildingArchetype ??
    suggestArchetype(projectType, dna.interior?.buildingUseId ?? null);
  // The picker filter only; it is not stored. Defaults to the stored preset, then the project.
  const [archetype, setArchetype] = useState<ContextArchetype>(
    preset?.buildingType ?? (isArchetype(projectArchetype) ? projectArchetype : "townhouse"),
  );
  const regionId =
    library && CONTEXT_LIBRARY.region(library.regionId) ? library.regionId : UNSPECIFIED_REGION;
  const suggestion = preset ? suggestContext(dna, preset.id, regionId, projectType) : null;
  const vi = locale === "vi";

  const write = (next: ContextLibrarySelection | undefined) => {
    if (!disabled) editDna("context.library", next);
  };
  const choosePreset = (presetId: string | undefined) => {
    const next = presetId ? CONTEXT_LIBRARY.preset(presetId) : null;
    if (!next) return write(undefined);
    write({
      version: 1,
      presetId: next.id,
      regionId,
      // Approvals of cues the new preset also offers carry over.
      approvedOptional: (library?.approvedOptional ?? []).filter((line) =>
        next.optional.includes(line),
      ),
    });
  };
  const toggleOptional = (line: string, approved: boolean) => {
    if (!library || !preset) return;
    const set = new Set(library.approvedOptional);
    if (approved) set.add(line);
    else set.delete(line);
    // Stored in library order so the prompt does not depend on click order.
    write({ ...library, approvedOptional: preset.optional.filter((cue) => set.has(cue)) });
  };

  const archetypeOptions = CONTEXT_LIBRARY.buildingTypes
    .filter((type) => isArchetype(type.id))
    .map((type) => ({ value: type.id as ContextArchetype, label: vi ? type.nameVi : type.nameEn }));
  const presetOptions = contextSuggestionsFor(archetype).map((p) => ({
    value: p.id,
    label: vi ? p.nameVi : p.nameEn,
  }));
  if (preset && preset.buildingType !== archetype)
    presetOptions.unshift({ value: preset.id, label: vi ? preset.nameVi : preset.nameEn });
  const regionOptions = CONTEXT_LIBRARY.regions.map((region) => ({
    value: region.id,
    label: vi ? region.name : region.nameEn,
  }));

  return (
    <SectionPanel title={t("contextLibrary.title")}>
      <div className="context-library" data-testid="context-library-panel">
        <p className="field-hint" data-testid="context-library-evidence-note">
          {t("contextLibrary.evidenceWins")}
        </p>
        <SelectField
          label={t("contextLibrary.archetype")}
          value={archetype}
          allowEmpty={false}
          disabled={disabled}
          options={archetypeOptions}
          onChange={(value) => value && setArchetype(value)}
        />
        <SelectField
          label={t("contextLibrary.preset")}
          value={preset?.id}
          disabled={disabled}
          options={presetOptions}
          onChange={choosePreset}
        />
        {library && !preset && (
          <p className="field-hint" role="status">
            {t("contextLibrary.unknownPreset", { id: library.presetId })}
          </p>
        )}
        <SelectField
          label={t("contextLibrary.region")}
          value={regionId}
          allowEmpty={false}
          disabled={disabled || !library}
          options={regionOptions}
          onChange={(value) => library && value && write({ ...library, regionId: value })}
        />
        {suggestion && (
          <>
            <CueList
              title={t("contextLibrary.required")}
              hint={t("contextLibrary.requiredHint")}
              lines={suggestion.requiredLines}
              testId="context-library-required"
            />
            {suggestion.optionalLines.length > 0 && (
              <fieldset className="context-library-cues" data-testid="context-library-optional">
                <legend>{t("contextLibrary.optional")}</legend>
                {suggestion.optionalLines.map((line) => (
                  <label key={line} className="check-row">
                    <input
                      type="checkbox"
                      checked={library!.approvedOptional.includes(line)}
                      disabled={disabled}
                      onChange={(event) => toggleOptional(line, event.target.checked)}
                    />
                    <span>{line}</span>
                  </label>
                ))}
              </fieldset>
            )}
            <CueList
              title={t("contextLibrary.forbidden")}
              lines={suggestion.forbiddenLines}
              testId="context-library-forbidden"
            />
            <CueList
              title={t("contextLibrary.regionDetails")}
              lines={suggestion.regionDetails}
              testId="context-library-region-details"
            />
            <CueList
              title={t("contextLibrary.regionAvoid")}
              lines={suggestion.regionAvoid}
              testId="context-library-region-avoid"
            />
            {suggestion.droppedForEvidence.length > 0 && (
              <div className="context-library-dropped" data-testid="context-library-dropped">
                <strong>{t("contextLibrary.dropped")}</strong>
                <ul>
                  {suggestion.droppedForEvidence.map((line) => (
                    <li key={line}>
                      <s>{line}</s> — {t("contextLibrary.droppedReason")}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="field-hint">{t("contextLibrary.englishCues")}</p>
          </>
        )}
      </div>
    </SectionPanel>
  );
}

function CueList({
  title,
  hint,
  lines,
  testId,
}: {
  title: string;
  hint?: string;
  lines: readonly string[];
  testId: string;
}) {
  if (!lines.length) return null;
  return (
    <div className="context-library-cues" data-testid={testId}>
      <strong>{title}</strong>
      {hint && <p className="field-hint">{hint}</p>}
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
