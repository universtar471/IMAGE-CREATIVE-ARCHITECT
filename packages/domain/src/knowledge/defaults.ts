import { emptyContextZone, CONTEXT_DIRECTIONS } from "../schemas/context";
import type { ProjectType } from "../schemas/enums";
import { defaultLockState, ProjectDNASchema, type ProjectDNA } from "../schemas/projectDna";
import { PROJECT_TYPE_LABELS } from "../labels";
import {
  DEFAULT_SUBTYPE,
  type BuildingPartial,
  type ContextPartial,
  type KnowledgePack,
} from "./pack";

export type WizardStarter = {
  architecturalStyle?: string;
  floors?: number;
  dimensions?: BuildingPartial["dimensions"];
  contextPresetId?: string;
};

export type InitialDNAInput = {
  projectType: ProjectType;
  subtype?: string | null;
  pack: KnowledgePack | null;
  starter?: WizardStarter;
};

/**
 * Build the resolved, validated DNA for a new project.
 * Order of precedence (later wins): empty base < pack defaults < context preset < wizard input.
 * The result is self-contained: it does not reference the pack by ID.
 */
export function createInitialDNA({
  projectType,
  subtype,
  pack,
  starter = {},
}: InitialDNAInput): ProjectDNA {
  const building = mergeBuilding(pack?.defaults.building ?? {}, {
    architecturalStyle: starter.architecturalStyle,
    floors: starter.floors,
    dimensions: starter.dimensions,
  });

  const preset = pack?.contextPresets.find((p) => p.id === starter.contextPresetId);
  const contextPartial = mergeContext(pack?.defaults.context ?? {}, preset?.context ?? {});

  const resolvedSubtype = subtype && subtype !== DEFAULT_SUBTYPE ? subtype : undefined;

  const candidate = {
    schemaVersion: 1,
    building: {
      schemaVersion: 1,
      buildingType: clean(building.buildingType) ?? PROJECT_TYPE_LABELS[projectType],
      subtype: clean(resolvedSubtype),
      architecturalStyle: clean(building.architecturalStyle),
      dimensions: stripUndefined(building.dimensions ?? {}),
      floors: building.floors,
      massing: {
        composition: clean(building.massing?.composition),
        mainVolume: clean(building.massing?.mainVolume),
        secondaryVolume: clean(building.massing?.secondaryVolume),
        voids: cleanList(building.massing?.voids),
        cantilever: clean(building.massing?.cantilever),
      },
      roof: {
        type: clean(building.roof?.type),
        pitch: clean(building.roof?.pitch),
        overhang: clean(building.roof?.overhang),
      },
      openings: {
        windowType: clean(building.openings?.windowType),
        frame: clean(building.openings?.frame),
        rhythm: clean(building.openings?.rhythm),
        glazing: clean(building.openings?.glazing),
      },
      materials: (building.materials ?? []).filter(
        (m) => m.zone.trim() !== "" && m.description.trim() !== "",
      ),
      colorPalette: cleanList(building.colorPalette),
      specialFeatures: cleanList(building.specialFeatures),
      notes: "",
    },
    context: {
      schemaVersion: 1,
      macroContext: clean(contextPartial.macroContext),
      climateContext: clean(contextPartial.climateContext),
      density: contextPartial.density,
      ...Object.fromEntries(
        CONTEXT_DIRECTIONS.map((dir) => {
          const z = contextPartial[dir] ?? {};
          return [
            dir,
            {
              ...emptyContextZone(),
              spaceType: clean(z.spaceType),
              roadType: clean(z.roadType),
              elements: cleanList(z.elements),
              vegetation: cleanList(z.vegetation),
              adjacentBuildings: cleanList(z.adjacentBuildings),
              notes: z.notes ?? "",
            },
          ];
        }),
      ),
      distantBackground: cleanList(contextPartial.distantBackground),
      atmosphereNotes: contextPartial.atmosphereNotes ?? "",
      negativeConstraints: cleanList([
        ...(pack?.negativeConstraints ?? []),
        ...(contextPartial.negativeConstraints ?? []),
      ]),
    },
    cameras: [],
    scene: { schemaVersion: 1, objects: [] },
    locks: defaultLockState(),
  };

  return ProjectDNASchema.parse(stripUndefined(candidate));
}

function mergeBuilding(base: BuildingPartial, over: BuildingPartial): BuildingPartial {
  return {
    ...base,
    ...stripUndefined(over),
    dimensions: { ...base.dimensions, ...stripUndefined(over.dimensions ?? {}) },
  };
}

function mergeContext(base: ContextPartial, over: ContextPartial): ContextPartial {
  const merged: ContextPartial = { ...base, ...stripUndefined(over) };
  for (const dir of CONTEXT_DIRECTIONS) {
    if (base[dir] || over[dir]) merged[dir] = { ...base[dir], ...stripUndefined(over[dir] ?? {}) };
  }
  merged.negativeConstraints = [
    ...(base.negativeConstraints ?? []),
    ...(over.negativeConstraints ?? []),
  ];
  return merged;
}

function clean(value: string | undefined | null): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}

/** Trim, drop empties, de-duplicate case-insensitively while keeping first spelling. */
export function cleanList(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values ?? []) {
    const t = v.trim();
    const k = t.toLowerCase();
    if (t && !seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

/** Recursively remove keys whose value is `undefined` (keeps persisted JSON clean). */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, stripUndefined(v)]),
    ) as T;
  }
  return value;
}
