import { AlertTriangle, Check, ChevronDown, ChevronRight, Circle, Eye, Wrench } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GenerationParams } from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { call } from "../../lib/bridge";
import {
  buildRepairGenerationRequest,
  buildRepairPrompt,
  DEFAULT_QC_SETTINGS,
  isQcResponseCurrent,
  type QcReportDTO,
  type QcSettings,
} from "../../lib/qc";
import { isMasterApproved } from "../camera/labels";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { useT } from "../../i18n";

const EMPTY_PARAMS: GenerationParams = {
  aspectRatio: null,
  imageSize: null,
  outputCount: 1,
  seed: null,
  quality: null,
};

const CATEGORY_KEYS = ["geometry", "material", "openings", "context", "lighting"] as const;

export function qcResultLabel(result: QcReportDTO["result"], t: ReturnType<typeof useT>) {
  return t(`qc.${result}`);
}

export function QcPanel() {
  const ws = useStudio((s) => s.workspace!);
  const providers = useStudio((s) => s.providers ?? []);
  const loadProviders = useStudio((s) => s.loadProviders);
  const submitGeneration = useStudio((s) => s.submitGeneration);
  const readOnly = useStudio(selectReadOnly);
  const selectedId = useStudio((s) => s.selectedAssetId) ?? ws.project.activeMasterAssetId;
  const selected =
    ws.assets.find((asset) => asset.id === selectedId && asset.status === "ready") ?? null;
  const [reports, setReports] = useState<QcReportDTO[]>([]);
  const [settings, setSettings] = useState<QcSettings>(DEFAULT_QC_SETTINGS);
  const [visionMode, setVisionMode] = useState(false);
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const loadToken = useRef(0);
  const [reportsProjectId, setReportsProjectId] = useState<string | null>(null);
  const t = useT();
  const approved = isMasterApproved(ws.project.status);

  const visionProviders = providers.filter((provider) =>
    provider.models.some((model) => model.vision === true),
  );
  const provider =
    visionProviders.find((item) => item.id === providerId) ?? visionProviders[0] ?? null;
  const visionModels = provider?.models.filter((model) => model.vision === true) ?? [];
  const model = visionModels.find((item) => item.id === modelId) ?? visionModels[0] ?? null;
  const settingsProvider =
    visionProviders.find((item) => item.id === settings.visionProviderId) ?? null;
  const settingsModels = settingsProvider?.models.filter((item) => item.vision === true) ?? [];
  const latest = useMemo(
    () =>
      reportsProjectId === ws.project.id
        ? (reports.find((report) => report.assetId === selected?.id) ?? null)
        : null,
    [reports, reportsProjectId, selected?.id, ws.project.id],
  );

  const load = useCallback(async () => {
    const token = ++loadToken.current;
    const projectId = ws.project.id;
    try {
      const [nextReports, nextSettings] = await Promise.all([
        call("qc_list", { projectId }),
        call("qc_settings_get", { projectId }),
      ]);
      if (token !== loadToken.current || useStudio.getState().workspace?.project.id !== projectId)
        return;
      setReports(nextReports as QcReportDTO[]);
      setReportsProjectId(projectId);
      const loaded = nextSettings as QcSettings;
      setSettings(loaded);
      setProviderId(loaded.visionProviderId ?? "");
      setModelId(loaded.visionModel ?? "");
    } catch {
      if (token === loadToken.current && useStudio.getState().workspace?.project.id === projectId) {
        setReports([]);
        setReportsProjectId(projectId);
      }
    }
  }, [ws.project.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    if (!providers.length) void loadProviders();
    return () => window.clearTimeout(timer);
  }, [load, loadProviders, providers.length]);

  const run = async (assetId: string, useVision: boolean) => {
    const projectId = ws.project.id;
    const report = (await call("qc_run", {
      projectId,
      assetId,
      vision: useVision && provider ? { providerId: provider.id, model: model?.id } : null,
    })) as QcReportDTO;
    const current = useStudio.getState();
    const currentAssetId =
      current.selectedAssetId ?? current.workspace?.project.activeMasterAssetId;
    if (isQcResponseCurrent(projectId, assetId, current.workspace?.project.id, currentAssetId)) {
      setReportsProjectId(projectId);
      setReports((current) => [report, ...current.filter((item) => item.id !== report.id)]);
    }
    return report;
  };

  const runSelected = async () => {
    if (!selected || busy || readOnly || !approved) return;
    setBusy(true);
    try {
      await run(selected.id, visionMode);
    } finally {
      setBusy(false);
    }
  };

  const runBatch = async () => {
    const selectedBatchIds = batchIds.filter((id) => ws.assets.some((asset) => asset.id === id));
    const ids = selectedBatchIds.length
      ? selectedBatchIds
      : ws.assets.filter((asset) => asset.status === "ready").map((asset) => asset.id);
    if (!ids.length || busy || readOnly || !approved) return;
    setBusy(true);
    setBatchProgress({ done: 0, total: ids.length });
    const batchKey = `${ws.project.id}:${selectedId ?? ""}`;
    try {
      for (const id of ids) {
        const current = useStudio.getState();
        const currentKey = `${current.workspace?.project.id ?? ""}:${current.selectedAssetId ?? current.workspace?.project.activeMasterAssetId ?? ""}`;
        if (currentKey !== batchKey) return;
        await run(id, visionMode);
        const after = useStudio.getState();
        const afterKey = `${after.workspace?.project.id ?? ""}:${after.selectedAssetId ?? after.workspace?.project.activeMasterAssetId ?? ""}`;
        if (afterKey === batchKey) {
          setBatchProgress((current) => ({ done: (current?.done ?? 0) + 1, total: ids.length }));
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const repair = async () => {
    if (
      !latest ||
      !latest.vision ||
      !selected ||
      latest.result === "pass" ||
      latest.result === "unscored" ||
      readOnly
    )
      return;
    const sourceGeneration = ws.generations.find((generation) =>
      generation.outputAssetIds.includes(selected.id),
    );
    const repairProvider = sourceGeneration?.providerId ?? provider?.id;
    const repairModel = sourceGeneration?.modelId ?? model?.id;
    if (!repairProvider || !repairModel) return;
    const request = buildRepairGenerationRequest({
      projectId: ws.project.id,
      report: latest,
      providerId: repairProvider,
      modelId: repairModel,
      prompt: buildRepairPrompt({ dna: ws.draftDna, report: latest }),
      params: EMPTY_PARAMS,
    });
    await submitGeneration(request as never, request.prompt as never);
  };

  const saveSettings = async () => {
    const saved = (await call("qc_settings_set", {
      projectId: ws.project.id,
      settings,
    })) as QcSettings;
    setSettings(saved);
  };

  return (
    <div className="qc-panel" data-testid="qc-panel">
      {!approved && (
        <div className="callout callout-warning" role="status">
          <AlertTriangle size={14} /> {t("qc.needsMaster")}
        </div>
      )}
      <SectionPanel title={t("qc.howToUse")} defaultOpen={false}>
        <p className="field-hint">{t("qc.howToUseLocal")}</p>
        <p className="field-hint">{t("qc.howToUseVision")}</p>
        <p className="field-hint">{t("qc.howToUseScores")}</p>
      </SectionPanel>
      <SectionPanel title={t("qc.source")}>
        {selected ? (
          <strong>{selected.originalName ?? selected.id}</strong>
        ) : (
          <span className="field-hint">{t("qc.noSource")}</span>
        )}
      </SectionPanel>
      <SectionPanel title={t("qc.run")}>
        <div className="segmented" role="group" aria-label={t("qc.run")}>
          <button type="button" aria-pressed={!visionMode} onClick={() => setVisionMode(false)}>
            {t("qc.local")}
          </button>
          <button type="button" aria-pressed={visionMode} onClick={() => setVisionMode(true)}>
            {t("qc.vision")}
          </button>
        </div>
        {visionMode && (
          <div className="field-row">
            <label className="field">
              <span>{t("qc.provider")}</span>
              <select
                className="select"
                value={provider?.id ?? ""}
                onChange={(event) => {
                  setProviderId(event.target.value);
                  setModelId("");
                }}
              >
                <option value="">{t("qc.provider")}</option>
                {visionProviders.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("qc.model")}</span>
              <select
                className="select"
                value={model?.id ?? ""}
                onChange={(event) => setModelId(event.target.value)}
              >
                <option value="">{t("qc.model")}</option>
                {visionModels.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <span className="field-hint">{visionMode ? t("qc.costUnknown") : t("qc.costFree")}</span>
        <button
          className="btn btn-primary"
          disabled={!selected || busy || readOnly || !approved || (visionMode && !provider)}
          onClick={() => void runSelected()}
        >
          <Eye size={14} /> {t("qc.run")}
        </button>
      </SectionPanel>
      <SectionPanel title={t("qc.batch")} defaultOpen={false}>
        <div className="qc-batch-list">
          {ws.assets
            .filter((asset) => asset.status === "ready")
            .map((asset) => (
              <label key={asset.id} className="toggle-row">
                <input
                  type="checkbox"
                  checked={batchIds.includes(asset.id)}
                  onChange={(event) =>
                    setBatchIds((current) =>
                      event.target.checked
                        ? [...current, asset.id]
                        : current.filter((id) => id !== asset.id),
                    )
                  }
                />{" "}
                {asset.originalName ?? asset.id}
              </label>
            ))}
        </div>
        {batchProgress && (
          <span className="field-hint" data-testid="qc-batch-progress">
            {t("qc.batchProgress", batchProgress)}
          </span>
        )}
        <button
          className="btn"
          disabled={busy || readOnly || !approved}
          onClick={() => void runBatch()}
        >
          {t("qc.batchRun")}
        </button>
      </SectionPanel>
      <ReportView report={latest} onRepair={() => void repair()} />
      <SectionPanel title={t("qc.history")} defaultOpen={false}>
        {reports.length ? (
          reports.map((report) => (
            <div className="qc-history-row" key={report.id}>
              <span className={`badge qc-result-${report.result}`}>
                {qcResultLabel(report.result, t)}
              </span>
              <span>{report.assetId}</span>
              <span className="field-hint">{new Date(report.createdAt).toLocaleString()}</span>
            </div>
          ))
        ) : (
          <span className="field-hint">{t("qc.noReport")}</span>
        )}
      </SectionPanel>
      <SectionPanel title={t("qc.settings")} defaultOpen={false}>
        <button
          type="button"
          className="link-btn"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((open) => !open)}
        >
          {settingsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {t("qc.settings")}
        </button>
        {settingsOpen && (
          <div className="qc-settings">
            <label className="field">
              <span>{t("qc.passMin")}</span>
              <input
                type="number"
                min="0"
                max="100"
                step="any"
                value={settings.passMin}
                onChange={(event) =>
                  setSettings({ ...settings, passMin: Number(event.target.value) })
                }
              />
            </label>
            <label className="field">
              <span>{t("qc.categoryMin")}</span>
              <input
                type="number"
                min="0"
                max="100"
                step="any"
                value={settings.categoryMin}
                onChange={(event) =>
                  setSettings({ ...settings, categoryMin: Number(event.target.value) })
                }
              />
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.highArtifactFails}
                onChange={(event) =>
                  setSettings({ ...settings, highArtifactFails: event.target.checked })
                }
              />{" "}
              {t("qc.highArtifactFails")}
            </label>
            <label className="field">
              <span>{t("qc.autoQc")}</span>
              <select
                className="select"
                value={settings.autoQc}
                onChange={(event) =>
                  setSettings({ ...settings, autoQc: event.target.value as QcSettings["autoQc"] })
                }
              >
                <option value="off">{t("qc.autoOff")}</option>
                <option value="after_generation">{t("qc.autoAfterGeneration")}</option>
              </select>
              <span className="field-hint">{t("qc.costWarning")}</span>
            </label>
            <div className="field-row">
              <label className="field">
                <span>{t("qc.provider")}</span>
                <select
                  className="select"
                  value={settings.visionProviderId ?? ""}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      visionProviderId: event.target.value || null,
                      visionModel: null,
                    })
                  }
                >
                  <option value="">{t("qc.provider")}</option>
                  {visionProviders.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("qc.model")}</span>
                <select
                  className="select"
                  value={settings.visionModel ?? ""}
                  onChange={(event) =>
                    setSettings({ ...settings, visionModel: event.target.value || null })
                  }
                  disabled={!settingsProvider}
                >
                  <option value="">{t("qc.model")}</option>
                  {settingsModels.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              <span>{t("qc.autoRepairMax")}</span>
              <select
                className="select"
                value={settings.autoRepairMax}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    autoRepairMax: Number(event.target.value) as 0 | 1 | 2,
                  })
                }
              >
                <option value="0">0</option>
                <option value="1">1</option>
                <option value="2">2</option>
              </select>
            </label>
            <button className="btn" disabled={readOnly} onClick={() => void saveSettings()}>
              {t("qc.saveSettings")}
            </button>
          </div>
        )}
      </SectionPanel>
    </div>
  );
}

function ReportView({ report, onRepair }: { report: QcReportDTO | null; onRepair: () => void }) {
  const t = useT();
  if (!report)
    return (
      <SectionPanel title={t("qc.latest")}>
        <span className="field-hint">{t("qc.noReport")}</span>
      </SectionPanel>
    );
  const canRepair = !!report.vision && (report.result === "warn" || report.result === "fail");
  return (
    <SectionPanel title={t("qc.latest")}>
      <div className="qc-report" data-testid="qc-report">
        <div className="qc-report-header">
          <span className={`badge qc-result-${report.result}`}>
            {report.result === "pass" ? (
              <Check size={12} />
            ) : report.result === "fail" ? (
              <AlertTriangle size={12} />
            ) : (
              <Circle size={12} />
            )}{" "}
            {qcResultLabel(report.result, t)}
          </span>
          <strong>
            {t("qc.overall")}: {report.overall ?? "-"}
          </strong>
        </div>
        {report.vision && (
          <div className="qc-categories">
            <h4>{t("qc.categories")}</h4>
            {CATEGORY_KEYS.map((key) => (
              <div className="qc-score" key={key}>
                <span>{key}</span>
                <progress max="100" value={report.vision!.scores[key]} />
                <b>{report.vision!.scores[key]}</b>
              </div>
            ))}
          </div>
        )}
        <div className="qc-local">
          <h4>{t("qc.localMetrics")}</h4>
          <div>
            {t("qc.edgeAlignment")}: {report.local.edgeAlignment ?? t("qc.notApplicable")}
          </div>
          <div>
            {t("qc.sharpness")}: {report.local.sharpness}
          </div>
          <div>
            {t("qc.clippedPct")}: {report.local.clippedPct}%
          </div>
        </div>
        {report.vision && (
          <>
            <div>
              <h4>{t("qc.issues")}</h4>
              {report.vision.issues.length ? (
                <ul>
                  {report.vision.issues.map((issue, index) => (
                    <li key={index}>
                      {issue.category}: {issue.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="field-hint">{t("qc.noIssues")}</span>
              )}
            </div>
            <div>
              <h4>{t("qc.artifacts")}</h4>
              {report.vision.artifacts.length ? (
                <ul>
                  {report.vision.artifacts.map((artifact, index) => (
                    <li key={index}>
                      {artifact.severity}: {artifact.label}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="field-hint">{t("qc.noArtifacts")}</span>
              )}
            </div>
            <p>
              <strong>{t("qc.repairInstruction")}:</strong> {report.vision.repairInstruction}
            </p>
          </>
        )}
        {canRepair && (
          <button className="btn btn-primary" onClick={onRepair}>
            <Wrench size={14} /> {t("qc.repairAction")}
          </button>
        )}
      </div>
    </SectionPanel>
  );
}
