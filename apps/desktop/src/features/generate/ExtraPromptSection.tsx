import { useState } from "react";
import { Check, Loader2, Undo2, Wand2, X } from "lucide-react";
import { compilePromptPreview } from "../../app/services";
import { selectReadOnly, useStudio } from "../../app/store";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { call, toBridgeError } from "../../lib/bridge";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { useT } from "../../i18n";
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
  | { status: "error"; code: string; details?: unknown; message: string };

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
  const t = useT();

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
      const err = toBridgeError(e);
      setEnhance({ status: "error", code: err.code, details: err.details, message: err.message });
    }
  };

  const accept = (enhanced: string) => {
    setUndo(text);
    setDraft({ extraPrompt: enhanced });
    setEnhance({ status: "idle" });
  };

  return (
    <SectionPanel title={t("extra.title")}>
      <div className="field">
        <label className="field-label" htmlFor="extra-prompt">
          {t("extra.label")}
        </label>
        <textarea
          id="extra-prompt"
          className="textarea"
          rows={3}
          maxLength={MAX_EXTRA_PROMPT_CHARS}
          value={text}
          disabled={disabled || readOnly || enhance.status === "running"}
          placeholder={t("extra.placeholder")}
          onChange={(e) => setText(e.target.value)}
          data-testid="extra-prompt"
        />
        <span className="field-hint">{t("extra.hint")}</span>
      </div>
      <div className="extra-prompt-actions">
        {/* A disabled button gets no hover events; the wrapper carries the tooltip. */}
        <span title={reason ?? t("extra.enhanceTitle")}>
          <button
            className="btn btn-sm"
            disabled={reason !== null || disabled}
            onClick={() => void run()}
            data-testid="enhance-button"
          >
            {enhance.status === "running" ? (
              <Loader2 size={13} className="spin" aria-label={t("extra.enhancing")} />
            ) : (
              <Wand2 size={13} />
            )}
            {t("extra.enhance")}
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
            <Undo2 size={13} /> {t("extra.undo")}
          </button>
        )}
      </div>
      {enhance.status === "preview" && (
        <div className="callout enhance-preview" data-testid="enhance-preview">
          <pre lang="en">{enhance.text}</pre>
          <div className="extra-prompt-actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={() => accept(enhance.text)}
              data-testid="enhance-accept"
            >
              <Check size={13} /> {t("common.accept")}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setEnhance({ status: "idle" })}
              data-testid="enhance-discard"
            >
              <X size={13} /> {t("common.discard")}
            </button>
          </div>
        </div>
      )}
      {enhance.status === "error" && (
        <div className="callout callout-error" role="alert">
          <ErrorMessage code={enhance.code} details={enhance.details} message={enhance.message} />
        </div>
      )}
    </SectionPanel>
  );
}
