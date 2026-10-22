import { afterEach, expect, it } from "vitest";
import { call, setTransport } from "../src/lib/bridge";

afterEach(() => setTransport(null));

it("accepts the Rust AssistResult with null usage", async () => {
  setTransport((async () => ({
    raw: '{"fields":[]}',
    modelId: "vision",
    usage: null,
    generationId: "g1",
  })) as never);
  await expect(
    call("dna_assist", {
      projectId: "p1",
      mode: "brief",
      scope: "interior",
      brief: "minimalism for family with tone color",
      catalog: { scope: "interior", fields: [] },
      systemPrompt: "JSON",
    }),
  ).resolves.toMatchObject({ generationId: "g1" });
});
