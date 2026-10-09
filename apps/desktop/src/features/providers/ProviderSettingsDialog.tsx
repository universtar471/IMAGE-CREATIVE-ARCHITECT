import { useRef, useState } from "react";
import { CheckCircle2, KeyRound, PlugZap, Trash2, XCircle } from "lucide-react";
import type { ProviderDescriptorDTO, ProviderTestResult } from "@arch/domain";
import { attempt, useStudio } from "../../app/store";
import { ConfirmDialog, Dialog } from "../../components/common/Dialog";
import { LoadingState } from "../../components/common/states";
import { call } from "../../lib/bridge";
import { providerKeyHelp } from "./help";
import { useT } from "../../i18n";

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
  const t = useT();
  if (!dialog) return null;

  return (
    <Dialog title={t("providers.title")} onClose={close}>
      <p className="field-hint" style={{ marginTop: 0 }}>
        {t("providers.intro")}
      </p>
      {!providers ? (
        error ? (
          <div className="callout callout-error">{error}</div>
        ) : (
          <LoadingState label={t("generate.loadingProviders")} />
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
  const help = p.requiresApiKey ? providerKeyHelp(p.id) : null;
  const t = useT();

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
      notify("success", t("providers.saved", { label: p.label }));
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
          ? t("providers.clearedEnv", { label: p.label })
          : t("providers.cleared", { label: p.label }),
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
        <span className="badge badge-neutral">
          {p.kind === "local" ? t("providers.offline") : t("providers.cloud")}
        </span>
        <span className="spacer" />
        {p.configured ? (
          <span className="badge badge-success">{t("providers.configured")}</span>
        ) : (
          <span className="badge badge-warning">{t("providers.needsKey")}</span>
        )}
      </header>
      <div className="field-hint">
        {t("providers.models", {
          count: p.models.length,
          list: p.models.map((m) => m.label).join(", "),
        })}
      </div>
      {p.requiresApiKey ? (
        <>
          <div className="field-hint">
            {t("providers.keySource", {
              source: p.keySource ? t(`labels.keySource.${p.keySource}`) : t("common.none"),
            })}
            {p.keySource === "env" && ` ${t("providers.envReadOnly")}`}
          </div>
          {help && (
            <ul
              className="field-hint provider-help"
              aria-label={t("providers.keyHelp", { label: p.label })}
            >
              <li>
                {t("providers.getKeyAt")} <span className="provider-help-url">{help.keyUrl}</span>
              </li>
              {help.notes.map((note) => (
                <li key={note}>{t(note)}</li>
              ))}
            </ul>
          )}
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
              placeholder={p.configured ? t("providers.replaceKey") : t("providers.pasteKey")}
              aria-label={t("providers.keyLabel", { label: p.label })}
              autoFocus={focused}
              onChange={(e) => setHasInput(e.target.value.trim() !== "")}
            />
            <button className="btn btn-primary btn-sm" disabled={!hasInput || !!busy}>
              <KeyRound size={13} /> {t("common.save")}
            </button>
          </form>
        </>
      ) : (
        <div className="field-hint">{t("providers.noKey")}</div>
      )}
      <div className="btn-row">
        <button className="btn btn-sm" onClick={() => void runTest()} disabled={!!busy}>
          <PlugZap size={13} /> {busy === "test" ? t("providers.testing") : t("providers.test")}
        </button>
        {p.requiresApiKey && p.keySource && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setConfirmClear(true)}
            disabled={!!busy}
          >
            <Trash2 size={13} /> {t("providers.clearKey")}
          </button>
        )}
      </div>
      {test && (
        <div className={`callout ${test.ok ? "callout-success" : "callout-error"}`} role="status">
          {test.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          <span>
            <strong>{test.ok ? t("providers.testOk") : t("providers.testFailed")}</strong>{" "}
            {test.message}
          </span>
        </div>
      )}
      {confirmClear && (
        <ConfirmDialog
          title={t("providers.clearTitle", { label: p.label })}
          danger
          confirmLabel={t("providers.clearKey")}
          message={t("providers.clearMessage")}
          onConfirm={() => void clear()}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </section>
  );
}
