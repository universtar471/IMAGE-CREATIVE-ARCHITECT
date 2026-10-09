import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Toasts } from "../components/common/Toasts";
import { ProjectHub } from "../features/projects/ProjectHub";
import { ProviderSettingsDialog } from "../features/providers/ProviderSettingsDialog";
import { ProjectWorkspace } from "../features/workspace/ProjectWorkspace";
import { t, useLocale, useT } from "../i18n";
import { isTerminalJob, startBackendSync, useStudio } from "./store";

/** job_list refresh while jobs are active (events are primary; this catches anything missed). */
export const JOB_POLL_MS = 4000;

export function App() {
  const route = useStudio((s) => s.route);
  const tr = useT();
  useFlushOnClose();
  useDocumentLang();
  useBackendSync();

  return (
    <>
      {!isTauri() && <div className="preview-banner">{tr("common.previewBanner")}</div>}
      {route.name === "hub" ? <ProjectHub /> : <ProjectWorkspace projectId={route.projectId} />}
      <ProviderSettingsDialog />
      <Toasts />
    </>
  );
}

/** Keep <html lang> in step with the UI language (screen readers, hyphenation). */
function useDocumentLang() {
  const locale = useLocale((s) => s.locale);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
}

/** Backend events → store, plus an initial job_list and a slow poll while jobs are active. */
function useBackendSync() {
  useEffect(() => {
    const stop = startBackendSync();
    const { refreshJobs } = useStudio.getState();
    void refreshJobs();
    const timer = setInterval(() => {
      const s = useStudio.getState();
      if (s.jobs.some((j) => !isTerminalJob(j))) void s.refreshJobs();
    }, JOB_POLL_MS);
    return () => {
      stop();
      clearInterval(timer);
    };
  }, []);
}

/** Never silently lose DNA edits: save pending changes before the window closes. */
function useFlushOnClose() {
  useEffect(() => {
    if (!isTauri()) {
      const onBeforeUnload = (e: BeforeUnloadEvent) => {
        if (useStudio.getState().save.status !== "saved") e.preventDefault();
      };
      window.addEventListener("beforeunload", onBeforeUnload);
      return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow()
        .onCloseRequested(async (event) => {
          const saved = await useStudio.getState().flushDna();
          if (!saved && useStudio.getState().save.status !== "saved") {
            const { ask } = await import("@tauri-apps/plugin-dialog");
            const leave = await ask(t("store.closeUnsaved"), {
              title: t("store.closeUnsavedTitle"),
              kind: "warning",
            });
            if (!leave) event.preventDefault();
          }
        })
        .then((fn) => (cancelled ? fn() : (unlisten = fn))),
    );
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
