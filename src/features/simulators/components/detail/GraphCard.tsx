import clsx from "clsx";
import { Card } from "@/components/common/Card";
import { LiveGraph } from "../LiveGraph";
import styles from "../../SimulatorDetailPage.module.css";
import { ConnectorSummary, SessionLifecycle } from "../../types/detail";
import { NormalizedSample } from "../../graphHelpers";

export type GraphCardProps = {
  connectorsSummary: ConnectorSummary[];
  activeConnectorId: number | null;
  primaryConnector: ConnectorSummary | null;
  graphSamples: NormalizedSample[];
  lifecycleState: string;
  graphIsFrozen: boolean;
  onSelectConnector: (connectorId: number) => void;
};

export const GraphCard = ({
  connectorsSummary,
  activeConnectorId,
  primaryConnector,
  graphSamples,
  lifecycleState,
  graphIsFrozen,
  onSelectConnector
}: GraphCardProps) => {
  const graphBadgeItems =
    graphIsFrozen
      ? [
          {
            key: "snapshot",
            label: "Frozen snapshot",
            className: clsx(styles.graphMetaBadge, styles.graphMetaBadgeSecondary)
          }
        ]
      : [
          {
            key: "raw",
            label: "Raw telemetry",
            className: clsx(styles.graphMetaBadge, styles.graphMetaBadgeSecondary)
          },
          {
            key: "smooth",
            label: "Smoothed overlay",
            className: styles.graphMetaBadge
          }
        ];

  return (
    <Card className={clsx(styles.graphCard, styles.stretchCard)}>
      <section className={styles.graphPanel}>
        <div className={styles.graphHeader}>
          <div>
            <span className={styles.cardEyebrow}>
              {primaryConnector ? `Connector #${primaryConnector.connectorId}` : "Connector"}
            </span>
            <h2 className={styles.cardTitle}>Live Power · Current · Energy</h2>
          </div>
          <div className={styles.graphStatus}>
            <span className={styles.graphStatusLabel}>
              {primaryConnector ? primaryConnector.statusLabel : "Idle"}
            </span>
            <span className={styles.graphStatusMeta}>
              {primaryConnector?.transactionId
                ? `Tx ${primaryConnector.transactionId}`
                : primaryConnector
                  ? "No transaction"
                  : "Select a connector"}
            </span>
          </div>
        </div>
        <div className={styles.connectorSwitcher}>
          {connectorsSummary.length ? (
            connectorsSummary.map((summary) => {
              const isActive = summary.connectorId === activeConnectorId;
              const hasTelemetry = summary.samples.length > 0;
              return (
                <button
                  key={summary.connectorId}
                  type="button"
                  className={clsx(
                    styles.connectorToggle,
                    isActive && styles.connectorToggleActive,
                    !hasTelemetry && styles.connectorToggleMuted
                  )}
                  onClick={() => onSelectConnector(summary.connectorId)}
                  aria-pressed={isActive}
                >
                  Connector #{summary.connectorId}
                  {!hasTelemetry ? (
                    <span className={styles.connectorToggleHint}>No recent data</span>
                  ) : null}
                </button>
              );
            })
          ) : (
            <span className={styles.connectorSwitcherEmpty}>No connectors streaming telemetry.</span>
          )}
        </div>
        <LiveGraph
          samples={graphSamples}
          chargingState={lifecycleState}
          sessionState={primaryConnector?.sessionState as SessionLifecycle | undefined}
          connectorId={primaryConnector?.connectorId ?? null}
          frozen={graphIsFrozen}
        />
        <div className={styles.graphFooter}>
          <span className={styles.graphSummary}>
            Total energy delivered: <strong>{(primaryConnector?.energyKwh ?? 0).toFixed(3)} kWh</strong>
          </span>
          <div className={styles.graphMetaBadges}>
            {graphBadgeItems.map((badge) => (
              <span key={badge.key} className={badge.className}>
                {badge.label}
              </span>
            ))}
          </div>
          <p className={styles.graphCaption}>
            Tooltips and totals reflect raw CMS samples; the thicker line applies a light-moving average for readability.
          </p>
        </div>
      </section>
    </Card>
  );
};
