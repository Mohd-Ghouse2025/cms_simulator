import { FormEvent, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Modal } from "@/components/common/Modal";
import { Button } from "@/components/common/Button";
import { SimulatedConnector } from "@/types";
import styles from "./ActionModal.module.css";
import { connectorStatusTone, formatConnectorStatusLabel, normalizeConnectorStatus } from "../utils/status";

interface RemoteStopModalProps {
  open: boolean;
  connectors: SimulatedConnector[];
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (payload: { connectorId?: number; transactionId?: string }) => Promise<void>;
}

export const RemoteStopModal = ({
  open,
  connectors,
  busy,
  onCancel,
  onSubmit
}: RemoteStopModalProps) => {
  const firstConnectorId = useMemo(() => connectors[0]?.connector_id, [connectors]);
  const [useConnector, setUseConnector] = useState(true);
  const [connectorId, setConnectorId] = useState<number | undefined>(firstConnectorId);
  const [transactionId, setTransactionId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const selectedConnector = useMemo(
    () => connectors.find((connector) => connector.connector_id === connectorId),
    [connectors, connectorId]
  );
  const connectorStatus = useMemo(
    () => normalizeConnectorStatus(selectedConnector?.initial_status ?? "AVAILABLE"),
    [selectedConnector]
  );
  const statusLabel = useMemo(() => formatConnectorStatusLabel(connectorStatus), [connectorStatus]);
  const statusToneClass = useMemo(() => {
    switch (connectorStatusTone(connectorStatus)) {
      case "success":
        return styles.toneSuccess;
      case "warning":
        return styles.toneWarning;
      case "danger":
        return styles.toneDanger;
      case "info":
        return styles.toneInfo;
      default:
        return styles.toneNeutral;
    }
  }, [connectorStatus]);

  useEffect(() => {
    if (open) {
      setConnectorId(firstConnectorId);
      setTransactionId("");
      setUseConnector(true);
      setError(null);
    }
  }, [open, firstConnectorId]);

  const handleClose = () => {
    setError(null);
    setConnectorId(firstConnectorId);
    setTransactionId("");
    setUseConnector(true);
    onCancel();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!useConnector && !transactionId.trim()) {
      setError("Provide a transaction ID or choose a connector.");
      return;
    }

    if (useConnector && connectorId === undefined) {
      setError("Select a connector to stop.");
      return;
    }

    try {
      await onSubmit({
        connectorId: useConnector ? connectorId : undefined,
        transactionId: transactionId.trim() || undefined
      });
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to send RemoteStopTransaction. Please retry.");
      }
    }
  };

  return (
    <Modal title="Stop Charging Session" open={open} onClose={handleClose}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label}>Stop by</label>
          <div>
            <label className={styles.helper}>
              <input
                type="radio"
                name="stop-mode"
                checked={useConnector}
                onChange={() => setUseConnector(true)}
                disabled={busy}
              />
              &nbsp;Connector
            </label>
            &nbsp;&nbsp;
            <label className={styles.helper}>
              <input
                type="radio"
                name="stop-mode"
                checked={!useConnector}
                onChange={() => setUseConnector(false)}
                disabled={busy}
              />
              &nbsp;Transaction ID
            </label>
          </div>
        </div>

        {useConnector ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="stop-connector">
              Connector
            </label>
            <select
              id="stop-connector"
              className={styles.select}
              value={connectorId ?? ""}
              onChange={(event) => setConnectorId(Number(event.target.value))}
              disabled={busy}
            >
              {connectors.map((connector) => (
                <option key={connector.connector_id} value={connector.connector_id}>
                  #{connector.connector_id} · {connector.format ?? "Connector"} ·{" "}
                  {connector.max_kw ? `${connector.max_kw} kW` : "Power unknown"}
                </option>
              ))}
            </select>
            <span className={styles.helper}>
              Sends RemoteStopTransaction for the selected connector&apos;s active session.
            </span>
            <div className={styles.statusRow}>
              <div className={styles.statusMeta}>
                <span className={styles.label}>Status</span>
                <span className={clsx(styles.statusBadge, statusToneClass)}>
                  <span className={styles.statusDot} />
                  {statusLabel}
                </span>
              </div>
              <span className={styles.helper}>
                Useful to verify the connector is Charging or Finishing before sending a stop.
              </span>
            </div>
          </div>
        ) : (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="transaction-id">
              Transaction ID
            </label>
            <input
              id="transaction-id"
              className={styles.input}
              value={transactionId}
              maxLength={64}
              disabled={busy}
              onChange={(event) => setTransactionId(event.target.value)}
              placeholder="CMS transaction identifier"
            />
            <span className={styles.helper}>
              Provide the CMS transaction ID returned by StartTransaction/TransactionEvent.
            </span>
          </div>
        )}

        {error ? <span className={styles.error}>{error}</span> : null}
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={handleClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={busy}>
            {busy ? "Stopping…" : "Stop charging"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
