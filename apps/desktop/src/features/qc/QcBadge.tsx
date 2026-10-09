import { useEffect, useState } from "react";
import { call } from "../../lib/bridge";
import { latestQcByAsset, type QcReportDTO, type QcResult } from "../../lib/qc";
import { useT } from "../../i18n";

export function QcBadge({ assetId, projectId }: { assetId: string; projectId?: string }) {
  const [result, setResult] = useState<QcResult | null>(null);
  const t = useT();
  useEffect(() => {
    let alive = true;
    if (!projectId)
      return () => {
        alive = false;
      };
    void call("qc_list", { projectId, assetId })
      .then((value) => {
        if (!alive) return;
        const latest = latestQcByAsset(value as QcReportDTO[]).get(assetId);
        setResult(latest?.result ?? null);
      })
      .catch(() => {
        if (alive) setResult(null);
      });
    return () => {
      alive = false;
    };
  }, [assetId, projectId]);
  if (!result) return null;
  return (
    <span
      className={`qc-dot qc-dot-${result}`}
      title={t(`qc.${result}`)}
      aria-label={t(`qc.${result}`)}
    />
  );
}
