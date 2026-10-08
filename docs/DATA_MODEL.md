# Data Model and Schemas

This document defines the target model. Implement the **Phase 1 subset first**, while keeping migrations extensible.

## 1. Zod as canonical application schema

Recommended TypeScript domain definitions:

```ts
import { z } from "zod";

export const ProjectTypeSchema = z.enum([
  "interior",
  "townhouse",
  "single_storey_house",
  "villa",
  "urban_villa",
  "prefab_modular",
  "cafe",
  "restaurant",
  "hotel",
  "office",
  "commercial",
  "resort",
  "custom",
]);

export const ProjectStatusSchema = z.enum([
  "draft",
  "dna_ready",
  "concepting",
  "master_pending",
  "master_approved",
  "anchor_generation",
  "design_locked",
  "production",
  "qc",
  "final",
  "archived",
]);

export const AssetRoleSchema = z.enum([
  "master_architecture",
  "architecture_reference",
  "material_reference",
  "context_reference",
  "landscape_reference",
  "lighting_reference",
  "mood_reference",
  "camera_reference",
  "regular_image",
]);

export const AssetSourceSchema = z.enum([
  "external",
  "ai_generated",
  "sketchup",
  "vray",
  "corona",
  "d5",
  "enscape",
  "photo",
  "reference",
  "other",
]);
```

## 2. Building DNA

```ts
export const BuildingDNASchema = z.object({
  schemaVersion: z.literal(1),
  buildingType: z.string().min(1),
  subtype: z.string().optional(),
  architecturalStyle: z.string().optional(),

  dimensions: z.object({
    widthM: z.number().positive().optional(),
    depthM: z.number().positive().optional(),
    heightM: z.number().positive().optional(),
    siteWidthM: z.number().positive().optional(),
    siteDepthM: z.number().positive().optional(),
  }).default({}),

  floors: z.number().int().positive().optional(),

  massing: z.object({
    composition: z.string().optional(),
    mainVolume: z.string().optional(),
    secondaryVolume: z.string().optional(),
    voids: z.array(z.string()).default([]),
    cantilever: z.string().optional(),
  }).default({ voids: [] }),

  roof: z.object({
    type: z.string().optional(),
    pitch: z.string().optional(),
    overhang: z.string().optional(),
  }).default({}),

  openings: z.object({
    windowType: z.string().optional(),
    frame: z.string().optional(),
    rhythm: z.string().optional(),
    glazing: z.string().optional(),
  }).default({}),

  materials: z.array(z.object({
    zone: z.string(),
    materialId: z.string().optional(),
    description: z.string(),
  })).default([]),

  colorPalette: z.array(z.string()).default([]),

  specialFeatures: z.array(z.string()).default([]),
  notes: z.string().default(""),
});
```

## 3. Context DNA

```ts
const ContextZoneSchema = z.object({
  spaceType: z.string().optional(),
  roadType: z.string().optional(),
  elements: z.array(z.string()).default([]),
  vegetation: z.array(z.string()).default([]),
  adjacentBuildings: z.array(z.string()).default([]),
  notes: z.string().default(""),
});

export const ContextDNASchema = z.object({
  schemaVersion: z.literal(1),

  macroContext: z.string().optional(),
  climateContext: z.string().optional(),

  density: z.enum(["very_low", "low", "medium", "high", "very_high"]).optional(),

  front: ContextZoneSchema.default({
    elements: [],
    vegetation: [],
    adjacentBuildings: [],
    notes: "",
  }),
  rear: ContextZoneSchema.default({
    elements: [],
    vegetation: [],
    adjacentBuildings: [],
    notes: "",
  }),
  left: ContextZoneSchema.default({
    elements: [],
    vegetation: [],
    adjacentBuildings: [],
    notes: "",
  }),
  right: ContextZoneSchema.default({
    elements: [],
    vegetation: [],
    adjacentBuildings: [],
    notes: "",
  }),

  distantBackground: z.array(z.string()).default([]),
  atmosphereNotes: z.string().default(""),
  negativeConstraints: z.array(z.string()).default([]),
});
```

## 4. Future DNA schemas

Define these in the domain package early, but Phase 1 UI may leave them unused.

### Camera DNA

```ts
export const CameraDNASchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string(),
  azimuthDeg: z.number().min(-360).max(360).optional(),
  elevationDeg: z.number().min(-90).max(90).optional(),
  heightM: z.number().positive().optional(),
  lensMm: z.number().positive().optional(),
  targetObjectId: z.string().optional(),
  composition: z.string().optional(),
  notes: z.string().default(""),
});
```

### Lighting DNA

```ts
export const LightingDNASchema = z.object({
  schemaVersion: z.literal(1),
  timeOfDay: z.string().optional(),
  sunDirection: z.string().optional(),
  sunElevation: z.string().optional(),
  intensity: z.string().optional(),
  shadowLength: z.string().optional(),
  shadowSoftness: z.string().optional(),
  ambientLight: z.string().optional(),
  artificialLighting: z.array(z.object({
    type: z.string(),
    temperatureK: z.number().int().positive().optional(),
    intensity: z.string().optional(),
    zone: z.string().optional(),
  })).default([]),
});
```

### Weather DNA

```ts
export const WeatherDNASchema = z.object({
  schemaVersion: z.literal(1),
  preset: z.string().optional(),
  sky: z.string().optional(),
  humidity: z.string().optional(),
  groundWetness: z.string().optional(),
  haze: z.string().optional(),
  notes: z.string().default(""),
});
```

### Mood DNA

```ts
export const MoodDNASchema = z.object({
  schemaVersion: z.literal(1),
  preset: z.string().optional(),
  contrast: z.string().optional(),
  saturation: z.string().optional(),
  warmth: z.string().optional(),
  atmosphere: z.string().optional(),
  notes: z.string().default(""),
});
```

### Color Grade DNA

```ts
export const ColorGradeDNASchema = z.object({
  schemaVersion: z.literal(1),
  exposure: z.number().min(-5).max(5).default(0),
  contrast: z.number().min(-100).max(100).default(0),
  highlights: z.number().min(-100).max(100).default(0),
  shadows: z.number().min(-100).max(100).default(0),
  whites: z.number().min(-100).max(100).default(0),
  blacks: z.number().min(-100).max(100).default(0),
  temperature: z.number().min(-100).max(100).default(0),
  tint: z.number().min(-100).max(100).default(0),
  vibrance: z.number().min(-100).max(100).default(0),
  saturation: z.number().min(-100).max(100).default(0),
  clarity: z.number().min(-100).max(100).default(0),
  dehaze: z.number().min(-100).max(100).default(0),
  look: z.string().optional(),
});
```

## 5. Lock state

```ts
export const LockStateSchema = z.object({
  building: z.boolean().default(false),
  context: z.boolean().default(false),
  camera: z.boolean().default(false),
  lighting: z.boolean().default(false),
  weather: z.boolean().default(false),
  colorGrade: z.boolean().default(false),
  objectIds: z.array(z.string()).default([]),
});
```

## 6. Project DNA aggregate

```ts
export const ProjectDNASchema = z.object({
  schemaVersion: z.literal(1),
  building: BuildingDNASchema,
  context: ContextDNASchema,
  cameras: z.array(CameraDNASchema).default([]),
  lighting: LightingDNASchema.optional(),
  weather: WeatherDNASchema.optional(),
  mood: MoodDNASchema.optional(),
  colorGrade: ColorGradeDNASchema.optional(),
  locks: LockStateSchema.default({
    building: false,
    context: false,
    camera: false,
    lighting: false,
    weather: false,
    colorGrade: false,
    objectIds: [],
  }),
});
```

## 7. Prompt bundle

```ts
export const PromptBundleSchema = z.object({
  compilerVersion: z.string(),
  positivePrompt: z.string(),
  negativePrompt: z.string(),
  referenceInstructions: z.string(),
  preservationInstructions: z.string(),
  metadata: z.record(z.string(), z.unknown()),
});
```

## 8. SQLite target schema

Phase 1 required tables are marked REQUIRED.

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- REQUIRED
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_type TEXT NOT NULL,
  subtype TEXT,
  status TEXT NOT NULL,
  active_master_asset_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

-- REQUIRED
CREATE TABLE project_dna (
  project_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  dna_json TEXT NOT NULL,
  compiler_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- REQUIRED
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',

  original_name TEXT,
  managed_rel_path TEXT NOT NULL,
  mime_type TEXT,
  file_size_bytes INTEGER,
  width_px INTEGER,
  height_px INTEGER,
  sha256 TEXT,

  parent_asset_id TEXT,
  operation TEXT,
  operation_json TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(parent_asset_id) REFERENCES assets(id) ON DELETE SET NULL
);

CREATE INDEX idx_assets_project ON assets(project_id);
CREATE INDEX idx_assets_parent ON assets(parent_asset_id);
CREATE INDEX idx_assets_sha256 ON assets(sha256);

-- REQUIRED
CREATE TABLE versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  parent_version_id TEXT,
  label TEXT,
  operation TEXT NOT NULL,
  operation_json TEXT,
  created_at TEXT NOT NULL,

  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY(parent_version_id) REFERENCES versions(id) ON DELETE SET NULL
);

-- Target / future
CREATE TABLE scene_objects (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  object_type TEXT NOT NULL,
  name TEXT NOT NULL,
  zone TEXT,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE scene_relations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  from_object_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  to_object_id TEXT NOT NULL,
  data_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE cameras (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  camera_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,
  provider TEXT,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  request_json TEXT NOT NULL,
  result_json TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE qc_reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  report_json TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE
);
```

Important: `projects.active_master_asset_id` should be validated by application service to ensure it references an asset in the same project. If a DB-level cyclic FK complicates initial migrations, keep this invariant in the service layer.

## 9. Asset metadata

On import calculate when practical:
- MIME
- file size
- pixel dimensions
- SHA-256

Supported Phase 1 formats:
- JPEG
- PNG
- WebP

TIFF may be added later when the preview pipeline supports it reliably.

Duplicate SHA-256:
- do not silently discard
- warn that the same binary already exists in the project
- user may still keep a second logical reference if desired, but default should reuse or cancel rather than create uncontrolled duplicates
