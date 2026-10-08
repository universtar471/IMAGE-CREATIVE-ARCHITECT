import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Toasts } from "../components/common/Toasts";
import { ProjectHub } from "../features/projects/ProjectHub";
import { ProviderSettingsDialog } from "../features/providers/ProviderSettingsDialog";
import { ProjectWorkspace } from "../features/workspace/ProjectWorkspace";
import { useStudio } from "./store";

export function App() {
  const route = useStudio((s) => s.route);
  useFlushOnClose();

  return (
    <>
      {!isTauri() && <div className="preview-banner">Browser preview · in-memory mock backend</div>}
      {route.name === "hub" ? <ProjectHub /> : <ProjectWorkspace projectId={route.projectId} />}
      <ProviderSettingsDialog />
      <Toasts />
    </>
  );
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
            const leave = await ask(
              "Some Design DNA changes are invalid or could not be saved. Close anyway and discard them?",
              {
                title: "Unsaved changes",
                kind: "warning",
              },
            );
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
