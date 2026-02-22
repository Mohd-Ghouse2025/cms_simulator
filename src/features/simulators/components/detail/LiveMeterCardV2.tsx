import clsx from "clsx";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/common/Card";
import styles from "../../SimulatorDetailPage.module.css";
import { ConnectorSummary, TimelineTone } from "../../types/detail";
import { formatCurrency } from "@/lib/currency";
import { formatLocalTimestamp } from "@/lib/time";
import { formatNumber } from "../../detail/detailHelpers";

type LiveMeterCardProps = {
  primaryConnector: ConnectorSummary | null;
  placeholderMessage: string;
  graphIsFrozen: boolean;
  lastSampleIsStale: boolean;
  statusToneClassMap: Record<TimelineTone, string>;
  meterIntervalSeconds?: number | null;
};

const resolveSampleInterval = (samples: ConnectorSummary["samples"]): number | null => {
  if (!samples || samples.length < 2) return null;
  const last = samples.at(-1);
  const prev = samples.at(-2);
  if (!last || !prev) return null;
  const delta = (last.timestamp - prev.timestamp) / 1000;
  return Number.isFinite(delta) ? Math.max(delta, 0) : null;
};

export const LiveMeterCardV2 = ({
  primaryConnector,
  placeholderMessage,
  graphIsFrozen,
  lastSampleIsStale,
  statusToneClassMap,
  meterIntervalSeconds
}: LiveMeterCardProps) => {
  const computeDuration = useCallback(
    (connector: ConnectorSummary | null): string => {
      if (!connector) return "—";
      const startedAt = connector.startedAt ?? connector.lastSampleAt ?? null;
      const completedAt = connector.completedAt ?? null;
      if (!startedAt) return connector.duration ?? "—";
      const startMs = Date.parse(startedAt);
      if (!Number.isFinite(startMs)) return connector.duration ?? "—";
      const endMs =
        completedAt && Number.isFinite(Date.parse(completedAt))
          ? Date.parse(completedAt)
          : Date.now();
      const spanSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
      const h = Math.floor(spanSeconds / 3600)
        .toString()
        .padStart(2, "0");
      const m = Math.floor((spanSeconds % 3600) / 60)
        .toString()
        .padStart(2, "0");
      const s = Math.floor(spanSeconds % 60)
        .toString()
        .padStart(2, "0");
      return `${h}:${m}:${s}`;
    },
    []
  );

  const computeDebugTimer = useCallback((connector: ConnectorSummary | null): string => {
    if (!connector) return "—";
    const startedAt = connector.startedAt ?? connector.lastSampleAt ?? null;
    if (!startedAt) return "—";
    const startMs = Date.parse(startedAt);
    if (!Number.isFinite(startMs)) return "—";

    const completedMs = connector.completedAt ? Date.parse(connector.completedAt) : null;
    const ticking =
      connector.sessionState === "charging" ||
      connector.sessionState === "authorized" ||
      connector.sessionState === "finishing";
    const endMs = ticking ? Date.now() : Number.isFinite(completedMs) ? (completedMs as number) : Date.now();

    const diff = Math.max(0, Math.floor((endMs - startMs) / 1000));
    const h = Math.floor(diff / 3600)
      .toString()
      .padStart(2, "0");
    const m = Math.floor((diff % 3600) / 60)
      .toString()
      .padStart(2, "0");
    const s = Math.floor(diff % 60)
      .toString()
      .padStart(2, "0");
    return `${h}:${m}:${s}`;
  }, []);

  const [liveDuration, setLiveDuration] = useState<string>(() => computeDuration(primaryConnector));
  const [debugTimer, setDebugTimer] = useState<string>(() => computeDebugTimer(primaryConnector));

  useEffect(() => {
    setLiveDuration(computeDuration(primaryConnector));
    setDebugTimer(computeDebugTimer(primaryConnector));
    if (!primaryConnector) return;
    const ticking =
      primaryConnector.sessionState === "charging" ||
      primaryConnector.sessionState === "authorized" ||
      primaryConnector.sessionState === "finishing";
    if (!ticking) return;
    let debugTimer: number | undefined;
    if (process.env.NODE_ENV !== "production") {
      const tickDebug = () => {
        const label = computeDuration(primaryConnector);
        const now = new Date();
        // eslint-disable-next-line no-console
        console.debug("[simulator][duration-tick]", {
          connectorId: primaryConnector.connectorId,
          startedAt: primaryConnector.startedAt ?? null,
          completedAt: primaryConnector.completedAt ?? null,
          sessionState: primaryConnector.sessionState,
          lastSampleAt: primaryConnector.lastSampleAt ?? null,
          nowIso: now.toISOString(),
          label
        });
        if (primaryConnector.samples?.length && label === "—") {
          // eslint-disable-next-line no-console
          console.debug("[simulator][duration-display-miss]", {
            connectorId: primaryConnector.connectorId,
            startedAt: primaryConnector.startedAt ?? null,
            lastSampleAt: primaryConnector.lastSampleAt ?? null,
            sessionState: primaryConnector.sessionState,
            transactionId: primaryConnector.transactionId ?? null
          });
        }
      };
      tickDebug();
      debugTimer = window.setInterval(tickDebug, 5000);
    }

    const timer = window.setInterval(() => {
      const debugLabel = computeDebugTimer(primaryConnector);
      // Use the continuously ticking debug label for the UI duration to avoid any upstream
      // formatting glitches that kept the main duration frozen at 00:00:00.
      setLiveDuration(debugLabel);
      setDebugTimer(debugLabel);
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.debug("[simulator][duration-ui]", {
          connectorId: primaryConnector.connectorId,
          durationLabel: debugLabel,
          ts: new Date().toISOString()
        });
      }
    }, 1000);
    return () => {
      window.clearInterval(timer);
      if (debugTimer !== undefined) {
        window.clearInterval(debugTimer);
      }
    };
  }, [primaryConnector, computeDuration]);

  const latestSample = primaryConnector?.samples?.at(-1) ?? null;
  const previousSample = primaryConnector?.samples?.length && primaryConnector.samples.length > 1
    ? primaryConnector.samples[primaryConnector.samples.length - 2]
    : null;

  const deltaWhFromSamples = (() => {
    if (typeof latestSample?.deltaWh === "number") return Math.max(latestSample.deltaWh, 0);
    if (latestSample && previousSample) return Math.max(latestSample.valueWh - previousSample.valueWh, 0);
    if (typeof primaryConnector?.deltaKwh === "number") return Math.max(primaryConnector.deltaKwh * 1000, 0);
    return null;
  })();

  const voltage = typeof latestSample?.voltageV === "number" ? latestSample.voltageV : null;
  const power = typeof primaryConnector?.powerKw === "number" ? primaryConnector.powerKw : latestSample?.powerKw ?? null;
  const current = typeof primaryConnector?.current === "number" ? primaryConnector.current : latestSample?.currentA ?? null;
  const energyKwh = typeof primaryConnector?.energyKwh === "number" ? primaryConnector.energyKwh : null;
  const meterStartWh = primaryConnector ? Math.max(primaryConnector.meterStartKwh * 1000, 0) : null;
  const meterNowWh = primaryConnector ? Math.max(primaryConnector.meterStopKwh * 1000, 0) : null;
  const sessionInterval = resolveSampleInterval(primaryConnector?.samples ?? []);
  const lastUpdated = primaryConnector?.lastSampleAt
    ? formatLocalTimestamp(primaryConnector.lastSampleAt, { withSeconds: true })
    : "—";

  const limitType = primaryConnector?.limitType ?? null;
  const userLimit = typeof primaryConnector?.userLimit === "number" && Number.isFinite(primaryConnector.userLimit)
    ? primaryConnector.userLimit
    : null;
  const pricePerKwh = typeof primaryConnector?.pricePerKwh === "number" && Number.isFinite(primaryConnector.pricePerKwh)
    ? primaryConnector.pricePerKwh
    : null;
  const costSoFar = typeof primaryConnector?.costSoFar === "number"
    ? primaryConnector.costSoFar
    : energyKwh !== null && pricePerKwh !== null
      ? Number((energyKwh * pricePerKwh).toFixed(2))
      : null;

  const limitProgress = (() => {
    if (!limitType || userLimit === null) return null;
    if (limitType === "KWH" && energyKwh !== null) return Math.min((energyKwh / userLimit) * 100, 100);
    if (limitType === "AMOUNT" && costSoFar !== null) return Math.min((costSoFar / userLimit) * 100, 100);
    return null;
  })();

  const limitRemaining = (() => {
    if (!limitType || userLimit === null) return null;
    if (limitType === "KWH" && energyKwh !== null) return Math.max(userLimit - energyKwh, 0);
    if (limitType === "AMOUNT" && costSoFar !== null) return Math.max(userLimit - costSoFar, 0);
    return null;
  })();

  const meterContextLabel = primaryConnector
    ? `Connector #${primaryConnector.connectorId} · ${primaryConnector.transactionId ? `Tx ${primaryConnector.transactionId}` : "No transaction"} · ${primaryConnector.statusLabel}`
    : null;

  return (
    <Card className={clsx(styles.meterCard, styles.stretchCard)}>
      <section className={styles.meterInfo}>
        <div className={styles.meterHeadline}>
          <div>
            <span className={styles.cardEyebrow}>Live meter values</span>
            <h2 className={styles.cardTitle}>Meter Info</h2>
          </div>
          <div className={styles.meterBadgeGroup}>
            <span
              className={clsx(
                styles.statusChip,
                primaryConnector ? statusToneClassMap[primaryConnector.statusTone ?? "neutral"] : statusToneClassMap.neutral
              )}
            >
              {primaryConnector ? primaryConnector.statusLabel : "Idle"}
            </span>
            <span
              className={clsx(
                styles.telemetryBadge,
                lastSampleIsStale && !graphIsFrozen ? styles.telemetryBadgeStale : undefined
              )}
            >
              {graphIsFrozen ? "Frozen snapshot" : lastSampleIsStale ? "Data stale (>15s)" : "Raw telemetry"}
            </span>
          </div>
        </div>

        {primaryConnector ? (
          <>
            <p className={styles.meterContext}>{meterContextLabel}</p>

            <div className={styles.infoGrid}>
              {/* Primary KPIs */}
              <InfoItem label="Energy" value={energyKwh !== null ? `${energyKwh.toFixed(3)} kWh` : "—"} />
              <InfoItem label="Duration" value={debugTimer} />
              <InfoItem label="Timer (debug)" value={debugTimer} />
              <InfoItem
                label="Cost so far"
                value={costSoFar !== null ? formatCurrency(costSoFar) : "—"}
                hint={pricePerKwh !== null ? `@ ${formatCurrency(pricePerKwh)} / kWh` : undefined}
              />
              <InfoItem
                label="Limit"
                value={resolveLimitLabel(limitType, userLimit)}
                hint={limitRemaining !== null ? renderLimitRemaining(limitType, limitRemaining) : undefined}
              />

              {/* Meter registers */}
              <InfoItem
                label="Meter start"
                value={primaryConnector.meterStartKwh.toFixed(3) + " kWh"}
                hint={meterStartWh !== null ? `${meterStartWh.toFixed(0)} Wh` : null}
              />
              <InfoItem
                label="Meter now"
                value={primaryConnector.meterStopKwh.toFixed(3) + " kWh"}
                hint={meterNowWh !== null ? `${meterNowWh.toFixed(0)} Wh` : null}
              />

              {/* Electrical telemetry */}
              <InfoItem label="Power" value={power !== null ? `${formatNumber(power, { digits: 2 })} kW` : "—"} />
              <InfoItem label="Current" value={current !== null ? `${formatNumber(current, { digits: 1 })} A` : "—"} />
              <InfoItem label="Voltage" value={voltage !== null ? `${formatNumber(voltage, { digits: 1 })} V` : "—"} />

              {/* Diagnostics */}
              <InfoItem
                label="Δ since last"
                value={deltaWhFromSamples !== null ? `${deltaWhFromSamples.toFixed(0)} Wh` : "—"}
                hint={deltaWhFromSamples !== null ? `+${(deltaWhFromSamples / 1000).toFixed(3)} kWh` : undefined}
              />
              <InfoItem
                label="Last sample"
                value={lastUpdated}
                hint={sessionInterval ? `Interval ${sessionInterval.toFixed(1)}s` : meterIntervalSeconds ? `Interval ${meterIntervalSeconds}s` : null}
              />
              <InfoItem
                label="Transaction"
                value={primaryConnector.transactionId ?? "—"}
                hint={primaryConnector.idTag ? `ID Tag ${primaryConnector.idTag}` : null}
              />
            </div>

            <LiveProgress
              limitType={limitType}
              userLimit={userLimit}
              energyKwh={energyKwh}
              costSoFar={costSoFar}
              pricePerKwh={pricePerKwh}
              progressPercent={limitProgress}
              remaining={limitRemaining}
            />
          </>
        ) : (
          <p className={styles.telemetryPlaceholder}>{placeholderMessage}</p>
        )}
      </section>
    </Card>
  );
};

const InfoItem = ({ label, value, hint }: { label: string; value: string; hint?: string | null }) => (
  <div className={styles.infoItem}>
    <span className={styles.statLabel}>{label}</span>
    <span className={styles.infoValue}>{value}</span>
    {hint ? <span className={styles.infoHint}>{hint}</span> : null}
  </div>
);

const resolveLimitLabel = (limitType: ConnectorSummary["limitType"], userLimit: number | null) => {
  if (!limitType || userLimit === null) return "None";
  if (limitType === "KWH") return `${userLimit.toFixed(3)} kWh`;
  if (limitType === "AMOUNT") return formatCurrency(userLimit);
  return "None";
};

const renderLimitRemaining = (limitType: ConnectorSummary["limitType"], remaining: number | null) => {
  if (remaining === null) return undefined;
  if (limitType === "KWH") return `Remaining ${remaining.toFixed(3)} kWh`;
  if (limitType === "AMOUNT") return `Remaining ${formatCurrency(remaining)}`;
  return undefined;
};

const LiveProgress = ({
  limitType,
  userLimit,
  energyKwh,
  costSoFar,
  pricePerKwh,
  progressPercent,
  remaining
}: {
  limitType: ConnectorSummary["limitType"];
  userLimit: number | null;
  energyKwh: number | null;
  costSoFar: number | null;
  pricePerKwh: number | null;
  progressPercent: number | null;
  remaining: number | null;
}) => {
  const hasLimit = Boolean(limitType && userLimit && userLimit > 0);
  if (!hasLimit) return null;

  return (
    <div className={styles.progressSection}>
      {hasLimit && progressPercent !== null ? (
        <>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
          </div>
          <div className={styles.progressMeta}>
            <span>
              Limit {limitType === "KWH" ? `${userLimit?.toFixed(3)} kWh` : `${formatCurrency(userLimit ?? null)}`}
            </span>
            <span>{progressPercent.toFixed(0)}%</span>
          </div>
          {limitType === "KWH" && remaining !== null ? (
            <div className={styles.progressSub}>Remaining {remaining.toFixed(3)} kWh</div>
          ) : null}
          {limitType === "AMOUNT" && remaining !== null ? (
            <div className={styles.progressSub}>Remaining {formatCurrency(remaining)}</div>
          ) : null}
          {pricePerKwh !== null ? (
            <div className={styles.progressSub}>Price {formatCurrency(pricePerKwh)} per kWh</div>
          ) : null}
        </>
      ) : null}
    </div>
  );
};
