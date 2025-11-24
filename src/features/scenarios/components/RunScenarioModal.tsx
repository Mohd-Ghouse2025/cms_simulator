import { FormEvent, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/common/Modal";
import { Button } from "@/components/common/Button";
import { SimulatorInstance } from "@/types";
import styles from "./RunScenarioModal.module.css";

interface RunScenarioModalProps {
  open: boolean;
  onClose: () => void;
  scenarioName: string;
  instances: SimulatorInstance[];
  instanceLabelMap: Record<number, string>;
  loadingInstances: boolean;
  refreshInstances: () => void;
  submitting: boolean;
  onSubmit: (instanceId: number) => void;
  error: string | null;
}

const formatDate = (value?: string | null) => {
  if (!value) {
    return "Not started";
  }
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

export const RunScenarioModal = ({
  open,
  onClose,
  scenarioName,
  instances,
  instanceLabelMap,
  loadingInstances,
  refreshInstances,
  submitting,
  onSubmit,
  error
}: RunScenarioModalProps) => {
  const [selectedInstance, setSelectedInstance] = useState<number | null>(null);

  const options = useMemo(
    () =>
      instances.map((instance) => ({
        id: instance.id,
        label: instanceLabelMap[instance.sim] ?? `Simulator ${instance.sim}`,
        startedAt: formatDate(instance.started_at),
        lastHeartbeat: formatDate(instance.last_heartbeat)
      })),
    [instances, instanceLabelMap]
  );

  useEffect(() => {
    if (!open) {
      setSelectedInstance(null);
      return;
    }
    if (instances.length) {
      setSelectedInstance(instances[0].id);
    } else {
      setSelectedInstance(null);
    }
  }, [open, instances]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedInstance || submitting) {
      return;
    }
    onSubmit(selectedInstance);
  };

  const title = scenarioName ? `Run "${scenarioName}"` : "Run Scenario";

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <p className={styles.intro}>
          Choose a running simulator instance to execute this scenario against. The simulator must be
          connected so that the scripted steps can dispatch commands immediately.
        </p>
        {loadingInstances ? (
          <div className={styles.state}>Loading simulator instances...</div>
        ) : null}
        {!loadingInstances && !options.length ? (
          <div className={styles.state}>
            <p>No running simulator instances available.</p>
            <Button type="button" variant="secondary" onClick={refreshInstances}>
              Refresh list
            </Button>
          </div>
        ) : null}
        {options.length ? (
          <div className={styles.instanceList}>
            {options.map((option) => (
              <label key={option.id} className={styles.instanceOption}>
                <input
                  type="radio"
                  name="simulator_instance"
                  value={option.id}
                  checked={selectedInstance === option.id}
                  onChange={() => setSelectedInstance(option.id)}
                />
                <div>
                  <div className={styles.instanceLabel}>{option.label}</div>
                  <div className={styles.instanceMeta}>
                    <span>Started: {option.startedAt}</span>
                    <span>Last heartbeat: {option.lastHeartbeat}</span>
                  </div>
                </div>
              </label>
            ))}
          </div>
        ) : null}
        {error ? <div className={styles.error}>{error}</div> : null}
        <div className={styles.footer}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!selectedInstance || submitting || loadingInstances || !options.length}
          >
            {submitting ? "Queuing..." : "Run Scenario"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
