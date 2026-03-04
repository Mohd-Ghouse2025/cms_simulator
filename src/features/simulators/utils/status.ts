import { ConnectorStatus } from "@/types";

export type StatusTone = "success" | "info" | "warning" | "danger" | "neutral";

const STATUS_ALIASES: Record<string, ConnectorStatus> = {
  AVAILABLE: "AVAILABLE",
  PREPARING: "PREPARING",
  CHARGING: "CHARGING",
  SUSPENDED_EV: "SUSPENDED_EV",
  SUSPENDED_EVSE: "SUSPENDED_EVSE",
  SUSPENDEDEV: "SUSPENDED_EV",
  SUSPENDEDEVSE: "SUSPENDED_EVSE",
  FINISHING: "FINISHING",
  RESERVED: "RESERVED",
  UNAVAILABLE: "UNAVAILABLE",
  FAULTED: "FAULTED"
};

export const CONNECTOR_STATUS_LABELS: Record<ConnectorStatus, string> = {
  AVAILABLE: "Available",
  PREPARING: "Preparing",
  CHARGING: "Charging",
  SUSPENDED_EV: "Suspended EV",
  SUSPENDED_EVSE: "Suspended EVSE",
  FINISHING: "Finishing",
  RESERVED: "Reserved",
  UNAVAILABLE: "Unavailable",
  FAULTED: "Faulted"
};

export const normalizeConnectorStatus = (value: unknown): ConnectorStatus | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/[\s-]/g, "_").toUpperCase();
  return STATUS_ALIASES[normalized] ?? null;
};

export const formatConnectorStatusLabel = (value?: ConnectorStatus | string | null): string => {
  const normalized = normalizeConnectorStatus(value ?? "");
  if (!normalized) {
    return "Unknown";
  }
  return CONNECTOR_STATUS_LABELS[normalized];
};

export const connectorStatusTone = (status?: ConnectorStatus | string | null): StatusTone => {
  const normalized = normalizeConnectorStatus(status ?? "");
  switch (normalized) {
    case "CHARGING":
      return "success";
    case "FAULTED":
      return "danger";
    case "UNAVAILABLE":
      return "warning";
    case "RESERVED":
    case "PREPARING":
    case "SUSPENDED_EV":
    case "SUSPENDED_EVSE":
    case "FINISHING":
      return "info";
    default:
      return "neutral";
  }
};

export const ACTIVE_SESSION_STATES = ["authorized", "charging", "finishing"] as const;

const PLUGGED_STATUSES: ConnectorStatus[] = [
  "PREPARING",
  "CHARGING",
  "SUSPENDED_EV",
  "SUSPENDED_EVSE",
  "FINISHING",
  "RESERVED",
  "UNAVAILABLE"
];

export const isConnectorPlugged = (status?: ConnectorStatus | string | null): boolean => {
  const normalized = normalizeConnectorStatus(status ?? "");
  if (!normalized) return false;
  if (normalized === "AVAILABLE") return false;
  return PLUGGED_STATUSES.includes(normalized);
};

export const isActiveSessionState = (state?: string | null): boolean => {
  if (!state) return false;
  const normalized = state.toString().trim().toLowerCase();
  return (ACTIVE_SESSION_STATES as readonly string[]).includes(normalized);
};

type ActiveSessionCheck = {
  sessionState?: string | null;
  sessionActive?: boolean;
  connectorId?: number | null;
  activeSessionConnectorId?: number | null;
  activeSessionState?: string | null;
};

export const connectorHasActiveSession = ({
  sessionState,
  sessionActive,
  connectorId,
  activeSessionConnectorId,
  activeSessionState
}: ActiveSessionCheck): boolean => {
  if (sessionActive) {
    return true;
  }
  if (isActiveSessionState(sessionState)) {
    return true;
  }
  if (
    connectorId !== undefined &&
    connectorId !== null &&
    activeSessionConnectorId !== undefined &&
    activeSessionConnectorId !== null &&
    connectorId === activeSessionConnectorId
  ) {
    return isActiveSessionState(activeSessionState);
  }
  return false;
};
