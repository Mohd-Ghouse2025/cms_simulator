import { ChargerLifecycleState } from "@/types";

export type StatusTone = "success" | "info" | "warning" | "danger" | "neutral";

type LifecycleMeta = {
  label: string;
  tone: StatusTone;
  description: string;
  isActive: boolean;
};

const FALLBACK_META: LifecycleMeta = {
  label: "Unknown",
  tone: "neutral",
  description: "Lifecycle state unavailable.",
  isActive: false
};

const LIFECYCLE_META: Record<ChargerLifecycleState, LifecycleMeta> = {
  OFFLINE: {
    label: "Offline",
    tone: "neutral",
    description: "Simulator runtime is shut down.",
    isActive: false
  },
  POWERED_ON: {
    label: "Powered On",
    tone: "info",
    description: "Runtime is online and waiting to connect.",
    isActive: true
  },
  CONNECTING: {
    label: "Connecting",
    tone: "warning",
    description: "Attempting to open the CMS WebSocket.",
    isActive: true
  },
  CONNECTED: {
    label: "Connected",
    tone: "success",
    description: "Simulator is online with the CMS and ready.",
    isActive: true
  },
  PREPARING: {
    label: "Preparing",
    tone: "info",
    description: "Preparing to start a session.",
    isActive: true
  },
  CHARGING: {
    label: "Charging",
    tone: "info",
    description: "Active charging session is running.",
    isActive: true
  },
  SUSPENDEDEV: {
    label: "Suspended (EV)",
    tone: "warning",
    description: "Vehicle paused the session.",
    isActive: true
  },
  SUSPENDEDEVSE: {
    label: "Suspended (EVSE)",
    tone: "warning",
    description: "Charger paused the session.",
    isActive: true
  },
  FINISHING: {
    label: "Finishing",
    tone: "info",
    description: "Session is winding down.",
    isActive: true
  },
  ERROR: {
    label: "Error",
    tone: "danger",
    description: "Runtime reported an unrecoverable error.",
    isActive: false
  }
};

export const getLifecycleStatusMeta = (
  state?: ChargerLifecycleState | null
): LifecycleMeta => {
  if (!state) {
    return FALLBACK_META;
  }
  const normalized = normalizeLifecycleState(state);
  return (normalized && LIFECYCLE_META[normalized]) ?? FALLBACK_META;
};

export const isActiveLifecycleState = (
  state?: ChargerLifecycleState | null
): boolean => {
  if (!state) {
    return false;
  }
  const normalized = normalizeLifecycleState(state);
  return normalized ? LIFECYCLE_META[normalized]?.isActive ?? false : false;
};

export const normalizeLifecycleState = (
  state?: string | null
): ChargerLifecycleState | undefined => {
  if (!state) {
    return undefined;
  }
  const key = state.trim().replace(/[-\s]+/g, "_").toUpperCase();
  const aliases: Record<string, ChargerLifecycleState> = {
    OFFLINE: "OFFLINE",
    POWERED_ON: "POWERED_ON",
    CONNECTING: "CONNECTING",
    CONNECTED: "CONNECTED",
    PREPARING: "PREPARING",
    CHARGING: "CHARGING",
    SUSPENDEDEV: "SUSPENDEDEV",
    SUSPENDED_EV: "SUSPENDEDEV",
    SUSPENDEDEVSE: "SUSPENDEDEVSE",
    SUSPENDED_EVSE: "SUSPENDEDEVSE",
    FINISHING: "FINISHING",
    ERROR: "ERROR"
  };
  return aliases[key];
};
