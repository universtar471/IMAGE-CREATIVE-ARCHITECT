import { findPhrases, prepareText, type PhraseSet } from "../validation/phrases";
import { ALL_PRESERVE, type InteriorGenerationState, type PreserveKey } from "./schema";

export type GenerationConflict = {
  lock: PreserveKey;
  source: "instruction" | "camera" | "reference";
  clause?: string;
  attribute?: "layout" | "materials" | "colors";
};
const change =
  "(?:doi|thay|thay the|thay doi|bo|xoa|them|di chuyen|dich chuyen|sap xep lai|change|replace|remove|add|move|relocate|rearrange|redesign)";
const bridge = "(?: [\\p{L}\\p{N}'-]+){0,5} ";
const SETS: Record<PreserveKey, PhraseSet> = {
  furniture: {
    folded: [
      `${change}${bridge}(?:sofa|ghe|ban(?! (?:dem|ngay|dau|ve|than))|giuong|tu(?! (?:nhien|dong|do|cua so))|noi that|furniture|chair|table|bed|cabinet|shelving)`,
      "(?:reupholster|boc lai) (?:the )?(?:sofa|ghe|chair)",
    ],
  },
  layout: {
    folded: [
      `${change}${bridge}(?:bo cuc|layout|circulation|mat bang|vi tri|sap xep)`,
      "(?:move|relocate|di chuyen|dich chuyen|sap xep lai)(?: the)? (?:sofa|furniture|noi that|giuong|bed|ghe|ban)",
    ],
  },
  architecture: {
    folded: [
      `${change}(?! (?:mau|vat lieu|color|colour|materials?|finishes?)(?: |$))${bridge}(?:tuong|cot|cua so|cua di|cau thang|wall|column|window|door|staircase|room proportions|kien truc)(?! (?:colors?|colours?|materials?|finishes?|paint)(?: |$))`,
      "(?:pha|demolish|mo rong|enlarge)(?: the)? (?:tuong|wall|cua so|window|phong|room)",
    ],
  },
  camera: {
    folded: [
      `${change}${bridge}(?:camera|goc may|goc nhin|goc chup|perspective|viewpoint|framing|horizon)`,
      "(?:zoom|crop|cat cup|fisheye)",
    ],
  },
  materials: {
    folded: [
      `${change}${bridge}(?:vat lieu|material|materials|mau|color|colour|colors|colours|leather|vai boc|sofa da|go|wood|marble|stone)`,
      "(?:repaint|recolor|recolour|son lai|doi mau|thay vat lieu)",
    ],
  },
};

export function effectiveGenerationPreserve(state: InteriorGenerationState) {
  return state.changeLevel === 0 ? { ...ALL_PRESERVE } : state.preserve;
}
export function resolveGenerationConflicts(state: InteriorGenerationState): GenerationConflict[] {
  const locks = effectiveGenerationPreserve(state);
  const conflicts: GenerationConflict[] = [];
  const clauses = state.instruction.match(/[^.!?;\n]+[.!?;\n]?/gu) ?? [];
  for (const clause of clauses)
    for (const lock of Object.keys(SETS) as PreserveKey[]) {
      if (locks[lock] && findPhrases(prepareText(clause), SETS[lock]).length)
        conflicts.push({ lock, source: "instruction", clause });
    }
  if (locks.camera && state.camera.mode !== "original")
    conflicts.push({ lock: "camera", source: "camera" });
  if (state.reference?.attributes.layout) {
    if (locks.layout) conflicts.push({ lock: "layout", source: "reference", attribute: "layout" });
    else if (locks.furniture)
      conflicts.push({ lock: "furniture", source: "reference", attribute: "layout" });
  }
  for (const attribute of ["materials", "colors"] as const) {
    if (locks.materials && state.reference?.attributes[attribute])
      conflicts.push({ lock: "materials", source: "reference", attribute });
  }
  return conflicts;
}
/** Explicit "Keep lock": remove only the offending request, after showing it to the user. */
export function keepGenerationLock(
  state: InteriorGenerationState,
  conflict: GenerationConflict,
): InteriorGenerationState {
  if (conflict.source === "instruction")
    return { ...state, instruction: state.instruction.replace(conflict.clause ?? "", "").trim() };
  if (conflict.source === "camera") return { ...state, camera: { mode: "original" } };
  return {
    ...state,
    reference: state.reference
      ? {
          ...state.reference,
          attributes: {
            ...state.reference.attributes,
            [conflict.attribute ?? conflict.lock]: false,
          },
        }
      : null,
  };
}
export class GenerationLockConflictError extends Error {
  constructor(public conflicts: GenerationConflict[]) {
    super("Resolve interior preservation conflicts before generating.");
    this.name = "GenerationLockConflictError";
  }
}
