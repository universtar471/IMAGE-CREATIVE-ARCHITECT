import { useEffect, useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import type { PromptBundle } from "@arch/domain";
import { compilePromptPreview } from "../../app/services";
import { useStudio } from "../../app/store";
import { ErrorState, LoadingState } from "../../components/common/states";
import { toBridgeError } from "../../lib/bridge";

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
        title="Could not compile the prompt"
        message={error}
        onRetry={() => setNonce((n) => n + 1)}
      />
    );
  if (!bundle) return <LoadingState label="Compiling prompt…" />;

  const all = [
    `POSITIVE\n${bundle.positivePrompt}`,
    `NEGATIVE\n${bundle.negativePrompt}`,
    `REFERENCES\n${bundle.referenceInstructions}`,
    `PRESERVATION\n${bundle.preservationInstructions}`,
  ].join("\n\n");

  return (
    <div className="board" data-testid="prompt-preview">
      <div className="prompt-meta">
        <span className="badge badge-info">Compiler {bundle.compilerVersion}</span>
        <span>
          Deterministic preview compiled from saved DNA and reference roles. Edit the DNA to change
          it.
        </span>
        {saveStatus !== "saved" && (
          <span className="badge badge-warning">Unsaved edits not included yet</span>
        )}
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={() => setNonce((n) => n + 1)}>
          <RefreshCw size={13} /> Recompile
        </button>
        <CopyButton text={all} label="Copy all" />
      </div>
      <Block title="Positive prompt" text={bundle.positivePrompt} />
      <Block title="Negative prompt" text={bundle.negativePrompt} />
      <Block title="Reference instructions" text={bundle.referenceInstructions} />
      <Block title="Preservation instructions" text={bundle.preservationInstructions} />
      <Block title="Metadata" text={JSON.stringify(bundle.metadata, null, 2)} />
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
      <pre>{text}</pre>
    </section>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const notify = useStudio((s) => s.notify);
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => notify("error", "Could not access the clipboard."),
        )
      }
    >
      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : label}
    </button>
  );
}
