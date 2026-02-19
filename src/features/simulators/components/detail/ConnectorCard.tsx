import clsx from "clsx";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { DataTable } from "@/components/common/DataTable";
import styles from "../../SimulatorDetailPage.module.css";
import { ConnectorSummary, ResetFlowState } from "../../types/detail";

export type ConnectorSelectOption = { id: number; label: string };

export type ConnectorCardProps = {
  connectorsForCards: ConnectorSummary[];
  connectorSelectOptions: ConnectorSelectOption[];
  actionConnectorId: number | null;
  connectorTargetSelectId: string;
  lifecycleBadgeClass: string;
  lifecycleLabel: string;
  commandBusy: string | null;
  commandConnectorId: number | null;
  resetFlow: ResetFlowState | null;
  resetStatusLabel: string | null;
  faultButtonDisabled: boolean;
  ocppCapabilities: string[];
  capabilitiesJson: string;
  resolveConnectorChipClass: (status?: string) => string;
  onSelectConnector: (connectorId: number) => void;
  onPlug: (connectorId: number) => void;
  onUnplug: (connectorId: number) => void;
  onShowResetModal: () => void;
  onShowForceResetModal: () => void;
  onShowFaultModal: () => void;
};

export const ConnectorCard = ({
  connectorsForCards,
  connectorSelectOptions,
  actionConnectorId,
  connectorTargetSelectId,
  lifecycleBadgeClass,
  lifecycleLabel,
  commandBusy,
  commandConnectorId,
  resetFlow,
  resetStatusLabel,
  faultButtonDisabled,
  ocppCapabilities,
  capabilitiesJson,
  resolveConnectorChipClass,
  onSelectConnector,
  onPlug,
  onUnplug,
  onShowResetModal,
  onShowForceResetModal,
  onShowFaultModal
}: ConnectorCardProps) => (
  <Card className={clsx(styles.connectorsCard, styles.stretchCard)}>
    <div className={styles.cardHeader}>
      <div>
        <span className={styles.cardEyebrow}>Connectors</span>
        <h2 className={styles.cardTitle}>Connector Details</h2>
      </div>
      <div className={styles.connectorHeaderActions}>
        <span className={lifecycleBadgeClass}>{lifecycleLabel}</span>
        {connectorSelectOptions.length ? (
          <div className={styles.connectorTargetSelector}>
            <label className={styles.connectorTargetLabel} htmlFor={connectorTargetSelectId}>
              Action target
            </label>
            <select
              id={connectorTargetSelectId}
              className={styles.connectorTargetSelect}
              value={actionConnectorId ?? connectorSelectOptions[0].id ?? ""}
              onChange={(event) => onSelectConnector(Number(event.target.value))}
              disabled={commandBusy !== null}
            >
              {connectorSelectOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          disabled={commandBusy !== null}
          onClick={onShowResetModal}
        >
          {commandBusy === "reset" ? "Resetting…" : "Reset Charger"}
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={commandBusy !== null}
          onClick={onShowForceResetModal}
        >
          {commandBusy === "force-reset" ? "Force resetting…" : "Force Reset"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={faultButtonDisabled}
          onClick={onShowFaultModal}
          title={
            faultButtonDisabled
              ? "Add fault definitions to enable injections."
              : "Simulate a StatusNotification fault"
          }
        >
          Inject Fault
        </Button>
        {resetStatusLabel ? (
          <span
            className={clsx(
              styles.resetStatusBadge,
              resetFlow?.stage === "reconnected"
                ? styles.resetStatusSuccess
                : styles.resetStatusPending
            )}
          >
            {resetStatusLabel}
          </span>
        ) : null}
      </div>
    </div>
    {connectorsForCards.length ? (
      <>
        <div className={styles.connectorsList}>
          {connectorsForCards.map((summary) => {
            const status = summary.statusLabel;
            const isSelected = summary.connectorId === actionConnectorId;
            const plugging = commandBusy === "plug" && commandConnectorId === summary.connectorId;
            const unplugging = commandBusy === "unplug" && commandConnectorId === summary.connectorId;
            const isPlugged = summary.isPlugged;
            return (
              <div
                key={summary.connectorId}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                onClick={() => onSelectConnector(summary.connectorId)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectConnector(summary.connectorId);
                  }
                }}
                className={clsx(
                  styles.connectorChip,
                  resolveConnectorChipClass(summary.connectorStatus),
                  styles.connectorChipInteractive,
                  isSelected && styles.connectorChipActive
                )}
              >
                <span className={styles.connectorId}>#{summary.connectorId}</span>
                {summary.connector?.format ? (
                  <span className={styles.connectorMeta}>{summary.connector.format}</span>
                ) : null}
                {summary.connector?.max_kw ? (
                  <span className={styles.connectorMeta}>{summary.connector.max_kw} kW</span>
                ) : null}
                <span className={styles.connectorStatus}>{status}</span>
                <div className={styles.connectorActions}>
                  {!isPlugged ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={plugging || unplugging}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlug(summary.connectorId);
                      }}
                    >
                      {plugging ? "Plugging…" : "Plug"}
                    </Button>
                  ) : null}
                  {isPlugged ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={plugging || unplugging}
                      onClick={(e) => {
                        e.stopPropagation();
                        onUnplug(summary.connectorId);
                      }}
                    >
                      {unplugging ? "Unplugging…" : "Unplug"}
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        <DataTable
          data={connectorsForCards}
          className={styles.connectorTable}
          getRowId={(row) => row.connector?.id ?? row.connectorId}
          columns={[
            { header: "Connector", accessor: (row) => `#${row.connectorId}` },
            { header: "Format", accessor: (row) => row.connector?.format ?? "—" },
            { header: "Max kW", accessor: (row) => (row.connector?.max_kw ? `${row.connector?.max_kw}` : "—") },
            { header: "Phase", accessor: (row) => row.connector?.phase_count ?? "—" },
            { header: "Status", accessor: (row) => row.statusLabel }
          ]}
        />
      </>
    ) : (
      <p className={styles.telemetryPlaceholder}>Connector catalog sync pending.</p>
    )}
    <div className={styles.capabilitiesSection}>
      <span className={styles.capabilitiesLabel}>Capabilities</span>
      <div className={styles.capabilityChips}>
        {ocppCapabilities.map((capability) => (
          <span key={capability} className={styles.capabilityChip}>
            {capability}
          </span>
        ))}
      </div>
      <div className={styles.capabilitiesBox}>
        <span className={styles.capabilitiesSubLabel}>Smart Charging Profile</span>
        <pre className={styles.capabilitiesCode}>{capabilitiesJson}</pre>
      </div>
    </div>
  </Card>
);
