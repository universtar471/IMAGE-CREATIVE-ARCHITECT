import { afterEach, describe, expect, it } from "vitest";
import { assetPreview, BridgeError, setTransport, type Transport } from "../src/lib/bridge";

afterEach(() => {
  setTransport(null);
});

describe("assetPreview binary responses", () => {
  it.each([
    ["ArrayBuffer", new Uint8Array([1, 2, 3]).buffer],
    ["typed array view", new Uint8Array([9, 1, 2, 3, 9]).subarray(1, 4)],
    ["number[]", [1, 2, 3]],
  ])("normalizes %s to an image/png Blob", async (_, response) => {
    const transport: Transport = (async () => response) as Transport;
    setTransport(transport);

    const blob = await assetPreview({ projectId: "project", assetId: "asset", maxEdge: 256 });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/png");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it.each([
    ["fractional", [1, 2.5, 3]],
    ["negative", [1, -1, 3]],
    ["too large", [1, 256, 3]],
  ])("rejects %s number[] entries with BridgeError", async (_, response) => {
    const transport: Transport = (async () => response) as Transport;
    setTransport(transport);

    await expect(
      assetPreview({ projectId: "project", assetId: "asset", maxEdge: 256 }),
    ).rejects.toBeInstanceOf(BridgeError);
  });
});
