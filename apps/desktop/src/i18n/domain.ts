/**
 * Display text for things the domain package and the backend produce in English:
 * validation messages (matched by pattern, so the domain stays untouched) and error
 * headlines per error code / provider error kind. The original text is never lost: an
 * unknown message is shown as is, and backend messages are kept as the detail line.
 */
import type { AppErrorCode } from "@arch/domain";
import { t, type TFunction, type TKey } from "./index";

type Rule = [RegExp, (m: RegExpExecArray, tr: TFunction) => string];

const RULES: readonly Rule[] = [
  [/^Enter a valid number\.$/, (_, tr) => tr("validation.validNumber")],
  [/^This field is required\.$/, (_, tr) => tr("validation.required")],
  [/^Must be at least (.+)\.$/, (m, tr) => tr("validation.atLeast", { min: m[1]! })],
  [/^Must be greater than (.+)\.$/, (m, tr) => tr("validation.greaterThan", { min: m[1]! })],
  [/^Must be at most (.+)\.$/, (m, tr) => tr("validation.atMost", { max: m[1]! })],
  [/^This field cannot be empty\.$/, (_, tr) => tr("validation.notEmpty")],
  [/^Enter a whole number\.$/, (_, tr) => tr("validation.wholeNumber")],
  [/^Invalid camera id\.$/, (_, tr) => tr("validation.invalidCameraId")],
  [/^Choose a view type from the list\.$/, (_, tr) => tr("validation.chooseViewType")],
  [/^Another camera already uses this id\.$/, (_, tr) => tr("validation.cameraIdTaken")],
  [/^Another camera already uses this name\.$/, (_, tr) => tr("validation.cameraNameTaken")],
  [/^The compiled positive prompt is empty\.$/, (_, tr) => tr("validation.promptEmpty")],
  [/^A reference image is listed twice\.$/, (_, tr) => tr("validation.referenceTwice")],
  [
    /^(.+) does not accept reference images\. Untick them to continue\.$/,
    (m, tr) => tr("validation.noReferences", { model: m[1]! }),
  ],
  [
    /^(.+) accepts at most (\d+) reference image\(s\); (\d+) selected\.$/,
    (m, tr) => tr("validation.tooManyReferences", { model: m[1]!, max: m[2]!, count: m[3]! }),
  ],
  [
    /^(.+) needs at least one reference image\.$/,
    (m, tr) => tr("validation.needsReference", { model: m[1]! }),
  ],
  [/^A selected reference no longer exists\.$/, (_, tr) => tr("validation.referenceGone")],
  [/^A selected reference file is missing\.$/, (_, tr) => tr("validation.referenceMissingFile")],
  [/^Request at least one output\.$/, (_, tr) => tr("validation.atLeastOneOutput")],
  [
    /^(.+) returns at most (\d+) image\(s\) per request\.$/,
    (m, tr) => tr("validation.tooManyOutputs", { model: m[1]!, max: m[2]! }),
  ],
  [
    /^Aspect ratio (.+) is not offered by (.+)\.$/,
    (m, tr) => tr("validation.aspectNotOffered", { value: m[1]!, model: m[2]! }),
  ],
  [
    /^(.+) chooses the aspect ratio itself; leave it unset\.$/,
    (m, tr) => tr("validation.aspectChosenByModel", { model: m[1]! }),
  ],
  [
    /^Image size (.+) is not offered by (.+)\.$/,
    (m, tr) => tr("validation.sizeNotOffered", { value: m[1]!, model: m[2]! }),
  ],
  [
    /^(.+) chooses the image size itself; leave it unset\.$/,
    (m, tr) => tr("validation.sizeChosenByModel", { model: m[1]! }),
  ],
  [/^(.+) does not support a fixed seed\.$/, (m, tr) => tr("validation.noSeed", { model: m[1]! })],
  [/^Seed must be a whole number ≥ 0\.$/, (_, tr) => tr("validation.seedWhole")],
  [
    /^Quality (.+) is not offered by (.+)\.$/,
    (m, tr) => tr("validation.qualityNotOffered", { value: m[1]!, model: m[2]! }),
  ],
  [
    /^(.+) has no quality choice; leave it unset\.$/,
    (m, tr) => tr("validation.noQuality", { model: m[1]! }),
  ],
  [/^No published price for (.+)$/, (m, tr) => tr("validation.noPriceFor", { size: m[1]! })],
];

/** A domain message in the current language; unknown messages are returned unchanged. */
export function translateDomainMessage(message: string, tr: TFunction = t): string {
  for (const [re, render] of RULES) {
    const m = re.exec(message);
    if (m) return render(m, tr);
  }
  return message;
}

const CODES: readonly AppErrorCode[] = [
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "IO_ERROR",
  "DB_ERROR",
  "CONFLICT",
  "UNSUPPORTED_FILE",
  "INVALID_STATE",
  "DUPLICATE_ASSET",
  "PROVIDER_NOT_CONFIGURED",
  "PROVIDER_ERROR",
];

const KINDS = [
  "auth",
  "rate_limited",
  "blocked",
  "invalid_request",
  "network",
  "timeout",
  "bad_response",
  "interrupted",
  "cancelled",
] as const;
type ErrorKind = (typeof KINDS)[number];

/** Short headline for a provider error kind (`auth`, `timeout`, …). */
export function errorKindLabel(kind: string | null | undefined, tr: TFunction = t): string {
  return KINDS.includes(kind as ErrorKind)
    ? tr(`errors.kind.${kind as ErrorKind}`)
    : tr("errors.kind.unknown");
}

/**
 * Headline for an AppError. PROVIDER_ERROR carries the provider error kind in its details;
 * that is more useful than the code.
 */
export function errorHeadline(
  err: { code?: string; details?: unknown },
  tr: TFunction = t,
): string {
  if (err.code === "PROVIDER_ERROR") {
    const kind = (err.details as { kind?: unknown } | undefined)?.kind;
    if (typeof kind === "string" && KINDS.includes(kind as ErrorKind))
      return tr(`errors.kind.${kind as ErrorKind}`);
  }
  return CODES.includes(err.code as AppErrorCode)
    ? tr(`errors.code.${err.code as AppErrorCode}`)
    : tr("common.somethingWrong");
}

const READINESS_KEYS = {
  "building.architecturalStyle": "readiness.architecturalStyle",
  "building.floors": "readiness.floors",
  "context.macroContext": "readiness.macroContext",
  azimuthDeg: "readiness.azimuthDeg",
  elevationDeg: "readiness.elevationDeg",
  distanceM: "readiness.distanceM",
  lensMm: "readiness.lensMm",
} as const satisfies Record<string, TKey>;

/** Label of a domain readiness item (DNA checklist, camera fields) by its stable key. */
export function readinessLabel(item: { key: string; label: string }, tr: TFunction = t): string {
  const key = READINESS_KEYS[item.key as keyof typeof READINESS_KEYS];
  return key ? tr(key) : item.label;
}
