import { create } from "zustand";
import type { SheetKind } from "./sheets";

export type SheetDraft = {
  mode: "ai" | "layout";
  sourceId: string | null;
  presetId: string;
  note: string;
  generationId: string | null;
  imageSize?: string | null;
};
export const EMPTY_SHEET: SheetDraft = {
  mode: "ai",
  sourceId: null,
  presetId: "",
  note: "",
  generationId: null,
};
const key = (projectId: string, kind: SheetKind) => `${projectId}:${kind}`;
export const useSheetStudio = create<{
  drafts: Record<string, SheetDraft>;
  update: (projectId: string, kind: SheetKind, patch: Partial<SheetDraft>) => void;
}>((set) => ({
  drafts: {},
  update: (projectId, kind, patch) =>
    set((s) => ({
      drafts: {
        ...s.drafts,
        [key(projectId, kind)]: { ...(s.drafts[key(projectId, kind)] ?? EMPTY_SHEET), ...patch },
      },
    })),
}));
export const sheetDraftOf = (projectId: string, kind: SheetKind) =>
  useSheetStudio.getState().drafts[key(projectId, kind)] ?? EMPTY_SHEET;
export function useSheetDraft(projectId: string, kind: SheetKind) {
  return useSheetStudio((s) => s.drafts[key(projectId, kind)] ?? EMPTY_SHEET);
}
