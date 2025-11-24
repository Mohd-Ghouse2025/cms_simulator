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
  CHARGING: {
    label: "Charging",
    tone: "info",
    description: "Active charging session is running.",
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
  const key = state.toUpperCase() as ChargerLifecycleState;
  return key in LIFECYCLE_META ? key : undefined;
};
