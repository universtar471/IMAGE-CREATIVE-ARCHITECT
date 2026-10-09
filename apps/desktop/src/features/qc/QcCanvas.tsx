import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useStudio } from "../../app/store";
import { call } from "../../lib/bridge";
import type { QcReportDTO } from "../../lib/qc";
import { WorkspaceCanvas } from "../../components/canvas/WorkspaceCanvas";
import type { ImageDisplayRect } from "../../components/canvas/ImageViewer";
import { useT } from "../../i18n";

export function QcCanvas() {
  const ws = useStudio((s) => s.workspace!);
  const selectedId = useStudio((s) => s.selectedAssetId) ?? ws.project.activeMasterAssetId;
  const asset = ws.assets.find((item) => item.id === selectedId) ?? null;
  const [report, setReport] = useState<QcReportDTO | null>(null);
  const [visible, setVisible] = useState(true);
  const t = useT();
  useEffect(() => {
    if (!selectedId) return;
    void call("qc_list", { projectId: ws.project.id, assetId: selectedId })
      .then((value) => setReport((value as QcReportDTO[])[0] ?? null))
      .catch(() => setReport(null));
  }, [selectedId, ws.project.id]);
  const boxes = visible ? (report?.vision?.artifacts.filter((artifact) => artifact.box) ?? []) : [];
  return (
    <WorkspaceCanvas
      mode={{ kind: "single", asset }}
      overlay={(rect: ImageDisplayRect) => (
        <div className="qc-overlay" data-testid="qc-overlay">
          {boxes.map((artifact, index) => {
            const [x, y, width, height] = artifact.box!;
            return (
              <span
                key={`${artifact.label}-${index}`}
                className={`qc-overlay-box qc-severity-${artifact.severity}`}
                style={{
                  left: rect.left + x * rect.width,
                  top: rect.top + y * rect.height,
                  width: width * rect.width,
                  height: height * rect.height,
                }}
                title={artifact.label}
              >
                {artifact.label}
              </span>
            );
          })}
        </div>
      )}
      extraTools={
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? t("qc.hideOverlay") : t("qc.showOverlay")}
          title={visible ? t("qc.hideOverlay") : t("qc.showOverlay")}
        >
          {visible ? <EyeOff size={13} /> : <Eye size={13} />}{" "}
          {visible ? t("qc.hideOverlay") : t("qc.showOverlay")}
        </button>
      }
    />
  );
}
