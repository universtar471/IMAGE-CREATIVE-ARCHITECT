import { useEffect, useState } from "react";
import type { PromptBundle } from "@arch/domain";
import { compilePromptPreview } from "../../app/services";
import { useStudio } from "../../app/store";
import { toBridgeError } from "../../lib/bridge";

/**
 * What the Generate button will send: compiled from persisted DNA (pending edits are
 * flushed first) with exactly the selected references, in order (ADR-008).
 */
export function GeneratePromptPreview({ referenceIds }: { referenceIds: readonly string[] }) {
  const projectId = useStudio((s) => s.workspace!.project.id);
  const revision = useStudio((s) => s.dataRevision);
  const flushDna = useStudio((s) => s.flushDna);
  const [result, setResult] = useState<{ key: string; bundle?: PromptBundle; error?: string }>();
  const refsKey = referenceIds.join(",");
  const key = `${projectId}|${revision}|${refsKey}`;

  useEffect(() => {
    let alive = true;
    const ids = refsKey ? refsKey.split(",") : [];
    void flushDna()
      .then(() => compilePromptPreview(projectId, ids))
      .then(
        (bundle) => alive && setResult({ key, bundle }),
        (e: unknown) => alive && setResult({ key, error: toBridgeError(e).message }),
      );
    return () => {
      alive = false;
    };
  }, [flushDna, projectId, refsKey, key]);

  // Older results stay visible (dimmed) while the new compile runs.
  const stale = result?.key !== key;
  if (!result) return <span className="field-hint">Compiling…</span>;
  if (result.error) return <span className="field-error">{result.error}</span>;
  const b = result.bundle!;
  return (
    <div className={`gen-prompt ${stale ? "is-stale" : ""}`} data-testid="generate-prompt">
      <span className="field-label">Positive</span>
      <pre>{b.positivePrompt}</pre>
      <span className="field-label">References</span>
      <pre>{b.referenceInstructions}</pre>
      <span className="field-label">Preservation</span>
      <pre>{b.preservationInstructions}</pre>
      <span className="field-label">Negative</span>
      <pre>{b.negativePrompt}</pre>
      <span className="field-hint">
        Compiler {b.compilerVersion} · compiled from saved DNA. The full view is in Prompt Preview.
      </span>
    </div>
  );
}
