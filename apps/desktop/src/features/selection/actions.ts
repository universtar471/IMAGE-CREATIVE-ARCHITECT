/**
 * Action registry of the contextual toolbar (UX V6.1, ADR-044). One table says which actions a
 * selection offers, why one is disabled and what it does, instead of conditions scattered
 * through JSX. Every action maps to a function the app already has; nothing here spends
 * credit except Retry, which goes through the usual spend confirm in `env.retryGeneration`.
 */
import {
  Camera,
  Clapperboard,
  Columns2,
  Copy,
  ImagePlus,
  Images,
  Link2,
  Maximize2,
  Palette,
  PencilLine,
  Play,
  RefreshCw,
  Repeat,
  ScanLine,
  ScanSearch,
  Sparkles,
  SquareArrowUp,
  Tag,
  Wand2,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { AssetDTO, GenerationDTO } from "@arch/domain";
import type { TKey } from "../../i18n";
import type { ModuleId } from "../workspace/modules";
import type { Selection, WorkspaceMode } from "./selection";

export type ActionRisk = "view" | "draft" | "paid";

/** What actions may do; built from the store by `useSelectionActions`. */
export type ActionEnv = {
  setModule: (id: ModuleId) => void;
  setMode: (mode: WorkspaceMode) => void;
  /** Select an asset without leaving the current view; in Node mode also its node. */
  focusAsset: (assetId: string) => void;
  /** Make the asset the hero source of the Generate draft (as "Use as source" did). */
  useAsSource: (assetId: string, variation?: boolean) => void;
  toggleDraftReference: (assetId: string, include: boolean) => void;
  showLibrary: () => void;
  importImages: () => void;
  openViewer: (assetId: string, options?: { compareWithId?: string }) => void;
  openAnalysis: (asset: AssetDTO) => void;
  copyPrompt: (generation: GenerationDTO) => void;
  reusePresets: (presetIds: readonly string[]) => void;
  cancelJob: (jobId: string) => void;
  retryGeneration: (generation: GenerationDTO) => Promise<void>;
  clearSelection: () => void;
};

export type SelectionAction = {
  id: string;
  labelKey: TKey;
  /** Label that depends on the selection (e.g. include / stop using a reference). */
  labelFor?: (selection: Selection) => TKey;
  icon: LucideIcon;
  risk: ActionRisk;
  applies: (selection: Selection) => boolean;
  /** Reason key when shown but not usable now. */
  disabledReason?: (selection: Selection) => TKey | null;
  run: (selection: Selection, env: ActionEnv) => void | Promise<void>;
};

const isImageLike = (s: Selection) => s.kind === "image" && s.origin !== "ai";
const anyImage = (s: Selection) => s.kind === "image";
const assetOf = (s: Selection) =>
  s.kind === "image" || s.kind === "video" || s.kind === "reference" ? s.asset : null;
const writable = (s: Selection): TKey | null =>
  s.readOnly ? "selectionActions.reason.readOnly" : null;

/** Images of a multi-selection; clips never count as comparable images. */
function compareCandidates(s: Selection) {
  if (s.kind !== "multi") return { images: [], hasClip: false };
  const images = s.items.filter((i) => i.kind === "image" || i.kind === "reference");
  return { images, hasClip: s.items.some((i) => i.kind === "video") };
}

export const SELECTION_ACTIONS: readonly SelectionAction[] = [
  // ------------------------------------------------------------------ nothing selected
  {
    id: "add_image",
    labelKey: "selectionActions.addImage",
    icon: ImagePlus,
    risk: "draft",
    applies: (s) => s.kind === "none",
    disabledReason: writable,
    run: (_s, env) => env.importImages(),
  },
  {
    id: "open_generate",
    labelKey: "selectionActions.createImage",
    icon: Sparkles,
    risk: "view",
    applies: (s) => s.kind === "none",
    run: (_s, env) => {
      env.setMode("studio");
      env.setModule("generate");
    },
  },
  {
    id: "open_library",
    labelKey: "selectionActions.library",
    icon: Images,
    risk: "view",
    applies: (s) => s.kind === "none",
    run: (_s, env) => env.showLibrary(),
  },
  // ------------------------------------------------------------------ source / imported image
  {
    id: "create_from_source",
    labelKey: "selectionActions.createImage",
    icon: Sparkles,
    risk: "draft",
    applies: isImageLike,
    disabledReason: writable,
    run: (s, env) => {
      const asset = assetOf(s)!;
      env.useAsSource(asset.id);
      env.setModule("generate");
    },
  },
  {
    id: "references",
    labelKey: "selectionActions.references",
    icon: Link2,
    risk: "view",
    applies: isImageLike,
    run: (s, env) => {
      env.focusAsset(assetOf(s)!.id);
      env.setModule("references");
    },
  },
  {
    id: "camera",
    labelKey: "selectionActions.camera",
    icon: Camera,
    risk: "view",
    applies: isImageLike,
    run: (_s, env) => env.setModule("camera"),
  },
  // ------------------------------------------------------------------ AI image
  {
    id: "continue_from_ai",
    labelKey: "selectionActions.variation",
    icon: Sparkles,
    risk: "draft",
    applies: anyImage,
    disabledReason: writable,
    run: (s, env) => {
      env.useAsSource(assetOf(s)!.id, true);
      env.setModule("generate");
    },
  },
  {
    id: "detail",
    labelKey: "selectionActions.detail",
    icon: ScanLine,
    risk: "view",
    applies: anyImage,
    run: (s, env) => {
      env.focusAsset(assetOf(s)!.id);
      env.setModule("detail");
    },
  },
  {
    id: "grade",
    labelKey: "selectionActions.grade",
    icon: Palette,
    risk: "view",
    applies: anyImage,
    run: (s, env) => {
      env.focusAsset(assetOf(s)!.id);
      env.setModule("mood_grade");
    },
  },
  {
    id: "enhance",
    labelKey: "selectionActions.enhance",
    icon: Wand2,
    risk: "view",
    applies: anyImage,
    run: (s, env) => {
      env.focusAsset(assetOf(s)!.id);
      env.setModule("enhance");
    },
  },
  {
    id: "make_video",
    labelKey: "selectionActions.makeVideo",
    icon: Clapperboard,
    risk: "view",
    applies: anyImage,
    run: (s, env) => {
      env.focusAsset(assetOf(s)!.id);
      env.setModule("video");
    },
  },
  // ------------------------------------------------------------------ reference image
  {
    id: "reference_role",
    labelKey: "selectionActions.role",
    icon: Tag,
    risk: "view",
    applies: (s) => s.kind === "reference",
    run: (s, env) => {
      env.focusAsset(assetOf(s)!.id);
      env.setModule("references");
    },
  },
  {
    id: "toggle_reference",
    labelKey: "selectionActions.includeReference",
    labelFor: (s) =>
      s.kind === "reference" && s.inDraft
        ? "selectionActions.excludeReference"
        : "selectionActions.includeReference",
    icon: Link2,
    risk: "draft",
    applies: (s) => s.kind === "reference",
    disabledReason: writable,
    run: (s, env) => {
      if (s.kind === "reference") env.toggleDraftReference(s.asset.id, !s.inDraft);
    },
  },
  // ------------------------------------------------------------------ video clip
  {
    id: "play",
    labelKey: "selectionActions.play",
    icon: Play,
    risk: "view",
    applies: (s) => s.kind === "video",
    run: (s, env) => env.openViewer(assetOf(s)!.id),
  },
  {
    id: "view_source",
    labelKey: "selectionActions.viewSource",
    icon: SquareArrowUp,
    risk: "view",
    applies: (s) => s.kind === "video",
    disabledReason: (s) =>
      s.kind === "video" && !s.asset.parentAssetId ? "selectionActions.reason.noSource" : null,
    run: (s, env) => {
      if (s.kind === "video" && s.asset.parentAssetId) env.focusAsset(s.asset.parentAssetId);
    },
  },
  {
    id: "remake_video",
    labelKey: "selectionActions.remakeVideo",
    icon: RefreshCw,
    risk: "view",
    applies: (s) => s.kind === "video",
    disabledReason: (s) =>
      s.kind === "video" && !s.asset.parentAssetId ? "selectionActions.reason.noSource" : null,
    run: (s, env) => {
      if (s.kind !== "video" || !s.asset.parentAssetId) return;
      env.focusAsset(s.asset.parentAssetId);
      env.setModule("video");
    },
  },
  // ------------------------------------------------------------------ any single image or clip
  {
    id: "expand",
    labelKey: "selectionActions.expand",
    icon: Maximize2,
    risk: "view",
    applies: (s) => s.kind === "image" || s.kind === "reference",
    run: (s, env) => env.openViewer(assetOf(s)!.id),
  },
  {
    id: "analyse",
    labelKey: "analysis.open",
    icon: ScanSearch,
    risk: "draft",
    applies: anyImage,
    disabledReason: writable,
    run: (s, env) => env.openAnalysis(assetOf(s)!),
  },
  // ------------------------------------------------------------------ generation / job
  {
    id: "show_outputs",
    labelKey: "selectionActions.outputs",
    icon: Images,
    risk: "view",
    applies: (s) => s.kind === "generation" && s.phase === "complete",
    disabledReason: (s) =>
      s.kind === "generation" && s.generation.outputAssetIds.length === 0
        ? "selectionActions.reason.noOutputs"
        : null,
    run: (s, env) => {
      const first = s.kind === "generation" ? s.generation.outputAssetIds[0] : undefined;
      if (first) env.focusAsset(first);
    },
  },
  {
    id: "copy_prompt",
    labelKey: "branches.copyPrompt",
    icon: Copy,
    risk: "view",
    applies: (s) => s.kind === "generation",
    run: (s, env) => {
      if (s.kind === "generation") env.copyPrompt(s.generation);
    },
  },
  {
    id: "reuse_presets",
    labelKey: "branches.reusePresets",
    icon: Repeat,
    risk: "draft",
    applies: (s) => s.kind === "generation",
    disabledReason: (s) =>
      s.readOnly
        ? "selectionActions.reason.readOnly"
        : s.kind === "generation" && !(s.generation.prompt.shotIntent?.presetIds ?? []).length
          ? "selectionActions.reason.noPresets"
          : null,
    run: (s, env) => {
      if (s.kind === "generation")
        env.reusePresets(s.generation.prompt.shotIntent?.presetIds ?? []);
    },
  },
  {
    id: "cancel_job",
    labelKey: "selectionActions.cancelJob",
    icon: XCircle,
    risk: "draft",
    applies: (s) => s.kind === "generation" && s.phase === "pending" && !!s.generation.jobId,
    disabledReason: writable,
    run: (s, env) => {
      if (s.kind === "generation" && s.generation.jobId) env.cancelJob(s.generation.jobId);
    },
  },
  {
    id: "retry",
    labelKey: "branches.retry",
    icon: RefreshCw,
    risk: "paid",
    applies: (s) =>
      s.kind === "generation" &&
      (s.generation.status === "cancelled" ||
        (s.generation.status === "failed" && !!s.generation.error?.retryable)),
    disabledReason: writable,
    run: (s, env) => (s.kind === "generation" ? env.retryGeneration(s.generation) : undefined),
  },
  // ------------------------------------------------------------------ draft
  {
    id: "edit_draft",
    labelKey: "selectionActions.editDraft",
    icon: PencilLine,
    risk: "view",
    applies: (s) => s.kind === "draft",
    run: (s, env) => {
      env.setMode("studio");
      env.setModule(s.kind === "draft" && s.purpose === "video" ? "video" : "generate");
    },
  },
  // ------------------------------------------------------------------ several nodes
  {
    id: "compare",
    labelKey: "branches.compare",
    icon: Columns2,
    risk: "view",
    applies: (s) => s.kind === "multi",
    disabledReason: (s) => {
      const { images, hasClip } = compareCandidates(s);
      if (hasClip) return "selectionActions.reason.compareImagesOnly";
      return images.length === 2 ? null : "selectionActions.reason.compareTwo";
    },
    run: (s, env) => {
      const { images } = compareCandidates(s);
      const [a, b] = images.map((i) =>
        i.kind === "image" || i.kind === "reference" ? i.asset.id : "",
      );
      if (a && b) env.openViewer(b, { compareWithId: a });
    },
  },
  {
    id: "clear_selection",
    labelKey: "selectionActions.clear",
    icon: X,
    risk: "view",
    applies: (s) => s.kind === "multi",
    run: (_s, env) => env.clearSelection(),
  },
];

export type ResolvedAction = { action: SelectionAction; disabledReason: TKey | null };

/** The actions a selection offers, in registry order, with their disabled reasons. */
export function actionsFor(selection: Selection): ResolvedAction[] {
  return SELECTION_ACTIONS.filter((a) => a.applies(selection)).map((action) => ({
    action,
    disabledReason: action.disabledReason?.(selection) ?? null,
  }));
}

/** Splits into toolbar buttons and the `…` menu. */
export function splitActions(actions: ResolvedAction[], visible: number) {
  return { shown: actions.slice(0, visible), more: actions.slice(visible) };
}
