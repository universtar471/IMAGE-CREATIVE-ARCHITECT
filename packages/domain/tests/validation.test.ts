import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONFLICT_CODES,
  CONFLICT_CODE_LIST,
  ProjectDNASchema,
  VALIDATOR_VERSION,
  isConflictCode,
  validateShot,
  warningCodes,
  type ProjectDNA,
  type ShotIntent,
  type SiteExtension,
} from "../src";

/** Real townhouse DNA: 3 cameras (front-left corner, front-right corner, aerial). */
const townhouse = (): ProjectDNA =>
  ProjectDNASchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../../../apps/desktop/tests/fixtures/nhapho-dna.json", import.meta.url),
        "utf8",
      ),
    ),
  );

const FRONT_LEFT = "CAM_01M4K1Q5C6PGJBEGD65E0JFSY0";
const FRONT_RIGHT = "CAM_01M4K1QAHYASB70RRGAWGASY57";
const SIDE_LEFT = "CAM_01M4K1QS1DEVEZ9ZMEPFT1E7X0";

/** Mid-block townhouse, both neighbours declared attached in the UI toggles. */
const midBlock = (): ProjectDNA => {
  const dna = townhouse();
  dna.context.siteTopology = { left: "attached", right: "attached", cornerLot: false };
  return dna;
};

/** Verified corner lot: street on the left, attached on the right. */
const cornerLot = (): ProjectDNA => {
  const dna = townhouse();
  dna.context.siteTopology = {
    left: "open",
    right: "attached",
    cornerLot: true,
    cornerSide: "left",
  };
  return dna;
};

const exterior = (cameraId: string | null = FRONT_LEFT): ShotIntent => ({
  projectType: "townhouse",
  cameraId,
});

const run = (dna: ProjectDNA, extraPrompt?: string, shot = exterior(), approved?: string[]) =>
  validateShot({
    dna,
    shotIntent: shot,
    extraPrompt,
    approvedExceptions: approved as never,
  });

describe("conflict code table (SRS §12.4)", () => {
  it("registers every SRS code with its default severity and message key", () => {
    expect(CONFLICT_CODE_LIST).toEqual([
      "SPACE_NOT_IN_BUILDING",
      "UNVERIFIED_GEOMETRY",
      "OCCLUDED_TARGET",
      "ADJACENT_BUILDING_CONFLICT",
      "OBJECT_NOT_ALLOWED_IN_SPACE",
      "OBJECT_NO_PLACEMENT_ZONE",
      "EFFECT_SOURCE_MISSING",
      "EFFECT_MOTION_CONFLICT",
      "LOCKED_LIGHTING_CONFLICT",
      "ENHANCE_PRESERVATION_RISK",
      "OUTPUT_SIZE_MISMATCH",
      "PAGE_COUNT_MISMATCH",
      "REQUIRED_IMAGE_MISSING",
      "PRINT_READABILITY_LOW",
      "UNVERIFIED_PUBLICATION_FACT",
    ]);
    const severities = Object.fromEntries(
      CONFLICT_CODE_LIST.map((c) => [
        c,
        CONFLICT_CODES[c].defaultSeverity + (CONFLICT_CODES[c].escalatesTo ? "/BLOCK" : ""),
      ]),
    );
    expect(severities).toMatchObject({
      SPACE_NOT_IN_BUILDING: "BLOCK",
      UNVERIFIED_GEOMETRY: "WARN/BLOCK",
      OCCLUDED_TARGET: "WARN/BLOCK",
      ADJACENT_BUILDING_CONFLICT: "BLOCK",
      OBJECT_NO_PLACEMENT_ZONE: "WARN/BLOCK",
      LOCKED_LIGHTING_CONFLICT: "BLOCK",
      ENHANCE_PRESERVATION_RISK: "WARN/BLOCK",
      PRINT_READABILITY_LOW: "WARN",
      UNVERIFIED_PUBLICATION_FACT: "BLOCK",
    });
    for (const c of CONFLICT_CODE_LIST) expect(CONFLICT_CODES[c].messageKey).toBe(`conflicts.${c}`);
    expect(isConflictCode("ADJACENT_BUILDING_CONFLICT")).toBe(true);
    expect(isConflictCode("toString")).toBe(false);
  });

  it("is versioned", () => {
    expect(VALIDATOR_VERSION).toBe("cv-1.0.0");
    expect(run(midBlock()).validatorVersion).toBe("cv-1.0.0");
  });
});

describe("validateShot — ALLOW", () => {
  it("allows a plain shot with no extra prompt", () => {
    expect(run(midBlock())).toEqual({ verdict: "ALLOW", issues: [], validatorVersion: "cv-1.0.0" });
  });

  it("AC-03: allows an oblique corner camera on an attached townhouse (compiled as oblique street)", () => {
    expect(run(midBlock(), undefined, exterior(FRONT_LEFT)).verdict).toBe("ALLOW");
    expect(run(midBlock(), undefined, exterior(FRONT_RIGHT)).verdict).toBe("ALLOW");
  });

  it("allows harmless extra prompts in both languages", () => {
    for (const text of [
      "add lush tropical planting and warm interior glow",
      "phong cách tối giản, tối ưu ánh sáng",
      "tôi muốn thêm cây xanh trước nhà",
      "ánh sáng chiếu tới mặt tiền",
      "cây che nhà bên cạnh một chút",
      "24mm lens, 35mm film look",
      "keep the neighbouring houses exactly as they are",
    ]) {
      expect(run(midBlock(), text).issues, text).toEqual([]);
    }
  });
});

describe("ADJACENT_BUILDING_CONFLICT", () => {
  it.each([
    "show the side facade",
    "Reveal the left side of the building",
    "remove the neighbouring houses",
    "render it as a detached house without neighbours",
    "corner view of the townhouse",
    "mở mặt hông bên trái",
    "mo mat hong ben trai",
    "xóa nhà bên cạnh",
    "xoa nha ben canh",
    "biến thành nhà lô góc",
    "bien thanh nha lo goc",
    "làm lộ hông nhà",
    "nhìn thấy hai mặt tiền",
  ])("AC-22: blocks %j on a mid-block townhouse", (text) => {
    const result = run(midBlock(), text);
    expect(result.verdict).toBe("BLOCK");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      code: "ADJACENT_BUILDING_CONFLICT",
      severity: "BLOCK",
      path: "extraPrompt",
      messageKey: "conflicts.ADJACENT_BUILDING_CONFLICT",
      exceptionAllowed: false,
      accepted: false,
      params: { source: "extraPrompt" },
    });
  });

  it("AC-03/AC-22: attached townhouse + oblique camera + 'show the side facade' → BLOCK, approval cannot clear it", () => {
    const result = run(midBlock(), "show the side facade", exterior(FRONT_LEFT), [
      "ADJACENT_BUILDING_CONFLICT",
    ]);
    expect(result.verdict).toBe("BLOCK");
    expect(result.issues[0]!.params).toEqual({
      source: "extraPrompt",
      side: "left",
      phrase: "show the side",
    });
  });

  it("AC-04: a verified corner lot may show that side", () => {
    expect(run(cornerLot(), "show the side facade", exterior(FRONT_LEFT)).verdict).toBe("ALLOW");
    expect(run(cornerLot(), "mở mặt hông bên trái", exterior(null)).verdict).toBe("ALLOW");
    expect(run(cornerLot(), "corner view", exterior(null)).verdict).toBe("ALLOW");
  });

  it("AC-04: an explicit verified site wins over the toggles", () => {
    const dna = midBlock();
    const verified = { status: "verified" as const, sourceAssetIds: ["AST_survey"] };
    const site: SiteExtension = {
      version: 1,
      coordinateConvention: "viewer_facing_front_facade",
      front: { kind: "street", evidence: verified },
      left: { kind: "street", evidence: verified },
      right: { kind: "attached_building", evidence: verified },
      rear: { kind: "unknown", evidence: { status: "unknown", sourceAssetIds: [] } },
    };
    dna.site = site;
    expect(run(dna, "show the side facade", exterior(FRONT_LEFT)).verdict).toBe("ALLOW");
    expect(run(dna, "show the side facade", exterior(FRONT_RIGHT)).verdict).toBe("BLOCK");
  });

  it("on a corner lot still blocks exposing or clearing the attached side", () => {
    const right = run(cornerLot(), "show the right side facade");
    expect(right.verdict).toBe("BLOCK");
    expect(right.issues[0]!.params.side).toBe("right");
    expect(run(cornerLot(), "xóa nhà bên phải", exterior(FRONT_LEFT)).verdict).toBe("ALLOW");
    expect(run(cornerLot(), "xóa nhà hàng xóm", exterior(null)).verdict).toBe("BLOCK");
    expect(run(cornerLot(), "remove the neighbour on the right side").verdict).toBe("BLOCK");
  });

  it("ignores negated requests", () => {
    for (const text of [
      "do not remove the neighbouring houses",
      "don't show the side facade",
      "không xóa nhà bên cạnh",
      "khong xoa nha ben canh",
      "giữ nguyên nhà bên cạnh, không làm lộ mặt hông",
      "đừng mở mặt hông",
      "never reveal the side walls",
    ]) {
      expect(run(midBlock(), text).verdict, text).toBe("ALLOW");
    }
  });

  it("blocks a side-elevation camera aimed at an attached side", () => {
    const dna = midBlock();
    dna.cameras.push({
      schemaVersion: 1,
      id: SIDE_LEFT,
      name: "Left side",
      viewType: "exterior_side",
      azimuthDeg: 90,
      isAnchorView: false,
      notes: "",
    });
    const result = run(dna, undefined, exterior(SIDE_LEFT));
    expect(result.verdict).toBe("BLOCK");
    expect(result.issues[0]).toMatchObject({
      path: "cameras[3]",
      params: { source: "camera", side: "left", viewType: "exterior_side" },
    });
    // The same camera on a corner lot whose left side is the street is fine.
    const corner = cornerLot();
    corner.cameras.push(dna.cameras[3]!);
    expect(run(corner, undefined, exterior(SIDE_LEFT)).verdict).toBe("ALLOW");
  });

  it("warns (exception allowed) when the attached side is only inferred from notes", () => {
    const dna = townhouse(); // "attached neighbouring townhouse" notes, no toggles
    const result = run(dna, "show the side facade");
    expect(result.verdict).toBe("WARN");
    expect(result.issues[0]).toMatchObject({ severity: "WARN", exceptionAllowed: true });
    const approved = run(dna, "show the side facade", exterior(), ["ADJACENT_BUILDING_CONFLICT"]);
    expect(approved.verdict).toBe("ALLOW");
    expect(approved.issues[0]!.accepted).toBe(true);
    expect(warningCodes(approved)).toEqual(["ADJACENT_BUILDING_CONFLICT"]);
  });

  it("does not apply to interior shots or unknown sides", () => {
    expect(
      run(midBlock(), "remove the neighbouring houses", { projectType: "interior", cameraId: null })
        .verdict,
    ).toBe("ALLOW");
    const unknown = townhouse();
    unknown.context.left.adjacentBuildings = [];
    unknown.context.right.adjacentBuildings = [];
    expect(run(unknown, "show the side facade").verdict).toBe("ALLOW");
  });
});

describe("UNVERIFIED_GEOMETRY", () => {
  it.each([
    "make the facade exactly 5 m wide",
    "mặt tiền rộng 4,5m",
    "lot 5 x 20",
    "use the exact dimensions from the drawing",
    "đúng kích thước bản vẽ",
    "kich thuoc chinh xac",
  ])("warns on %j", (text) => {
    const result = run(midBlock(), text);
    expect(result.verdict).toBe("WARN");
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "UNVERIFIED_GEOMETRY",
        severity: "WARN",
        exceptionAllowed: true,
        path: "extraPrompt",
      }),
    ]);
  });

  it("can be accepted as an exception", () => {
    const result = run(midBlock(), "exactly 5 m wide", exterior(), ["UNVERIFIED_GEOMETRY"]);
    expect(result.verdict).toBe("ALLOW");
    expect(warningCodes(result)).toEqual(["UNVERIFIED_GEOMETRY"]);
  });

  it("is silent when the target space has a confirmed dimension fact", () => {
    const dna = midBlock();
    dna.spaceCatalog = {
      version: 1,
      buildingArchetype: "townhouse",
      activeSpaceId: "SPC_1",
      spaces: [
        {
          id: "SPC_1",
          presetId: "townhouse.living",
          facts: {
            widthM: { value: 5, evidence: { status: "verified", sourceAssetIds: ["AST_plan"] } },
          },
          lockedElementIds: [],
          approvedOptionalIds: [],
        },
      ],
    };
    expect(run(dna, "exactly 5 m wide").verdict).toBe("ALLOW");
    dna.spaceCatalog.spaces[0]!.facts.widthM!.evidence.status = "inferred";
    expect(run(dna, "exactly 5 m wide").verdict).toBe("WARN");
  });
});

describe("LOCKED_LIGHTING_CONFLICT", () => {
  const lockedDay = () => {
    const dna = midBlock(); // lighting: morning, presetId "daylight"
    dna.locks.lighting = true;
    return dna;
  };

  it.each([
    "night scene with glowing windows",
    "at dusk",
    "blue hour",
    "cảnh ban đêm",
    "canh ban dem",
    "lúc hoàng hôn",
    "hoang hon",
    "trời tối, lên đèn",
    "đêm",
  ])("blocks %j against a locked daytime lighting", (text) => {
    const result = run(lockedDay(), text, exterior(), ["LOCKED_LIGHTING_CONFLICT"]);
    expect(result.verdict).toBe("BLOCK");
    expect(result.issues[0]).toMatchObject({
      code: "LOCKED_LIGHTING_CONFLICT",
      exceptionAllowed: false,
      params: { locked: "morning" },
    });
  });

  it("allows night requests when lighting is unlocked or not daytime", () => {
    expect(run(midBlock(), "night scene").verdict).toBe("ALLOW");
    const night = lockedDay();
    night.lighting!.timeOfDay = "night";
    expect(run(night, "night scene").verdict).toBe("ALLOW");
  });

  it("falls back to a daytime preset id when the time of day is not set", () => {
    const dna = lockedDay();
    delete dna.lighting!.timeOfDay;
    expect(run(dna, "dusk").issues[0]!.params.locked).toBe("daylight");
  });

  it("reads the interior time of day for interior shots", () => {
    const dna = lockedDay();
    dna.interior = { timeOfDay: "midday" } as ProjectDNA["interior"];
    const shot = { projectType: "interior" as const, cameraId: null };
    expect(run(dna, "buổi tối ấm cúng", shot).verdict).toBe("BLOCK");
    expect(run(dna, "phong cách tối giản", shot).verdict).toBe("ALLOW");
  });

  it("does not trip on harmless words", () => {
    for (const text of ["tôi muốn mặt tiền sáng hơn", "ánh nắng chiếu tới sân", "đem cây vào nhà"])
      expect(run(lockedDay(), text).verdict, text).toBe("ALLOW");
  });
});

describe("P1 hooks and determinism", () => {
  it("SPACE_NOT_IN_BUILDING and OCCLUDED_TARGET return nothing until P1", () => {
    const dna = midBlock();
    dna.spaceCatalog = {
      version: 1,
      buildingArchetype: "townhouse",
      spaces: [
        {
          id: "SPC_pool",
          presetId: "villa.pool",
          facts: {},
          lockedElementIds: [],
          approvedOptionalIds: [],
        },
      ],
      activeSpaceId: "SPC_pool",
    };
    const result = validateShot({
      dna,
      shotIntent: { ...exterior(), targetSpaceId: "SPC_pool", targetDetailId: "DTL_missing" },
    });
    expect(result.issues).toEqual([]);
  });

  it("orders BLOCK before WARN and is byte-stable", () => {
    const dna = midBlock();
    dna.locks.lighting = true;
    const text = "exactly 5 m wide, night scene, remove the neighbouring houses";
    const a = run(dna, text);
    expect(a.issues.map((i) => `${i.severity}:${i.code}`)).toEqual([
      "BLOCK:ADJACENT_BUILDING_CONFLICT",
      "BLOCK:LOCKED_LIGHTING_CONFLICT",
      "WARN:UNVERIFIED_GEOMETRY",
    ]);
    expect(JSON.stringify(run(dna, text))).toBe(JSON.stringify(a));
  });
});
