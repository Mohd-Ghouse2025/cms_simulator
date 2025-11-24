import { FormEvent, useEffect, useState } from "react";
import { Modal } from "@/components/common/Modal";
import { Button } from "@/components/common/Button";
import { ProtocolVariant, SimulatedCharger } from "@/types";
import styles from "./EditSimulatorModal.module.css";

export type SimulatorUpdatePayload = {
  alias: string;
  protocol_variant: ProtocolVariant;
  simulator_version: string;
  firmware_baseline: string;
  require_tls: boolean;
  allowed_cidrs: string[];
  default_heartbeat_interval: number;
  default_meter_value_interval: number;
  default_status_interval: number;
  smart_charging_profile: Record<string, unknown>;
  ocpp_capabilities: string[];
  notes: string;
};

interface EditSimulatorModalProps {
  open: boolean;
  simulator: SimulatedCharger;
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (payload: SimulatorUpdatePayload) => Promise<void>;
}

const splitList = (value: string): string[] =>
  value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

export const EditSimulatorModal = ({
  open,
  simulator,
  busy,
  onCancel,
  onSubmit
}: EditSimulatorModalProps) => {
  const [alias, setAlias] = useState("");
  const [protocol, setProtocol] = useState<ProtocolVariant>("1.6j");
  const [simulatorVersion, setSimulatorVersion] = useState("");
  const [firmwareBaseline, setFirmwareBaseline] = useState("");
  const [heartbeatInterval, setHeartbeatInterval] = useState("");
  const [meterInterval, setMeterInterval] = useState("");
  const [statusInterval, setStatusInterval] = useState("");
  const [allowedCidrs, setAllowedCidrs] = useState("");
  const [notes, setNotes] = useState("");
  const [requireTls, setRequireTls] = useState(false);
  const [ocppCapabilitiesInput, setOcppCapabilitiesInput] = useState("");
  const [smartChargingProfile, setSmartChargingProfile] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setAlias(simulator.alias ?? "");
    setProtocol(simulator.protocol_variant);
    setSimulatorVersion(simulator.simulator_version ?? "");
    setFirmwareBaseline(simulator.firmware_baseline ?? "");
    setHeartbeatInterval(String(simulator.default_heartbeat_interval ?? 60));
    setMeterInterval(String(simulator.default_meter_value_interval ?? 1));
    setStatusInterval(String(simulator.default_status_interval ?? 60));
    setAllowedCidrs((simulator.allowed_cidrs ?? []).join("\n"));
    setNotes(simulator.notes ?? "");
    setRequireTls(Boolean(simulator.require_tls));
    setOcppCapabilitiesInput((simulator.ocpp_capabilities ?? []).join("\n"));
    const profile = simulator.smart_charging_profile;
    setSmartChargingProfile(
      profile && Object.keys(profile).length ? JSON.stringify(profile, null, 2) : ""
    );
    setError(null);
  }, [open, simulator]);

  const handleClose = () => {
    setError(null);
    onCancel();
  };

  const parseInterval = (value: string, label: string): number | null => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError(`${label} must be a positive number.`);
      return null;
    }
    return parsed;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const heartbeat = parseInterval(heartbeatInterval, "Heartbeat interval");
    if (heartbeat === null) {
      return;
    }
    const meter = parseInterval(meterInterval, "Meter value interval");
    if (meter === null) {
      return;
    }
    const status = parseInterval(statusInterval, "Status interval");
    if (status === null) {
      return;
    }
    let parsedProfile: Record<string, unknown> = {};
    const trimmedProfile = smartChargingProfile.trim();
    if (trimmedProfile) {
      try {
        parsedProfile = JSON.parse(trimmedProfile);
      } catch {
        setError("Smart charging profile must be valid JSON.");
        return;
      }
    }

    const payload: SimulatorUpdatePayload = {
      alias: alias.trim(),
      protocol_variant: protocol,
      simulator_version: simulatorVersion.trim(),
      firmware_baseline: firmwareBaseline.trim(),
      require_tls: requireTls,
      allowed_cidrs: splitList(allowedCidrs),
      default_heartbeat_interval: heartbeat,
      default_meter_value_interval: meter,
      default_status_interval: status,
      smart_charging_profile: parsedProfile,
      ocpp_capabilities: splitList(ocppCapabilitiesInput),
      notes
    };

    try {
      await onSubmit(payload);
      setError(null);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to update simulator.");
      }
    }
  };

  return (
    <Modal title="Edit Simulator" open={open} onClose={handleClose}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.label}>
          Display name
          <input
            className={styles.input}
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
            placeholder="Simulator name"
            disabled={busy}
          />
          <span className={styles.helper}>Shown throughout the UI; leave blank to fallback to charger ID.</span>
        </label>
        <div className={styles.gridRow}>
          <label className={styles.label}>
            Protocol variant
            <select
              className={styles.select}
              value={protocol}
              onChange={(event) => setProtocol(event.target.value as ProtocolVariant)}
              disabled={busy}
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
              disabled={busy}
            />
          </label>
          <label className={styles.label}>
            Firmware baseline
            <input
              className={styles.input}
              value={firmwareBaseline}
              onChange={(event) => setFirmwareBaseline(event.target.value)}
              placeholder="1.0.0"
              disabled={busy}
            />
          </label>
        </div>
        <div className={styles.gridRow}>
          <label className={styles.label}>
            Heartbeat interval (s)
            <input
              className={styles.input}
              type="number"
              min={5}
              value={heartbeatInterval}
              onChange={(event) => setHeartbeatInterval(event.target.value)}
              disabled={busy}
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
              disabled={busy}
            />
          </label>
          <label className={styles.label}>
            Status interval (s)
            <input
              className={styles.input}
              type="number"
              min={10}
              value={statusInterval}
              onChange={(event) => setStatusInterval(event.target.value)}
              disabled={busy}
            />
          </label>
        </div>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={requireTls}
            onChange={(event) => setRequireTls(event.target.checked)}
            disabled={busy}
          />
          Require TLS connection
        </label>
        <label className={styles.label}>
          Allowed CIDRs
          <textarea
            className={styles.textarea}
            rows={2}
            value={allowedCidrs}
            onChange={(event) => setAllowedCidrs(event.target.value)}
            placeholder="192.168.1.0/24, 10.0.0.0/16"
            disabled={busy}
          />
          <span className={styles.helper}>Use commas or new lines for multiple entries. Leave blank to allow all networks.</span>
        </label>
        <label className={styles.label}>
          OCPP Capabilities
          <textarea
            className={styles.textarea}
            rows={2}
            value={ocppCapabilitiesInput}
            onChange={(event) => setOcppCapabilitiesInput(event.target.value)}
            placeholder={`RemoteStartStop
Diagnostics
FirmwareManagement`}
            disabled={busy}
          />
          <span className={styles.helper}>One capability per line or comma separated.</span>
        </label>
        <label className={styles.label}>
          Smart charging profile (JSON)
          <textarea
            className={`${styles.textarea} ${styles.textareaMonospace}`}
            rows={6}
            value={smartChargingProfile}
            onChange={(event) => setSmartChargingProfile(event.target.value)}
            placeholder='{"chargingProfilePurpose":"TxProfile"}'
            disabled={busy}
          />
          <span className={styles.helper}>Provide valid JSON payload. Leave blank to clear the profile.</span>
        </label>
        <label className={styles.label}>
          Notes
          <textarea
            className={styles.textarea}
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Internal notes or bench instructions"
            disabled={busy}
          />
        </label>
        {error ? <p className={styles.error}>{error}</p> : null}
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={handleClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
