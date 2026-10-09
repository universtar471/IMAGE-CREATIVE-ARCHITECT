import { useState } from "react";
import { Check, Loader2, Undo2, Wand2, X } from "lucide-react";
import { compilePromptPreview } from "../../app/services";
import { selectReadOnly, useStudio } from "../../app/store";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { call, toBridgeError } from "../../lib/bridge";
import {
  ENHANCE_PROVIDER_ID,
  MAX_EXTRA_PROMPT_CHARS,
  enhanceContext,
  enhanceDisabledReason,
} from "./extraPrompt";

type Enhance =
  | { status: "idle" }
  | { status: "running" }
  | { status: "preview"; text: string }
  | { status: "error"; message: string };

/**
 * The user's own text, appended to the DNA-compiled positive prompt at submit. "Enhance
 * prompt" asks HHTECH's chat model for a more specific rewrite (DNA facts kept), shown as a
 * preview to Accept or Discard; Accept can be undone.
 */
export function ExtraPromptSection({
  referenceIds,
  disabled,
}: {
  referenceIds: readonly string[];
  disabled: boolean;
}) {
  const projectId = useStudio((s) => s.workspace!.project.id);
  const text = useStudio((s) => s.generateDraft.extraPrompt ?? "");
  const setDraft = useStudio((s) => s.setGenerateDraft);
  const providers = useStudio((s) => s.providers ?? []);
  const flushDna = useStudio((s) => s.flushDna);
  const readOnly = useStudio(selectReadOnly);
  const [enhance, setEnhance] = useState<Enhance>({ status: "idle" });
  /** Text before the last Accept, for Undo. */
  const [undo, setUndo] = useState<string | null>(null);

  const reason = enhanceDisabledReason(providers, text, {
    readOnly,
    busy: enhance.status === "running",
  });

  const setText = (value: string) => {
    setDraft({ extraPrompt: value });
    setUndo(null);
  };

  const run = async () => {
    setEnhance({ status: "running" });
    try {
      await flushDna();
      const bundle = await compilePromptPreview(projectId, referenceIds);
      const result = await call("prompt_enhance", {
        projectId,
        providerId: ENHANCE_PROVIDER_ID,
        text: text.trim(),
        context: enhanceContext(bundle),
      });
      setEnhance({ status: "preview", text: result.text });
    } catch (e) {
      setEnhance({ status: "error", message: toBridgeError(e).message });
    }
  };

  const accept = (enhanced: string) => {
    setUndo(text);
    setDraft({ extraPrompt: enhanced });
    setEnhance({ status: "idle" });
  };

  return (
    <SectionPanel title="Extra prompt">
      <div className="field">
        <label className="field-label" htmlFor="extra-prompt">
          Your words (added after the DNA prompt)
        </label>
        <textarea
          id="extra-prompt"
          className="textarea"
          rows={3}
          maxLength={MAX_EXTRA_PROMPT_CHARS}
          value={text}
          disabled={disabled || readOnly || enhance.status === "running"}
          placeholder="e.g. late afternoon, wet street reflections, view from across the road"
          onChange={(e) => setText(e.target.value)}
          data-testid="extra-prompt"
        />
      </div>
      <div className="extra-prompt-actions">
        {/* A disabled button gets no hover events; the wrapper carries the tooltip. */}
        <span
          title={reason ?? "Rewrite with more specific materials, light, camera and atmosphere"}
        >
          <button
            className="btn btn-sm"
            disabled={reason !== null || disabled}
            onClick={() => void run()}
            data-testid="enhance-button"
          >
            {enhance.status === "running" ? (
              <Loader2 size={13} className="spin" aria-label="Enhancing" />
            ) : (
              <Wand2 size={13} />
            )}
            Enhance prompt
          </button>
        </span>
        {undo !== null && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setDraft({ extraPrompt: undo });
              setUndo(null);
            }}
            data-testid="enhance-undo"
          >
            <Undo2 size={13} /> Undo enhance
          </button>
        )}
      </div>
      {enhance.status === "preview" && (
        <div className="callout enhance-preview" data-testid="enhance-preview">
          <pre>{enhance.text}</pre>
          <div className="extra-prompt-actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={() => accept(enhance.text)}
              data-testid="enhance-accept"
            >
              <Check size={13} /> Accept
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setEnhance({ status: "idle" })}
              data-testid="enhance-discard"
            >
              <X size={13} /> Discard
            </button>
          </div>
        </div>
      )}
      {enhance.status === "error" && (
        <div className="callout callout-error" role="alert">
          <span>{enhance.message}</span>
        </div>
      )}
    </SectionPanel>
  );
}
