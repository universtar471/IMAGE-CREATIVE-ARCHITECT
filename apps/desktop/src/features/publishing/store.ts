/**
 * Publishing Studio state: the settings, the planned book being edited, its facts, the
 * selection in the page editor and the stored records (`publication_*` commands).
 * One book is open at a time per project; switching project resets the studio.
 */
import { create } from "zustand";
import {
  randomize,
  type AssetDTO,
  type ConflictCode,
  type Publication,
  type PublicationFact,
  type PublicationSummaryDTO,
  type RandomizeLevel,
} from "@arch/domain";
import { call } from "../../lib/bridge";
import {
  defaultSettings,
  nextFactId,
  planFromSettings,
  settingsOf,
  toggleLock,
  type PublishingSettings,
} from "./publishing";

type PublishingState = {
  projectId: string | null;
  settings: PublishingSettings;
  publication: Publication | null;
  facts: PublicationFact[];
  /** Id of the stored record being edited; null for a book that was never saved. */
  recordId: string | null;
  dirty: boolean;
  /** Settings changed since the last plan (re-planning is always the user's choice). */
  planStale: boolean;
  acceptedWarnings: ConflictCode[];
  selectedPageId: string | null;
  selectedSlotId: string | null;
  records: PublicationSummaryDTO[];
  busy: boolean;

  open: (projectId: string, assets: readonly AssetDTO[], title: string) => void;
  setSettings: (patch: Partial<PublishingSettings>) => void;
  plan: (assets: readonly AssetDTO[]) => void;
  randomize: (level: RandomizeLevel, seed: number) => void;
  update: (publication: Publication) => void;
  toggleLock: (pageId: string) => void;
  select: (pageId: string | null, slotId?: string | null) => void;
  addFact: (text: string) => void;
  removeFact: (id: string) => void;
  acceptWarnings: (codes: readonly ConflictCode[]) => void;
  newBook: (assets: readonly AssetDTO[], title: string) => void;
  loadRecords: () => Promise<void>;
  saveRecord: () => Promise<void>;
  openRecord: (id: string) => Promise<void>;
  deleteRecord: (id: string) => Promise<void>;
};

const blank = (assets: readonly AssetDTO[], title: string) => ({
  settings: defaultSettings(assets, title),
  publication: null,
  facts: [],
  recordId: null,
  dirty: false,
  planStale: false,
  acceptedWarnings: [],
  selectedPageId: null,
  selectedSlotId: null,
});

export const usePublishing = create<PublishingState>((set, get) => ({
  projectId: null,
  ...blank([], ""),
  records: [],
  busy: false,

  open: (projectId, assets, title) => {
    if (get().projectId === projectId) return;
    set({ projectId, records: [], ...blank(assets, title) });
    void get().loadRecords();
  },

  setSettings: (patch) =>
    set((s) => ({ settings: { ...s.settings, ...patch }, planStale: s.publication !== null })),

  plan: (assets) => {
    const publication = planFromSettings(get().settings, assets);
    set({
      publication,
      dirty: true,
      planStale: false,
      acceptedWarnings: [],
      selectedPageId: publication.pages[0]?.id ?? null,
      selectedSlotId: null,
    });
  },

  randomize: (level, seed) => {
    const current = get().publication;
    if (!current) return;
    const publication = randomize(current, level, seed);
    set((s) => ({
      publication,
      dirty: true,
      settings: { ...s.settings, seed, styleId: publication.styleId },
    }));
  },

  update: (publication) => set({ publication, dirty: true }),

  toggleLock: (pageId) => {
    const current = get().publication;
    if (current) set({ publication: toggleLock(current, pageId), dirty: true });
  },

  select: (pageId, slotId = null) => set({ selectedPageId: pageId, selectedSlotId: slotId }),

  addFact: (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    set((s) => ({
      facts: [
        ...s.facts,
        { id: nextFactId(s.facts), text: trimmed, status: "user_declared", sourceAssetIds: [] },
      ],
      dirty: true,
    }));
  },

  removeFact: (id) =>
    set((s) => ({ facts: s.facts.filter((fact) => fact.id !== id), dirty: true })),

  acceptWarnings: (codes) =>
    set((s) => ({ acceptedWarnings: [...new Set([...s.acceptedWarnings, ...codes])] })),

  newBook: (assets, title) => set(blank(assets, title)),

  loadRecords: async () => {
    const projectId = get().projectId;
    if (!projectId) return;
    const records = await call("publication_list", { projectId });
    if (get().projectId === projectId) set({ records });
  },

  saveRecord: async () => {
    const { projectId, publication, facts, recordId } = get();
    if (!projectId || !publication) return;
    set({ busy: true });
    try {
      const saved = await call("publication_save", {
        projectId,
        publicationId: recordId,
        publication,
        facts,
      });
      if (get().projectId !== projectId) return;
      // Edits made while saving stay unsaved.
      set((s) => ({
        recordId: saved.id,
        dirty: s.publication !== publication || s.facts !== facts,
      }));
      await get().loadRecords();
    } finally {
      set({ busy: false });
    }
  },

  openRecord: async (id) => {
    const projectId = get().projectId;
    if (!projectId) return;
    set({ busy: true });
    try {
      const record = await call("publication_get", { projectId, publicationId: id });
      if (get().projectId !== projectId) return;
      set({
        publication: record.publication,
        facts: record.facts,
        recordId: record.id,
        settings: settingsOf(record.publication),
        dirty: false,
        planStale: false,
        acceptedWarnings: [],
        selectedPageId: record.publication.pages[0]?.id ?? null,
        selectedSlotId: null,
      });
    } finally {
      set({ busy: false });
    }
  },

  deleteRecord: async (id) => {
    const projectId = get().projectId;
    if (!projectId) return;
    await call("publication_delete", { projectId, publicationId: id });
    if (get().recordId === id) set({ recordId: null, dirty: get().publication !== null });
    await get().loadRecords();
  },
}));
