/**
 * In-memory backend for running the UI in a plain browser (`npm run dev` without Tauri)
 * and for UI tests. It mirrors the Rust services' rules closely enough to exercise the
 * UI, but it is NOT the source of truth — the Rust backend and its tests are.
 * Data persists to localStorage so reloads behave like reopening the app.
 */
import {
  isDnaReady,
  ProjectDNASchema,
  validateProjectDNA,
  type AppError,
  type AssetDTO,
  type AssetRole,
  type ProjectDNA,
  type ProjectDTO,
  type ProjectStatus,
} from "@arch/domain";
import type { CommandName, Requests, Transport, VersionDTO } from "./bridge";

type Db = {
  projects: Record<string, ProjectDTO & { masterApprovedAt: string | null }>;
  dna: Record<string, ProjectDNA>;
  assets: Record<string, AssetDTO>;
  versions: VersionDTO[];
};

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
    if (raw) return JSON.parse(raw) as Db;
  } catch {
    /* fall through to empty db */
  }
  return { projects: {}, dna: {}, assets: {}, versions: [] };
}

export function createMockTransport(initial?: Db): Transport {
  const db: Db = initial ?? load();
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
  };

  return async (command, args) => {
    const handler = handlers[command] as (req: unknown) => unknown;
    return structuredClone(await handler(args.request));
  };
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
