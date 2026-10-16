import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ProjectDNASchema,
  VISUAL_INTENT_VIEWS,
  availableIntents,
  resolveVisualIntent,
  type ProjectDNA,
} from "../src";

const fixture = ProjectDNASchema.parse(
  JSON.parse(
    readFileSync(
      new URL("../../../apps/desktop/tests/fixtures/nhapho-dna.json", import.meta.url),
      "utf8",
    ),
  ),
);

const attachedSite = (dna: ProjectDNA): ProjectDNA => ({
  ...dna,
  site: {
    version: 1,
    coordinateConvention: "viewer_facing_front_facade",
    front: { kind: "street", evidence: { status: "verified", sourceAssetIds: ["SITE"] } },
    left: {
      kind: "attached_building",
      evidence: { status: "verified", sourceAssetIds: ["SITE"] },
    },
    right: {
      kind: "attached_building",
      evidence: { status: "verified", sourceAssetIds: ["SITE"] },
    },
    rear: { kind: "unknown", evidence: { status: "unknown", sourceAssetIds: [] } },
  },
});

describe("visual camera intent", () => {
  it("does not offer aerial intent for a bedroom", () => {
    const views = availableIntents({ ...fixture, interior: fixture.interior }, "interior");
    expect(views).not.toContain("aerial");
    expect(VISUAL_INTENT_VIEWS).toContain("aerial");
  });

  it("keeps an attached townhouse oblique without promising two exposed facades", () => {
    const dna = attachedSite(fixture);
    const views = availableIntents(dna, "exterior");
    expect(views).toContain("street_oblique");
    const suggestion = resolveVisualIntent({ view: "street_oblique", purpose: "landscape" }, dna);
    expect(suggestion.composition).not.toContain("two exposed façades");
    expect(suggestion.azimuthDeg).toBeUndefined();
    expect(suggestion.distanceM).toBeUndefined();
    expect(suggestion.heightM).toBeUndefined();
  });

  it("maps purpose and focus to suggestions without mutating camera measurements", () => {
    const suggestion = resolveVisualIntent(
      { view: "detail", purpose: "portrait", focus: 90, distance: 80, height: 20 },
      fixture,
    );
    expect(suggestion).toMatchObject({
      viewType: "detail",
      presetId: "visual_intent_detail",
      aspectRatio: "4:5",
      lensMm: 85,
    });
    expect(suggestion.azimuthDeg).toBeUndefined();
    expect(suggestion.distanceM).toBeUndefined();
    expect(suggestion.heightM).toBeUndefined();
  });
});
