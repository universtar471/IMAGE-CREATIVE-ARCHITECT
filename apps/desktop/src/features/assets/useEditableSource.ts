import { isVideoAsset } from "@arch/domain";
import { useStudio } from "../../app/store";

/** The selected ready image, with a master fallback only when nothing is selected. */
export function useEditableSource() {
  return useStudio((s) => {
    const ws = s.workspace;
    const id = s.selectedAssetId ?? ws?.project.activeMasterAssetId;
    return ws?.assets.find((a) => a.id === id && a.status === "ready" && !isVideoAsset(a)) ?? null;
  });
}
