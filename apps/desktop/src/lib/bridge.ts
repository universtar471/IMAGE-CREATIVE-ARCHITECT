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
  BatchDTOSchema,
  CameraAnchorDTOSchema,
  ColorGradeDNASchema,
  GENERATION_UPDATED_EVENT,
  GenerationDTOSchema,
  JOB_UPDATED_EVENT,
  JobDTOSchema,
  ProjectBundleDTOSchema,
  ProjectDNASchema,
  ProjectDTOSchema,
  ProjectSummaryDTOSchema,
  ProviderDescriptorDTOSchema,
  ProviderTestResultSchema,
  PromptEnhanceResultSchema,
  WorkflowConfirmStepRequestSchema,
  WorkflowDTOSchema,
  WorkflowGetRequestSchema,
  WorkflowReopenStepRequestSchema,
  WorkflowStepStateSchema,
  type WorkflowDTO,
  type WorkflowStepState,
  type AppError,
  type AssetRole,
  type AssetSource,
  type BatchCreateRequest,
  type GenerationDTO,
  type GenerationSubmitRequest,
  type JobDTO,
  type PromptEnhanceRequest,
  type ProjectDNA,
  type ProjectType,
} from "@arch/domain";
import { t as tr } from "../i18n";

export {
  WorkflowConfirmStepRequestSchema,
  WorkflowDTOSchema,
  WorkflowGetRequestSchema,
  WorkflowReopenStepRequestSchema,
  WorkflowStepStateSchema,
};
export type { WorkflowDTO, WorkflowStepState };

export const VersionDTOSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  assetId: z.string(),
  parentVersionId: z.string().nullable(),
  label: z.string().nullable(),
  operation: z.string(),
  /** Set for versions created by a generation (ADR-015); null for imports. */
  generationId: z.string().nullable(),
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

/** Request schema for the non-destructive grade command (API §12.4). */
export const GradeApplyRequestSchema = z.object({
  projectId: z.string().min(1),
  assetId: z.string().min(1),
  grade: ColorGradeDNASchema,
  label: z.string().optional(),
});

export const AssetPreviewRequestSchema = z.object({
  projectId: z.string().min(1),
  assetId: z.string().min(1),
  maxEdge: z.number().int().min(256).max(4096),
});
export type AssetPreviewRequest = z.infer<typeof AssetPreviewRequestSchema>;

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
  provider_list: Record<string, never>;
  /** The key goes straight to the OS credential store; it is never returned or stored in JS. */
  provider_set_api_key: { providerId: string; apiKey: string };
  provider_clear_api_key: { providerId: string };
  provider_test: { providerId: string };
  prompt_enhance: PromptEnhanceRequest;
  generation_submit: GenerationSubmitRequest;
  generation_list: { projectId: string };
  generation_get: { projectId: string; generationId: string };
  batch_create: BatchCreateRequest;
  batch_list: { projectId: string };
  /** null = every project. */
  job_list: { projectId: string | null };
  job_cancel: { jobId: string };
  job_retry: { jobId: string };
  camera_anchor_list: { projectId: string };
  camera_anchor_set: { projectId: string; cameraId: string; assetId: string };
  camera_anchor_clear: { projectId: string; cameraId: string };
  grade_apply: z.infer<typeof GradeApplyRequestSchema>;
  asset_preview: AssetPreviewRequest;
  workflow_get: z.infer<typeof WorkflowGetRequestSchema>;
  workflow_confirm_step: z.infer<typeof WorkflowConfirmStepRequestSchema>;
  workflow_reopen_step: z.infer<typeof WorkflowReopenStepRequestSchema>;
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
  provider_list: z.array(ProviderDescriptorDTOSchema),
  provider_set_api_key: ProviderDescriptorDTOSchema,
  provider_clear_api_key: ProviderDescriptorDTOSchema,
  provider_test: ProviderTestResultSchema,
  prompt_enhance: PromptEnhanceResultSchema,
  generation_submit: GenerationDTOSchema,
  generation_list: z.array(GenerationDTOSchema),
  generation_get: GenerationDTOSchema,
  batch_create: BatchDTOSchema,
  batch_list: z.array(BatchDTOSchema),
  job_list: z.array(JobDTOSchema),
  job_cancel: JobDTOSchema,
  job_retry: JobDTOSchema,
  camera_anchor_list: z.array(CameraAnchorDTOSchema),
  camera_anchor_set: z.array(CameraAnchorDTOSchema),
  camera_anchor_clear: z.array(CameraAnchorDTOSchema),
  grade_apply: AssetDTOSchema,
  // Binary PNG response; consumed by assetPreview instead of the JSON call parser.
  asset_preview: z.unknown(),
  workflow_get: WorkflowDTOSchema,
  workflow_confirm_step: WorkflowDTOSchema,
  workflow_reopen_step: WorkflowDTOSchema,
} satisfies Record<keyof Requests, z.ZodType>;

export type CommandName = keyof Requests;
export type CommandResponse<C extends CommandName> = z.infer<(typeof responses)[C]>;

/** Backend → UI events (ADR-017) and their payloads. */
export type BackendEvents = {
  [JOB_UPDATED_EVENT]: JobDTO;
  [GENERATION_UPDATED_EVENT]: GenerationDTO;
};
export type BackendEventName = keyof BackendEvents;
const eventSchemas = {
  [JOB_UPDATED_EVENT]: JobDTOSchema,
  [GENERATION_UPDATED_EVENT]: GenerationDTOSchema,
} satisfies Record<BackendEventName, z.ZodType>;
export const BACKEND_EVENTS = Object.keys(eventSchemas) as BackendEventName[];

/** Receives raw events from an event source (Tauri `listen` or the mock's emitter). */
export type EventSink = (event: BackendEventName, payload: unknown) => void;

/**
 * Transport receives the command and `{ request }` exactly as Tauri commands expect.
 * An in-process transport (the mock) may also offer `connectEvents`, which delivers its
 * events to a sink until the returned function is called.
 */
export type Transport = ((command: CommandName, args: { request: unknown }) => Promise<unknown>) & {
  connectEvents?: (sink: EventSink) => () => void;
};

let transport: Transport | null = null;

/** Replace the transport (tests, browser preview). Events are re-bound to the new one. */
export function setTransport(t: Transport | null) {
  disconnectEvents();
  transport = t;
  if (handlerCount() > 0) void connectEvents();
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

// ---------------------------------------------------------------- events

type Handler<E extends BackendEventName> = (payload: BackendEvents[E]) => void;
const handlers = new Map<BackendEventName, Set<Handler<BackendEventName>>>();
let disconnect: (() => void) | null = null;
let connecting: Promise<void> | null = null;
/** Bumped by every disconnect, so a connection that opens afterwards closes itself. */
let connectionEpoch = 0;

const handlerCount = () => [...handlers.values()].reduce((n, set) => n + set.size, 0);

/** Parse and fan out one raw event; malformed payloads are dropped (and logged). */
const dispatch: EventSink = (event, payload) => {
  const parsed = eventSchemas[event]?.safeParse(payload);
  if (!parsed?.success) {
    console.warn(`[bridge] dropped malformed ${event} event`, parsed?.error.issues.slice(0, 3));
    return;
  }
  for (const h of [...(handlers.get(event) ?? [])]) {
    try {
      h(parsed.data);
    } catch (err) {
      console.error(`[bridge] ${event} handler failed`, err);
    }
  }
};

function disconnectEvents() {
  connectionEpoch++;
  disconnect?.();
  disconnect = null;
  connecting = null;
}

async function connectEvents(): Promise<void> {
  if (disconnect || connecting) return connecting ?? undefined;
  const epoch = connectionEpoch;
  const pending = (async () => {
    const t = await getTransport();
    let off: () => void;
    if (t.connectEvents) {
      off = t.connectEvents(dispatch);
    } else if (isTauri()) {
      const { listen } = await import("@tauri-apps/api/event");
      const offs = await Promise.all(
        BACKEND_EVENTS.map((e) => listen(e, (msg) => dispatch(e, msg.payload))),
      );
      off = () => offs.forEach((f) => f());
    } else {
      off = () => {};
    }
    // The transport was replaced, or every subscriber left, while connecting.
    if (transport !== t || epoch !== connectionEpoch || handlerCount() === 0) {
      off();
      return;
    }
    disconnect = off;
  })().finally(() => {
    if (connecting === pending) connecting = null;
  });
  connecting = pending;
  return pending;
}

/**
 * Subscribe to a backend event (Tauri `listen` in the app, the mock's emitter in the
 * browser preview and tests). Payloads are parsed with the domain schemas. Returns an
 * unsubscribe function. The connection is shared and opened on first use.
 */
export function subscribe<E extends BackendEventName>(event: E, handler: Handler<E>): () => void {
  let set = handlers.get(event);
  if (!set) handlers.set(event, (set = new Set()));
  set.add(handler as Handler<BackendEventName>);
  void connectEvents();
  return () => {
    // Only the first call counts (a repeated unsubscribe must not close others' connection).
    if (!set.delete(handler as Handler<BackendEventName>)) return;
    if (handlerCount() === 0) disconnectEvents(); // also cancels a pending connect
  };
}

/** Resolves once the event source is connected (tests; harmless in the app). */
export async function eventsReady(): Promise<void> {
  await connectEvents();
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
    typeof raw === "string" ? raw : raw instanceof Error ? raw.message : tr("errors.unexpected");
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
      message: tr("errors.badResponse", { command }),
      details: parsed.error.issues.slice(0, 5),
    });
  }
  return parsed.data as CommandResponse<C>;
}

/** Fetch a tainted-canvas-safe PNG preview and expose it as a browser Blob. */
export async function assetPreview(request: AssetPreviewRequest): Promise<Blob> {
  const t = await getTransport();
  let raw: unknown;
  try {
    raw = await t("asset_preview", { request });
  } catch (err) {
    throw toBridgeError(err);
  }
  if (raw instanceof Blob) return new Blob([raw], { type: "image/png" });
  if (raw instanceof ArrayBuffer) return new Blob([raw], { type: "image/png" });
  if (ArrayBuffer.isView(raw)) {
    const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return new Blob([copy.buffer], { type: "image/png" });
  }
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 255) {
        throw new BridgeError({
          code: "IO_ERROR",
          message: "The asset preview response was not binary data.",
        });
      }
    }
    return new Blob([new Uint8Array(raw).buffer], { type: "image/png" });
  }
  throw new BridgeError({
    code: "IO_ERROR",
    message: "The asset preview response was not binary data.",
  });
}

/** Field errors attached to a VALIDATION_ERROR (keys are dotted DNA paths). */
export function fieldErrorsOf(err: unknown): Record<string, string> {
  if (!(err instanceof BridgeError) || err.code !== "VALIDATION_ERROR") return {};
  const details = err.details as { fieldErrors?: Record<string, string> } | undefined;
  return details?.fieldErrors ?? {};
}

/**
 * When `err` is PROVIDER_NOT_CONFIGURED, the provider that needs a key (from the error
 * details, else `fallbackProviderId`); otherwise null. The UI turns this into a
 * "Set API key" action instead of a bare error.
 */
export function providerNeedingKey(err: unknown, fallbackProviderId: string): string | null {
  if (!(err instanceof BridgeError) || err.code !== "PROVIDER_NOT_CONFIGURED") return null;
  const details = err.details as { providerId?: unknown } | undefined;
  return typeof details?.providerId === "string" ? details.providerId : fallbackProviderId;
}
