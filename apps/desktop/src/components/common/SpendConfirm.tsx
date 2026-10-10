import { useState, type ReactNode } from "react";
import { Dialog } from "./Dialog";
import { useT } from "../../i18n";

export const SPEND_THRESHOLD_KEY = "arch.spendConfirmThreshold";
export const DEFAULT_SPEND_THRESHOLD = 2000;

export type SpendRequest = {
  providerId?: string;
  provider: string;
  model: string;
  imageCount: number;
  costText?: string | null;
  estimatedTotal?: number | null;
  children?: ReactNode;
};

function readThreshold(): number {
  try {
    const stored = globalThis.localStorage?.getItem(SPEND_THRESHOLD_KEY);
    if (stored === null || stored === undefined || stored.trim() === "")
      return DEFAULT_SPEND_THRESHOLD;
    const value = Number(stored);
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_SPEND_THRESHOLD;
  } catch {
    return DEFAULT_SPEND_THRESHOLD;
  }
}

function writeThreshold(value: number) {
  try {
    globalThis.localStorage?.setItem(SPEND_THRESHOLD_KEY, String(value));
  } catch {
    // A blocked storage should never block a paid action.
  }
}

function hasRememberedThreshold(): boolean {
  try {
    return globalThis.localStorage?.getItem(SPEND_THRESHOLD_KEY) !== null;
  } catch {
    return false;
  }
}

function resetThreshold() {
  try {
    globalThis.localStorage?.removeItem(SPEND_THRESHOLD_KEY);
  } catch {
    // Storage blocked: reset only affects this preference.
  }
}

export function useSpendConfirm() {
  const [pending, setPending] = useState<SpendRequest | null>(null);
  const [resolvePending, setResolvePending] = useState<((value: boolean) => void) | null>(null);
  const request = (details: SpendRequest): Promise<boolean> => {
    if ((details.providerId ?? details.provider).startsWith("local_")) return Promise.resolve(true);
    const threshold = readThreshold();
    if (
      hasRememberedThreshold() &&
      details.estimatedTotal !== null &&
      details.estimatedTotal !== undefined &&
      details.estimatedTotal < threshold
    )
      return Promise.resolve(true);
    return new Promise((resolve) => {
      setPending(details);
      setResolvePending(() => resolve);
    });
  };
  const close = (accepted: boolean) => {
    resolvePending?.(accepted);
    setPending(null);
    setResolvePending(null);
  };
  const dialog = pending ? (
    <SpendConfirmDialog
      request={pending}
      onCancel={() => close(false)}
      onConfirm={() => close(true)}
    />
  ) : null;
  return { request, dialog, threshold: readThreshold(), reset: resetThreshold };
}

function SpendConfirmDialog({
  request,
  onCancel,
  onConfirm,
}: {
  request: SpendRequest;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const [remember, setRemember] = useState(false);
  const [threshold, setThreshold] = useState(readThreshold());
  const confirm = () => {
    if (remember) writeThreshold(Math.max(0, threshold));
    onConfirm();
  };
  return (
    <Dialog
      title={t("spend.title")}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <button className="btn" onClick={onCancel} autoFocus>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" onClick={confirm}>
            {t("spend.create")}
          </button>
        </>
      }
    >
      <dl className="kv">
        <dt>{t("spend.provider")}</dt>
        <dd>{request.provider}</dd>
        <dt>{t("spend.model")}</dt>
        <dd>{request.model}</dd>
        <dt>{t("spend.images")}</dt>
        <dd>{request.imageCount}</dd>
        <dt>{t("spend.estimate")}</dt>
        <dd>{request.costText || t("spend.unknown")}</dd>
      </dl>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={remember}
          onChange={(event) => setRemember(event.target.checked)}
        />
        {t("spend.remember", { threshold })}
      </label>
      {remember && (
        <input
          className="input"
          type="number"
          min={0}
          value={threshold}
          aria-label={t("spend.threshold")}
          onChange={(event) => setThreshold(Number(event.target.value) || 0)}
        />
      )}
      <button
        className="link-btn"
        onClick={() => {
          resetThreshold();
          setRemember(false);
          setThreshold(DEFAULT_SPEND_THRESHOLD);
        }}
      >
        {t("spend.reset")}
      </button>
      {request.children}
    </Dialog>
  );
}
