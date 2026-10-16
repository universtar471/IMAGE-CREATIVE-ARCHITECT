import type { ProjectDNA } from "../schemas/projectDna";
import { isConfirmed } from "../facts/evidence";
import {
  DiagramPlanSchema,
  parseDiagramStepCount,
  type DiagramAnnotation,
  type DiagramEvidence,
  type DiagramPlan,
  type DiagramStep,
  type DiagramStepCount,
  type DiagramType,
  type LocalizedText,
} from "./schemas";

const ILLUSTRATIVE_LABEL: LocalizedText = {
  vi: "sơ đồ diễn giải ý tưởng",
  en: "illustrative concept diagram",
};

type Candidate = {
  title: LocalizedText;
  caption: LocalizedText;
  verifiedWhen?: (dna: ProjectDNA) => boolean;
  inferredWhen?: (dna: ProjectDNA) => boolean;
  interiorFunction?: boolean;
  annotation?: DiagramAnnotation;
};

const text = (vi: string, en: string): LocalizedText => ({ vi, en });

const hasText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const hasDimensions = (dna: ProjectDNA) =>
  Object.values(dna.building.dimensions).some((value) => typeof value === "number" && Number.isFinite(value));

const hasVoids = (dna: ProjectDNA) => dna.building.massing.voids.length > 0 || dna.building.specialFeatures.length > 0;

const hasSiteEvidence = (dna: ProjectDNA) =>
  [dna.site?.front, dna.site?.left, dna.site?.right, dna.site?.rear].some(
    (boundary) => boundary !== undefined && isConfirmed(boundary.evidence),
  );

const hasSpaceEvidence = (dna: ProjectDNA) => {
  const extension = dna.spaceCatalog;
  const active = extension?.spaces.find((space) => space.id === extension.activeSpaceId);
  return !!active && Object.values(active.facts).some((fact) => isConfirmed(fact.evidence));
};

const archetype = (dna: ProjectDNA): string =>
  dna.spaceCatalog?.buildingArchetype.toLowerCase() || dna.building.buildingType.toLowerCase();

const family = (dna: ProjectDNA): "townhouse" | "villa" | "generic" => {
  const value = archetype(dna);
  if (value.includes("townhouse") || value.includes("nhà phố") || value.includes("nha pho")) return "townhouse";
  if (value.includes("villa") || value.includes("biệt thự") || value.includes("biet thu")) return "villa";
  return "generic";
};

const structuralCaption = (vi: string, en: string, verifiedWhen?: Candidate["verifiedWhen"]): Candidate => ({
  title: text(vi, en),
  caption: text(`Tập trung vào ${vi.toLowerCase()}.`, `Focus on ${en.toLowerCase()}.`),
  verifiedWhen,
});

function candidates(dna: ProjectDNA, type: DiagramType): Candidate[] {
  const townhouse = family(dna) === "townhouse";
  const villa = family(dna) === "villa";
  const site = hasSiteEvidence(dna);
  const spaces = hasSpaceEvidence(dna);
  const dims = hasDimensions(dna);
  const voids = hasVoids(dna);
  const floors = dna.building.floors !== undefined;
  const materials = dna.building.materials.length > 0 || dna.building.colorPalette.length > 0;
  const notes = hasText(dna.building.notes) || hasText(dna.context.atmosphereNotes);

  switch (type) {
    case "concept_evolution":
      return townhouse
        ? [
            structuralCaption("Khu đất và nhà liền kề", "Site and party walls", () => site),
            structuralCaption("Độ sâu và tổ chức theo tầng", "Depth and floor organisation", () => dims || floors),
            structuralCaption("Giếng trời và khoảng rỗng", "Light well and voids", () => voids),
            structuralCaption("Trục tiếp cận", "Approach axis", () => site),
            structuralCaption("Khối công trình", "Building mass", () => hasText(dna.building.massing.composition)),
            structuralCaption("Mặt đứng hoàn thiện", "Finished facade", () => materials),
          ]
        : villa
          ? [
              structuralCaption("Khu đất và lối tiếp cận", "Site and approach", () => site),
              structuralCaption("Chia khối chính và phụ", "Primary and secondary masses", () => hasText(dna.building.massing.composition)),
              structuralCaption("Khoảng sân vườn", "Garden void", () => hasText(dna.context.front.vegetation.join(" "))),
              structuralCaption("Kết nối trong - ngoài", "Indoor-outdoor connection", () => voids),
              structuralCaption("Trình tự không gian", "Spatial sequence", () => floors || dims),
              structuralCaption("Mặt đứng hoàn thiện", "Finished facade", () => materials),
            ]
          : [
              structuralCaption("Khu đất", "Site", () => site),
              structuralCaption("Khối chính", "Primary mass", () => hasText(dna.building.massing.mainVolume)),
              structuralCaption("Khoảng rỗng", "Voids", () => voids),
              structuralCaption("Lối tiếp cận", "Approach", () => site),
              structuralCaption("Tổ chức công trình", "Building organisation", () => floors || dims),
              structuralCaption("Mặt đứng", "Facade", () => materials),
            ];
    case "massing_voids":
      return [
        structuralCaption("Khối đặc ban đầu", "Initial solid mass", () => hasText(dna.building.massing.mainVolume)),
        structuralCaption("Tách khối", "Mass split", () => hasText(dna.building.massing.secondaryVolume)),
        structuralCaption("Khoảng rỗng", "Voids", () => voids),
        structuralCaption("Mái và phần nhô", "Roof and cantilever", () => hasText(dna.building.roof.type) || hasText(dna.building.massing.cantilever)),
        structuralCaption("Tỷ lệ công trình", "Building proportions", () => dims),
        structuralCaption("Khối hoàn thiện", "Final massing", () => notes),
      ];
    case "functional_zoning":
      return [
        { title: text("Vùng tiếp cận", "Arrival zone"), caption: text("Định vị vùng tiếp cận theo dữ liệu đã chọn.", "Place the arrival zone from the selected facts."), verifiedWhen: () => site },
        { title: text("Vùng sinh hoạt", "Living zone"), caption: text("Chỉ hiển thị theo mặt bằng hoặc bằng chứng được duyệt.", "Show only when a plan or approved evidence supports it."), verifiedWhen: () => spaces, interiorFunction: true },
        { title: text("Vùng riêng tư", "Private zone"), caption: text("Không suy đoán công năng phía sau mặt tiền.", "Do not infer hidden functions from a facade."), verifiedWhen: () => spaces, interiorFunction: true },
        { title: text("Vùng phục vụ", "Service zone"), caption: text("Giữ nhãn ở mức ý tưởng nếu chưa có bằng chứng.", "Keep this as an idea when evidence is missing."), verifiedWhen: () => spaces, interiorFunction: true },
        { title: text("Trục kết nối", "Connection spine"), caption: text("Mô tả quan hệ giữa các vùng, không dựng mặt bằng mới.", "Describe relationships without inventing a floor plan."), inferredWhen: () => floors || dims },
        { title: text("Sơ đồ phân khu", "Zoning diagram"), caption: text("Tổng hợp các vùng đã được xác minh.", "Summarise the zones that are supported."), verifiedWhen: () => spaces },
      ];
    case "circulation":
      return [
        structuralCaption("Điểm vào", "Entry point", () => site),
        structuralCaption("Hướng tiếp cận", "Approach direction", () => site),
        structuralCaption("Trục chính", "Primary route", () => floors || dims),
        structuralCaption("Nút giao thông", "Circulation node", () => voids),
        structuralCaption("Liên hệ trong - ngoài", "Indoor-outdoor link", () => spaces || voids),
        structuralCaption("Luồng hoàn chỉnh", "Complete flow", () => notes),
      ];
    case "sun_ventilation":
      return [
        structuralCaption("Hướng nắng", "Solar orientation", () => hasText(dna.lighting?.sunDirection)),
        structuralCaption("Mặt thoáng", "Open side", () => site),
        structuralCaption("Khoảng rỗng", "Ventilation void", () => voids),
        structuralCaption("Đường gió ý tưởng", "Illustrative airflow", undefined),
        structuralCaption("Cửa mở", "Openings", () => hasText(dna.building.openings.windowType)),
        structuralCaption("Tổng hợp vi khí hậu", "Microclimate summary", () => notes),
      ];
    case "facade_material":
      return [
        structuralCaption("Mặt đứng chính", "Primary facade", () => hasText(dna.building.buildingType)),
        structuralCaption("Nhịp cửa", "Opening rhythm", () => hasText(dna.building.openings.rhythm)),
        structuralCaption("Lớp vật liệu", "Material layers", () => materials),
        structuralCaption("Mái và che nắng", "Roof and shading", () => hasText(dna.building.roof.type)),
        structuralCaption("Chi tiết nhấn", "Accent detail", () => dna.building.specialFeatures.length > 0),
        structuralCaption("Mặt đứng hoàn chỉnh", "Complete facade", () => materials && hasText(dna.building.buildingType)),
      ];
  }
}

function evidenceFor(dna: ProjectDNA, candidate: Candidate): DiagramEvidence {
  if (candidate.interiorFunction && !hasSpaceEvidence(dna)) return "illustrative";
  if (candidate.verifiedWhen?.(dna)) return "verified";
  if (candidate.inferredWhen?.(dna)) return "inferred";
  return "illustrative";
}

function withEvidenceLabel(textValue: LocalizedText, evidence: DiagramEvidence): LocalizedText {
  if (evidence === "verified") return textValue;
  return {
    vi: `${textValue.vi} · ${ILLUSTRATIVE_LABEL.vi}`,
    en: `${textValue.en} · ${ILLUSTRATIVE_LABEL.en}`,
  };
}

function defaultAnnotation(index: number, label: LocalizedText): DiagramAnnotation {
  const x = 0.22 + (index % 3) * 0.28;
  const y = 0.24 + Math.floor(index / 3) * 0.28;
  return { kind: "label", label, position: { x, y } };
}

export function planDiagram(dna: ProjectDNA, type: DiagramType, stepCount: DiagramStepCount): DiagramPlan {
  const count = parseDiagramStepCount(stepCount);
  const source = candidates(dna, type);
  const steps: DiagramStep[] = Array.from({ length: count }, (_, index) => {
    const candidate = source[index % source.length]!;
    const evidence = evidenceFor(dna, candidate);
    const title = withEvidenceLabel(candidate.title, evidence);
    return {
      id: `diagram-${type}-${index + 1}`,
      index,
      title,
      caption: withEvidenceLabel(candidate.caption, evidence),
      evidence,
      annotations: [candidate.annotation ?? defaultAnnotation(index, title)],
    };
  });
  return DiagramPlanSchema.parse({ type, steps });
}
