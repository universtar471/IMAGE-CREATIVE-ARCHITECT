import { describe, expect, it } from "vitest";
import { createMockTransport } from "../src/lib/mockBackend";

describe("LUT mock index", () => {
  type LutListResult = { items: Array<{ id: string; name: string }>; total: number };

  it("paginates filtered results with a total before slicing", async () => {
    const transport = createMockTransport({ projects: {}, dna: {}, assets: {}, versions: [] });
    const call = (command: string, request: object) =>
      transport(command as Parameters<typeof transport>[0], { request });
    await call("lut_source_add", { path: "mock/luts" });
    const first = (await call("lut_list", { limit: 2, offset: 0 })) as LutListResult;
    const second = (await call("lut_list", { limit: 2, offset: 2 })) as LutListResult;
    expect(first.total).toBe(4);
    expect(second.total).toBe(4);
    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(2);
    expect(first.items[0]?.id).not.toBe(second.items[0]?.id);
  });

  it("excludes irrelevant categories with archOnly", async () => {
    const transport = createMockTransport({ projects: {}, dna: {}, assets: {}, versions: [] });
    const call = (command: string, request: object) =>
      transport(command as Parameters<typeof transport>[0], { request });
    await call("lut_source_add", { path: "mock/luts" });
    const result = (await call("lut_list", {
      archOnly: true,
      limit: 10,
      offset: 0,
    })) as LutListResult;
    expect(result.items.map((item) => item.name)).toEqual(["Natural Earthy", "Urban Film"]);
    expect(result.total).toBe(2);
  });
});
