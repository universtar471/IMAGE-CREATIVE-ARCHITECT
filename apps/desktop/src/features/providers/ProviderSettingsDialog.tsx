import { useRef, useState } from "react";
import { CheckCircle2, KeyRound, PlugZap, Trash2, XCircle } from "lucide-react";
import type { ProviderDescriptorDTO, ProviderTestResult } from "@arch/domain";
import { attempt, useStudio } from "../../app/store";
import { ConfirmDialog, Dialog } from "../../components/common/Dialog";
import { LoadingState } from "../../components/common/states";
import { call } from "../../lib/bridge";

const KEY_SOURCE_LABELS = { keychain: "OS credential store", env: "Environment variable" } as const;

/**
 * Provider settings. The API key is typed into an uncontrolled password input and read from
 * the DOM only at the moment of saving: it never enters React state, zustand, localStorage
 * or logs, and the input is cleared right after Save (ADR-013).
 */
export function ProviderSettingsDialog() {
  const dialog = useStudio((s) => s.providerDialog);
  const providers = useStudio((s) => s.providers);
  const error = useStudio((s) => s.providersError);
  const close = useStudio((s) => s.closeProviderDialog);
  if (!dialog) return null;

  return (
    <Dialog title="Image providers" onClose={close}>
      <p className="field-hint" style={{ marginTop: 0 }}>
        API keys are stored in the operating system&apos;s credential store by the desktop backend.
        This app can set, test or clear a key but never reads it back.
      </p>
      {!providers ? (
        error ? (
          <div className="callout callout-error">{error}</div>
        ) : (
          <LoadingState label="Loading providers…" />
        )
      ) : (
        <div className="provider-list">
          {providers.map((p) => (
            <ProviderCard key={p.id} provider={p} focused={dialog.focus === p.id} />
          ))}
        </div>
      )}
    </Dialog>
  );
}

function ProviderCard({
  provider: p,
  focused,
}: {
  provider: ProviderDescriptorDTO;
  focused: boolean;
}) {
  const adoptProvider = useStudio((s) => s.adoptProvider);
  const notify = useStudio((s) => s.notify);
  const keyInput = useRef<HTMLInputElement>(null);
  // Only whether the box has text — never the text itself.
  const [hasInput, setHasInput] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "clear" | "test">(null);
  const [test, setTest] = useState<ProviderTestResult | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const save = async () => {
    const input = keyInput.current;
    if (!input) return;
    const apiKey = input.value.trim();
    input.value = "";
    setHasInput(false);
    if (!apiKey) return;
    setBusy("save");
    const updated = await attempt(() => call("provider_set_api_key", { providerId: p.id, apiKey }));
    setBusy(null);
    if (updated) {
      adoptProvider(updated);
      setTest(null);
      notify("success", `API key saved for ${p.label}.`);
    }
  };

  const clear = async () => {
    setConfirmClear(false);
    setBusy("clear");
    const updated = await attempt(() => call("provider_clear_api_key", { providerId: p.id }));
    setBusy(null);
    if (updated) {
      adoptProvider(updated);
      setTest(null);
      notify(
        "info",
        updated.configured
          ? `Stored key removed; ${p.label} still uses a key from the environment.`
          : `API key cleared for ${p.label}.`,
      );
    }
  };

  const runTest = async () => {
    setBusy("test");
    setTest(null);
    const result = await attempt(() => call("provider_test", { providerId: p.id }));
    setBusy(null);
    if (result) setTest(result);
  };

  return (
    <section className={`provider-card ${focused ? "is-focused" : ""}`} aria-label={p.label}>
      <header>
        <strong>{p.label}</strong>
        <span className="badge badge-neutral">{p.kind === "local" ? "Offline" : "Cloud"}</span>
        <span className="spacer" />
        {p.configured ? (
          <span className="badge badge-success">Configured</span>
        ) : (
          <span className="badge badge-warning">Needs API key</span>
        )}
      </header>
      <div className="field-hint">
        {p.models.length} model{p.models.length === 1 ? "" : "s"}:{" "}
        {p.models.map((m) => m.label).join(", ")}
      </div>
      {p.requiresApiKey ? (
        <>
          <div className="field-hint">
            Key source: {p.keySource ? KEY_SOURCE_LABELS[p.keySource] : "none"}
            {p.keySource === "env" && " (read-only; clearing removes only a stored key)"}
          </div>
          <form
            className="key-row"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <input
              ref={keyInput}
              type="password"
              className="input"
              autoComplete="off"
              spellCheck={false}
              placeholder={p.configured ? "Replace API key…" : "Paste API key…"}
              aria-label={`${p.label} API key`}
              autoFocus={focused}
              onChange={(e) => setHasInput(e.target.value.trim() !== "")}
            />
            <button className="btn btn-primary btn-sm" disabled={!hasInput || !!busy}>
              <KeyRound size={13} /> Save
            </button>
          </form>
        </>
      ) : (
        <div className="field-hint">No API key needed.</div>
      )}
      <div className="btn-row">
        <button className="btn btn-sm" onClick={() => void runTest()} disabled={!!busy}>
          <PlugZap size={13} /> {busy === "test" ? "Testing…" : "Test connection"}
        </button>
        {p.requiresApiKey && p.keySource && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setConfirmClear(true)}
            disabled={!!busy}
          >
            <Trash2 size={13} /> Clear key
          </button>
        )}
      </div>
      {test && (
        <div className={`callout ${test.ok ? "callout-success" : "callout-error"}`} role="status">
          {test.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          <span>{test.message}</span>
        </div>
      )}
      {confirmClear && (
        <ConfirmDialog
          title={`Clear the ${p.label} key?`}
          danger
          confirmLabel="Clear key"
          message="The stored API key is deleted from the OS credential store. Generations with this provider stop working until a new key is set."
          onConfirm={() => void clear()}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </section>
  );
}
