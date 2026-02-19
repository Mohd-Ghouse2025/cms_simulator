import clsx from "clsx";
import { Card } from "@/components/common/Card";
import styles from "../../SimulatorDetailPage.module.css";
import { ConnectorSummary, TimelineTone } from "../../types/detail";
import { formatCurrency } from "@/lib/currency";

export type MeterInfoField = { label: string; value: string; hint?: string | null };

export type MeterCardProps = {
  primaryConnector: ConnectorSummary | null;
  meterContextLabel: string | null;
  meterInfoFields: MeterInfoField[];
  meterPlaceholderMessage: string;
  graphIsFrozen: boolean;
  lastSampleIsStale: boolean;
  statusToneClassMap: Record<TimelineTone, string>;
};

export const MeterCard = ({
  primaryConnector,
  meterContextLabel,
  meterInfoFields,
  meterPlaceholderMessage,
  graphIsFrozen,
  lastSampleIsStale,
  statusToneClassMap
}: MeterCardProps) => (
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
              primaryConnector
                ? statusToneClassMap[primaryConnector.statusTone ?? "neutral"]
                : statusToneClassMap.neutral
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
            {meterInfoFields.map((field) => (
              <div key={field.label} className={styles.infoItem}>
                <span className={styles.statLabel}>{field.label}</span>
                <span className={styles.infoValue}>{field.value}</span>
                {field.hint ? <span className={styles.infoHint}>{field.hint}</span> : null}
              </div>
            ))}
          </div>
          <LiveProgress primaryConnector={primaryConnector} />
        </>
      ) : (
        <p className={styles.telemetryPlaceholder}>{meterPlaceholderMessage}</p>
      )}
    </section>
  </Card>
);

const LiveProgress = ({ primaryConnector }: { primaryConnector: ConnectorSummary }) => {
  const deliveredKwh = typeof primaryConnector.energyKwh === "number" ? primaryConnector.energyKwh : null;
  const pricePerKwh =
    typeof primaryConnector.pricePerKwh === "number" && Number.isFinite(primaryConnector.pricePerKwh)
      ? primaryConnector.pricePerKwh
      : null;
  const costSoFar =
    typeof primaryConnector.costSoFar === "number"
      ? primaryConnector.costSoFar
      : deliveredKwh !== null && pricePerKwh !== null
        ? Number((deliveredKwh * pricePerKwh).toFixed(2))
        : null;

  const limitType = primaryConnector.limitType ?? null;
  const userLimit =
    typeof primaryConnector.userLimit === "number" && Number.isFinite(primaryConnector.userLimit)
      ? primaryConnector.userLimit
      : null;

  const hasLimit = Boolean(limitType && userLimit && userLimit > 0);
  const progressPercent = (() => {
    if (!hasLimit || userLimit === null) return null;
    if (limitType === "KWH" && deliveredKwh !== null) {
      return Math.min((deliveredKwh / userLimit) * 100, 100);
    }
    if (limitType === "AMOUNT" && costSoFar !== null) {
      return Math.min((costSoFar / userLimit) * 100, 100);
    }
    return null;
  })();

  const remainingLabel = (() => {
    if (!hasLimit || userLimit === null) return null;
    if (limitType === "KWH") {
      const remaining = deliveredKwh !== null ? Math.max(userLimit - deliveredKwh, 0) : userLimit;
      return `Remaining ${remaining.toFixed(3)} kWh`;
    }
    if (limitType === "AMOUNT") {
      const remaining = costSoFar !== null ? Math.max(userLimit - costSoFar, 0) : userLimit;
      return `Remaining ${formatCurrency(remaining)}`;
    }
    return null;
  })();

  if (deliveredKwh === null && costSoFar === null) {
    return null;
  }

  return (
    <div className={styles.progressSection}>
      <div className={styles.progressRow}>
        <div className={styles.progressStat}>
          <div className={styles.progressLabel}>
            {limitType === "KWH" && hasLimit ? "Energy delivered / Limit" : "Energy delivered"}
          </div>
          <div className={styles.progressValue}>{deliveredKwh !== null ? deliveredKwh.toFixed(3) : "—"} kWh</div>
          {limitType === "KWH" && remainingLabel ? <div className={styles.progressSub}>{remainingLabel}</div> : null}
        </div>
        <div className={styles.progressStat}>
          <div className={styles.progressLabel}>
            {limitType === "AMOUNT" && hasLimit ? "Cost so far / Limit" : "Cost so far"}
          </div>
          <div className={styles.progressValue}>{costSoFar !== null ? formatCurrency(costSoFar) : "—"}</div>
          {limitType === "AMOUNT" && remainingLabel ? <div className={styles.progressSub}>{remainingLabel}</div> : null}
          {pricePerKwh !== null ? (
            <div className={styles.progressSub}>Price {formatCurrency(pricePerKwh)} per kWh</div>
          ) : null}
        </div>
      </div>
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
        </>
      ) : null}
    </div>
  );
};
