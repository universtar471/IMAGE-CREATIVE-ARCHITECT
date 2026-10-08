/**
 * Typed desktop bridge. The only module that talks to Tauri `invoke`.
 * Every response is parsed with the domain Zod schemas; every failure becomes a BridgeError.
 * Outside Tauri (plain `vite` dev in a browser) an in-memory mock backend is used.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";
import {
  AppErrorSchema,
  AssetDTOSchema,
  ProjectBundleDTOSchema,
  ProjectDNASchema,
  ProjectDTOSchema,
  ProjectSummaryDTOSchema,
  type AppError,
  type AssetRole,
  type AssetSource,
  type ProjectDNA,
  type ProjectType,
} from "@arch/domain";

export const VersionDTOSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  assetId: z.string(),
  parentVersionId: z.string().nullable(),
  label: z.string().nullable(),
  operation: z.string(),
  createdAt: z.string(),
});
export type VersionDTO = z.infer<typeof VersionDTOSchema>;

export const AssetRemoveResultSchema = z.object({
  assetId: z.string(),
  fileCleanupWarning: z.string().nullable(),
});

export const AppInfoSchema = z.object({
  dataRoot: z.string(),
  schemaVersion: z.number(),
  appVersion: z.string(),
});

/** Request payloads per command (see docs/API_CONTRACTS.md). */
export type Requests = {
  app_info: Record<string, never>;
  project_create: {
    name: string;
    projectType: ProjectType;
    subtype?: string | null;
    dna: ProjectDNA;
  };
  project_list: { includeArchived?: boolean };
  project_get: { projectId: string };
  project_update_metadata: { projectId: string; name?: string; subtype?: string };
  project_set_archived: { projectId: string; archived: boolean };
  project_approve_master: { projectId: string; approved: boolean };
  dna_get: { projectId: string };
  dna_update: { projectId: string; dna: ProjectDNA };
  asset_import: {
    projectId: string;
    sourcePath: string;
    source: AssetSource;
    role: AssetRole;
    allowDuplicate?: boolean;
  };
  asset_list: { projectId: string };
  asset_update_role: { projectId: string; assetId: string; role: AssetRole };
  asset_set_master: { projectId: string; assetId: string | null };
  asset_remove: { projectId: string; assetId: string };
  version_list: { projectId: string };
};

/** Response schemas per command. */
export const responses = {
  app_info: AppInfoSchema,
  project_create: ProjectDTOSchema,
  project_list: z.array(ProjectSummaryDTOSchema),
  project_get: ProjectBundleDTOSchema,
  project_update_metadata: ProjectDTOSchema,
  project_set_archived: ProjectDTOSchema,
  project_approve_master: ProjectDTOSchema,
  dna_get: ProjectDNASchema,
  dna_update: ProjectDTOSchema,
  asset_import: AssetDTOSchema,
  asset_list: z.array(AssetDTOSchema),
  asset_update_role: z.array(AssetDTOSchema),
  asset_set_master: z.array(AssetDTOSchema),
  asset_remove: AssetRemoveResultSchema,
  version_list: z.array(VersionDTOSchema),
} satisfies Record<keyof Requests, z.ZodType>;

export type CommandName = keyof Requests;
export type CommandResponse<C extends CommandName> = z.infer<(typeof responses)[C]>;

/** Transport receives the command and `{ request }` exactly as Tauri commands expect. */
export type Transport = (command: CommandName, args: { request: unknown }) => Promise<unknown>;

let transport: Transport | null = null;

/** Replace the transport (tests, browser preview). */
export function setTransport(t: Transport | null) {
  transport = t;
}

export const runningInTauri = () => isTauri();

async function getTransport(): Promise<Transport> {
  if (transport) return transport;
  if (isTauri()) {
    transport = (command, args) => invoke(command, args);
  } else {
    const { createMockTransport } = await import("./mockBackend");
    transport = createMockTransport();
  }
  return transport;
}

export class BridgeError extends Error implements AppError {
  readonly code: AppError["code"];
  readonly details?: unknown;
  constructor(err: AppError) {
    super(err.message);
    this.name = "BridgeError";
    this.code = err.code;
    this.details = err.details;
  }
}

/** Normalize anything thrown by the transport into a typed BridgeError. */
export function toBridgeError(raw: unknown): BridgeError {
  if (raw instanceof BridgeError) return raw;
  const parsed = AppErrorSchema.safeParse(raw);
  if (parsed.success) return new BridgeError(parsed.data);
  const message =
    typeof raw === "string" ? raw : raw instanceof Error ? raw.message : "Unexpected error.";
  return new BridgeError({ code: "IO_ERROR", message });
}

export async function call<C extends CommandName>(
  command: C,
  request: Requests[C],
): Promise<CommandResponse<C>> {
  const t = await getTransport();
  let raw: unknown;
  try {
    raw = await t(command, { request });
  } catch (err) {
    throw toBridgeError(err);
  }
  const parsed = responses[command].safeParse(raw);
  if (!parsed.success) {
    throw new BridgeError({
      code: "VALIDATION_ERROR",
      message: `The backend returned an unexpected response for ${command}.`,
      details: parsed.error.issues.slice(0, 5),
    });
  }
  return parsed.data as CommandResponse<C>;
}

/** Field errors attached to a VALIDATION_ERROR (keys are dotted DNA paths). */
export function fieldErrorsOf(err: unknown): Record<string, string> {
  if (!(err instanceof BridgeError) || err.code !== "VALIDATION_ERROR") return {};
  const details = err.details as { fieldErrors?: Record<string, string> } | undefined;
  return details?.fieldErrors ?? {};
}
