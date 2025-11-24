import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Modal } from "@/components/common/Modal";
import { Button } from "@/components/common/Button";
import { useTenantApi } from "@/hooks/useTenantApi";
import { useNotificationStore } from "@/store/notificationStore";
import { queryKeys } from "@/lib/queryKeys";
import { SimulatedCharger } from "@/types";
import styles from "./AddSimulatorModal.module.css";

interface AddSimulatorModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

interface ChargerFeatureCollection {
  type: string;
  features: ChargerFeature[];
}

interface ChargerFeature {
  id: number;
  properties: {
    charger_id: string;
    name?: string;
    alias?: string;
    online?: boolean | string;
    location?: string;
  };
}

export const AddSimulatorModal = ({ open, onClose, onCreated }: AddSimulatorModalProps) => {
  const api = useTenantApi();
  const pushToast = useNotificationStore((state) => state.pushToast);
  const [selectedCharger, setSelectedCharger] = useState<string>("");
  const [alias, setAlias] = useState("");
  const [protocol, setProtocol] = useState("1.6j");
  const [simulatorVersion, setSimulatorVersion] = useState("");
  const [firmwareBaseline, setFirmwareBaseline] = useState("");
  const [heartbeatInterval, setHeartbeatInterval] = useState("60");
  const [meterInterval, setMeterInterval] = useState("1");
  const [statusInterval, setStatusInterval] = useState("60");
  const [allowedCidrs, setAllowedCidrs] = useState("");
  const [notes, setNotes] = useState("");
  const [requireTls, setRequireTls] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const chargersQuery = useQuery({
    queryKey: queryKeys.chargers,
    enabled: open,
    queryFn: async () =>
      api.request<{
        count: number;
        results: ChargerFeatureCollection;
      }>("/api/ocpp/chargers/", {
        query: { page_size: 200 }
      })
  });

  const simulatorsQuery = useQuery({
    queryKey: queryKeys.simulators(),
    enabled: open,
    queryFn: async () =>
      api.request<{ count: number; results: SimulatedCharger[] }>(
        "/api/ocpp-simulator/simulated-chargers/",
        { query: { page_size: 200 } }
      )
  });

  const simulatedChargerIds = useMemo(() => {
    const list = simulatorsQuery.data?.results ?? [];
    return new Set(list.map((sim) => sim.charger));
  }, [simulatorsQuery.data?.results]);

  const options = useMemo(() => {
    const all = chargersQuery.data?.results?.features ?? [];
    if (!simulatedChargerIds.size) {
      return all;
    }
    return all.filter((feature) => !simulatedChargerIds.has(feature.id));
  }, [chargersQuery.data?.results, simulatedChargerIds]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCharger) {
        throw new Error("Select a charger to simulate");
      }
      return api.request("/api/ocpp-simulator/simulated-chargers/", {
        method: "POST",
        body: {
          charger: Number(selectedCharger),
          alias: alias || undefined,
          protocol_variant: protocol,
           simulator_version: simulatorVersion || undefined,
           firmware_baseline: firmwareBaseline || undefined,
           default_heartbeat_interval: heartbeatInterval ? Number(heartbeatInterval) : undefined,
           default_meter_value_interval: meterInterval ? Number(meterInterval) : undefined,
           default_status_interval: statusInterval ? Number(statusInterval) : undefined,
           allowed_cidrs: allowedCidrs
             ? allowedCidrs
                 .split(",")
                 .map((cidr) => cidr.trim())
                 .filter(Boolean)
             : undefined,
          notes: notes || undefined,
          require_tls: requireTls
        }
      });
    },
    onSuccess: () => {
      pushToast({
        title: "Simulator created",
        description: "Refreshing inventory",
        level: "success",
        timeoutMs: 3500
      });
      setAlias("");
      setNotes("");
      setSimulatorVersion("");
      setFirmwareBaseline("");
      setHeartbeatInterval("60");
      setMeterInterval("1");
      setStatusInterval("60");
      setAllowedCidrs("");
      setRequireTls(false);
      setSelectedCharger("");
      onCreated();
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : "Failed to create simulator");
    }
  });

  useEffect(() => {
    if (!open) {
      setAlias("");
      setNotes("");
      setSimulatorVersion("");
      setFirmwareBaseline("");
      setHeartbeatInterval("60");
      setMeterInterval("1");
      setStatusInterval("60");
      setAllowedCidrs("");
      setRequireTls(false);
      setSelectedCharger("");
      setFormError(null);
    }
  }, [open]);

  const handleChargerChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setSelectedCharger(value);
    const selected = options.find((option) => String(option.id) === value);
    if (selected) {
      const chargerName = selected.properties.charger_id;
      setAlias(chargerName ?? "");
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    createMutation.mutate();
  };

  return (
    <Modal title="New Simulator" open={open} onClose={onClose}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.label}>
          Select Charger
          <select
            className={styles.select}
            value={selectedCharger}
            onChange={handleChargerChange}
            required
            disabled={chargersQuery.isLoading || simulatorsQuery.isLoading}
          >
            <option value="" disabled>
              {chargersQuery.isLoading || simulatorsQuery.isLoading
                ? "Loading chargers…"
                : options.length
                ? "Choose charger"
                : "All chargers already simulated"}
            </option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.properties.charger_id}
                {option.properties.name ? ` – ${option.properties.name}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.label}>
          Name
          <input
            className={styles.input}
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
            placeholder="Simulator name"
          />
        </label>
        <label className={styles.label}>
          Protocol variant
          <select
            className={styles.select}
            value={protocol}
            onChange={(event) => setProtocol(event.target.value)}
          >
            <option value="1.6j">OCPP 1.6J</option>
            <option value="2.0.1">OCPP 2.0.1</option>
          </select>
        </label>
        <label className={styles.label}>
          Simulator version
          <input
            className={styles.input}
            value={simulatorVersion}
            onChange={(event) => setSimulatorVersion(event.target.value)}
            placeholder="sim-1.0"
          />
        </label>
        <label className={styles.label}>
          Firmware baseline
          <input
            className={styles.input}
            value={firmwareBaseline}
            onChange={(event) => setFirmwareBaseline(event.target.value)}
            placeholder="1.0.0"
          />
        </label>
        <div className={styles.gridRow}>
          <label className={styles.label}>
            Heartbeat interval (s)
            <input
              className={styles.input}
              type="number"
              min={5}
              value={heartbeatInterval}
              onChange={(event) => setHeartbeatInterval(event.target.value)}
            />
          </label>
          <label className={styles.label}>
            Meter value interval (s)
            <input
              className={styles.input}
              type="number"
              min={1}
              value={meterInterval}
              onChange={(event) => setMeterInterval(event.target.value)}
            />
            <span className={styles.helper}>Use 1 second for real-time telemetry.</span>
          </label>
          <label className={styles.label}>
            Status interval (s)
            <input
              className={styles.input}
              type="number"
              min={10}
              value={statusInterval}
              onChange={(event) => setStatusInterval(event.target.value)}
            />
          </label>
        </div>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={requireTls}
            onChange={(event) => setRequireTls(event.target.checked)}
          />
          Require TLS connection
        </label>
        <label className={styles.label}>
          Allowed CIDRs (optional, comma separated)
          <textarea
            className={styles.textarea}
            value={allowedCidrs}
            onChange={(event) => setAllowedCidrs(event.target.value)}
            rows={2}
            placeholder="192.168.1.0/24, 10.0.0.0/16"
          />
        </label>
        <label className={styles.label}>
          Notes
          <textarea
            className={styles.textarea}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            placeholder="Describe simulator purpose or bench setup"
          />
        </label>
        {formError ? <p className={styles.error}>{formError}</p> : null}
        <div className={styles.actions}>
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create Simulator"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
};
