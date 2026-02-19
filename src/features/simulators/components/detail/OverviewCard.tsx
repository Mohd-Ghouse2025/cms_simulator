import clsx from "clsx";
import { Plug } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import styles from "../../SimulatorDetailPage.module.css";

export type OverviewField = { label: string; value: string | number };

export type OverviewCardProps = {
  isCharging: boolean;
  toggleDisabled: boolean;
  toggleLabel: string;
  startToggleHint?: string;
  onToggleClick: () => void;
  onShowStopModal: () => void;
  cmsConnected: boolean;
  showConnectControl: boolean;
  showDisconnectControl: boolean;
  connectControlDisabled: boolean;
  disconnectControlDisabled: boolean;
  connectControlTitle?: string;
  disconnectControlTitle?: string;
  connectButtonLabel: string;
  disconnectButtonLabel: string;
  onConnect: () => void;
  onDisconnect: () => void;
  overviewFields: OverviewField[];
  lastHeartbeatLabel: string;
  commandBusy: string | null;
};

export const OverviewCard = ({
  isCharging,
  toggleDisabled,
  toggleLabel,
  startToggleHint,
  onToggleClick,
  onShowStopModal,
  cmsConnected,
  showConnectControl,
  showDisconnectControl,
  connectControlDisabled,
  disconnectControlDisabled,
  connectControlTitle,
  disconnectControlTitle,
  connectButtonLabel,
  disconnectButtonLabel,
  onConnect,
  onDisconnect,
  overviewFields,
  lastHeartbeatLabel,
  commandBusy
}: OverviewCardProps) => (
  <Card className={clsx(styles.overviewCard, styles.stretchCard)}>
    <div className={styles.cardHeader}>
      <div>
        <span className={styles.cardEyebrow}>Simulator</span>
        <h2 className={styles.cardTitle}>Overview</h2>
      </div>
    </div>
    <div className={styles.toggleRow}>
      <Button
        variant="secondary"
        className={clsx(styles.controlToggle, isCharging && styles.controlToggleStop)}
        disabled={toggleDisabled}
        onClick={onToggleClick}
        title={startToggleHint}
      >
        {toggleLabel}
      </Button>
      {isCharging ? (
        <button
          type="button"
          className={styles.subtleAction}
          disabled={commandBusy === "stop"}
          onClick={onShowStopModal}
        >
          Advanced stop options
        </button>
      ) : null}
    </div>
    {!cmsConnected ? (
      <div className={styles.cmsWarning} role="status">
        <strong>CMS offline.</strong> Reconnect to resume heartbeats and enable session controls.
      </div>
    ) : null}
    {(showConnectControl || showDisconnectControl) && (
      <div className={styles.connectionControls}>
        {showConnectControl ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className={styles.connectionButton}
            disabled={connectControlDisabled}
            title={connectControlTitle}
            icon={<Plug size={16} />}
            onClick={onConnect}
          >
            {connectButtonLabel}
          </Button>
        ) : null}
        {showDisconnectControl ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className={styles.connectionButton}
            disabled={disconnectControlDisabled}
            title={disconnectControlTitle}
            icon={<Plug size={16} />}
            onClick={onDisconnect}
          >
            {disconnectButtonLabel}
          </Button>
        ) : null}
      </div>
    )}
    <div className={styles.overviewGrid}>
      {overviewFields.map((field) => (
        <div key={field.label} className={styles.overviewItem}>
          <span className={styles.statLabel}>{field.label}</span>
          <span className={styles.statValue}>{field.value}</span>
        </div>
      ))}
    </div>
    <div className={styles.lastHeartbeat}>
      <span>Last heartbeat</span>
      <span>{lastHeartbeatLabel}</span>
    </div>
  </Card>
);
