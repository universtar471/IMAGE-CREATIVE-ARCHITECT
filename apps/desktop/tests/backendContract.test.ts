/**
 * Cross-language contract check. The fixtures are produced by the real Rust services
 * (`src-tauri/src/contract_fixtures.rs`); every one must parse with the Zod schema the
 * bridge uses for that command. A Rust DTO that drifts from `packages/domain` fails here.
 */
import { describe, expect, it } from "vitest";
import { AppErrorSchema } from "@arch/domain";
import { responses, type CommandName } from "../src/lib/bridge";
import { MOCK_PROVIDERS } from "../src/lib/mockBackend";

type Fixture = { command: string; response: unknown };
const modules = import.meta.glob<Fixture>("./fixtures/backend/*.json", {
  eager: true,
  import: "default",
});
const fixtures = Object.entries(modules).map(([path, f]) => ({
  file: path.split("/").pop()!,
  ...f,
}));

describe("backend contract fixtures", () => {
  it("cover every Phase 2, Phase 3 (§10), publishing (§22) and M2 (ADR-040) command", () => {
    const commands = new Set(fixtures.map((f) => f.command));
    for (const c of [
      "provider_list",
      "provider_set_api_key",
      "provider_clear_api_key",
      "provider_test",
      "prompt_enhance",
      "generation_submit",
      "generation_list",
      "generation_get",
      "version_list",
      "project_get",
      "batch_create",
      "batch_list",
      "job_list",
      "job_cancel",
      "job_retry",
      "camera_anchor_list",
      "camera_anchor_set",
      "camera_anchor_clear",
      "publication_list",
      "publication_get",
      "publication_save",
      "publication_delete",
      "publication_caption_draft",
      "publication_export_save",
      "user_preset_list",
      "user_preset_save",
      "user_preset_delete",
      "sketchup_inbox_list",
      "sketchup_inbox_import",
      "canvas_layout_get",
      "canvas_layout_save",
      "error",
    ]) {
      expect(commands, c).toContain(c);
    }
  });

  it.each(fixtures.map((f) => [f.file, f] as const))("%s parses with the bridge schema", (_, f) => {
    const schema = f.command === "error" ? AppErrorSchema : responses[f.command as CommandName];
    expect(schema, `no schema for ${f.command}`).toBeDefined();
    const result = schema.safeParse(f.response);
    expect(result.success, JSON.stringify(result.error?.issues, null, 2)).toBe(true);
  });

  it("never carries an API key", () => {
    for (const f of fixtures) expect(JSON.stringify(f.response)).not.toContain("fixture-key");
  });

  it("mock providers mirror the builtin Rust providers and models", () => {
    const list = fixtures.find((f) => f.file === "provider_list.json")!.response as {
      id: string;
      configured: boolean;
      keySource: string | null;
      outputKind?: string;
    }[];
    // The fixture registry lists the image builtins in order, one video provider (Kling) and a
    // test double; each listed builtin must match its mock exactly.
    const builtin = list
      .filter((p) => p.id !== "test_remote")
      .map(({ configured: _c, keySource: _k, ...rest }) => rest);
    const mocks = builtin.map((p) => MOCK_PROVIDERS.find((m) => m.id === p.id));
    expect(builtin).toEqual(mocks);
    const imageMocks = MOCK_PROVIDERS.filter((m) => m.outputKind === "image").map((m) => m.id);
    expect(builtin.filter((p) => p.outputKind === "image").map((p) => p.id)).toEqual(imageMocks);
  });
});
