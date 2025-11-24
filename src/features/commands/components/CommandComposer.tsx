import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal } from "@/components/common/Modal";
import { Button } from "@/components/common/Button";
import { useTenantApi } from "@/hooks/useTenantApi";
import { queryKeys } from "@/lib/queryKeys";
import { useNotificationStore } from "@/store/notificationStore";
import { ScenarioRun, SimulatedCharger } from "@/types";
import styles from "./CommandComposer.module.css";

interface CommandComposerProps {
  open: boolean;
  onClose: () => void;
}

interface PaginatedResponse<T> {
  count: number;
  results: T[];
}

interface DispatchPayload {
  simulator: number;
  action: string;
  payload: Record<string, unknown>;
  scenario_run?: number;
}

type CommandPresetKey =
  | "RemoteStartTransaction"
  | "RemoteStopTransaction"
  | "UnlockConnector"
  | "ChangeAvailability"
  | "Reset"
  | "ClearCache"
  | "TriggerMessage"
  | "GetDiagnostics"
  | "ChangeConfiguration";

interface CommandPreset {
  label: string;
  description: string;
  payload: Record<string, unknown>;
}

const PRESETS: Record<CommandPresetKey, CommandPreset> = {
  RemoteStartTransaction: {
    label: "Remote Start",
    description: "Initiate a transaction with connector and idTag",
    payload: { connectorId: 1, idTag: "CMS-TAG-123" }
  },
  RemoteStopTransaction: {
    label: "Remote Stop",
    description: "Stop an active transaction by connector or transactionId",
    payload: { connectorId: 1 }
  },
  UnlockConnector: {
    label: "Unlock Connector",
    description: "Force release of a connector is typically used if cable is stuck",
    payload: { connectorId: 1 }
  },
  ChangeAvailability: {
    label: "Change Availability",
    description: "Set connector availability to Operative or Inoperative",
    payload: { connectorId: 1, type: "Operative" }
  },
  Reset: {
    label: "Reset",
    description: "Soft or Hard reset of the charging station",
    payload: { type: "Soft" }
  },
  ClearCache: {
    label: "Clear Cache",
    description: "Clear local authorization cache",
    payload: {}
  },
  TriggerMessage: {
    label: "Trigger Message",
    description: "Request the charger to send a diagnostic message",
    payload: { requestedMessage: "StatusNotification", connectorId: 1 }
  },
  GetDiagnostics: {
    label: "Get Diagnostics",
    description: "Retrieve diagnostic file located at URL",
    payload: { location: "https://example.com/diagnostics" }
  },
  ChangeConfiguration: {
    label: "Change Configuration",
    description: "Update a configuration key/value pair",
    payload: { key: "HeartbeatInterval", value: 30 }
  }
};

export const CommandComposer = ({ open, onClose }: CommandComposerProps) => {
  const api = useTenantApi();
  const queryClient = useQueryClient();
  const pushToast = useNotificationStore((state) => state.pushToast);
  const [simulator, setSimulator] = useState<number>();
  const [action, setAction] = useState<CommandPresetKey>("RemoteStartTransaction");
  const [payload, setPayload] = useState(
    JSON.stringify(PRESETS.RemoteStartTransaction.payload, null, 2)
  );
  const [scenarioRunId, setScenarioRunId] = useState<number | "">("");

  const { data } = useQuery({
    queryKey: queryKeys.simulators(),
    queryFn: () =>
      api.request<PaginatedResponse<SimulatedCharger>>(
        "/api/ocpp-simulator/simulated-chargers/",
        { query: { page_size: 200 } }
      ),
    staleTime: 60_000
  });

  const scenarioRunsQuery = useQuery({
    queryKey: queryKeys.scenarioRuns,
    queryFn: () =>
      api.request<PaginatedResponse<ScenarioRun>>("/api/ocpp-simulator/scenario-runs/", {
        query: { page_size: 50 }
      }),
    staleTime: 30_000
  });

  const dispatchMutation = useMutation({
    mutationFn: async (body: DispatchPayload) =>
      api.request("/api/ocpp-simulator/command-logs/dispatch/", {
        method: "POST",
        body
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["command-logs"] });
      pushToast({
        title: "Command dispatched",
        level: "success",
        timeoutMs: 3000
      });
      onClose();
    },
    onError: (error) => {
      pushToast({
        title: "Dispatch failed",
        description: error instanceof Error ? error.message : String(error),
        level: "error"
      });
    }
  });

  const options = useMemo(() => data?.results ?? [], [data?.results]);
  const scenarioRunOptions = useMemo(
    () => scenarioRunsQuery.data?.results ?? [],
    [scenarioRunsQuery.data?.results]
  );

  const handlePresetChange = (nextAction: CommandPresetKey) => {
    setAction(nextAction);
    const preset = PRESETS[nextAction];
    if (preset) {
      setPayload(JSON.stringify(preset.payload, null, 2));
    }
  };

  const validatePayload = (command: CommandPresetKey, parsed: Record<string, unknown>) => {
    const getNumber = (value: unknown) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    };
    switch (command) {
      case "RemoteStartTransaction": {
        const connectorId = getNumber(parsed.connectorId);
        if (!connectorId || connectorId <= 0) {
          return "connectorId must be a positive number";
        }
        if (typeof parsed.idTag !== "string" || !parsed.idTag.trim()) {
          return "idTag is required";
        }
        break;
      }
      case "RemoteStopTransaction": {
        const connectorId = parsed.connectorId;
        const transactionId = parsed.transactionId;
        if (!connectorId && !transactionId) {
          return "Provide connectorId or transactionId";
        }
        break;
      }
      case "UnlockConnector":
      case "ChangeAvailability": {
        const connectorId = getNumber(parsed.connectorId);
        if (!connectorId || connectorId <= 0) {
          return "connectorId must be a positive number";
        }
        if (command === "ChangeAvailability") {
          const type = String(parsed.type ?? "").trim();
          if (!type || !["Operative", "Inoperative"].includes(type)) {
            return "type must be Operative or Inoperative";
          }
        }
        break;
      }
      case "Reset": {
        const type = String(parsed.type ?? "").trim();
        if (!type || !["Soft", "Hard"].includes(type)) {
          return "type must be Soft or Hard";
        }
        break;
      }
      case "TriggerMessage": {
        if (!parsed.requestedMessage) {
          return "requestedMessage is required";
        }
        break;
      }
      default:
        break;
    }
    return null;
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!simulator) {
      pushToast({ title: "Choose a simulator", level: "warning" });
      return;
    }
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      const validationError = validatePayload(action, parsed);
      if (validationError) {
        pushToast({ title: "Validation failed", description: validationError, level: "warning" });
        return;
      }
      dispatchMutation.mutate({
        simulator,
        action,
        payload: parsed,
        scenario_run: typeof scenarioRunId === "number" ? scenarioRunId : undefined
      });
    } catch (error) {
      pushToast({
        title: "Invalid JSON",
        description: error instanceof Error ? error.message : ""
      });
    }
  };

  return (
    <Modal title="Dispatch Command" open={open} onClose={onClose}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.label}>
          Simulator
          <select
            className={styles.select}
            value={simulator ?? ""}
            onChange={(event) => setSimulator(Number(event.target.value))}
            required
          >
            <option value="" disabled>
              Select simulator
            </option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.alias ?? option.charger_id ?? `Simulator #${option.id}`}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.label}>
          Action
          <select
            className={styles.select}
            value={action}
            onChange={(event) => handlePresetChange(event.target.value as CommandPresetKey)}
          >
            {(Object.entries(PRESETS) as Array<[CommandPresetKey, CommandPreset]>).map(
              ([key, preset]) => (
                <option key={key} value={key}>
                  {preset.label}
                </option>
              )
            )}
          </select>
        </label>
        <p className={styles.presetDescription}>{PRESETS[action].description}</p>
        <label className={styles.label}>
          Scenario Run (optional)
          <select
            className={styles.select}
            value={scenarioRunId ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              setScenarioRunId(value ? Number(value) : "");
            }}
          >
            <option value="">No scenario run</option>
            {scenarioRunOptions.map((run) => (
              <option key={run.id} value={run.id}>
                #{run.id} · {run.scenario?.name ?? "Untitled"} ({run.status})
              </option>
            ))}
          </select>
        </label>
        <label className={styles.label}>
          Payload
          <textarea
            className={styles.textarea}
            value={payload}
            onChange={(event) => setPayload(event.target.value)}
            rows={8}
          />
        </label>
        <div className={styles.actions}>
          <Button type="submit" disabled={dispatchMutation.isPending}>
            {dispatchMutation.isPending ? "Dispatching…" : "Dispatch"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
};
