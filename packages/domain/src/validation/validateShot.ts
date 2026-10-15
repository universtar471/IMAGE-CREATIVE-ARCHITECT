/**
 * Unified Conflict Validator (ADR-034, SRS §3.2, §12.3–12.4).
 *
 * `validateShot` checks one shot (DNA + shot intent + the free-text extra prompt) before any
 * paid generation is submitted and returns BLOCK / WARN / ALLOW. Pure and deterministic:
 * the same input always yields the same issues in the same order.
 *
 * Severity policy:
 * - BLOCK cannot be cleared by an exception; the project data must be edited.
 * - WARN can be accepted for this shot (`approvedExceptions`); accepted issues stay listed
 *   with `accepted: true` but no longer affect the verdict.
 * - A BLOCK raised from data that is not confirmed (inferred or unknown evidence) is lowered
 *   to WARN, so a guess never hard-blocks the user.
 */
import type { ProjectDNA } from "../schemas/projectDna";
import { ProjectTypeSchema, type ProjectType } from "../schemas/enums";
import type { SiteSide } from "../schemas/extensions";
import { VisualIntentSchema, type VisualIntent } from "../camera/intent";
import { z } from "zod";
import { isConfirmed } from "../facts/evidence";
import { resolveSiteAdjacency, type ResolvedSiteAdjacency } from "../site/adjacency";
import { isFacadeExposable, resolveVisibility, type Facade } from "../site/visibility";
import { revealedSide } from "../prompt/topology";
import { resolveActiveSpace } from "../spaceCatalog/resolve";
import {
  CONFLICT_CODES,
  VALIDATOR_VERSION,
  type ConflictCode,
  type ConflictSeverity,
  type ShotVerdict,
} from "./codes";
import {
  CORNER_PHRASES,
  EXACT_DIMENSION_PHRASES,
  LEFT_SIDE_PHRASES,
  NIGHT_PHRASES,
  REAR_FACADE_PHRASES,
  REMOVE_NEIGHBOUR_PHRASES,
  RIGHT_SIDE_PHRASES,
  SHOW_SIDE_PHRASES,
  findPhrases,
  firstPhrase,
  prepareText,
  type PreparedText,
} from "./phrases";

/** What one generation request asks for (SRS §3.1 Shot Intent; P0 subset). */
export type ShotIntent = {
  projectType: ProjectType;
  /** The DNA camera being rendered; unknown ids are ignored, as in the compiler. */
  cameraId?: string | null;
  /** P1: the target space of the Space Catalog. */
  targetSpaceId?: string | null;
  /** P2: the target architectural detail. */
  targetDetailId?: string | null;
  /** P2a visual camera choice; kept in the shot snapshot, never in DNA. */
  visualIntent?: VisualIntent;
};

export const ShotIntentSchema = z.object({
  projectType: ProjectTypeSchema,
  cameraId: z.string().nullable().optional(),
  targetSpaceId: z.string().nullable().optional(),
  targetDetailId: z.string().nullable().optional(),
  visualIntent: VisualIntentSchema.optional(),
});

export type ValidateShotInput = {
  dna: ProjectDNA;
  shotIntent: ShotIntent;
  /** Free text the user adds on top of the compiled prompt; validated before it is appended. */
  extraPrompt?: string | null;
  /** WARN codes the user accepted for this shot. BLOCK codes listed here are ignored. */
  approvedExceptions?: readonly ConflictCode[];
};

export type IssueParams = Record<string, string | number>;

export type ConflictIssue = {
  code: ConflictCode;
  severity: ConflictSeverity;
  /** Where the conflict comes from: a DNA path ("cameras[0]") or "extraPrompt". */
  path: string;
  messageKey: `conflicts.${ConflictCode}`;
  params: IssueParams;
  exceptionAllowed: boolean;
  /** True when this WARN was accepted as an exception for the shot. */
  accepted: boolean;
};

export type ShotValidation = {
  verdict: ShotVerdict;
  issues: ConflictIssue[];
  validatorVersion: typeof VALIDATOR_VERSION;
};

type IssueDraft = {
  code: ConflictCode;
  severity?: ConflictSeverity;
  path: string;
  params?: IssueParams;
};

type RuleContext = {
  dna: ProjectDNA;
  shot: ShotIntent;
  extra: PreparedText | null;
  adjacency: ResolvedSiteAdjacency;
};

type ConflictRule = { code: ConflictCode; check: (ctx: RuleContext) => IssueDraft[] };

// ---------------------------------------------------------------- rules

const isExterior = (shot: ShotIntent) => shot.projectType !== "interior";

function shotCamera(ctx: RuleContext) {
  const id = ctx.shot.cameraId;
  if (!id) return null;
  const index = ctx.dna.cameras.findIndex((c) => c.id === id);
  return index >= 0 ? { camera: ctx.dna.cameras[index]!, index } : null;
}

/** BLOCK when confirmed, WARN when the conflicting sides are only inferred or unknown. */
function adjacencySeverity(adjacency: ResolvedSiteAdjacency, sides: readonly SiteSide[]) {
  return sides.some((s) => isConfirmed(adjacency[s].evidence)) ? "BLOCK" : "WARN";
}

const attached = (a: ResolvedSiteAdjacency, s: SiteSide) => a[s].kind === "attached_building";
const sideParam = (sides: readonly SiteSide[]) => (sides.length === 1 ? sides[0]! : "both");

function mentionedSides(text: PreparedText): Array<"left" | "right"> {
  const sides: Array<"left" | "right"> = [];
  if (firstPhrase(text, LEFT_SIDE_PHRASES)) sides.push("left");
  if (firstPhrase(text, RIGHT_SIDE_PHRASES)) sides.push("right");
  return sides;
}

/**
 * The camera or the extra prompt would expose a side that is an attached building.
 * - Camera: a side or rear elevation aimed at an attached side. An oblique corner camera is
 *   fine: the compiler renders it as a front-facade oblique street view (ADR-028).
 * - Extra prompt: removing neighbours where one exists, or asking for a side facade /
 *   corner condition when every side it could mean is attached.
 */
const adjacentBuildingRule: ConflictRule = {
  code: "ADJACENT_BUILDING_CONFLICT",
  check(ctx) {
    if (!isExterior(ctx.shot)) return [];
    const { adjacency } = ctx;
    const issues: IssueDraft[] = [];
    const found = shotCamera(ctx);
    const cameraSide = found ? revealedSide(found.camera) : null;
    if (found) {
      const { camera, index } = found;
      const facing: SiteSide | null =
        camera.viewType === "exterior_side"
          ? cameraSide
          : camera.viewType === "exterior_rear"
            ? "rear"
            : null;
      if (facing && attached(adjacency, facing))
        issues.push({
          code: "ADJACENT_BUILDING_CONFLICT",
          severity: adjacencySeverity(adjacency, [facing]),
          path: `cameras[${index}]`,
          params: { source: "camera", side: facing, viewType: camera.viewType },
        });
    }
    const text = ctx.extra;
    if (!text) return issues;
    const named = mentionedSides(text);
    const remove = firstPhrase(text, REMOVE_NEIGHBOUR_PHRASES);
    const expose = firstPhrase(text, SHOW_SIDE_PHRASES) ?? firstPhrase(text, CORNER_PHRASES);
    // The sides the text can mean: the ones it names, else the camera's, else both.
    const candidates: Array<"left" | "right"> = named.length
      ? named
      : cameraSide
        ? [cameraSide]
        : ["left", "right"];
    let conflicting: SiteSide[] = [];
    let phrase = "";
    if (remove) {
      conflicting = candidates.filter((s) => attached(adjacency, s));
      if (!named.length && !conflicting.length && attached(adjacency, "rear"))
        conflicting = ["rear"];
      phrase = remove.text;
    }
    if (!conflicting.length && expose && candidates.every((s) => attached(adjacency, s))) {
      conflicting = candidates;
      phrase = expose.text;
    }
    if (conflicting.length)
      issues.push({
        code: "ADJACENT_BUILDING_CONFLICT",
        severity: adjacencySeverity(adjacency, conflicting),
        path: "extraPrompt",
        params: { source: "extraPrompt", side: sideParam(conflicting), phrase },
      });
    return issues;
  },
};

const DIMENSION_FACT = /width|depth|height|length|area|dimension|size/i;

/** Exact measurements requested while no measured dimension of the target is confirmed. */
const unverifiedGeometryRule: ConflictRule = {
  code: "UNVERIFIED_GEOMETRY",
  check(ctx) {
    if (!ctx.extra) return [];
    const match = firstPhrase(ctx.extra, EXACT_DIMENSION_PHRASES);
    if (!match) return [];
    const catalog = ctx.dna.spaceCatalog;
    const targetId = ctx.shot.targetSpaceId ?? catalog?.activeSpaceId;
    const space = catalog?.spaces.find((s) => s.id === targetId);
    const confirmed = Object.entries(space?.facts ?? {}).some(
      ([key, fact]) => DIMENSION_FACT.test(key) && isConfirmed(fact.evidence),
    );
    if (confirmed) return [];
    return [{ code: "UNVERIFIED_GEOMETRY", path: "extraPrompt", params: { phrase: match.text } }];
  },
};

const DAYTIME = new Set(["morning", "midday", "afternoon"]);
const DAYTIME_PRESET = /(?:^|[^a-z])(?:day|daylight|daytime|noon|midday|morning|afternoon|sunny)/i;

/** The locked lighting is a daytime setting; null when it is not locked or not daytime. */
function lockedDaytime(dna: ProjectDNA, shot: ShotIntent): string | null {
  if (!dna.locks.lighting) return null;
  const interiorTime = shot.projectType === "interior" ? dna.interior?.timeOfDay : undefined;
  const time = interiorTime ?? dna.lighting?.timeOfDay;
  if (time !== undefined) return DAYTIME.has(time) ? time : null;
  const preset = dna.lighting?.presetId;
  return preset && DAYTIME_PRESET.test(preset) ? preset : null;
}

/** Night or dusk requested while the lighting is locked to a daytime setting. */
const lockedLightingRule: ConflictRule = {
  code: "LOCKED_LIGHTING_CONFLICT",
  check(ctx) {
    if (!ctx.extra) return [];
    const daytime = lockedDaytime(ctx.dna, ctx.shot);
    if (!daytime) return [];
    const match = firstPhrase(ctx.extra, NIGHT_PHRASES);
    if (!match) return [];
    return [
      {
        code: "LOCKED_LIGHTING_CONFLICT",
        path: "extraPrompt",
        params: { phrase: match.text, locked: daytime },
      },
    ];
  },
};

/**
 * The target space (shot target, else the active space) must belong to the DNA archetype.
 * - Its preset does not list the archetype: BLOCK (fixed only by editing the selection).
 * - Its preset id is unknown to the catalog: WARN (data from a newer or older catalog).
 * A custom space has no preset and is never checked.
 */
const spaceNotInBuildingRule: ConflictRule = {
  code: "SPACE_NOT_IN_BUILDING",
  check(ctx) {
    const catalog = ctx.dna.spaceCatalog;
    const active = resolveActiveSpace(ctx.dna, { targetSpaceId: ctx.shot.targetSpaceId });
    if (!catalog || !active || active.custom) return [];
    const index = catalog.spaces.indexOf(active.space);
    const params = { presetId: active.space.presetId, archetype: catalog.buildingArchetype };
    const path = `spaceCatalog.spaces[${index}]`;
    if (!active.preset) return [{ code: "SPACE_NOT_IN_BUILDING", severity: "WARN", path, params }];
    if (active.preset.buildingArchetypes.includes(catalog.buildingArchetype)) return [];
    return [{ code: "SPACE_NOT_IN_BUILDING", path, params }];
  },
};

/**
 * The camera or the extra prompt targets a facade the visibility resolver marks occluded.
 * - Camera: a side or rear elevation (`exterior_side`, `exterior_rear`) aimed at a side
 *   that is unknown or behind a boundary wall. Corner and front cameras target the front
 *   facade; the resolver only narrows their wording.
 * - Extra prompt: asking for a side or rear facade when every side it can mean is hidden.
 * An attached side is left to ADJACENT_BUILDING_CONFLICT (a BLOCK), so one request never
 * raises both codes. Always WARN: the side may simply not be recorded yet (P2 detail targets
 * may escalate it).
 */
const occludedTargetRule: ConflictRule = {
  code: "OCCLUDED_TARGET",
  check(ctx) {
    if (!isExterior(ctx.shot)) return [];
    const { adjacency } = ctx;
    const hidden = (f: Facade) =>
      !isFacadeExposable(adjacency, f) && !(f !== "roof" && attached(adjacency, f));
    const issues: IssueDraft[] = [];
    const found = shotCamera(ctx);
    const cameraSide = found ? revealedSide(found.camera) : null;
    if (found) {
      const { camera, index } = found;
      const target: Facade | null =
        camera.viewType === "exterior_side"
          ? cameraSide
          : camera.viewType === "exterior_rear"
            ? "rear"
            : null;
      const visibility = resolveVisibility(adjacency, camera);
      if (target && visibility.occludedFacades.includes(target) && hidden(target))
        issues.push({
          code: "OCCLUDED_TARGET",
          path: `cameras[${index}]`,
          params: {
            source: "camera",
            facade: target,
            kind: adjacency[target as SiteSide].kind,
            viewType: camera.viewType,
          },
        });
    }
    const text = ctx.extra;
    if (!text) return issues;
    const side = firstPhrase(text, SHOW_SIDE_PHRASES);
    const rear = firstPhrase(text, REAR_FACADE_PHRASES);
    const facades: Facade[] = [];
    let phrase = "";
    if (side) {
      const named = mentionedSides(text);
      const candidates = named.length
        ? named
        : cameraSide
          ? [cameraSide]
          : (["left", "right"] as const);
      // Satisfiable when one candidate is free; all attached is ADJACENT_BUILDING_CONFLICT.
      if (candidates.every((s) => !isFacadeExposable(adjacency, s))) {
        facades.push(...candidates.filter(hidden));
        if (facades.length) phrase = side.text;
      }
    }
    if (rear && hidden("rear")) {
      facades.push("rear");
      phrase ||= rear.text;
    }
    if (facades.length)
      issues.push({
        code: "OCCLUDED_TARGET",
        path: "extraPrompt",
        params: { source: "extraPrompt", facade: facades.join(","), phrase },
      });
    return issues;
  },
};

/** Rules in evaluation order. Later phases append theirs here. */
export const SHOT_RULES: readonly ConflictRule[] = [
  spaceNotInBuildingRule,
  adjacentBuildingRule,
  occludedTargetRule,
  unverifiedGeometryRule,
  lockedLightingRule,
];

// ---------------------------------------------------------------- validator

const SEVERITY_RANK: Record<ConflictSeverity, number> = { BLOCK: 0, WARN: 1 };

export function validateShot(input: ValidateShotInput): ShotValidation {
  const extraText = input.extraPrompt?.trim();
  const ctx: RuleContext = {
    dna: input.dna,
    shot: input.shotIntent,
    extra: extraText ? prepareText(extraText) : null,
    adjacency: resolveSiteAdjacency(input.dna, input.shotIntent.projectType),
  };
  const approved = new Set<string>(input.approvedExceptions ?? []);
  const issues = SHOT_RULES.flatMap((rule) => rule.check(ctx)).map((draft): ConflictIssue => {
    const severity = draft.severity ?? CONFLICT_CODES[draft.code].defaultSeverity;
    const exceptionAllowed = severity === "WARN";
    return {
      code: draft.code,
      severity,
      path: draft.path,
      messageKey: `conflicts.${draft.code}`,
      params: draft.params ?? {},
      exceptionAllowed,
      accepted: exceptionAllowed && approved.has(draft.code),
    };
  });
  issues.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      compare(a.code, b.code) ||
      compare(a.path, b.path),
  );
  return { verdict: verdictOf(issues), issues, validatorVersion: VALIDATOR_VERSION };
}

export function verdictOf(issues: readonly Pick<ConflictIssue, "severity" | "accepted">[]) {
  if (issues.some((i) => i.severity === "BLOCK")) return "BLOCK" as const;
  if (issues.some((i) => i.severity === "WARN" && !i.accepted)) return "WARN" as const;
  return "ALLOW" as const;
}

/** WARN codes of a validation, sorted and unique (for `PromptBundle.resolvedWarnings`). */
export function warningCodes(validation: Pick<ShotValidation, "issues">): ConflictCode[] {
  return [
    ...new Set(validation.issues.filter((i) => i.severity === "WARN").map((i) => i.code)),
  ].sort(compare);
}

/** Every phrase of a set found in a text (exposed for UI highlighting and tests). */
export function detectPhrases(text: string, set: Parameters<typeof findPhrases>[1]): string[] {
  return findPhrases(prepareText(text), set).map((m) => m.text);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
