import { LockKeyhole, Link, UnlockKeyhole } from "lucide-react";
import { effectiveGenerationPreserve, setGenerationPreserve, isInteriorShot } from "@arch/domain";
import { useStudio, selectReadOnly } from "../../app/store";
import { HelpPopover } from "../../components/common/HelpPopover";
import { useT } from "../../i18n";

/** Locks protect the source viewpoint; editing a planned camera never silently unlocks it. */
export function CameraSyncStatus() {
  const ws = useStudio((s) => s.workspace!);
  const selected = useStudio((s) => s.selectedCameraId);
  const readOnly = useStudio(selectReadOnly);
  const t = useT();
  const generation = ws.shotIntent?.interiorGeneration;
  if (ws.project.projectType !== "interior" || !isInteriorShot(ws.draftDna) || !generation)
    return null;
  if (
    generation.camera.cameraId &&
    !ws.draftDna.cameras.some((c) => c.id === generation.camera.cameraId)
  )
    return (
      <span role="alert" className="camera-sync-status">
        {t("multiAngle.cameraMissing")}
      </span>
    );
  const locked = effectiveGenerationPreserve(generation).camera;
  const linked = generation.camera.cameraId === selected && !!selected;
  if (!locked && !linked) return null;
  const unlock = () => {
    if (readOnly || !selected) return;
    const next = setGenerationPreserve(generation, "camera", false);
    useStudio.getState().setShotIntent({
      ...ws.shotIntent!,
      interiorGeneration: { ...next, camera: { mode: "studio", cameraId: selected } },
    });
  };
  return (
    <span className="camera-sync-status" data-testid="camera-sync-status">
      {locked ? <LockKeyhole size={15} aria-hidden /> : <Link size={15} aria-hidden />}
      <span>{t(locked ? "multiAngle.locked" : "multiAngle.linked")}</span>
      {locked && (
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          aria-label={t("multiAngle.unlockCamera")}
          title={t("multiAngle.unlockCamera")}
          disabled={readOnly || !selected}
          onClick={unlock}
        >
          <UnlockKeyhole size={17} aria-hidden />
        </button>
      )}
      <HelpPopover topic={t("multiAngle.title")}>{t("multiAngle.syncHelp")}</HelpPopover>
    </span>
  );
}
