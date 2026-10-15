/**
 * Space selector wizard (ADR-034 P1a, SRS §4.2): building type → group → space → variant,
 * with an "other / custom" space. It is the only writer of `dna.spaceCatalog` and picks the
 * one active space the prompt describes (`SPACE SCOPE`). The catalog is read-only data;
 * the project stores only preset ids, measured facts and the user's approvals.
 */
import { useState } from "react";
import {
  CUSTOM_SPACE_PRESET_ID,
  SPACE_CATALOG,
  SPACE_DIMENSION_FACTS,
  newSpaceId,
  resolveActiveSpace,
  suggestArchetype,
  type ProjectDNA,
  type SpaceCatalogExtension,
  type SpaceCategory,
  type SpaceDimensionFact,
  type SpaceInstance,
  type SpacePreset,
} from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { FieldGroup, NumberField, SelectField, TextField } from "../../components/panels/fields";
import { useLocale, useT } from "../../i18n";

/** Evidence badges offered for measured values (SRS §4.2). */
const EVIDENCE_CHOICES = ["verified", "unknown", "inferred"] as const;
type EvidenceChoice = (typeof EVIDENCE_CHOICES)[number];

type Group = SpaceCategory | typeof CUSTOM_SPACE_PRESET_ID;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function SpaceSelector() {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const readOnly = useStudio(selectReadOnly);
  const editDna = useStudio((s) => s.editDna);
  const project = useStudio((s) => s.workspace!.project);
  const dna = useStudio((s) => s.workspace!.draftDna) as ProjectDNA;
  const catalog = dna.spaceCatalog;
  const active = resolveActiveSpace(dna);
  const [group, setGroup] = useState<Group | null>(() =>
    active?.custom ? CUSTOM_SPACE_PRESET_ID : (active?.preset?.category ?? null),
  );

  const suggested = suggestArchetype(project.projectType, dna.interior?.buildingUseId);
  const archetypeId = catalog?.buildingArchetype;
  const archetypeLabel = (id: string) => {
    const a = SPACE_CATALOG.archetype(id);
    return a ? (locale === "vi" ? a.labelVi : a.labelEn) : id;
  };
  const presetLabel = (p: SpacePreset) => (locale === "vi" ? p.labelVi : capitalize(p.labelEn));

  const write = (next: SpaceCatalogExtension) => editDna("spaceCatalog", next);
  const withActive = (spaces: SpaceInstance[], activeSpaceId?: string): SpaceCatalogExtension => ({
    version: 1,
    buildingArchetype: archetypeId!,
    spaces,
    ...(activeSpaceId ? { activeSpaceId } : {}),
  });

  const chooseArchetype = (id: string | undefined) => {
    if (!id) return;
    const spaces = catalog?.spaces ?? [];
    // Keep the active space only while it still belongs to the chosen building type.
    const keep =
      active && (active.custom || active.preset?.buildingArchetypes.includes(id))
        ? active.space.id
        : undefined;
    write({ version: 1, buildingArchetype: id, spaces, ...(keep ? { activeSpaceId: keep } : {}) });
    if (!keep) setGroup(null);
  };

  const choosePreset = (preset: SpacePreset) => {
    const spaces = catalog?.spaces ?? [];
    const existing = spaces.find((s) => s.presetId === preset.id);
    if (existing) return write(withActive(spaces, existing.id));
    const created: SpaceInstance = {
      id: newSpaceId(),
      presetId: preset.id,
      facts: {},
      lockedElementIds: [],
      approvedOptionalIds: [],
    };
    write(withActive([...spaces, created], created.id));
  };

  const chooseCustom = () => {
    setGroup(CUSTOM_SPACE_PRESET_ID);
    const spaces = catalog?.spaces ?? [];
    const existing = spaces.find((s) => s.presetId === CUSTOM_SPACE_PRESET_ID);
    if (existing) return write(withActive(spaces, existing.id));
    const created: SpaceInstance = {
      id: newSpaceId(),
      presetId: CUSTOM_SPACE_PRESET_ID,
      facts: {},
      lockedElementIds: [],
      approvedOptionalIds: [],
    };
    write(withActive([...spaces, created], created.id));
  };

  const patchActive = (patch: (space: SpaceInstance) => SpaceInstance) => {
    if (!catalog || !active) return;
    const spaces = catalog.spaces.map((s) => (s.id === active.space.id ? patch(s) : s));
    write(withActive(spaces, active.space.id));
  };

  const presets = archetypeId ? SPACE_CATALOG.spacesFor(archetypeId) : [];
  const groups = archetypeId ? SPACE_CATALOG.categoriesFor(archetypeId) : [];
  const inGroup = presets.filter((p) => p.category === group);

  return (
    <SectionPanel title={t("spaceSelector.title")}>
      <div className="space-selector" data-testid="space-selector">
        <p className="field-hint">{t("spaceSelector.intro")}</p>
        <SelectField
          label={t("spaceSelector.archetype")}
          hint={
            suggested
              ? t("spaceSelector.suggested", { label: archetypeLabel(suggested) })
              : t("spaceSelector.noSuggestion")
          }
          disabled={readOnly}
          allowEmpty={!archetypeId}
          value={archetypeId}
          options={SPACE_CATALOG.archetypes.map((a) => ({
            value: a.id,
            label: archetypeLabel(a.id),
          }))}
          onChange={chooseArchetype}
        />

        {archetypeId && (
          <FieldGroup label={t("spaceSelector.group")}>
            <div
              className="interior-scene-chips"
              role="group"
              aria-label={t("spaceSelector.group")}
            >
              {groups.map((category) => (
                <button
                  type="button"
                  className="chip"
                  key={category}
                  aria-pressed={group === category}
                  disabled={readOnly}
                  onClick={() => setGroup(category)}
                >
                  {t(`spaceSelector.category.${category}`)}
                </button>
              ))}
              <button
                type="button"
                className="chip"
                aria-pressed={group === CUSTOM_SPACE_PRESET_ID}
                disabled={readOnly}
                onClick={chooseCustom}
              >
                {t("spaceSelector.custom")}
              </button>
            </div>
          </FieldGroup>
        )}

        {archetypeId && group && group !== CUSTOM_SPACE_PRESET_ID && (
          <FieldGroup label={t("spaceSelector.space")}>
            <div
              className="interior-scene-chips"
              role="group"
              aria-label={t("spaceSelector.space")}
            >
              {inGroup.map((preset) => (
                <button
                  type="button"
                  className="chip"
                  key={preset.id}
                  aria-pressed={active?.preset?.id === preset.id}
                  disabled={readOnly}
                  onClick={() => choosePreset(preset)}
                  title={
                    preset.availability === "optional" ? t("spaceSelector.optional") : undefined
                  }
                >
                  {presetLabel(preset)}
                  {preset.availability === "optional" && " *"}
                </button>
              ))}
            </div>
          </FieldGroup>
        )}

        {active?.custom && (
          <TextField
            label={t("spaceSelector.customLabel")}
            placeholder={t("spaceSelector.customPlaceholder")}
            disabled={readOnly}
            value={active.space.label}
            onChange={(label) =>
              patchActive(({ label: _old, ...rest }) => (label ? { ...rest, label } : rest))
            }
          />
        )}

        {active?.preset && active.preset.variants.length > 0 && (
          <SelectField
            label={t("spaceSelector.variant")}
            disabled={readOnly}
            value={active.space.variantId}
            options={active.preset.variants.map((v) => ({
              value: v.id,
              label: locale === "vi" ? v.labelVi : v.labelEn,
            }))}
            onChange={(variantId) =>
              patchActive(({ variantId: _old, ...rest }) =>
                variantId ? { ...rest, variantId } : rest,
              )
            }
          />
        )}

        {active && (
          <ActiveSpaceFacts
            key={active.space.id}
            space={active.space}
            preset={active.preset}
            disabled={readOnly}
            onPatch={patchActive}
          />
        )}

        <p className="field-hint" data-testid="space-active">
          {active
            ? t("spaceSelector.active", {
                label: active.preset
                  ? presetLabel(active.preset)
                  : (active.space.label ?? t("spaceSelector.custom")),
              })
            : t("spaceSelector.none")}
        </p>
      </div>
    </SectionPanel>
  );
}

/** Evidence badge + measured dimensions (blank until measured) + optional approvals. */
function ActiveSpaceFacts({
  space,
  preset,
  disabled,
  onPatch,
}: {
  space: SpaceInstance;
  preset: SpacePreset | null;
  disabled: boolean;
  onPatch: (patch: (space: SpaceInstance) => SpaceInstance) => void;
}) {
  const t = useT();
  const stored = SPACE_DIMENSION_FACTS.map((key) => space.facts[key]?.evidence.status).find(
    (status): status is EvidenceChoice =>
      status !== undefined && (EVIDENCE_CHOICES as readonly string[]).includes(status),
  );
  const [evidence, setEvidence] = useState<EvidenceChoice>(stored ?? "unknown");

  const setDimension = (key: SpaceDimensionFact, value: number | undefined) => {
    if (value !== undefined && !(Number.isFinite(value) && value > 0)) return;
    onPatch((s) => {
      const { [key]: _old, ...facts } = s.facts;
      if (value === undefined) return { ...s, facts };
      return {
        ...s,
        facts: { ...facts, [key]: { value, evidence: { status: evidence, sourceAssetIds: [] } } },
      };
    });
  };

  const chooseEvidence = (status: EvidenceChoice) => {
    setEvidence(status);
    onPatch((s) => {
      const facts = { ...s.facts };
      for (const key of SPACE_DIMENSION_FACTS) {
        const fact = facts[key];
        if (fact) facts[key] = { ...fact, evidence: { ...fact.evidence, status } };
      }
      return { ...s, facts };
    });
  };

  const dimension = (key: SpaceDimensionFact) => {
    const value = space.facts[key]?.value;
    return typeof value === "number" ? value : undefined;
  };

  return (
    <>
      <FieldGroup label={t("spaceSelector.dimensions")} hint={t("spaceSelector.dimensionsHint")}>
        <div className="segmented" role="group" aria-label={t("spaceSelector.evidence")}>
          {EVIDENCE_CHOICES.map((status) => (
            <button
              type="button"
              key={status}
              aria-pressed={evidence === status}
              disabled={disabled}
              onClick={() => chooseEvidence(status)}
            >
              {t(`spaceSelector.evidenceStatus.${status}`)}
            </button>
          ))}
        </div>
      </FieldGroup>
      <div className="field-row">
        {SPACE_DIMENSION_FACTS.map((key) => (
          <NumberField
            key={key}
            label={t(`spaceSelector.dimension.${key}`)}
            suffix="m"
            disabled={disabled}
            value={dimension(key)}
            onChange={(value) => setDimension(key, value)}
          />
        ))}
      </div>
      {preset && preset.optional.length > 0 && (
        <FieldGroup label={t("spaceSelector.optionalItems")} hint={t("spaceSelector.optionalHint")}>
          <div className="interior-scene-chips">
            {preset.optional.map((item) => {
              const on = space.approvedOptionalIds.includes(item.id);
              return (
                <button
                  type="button"
                  className="chip"
                  key={item.id}
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() =>
                    onPatch((s) => ({
                      ...s,
                      approvedOptionalIds: on
                        ? s.approvedOptionalIds.filter((id) => id !== item.id)
                        : [...s.approvedOptionalIds, item.id],
                    }))
                  }
                >
                  {item.en}
                </button>
              );
            })}
          </div>
        </FieldGroup>
      )}
    </>
  );
}
