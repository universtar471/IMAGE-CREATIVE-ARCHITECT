import { useEffect, useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import type { PromptBundle } from "@arch/domain";
import { compilePromptPreview } from "../../app/services";
import { useStudio } from "../../app/store";
import { ErrorState, LoadingState } from "../../components/common/states";
import { toBridgeError } from "../../lib/bridge";
import { useT } from "../../i18n";

/**
 * Read-only view of the compiled PromptBundle. Compiled from persisted data; the text is
 * derived output and can only be copied — never edited back into the project.
 */
export function PromptPreview() {
  const projectId = useStudio((s) => s.workspace!.project.id);
  const revision = useStudio((s) => s.dataRevision);
  const saveStatus = useStudio((s) => s.save.status);
  const [bundle, setBundle] = useState<PromptBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const t = useT();

  useEffect(() => {
    let alive = true;
    compilePromptPreview(projectId)
      .then((b) => alive && (setBundle(b), setError(null)))
      .catch((e) => alive && setError(toBridgeError(e).message));
    return () => {
      alive = false;
    };
  }, [projectId, revision, nonce]);

  if (error)
    return (
      <ErrorState
        title={t("prompt.compileFailed")}
        message={error}
        onRetry={() => setNonce((n) => n + 1)}
      />
    );
  if (!bundle) return <LoadingState label={t("prompt.compilingPrompt")} />;

  const all = [
    `POSITIVE\n${bundle.positivePrompt}`,
    `NEGATIVE\n${bundle.negativePrompt}`,
    `REFERENCES\n${bundle.referenceInstructions}`,
    `PRESERVATION\n${bundle.preservationInstructions}`,
  ].join("\n\n");

  return (
    <div className="board" data-testid="prompt-preview">
      <div className="prompt-meta">
        <span className="badge badge-info">
          {t("prompt.compiler", { version: bundle.compilerVersion })}
        </span>
        <span>
          {t("prompt.deterministic")} {t("prompt.englishNote")}
        </span>
        {saveStatus !== "saved" && (
          <span className="badge badge-warning">{t("prompt.unsavedNotIncluded")}</span>
        )}
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={() => setNonce((n) => n + 1)}>
          <RefreshCw size={13} /> {t("prompt.recompile")}
        </button>
        <CopyButton text={all} label={t("prompt.copyAll")} />
      </div>
      <Block title={t("prompt.positive")} text={bundle.positivePrompt} />
      <Block title={t("prompt.negative")} text={bundle.negativePrompt} />
      <Block title={t("prompt.references")} text={bundle.referenceInstructions} />
      <Block title={t("prompt.preservation")} text={bundle.preservationInstructions} />
      <Block title={t("prompt.metadata")} text={JSON.stringify(bundle.metadata, null, 2)} />
    </div>
  );
}

function Block({ title, text }: { title: string; text: string }) {
  return (
    <section className="prompt-block">
      <header>
        {title}
        <span className="spacer" />
        <CopyButton text={text} />
      </header>
      <pre lang="en">{text}</pre>
    </section>
  );
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const notify = useStudio((s) => s.notify);
  const t = useT();
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => notify("error", t("prompt.clipboardFailed")),
        )
      }
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}{" "}
      {copied ? t("common.copied") : (label ?? t("common.copy"))}
    </button>
  );
}
