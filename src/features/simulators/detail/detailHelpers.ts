import { pickCanonicalTransactionId } from "@/lib/transactions";
import { NormalizedSample, appendSample, normalizeSample } from "../graphHelpers";
import { ConnectorTelemetrySnapshot, TelemetrySampleSnapshot } from "@/types";

// Telemetry window configuration
export const TELEMETRY_WINDOW_MS = 10 * 60 * 1000;
export const TELEMETRY_HISTORY_LIMIT = 2_000;
export const TELEMETRY_FEED_LIMIT = 150;
export const INSTANCE_HISTORY_LIMIT = 100;
export const METER_HISTORY_LIMIT = 100;
export const TIMELINE_EVENT_LIMIT = 40;
export const HEARTBEAT_HISTORY_LIMIT = 50;
export const TELEMETRY_EVENT_COOLDOWN_MS = 2_000;

export const toNumber = (value: unknown): number | undefined => {
  const candidate = Number(value);
  return Number.isFinite(candidate) ? candidate : undefined;
};

export const resolveEventTransactionId = (value: unknown): string | undefined => {
  if (typeof value === "string" || typeof value === "number") {
    return pickCanonicalTransactionId(value);
  }
  return undefined;
};

export const buildSnapshotSample = (
  connectorId: number,
  snapshot?: TelemetrySampleSnapshot | null
): NormalizedSample | null => {
  if (!snapshot) {
    return null;
  }
  return normalizeSample(
    {
      connectorId,
      timestamp: snapshot.timestamp ?? undefined,
      valueWh: snapshot.valueWh ?? undefined,
      powerKw: toNumber(snapshot.powerKw),
      currentA: toNumber(snapshot.currentA),
      voltageV: toNumber(snapshot.voltageV),
      energyKwh: toNumber(snapshot.energyKwh),
      deltaWh: toNumber(snapshot.deltaWh),
      intervalSeconds: toNumber(snapshot.intervalSeconds),
      transactionId: snapshot.transactionId ?? undefined
    },
    undefined
  );
};

export const ensureIsoTimestamp = (value: unknown): string => {
  if (typeof value === "string" && value.trim().length) {
    return value;
  }
  try {
    return new Date(value as string).toISOString();
  } catch {
    return new Date().toISOString();
  }
};

export const extractConnectorId = (payload: Record<string, unknown>): number | null => {
  const connectorRaw = payload.connectorId as number | string | undefined;
  const connectorId = Number(connectorRaw);
  if (!Number.isFinite(connectorId) || connectorId <= 0) {
    return null;
  }
  return connectorId;
};

export const extractTransactionId = (
  payload: Record<string, unknown>,
  fallback?: string
): string | undefined => {
  const tx = (payload.transactionId as string | number | undefined) ?? fallback;
  return typeof tx === "string" || typeof tx === "number" ? pickCanonicalTransactionId(tx) : undefined;
};

export const formatNumber = (
  value: number | undefined,
  options?: { digits?: number; fallback?: string }
): string => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return options?.fallback ?? "—";
  }
  const digits = options?.digits ?? 2;
  return numeric.toFixed(digits);
};

export const timelineToneForStatus = (status?: string) => {
  if (!status) {
    return "neutral" as const;
  }
  const normalized = status.toLowerCase();
  if (["charging", "connected", "completed"].includes(normalized)) {
    return "success" as const;
  }
  if (["finishing", "reserved", "connecting", "powered_on"].includes(normalized)) {
    return "info" as const;
  }
  if (["faulted", "error"].includes(normalized)) {
    return "danger" as const;
  }
  if (["unavailable"].includes(normalized)) {
    return "warning" as const;
  }
  return "neutral" as const;
};

export const limitTelemetryHistory = (series: NormalizedSample[]): NormalizedSample[] => {
  if (series.length <= TELEMETRY_HISTORY_LIMIT) {
    return series;
  }
  return series.slice(series.length - TELEMETRY_HISTORY_LIMIT);
};

export const mergeTelemetryHistory = (
  existing: NormalizedSample[] | undefined,
  additions: NormalizedSample[]
): NormalizedSample[] => {
  if (!additions.length) {
    return existing ?? [];
  }
  const additionsTx = additions[0]?.transactionId;
  let merged = existing ?? [];
  if (additionsTx && merged.length) {
    const lastTx = merged[merged.length - 1]?.transactionId;
    if (lastTx && lastTx !== additionsTx) {
      merged = [];
    }
  }
  additions.forEach((sample) => {
    const currentTx = merged.at(-1)?.transactionId;
    if (currentTx && sample.transactionId && sample.transactionId !== currentTx) {
      merged = [];
    }
    merged = appendSample(merged, sample);
  });
  return limitTelemetryHistory(merged);
};

export const snapshotPayloadFromSample = (sample?: NormalizedSample | null) => {
  if (!sample) {
    return undefined;
  }
  return {
    valueWh: sample.valueWh,
    energyKwh: sample.energyKwh,
    powerKw: sample.powerKw,
    currentA: sample.currentA,
    voltageV: sample.voltageV,
    deltaWh: sample.deltaWh,
    transactionId: sample.transactionId
  } satisfies TelemetrySampleSnapshot;
};

export const formatDurationLabel = ({
  startedAt,
  completedAt,
  nowTs,
  cmsDurationSeconds
}: {
  startedAt?: string | null;
  completedAt?: string | null;
  nowTs: number;
  cmsDurationSeconds?: number | null;
}): string => {
  const parsedEnd = completedAt ? Date.parse(completedAt) : nowTs;
  const endMs = Number.isFinite(parsedEnd) ? parsedEnd : nowTs;

  const normalizeIso = (value?: string | null): string | null => {
    if (!value) return null;
    if (typeof value !== "string") return null;
    // Trim fractional seconds beyond milliseconds to avoid Date.parse returning NaN on microsecond payloads.
    return value.replace(/(\\.\\d{3})\\d+/, "$1");
  };

  const parseStart = (value?: string | null): number | null => {
    if (!value) return null;
    const normalized = normalizeIso(value);
    const parsed = normalized ? Date.parse(normalized) : NaN;
    if (!Number.isFinite(parsed)) return null;
    return parsed;
  };

  let startMs = parseStart(startedAt);
  if (startMs === null && typeof cmsDurationSeconds === "number" && cmsDurationSeconds > 0) {
    startMs = endMs - cmsDurationSeconds * 1000;
  }
  if (startMs === null) return "—";

  const spanSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const hours = Math.floor(spanSeconds / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((spanSeconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(spanSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
};
