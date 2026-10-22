import { HelpPopover } from "../../components/common/HelpPopover";
/**
 * Space selector wizard (ADR-034 P1a, SRS §4.2): building type → floor (optional) → group →
 * space → variant, with an "other / custom" space. It is the only writer of
 * `dna.spaceCatalog` and picks the one active space the prompt describes (`SPACE SCOPE`).
 * The catalog is read-only data; the project stores only preset ids, the floor, measured and
 * placement facts with their evidence, locked elements and the user's approvals.
 *
 * For an interior project it also suggests the ADR-027 room of the active space; the
 * interior DNA stays the owner of `interior.roomId`, and the suggestion is one click.
 */
import { useState } from "react";
import {
  CUSTOM_SPACE_PRESET_ID,
  LOCKABLE_SPACE_ELEMENTS,
  SPACE_CATALOG,
  SPACE_DIMENSION_FACTS,
  lockableElements,
  newSpaceId,
  placementFactsFor,
  resolveActiveSpace,
  spaceFloorOptions,
  suggestArchetype,
  suggestInteriorRoom,
  type ProjectDNA,
  type SpaceCatalogExtension,
  type SpaceCategory,
  type SpaceDimensionFact,
  type SpaceFloorOption,
  type SpaceInstance,
  type SpacePlacementFact,
  type SpacePreset,
} from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { SectionPanel } from "../../components/panels/SectionPanel";
import {
  FieldGroup,
  NumberField,
  SelectField,
  TagListField,
  TextField,
} from "../../components/panels/fields";
import { useLocale, useT, type TFunction } from "../../i18n";
import { ROOMS, catalogLabel } from "../../lib/interior";

/** Evidence badges offered for space facts (dimensions and placement facts). */
const EVIDENCE_CHOICES = ["verified", "user_declared", "unknown"] as const;
type EvidenceChoice = (typeof EVIDENCE_CHOICES)[number];

const isEvidenceChoice = (status: string | undefined): status is EvidenceChoice =>
  status !== undefined && (EVIDENCE_CHOICES as readonly string[]).includes(status);

type Group = SpaceCategory | typeof CUSTOM_SPACE_PRESET_ID;

type BuiltElementId =
  (typeof LOCKABLE_SPACE_ELEMENTS)[keyof typeof LOCKABLE_SPACE_ELEMENTS][number]["id"];
/** Built elements have translated labels; a preset's optional items show their prompt text. */
const BUILT_ELEMENT_IDS: ReadonlySet<string> = new Set(
  Object.values(LOCKABLE_SPACE_ELEMENTS).flatMap((items) => items.map((item) => item.id)),
);

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const floorLabel = (option: SpaceFloorOption, t: TFunction) =>
  option.kind === "level"
    ? t("spaceSelector.floorLevel", { n: option.level })
    : option.kind === "other"
      ? option.id
      : t(`spaceSelector.floorKind.${option.kind}`);

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
  // The floor of the next space picked; the active space's own floor while one is active.
  const [pendingFloor, setPendingFloor] = useState<string | undefined>(active?.space.floorId);
  const floorId = active ? active.space.floorId : pendingFloor;
  const roomSuggestion = suggestInteriorRoom(dna);

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

  /** Activates the space of a preset on the current floor, creating it when missing. */
  const activatePreset = (presetId: string) => {
    const spaces = catalog?.spaces ?? [];
    const existing = spaces.find((s) => s.presetId === presetId && s.floorId === floorId);
    if (existing) return write(withActive(spaces, existing.id));
    const created: SpaceInstance = {
      id: newSpaceId(),
      presetId,
      ...(floorId ? { floorId } : {}),
      facts: {},
      lockedElementIds: [],
      approvedOptionalIds: [],
    };
    write(withActive([...spaces, created], created.id));
  };

  const choosePreset = (preset: SpacePreset) => activatePreset(preset.id);

  const chooseCustom = () => {
    setGroup(CUSTOM_SPACE_PRESET_ID);
    activatePreset(CUSTOM_SPACE_PRESET_ID);
  };

  const patchActive = (patch: (space: SpaceInstance) => SpaceInstance) => {
    if (!catalog || !active) return;
    const spaces = catalog.spaces.map((s) => (s.id === active.space.id ? patch(s) : s));
    write(withActive(spaces, active.space.id));
  };

  const chooseFloor = (next: string | undefined) => {
    setPendingFloor(next);
    if (active)
      patchActive(({ floorId: _old, ...rest }) => (next ? { ...rest, floorId: next } : rest));
  };

  const presets = archetypeId ? SPACE_CATALOG.spacesFor(archetypeId) : [];
  const groups = archetypeId ? SPACE_CATALOG.categoriesFor(archetypeId) : [];
  const inGroup = presets.filter((p) => p.category === group);

  return (
    <SectionPanel title={t("spaceSelector.title")}>
      <div className="space-selector" data-testid="space-selector">
        <HelpPopover topic={t("interior.space")}>{t("spaceSelector.intro")}</HelpPopover>
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
          <SelectField
            label={t("spaceSelector.floor")}
            hint={t("spaceSelector.floorHint")}
            disabled={readOnly}
            value={floorId}
            options={spaceFloorOptions(dna.building.floors, floorId).map((option) => ({
              value: option.id,
              label: floorLabel(option, t),
            }))}
            onChange={chooseFloor}
          />
        )}

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

        {roomSuggestion && (
          <div className="space-room-suggestion" data-testid="space-room-suggestion">
            <span className="field-hint">
              {t("spaceSelector.roomSuggestion", {
                room: catalogLabel(ROOMS, roomSuggestion, locale),
              })}
            </span>
            <button
              type="button"
              className="btn btn-xs"
              disabled={readOnly || dna.locks.building}
              onClick={() => editDna("interior.roomId", roomSuggestion)}
            >
              {t("spaceSelector.applyRoom")}
            </button>
          </div>
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

/**
 * Facts of the active space, each with an evidence badge: the measured dimensions (blank
 * until measured, one badge for the measurement), the placement facts the scene-object rules
 * read (a villa yard's driveway and hardscape, a garage bay), then locked elements and
 * optional approvals.
 */
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
    isEvidenceChoice,
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

  const placementFacts = placementFactsFor(preset);
  /** Records the fact as present with that evidence, or removes it (`null`). */
  const setPlacementFact = (key: SpacePlacementFact, status: EvidenceChoice | null) =>
    onPatch((s) => {
      const { [key]: old, ...facts } = s.facts;
      if (status === null) return { ...s, facts };
      const sourceAssetIds = old?.evidence.sourceAssetIds ?? [];
      return {
        ...s,
        facts: { ...facts, [key]: { value: true, evidence: { status, sourceAssetIds } } },
      };
    });

  const lockable = lockableElements(preset);
  const lockableIds = new Set(lockable.map((item) => item.id));
  const extraLocked = space.lockedElementIds.filter((id) => !lockableIds.has(id));
  const toggleLocked = (id: string) =>
    onPatch((s) => ({
      ...s,
      lockedElementIds: s.lockedElementIds.includes(id)
        ? s.lockedElementIds.filter((x) => x !== id)
        : [...s.lockedElementIds, id],
    }));

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

      {placementFacts.length > 0 && (
        <FieldGroup
          label={t("spaceSelector.placementFacts")}
          hint={t("spaceSelector.placementHint")}
        >
          {placementFacts.map((key) => {
            const fact = Object.hasOwn(space.facts, key) ? space.facts[key] : undefined;
            const present = fact !== undefined && fact.value !== false && fact.value !== null;
            const label = t(`spaceSelector.placementFact.${key}`);
            return (
              <div className="space-fact-row" key={key} data-testid={`space-fact-${key}`}>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={present}
                    disabled={disabled}
                    onChange={(event) =>
                      setPlacementFact(key, event.target.checked ? "user_declared" : null)
                    }
                  />
                  {label}
                </label>
                {present && (
                  <div
                    className="segmented"
                    role="group"
                    aria-label={t("spaceSelector.factEvidence", { label })}
                  >
                    {EVIDENCE_CHOICES.map((choice) => (
                      <button
                        type="button"
                        key={choice}
                        aria-pressed={fact.evidence.status === choice}
                        disabled={disabled}
                        onClick={() => setPlacementFact(key, choice)}
                      >
                        {t(`spaceSelector.evidenceStatus.${choice}`)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </FieldGroup>
      )}

      {lockable.length > 0 && (
        <FieldGroup label={t("spaceSelector.lockedElements")} hint={t("spaceSelector.lockedHint")}>
          <div className="interior-scene-chips" data-testid="space-locked-elements">
            {lockable.map((item) => (
              <button
                type="button"
                className="chip"
                key={item.id}
                aria-pressed={space.lockedElementIds.includes(item.id)}
                disabled={disabled}
                onClick={() => toggleLocked(item.id)}
              >
                {BUILT_ELEMENT_IDS.has(item.id)
                  ? t(`spaceSelector.lockable.${item.id as BuiltElementId}`)
                  : item.en}
              </button>
            ))}
          </div>
        </FieldGroup>
      )}
      <TagListField
        label={t("spaceSelector.lockedOther")}
        placeholder={t("spaceSelector.lockedPlaceholder")}
        disabled={disabled}
        value={extraLocked}
        onChange={(next) =>
          onPatch((s) => ({
            ...s,
            lockedElementIds: [...s.lockedElementIds.filter((id) => lockableIds.has(id)), ...next],
          }))
        }
      />

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
