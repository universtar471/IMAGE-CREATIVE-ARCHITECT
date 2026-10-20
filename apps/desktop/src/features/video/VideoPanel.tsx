/**
 * Right panel of the Video module (ADR-043): first frame, motion preset, provider/model,
 * clip length, ratio, optional note, cost, then "Create video" through the spend confirm.
 * The prompt is compiled from the saved DNA with `compileVideoPrompt`; nothing runs without
 * the user's click and the confirm.
 */
import { Clapperboard, Play, Settings2 } from "lucide-react";
import { useState } from "react";
import {
  MOTION_PRESETS,
  compileVideoPrompt,
  durationSize,
  estimateVideoCost,
  formatVnd,
} from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { useSpendConfirm } from "../../components/common/SpendConfirm";
import { LoadingState } from "../../components/common/states";
import { FieldGroup, SelectField, TextAreaField } from "../../components/panels/fields";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { HelpPopover } from "../../components/common/HelpPopover";
import { fileUrl } from "../../lib/files";
import { useT } from "../../i18n";
import { formatClipDuration } from "../../lib/format";
import {
  defaultVideoSource,
  projectVideos,
  resolveVideoForm,
  videoDisabledReason,
  videoSources,
  type VideoChoice,
} from "./video";

/** Select value of "the provider follows the first frame" (aspect ratio null). */
const FOLLOW_IMAGE = "follow";

export function VideoPanel() {
  const providers = useStudio((s) => s.providers);
  const ws = useStudio((s) => s.workspace!);
  const selectedId = useStudio((s) => s.selectedAssetId);
  const selectAsset = useStudio((s) => s.selectAsset);
  const readOnly = useStudio(selectReadOnly);
  const run = useStudio((s) => s.run);
  const submit = useStudio((s) => s.submitGeneration);
  const openProviderDialog = useStudio((s) => s.openProviderDialog);
  const spend = useSpendConfirm();
  const t = useT();
  const { motion, note, choice } = useStudio((s) => s.videoDraft);
  const setDraft = useStudio((s) => s.setVideoDraft);
  const setChoice = (value: VideoChoice) => setDraft({ choice: value });
  const [sentHere, setSentHere] = useState(false);

  if (!providers) return <LoadingState label={t("generate.loadingProviders")} />;

  const project = ws.project;
  const sources = videoSources(ws.assets);
  const source = defaultVideoSource(ws.assets, selectedId, project.activeMasterAssetId);
  const form = resolveVideoForm(providers, choice);
  const submitting = run?.status === "submitting";
  const reason = videoDisabledReason(form, source, { readOnly, submitting });
  const cost =
    form.model && form.durationSec ? estimateVideoCost(form.model, form.durationSec) : null;
  const costText = cost === null ? null : t("videoModule.costValue", { amount: formatVnd(cost) });
  const shot =
    source && form.durationSec
      ? {
          motionPresetId: motion,
          durationSec: form.durationSec,
          aspectRatio: form.aspectRatio,
          sourceAssetId: source.id,
          ...(note.trim() ? { note: note.trim() } : {}),
        }
      : null;
  const prompt = shot ? compileVideoPrompt(ws.persistedDna, shot) : null;
  const videos = projectVideos(ws.assets);
  const error = sentHere && run?.status === "error" && run.projectId === project.id ? run : null;

  const create = async () => {
    if (!form.provider || !form.model || !source || !shot || !prompt || reason) return;
    const accepted = await spend.request({
      providerId: form.provider.id,
      provider: form.provider.label,
      model: form.model.label,
      imageCount: 1,
      costText,
      estimatedTotal: cost,
      video: { durationSec: shot.durationSec },
      children: <p className="field-hint">{t("videoModule.cancelWarning")}</p>,
    });
    if (!accepted) return;
    setSentHere(true);
    await submit(
      {
        projectId: project.id,
        providerId: form.provider.id,
        modelId: form.model.id,
        purpose: "video",
        referenceAssetIds: [source.id],
        params: {
          aspectRatio: form.aspectRatio,
          imageSize: durationSize(shot.durationSec),
          outputCount: 1,
          seed: null,
          quality: null,
        },
        cameraId: null,
      },
      prompt,
    );
  };

  return (
    <div className="video-panel" data-testid="video-panel">
      {spend.dialog}
      <SectionPanel
        title={t("videoModule.source")}
        aside={
          <HelpPopover topic={t("videoModule.source")}>{t("videoModule.sourceHint")}</HelpPopover>
        }
      >
        {sources.length === 0 ? (
          <p className="field-hint">{t("videoModule.noSource")}</p>
        ) : (
          <SelectField
            label={t("videoModule.source")}
            allowEmpty={false}
            disabled={readOnly}
            value={source?.id}
            options={sources.map((asset) => ({
              value: asset.id,
              label: asset.originalName ?? asset.id,
            }))}
            onChange={(id) => id && selectAsset(id)}
          />
        )}
        {source && (
          <img
            className="video-source-thumb"
            src={fileUrl(source.thumbnailPath ?? source.absolutePath) ?? undefined}
            alt={source.originalName ?? source.id}
          />
        )}
      </SectionPanel>

      <SectionPanel title={t("videoModule.motion")}>
        <div className="motion-grid" role="group" aria-label={t("videoModule.motion")}>
          {MOTION_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="motion-chip"
              aria-pressed={motion === preset.id}
              disabled={readOnly}
              title={preset.motionEn}
              onClick={() => setDraft({ motion: preset.id })}
            >
              {t(`videoModule.motions.${preset.id}`)}
            </button>
          ))}
        </div>
        <TextAreaField
          label={t("videoModule.note")}
          value={note}
          placeholder={t("videoModule.notePlaceholder")}
          disabled={readOnly}
          onChange={(value) => setDraft({ note: value.slice(0, 400) })}
        />
      </SectionPanel>

      <SectionPanel
        title={t("videoModule.provider")}
        aside={
          <button
            className="btn btn-ghost btn-sm btn-icon"
            title={t("videoModule.settings")}
            aria-label={t("videoModule.settings")}
            onClick={(e) => {
              e.preventDefault();
              openProviderDialog(form.provider?.id ?? null);
            }}
          >
            <Settings2 size={14} />
          </button>
        }
      >
        {form.providers.every((p) => !p.configured) && (
          <p className="field-hint">{t("videoModule.noProviders")}</p>
        )}
        <SelectField
          label={t("videoModule.provider")}
          allowEmpty={false}
          disabled={readOnly}
          value={form.provider?.id}
          options={form.providers.map((p) => ({
            value: p.id,
            label: p.configured ? p.label : t("videoModule.needsKey", { label: p.label }),
          }))}
          onChange={(id) =>
            setChoice({
              providerId: id ?? null,
              modelId: null,
              durationSec: null,
              aspectRatio: null,
            })
          }
        />
        {form.provider && form.provider.models.length > 1 && (
          <SelectField
            label={t("videoModule.model")}
            allowEmpty={false}
            disabled={readOnly}
            value={form.model?.id}
            options={form.provider.models.map((m) => ({ value: m.id, label: m.label }))}
            onChange={(id) => setChoice({ ...choice, modelId: id ?? null })}
          />
        )}
        {form.durations.length > 0 && (
          <SelectField
            label={t("videoModule.duration")}
            allowEmpty={false}
            disabled={readOnly}
            value={form.durationSec === null ? undefined : String(form.durationSec)}
            options={form.durations.map((d) => ({
              value: String(d),
              label: t("videoModule.durationOption", { seconds: d }),
            }))}
            onChange={(value) =>
              setChoice({ ...choice, durationSec: value ? Number(value) : null })
            }
          />
        )}
        {form.model && form.model.aspectRatios.length > 0 && (
          <SelectField
            label={t("videoModule.aspect")}
            allowEmpty={false}
            disabled={readOnly}
            value={form.aspectRatio ?? FOLLOW_IMAGE}
            options={[
              { value: FOLLOW_IMAGE, label: t("videoModule.aspectFollow") },
              ...form.model.aspectRatios.map((r) => ({ value: r, label: r })),
            ]}
            onChange={(value) =>
              setChoice({ ...choice, aspectRatio: !value || value === FOLLOW_IMAGE ? null : value })
            }
          />
        )}
        <FieldGroup label={t("videoModule.cost")}>
          <span className="field-value" data-testid="video-cost">
            {costText ?? t("videoModule.costUnknown")}
          </span>
        </FieldGroup>
      </SectionPanel>

      {prompt && (
        <SectionPanel title={t("videoModule.promptPreview")} defaultOpen={false}>
          <p className="prompt-text" data-testid="video-prompt">
            {prompt.positivePrompt} {prompt.preservationInstructions}
          </p>
        </SectionPanel>
      )}

      <div className="video-actions">
        <button
          className="btn btn-primary"
          disabled={reason !== null}
          title={reason ? t(`videoModule.${reason}`) : undefined}
          onClick={() => void create()}
          data-testid="video-create"
        >
          <Clapperboard size={14} />{" "}
          {submitting ? t("videoModule.creating") : t("videoModule.create")}
        </button>
        {reason && <span className="field-hint">{t(`videoModule.${reason}`)}</span>}
        <span className="field-hint">{t("videoModule.cancelWarning")}</span>
        {error && (
          <div className="callout callout-error" role="alert">
            {error.message}
          </div>
        )}
      </div>

      <SectionPanel title={t("videoModule.recent")}>
        {videos.length === 0 ? (
          <p className="field-hint">{t("videoModule.noVideos")}</p>
        ) : (
          <ul className="video-list">
            {videos.map((video) => (
              <li key={video.id}>
                <button
                  type="button"
                  className="video-list-item"
                  aria-current={video.id === selectedId}
                  onClick={() => selectAsset(video.id)}
                >
                  <Play size={12} /> {video.originalName ?? video.id}
                  {video.durationMs != null && (
                    <span className="field-hint"> {formatClipDuration(video.durationMs)}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionPanel>
    </div>
  );
}
