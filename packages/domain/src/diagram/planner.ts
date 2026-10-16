/**
 * Step planner (ADR-037, SRS §10.1–10.2).
 *
 * Builds the steps of one diagram from the project's DNA facts. Townhouses and villas get
 * different sequences (light well, depth, party walls and floors vs. massing split, approach,
 * garden and indoor–outdoor); other building types get a neutral sequence.
 *
 * Evidence rules:
 * - a step is `verified` only when the DNA holds the facts it states (its `basis`);
 * - a step that states interior functions is never `verified` without confirmed space facts
 *   (AC-14): a single facade render says nothing about the rooms behind it;
 * - everything else is `inferred` (sources make it plausible) or `illustrative`. The sheet
 *   labels both as "sơ đồ diễn giải ý tưởng".
 *
 * Pure and deterministic: same DNA, type, count and options → the same plan.
 */
import { isConfirmed } from "../facts/evidence";
import type { ProjectType } from "../schemas/enums";
import type { ProjectDNA } from "../schemas/projectDna";
import {
  DiagramPlanSchema,
  DiagramSourcesSchema,
  parseDiagramStepCount,
  type DiagramAnnotation,
  type DiagramEvidence,
  type DiagramFamily,
  type DiagramPlan,
  type DiagramSources,
  type DiagramStep,
  type DiagramStepCount,
  type DiagramType,
  type LocalizedText,
} from "./schemas";

export type PlanDiagramOptions = {
  /** The project's type; more reliable than the free-text building type. */
  projectType?: ProjectType;
  /** Plans, elevations or a 3D model given next to the render. */
  sources?: Partial<DiagramSources>;
};

/** What the planner can read from the DNA, with the DNA paths that back each fact. */
type Facts = {
  family: DiagramFamily;
  sources: DiagramSources;
  /** Confirmed site sides (`site.front`, …). */
  site: string[];
  /** Confirmed attached neighbours on the left/right (party walls). */
  partyWalls: string[];
  /** Confirmed street or open sides. */
  openSides: string[];
  /** Spaces with at least one confirmed fact. */
  spaces: string[];
  has: (path: string) => boolean;
};

type Check = { evidence: DiagramEvidence; basis: string[] };

type Candidate = {
  key: string;
  title: LocalizedText;
  caption: LocalizedText;
  annotations?: DiagramAnnotation[];
  interior?: boolean;
  /** DNA paths that make the step verified (any of them, unless `all`). */
  facts?: string[];
  all?: boolean;
  /** Evidence when the facts are missing but a source makes the step plausible. */
  fallback?: (f: Facts) => Check | null;
  /** Never verified, whatever the DNA says (airflow, escape routes, …). */
  ideaOnly?: boolean;
};

const tx = (vi: string, en: string): LocalizedText => ({ vi, en });
const label = (vi: string, en: string, x: number, y: number): DiagramAnnotation => ({
  kind: "label",
  label: tx(vi, en),
  position: { x, y },
});
const arrow = (
  from: [number, number],
  to: [number, number],
  text?: [string, string],
): DiagramAnnotation => ({
  kind: "arrow",
  from: { x: from[0], y: from[1] },
  to: { x: to[0], y: to[1] },
  ...(text ? { label: tx(text[0], text[1]) } : {}),
});

const nonEmpty = (value: unknown): boolean => {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  return false;
};

/** DNA facts by dotted path; only the paths the candidates use. */
function dnaFacts(dna: ProjectDNA): Record<string, unknown> {
  const b = dna.building;
  return {
    "building.architecturalStyle": b.architecturalStyle,
    "building.dimensions.widthM": b.dimensions.widthM,
    "building.dimensions.depthM": b.dimensions.depthM,
    "building.dimensions.heightM": b.dimensions.heightM,
    "building.dimensions.siteDepthM": b.dimensions.siteDepthM,
    "building.floors": b.floors,
    "building.massing.composition": b.massing.composition,
    "building.massing.mainVolume": b.massing.mainVolume,
    "building.massing.secondaryVolume": b.massing.secondaryVolume,
    "building.massing.voids": b.massing.voids,
    "building.massing.cantilever": b.massing.cantilever,
    "building.roof.type": b.roof.type,
    "building.roof.overhang": b.roof.overhang,
    "building.openings.windowType": b.openings.windowType,
    "building.openings.frame": b.openings.frame,
    "building.openings.rhythm": b.openings.rhythm,
    "building.openings.glazing": b.openings.glazing,
    "building.materials": b.materials,
    "building.colorPalette": b.colorPalette,
    "building.specialFeatures": b.specialFeatures,
    "context.front.vegetation": dna.context.front.vegetation,
    "lighting.sunDirection": dna.lighting?.sunDirection,
    architecturalDetails: dna.architecturalDetails ?? [],
  };
}

export function diagramFamily(dna: ProjectDNA, projectType?: ProjectType): DiagramFamily {
  if (projectType === "townhouse") return "townhouse";
  if (projectType === "villa" || projectType === "urban_villa") return "villa";
  const text = `${dna.spaceCatalog?.buildingArchetype ?? ""} ${dna.building.buildingType}`
    .toLowerCase()
    .normalize("NFC");
  if (/townhouse|nhà phố|nha pho|shophouse|nhà liền kề/.test(text)) return "townhouse";
  if (/villa|biệt thự|biet thu/.test(text)) return "villa";
  return "generic";
}

function readFacts(dna: ProjectDNA, options: PlanDiagramOptions): Facts {
  const values = dnaFacts(dna);
  const site = dna.site;
  const sides = (["front", "left", "right", "rear"] as const).filter(
    (side) => site !== undefined && isConfirmed(site[side].evidence),
  );
  const spaces = (dna.spaceCatalog?.spaces ?? [])
    .filter((space) => Object.values(space.facts).some((fact) => isConfirmed(fact.evidence)))
    .map((space) => `spaceCatalog.spaces.${space.id}`);
  return {
    family: diagramFamily(dna, options.projectType),
    sources: DiagramSourcesSchema.parse(options.sources ?? {}),
    site: sides.map((side) => `site.${side}`),
    partyWalls: sides
      .filter(
        (side) => (side === "left" || side === "right") && site![side].kind === "attached_building",
      )
      .map((side) => `site.${side}`),
    openSides: sides
      .filter((side) => site![side].kind === "street" || site![side].kind === "open_space")
      .map((side) => `site.${side}`),
    spaces,
    has: (path) => nonEmpty(values[path]),
  };
}

const SITE = "@site";
const PARTY_WALLS = "@partyWalls";
const OPEN_SIDES = "@openSides";
const SPACES = "@spaces";

function basisOf(path: string, f: Facts): string[] {
  if (path === SITE) return f.site;
  if (path === PARTY_WALLS) return f.partyWalls;
  if (path === OPEN_SIDES) return f.openSides;
  if (path === SPACES) return f.spaces;
  return f.has(path) ? [path] : [];
}

const inferredWhen = (test: (f: Facts) => boolean) => (f: Facts) =>
  test(f) ? { evidence: "inferred" as const, basis: [] } : null;
const withPlan = inferredWhen((f) => f.sources.floorPlan);
const withElevation = inferredWhen((f) => f.sources.elevation || f.sources.model3d);
const withModel = inferredWhen((f) => f.sources.model3d);

function check(candidate: Candidate, f: Facts): Check {
  if (!candidate.ideaOnly) {
    const paths = candidate.interior
      ? [...(candidate.facts ?? []), SPACES]
      : (candidate.facts ?? []);
    const found = paths.map((path) => basisOf(path, f));
    const ok = candidate.all
      ? found.length > 0 && found.every((b) => b.length > 0)
      : found.some((b) => b.length > 0);
    // AC-14: interior functions need confirmed space facts, never just DNA text.
    const interiorOk = !candidate.interior || f.spaces.length > 0;
    if (ok && interiorOk) return { evidence: "verified", basis: [...new Set(found.flat())] };
  }
  return candidate.fallback?.(f) ?? { evidence: "illustrative", basis: [] };
}

// ---------------------------------------------------------------- sequences

const ENTRY_ARROW = arrow([0.5, 0.98], [0.5, 0.66], ["lối vào", "entry"]);
const LIGHT_ARROW = arrow([0.5, 0.04], [0.5, 0.5], ["ánh sáng", "daylight"]);

function conceptEvolution(family: DiagramFamily): Candidate[] {
  if (family === "townhouse")
    return [
      {
        key: "plot",
        title: tx("Lô đất hẹp và vách liền kề", "Narrow plot and party walls"),
        caption: tx(
          "Lô phố hẹp, sâu; hai cạnh bên tựa vào nhà hàng xóm.",
          "A narrow, deep urban plot; both sides lean on the neighbours.",
        ),
        annotations: [
          label("vách chung", "party wall", 0.1, 0.5),
          label("vách chung", "party wall", 0.9, 0.5),
        ],
        facts: [PARTY_WALLS, SITE, "building.dimensions.siteDepthM"],
      },
      {
        key: "depth",
        title: tx("Khối đặc theo chiều sâu", "Solid volume along the depth"),
        caption: tx(
          "Khối nhà lấp đầy chiều sâu lô đất trước khi khoét rỗng.",
          "The volume fills the plot depth before any void is carved.",
        ),
        annotations: [arrow([0.2, 0.85], [0.8, 0.3], ["chiều sâu", "depth"])],
        facts: ["building.dimensions.depthM", "building.massing.mainVolume"],
        fallback: withModel,
      },
      {
        key: "floors",
        title: tx("Tổ chức theo tầng", "Floor-by-floor organisation"),
        caption: tx(
          "Chia khối thành các tầng theo số tầng của công trình.",
          "The volume is split into the building's floors.",
        ),
        annotations: [label("các tầng", "floors", 0.82, 0.3)],
        facts: ["building.floors", "building.dimensions.heightM"],
      },
      {
        key: "light_well",
        title: tx("Khoét giếng trời", "Carving the light well"),
        caption: tx(
          "Giếng trời đưa ánh sáng và gió vào sâu trong nhà.",
          "A light well brings daylight and air deep into the house.",
        ),
        annotations: [LIGHT_ARROW],
        facts: ["building.massing.voids"],
      },
      {
        key: "setbacks",
        title: tx("Lùi tầng và ban công", "Setbacks and balconies"),
        caption: tx(
          "Các tầng trên lùi lại hoặc đua ra để tạo ban công.",
          "Upper floors step back or project to form balconies.",
        ),
        facts: ["building.massing.cantilever", "building.massing.composition"],
        fallback: withElevation,
      },
      {
        key: "front_screen",
        title: tx("Mặt tiền lọc nắng", "Filtering front facade"),
        caption: tx(
          "Lớp mặt tiền lọc nắng và che tầm nhìn từ phố.",
          "The front layer filters sun and views from the street.",
        ),
        annotations: [arrow([0.5, 0.98], [0.5, 0.72], ["phố", "street"])],
        facts: ["building.openings.rhythm", "building.openings.windowType", "building.materials"],
        fallback: withElevation,
      },
      {
        key: "roof",
        title: tx("Mái và sân thượng", "Roof and terrace"),
        caption: tx(
          "Mái che và sân thượng khép lại khối nhà.",
          "Roof and terrace close the volume.",
        ),
        facts: ["building.roof.type"],
      },
      {
        key: "final",
        title: tx("Khối hoàn thiện trên phố", "Final mass on the street"),
        caption: tx(
          "Khối cuối cùng với vật liệu đã biết, đứng giữa dãy phố.",
          "The final mass with its known materials, set in the street row.",
        ),
        facts: ["building.massing.composition", "building.materials"],
        all: true,
      },
    ];
  if (family === "villa")
    return [
      {
        key: "site_approach",
        title: tx("Khu đất và hướng tiếp cận", "Site and approach"),
        caption: tx(
          "Khu đất rộng; lối tiếp cận quyết định hướng của khối nhà.",
          "A generous site; the approach sets the orientation of the house.",
        ),
        annotations: [ENTRY_ARROW],
        facts: [SITE],
      },
      {
        key: "solid",
        title: tx("Khối đặc ban đầu", "Initial solid"),
        caption: tx("Một khối đặc theo kích thước đã biết.", "One solid at the known dimensions."),
        facts: ["building.massing.mainVolume", "building.dimensions.widthM"],
        fallback: withModel,
      },
      {
        key: "split",
        title: tx("Chia khối chính – phụ", "Primary and secondary masses"),
        caption: tx(
          "Tách khối chính và khối phụ để giảm quy mô và mở sân.",
          "The solid splits into primary and secondary masses to open the site.",
        ),
        annotations: [
          label("khối chính", "main", 0.32, 0.5),
          label("khối phụ", "secondary", 0.72, 0.6),
        ],
        facts: ["building.massing.secondaryVolume", "building.massing.composition"],
        fallback: withModel,
      },
      {
        key: "garden",
        title: tx("Mở sân vườn giữa các khối", "Garden between the masses"),
        caption: tx(
          "Khoảng sân vườn nằm giữa và quanh các khối.",
          "Garden space sits between and around the masses.",
        ),
        annotations: [label("sân vườn", "garden", 0.5, 0.78)],
        facts: ["context.front.vegetation", "building.massing.voids"],
      },
      {
        key: "indoor_outdoor",
        title: tx("Kết nối trong – ngoài", "Indoor–outdoor connection"),
        caption: tx(
          "Mặt kính và hiên mở không gian ra sân vườn.",
          "Glazing and verandas open the spaces to the garden.",
        ),
        annotations: [arrow([0.35, 0.55], [0.7, 0.8])],
        facts: ["building.openings.glazing", "building.massing.voids"],
        fallback: withElevation,
      },
      {
        key: "roof",
        title: tx("Mái và phần đua", "Roof and overhangs"),
        caption: tx(
          "Mái và phần đua che nắng cho các mặt mở.",
          "Roof and overhangs shade the open sides.",
        ),
        facts: ["building.roof.type", "building.roof.overhang"],
      },
      {
        key: "materials",
        title: tx("Lớp vật liệu", "Material layers"),
        caption: tx(
          "Vật liệu đã biết phân lớp trên từng khối.",
          "Known materials layer each mass.",
        ),
        facts: ["building.materials"],
      },
      {
        key: "final",
        title: tx("Phương án hoàn thiện", "Final scheme"),
        caption: tx(
          "Các khối, sân vườn và vật liệu hợp thành phương án.",
          "Masses, garden and materials form the scheme.",
        ),
        facts: ["building.massing.composition", "building.materials"],
        all: true,
      },
    ];
  return [
    {
      key: "site",
      title: tx("Khu đất", "Site"),
      caption: tx("Ranh giới và các cạnh đã biết của khu đất.", "The site and its known edges."),
      facts: [SITE],
    },
    {
      key: "main",
      title: tx("Khối chính", "Primary volume"),
      caption: tx("Khối chính theo kích thước đã biết.", "The primary volume at the known size."),
      facts: ["building.massing.mainVolume", "building.dimensions.widthM"],
      fallback: withModel,
    },
    {
      key: "secondary",
      title: tx("Khối phụ", "Secondary volume"),
      caption: tx("Khối phụ gắn vào khối chính.", "A secondary volume joins the primary one."),
      facts: ["building.massing.secondaryVolume"],
    },
    {
      key: "voids",
      title: tx("Khoảng rỗng", "Voids"),
      caption: tx("Các khoảng rỗng được khoét khỏi khối.", "Voids are carved out of the mass."),
      facts: ["building.massing.voids"],
    },
    {
      key: "approach",
      title: tx("Lối tiếp cận", "Approach"),
      caption: tx("Lối vào từ cạnh tiếp cận của khu đất.", "The entrance from the approach side."),
      annotations: [ENTRY_ARROW],
      facts: [OPEN_SIDES],
    },
    {
      key: "roof",
      title: tx("Mái", "Roof"),
      caption: tx("Hình thức mái khép lại khối.", "The roof form closes the mass."),
      facts: ["building.roof.type"],
    },
    {
      key: "materials",
      title: tx("Vật liệu", "Materials"),
      caption: tx("Vật liệu đã biết trên các mặt.", "Known materials on the faces."),
      facts: ["building.materials"],
    },
    {
      key: "final",
      title: tx("Khối hoàn thiện", "Final mass"),
      caption: tx(
        "Khối cuối cùng với vật liệu đã biết.",
        "The final mass with its known materials.",
      ),
      facts: ["building.massing.composition", "building.materials"],
      all: true,
    },
  ];
}

function massingVoids(family: DiagramFamily): Candidate[] {
  if (family === "townhouse")
    return [
      {
        key: "solid",
        title: tx("Khối đặc lô phố", "Solid plot volume"),
        caption: tx("Khối đặc chiếm trọn lô đất hẹp.", "A solid fills the narrow plot."),
        facts: ["building.dimensions.depthM", "building.massing.mainVolume"],
        fallback: withModel,
      },
      {
        key: "party_walls",
        title: tx("Vách liền kề", "Party walls"),
        caption: tx(
          "Hai vách bên kín, ánh sáng chỉ vào từ trước, sau và trên.",
          "Closed side walls: light enters from front, back and top.",
        ),
        annotations: [label("kín", "closed", 0.1, 0.5), label("kín", "closed", 0.9, 0.5)],
        facts: [PARTY_WALLS],
      },
      {
        key: "light_well",
        title: tx("Giếng trời giữa nhà", "Central light well"),
        caption: tx(
          "Khoảng rỗng thẳng đứng giữa chiều sâu nhà.",
          "A vertical void in the middle of the depth.",
        ),
        annotations: [LIGHT_ARROW],
        facts: ["building.massing.voids"],
      },
      {
        key: "front_setback",
        title: tx("Khoảng lùi mặt tiền", "Front setback"),
        caption: tx(
          "Mặt tiền lùi lại tạo khoảng đệm với phố.",
          "The front steps back to buffer the street.",
        ),
        facts: ["building.massing.composition"],
        fallback: withElevation,
      },
      {
        key: "balconies",
        title: tx("Ban công và lô gia", "Balconies and loggias"),
        caption: tx(
          "Khoảng rỗng nhỏ ở mặt tiền mỗi tầng.",
          "Small voids on the front of each floor.",
        ),
        facts: ["building.massing.cantilever"],
        fallback: withElevation,
      },
      {
        key: "double_height",
        title: tx("Khoảng thông tầng", "Double-height void"),
        caption: tx(
          "Khoảng thông tầng nối các tầng với nhau.",
          "A double-height void links the floors.",
        ),
        facts: ["building.massing.voids", "building.floors"],
        all: true,
      },
      {
        key: "roof_terrace",
        title: tx("Sân thượng", "Roof terrace"),
        caption: tx("Phần rỗng trên mái làm sân thượng.", "An open roof terrace tops the volume."),
        facts: ["building.roof.type"],
      },
      {
        key: "summary",
        title: tx("Tổng hợp đặc – rỗng", "Solid–void summary"),
        caption: tx(
          "Quan hệ đặc – rỗng của toàn bộ khối nhà.",
          "The solid–void balance of the whole house.",
        ),
        facts: ["building.massing.voids", "building.dimensions.depthM"],
        all: true,
      },
    ];
  return [
    {
      key: "solid",
      title: tx("Khối đặc ban đầu", "Initial solid"),
      caption: tx("Một khối đặc theo kích thước đã biết.", "One solid at the known dimensions."),
      facts: ["building.massing.mainVolume", "building.dimensions.widthM"],
      fallback: withModel,
    },
    {
      key: "split",
      title: tx("Tách khối", "Mass split"),
      caption: tx("Khối được tách thành các phần nhỏ hơn.", "The solid splits into smaller parts."),
      facts: ["building.massing.secondaryVolume"],
      fallback: withModel,
    },
    {
      key: "courtyard",
      title: tx("Sân trong", "Courtyard"),
      caption: tx("Khoảng rỗng mở giữa các khối.", "An open void between the masses."),
      facts: ["building.massing.voids"],
    },
    {
      key: "overhangs",
      title: tx("Phần đua và mái hắt", "Cantilevers and eaves"),
      caption: tx("Các phần đua tạo bóng đổ và hiên.", "Cantilevers cast shade and form verandas."),
      facts: ["building.massing.cantilever", "building.roof.overhang"],
      fallback: withElevation,
    },
    {
      key: "veranda",
      title: tx("Hiên chuyển tiếp", "Transitional veranda"),
      caption: tx("Không gian nửa trong nửa ngoài quanh khối.", "Semi-open space around the mass."),
      facts: ["building.massing.composition"],
      fallback: withElevation,
    },
    {
      key: "roof",
      title: tx("Mái", "Roof"),
      caption: tx("Hình thức mái phủ các khối.", "The roof form over the masses."),
      facts: ["building.roof.type"],
    },
    {
      key: "proportions",
      title: tx("Tỷ lệ khối", "Proportions"),
      caption: tx(
        "Tỷ lệ dài – rộng – cao của các khối.",
        "Length, width and height of the masses.",
      ),
      facts: ["building.dimensions.widthM", "building.dimensions.heightM"],
      all: true,
    },
    {
      key: "summary",
      title: tx("Tổng hợp đặc – rỗng", "Solid–void summary"),
      caption: tx(
        "Quan hệ đặc – rỗng của toàn bộ công trình.",
        "The solid–void balance of the building.",
      ),
      facts: ["building.massing.voids", "building.massing.composition"],
      all: true,
    },
  ];
}

function functionalZoning(family: DiagramFamily): Candidate[] {
  const zone = (
    key: string,
    title: LocalizedText,
    caption: LocalizedText,
    x: number,
    y: number,
  ): Candidate => ({
    key,
    title,
    caption,
    interior: true,
    annotations: [label(title.vi.toLowerCase(), title.en.toLowerCase(), x, y)],
    fallback: withPlan,
  });
  return [
    {
      key: "arrival",
      title: tx("Vùng tiếp cận", "Arrival zone"),
      caption: tx(
        "Cạnh tiếp cận của khu đất và lối vào.",
        "The approach side of the site and the entrance.",
      ),
      annotations: [ENTRY_ARROW],
      facts: [OPEN_SIDES, SITE],
    },
    zone(
      "living",
      tx("Vùng sinh hoạt chung", "Shared living zone"),
      tx(
        "Chỉ khẳng định khi có mặt bằng hoặc dữ liệu không gian đã xác nhận.",
        "Stated only with a plan or confirmed space facts.",
      ),
      0.35,
      0.55,
    ),
    zone(
      "kitchen",
      tx("Vùng bếp – ăn", "Kitchen–dining zone"),
      tx(
        "Không suy ra vị trí bếp từ ảnh mặt tiền.",
        "The kitchen is never inferred from a facade image.",
      ),
      0.65,
      0.55,
    ),
    family === "townhouse"
      ? zone(
          "per_floor",
          tx("Phân khu theo tầng", "Zones per floor"),
          tx(
            "Mỗi tầng một nhóm công năng, theo mặt bằng từng tầng.",
            "One group of uses per floor, from the floor plans.",
          ),
          0.5,
          0.35,
        )
      : zone(
          "private",
          tx("Vùng nghỉ riêng tư", "Private rest zone"),
          tx(
            "Vùng ngủ tách khỏi vùng đón khách khi mặt bằng cho phép.",
            "Sleeping areas set apart from guests when the plan shows it.",
          ),
          0.7,
          0.35,
        ),
    zone(
      "service",
      tx("Vùng phục vụ", "Service zone"),
      tx(
        "Kho, kỹ thuật, giặt phơi — giữ ở mức ý tưởng khi thiếu dữ liệu.",
        "Storage, plant and laundry — kept as an idea without data.",
      ),
      0.25,
      0.3,
    ),
    family === "townhouse"
      ? zone(
          "core",
          tx("Lõi thang và vệ sinh", "Stair and wet core"),
          tx(
            "Lõi đứng thường bám vách chung hoặc giếng trời.",
            "The vertical core usually hugs a party wall or the light well.",
          ),
          0.5,
          0.5,
        )
      : zone(
          "spine",
          tx("Trục kết nối các vùng", "Connecting spine"),
          tx(
            "Quan hệ giữa các vùng, không vẽ lại mặt bằng.",
            "How the zones relate, without redrawing a plan.",
          ),
          0.5,
          0.5,
        ),
    {
      key: "indoor_outdoor",
      title: tx("Quan hệ trong – ngoài", "Indoor–outdoor relation"),
      caption: tx(
        "Các mặt mở ra sân, vườn hoặc phố.",
        "The sides that open to yard, garden or street.",
      ),
      annotations: [arrow([0.5, 0.55], [0.85, 0.85])],
      facts: ["building.massing.voids", "building.openings.glazing"],
      fallback: withElevation,
    },
    zone(
      "summary",
      tx("Tổng hợp phân khu", "Zoning summary"),
      tx("Tổng hợp các vùng có căn cứ.", "The zones that have a basis."),
      0.5,
      0.5,
    ),
  ];
}

function circulation(family: DiagramFamily): Candidate[] {
  if (family === "townhouse")
    return [
      {
        key: "street_entry",
        title: tx("Lối vào từ phố", "Entrance from the street"),
        caption: tx("Lối vào duy nhất từ mặt phố.", "The single entrance from the street front."),
        annotations: [ENTRY_ARROW],
        facts: [OPEN_SIDES],
      },
      {
        key: "parking",
        title: tx("Để xe tầng trệt", "Ground-floor parking"),
        caption: tx(
          "Chỗ để xe ở tầng trệt khi mặt bằng xác nhận.",
          "Parking on the ground floor when the plan confirms it.",
        ),
        interior: true,
        fallback: withPlan,
      },
      {
        key: "stair",
        title: tx("Cầu thang cạnh giếng trời", "Stair beside the light well"),
        caption: tx(
          "Vị trí thang chỉ khẳng định khi có mặt bằng.",
          "The stair position is stated only with a plan.",
        ),
        interior: true,
        annotations: [arrow([0.45, 0.85], [0.45, 0.2], ["thang", "stair"])],
        fallback: withPlan,
      },
      {
        key: "vertical",
        title: tx("Luồng đứng qua các tầng", "Vertical flow through the floors"),
        caption: tx("Di chuyển đứng nối các tầng của nhà.", "Vertical movement links the floors."),
        interior: true,
        facts: ["building.floors"],
        fallback: withPlan,
      },
      {
        key: "corridor",
        title: tx("Hành lang tầng", "Floor corridor"),
        caption: tx(
          "Lối đi trên mỗi tầng dọc theo chiều sâu.",
          "The walkway on each floor along the depth.",
        ),
        interior: true,
        annotations: [arrow([0.2, 0.6], [0.8, 0.6])],
        fallback: withPlan,
      },
      {
        key: "roof_access",
        title: tx("Lối lên sân thượng", "Access to the roof terrace"),
        caption: tx("Thang kết thúc ở sân thượng.", "The stair ends at the roof terrace."),
        interior: true,
        facts: ["building.roof.type"],
        fallback: withPlan,
      },
      {
        key: "escape",
        title: tx("Lối thoát nạn", "Escape route"),
        caption: tx(
          "Chỉ là ý tưởng; phải kiểm tra theo tiêu chuẩn và mặt bằng.",
          "An idea only; check against the code and the plans.",
        ),
        interior: true,
        ideaOnly: true,
      },
      {
        key: "summary",
        title: tx("Tổng hợp luồng di chuyển", "Circulation summary"),
        caption: tx("Các luồng di chuyển có căn cứ.", "The routes that have a basis."),
        interior: true,
        fallback: withPlan,
      },
    ];
  return [
    {
      key: "gate",
      title: tx("Cổng và đường vào", "Gate and drive"),
      caption: tx(
        "Đường vào từ cạnh tiếp cận của khu đất.",
        "The drive from the approach side of the site.",
      ),
      annotations: [ENTRY_ARROW],
      facts: [OPEN_SIDES, SITE],
    },
    {
      key: "porch",
      title: tx("Sảnh đón", "Entrance porch"),
      caption: tx(
        "Điểm đón khách trước khối chính.",
        "The arrival point in front of the main mass.",
      ),
      facts: ["building.massing.composition"],
      fallback: withElevation,
    },
    {
      key: "spine",
      title: tx("Trục chính trong nhà", "Main internal spine"),
      caption: tx(
        "Trục di chuyển chính, chỉ khẳng định khi có mặt bằng.",
        "The main route, stated only with a plan.",
      ),
      interior: true,
      annotations: [arrow([0.2, 0.6], [0.8, 0.5])],
      fallback: withPlan,
    },
    {
      key: "stair",
      title: tx("Cầu thang chính", "Main stair"),
      caption: tx(
        "Vị trí thang theo mặt bằng đã xác nhận.",
        "The stair position from a confirmed plan.",
      ),
      interior: true,
      fallback: withPlan,
    },
    {
      key: "garden_exits",
      title: tx("Lối ra sân vườn", "Garden exits"),
      caption: tx("Các cửa mở ra sân vườn.", "Doors that open to the garden."),
      annotations: [arrow([0.5, 0.5], [0.85, 0.85])],
      facts: ["building.openings.glazing"],
      fallback: withElevation,
    },
    {
      key: "service",
      title: tx("Luồng phục vụ", "Service route"),
      caption: tx(
        "Lối phục vụ tách khỏi lối khách khi mặt bằng cho phép.",
        "A service route apart from guests when the plan allows.",
      ),
      interior: true,
      fallback: withPlan,
    },
    {
      key: "loop",
      title: tx("Vòng dạo quanh nhà", "Loop around the house"),
      caption: tx(
        "Lối dạo bao quanh khối trong sân vườn.",
        "A walk around the house through the garden.",
      ),
      annotations: [arrow([0.15, 0.85], [0.85, 0.85]), arrow([0.85, 0.85], [0.85, 0.3])],
      facts: ["context.front.vegetation"],
    },
    {
      key: "summary",
      title: tx("Tổng hợp luồng di chuyển", "Circulation summary"),
      caption: tx("Các luồng di chuyển có căn cứ.", "The routes that have a basis."),
      interior: true,
      fallback: withPlan,
    },
  ];
}

function sunVentilation(family: DiagramFamily): Candidate[] {
  // The DNA sun direction is a rendering choice, not a measured orientation: inferred at best.
  const sun = inferredWhen((f) => f.has("lighting.sunDirection"));
  return [
    {
      key: "orientation",
      title: tx("Hướng nắng", "Solar orientation"),
      caption: tx(
        "Cần hướng Bắc hoặc vị trí để khẳng định.",
        "Needs north or the location to be stated.",
      ),
      annotations: [arrow([0.1, 0.1], [0.45, 0.45], ["nắng", "sun"])],
      ideaOnly: true,
      fallback: sun,
    },
    {
      key: "sun_face",
      title: tx("Mặt đón nắng", "Sun-facing side"),
      caption: tx(
        "Mặt chịu nắng nhiều nhất cần được che.",
        "The side with the most sun needs shading.",
      ),
      ideaOnly: true,
      fallback: sun,
    },
    {
      key: "shading",
      title: tx("Che nắng", "Shading"),
      caption: tx("Mái hắt, lam và phần đua đã biết.", "Known eaves, louvres and overhangs."),
      facts: ["building.roof.overhang", "building.massing.cantilever", "building.openings.rhythm"],
      fallback: withElevation,
    },
    {
      key: "open_sides",
      title: tx("Mặt thoáng", "Open sides"),
      caption: tx(
        "Các cạnh khu đất mở ra phố hoặc khoảng trống.",
        "The site sides open to the street or open space.",
      ),
      facts: [OPEN_SIDES],
    },
    {
      key: "vent_void",
      title:
        family === "townhouse"
          ? tx("Giếng trời thông gió", "Ventilating light well")
          : tx("Khoảng rỗng đón gió", "Ventilation void"),
      caption: tx(
        "Khoảng rỗng đã biết giúp không khí lưu thông.",
        "A known void that helps air move.",
      ),
      annotations: [arrow([0.5, 0.85], [0.5, 0.1], ["gió", "air"])],
      facts: ["building.massing.voids"],
    },
    {
      key: "airflow",
      title: tx("Đường gió ý tưởng", "Illustrative airflow"),
      caption: tx(
        "Mũi tên gió là diễn giải, không phải mô phỏng.",
        "Airflow arrows are an interpretation, not a simulation.",
      ),
      annotations: [arrow([0.05, 0.6], [0.95, 0.45], ["gió", "wind"])],
      ideaOnly: true,
    },
    family === "townhouse"
      ? {
          key: "stack",
          title: tx("Hiệu ứng ống khói", "Stack effect"),
          caption: tx(
            "Khí nóng thoát lên qua giếng trời (diễn giải).",
            "Warm air rises out through the light well (interpretation).",
          ),
          annotations: [arrow([0.5, 0.9], [0.5, 0.05])],
          ideaOnly: true,
        }
      : {
          key: "cross",
          title: tx("Thông gió xuyên phòng", "Cross ventilation"),
          caption: tx(
            "Gió đi xuyên qua các mặt mở đối diện (diễn giải).",
            "Air crosses between opposite openings (interpretation).",
          ),
          annotations: [arrow([0.1, 0.55], [0.9, 0.55])],
          ideaOnly: true,
        },
    {
      key: "summary",
      title: tx("Tổng hợp vi khí hậu", "Microclimate summary"),
      caption: tx(
        "Tổng hợp nắng, gió và che chắn ở mức ý tưởng.",
        "Sun, air and shading summarised as an idea.",
      ),
      ideaOnly: true,
    },
  ];
}

function facadeMaterial(): Candidate[] {
  return [
    {
      key: "elevation",
      title: tx("Mặt đứng chính", "Main elevation"),
      caption: tx(
        "Bố cục tổng thể của mặt đứng chính.",
        "The overall composition of the main elevation.",
      ),
      facts: ["building.architecturalStyle", "building.massing.composition"],
      fallback: withElevation,
    },
    {
      key: "rhythm",
      title: tx("Nhịp cửa", "Opening rhythm"),
      caption: tx("Nhịp và tỷ lệ các ô cửa.", "The rhythm and proportion of the openings."),
      facts: ["building.openings.rhythm", "building.openings.windowType"],
      fallback: withElevation,
    },
    {
      key: "frames",
      title: tx("Khung cửa và kính", "Frames and glazing"),
      caption: tx("Loại khung và kính đã biết.", "The known frames and glazing."),
      facts: ["building.openings.frame", "building.openings.glazing"],
    },
    {
      key: "materials",
      title: tx("Lớp vật liệu chính", "Main material layers"),
      caption: tx(
        "Các vật liệu đã biết theo từng vùng mặt đứng.",
        "Known materials per facade zone.",
      ),
      facts: ["building.materials"],
    },
    {
      key: "palette",
      title: tx("Bảng màu", "Colour palette"),
      caption: tx("Bảng màu của công trình.", "The building's colour palette."),
      facts: ["building.colorPalette"],
    },
    {
      key: "roof_shading",
      title: tx("Mái và che nắng", "Roof and shading"),
      caption: tx("Mái, mái hắt và các lớp che nắng.", "Roof, eaves and shading layers."),
      facts: ["building.roof.type", "building.roof.overhang"],
    },
    {
      key: "details",
      title: tx("Chi tiết nhấn", "Accent details"),
      caption: tx("Các chi tiết kiến trúc đã đăng ký.", "The registered architectural details."),
      facts: ["architecturalDetails", "building.specialFeatures"],
    },
    {
      key: "final",
      title: tx("Mặt đứng hoàn chỉnh", "Complete facade"),
      caption: tx(
        "Mặt đứng với vật liệu và nhịp cửa đã biết.",
        "The facade with its known materials and openings.",
      ),
      facts: ["building.materials", "building.openings.rhythm"],
      all: true,
    },
  ];
}

function candidatesFor(type: DiagramType, family: DiagramFamily): Candidate[] {
  switch (type) {
    case "concept_evolution":
      return conceptEvolution(family);
    case "massing_voids":
      return massingVoids(family);
    case "functional_zoning":
      return functionalZoning(family);
    case "circulation":
      return circulation(family);
    case "sun_ventilation":
      return sunVentilation(family);
    case "facade_material":
      return facadeMaterial();
  }
}

/**
 * `count` candidates keeping the first and the last (the sequence must still start and end
 * the same way); evenly spaced in between. More than available inserts development steps
 * before the last one, which are always illustrative.
 */
function pick(list: readonly Candidate[], count: number): Candidate[] {
  if (count <= list.length) {
    return Array.from(
      { length: count },
      (_, i) => list[Math.round((i * (list.length - 1)) / (count - 1))]!,
    );
  }
  const extra = Array.from({ length: count - list.length }, (_, i): Candidate => ({
    key: `development_${i + 1}`,
    title: tx(`Bước phát triển ${i + 1}`, `Development step ${i + 1}`),
    caption: tx(
      "Bước trung gian do người thiết kế bổ sung.",
      "An intermediate step added by the designer.",
    ),
    ideaOnly: true,
  }));
  return [...list.slice(0, -1), ...extra, list[list.length - 1]!];
}

export function planDiagram(
  dna: ProjectDNA,
  type: DiagramType,
  stepCount: DiagramStepCount,
  options: PlanDiagramOptions = {},
): DiagramPlan {
  const count = parseDiagramStepCount(stepCount);
  const facts = readFacts(dna, options);
  const steps: DiagramStep[] = pick(candidatesFor(type, facts.family), count).map(
    (candidate, index) => {
      const { evidence, basis } = check(candidate, facts);
      return {
        id: `${type}.${candidate.key}`,
        index,
        title: candidate.title,
        caption: candidate.caption,
        evidence,
        annotations: candidate.annotations ?? [],
        interior: candidate.interior ?? false,
        basis,
        approved: false,
      };
    },
  );
  return DiagramPlanSchema.parse({
    version: 1,
    type,
    family: facts.family,
    interiorVerifiable: facts.spaces.length > 0,
    steps,
  });
}

// ---------------------------------------------------------------- editing

export type DiagramStepPatch = Partial<Pick<DiagramStep, "title" | "caption" | "evidence">>;

/** Evidence levels the user may choose for `step` (AC-14: no verified interior without facts). */
export function allowedDiagramEvidence(
  plan: Pick<DiagramPlan, "interiorVerifiable">,
  step: Pick<DiagramStep, "interior">,
): DiagramEvidence[] {
  return step.interior && !plan.interiorVerifiable
    ? ["inferred", "illustrative"]
    : ["verified", "inferred", "illustrative"];
}

/** Apply a user edit. Any change clears the approval; a forbidden evidence is refused. */
export function editDiagramStep(
  plan: DiagramPlan,
  stepId: string,
  patch: DiagramStepPatch,
): DiagramPlan {
  return {
    ...plan,
    steps: plan.steps.map((step) => {
      if (step.id !== stepId) return step;
      if (patch.evidence && !allowedDiagramEvidence(plan, step).includes(patch.evidence)) {
        throw new RangeError("An interior step cannot be verified without confirmed space facts.");
      }
      const next = { ...step, ...patch };
      const changed = JSON.stringify(next) !== JSON.stringify(step);
      return { ...next, approved: changed ? false : step.approved };
    }),
  };
}

export function approveDiagramStep(
  plan: DiagramPlan,
  stepId: string,
  approved = true,
): DiagramPlan {
  return {
    ...plan,
    steps: plan.steps.map((step) => (step.id === stepId ? { ...step, approved } : step)),
  };
}

/** Attach (or clear) a generated isometric frame. Changes the picture, so approval resets. */
export function setDiagramStepFrame(
  plan: DiagramPlan,
  stepId: string,
  frameAssetId: string | null,
): DiagramPlan {
  return {
    ...plan,
    steps: plan.steps.map((step) => {
      if (step.id !== stepId) return step;
      const { frameAssetId: previous, ...rest } = step;
      if ((previous ?? null) === frameAssetId) return step;
      return frameAssetId
        ? { ...rest, frameAssetId, approved: false }
        : { ...rest, approved: false };
    }),
  };
}

export const allDiagramStepsApproved = (plan: Pick<DiagramPlan, "steps">): boolean =>
  plan.steps.length > 0 && plan.steps.every((step) => step.approved);
