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
