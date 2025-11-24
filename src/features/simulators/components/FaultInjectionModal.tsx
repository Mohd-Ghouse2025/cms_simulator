import { FormEvent, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/common/Modal";
import { Button } from "@/components/common/Button";
import { FaultDefinition, SimulatedConnector } from "@/types";
import styles from "./ActionModal.module.css";

type FaultInjectionModalProps = {
  open: boolean;
  onClose: () => void;
  connectors: SimulatedConnector[];
  definitions: FaultDefinition[];
  submitting: boolean;
  onSubmit: (payload: { connectorId: number; faultCode: string; status: string }) => Promise<void>;
  error?: string | null;
};

export const FaultInjectionModal = ({
  open,
  onClose,
  connectors,
  definitions,
  submitting,
  onSubmit,
  error
}: FaultInjectionModalProps) => {
  const defaultConnector = connectors[0]?.connector_id ?? 1;
  const [selectedConnector, setSelectedConnector] = useState(defaultConnector);
  const [selectedDefinition, setSelectedDefinition] = useState<number | "">("");
  const [status, setStatus] = useState("Faulted");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedConnector(defaultConnector);
      setSelectedDefinition(definitions[0]?.id ?? "");
      setStatus("Faulted");
      setLocalError(null);
    }
  }, [open, defaultConnector, definitions]);

  const selectedFault = useMemo(
    () => definitions.find((definition) => definition.id === selectedDefinition),
    [definitions, selectedDefinition]
  );

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    const definition = selectedFault;
    if (!definition) {
      setLocalError("Choose a fault definition to inject.");
      return;
    }
    try {
      await onSubmit({
        connectorId: selectedConnector,
        faultCode: definition.fault_code,
        status: status.trim() || "Faulted"
      });
    } catch (submitError) {
      if (submitError instanceof Error) {
        setLocalError(submitError.message);
      } else {
        setLocalError("Failed to inject fault.");
      }
    }
  };

  return (
    <Modal title="Inject Fault" open={open} onClose={onClose}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <p className={styles.helper}>
          Sends a simulator:fault command so the station broadcasts a StatusNotification with the
          selected error code.
        </p>
        <label className={styles.label}>
          Fault definition
          <select
            className={styles.select}
            value={selectedDefinition ?? ""}
            disabled={!definitions.length || submitting}
            onChange={(event) => setSelectedDefinition(Number(event.target.value))}
          >
            {!definitions.length ? <option>No fault definitions available</option> : null}
            {definitions.map((definition) => (
              <option key={definition.id} value={definition.id}>
                {definition.fault_code} · {definition.description ?? "No description"}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.label}>
          Connector
          <select
            className={styles.select}
            value={selectedConnector}
            onChange={(event) => setSelectedConnector(Number(event.target.value))}
            disabled={submitting}
          >
            {connectors.map((connector) => (
              <option key={connector.connector_id} value={connector.connector_id}>
                #{connector.connector_id} · {connector.format ?? "Connector"}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.label}>
          Reported status
          <input
            className={styles.input}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            placeholder="Faulted"
            maxLength={32}
            disabled={submitting}
          />
          <span className={styles.helper}>Controls the StatusNotification status field.</span>
        </label>
        <p className={styles.helper}>
          Central system will receive a command log entry referencing simulator:fault.
        </p>
        {localError ? <span className={styles.error}>{localError}</span> : null}
        {error ? <span className={styles.error}>{error}</span> : null}
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={submitting || !definitions.length}>
            {submitting ? "Injecting…" : "Inject fault"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
