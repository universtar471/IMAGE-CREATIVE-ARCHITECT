/**
 * In-memory backend for running the UI in a plain browser (`npm run dev` without Tauri)
 * and for UI tests. It mirrors the Rust services' rules closely enough to exercise the
 * UI, but it is NOT the source of truth — the Rust backend and its tests are.
 * Data persists to localStorage so reloads behave like reopening the app.
 *
 * Phase 2: two mock providers mirror the Rust registry (`gemini`, `local_preview`).
 * API keys are never stored here — only a "configured" boolean per provider.
 * Generated outputs are cheap SVG placeholders. A positive prompt containing `[fail]`
 * produces a `failed` generation so the error UI can be exercised.
 */
import {
  generationParentAssetId,
  isDnaReady,
  ProjectDNASchema,
  validateGenerationRequest,
  validateProjectDNA,
  type AppError,
  type AssetDTO,
  type AssetRole,
  type GenerationDTO,
  type GenerationSubmitRequest,
  type ProjectDNA,
  type ProjectDTO,
  type ProjectStatus,
  type ProviderDescriptorDTO,
} from "@arch/domain";
import type { CommandName, Requests, Transport, VersionDTO } from "./bridge";

type Db = {
  projects: Record<string, ProjectDTO & { masterApprovedAt: string | null }>;
  dna: Record<string, ProjectDNA>;
  assets: Record<string, AssetDTO>;
  versions: VersionDTO[];
  /** Phase 2 (optional so Phase 1 snapshots and test fixtures still load). */
  generations?: GenerationDTO[];
  /** providerId → a key has been "set". Never the key itself. */
  providerKeys?: Record<string, boolean>;
};

export type MockOptions = {
  /** Simulated provider latency for `generation_submit` (ms). */
  generationDelayMs?: number;
};

type MockProvider = Omit<ProviderDescriptorDTO, "configured" | "keySource">;

/** Mirrors `ProviderRegistry::builtin()` in src-tauri/src/providers. */
export const MOCK_PROVIDERS: readonly MockProvider[] = [
  {
    id: "gemini",
    label: "Google Gemini",
    kind: "remote",
    requiresApiKey: true,
    models: [
      {
        id: "gemini-2.5-flash-image",
        label: "Gemini 2.5 Flash Image",
        textToImage: true,
        imageToImage: true,
        maxReferenceImages: 3,
        maxOutputs: 1,
        aspectRatios: [],
        imageSizes: [],
        supportsNegativePrompt: false,
        supportsSeed: false,
      },
    ],
  },
  {
    id: "local_preview",
    label: "Local preview (offline)",
    kind: "local",
    requiresApiKey: false,
    models: [
      {
        id: "placeholder-v1",
        label: "Placeholder renderer",
        textToImage: true,
        imageToImage: true,
        maxReferenceImages: 14,
        maxOutputs: 4,
        aspectRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"],
        imageSizes: ["1K"],
        supportsNegativePrompt: true,
        supportsSeed: true,
      },
    ],
  },
];

const STORAGE_KEY = "arch-studio-mock-db-v1";
const browserFiles = new Map<string, File>();

/** Register a browser File and return a fake "path" the mock import understands. */
export function registerBrowserFile(file: File): string {
  const handle = `browser-file://${crypto.randomUUID()}/${file.name}`;
  browserFiles.set(handle, file);
  return handle;
}

const fail = (code: AppError["code"], message: string, details?: unknown): never => {
  throw { code, message, details } satisfies AppError;
};

const ULID_CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function newId(prefix: string): string {
  let s = Date.now().toString(32).toUpperCase().padStart(10, "0").slice(-10);
  for (let i = 0; i < 16; i++) s += ULID_CHARS[Math.floor(Math.random() * 32)];
  return `${prefix}_${s.replace(/[ILOU]/g, "X")}`;
}

function load(): Db {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const db = JSON.parse(raw) as Db;
      // Like the Rust startup sweep (ADR-014): a reload mid-generation leaves it interrupted.
      for (const g of db.generations ?? []) {
        if (g.status === "running") {
          g.status = "interrupted";
          g.error = {
            kind: "interrupted",
            message: "The app was closed while this generation was running.",
            retryable: true,
          };
        }
      }
      return db;
    }
  } catch {
    /* fall through to empty db */
  }
  return { projects: {}, dna: {}, assets: {}, versions: [] };
}

export function createMockTransport(initial?: Db, options: MockOptions = {}): Transport {
  const db: Db = initial ?? load();
  const generations = (db.generations ??= []);
  const providerKeys = (db.providerKeys ??= {});
  for (const v of db.versions) v.generationId ??= null;
  const generationDelayMs = options.generationDelayMs ?? 1500;

  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch {
      /* quota exceeded: keep in memory */
    }
  };
  const now = () => new Date().toISOString();

  const getProject = (id: string) =>
    db.projects[id] ?? fail("NOT_FOUND", `Project '${id}' was not found.`);
  const writable = (id: string) => {
    const p = getProject(id);
    if (p.archivedAt)
      fail("INVALID_STATE", `'${p.name}' is archived and read-only. Restore it first.`);
    return p;
  };
  const publicProject = (p: Db["projects"][string]): ProjectDTO => {
    const { masterApprovedAt, ...dto } = p;
    return dto;
  };
  const refreshStatus = (id: string) => {
    const p = getProject(id);
    const dna = db.dna[id]!;
    let status: ProjectStatus = "draft";
    if (p.archivedAt) status = "archived";
    else if (p.activeMasterAssetId && p.masterApprovedAt) status = "master_approved";
    else if (p.activeMasterAssetId) status = "master_pending";
    else if (isDnaReady(dna, p.projectType)) status = "dna_ready";
    p.status = status;
    p.updatedAt = now();
  };
  const projectAssets = (id: string) =>
    Object.values(db.assets)
      .filter((a) => a.projectId === id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const applyMaster = (projectId: string, assetId: string | null) => {
    const p = getProject(projectId);
    if (assetId && db.assets[assetId]?.projectId !== projectId) {
      fail("VALIDATION_ERROR", "That asset belongs to a different project.");
    }
    if (p.activeMasterAssetId !== assetId) {
      for (const a of projectAssets(projectId)) {
        if (a.role === "master_architecture") a.role = "architecture_reference";
      }
      p.masterApprovedAt = null;
    }
    if (assetId) db.assets[assetId]!.role = "master_architecture";
    p.activeMasterAssetId = assetId;
    refreshStatus(projectId);
  };

  const getProvider = (id: string): MockProvider =>
    MOCK_PROVIDERS.find((p) => p.id === id) ?? fail("NOT_FOUND", `Unknown provider '${id}'.`);

  const describeProvider = (p: MockProvider): ProviderDescriptorDTO => {
    const hasKey = !!providerKeys[p.id];
    return {
      ...p,
      configured: !p.requiresApiKey || hasKey,
      keySource: p.requiresApiKey && hasKey ? "keychain" : null,
    };
  };

  /** Output IDs still present, like the backend's join on generation_outputs. */
  const publicGeneration = (g: GenerationDTO): GenerationDTO => ({
    ...g,
    outputAssetIds: g.outputAssetIds.filter((id) => db.assets[id]),
  });

  /** ADR-015: outputs are ai_generated regular images, versioned under the parent's latest. */
  const createOutputs = (gen: GenerationDTO, req: GenerationSubmitRequest): string[] => {
    const parent = gen.parentAssetId ? db.assets[gen.parentAssetId] : undefined;
    const parentVersion = parent
      ? db.versions.filter((v) => v.assetId === parent.id).at(-1)
      : undefined;
    const [w, h] = outputSize(req.params.aspectRatio, parent);
    const purpose = req.purpose === "hero" ? "Hero" : "Variation";
    const ids: string[] = [];
    for (let i = 0; i < req.params.outputCount; i++) {
      const id = newId("AST");
      const t = now();
      const url = placeholderSvg(
        w,
        h,
        `${purpose} ${i + 1}`,
        req.modelId,
        (req.params.seed ?? 0) + i,
      );
      db.assets[id] = {
        id,
        projectId: req.projectId,
        source: "ai_generated",
        role: "regular_image",
        status: "ready",
        originalName: `${purpose.toLowerCase()}-${gen.id.slice(-6).toLowerCase()}-${i + 1}.svg`,
        managedRelPath: `assets/generated/${id}.svg`,
        absolutePath: url,
        thumbnailPath: url,
        mimeType: "image/svg+xml",
        fileSizeBytes: url.length,
        widthPx: w,
        heightPx: h,
        sha256: null,
        parentAssetId: gen.parentAssetId,
        operation: "generate",
        createdAt: t,
        updatedAt: t,
      };
      db.versions.push({
        id: newId("VER"),
        projectId: req.projectId,
        assetId: id,
        parentVersionId: parentVersion?.id ?? null,
        label: `${purpose} ${i + 1}/${req.params.outputCount}`,
        operation: "generate",
        generationId: gen.id,
        createdAt: t,
      });
      ids.push(id);
    }
    return ids;
  };

  const handlers: { [C in CommandName]: (req: Requests[C]) => unknown | Promise<unknown> } = {
    app_info: () => ({
      dataRoot: "browser (in-memory preview)",
      schemaVersion: 1,
      appVersion: "dev",
    }),

    project_create: (req) => {
      if (!req.name.trim()) fail("VALIDATION_ERROR", "Project name cannot be empty.");
      const v = validateProjectDNA(req.dna);
      if (!v.ok)
        fail("VALIDATION_ERROR", "The design DNA has invalid values.", {
          fieldErrors: v.fieldErrors,
        });
      const t = now();
      const id = newId("PRJ");
      db.projects[id] = {
        id,
        name: req.name.trim(),
        projectType: req.projectType,
        subtype: req.subtype?.trim() || null,
        status: "draft",
        activeMasterAssetId: null,
        masterApprovedAt: null,
        createdAt: t,
        updatedAt: t,
        archivedAt: null,
      };
      db.dna[id] = ProjectDNASchema.parse(req.dna);
      refreshStatus(id);
      save();
      return publicProject(db.projects[id]!);
    },

    project_list: (req) =>
      Object.values(db.projects)
        .filter((p) => req.includeArchived || !p.archivedAt)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((p) => ({
          ...publicProject(p),
          assetCount: projectAssets(p.id).length,
          thumbnailPath: p.activeMasterAssetId
            ? (db.assets[p.activeMasterAssetId]?.thumbnailPath ?? null)
            : null,
        })),

    project_get: (req) => ({
      project: publicProject(getProject(req.projectId)),
      dna: db.dna[req.projectId],
      assets: projectAssets(req.projectId),
    }),

    project_update_metadata: (req) => {
      const p = writable(req.projectId);
      if (req.name !== undefined) {
        if (!req.name.trim()) fail("VALIDATION_ERROR", "Project name cannot be empty.");
        p.name = req.name.trim();
      }
      if (req.subtype !== undefined) p.subtype = req.subtype.trim() || null;
      p.updatedAt = now();
      save();
      return publicProject(p);
    },

    project_set_archived: (req) => {
      const p = getProject(req.projectId);
      p.archivedAt = req.archived ? (p.archivedAt ?? now()) : null;
      refreshStatus(p.id);
      save();
      return publicProject(p);
    },

    project_approve_master: (req) => {
      const p = writable(req.projectId);
      if (req.approved && !p.activeMasterAssetId) {
        fail("INVALID_STATE", "Choose a master architecture image before approving it.");
      }
      p.masterApprovedAt = req.approved ? now() : null;
      refreshStatus(p.id);
      save();
      return publicProject(p);
    },

    dna_get: (req) => {
      getProject(req.projectId);
      return db.dna[req.projectId];
    },

    dna_update: (req) => {
      const v = validateProjectDNA(req.dna);
      if (!v.ok)
        fail("VALIDATION_ERROR", "The design DNA has invalid values and was not saved.", {
          fieldErrors: v.fieldErrors,
        });
      writable(req.projectId);
      db.dna[req.projectId] = JSON.parse(JSON.stringify(req.dna)) as ProjectDNA;
      refreshStatus(req.projectId);
      save();
      return publicProject(getProject(req.projectId));
    },

    asset_import: async (req) => {
      writable(req.projectId);
      const file =
        browserFiles.get(req.sourcePath) ?? fail("IO_ERROR", "Cannot read the selected file.");
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        fail(
          "UNSUPPORTED_FILE",
          `'${file.name}' is not a supported image. Supported formats: JPEG, PNG and WebP.`,
        );
      }
      const bytes = await file.arrayBuffer();
      const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const existing = projectAssets(req.projectId).find((a) => a.sha256 === sha256);
      if (existing && !req.allowDuplicate) {
        fail(
          "DUPLICATE_ASSET",
          `'${file.name}' is identical to '${existing.originalName}' already in this project.`,
          {
            existingAssetId: existing.id,
            fileName: file.name,
          },
        );
      }
      const url = URL.createObjectURL(file);
      const { width, height, thumb } = await inspectImage(url);
      const id = newId("AST");
      const t = now();
      const ext = file.type.split("/")[1] === "jpeg" ? "jpg" : file.type.split("/")[1];
      db.assets[id] = {
        id,
        projectId: req.projectId,
        source: req.source,
        role: req.role === "master_architecture" ? "regular_image" : req.role,
        status: "ready",
        originalName: file.name,
        managedRelPath: `assets/original/${id}.${ext}`,
        absolutePath: url,
        thumbnailPath: thumb,
        mimeType: file.type,
        fileSizeBytes: file.size,
        widthPx: width,
        heightPx: height,
        sha256,
        parentAssetId: null,
        operation: "import",
        createdAt: t,
        updatedAt: t,
      };
      db.versions.push({
        id: newId("VER"),
        projectId: req.projectId,
        assetId: id,
        parentVersionId: null,
        label: file.name,
        operation: "import",
        generationId: null,
        createdAt: t,
      });
      if (req.role === "master_architecture") applyMaster(req.projectId, id);
      save();
      return db.assets[id];
    },

    asset_list: (req) => {
      getProject(req.projectId);
      return projectAssets(req.projectId);
    },

    asset_update_role: (req) => {
      writable(req.projectId);
      const asset = db.assets[req.assetId];
      if (!asset || asset.projectId !== req.projectId)
        fail("NOT_FOUND", "Asset not found in this project.");
      if (req.role === "master_architecture") applyMaster(req.projectId, req.assetId);
      else {
        if (asset!.role === "master_architecture") applyMaster(req.projectId, null);
        asset!.role = req.role as AssetRole;
      }
      save();
      return projectAssets(req.projectId);
    },

    asset_set_master: (req) => {
      writable(req.projectId);
      applyMaster(req.projectId, req.assetId);
      save();
      return projectAssets(req.projectId);
    },

    asset_remove: (req) => {
      const p = writable(req.projectId);
      const asset = db.assets[req.assetId];
      if (!asset || asset.projectId !== req.projectId)
        fail("NOT_FOUND", "Asset not found in this project.");
      if (p.activeMasterAssetId === req.assetId) applyMaster(req.projectId, null);
      delete db.assets[req.assetId];
      db.versions = db.versions.filter((v) => v.assetId !== req.assetId);
      save();
      return { assetId: req.assetId, fileCleanupWarning: null };
    },

    version_list: (req) => db.versions.filter((v) => v.projectId === req.projectId),

    provider_list: () => MOCK_PROVIDERS.map(describeProvider),

    provider_set_api_key: (req) => {
      const p = getProvider(req.providerId);
      if (!p.requiresApiKey) fail("INVALID_STATE", `${p.label} does not use an API key.`);
      if (!req.apiKey.trim()) fail("VALIDATION_ERROR", "The API key cannot be empty.");
      // Only the fact that a key exists is kept; the string itself is dropped here.
      providerKeys[p.id] = true;
      save();
      return describeProvider(p);
    },

    provider_clear_api_key: (req) => {
      const p = getProvider(req.providerId);
      delete providerKeys[p.id];
      save();
      return describeProvider(p);
    },

    provider_test: (req) => {
      const p = describeProvider(getProvider(req.providerId));
      if (!p.configured) return { ok: false, message: `No API key is set for ${p.label}.` };
      return {
        ok: true,
        message:
          p.kind === "local"
            ? "Offline provider, always available."
            : "Key accepted (browser preview mock — no network call was made).",
      };
    },

    generation_submit: async (req) => {
      writable(req.projectId);
      const provider = getProvider(req.providerId);
      const model =
        provider.models.find((m) => m.id === req.modelId) ??
        fail("NOT_FOUND", `Model '${req.modelId}' is not offered by ${provider.label}.`);
      const assets = projectAssets(req.projectId);
      for (const id of req.referenceAssetIds) {
        const a =
          assets.find((x) => x.id === id) ??
          fail("NOT_FOUND", `Reference asset '${id}' was not found in this project.`);
        if (a.status !== "ready")
          fail("INVALID_STATE", `The file of reference '${a.originalName ?? id}' is missing.`);
      }
      const issues = validateGenerationRequest(req, model);
      if (issues.length) fail("VALIDATION_ERROR", issues[0]!.message, { issues });
      if (provider.requiresApiKey && !providerKeys[provider.id]) {
        fail(
          "PROVIDER_NOT_CONFIGURED",
          `${provider.label} has no API key yet. Add one in provider settings.`,
          { providerId: provider.id },
        );
      }

      const startedMs = Date.now();
      const gen: GenerationDTO = {
        id: newId("GEN"),
        projectId: req.projectId,
        providerId: req.providerId,
        modelId: req.modelId,
        purpose: req.purpose,
        status: "running",
        prompt: req.prompt,
        referenceAssetIds: [...req.referenceAssetIds],
        params: req.params,
        parentAssetId: generationParentAssetId(req.referenceAssetIds, assets),
        outputAssetIds: [],
        error: null,
        startedAt: new Date(startedMs).toISOString(),
        finishedAt: null,
        durationMs: null,
      };
      generations.push(gen);
      save();

      await new Promise((resolve) => setTimeout(resolve, generationDelayMs));

      if (/\[fail\]/i.test(req.prompt.positivePrompt)) {
        gen.status = "failed";
        gen.error = {
          kind: "bad_response",
          message: "The mock provider was told to fail ([fail] found in the prompt).",
          retryable: true,
        };
      } else {
        gen.status = "completed";
        gen.outputAssetIds = createOutputs(gen, req);
      }
      gen.finishedAt = now();
      gen.durationMs = Math.max(0, Date.now() - startedMs);
      save();
      return publicGeneration(gen);
    },

    generation_list: (req) => {
      getProject(req.projectId);
      return generations
        .filter((g) => g.projectId === req.projectId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))
        .map(publicGeneration);
    },

    generation_get: (req) => {
      const g = generations.find((x) => x.id === req.generationId && x.projectId === req.projectId);
      return g ? publicGeneration(g) : fail("NOT_FOUND", "Generation not found in this project.");
    },
  };

  return async (command, args) => {
    const handler = handlers[command] as (req: unknown) => unknown;
    return structuredClone(await handler(args.request));
  };
}

function outputSize(aspectRatio: string | null, parent: AssetDTO | undefined): [number, number] {
  const LONG = 1024;
  let ratio = 4 / 3;
  const m = aspectRatio?.match(/^(\d+):(\d+)$/);
  if (m) ratio = Number(m[1]) / Number(m[2]);
  else if (parent?.widthPx && parent.heightPx) ratio = parent.widthPx / parent.heightPx;
  return ratio >= 1 ? [LONG, Math.round(LONG / ratio)] : [Math.round(LONG * ratio), LONG];
}

/** A tiny, displayable placeholder image (no canvas needed, so it also works under jsdom). */
function placeholderSvg(w: number, h: number, title: string, model: string, seed: number): string {
  const hue = (seed * 47 + 200) % 360;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0" stop-color="hsl(${hue},45%,62%)"/>`,
    `<stop offset="1" stop-color="hsl(${(hue + 40) % 360},35%,22%)"/>`,
    `</linearGradient></defs>`,
    `<rect width="${w}" height="${h}" fill="url(#g)"/>`,
    `<rect x="${w * 0.3}" y="${h * 0.4}" width="${w * 0.4}" height="${h * 0.4}" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.6)" stroke-width="3"/>`,
    `<polygon points="${w * 0.27},${h * 0.42} ${w * 0.5},${h * 0.22} ${w * 0.73},${h * 0.42}" fill="rgba(255,255,255,0.28)"/>`,
    `<rect y="${h * 0.84}" width="${w}" height="${h * 0.16}" fill="rgba(0,0,0,0.35)"/>`,
    `<text x="${w / 2}" y="${h * 0.93}" fill="#fff" font-family="Segoe UI, sans-serif" font-size="${Math.round(h * 0.045)}" text-anchor="middle">${title} · ${model} · mock</text>`,
    `</svg>`,
  ].join("");
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function inspectImage(
  url: string,
): Promise<{ width: number; height: number; thumb: string }> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const scale = Math.min(1, 384 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    thumb: canvas.toDataURL("image/jpeg", 0.8),
  };
}
