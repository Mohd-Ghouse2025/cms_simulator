/* eslint-disable @typescript-eslint/no-misused-promises */
"use client";

import {
  memo,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Activity, AlertTriangle, GaugeCircle, Info, Plug, Power, Zap } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { DataTable } from "@/components/common/DataTable";
import { useTenantApi } from "@/hooks/useTenantApi";
import { queryKeys } from "@/lib/queryKeys";
import {
  getLifecycleStatusMeta,
  normalizeLifecycleState,
  type StatusTone
} from "@/lib/simulatorLifecycle";
import { pickCanonicalTransactionId } from "@/lib/transactions";
import { formatLocalTimestamp, toTimestamp } from "@/lib/time";
import {
  ConnectorStatus,
  FaultDefinition,
  SimulatedCharger,
  SimulatedConnector,
  SimulatorInstance,
  SimulatedMeterValue,
  SimulatedSession,
  ConnectorTelemetrySnapshot,
  ConnectorTelemetryHistory,
  TelemetrySampleSnapshot
} from "@/types";
import { RemoteStartModal } from "./components/RemoteStartModal";
import { RemoteStopModal } from "./components/RemoteStopModal";
import { FaultInjectionModal } from "./components/FaultInjectionModal";
import { ResetModal } from "./components/ResetModal";
import { ForceResetModal } from "./components/ForceResetModal";
import { LiveGraph } from "./components/LiveGraph";
import { useNotificationStore } from "@/store/notificationStore";
import { ApiError } from "@/lib/api";
import { useSimulatorChannel } from "./hooks/useSimulatorChannel";
import styles from "./SimulatorDetailPage.module.css";
import { NormalizedSample, appendSample, normalizeSample, trimWindow } from "./graphHelpers";
import { EditSimulatorModal, SimulatorUpdatePayload } from "./components/EditSimulatorModal";
import { connectorStatusTone, formatConnectorStatusLabel, normalizeConnectorStatus } from "./utils/status";

interface DetailResponse extends SimulatedCharger {}

interface PaginatedResponse<T> {
  count: number;
  results: T[];
}

type SimulatorEventPayload = {
  type?: string;
  [key: string]: unknown;
};

type ConnectorMeterTimeline = {
  transactionId?: string;
  transactionKey?: string;
  samples: NormalizedSample[];
};

interface CmsChargingSession {
  id: number;
  connector: number;
  transaction_id: number;
  formatted_transaction_id: string;
  cms_transaction_key?: string | null;
  start_time: string;
  end_time: string | null;
  meter_start: number;
  meter_stop: number | null;
  meter_start_kwh?: number | null;
  meter_stop_kwh?: number | null;
  energy_kwh?: number | null;
  price_per_kwh?: number | null;
  cost: number | null;
  id_tag?: number | null;
}

interface CmsConnector {
  id: number;
  connector_id: number;
  status: string;
  type: string;
  charger_id: number;
}

type SessionLifecycle = SimulatedSession["state"] | "idle";

type SessionRuntime = {
  connectorId: number;
  transactionId?: string;
  transactionKey?: string;
  idTag?: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
  state: SessionLifecycle;
  meterStartWh?: number;
  meterStopWh?: number;
  pricePerKwh?: number | null;
  maxKw?: number | null;
  cmsSessionId?: number | null;
  cmsTransactionKey?: string | null;
  finalSample?: NormalizedSample | null;
  lastSampleAt?: string | null;
};

type TimelineTone = "info" | "success" | "warning" | "danger" | "neutral";
type TimelineIconKey = "activity" | "plug" | "power" | "zap" | "gauge" | "alert" | "info";
type TimelineKind =
  | "lifecycle"
  | "fault"
  | "connector"
  | "session"
  | "meter"
  | "command"
  | "log"
  | "heartbeat";

type TimelineMetric = {
  label: string;
  value: string;
  muted?: boolean;
};

type TimelineEvent = {
  id: string;
  dedupeKey: string;
  timestamp: string;
  kind: TimelineKind;
  title: string;
  subtitle?: string;
  badge?: string;
  tone: TimelineTone;
  icon: TimelineIconKey;
  metrics?: TimelineMetric[];
  meta?: string;
};

type TimelineEventInput = Omit<TimelineEvent, "id">;

type TelemetryFeedEntry = {
  connectorId: number;
  timestamp: string;
  transactionId?: string;
  powerKw: number | null;
  current: number | null;
  energyKwh: number | null;
  energyRegisterKwh: number | null;
  status: SessionLifecycle | string;
  statusClass: string;
  statusLabel: string;
  idTag?: string;
};

type HeartbeatFeedEntry = {
  id: string;
  timestamp: string;
  chargerId: string;
  simulatorId?: number | string;
  connectorCount?: number | null;
};

type ResetFlowStage = "requested" | "rebooting" | "reconnected";
type ResetFlowState = {
  type: "Soft" | "Hard" | "Force";
  stage: ResetFlowStage;
};

type EventTimelineHandle = {
  syncTelemetry: (entries: TelemetryFeedEntry[]) => void;
  syncTimeline: (entries: TimelineEvent[]) => void;
  syncHeartbeats: (entries: HeartbeatFeedEntry[]) => void;
  reset: () => void;
};

const TELEMETRY_WINDOW_MS = 10 * 60 * 1000;
const TELEMETRY_HISTORY_LIMIT = 2_000;
const TELEMETRY_FEED_LIMIT = 150;
const INSTANCE_HISTORY_LIMIT = 100;
const METER_HISTORY_LIMIT = 100;
const TIMELINE_EVENT_LIMIT = 40;
const HEARTBEAT_HISTORY_LIMIT = 50;
const TELEMETRY_EVENT_COOLDOWN_MS = 2_000;

const timelineIconComponents = {
  activity: Activity,
  plug: Plug,
  power: Power,
  zap: Zap,
  gauge: GaugeCircle,
  alert: AlertTriangle,
  info: Info
} as const;

const toNumber = (value: unknown): number | undefined => {
  const candidate = Number(value);
  return Number.isFinite(candidate) ? candidate : undefined;
};

const resolveEventTransactionId = (value: unknown): string | undefined => {
  if (typeof value === "string" || typeof value === "number") {
    return pickCanonicalTransactionId(value);
  }
  return undefined;
};

const buildSnapshotSample = (
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

const ensureIsoTimestamp = (value: unknown): string => {
  if (typeof value === "string" && value.trim().length) {
    return value;
  }
  try {
    return new Date(value as string).toISOString();
  } catch {
    return new Date().toISOString();
  }
};

const extractConnectorId = (payload: SimulatorEventPayload): number | null => {
  const connectorRaw = payload.connectorId as number | string | undefined;
  const connectorId = Number(connectorRaw);
  if (!Number.isFinite(connectorId) || connectorId <= 0) {
    return null;
  }
  return connectorId;
};

const extractTransactionId = (
  payload: SimulatorEventPayload,
  fallback?: string
): string | undefined => {
  const tx = (payload.transactionId as string | number | undefined) ?? fallback;
  return typeof tx === "string" || typeof tx === "number" ? pickCanonicalTransactionId(tx) : undefined;
};

const formatTimelineTimestamp = (value: string): string =>
  formatLocalTimestamp(value, { withSeconds: true });

const formatClockTime = (value?: string | number | null): string =>
  formatLocalTimestamp(value ?? null, { withSeconds: true });

const compareTimelineEventsDesc = (a: TimelineEvent, b: TimelineEvent): number => {
  const aTime = Date.parse(a.timestamp);
  const bTime = Date.parse(b.timestamp);
  const aValid = Number.isFinite(aTime);
  const bValid = Number.isFinite(bTime);
  if (!aValid && !bValid) {
    return 0;
  }
  if (!aValid) {
    return 1;
  }
  if (!bValid) {
    return -1;
  }
  return bTime - aTime;
};

const formatNumber = (value: number | undefined, options?: { digits?: number; fallback?: string }) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return options?.fallback ?? "—";
  }
  const digits = options?.digits ?? 2;
  return numeric.toFixed(digits);
};

const timelineToneForStatus = (status?: string): TimelineTone => {
  if (!status) {
    return "neutral";
  }
  const normalized = status.toLowerCase();
  if (["charging", "connected", "completed"].includes(normalized)) {
    return "success";
  }
  if (["finishing", "reserved", "connecting", "powered_on"].includes(normalized)) {
    return "info";
  }
  if (["faulted", "error"].includes(normalized)) {
    return "danger";
  }
  if (["unavailable"].includes(normalized)) {
    return "warning";
  }
  return "neutral";
};

const statusToneClassMap: Record<StatusTone, string> = {
  success: styles.statusSuccess,
  info: styles.statusInfo,
  warning: styles.statusWarning,
  danger: styles.statusDanger,
  neutral: styles.statusNeutral
};

const limitTelemetryHistory = (series: NormalizedSample[]): NormalizedSample[] => {
  if (series.length <= TELEMETRY_HISTORY_LIMIT) {
    return series;
  }
  return series.slice(series.length - TELEMETRY_HISTORY_LIMIT);
};

const mergeTelemetryHistory = (
  existing: NormalizedSample[] | undefined,
  additions: NormalizedSample[]
): NormalizedSample[] => {
  if (!additions.length) {
    return existing ?? [];
  }
  let merged = existing ?? [];
  additions.forEach((sample) => {
    merged = appendSample(merged, sample);
  });
  return limitTelemetryHistory(merged);
};

type SimulatorDetailPageProps = {
  simulatorId: number;
};

export const SimulatorDetailPage = ({ simulatorId: simulatorIdProp }: SimulatorDetailPageProps) => {
  const router = useRouter();
  const api = useTenantApi();
  const queryClient = useQueryClient();
  const pushToast = useNotificationStore((state) => state.pushToast);
  const [commandBusy, setCommandBusy] = useState<
    "start" | "stop" | "reset" | "force-reset" | "connect" | "disconnect" | "plug" | "unplug" | null
  >(null);
  const [commandConnectorId, setCommandConnectorId] = useState<number | null>(null);
  const [showStartModal, setShowStartModal] = useState(false);
  const [showStopModal, setShowStopModal] = useState(false);
  const [showFaultModal, setShowFaultModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showForceResetModal, setShowForceResetModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [faultPending, setFaultPending] = useState(false);
  const [resetFlow, setResetFlow] = useState<ResetFlowState | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [dashboardOnline, setDashboardOnline] = useState(false);
  const [heartbeatEvents, setHeartbeatEvents] = useState<HeartbeatFeedEntry[]>([]);
  const [meterTimelines, setMeterTimelines] = useState<Record<number, ConnectorMeterTimeline>>({});
  const [telemetryHistory, setTelemetryHistory] = useState<Record<number, NormalizedSample[]>>({});
  const [telemetryHydrated, setTelemetryHydrated] = useState(false);
  const [sessionsByConnector, setSessionsByConnector] = useState<Record<number, SessionRuntime>>({});
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [selectedConnectorId, setSelectedConnectorId] = useState<number | null>(null);
  const timelineKeysRef = useRef<Set<string>>(new Set());
  const telemetryThrottleRef = useRef<Record<number, number>>({});
  const sessionsRef = useRef<Record<number, SessionRuntime>>({});
  const frozenConnectorsRef = useRef<Set<number>>(new Set());
  const resetFlowRef = useRef<ResetFlowState | null>(null);
  const timelineCardRef = useRef<EventTimelineHandle | null>(null);
  const simulatorId = Number(simulatorIdProp);
  const pendingHistoryFetchesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    setTelemetryHydrated(false);
  }, [simulatorId]);
  const applyTelemetryHistory = useCallback(
    (updates: Record<number, NormalizedSample[]>) => {
      const entries = Object.entries(updates);
      if (!entries.length) {
        return;
      }
      setTelemetryHistory((current) => {
        const next = { ...current };
        let changed = false;
        entries.forEach(([key, samples]) => {
          const connectorId = Number(key);
          if (!Number.isFinite(connectorId) || connectorId <= 0 || !samples.length) {
            return;
          }
          const merged = mergeTelemetryHistory(next[connectorId], samples);
          if (next[connectorId] !== merged) {
            next[connectorId] = merged;
            changed = true;
          }
        });
        return changed ? next : current;
      });
    },
    []
  );
  const appendTelemetrySample = useCallback(
    (connectorId: number, sample?: NormalizedSample | null) => {
      if (!Number.isFinite(connectorId) || connectorId <= 0 || !sample) {
        return;
      }
      applyTelemetryHistory({ [connectorId]: [sample] });
    },
    [applyTelemetryHistory]
  );

  const hydrateConnectorHistory = useCallback(
    async (connectorId: number, transactionId?: string | null) => {
      if (!Number.isFinite(connectorId) || connectorId <= 0 || !transactionId) {
        return;
      }
      const fetchKey = `${connectorId}:${transactionId}`;
      if (pendingHistoryFetchesRef.current.has(fetchKey)) {
        return;
      }
      pendingHistoryFetchesRef.current.add(fetchKey);
      try {
        const response = await api.request<PaginatedResponse<SimulatedMeterValue>>(
          "/api/ocpp-simulator/meter-values/",
          {
            query: {
              simulator: simulatorId,
              transaction: transactionId,
              page_size: TELEMETRY_HISTORY_LIMIT
            }
          }
        );
        const results = response.results ?? [];
        if (!results.length) {
          return;
        }
        const normalizedByConnector: Record<number, NormalizedSample[]> = {};
        const previousSampleByConnector: Record<number, NormalizedSample | undefined> = {};
        [...results]
          .sort((a, b) => new Date(a.sampledAt).getTime() - new Date(b.sampledAt).getTime())
          .forEach((reading) => {
            const connectorKey = Number(reading.connectorNumber ?? reading.connectorId ?? connectorId);
            if (!Number.isFinite(connectorKey) || connectorKey <= 0) {
              return;
            }
            const payload = reading.payload ?? {};
            const rawTransaction =
              reading.transactionId ??
              (payload.transactionId as string | number | undefined);
            const sample = normalizeSample(
              {
                connectorId: connectorKey,
                timestamp: reading.sampledAt,
                valueWh: reading.valueWh,
                powerKw: toNumber(payload.powerKw ?? payload.power_kw ?? payload.power),
                currentA: toNumber(payload.currentA ?? payload.current_a ?? payload.current),
                voltageV: toNumber(payload.voltageV ?? payload.voltage_v ?? payload.voltage),
                energyKwh:
                  toNumber(payload.energyKwh ?? payload.energy_kwh) ??
                  Number((reading.valueWh / 1000).toFixed(3)),
                transactionId: resolveEventTransactionId(rawTransaction)
              },
              previousSampleByConnector[connectorKey]
            );
            if (!normalizedByConnector[connectorKey]) {
              normalizedByConnector[connectorKey] = [];
            }
            normalizedByConnector[connectorKey].push(sample);
            previousSampleByConnector[connectorKey] = sample;
          });
        if (!Object.keys(normalizedByConnector).length) {
          return;
        }
        setMeterTimelines((current) => {
          const next = { ...current };
          Object.entries(normalizedByConnector).forEach(([key, samples]) => {
            if (!samples.length) {
              return;
            }
            const id = Number(key);
            const bounded = limitTelemetryHistory(samples);
            const previous = next[id];
            next[id] = {
              transactionId: transactionId ?? previous?.transactionId,
              transactionKey: transactionId ?? previous?.transactionKey,
              samples: bounded
            };
          });
          return next;
        });
        applyTelemetryHistory(normalizedByConnector);
      } catch (error) {
        console.error("Failed to hydrate connector history", error);
      } finally {
        pendingHistoryFetchesRef.current.delete(fetchKey);
      }
    },
    [api, simulatorId, applyTelemetryHistory]
  );

  useEffect(() => {
    setTimelineEvents([]);
    setHeartbeatEvents([]);
    timelineKeysRef.current.clear();
    telemetryThrottleRef.current = {};
    setMeterTimelines({});
    setTelemetryHistory({});
    setSessionsByConnector({});
    frozenConnectorsRef.current.clear();
  }, [simulatorId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    sessionsRef.current = sessionsByConnector;
  }, [sessionsByConnector]);

  useEffect(() => {
    resetFlowRef.current = resetFlow;
  }, [resetFlow]);

  useEffect(() => {
    if (!resetFlow) {
      return;
    }
    if (resetFlow.stage === "reconnected") {
      const timer = window.setTimeout(() => setResetFlow(null), 4000);
      return () => window.clearTimeout(timer);
    }
    if (resetFlow.type === "Soft" && resetFlow.stage === "rebooting") {
      const timer = window.setTimeout(() => {
        setResetFlow((current) =>
          current && current.type === "Soft" && current.stage === "rebooting"
            ? { ...current, stage: "reconnected" }
            : current
        );
      }, 2000);
      return () => window.clearTimeout(timer);
    }
  }, [resetFlow]);
  const pushTimelineEvent = useCallback(
    (entry: TimelineEventInput) => {
      if (timelineKeysRef.current.has(entry.dedupeKey)) {
        return;
      }
      timelineKeysRef.current.add(entry.dedupeKey);
      setTimelineEvents((current) => {
        const next = [{ ...entry, id: `${entry.dedupeKey}`, dedupeKey: entry.dedupeKey }, ...current];
        if (next.length > TIMELINE_EVENT_LIMIT) {
          const overflow = next.slice(TIMELINE_EVENT_LIMIT);
          overflow.forEach((item) => timelineKeysRef.current.delete(item.dedupeKey));
        }
        return next.slice(0, TIMELINE_EVENT_LIMIT);
      });
    },
    []
  );

  const shouldRecordTelemetry = useCallback(
    (connectorId: number, timestamp: string) => {
      const ts = Date.parse(timestamp);
      if (!Number.isFinite(ts)) {
        return false;
      }
      const last = telemetryThrottleRef.current[connectorId] ?? 0;
      if (ts - last < TELEMETRY_EVENT_COOLDOWN_MS) {
        return false;
      }
      telemetryThrottleRef.current[connectorId] = ts;
      return true;
    },
    []
  );

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.simulatorDetail(simulatorId),
    enabled: Number.isFinite(simulatorId),
    queryFn: async () =>
      api.request<DetailResponse>(`/api/ocpp-simulator/simulated-chargers/${simulatorId}/`)
  });
  const normalizedLifecycle = normalizeLifecycleState(data?.lifecycle_state) ?? "OFFLINE";
  const [liveLifecycleState, setLiveLifecycleState] = useState(normalizedLifecycle);
  useEffect(() => {
    setLiveLifecycleState(normalizedLifecycle);
  }, [normalizedLifecycle, simulatorId]);
  const lifecycleState = liveLifecycleState ?? normalizedLifecycle;
  const isLifecycleCharging = lifecycleState === "CHARGING";
  const cmsConnected = data?.cms_online ?? (data?.cms_present ?? false);
  const cmsHeartbeatIso = data?.cms_last_heartbeat ?? null;

  const instancesQuery = useQuery({
    queryKey: ["simulator-instance", simulatorId],
    enabled: Number.isFinite(simulatorId),
    queryFn: async () =>
      api.request<PaginatedResponse<SimulatorInstance>>(
        "/api/ocpp-simulator/simulator-instances/",
        { query: { page_size: INSTANCE_HISTORY_LIMIT } }
      )
  });

  const meterValuesQuery = useQuery({
    queryKey: queryKeys.meterValues({ simulator: simulatorId, limit: METER_HISTORY_LIMIT }),
    enabled: !!data && Number.isFinite(simulatorId),
    queryFn: async () =>
      api.request<PaginatedResponse<SimulatedMeterValue>>("/api/ocpp-simulator/meter-values/", {
        query: {
          simulator: simulatorId,
          page_size: METER_HISTORY_LIMIT
        }
      }),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false
  });

  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions({ simulator: simulatorId, active: true }),
    enabled: Number.isFinite(simulatorId),
    queryFn: async () =>
      api.request<PaginatedResponse<SimulatedSession>>("/api/ocpp-simulator/sessions/", {
        query: { simulator: simulatorId, active: true, limit: 10 }
      }),
    refetchInterval: isLifecycleCharging ? 5_000 : 15_000
  });

  const recentSessionsQuery = useQuery({
    queryKey: queryKeys.sessions({ simulator: simulatorId, limit: 20 }),
    enabled: Number.isFinite(simulatorId),
    queryFn: async () =>
      api.request<PaginatedResponse<SimulatedSession>>("/api/ocpp-simulator/sessions/", {
        query: { simulator: simulatorId, limit: 20 }
      }),
    staleTime: 30_000,
    refetchInterval: isLifecycleCharging ? 20_000 : false
  });

  const cmsConnectorsQuery = useQuery({
    queryKey: ["cms-connectors", data?.charger_id],
    enabled: Boolean(data?.charger_id),
    queryFn: async () =>
      api.request<PaginatedResponse<CmsConnector>>("/api/ocpp/connectors/", {
        query: { charger_id: data?.charger_id, page_size: 50 }
      }),
    staleTime: 60_000,
    refetchInterval: isLifecycleCharging ? 20_000 : 120_000
  });

  const cmsSessionsQuery = useQuery({
    queryKey: ["cms-charging-sessions", data?.charger_id],
    enabled: Boolean(data?.charger_id),
    queryFn: async () =>
      api.request<PaginatedResponse<CmsChargingSession>>("/api/ocpp/charging-sessions/", {
        query: { charger_id: data?.charger_id, page_size: 25 }
      }),
    staleTime: 60_000,
    refetchInterval: isLifecycleCharging ? 15_000 : 120_000
  });

  const faultDefinitionsQuery = useQuery({
    queryKey: queryKeys.faultDefinitions,
    queryFn: async () =>
      api.request<PaginatedResponse<FaultDefinition>>("/api/ocpp-simulator/fault-definitions/", {
        query: { page_size: 100 }
      }),
    staleTime: 120_000
  });

  const simulatorConnectorByPk = useMemo(() => {
    const map = new Map<number, SimulatedCharger["connectors"][number]>();
    (data?.connectors ?? []).forEach((connector) => {
      map.set(connector.id, connector);
    });
    return map;
  }, [data?.connectors]);

  const cmsConnectorIndex = useMemo(() => {
    const byId = new Map<number, CmsConnector>();
    const byNumber = new Map<number, CmsConnector>();
    const results = cmsConnectorsQuery.data?.results ?? [];
    results.forEach((connector) => {
      byId.set(connector.id, connector);
      byNumber.set(connector.connector_id, connector);
    });
    return { byId, byNumber };
  }, [cmsConnectorsQuery.data?.results]);

  const cmsSessionsIndex = useMemo(() => {
    const byId = new Map<number, CmsChargingSession>();
    const byFormatted = new Map<string, CmsChargingSession>();
    const byConnectorNumber = new Map<number, CmsChargingSession[]>();
    const sessions = cmsSessionsQuery.data?.results ?? [];
    sessions.forEach((session) => {
      byId.set(session.id, session);
      const formatted = pickCanonicalTransactionId(
        session.formatted_transaction_id,
        session.cms_transaction_key,
        session.transaction_id
      );
      if (formatted) {
        byFormatted.set(formatted, session);
      }
      const cmsConnector = cmsConnectorIndex.byId.get(session.connector);
      if (cmsConnector) {
        const list = byConnectorNumber.get(cmsConnector.connector_id) ?? [];
        list.push(session);
        byConnectorNumber.set(cmsConnector.connector_id, list);
      }
    });
    byConnectorNumber.forEach((list, connectorNumber) => {
      const ordered = [...list].sort(
        (a, b) => Date.parse(b.start_time) - Date.parse(a.start_time)
      );
      byConnectorNumber.set(connectorNumber, ordered);
    });
    return { byId, byFormatted, byConnectorNumber };
  }, [cmsSessionsQuery.data?.results, cmsConnectorIndex]);

  const telemetrySnapshotMap = useMemo(() => {
    const raw = data?.telemetrySnapshot;
    const entries: Array<[number, ConnectorTelemetrySnapshot]> = [];
    if (raw && typeof raw === "object") {
      Object.entries(raw).forEach(([key, snapshot]) => {
        const connectorId = Number(key);
        if (!Number.isFinite(connectorId) || connectorId <= 0 || !snapshot) {
          return;
        }
        entries.push([connectorId, snapshot as ConnectorTelemetrySnapshot]);
      });
    }
    return new Map(entries);
  }, [data?.telemetrySnapshot]);

  const telemetryHistoryMap = useMemo(() => {
    const raw = data?.telemetryHistory;
    const entries: Array<[number, ConnectorTelemetryHistory]> = [];
    if (raw && typeof raw === "object") {
      Object.entries(raw).forEach(([key, history]) => {
        const connectorId = Number(key);
        if (!Number.isFinite(connectorId) || connectorId <= 0 || !history) {
          return;
        }
        entries.push([connectorId, history as ConnectorTelemetryHistory]);
      });
    }
    return new Map(entries);
  }, [data?.telemetryHistory]);

  useEffect(() => {
    if (!telemetryHistoryMap.size || telemetryHydrated) {
      return;
    }
    const historyBatches: Record<number, NormalizedSample[]> = {};
    const timelineDraft: Record<number, ConnectorMeterTimeline> = {};
    telemetryHistoryMap.forEach((history, connectorId) => {
      const samples = Array.isArray(history.samples) ? history.samples : [];
      if (!samples.length) {
        return;
      }
      let previous: NormalizedSample | undefined;
      const normalizedSamples = samples.map((snapshot) => {
        const normalized = normalizeSample(
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
            transactionId: snapshot.transactionId ?? history.transactionId ?? undefined
          },
          previous
        );
        previous = normalized;
        return normalized;
      });
      if (!normalizedSamples.length) {
        return;
      }
      historyBatches[connectorId] = normalizedSamples;
      timelineDraft[connectorId] = {
        transactionId: history.transactionId ?? normalizedSamples.at(-1)?.transactionId,
        transactionKey: history.transactionId ?? normalizedSamples.at(-1)?.transactionId,
        samples: trimWindow(normalizedSamples, TELEMETRY_WINDOW_MS)
      };
    });
    if (!Object.keys(historyBatches).length) {
      return;
    }
    applyTelemetryHistory(historyBatches);
    setMeterTimelines((current) => ({ ...current, ...timelineDraft }));
    setSessionsByConnector((current) => {
      const next = { ...current };
      telemetryHistoryMap.forEach((history, connectorId) => {
        const samples = historyBatches[connectorId];
        const finalSample = samples?.at(-1) ?? null;
        const existing = next[connectorId];
        next[connectorId] = {
          connectorId,
          transactionId: history.transactionId ?? existing?.transactionId,
          transactionKey: history.transactionId ?? existing?.transactionKey,
          cmsTransactionKey: history.transactionId ?? existing?.cmsTransactionKey,
          startedAt: existing?.startedAt,
          completedAt: existing?.completedAt,
          updatedAt: existing?.updatedAt,
          state: (history.state as SessionLifecycle) ?? existing?.state ?? "idle",
          meterStartWh: history.meterStartWh ?? existing?.meterStartWh,
          meterStopWh: history.meterStopWh ?? existing?.meterStopWh,
          pricePerKwh: existing?.pricePerKwh ?? data?.price_per_kwh ?? null,
          maxKw: existing?.maxKw ?? null,
          finalSample,
          lastSampleAt: finalSample?.isoTimestamp ?? existing?.lastSampleAt ?? null
        };
      });
      return next;
    });
    setTelemetryHydrated(true);
  }, [telemetryHistoryMap, data?.price_per_kwh, applyTelemetryHistory, telemetryHydrated]);

  useEffect(() => {
    if (!telemetrySnapshotMap.size) {
      return;
    }
    const snapshotHistory: Record<number, NormalizedSample[]> = {};
    setSessionsByConnector((current) => {
      const next = { ...current };
      telemetrySnapshotMap.forEach((snapshot, connectorId) => {
        const sample = buildSnapshotSample(connectorId, snapshot.lastSample);
        if (sample) {
          if (!snapshotHistory[connectorId]) {
            snapshotHistory[connectorId] = [];
          }
          snapshotHistory[connectorId].push(sample);
        }
        const existing = next[connectorId];
        const resolvedState = (snapshot.state as SessionLifecycle) ?? existing?.state ?? "idle";
        next[connectorId] = {
          connectorId,
          transactionId: snapshot.transactionId ?? existing?.transactionId,
          transactionKey: snapshot.transactionId ?? existing?.transactionKey,
          cmsTransactionKey: snapshot.transactionId ?? existing?.cmsTransactionKey,
          idTag: existing?.idTag,
          startedAt: existing?.startedAt,
          completedAt: existing?.completedAt,
          updatedAt: existing?.updatedAt,
          state: resolvedState,
          meterStartWh: snapshot.meterStartWh ?? existing?.meterStartWh,
          meterStopWh: snapshot.meterStopWh ?? existing?.meterStopWh,
          pricePerKwh: existing?.pricePerKwh ?? data?.price_per_kwh ?? null,
          maxKw: existing?.maxKw ?? null,
          cmsSessionId: existing?.cmsSessionId ?? null,
          finalSample: sample ?? existing?.finalSample ?? null,
          lastSampleAt: sample?.isoTimestamp ?? existing?.lastSampleAt ?? null
        } as SessionRuntime;
      });
      return next;
    });
    setMeterTimelines((current) => {
      const next = { ...current };
      telemetrySnapshotMap.forEach((snapshot, connectorId) => {
        const recordedSamples = snapshotHistory[connectorId];
        const sample =
          recordedSamples?.[recordedSamples.length - 1] ??
          buildSnapshotSample(connectorId, snapshot.lastSample);
        if (!sample) {
          return;
        }
        const existing = next[connectorId];
        if (existing && existing.samples.length) {
          return;
        }
        next[connectorId] = {
          transactionId: snapshot.transactionId ?? existing?.transactionId,
          transactionKey: snapshot.transactionId ?? existing?.transactionKey,
          samples: [sample]
        };
      });
      return next;
    });
    if (Object.keys(snapshotHistory).length) {
      applyTelemetryHistory(snapshotHistory);
    }
  }, [telemetrySnapshotMap, data?.price_per_kwh, applyTelemetryHistory]);

  useEffect(() => {
    const sessions = cmsSessionsQuery.data?.results ?? [];
    sessions.forEach((session) => {
      const cmsConnector = cmsConnectorIndex.byId.get(session.connector);
      const connectorNumber = cmsConnector?.connector_id;
      const tx = pickCanonicalTransactionId(
        session.formatted_transaction_id,
        session.cms_transaction_key,
        session.transaction_id
      );
      if (session.start_time) {
        const metrics: TimelineMetric[] = [];
        if (session.meter_start_kwh !== null && session.meter_start_kwh !== undefined) {
          metrics.push({
            label: "Meter start",
            value: `${Number(session.meter_start_kwh).toFixed(3)} kWh`
          });
        }
        if (session.price_per_kwh !== null && session.price_per_kwh !== undefined) {
          metrics.push({
            label: "Price",
            value: `${Number(session.price_per_kwh).toFixed(2)} per kWh`,
            muted: true
          });
        }
        pushTimelineEvent({
          dedupeKey: `session:${connectorNumber ?? session.connector}:${tx ?? session.id}:start`,
          timestamp: session.start_time,
          kind: "session",
          title: "CMS session recorded",
          subtitle: connectorNumber ? `Connector #${connectorNumber}` : undefined,
          badge: tx ? `Tx ${tx}` : undefined,
          tone: "info",
          icon: "activity",
          metrics: metrics.length ? metrics : undefined
        });
      }
      if (session.end_time) {
        const metrics: TimelineMetric[] = [];
        if (session.energy_kwh !== null && session.energy_kwh !== undefined) {
          metrics.push({
            label: "Energy",
            value: `${Number(session.energy_kwh).toFixed(3)} kWh`
          });
        }
        if (session.cost !== null && session.cost !== undefined) {
          const costValue = Number(session.cost ?? 0);
          metrics.push({
            label: "Cost",
            value: `${costValue.toFixed(2)}`,
            muted: true
          });
        }
        pushTimelineEvent({
          dedupeKey: `session:${connectorNumber ?? session.connector}:${tx ?? session.id}:stop`,
          timestamp: session.end_time,
          kind: "session",
          title: "CMS session closed",
          subtitle: connectorNumber ? `Connector #${connectorNumber}` : undefined,
          badge: tx ? `Tx ${tx}` : undefined,
          tone: "neutral",
          icon: "activity",
          metrics: metrics.length ? metrics : undefined
        });
      }
    });
  }, [cmsSessionsQuery.data?.results, cmsConnectorIndex, pushTimelineEvent]);

  const resolveConnectorNumber = useCallback(
    (session: SimulatedSession): number | null => {
      const mapped = simulatorConnectorByPk.get(session.connector);
      if (mapped) {
        return mapped.connector_id;
      }
      const metadataConnectorId =
        typeof session.metadata === "object" && session.metadata !== null
          ? (session.metadata as { connector_id?: number }).connector_id
          : undefined;
      const fallback = Number(metadataConnectorId ?? 0);
      if (!Number.isFinite(fallback) || fallback <= 0) {
        return null;
      }
      return fallback;
    },
    [simulatorConnectorByPk]
  );

  useEffect(() => {
    const results = meterValuesQuery.data?.results;
    if (!results || !results.length) {
      return;
    }
    const historyBatches: Record<number, NormalizedSample[]> = {};
    setMeterTimelines((current) => {
      const ordered = [...results].reverse();
      const draft: Record<number, ConnectorMeterTimeline> = { ...current };
      ordered.forEach((reading) => {
        const connectorId = Number(reading.connectorNumber ?? reading.connectorId ?? 0);
        if (!Number.isFinite(connectorId) || connectorId <= 0) {
          return;
        }
        const payload = reading.payload;
        const payloadRecord =
          typeof payload === "object" && payload !== null
            ? (payload as Record<string, unknown>)
            : {};
        const rawTransactionId =
          payloadRecord.transactionId ?? payloadRecord.transaction_id ?? undefined;
        const transactionId = resolveEventTransactionId(rawTransactionId);
        const transactionKey = transactionId;
        const raw = {
          connectorId,
          timestamp: reading.sampledAt,
          valueWh: reading.valueWh,
          powerKw: toNumber(payloadRecord.powerKw ?? payloadRecord.power_kw ?? payloadRecord.power),
          currentA: toNumber(payloadRecord.currentA ?? payloadRecord.current_a ?? payloadRecord.current),
          voltageV: toNumber(payloadRecord.voltageV ?? payloadRecord.voltage_v ?? payloadRecord.voltage),
          energyKwh:
            toNumber(payloadRecord.energyKwh ?? payloadRecord.energy_kwh) ??
            Number((reading.valueWh / 1000).toFixed(3)),
          transactionId
        };
        const timeline = draft[connectorId] ?? { transactionId, transactionKey, samples: [] };
        const previousSample = timeline.samples.at(-1);
        const normalized = normalizeSample(raw, previousSample);
        if (!historyBatches[connectorId]) {
          historyBatches[connectorId] = [];
        }
        historyBatches[connectorId].push(normalized);
        const appended = appendSample(timeline.samples, normalized);
        draft[connectorId] = {
          transactionId: transactionId ?? timeline.transactionId,
          transactionKey: transactionKey ?? timeline.transactionKey,
          samples: trimWindow(appended, TELEMETRY_WINDOW_MS)
        };
      });
      return draft;
    });
    if (Object.keys(historyBatches).length) {
      applyTelemetryHistory(historyBatches);
    }
  }, [meterValuesQuery.data?.results, applyTelemetryHistory]);

  const mergeSessionSnapshots = useCallback(
    (snapshots: SimulatedSession[]) => {
      if (!snapshots.length) {
        return;
      }
      setSessionsByConnector((current) => {
        const next = { ...current };
        snapshots.forEach((session) => {
          const connectorId = resolveConnectorNumber(session);
          if (!connectorId) {
            return;
          }
          const existing = next[connectorId];
          const connectorInfo = simulatorConnectorByPk.get(session.connector);
          const transactionId = pickCanonicalTransactionId(session.cms_transaction_key);
          const startedAt =
            session.started_at ?? session.created_at ?? existing?.startedAt;
          const completedAt = session.completed_at ?? existing?.completedAt;
          const meterStartWh = session.meter_start_wh ?? existing?.meterStartWh;
          const meterStopWh = session.meter_stop_wh ?? existing?.meterStopWh;
          const state = (session.state ?? existing?.state ?? "idle") as SessionLifecycle;
          const existingStart = existing?.startedAt ? Date.parse(existing.startedAt) : null;
          const candidateStart = startedAt ? Date.parse(startedAt) : null;
          if (existing && existingStart !== null && candidateStart !== null && candidateStart < existingStart) {
            return;
          }
          const candidateUpdatedAt =
            session.updated_at ??
            session.completed_at ??
            session.started_at ??
            session.created_at ??
            existing?.updatedAt;
          const existingUpdatedAt = existing?.updatedAt ? Date.parse(existing.updatedAt) : null;
          const candidateUpdatedTs = candidateUpdatedAt ? Date.parse(candidateUpdatedAt) : null;
          if (
            existing &&
            existingUpdatedAt !== null &&
            candidateUpdatedTs !== null &&
            candidateUpdatedTs < existingUpdatedAt
          ) {
            return;
          }
          next[connectorId] = {
            connectorId,
            transactionId: transactionId ?? existing?.transactionId,
            transactionKey: transactionId ?? existing?.transactionKey,
            cmsTransactionKey: transactionId ?? existing?.cmsTransactionKey,
            cmsSessionId: session.cms_transaction ?? existing?.cmsSessionId,
            idTag: session.id_tag ?? existing?.idTag,
            startedAt,
            completedAt,
            updatedAt: candidateUpdatedAt ?? existing?.updatedAt,
            state,
            meterStartWh,
            meterStopWh,
            pricePerKwh: data?.price_per_kwh ?? existing?.pricePerKwh ?? null,
            maxKw: connectorInfo?.max_kw ?? existing?.maxKw ?? null
          };
        });
        return next;
      });
    },
    [data?.price_per_kwh, resolveConnectorNumber, simulatorConnectorByPk]
  );

  useEffect(() => {
    const active = sessionsQuery.data?.results ?? [];
    const recent = recentSessionsQuery.data?.results ?? [];
    if (!active.length && !recent.length) {
      return;
    }
    const uniqueById = new Map<number, SimulatedSession>();
    active.forEach((session) => {
      uniqueById.set(session.id, session);
    });
    recent.forEach((session) => {
      if (!uniqueById.has(session.id)) {
        uniqueById.set(session.id, session);
      }
    });
    mergeSessionSnapshots(Array.from(uniqueById.values()));
  }, [mergeSessionSnapshots, recentSessionsQuery.data?.results, sessionsQuery.data?.results]);

  const formatDuration = useCallback(
    (startIso?: string, endIso?: string) => {
    if (!startIso) {
      return "—";
    }
    const start = Date.parse(startIso);
    const end = endIso ? Date.parse(endIso) : nowTs;
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
      return "—";
    }
    const totalSeconds = Math.floor((end - start) / 1000);
    const hours = Math.floor(totalSeconds / 3600)
      .toString()
      .padStart(2, "0");
    const minutes = Math.floor((totalSeconds % 3600) / 60)
      .toString()
      .padStart(2, "0");
    const seconds = Math.floor(totalSeconds % 60)
      .toString()
      .padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  },
  [nowTs]
);

  const getSessionStatusLabel = useCallback((state: SessionLifecycle): string => {
    switch (state) {
      case "pending":
        return "Pending";
      case "authorized":
        return "Authorized";
      case "charging":
        return "Charging";
      case "finishing":
        return "Finishing";
      case "completed":
        return "Completed";
      case "errored":
        return "Error";
      case "timeout":
        return "Timeout";
      default:
        return "Idle";
    }
  }, []);

  const getSessionStatusClass = useCallback((state: SessionLifecycle): string => {
    switch (state) {
      case "pending":
        return styles.statusPending;
      case "authorized":
        return styles.statusAuthorized;
      case "charging":
        return styles.statusCharging;
      case "finishing":
        return styles.statusFinishing;
      case "completed":
        return styles.statusCompleted;
      case "errored":
        return styles.statusErrored;
      case "timeout":
        return styles.statusTimeout;
      default:
        return styles.statusIdle;
    }
  }, []);

  const connectorsSummary = useMemo(() => {
    const connectors = data?.connectors ?? [];
    const connectorsByNumber = new Map<number, SimulatedConnector>();
    connectors.forEach((connector) => {
      connectorsByNumber.set(connector.connector_id, connector);
    });
    const connectorIds = new Set<number>();
    connectorsByNumber.forEach((_, id) => connectorIds.add(id));
    Object.keys(meterTimelines).forEach((key) => {
      const id = Number(key);
      if (Number.isFinite(id) && id > 0) {
        connectorIds.add(id);
      }
    });
    Object.keys(sessionsByConnector).forEach((key) => {
      const id = Number(key);
      if (Number.isFinite(id) && id > 0) {
        connectorIds.add(id);
      }
    });
    const orderedIds = Array.from(connectorIds).sort((a, b) => a - b);
    return orderedIds.map((connectorId) => {
      const connector = connectorsByNumber.get(connectorId) ?? null;
      const runtime = sessionsByConnector[connectorId];
      const timeline = meterTimelines[connectorId];
      const liveSamples = timeline?.samples ?? [];
      const fallbackSample = liveSamples.length === 0 ? runtime?.finalSample ?? null : null;
      const samples = liveSamples.length ? liveSamples : fallbackSample ? [fallbackSample] : [];
      const latestSample = samples.at(-1) ?? null;
      const previousSample = samples.length > 1 ? samples[samples.length - 2] : null;
      const latestTimestamp = latestSample ? latestSample.timestamp : null;
      const sampleIsFresh =
        latestTimestamp !== null
          ? nowTs - latestTimestamp <= 15_000
          : false;
      let telemetryState: SessionLifecycle | undefined;
      if (latestSample && sampleIsFresh) {
        const grew = previousSample ? latestSample.valueWh > previousSample.valueWh : false;
        const reportedGrowth = latestSample.deltaWh !== undefined ? latestSample.deltaWh > 0 : grew;
        if (reportedGrowth) {
          telemetryState = "charging";
        }
      }

      let cmsSession =
        (runtime?.cmsSessionId && cmsSessionsIndex.byId.get(runtime.cmsSessionId)) ??
        (runtime?.transactionId
          ? cmsSessionsIndex.byFormatted.get(runtime.transactionId)
          : undefined);
      if (!cmsSession) {
        cmsSession =
          cmsSessionsIndex.byConnectorNumber.get(connectorId)?.find((session) => !session.end_time) ??
          cmsSessionsIndex.byConnectorNumber.get(connectorId)?.[0];
      }

      const connectorStatus = normalizeConnectorStatus(connector?.initial_status) ?? "AVAILABLE";
      const stateFromConnector: SessionLifecycle = (() => {
        switch (connectorStatus) {
          case "CHARGING":
            return "charging";
          case "FAULTED":
            return "errored";
          case "PREPARING":
            return "authorized";
          case "UNAVAILABLE":
            return "pending";
          case "RESERVED":
            return "pending";
          case "SUSPENDED_EV":
          case "SUSPENDED_EVSE":
            return "authorized";
          case "FINISHING":
            return "finishing";
          default:
            return "idle";
        }
      })();
      const cmsTransactionId = pickCanonicalTransactionId(
        cmsSession?.formatted_transaction_id,
        cmsSession?.cms_transaction_key,
        cmsSession?.transaction_id
      );
      const transactionId =
        runtime?.transactionId ??
        timeline?.transactionId ??
        latestSample?.transactionId ??
        cmsTransactionId;

      const cmsMeterStartWh = cmsSession?.meter_start;
      const runtimeMeterStartWh = runtime?.meterStartWh ?? samples[0]?.valueWh ?? undefined;
      const resolvedStartWh =
        cmsMeterStartWh ??
        runtimeMeterStartWh ??
        samples[0]?.valueWh ??
        runtime?.meterStopWh ??
        cmsSession?.meter_stop ??
        0;
      const latestSampleWh = latestSample?.valueWh;
      const stopCandidates = [
        runtime?.meterStopWh,
        cmsSession?.meter_stop,
        latestSampleWh,
        resolvedStartWh
      ].filter((value): value is number => typeof value === "number");
      const meterStopWh = stopCandidates.length ? Math.max(...stopCandidates) : resolvedStartWh;
      const meterStartWh = Math.min(resolvedStartWh, meterStopWh);
      const energyWh = Math.max(meterStopWh - meterStartWh, 0);
      const energyKwh = Number((energyWh / 1000).toFixed(3));

      const sessionState: SessionLifecycle =
        runtime?.state ??
        telemetryState ??
        (cmsSession && !cmsSession.end_time ? "charging" : undefined) ??
        stateFromConnector;
      const startedAt = runtime?.startedAt ?? cmsSession?.start_time ?? samples[0]?.isoTimestamp;
      const completedAt = runtime?.completedAt ?? (cmsSession?.end_time ?? undefined);
      const duration = formatDuration(
        startedAt,
        sessionState === "charging" || sessionState === "authorized" ? undefined : completedAt
      );

      const deltaKwh =
        typeof latestSample?.deltaWh === "number"
          ? Math.max(latestSample.deltaWh / 1000, 0)
          : latestSample && previousSample
            ? Math.max((latestSample.valueWh - previousSample.valueWh) / 1000, 0)
            : null;

      let powerKw: number | null = typeof latestSample?.powerKw === "number" ? latestSample.powerKw : null;
      if (powerKw === null && latestSample && previousSample) {
        const delta = latestSample.valueWh - previousSample.valueWh;
        const seconds = (latestSample.timestamp - previousSample.timestamp) / 1000;
        if (delta > 0 && seconds > 0) {
          powerKw = Number(((delta / 1000) / (seconds / 3600)).toFixed(2));
        }
      }
      if (powerKw === null && samples.length === 0) {
        powerKw = runtime?.maxKw ?? connector?.max_kw ?? null;
      }

      const lastSampleIso = latestSample?.isoTimestamp ?? runtime?.lastSampleAt ?? null;
      const lastUpdated = formatLocalTimestamp(lastSampleIso, { withSeconds: true });

      const meterStartKwh = Number((meterStartWh / 1000).toFixed(3));
      const meterStopKwh = Number((meterStopWh / 1000).toFixed(3));
      const current = typeof latestSample?.currentA === "number" ? latestSample.currentA : null;
      const idTag = runtime?.idTag ?? undefined;

      return {
        connectorId,
        connector,
        samples,
        sessionState,
        connectorStatus,
        statusLabel: formatConnectorStatusLabel(connectorStatus),
        statusTone: connectorStatusTone(connectorStatus),
        sessionStatusLabel: getSessionStatusLabel(sessionState),
        sessionStatusClass: getSessionStatusClass(sessionState),
        transactionId,
        transactionKey:
          runtime?.transactionKey ??
          timeline?.transactionKey ??
          (runtime?.cmsTransactionKey ?? undefined),
        runtime,
        energyKwh,
        meterStartKwh,
        meterStopKwh,
        deltaKwh,
        powerKw,
        lastUpdated,
        lastSampleAt: lastSampleIso,
        duration,
        cmsSession,
        current,
        idTag
      };
    });
  }, [
    cmsSessionsIndex,
    data?.connectors,
    formatDuration,
    getSessionStatusClass,
    getSessionStatusLabel,
    meterTimelines,
    sessionsByConnector,
    nowTs
  ]);

  const connectorSelectOptions = useMemo(
    () =>
      connectorsSummary.map((summary) => ({
        id: summary.connectorId,
        label: `#${summary.connectorId} · ${summary.connector?.format ?? "Connector"}`
      })),
    [connectorsSummary]
  );

  const defaultConnectorId =
    connectorSelectOptions[0]?.id ?? data?.connectors?.[0]?.connector_id ?? null;

  const connectorTargetSelectId = useMemo(
    () => `connector-target-${simulatorId}`,
    [simulatorId]
  );

  const actionConnectorId = useMemo(
    () => (selectedConnectorId !== null ? selectedConnectorId : defaultConnectorId),
    [selectedConnectorId, defaultConnectorId]
  );

  const connectorsConfigured = connectorsSummary.length > 0;

  const connectorBaselines = useMemo(() => {
    const map = new Map<number, number>();
    connectorsSummary.forEach((summary) => {
      if (typeof summary.meterStartKwh === "number" && Number.isFinite(summary.meterStartKwh)) {
        map.set(summary.connectorId, summary.meterStartKwh);
      }
    });
    return map;
  }, [connectorsSummary]);

  const connectorOptions = useMemo(
    () =>
      connectorsSummary.map((summary) => ({
        id: summary.connector?.id ?? summary.connectorId,
        connector_id: summary.connectorId,
        format: summary.connector?.format ?? undefined,
        max_kw: summary.connector?.max_kw ?? undefined,
        phase_count: summary.connector?.phase_count ?? undefined,
        initial_status: (summary.connectorStatus ?? "AVAILABLE") as ConnectorStatus,
        metadata: summary.connector?.metadata ?? {}
      })),
    [connectorsSummary]
  );

  useEffect(() => {
    connectorsSummary.forEach((summary) => {
      if (
        (summary.sessionState === "completed" || summary.sessionState === "finishing") &&
        summary.transactionKey &&
        (!telemetryHistory[summary.connectorId] || telemetryHistory[summary.connectorId].length <= 1)
      ) {
        void hydrateConnectorHistory(summary.connectorId, summary.transactionKey);
      }
    });
  }, [connectorsSummary, telemetryHistory, hydrateConnectorHistory]);

  useEffect(() => {
    if (!connectorsSummary.length) {
      if (selectedConnectorId !== null) {
        setSelectedConnectorId(null);
      }
      return;
    }
    if (
      selectedConnectorId !== null &&
      connectorsSummary.some((summary) => summary.connectorId === selectedConnectorId)
    ) {
      return;
    }
    const preferred =
      connectorsSummary.find((summary) => summary.samples.length > 0)?.connectorId ??
      connectorsSummary[0]?.connectorId ??
      null;
    if (preferred !== null && preferred !== selectedConnectorId) {
      setSelectedConnectorId(preferred);
    }
  }, [connectorsSummary, selectedConnectorId]);

  const primaryConnector =
    (selectedConnectorId
      ? connectorsSummary.find((summary) => summary.connectorId === selectedConnectorId)
      : null) ??
    connectorsSummary.find((summary) => summary.samples.length > 0) ??
    connectorsSummary[0] ??
    null;

  const telemetryFeed = useMemo<TelemetryFeedEntry[]>(() => {
    const sourceHistory =
      Object.keys(telemetryHistory).length > 0
        ? telemetryHistory
        : Object.fromEntries(
            Object.entries(meterTimelines).map(([connectorKey, timeline]) => [
              connectorKey,
              timeline?.samples ?? []
            ])
          );
    const entries = Object.entries(sourceHistory).flatMap(([connectorKey, samples]) => {
      const connectorId = Number(connectorKey);
      if (!Number.isFinite(connectorId)) {
        return [];
      }
      return samples.map((sample) => ({
        connectorId,
        sample
      }));
    });
    return entries
      .sort((a, b) => b.sample.timestamp - a.sample.timestamp)
      .slice(0, TELEMETRY_FEED_LIMIT)
      .map(({ connectorId, sample }) => {
        const runtime = sessionsByConnector[connectorId];
        const status = runtime?.state ?? "idle";
        const statusClass = getSessionStatusClass(status);
        const statusLabel = getSessionStatusLabel(status);
        const rawEnergyKwh =
          typeof sample.energyKwh === "number" && Number.isFinite(sample.energyKwh)
            ? sample.energyKwh
            : null;
        const startKwh = connectorBaselines.get(connectorId);
        const deliveredKwh =
          rawEnergyKwh !== null && startKwh !== undefined
            ? Math.max(rawEnergyKwh - startKwh, 0)
            : rawEnergyKwh;
        return {
          connectorId,
          timestamp: sample.isoTimestamp,
          transactionId: runtime?.transactionId ?? sample.transactionId,
          powerKw: sample.powerKw,
          current: sample.currentA,
          energyKwh: deliveredKwh,
          energyRegisterKwh: rawEnergyKwh,
          status,
          statusClass,
          statusLabel,
          idTag: runtime?.idTag
        };
      });
  }, [
    getSessionStatusClass,
    getSessionStatusLabel,
    connectorBaselines,
    sessionsByConnector,
    telemetryHistory,
    meterTimelines
  ]);

  useEffect(() => {
    timelineCardRef.current?.reset();
  }, [simulatorId]);

  useEffect(() => {
    timelineCardRef.current?.syncTelemetry(telemetryFeed);
  }, [telemetryFeed]);

  useEffect(() => {
    timelineCardRef.current?.syncTimeline(timelineEvents);
  }, [timelineEvents]);

  useEffect(() => {
    timelineCardRef.current?.syncHeartbeats(heartbeatEvents);
  }, [heartbeatEvents]);

  const activeConnectorId = primaryConnector?.connectorId ?? selectedConnectorId;
  const graphIsFrozen =
    primaryConnector?.sessionState === "completed" || primaryConnector?.sessionState === "finishing";
  const liveGraphSamples = primaryConnector?.samples ?? [];
  const resolvedConnectorId =
    typeof activeConnectorId === "number" && Number.isFinite(activeConnectorId)
      ? activeConnectorId
      : null;
  const frozenGraphSamples =
    graphIsFrozen && resolvedConnectorId !== null ? telemetryHistory[resolvedConnectorId] ?? [] : [];
  const graphSamples =
    graphIsFrozen && frozenGraphSamples.length ? frozenGraphSamples : liveGraphSamples;

const activeSession = useMemo(() => {
  const sessions = sessionsQuery.data?.results ?? [];
  const charging = sessions.find((session) =>
    session.state === "charging" || session.state === "authorized"
  );
  return charging ?? sessions[0] ?? null;
}, [sessionsQuery.data?.results]);

  const resetStatusLabel = useMemo(() => {
    if (!resetFlow) {
      return null;
    }
    if (resetFlow.stage === "requested") {
      return resetFlow.type === "Force" ? "Force reset queued…" : "Reset queued…";
    }
    if (resetFlow.stage === "rebooting") {
      if (resetFlow.type === "Soft") {
        return "Restarting…";
      }
      return resetFlow.type === "Force" ? "Force rebooting…" : "Rebooting…";
    }
    return "Reconnected";
  }, [resetFlow]);

  const handleQuickStop = async () => {
    if (!data) return;
    if (!activeSession) {
      setShowStopModal(true);
      return;
    }
    try {
      const sessionTransactionKey = pickCanonicalTransactionId(
        activeSession.cms_transaction_key,
        activeSession.cms_transaction
      );
      const matchedConnector = sessionTransactionKey
        ? connectorsSummary.find((summary) => summary.transactionKey === sessionTransactionKey)
        : null;
      const connectorNumberFromSession = activeSession ? resolveConnectorNumber(activeSession) : null;
      const connectorToStop = matchedConnector?.connectorId ?? connectorNumberFromSession ?? undefined;
      await handleRemoteStop({
        transactionId: sessionTransactionKey,
        connectorId: connectorToStop
      });
    } catch (error) {
      const message = extractErrorMessage(error);
      pushToast({
        title: "Stop failed",
        description: message,
        level: "error"
      });
    }
  };

  const latestInstance = useMemo(() => {
    const instances = instancesQuery.data?.results ?? [];
    const scoped = instances.filter((instance) => instance.sim === simulatorId);
    if (!scoped.length) {
      return null;
    }
    const ordered = [...scoped].sort((a, b) => {
      const aTime = a.created_at ? Date.parse(a.created_at) : 0;
      const bTime = b.created_at ? Date.parse(b.created_at) : 0;
      return bTime - aTime;
    });
    return ordered[0] ?? null;
  }, [instancesQuery.data?.results, simulatorId]);

  const extractErrorMessage = (error: unknown): string => {
    if (error instanceof ApiError) {
      return error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return "Request failed";
  };

  const handleSimulatorUpdate = useCallback(
    async (payload: SimulatorUpdatePayload) => {
      if (!data) {
        throw new Error("Simulator not loaded.");
      }
      setEditBusy(true);
      try {
        const updated = await api.request<DetailResponse>(
          `/api/ocpp-simulator/simulated-chargers/${data.id}/`,
          {
            method: "PATCH",
            body: payload
          }
        );
        queryClient.setQueryData(queryKeys.simulatorDetail(simulatorId), updated);
        queryClient.invalidateQueries({ queryKey: queryKeys.simulators() });
        pushToast({
          title: "Simulator updated",
          description: "Configuration saved",
          level: "success",
          timeoutMs: 3500
        });
        setShowEditModal(false);
      } catch (error) {
        throw new Error(extractErrorMessage(error));
      } finally {
        setEditBusy(false);
      }
    },
    [api, data, pushToast, queryClient, simulatorId]
  );

  const refreshSimulator = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.simulatorDetail(simulatorId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.simulatorInstances });
    queryClient.invalidateQueries({ queryKey: ["simulators"] });
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
    queryClient.invalidateQueries({ queryKey: ["meter-values"] });
    if (data?.charger_id) {
      queryClient.invalidateQueries({ queryKey: ["cms-connectors", data.charger_id] });
      queryClient.invalidateQueries({ queryKey: ["cms-charging-sessions", data.charger_id] });
    }
  }, [queryClient, simulatorId, data?.charger_id]);

  const patchSimulatorDetail = useCallback(
    (mutator: (current: DetailResponse) => DetailResponse) => {
      queryClient.setQueryData<DetailResponse | undefined>(
        queryKeys.simulatorDetail(simulatorId),
        (current) => (current ? mutator(current) : current)
      );
    },
    [queryClient, simulatorId]
  );

  const patchConnectorStatus = useCallback(
    (connectorId: number, status?: string) => {
      patchSimulatorDetail((current) => {
        const connectors = current.connectors ?? [];
        let changed = false;
        const next = connectors.map((connector) => {
          if (connector.connector_id !== connectorId) {
            return connector;
          }
          const resolvedStatus =
            normalizeConnectorStatus(status ?? connector.initial_status ?? "AVAILABLE") ??
            normalizeConnectorStatus(connector.initial_status) ??
            (connector.initial_status as ConnectorStatus | undefined) ??
            "AVAILABLE";
          if (connector.initial_status === resolvedStatus) {
            return connector;
          }
          changed = true;
          return { ...connector, initial_status: resolvedStatus as ConnectorStatus };
        });
        if (!changed) {
          return current;
        }
        return { ...current, connectors: next };
      });
    },
    [patchSimulatorDetail]
  );

  const patchTelemetrySnapshot = useCallback(
    (connectorId: number, updates: Record<string, unknown>) => {
      patchSimulatorDetail((current) => {
        const key = connectorId.toString();
        const snapshot = { ...(current.telemetrySnapshot ?? {}) };
        const existing = snapshot[key] ?? { connectorId };
        const merged = { ...existing, ...updates };
        snapshot[key] = merged;
        return { ...current, telemetrySnapshot: snapshot };
      });
    },
    [patchSimulatorDetail]
  );

  const snapshotPayloadFromSample = useCallback((sample?: NormalizedSample | null) => {
    if (!sample) {
      return undefined;
    }
    return {
      timestamp: sample.isoTimestamp,
      valueWh: sample.valueWh,
      energyKwh: sample.energyKwh,
      powerKw: sample.powerKw,
      currentA: sample.currentA,
      voltageV: sample.voltageV,
      deltaWh: sample.deltaWh
    };
  }, []);

  const renderSocketStatusLabel = useCallback((status: string): string => {
    switch (status) {
      case "open":
        return "Connected";
      case "connecting":
        return "Connecting…";
      case "error":
        return "Error";
      case "closed":
        return "Offline";
      default:
        return "Offline";
    }
  }, []);

  const resolveSocketStatusClass = useCallback((status: string): string => {
    if (status === "open") {
      return styles.socketStatusLive;
    }
    if (status === "connecting") {
      return styles.socketStatusPending;
    }
    if (status === "error") {
      return styles.socketStatusError;
    }
    return styles.socketStatusIdle;
  }, []);

  const handleSimulatorEvent = useCallback(
    (event: SimulatorEventPayload) => {
      if (!event || typeof event !== "object") {
        return;
      }
      switch (event.type) {
        case "dashboard_connected":
        case "dashboard.connected": {
          setDashboardOnline(true);
          break;
        }
        case "dashboard_disconnected":
        case "dashboard.disconnected": {
          setDashboardOnline(false);
          break;
        }
        case "log.entry": {
          const level = typeof event.level === "string" ? event.level.toLowerCase() : "info";
          if (level === "info") {
            break;
          }
          const message =
            typeof event.message === "string"
              ? event.message
              : JSON.stringify(event.message ?? "");
          const timestamp =
            typeof event.timestamp === "string"
              ? event.timestamp
              : new Date().toISOString();
          const tone: TimelineTone =
            level === "error"
              ? "danger"
              : level === "warning"
                ? "warning"
                : "info";
          pushTimelineEvent({
            dedupeKey: `log:${timestamp}:${message}`,
            timestamp,
            kind: "log",
            title: message,
            subtitle: "Simulator runtime",
            badge: level.toUpperCase(),
            tone,
            icon: tone === "danger" ? "alert" : "info"
          });
          break;
        }
        case "simulator.connected": {
          const snapshot = event.simulator as
            | { connectors?: Array<{ id?: number; status?: string }> }
            | undefined;
          if (snapshot?.connectors?.length) {
            queryClient.setQueryData<DetailResponse | undefined>(
              queryKeys.simulatorDetail(simulatorId),
              (current) => {
                if (!current) {
                  return current;
                }
                const connectors = current.connectors.map((connector) => {
                  const matched = snapshot.connectors?.find(
                    (item) => Number(item.id) === connector.connector_id
                  );
                  if (!matched) {
                    return connector;
                  }
                  const status =
                    normalizeConnectorStatus(matched.status) ??
                    normalizeConnectorStatus(connector.initial_status) ??
                    connector.initial_status;
                  return { ...connector, initial_status: (status ?? connector.initial_status) as ConnectorStatus };
                });
                return { ...current, connectors };
              }
            );
          }
          const timestamp =
            typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString();
          const connectorCount = snapshot?.connectors?.length ?? 0;
          pushTimelineEvent({
            dedupeKey: `simulator.connected:${timestamp}`,
            timestamp,
            kind: "lifecycle",
            title: "Simulator connected to CMS",
            subtitle: event.chargerId ? `Charger ${event.chargerId}` : undefined,
            badge: "BootNotification",
            tone: "success",
            icon: "activity",
            metrics: connectorCount
              ? [{ label: "Connectors", value: connectorCount.toString(), muted: true }]
              : undefined
          });
          break;
        }
        case "connector.status": {
          const connectorIdRaw = event.connectorId as number | string | undefined;
          const connectorId = Number(connectorIdRaw);
          const normalizedStatus = normalizeConnectorStatus(event.status);
          if (!Number.isNaN(connectorId)) {
            patchConnectorStatus(
              connectorId,
              normalizedStatus ?? (typeof event.status === "string" ? event.status : undefined)
            );
          }
          const timestamp =
            typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString();
          const status = normalizedStatus ?? "AVAILABLE";
          const statusLabel = formatConnectorStatusLabel(status);
          const errorCode =
            typeof event.errorCode === "string" && event.errorCode !== "NoError"
              ? event.errorCode
              : undefined;
          const vendorErrorCode =
            typeof event.vendorErrorCode === "string" && event.vendorErrorCode.length
              ? event.vendorErrorCode
              : undefined;
          const isFault = Boolean(errorCode);
          const eventKind: TimelineKind = isFault ? "fault" : "connector";
          const subtitle = isFault
            ? vendorErrorCode
              ? `Vendor error ${vendorErrorCode}`
              : undefined
            : undefined;
          const badge = isFault ? errorCode : statusLabel;
          pushTimelineEvent({
            dedupeKey: `connector:${connectorId}:${timestamp}:${status}:${errorCode ?? "NoError"}`,
            timestamp,
            kind: eventKind,
            title: isFault ? `Connector #${connectorId} fault` : `Connector #${connectorId} is ${statusLabel}`,
            subtitle,
            badge,
            tone: isFault ? "danger" : connectorStatusTone(status),
            icon: "plug",
            meta: isFault ? `Status ${statusLabel}` : undefined
          });
          break;
        }
        case "simulator.state": {
          if (typeof event.state === "string") {
            setLiveLifecycleState(normalizeLifecycleState(event.state) ?? lifecycleState);
            queryClient.setQueryData<DetailResponse | undefined>(
              queryKeys.simulatorDetail(simulatorId),
              (current) =>
                current ? { ...current, lifecycle_state: event.state as SimulatedCharger["lifecycle_state"] } : current
            );
            queryClient.invalidateQueries({ queryKey: ["simulators"] });
            const timestamp =
              typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString();
            const formatted = event.state.replace(/_/g, " ");
            pushTimelineEvent({
              dedupeKey: `lifecycle:${event.state}:${timestamp}`,
              timestamp,
              kind: "lifecycle",
              title: `Lifecycle -> ${formatted}`,
              badge: formatted,
              tone: timelineToneForStatus(event.state),
              icon: "power",
              meta: event.connected === false ? "CMS disconnected" : undefined
            });
          }
          if (typeof event.connected === "boolean" && resetFlowRef.current) {
            if (!event.connected && resetFlowRef.current.stage === "requested") {
              setResetFlow((current) =>
                current && current.stage === "requested" ? { ...current, stage: "rebooting" } : current
              );
              pushToast({
                title: "Reset in progress",
                description: "Charger rebooting and reconnecting to the CMS.",
                level: "info",
                timeoutMs: 3000
              });
            }
            if (event.connected && resetFlowRef.current.stage !== "reconnected") {
              setResetFlow((current) => (current ? { ...current, stage: "reconnected" } : current));
              pushToast({
                title: "Charger reconnected",
                description: "BootNotification received and telemetry will resume shortly.",
                level: "success",
                timeoutMs: 3500
              });
              timelineCardRef.current?.reset();
              setTimelineEvents([]);
              timelineKeysRef.current.clear();
              setMeterTimelines({});
              setTelemetryHistory({});
              setSessionsByConnector({});
              telemetryThrottleRef.current = {};
              frozenConnectorsRef.current.clear();
              refreshSimulator();
            }
          }
          break;
        }
        case "meter.sample":
          ((): void => {
            const connectorIdRaw = event.connectorId as number | string | undefined;
            const connectorId = Number(connectorIdRaw);
            if (!Number.isFinite(connectorId) || connectorId <= 0) {
              return;
            }
            const valueWh = Number(event.valueWh ?? event.value);
            if (!Number.isFinite(valueWh)) {
              return;
            }
            if (frozenConnectorsRef.current.has(connectorId)) {
              return;
            }
            const runtimeSnapshot = sessionsRef.current[connectorId];
            if (runtimeSnapshot?.state === "completed") {
              return;
            }
            const rawTransactionId = event.transactionId as string | number | undefined;
            const transactionId = resolveEventTransactionId(rawTransactionId);
            const deltaWh = toNumber(event.deltaWh);
            const powerKw = toNumber(event.powerKw ?? event.power);
            const voltageV = toNumber(event.voltageV ?? event.voltage);
            const currentA = toNumber(event.currentA ?? event.current);
            const energyKwh = toNumber(event.energyKwh);
            const intervalSeconds = toNumber(event.intervalSeconds ?? event.interval);
            const sampleTimestamp =
              typeof event.sampleTimestamp === "string"
                ? event.sampleTimestamp
                : typeof event.timestamp === "string"
                  ? event.timestamp
                  : new Date().toISOString();
            let recordedSample: NormalizedSample | null = null;
            setMeterTimelines((current) => {
              const existing = current[connectorId];
              const transactionToUse = transactionId ?? existing?.transactionId;
              const samples = existing?.samples ?? [];
              const previousSample = samples.at(-1);
              const normalizedSample = normalizeSample(
                {
                  connectorId,
                  timestamp: sampleTimestamp,
                  valueWh,
                  deltaWh,
                  intervalSeconds,
                  powerKw,
                  currentA,
                  voltageV,
                  energyKwh,
                  transactionId: transactionToUse
                },
                previousSample
              );
              recordedSample = normalizedSample;
              const appended = appendSample(samples, normalizedSample);
              const updatedSamples = trimWindow(appended, TELEMETRY_WINDOW_MS);
              return {
                ...current,
                [connectorId]: {
                  transactionId: transactionToUse,
                  transactionKey: transactionToUse ?? existing?.transactionKey,
                  samples: updatedSamples
                }
              };
            });
            if (transactionId) {
              setSessionsByConnector((current) => {
                const existing = current[connectorId];
                if (!existing) {
                  return current;
                }
                if (transactionId && existing.transactionId && existing.transactionId !== transactionId) {
                  return current;
                }
                return {
                  ...current,
                  [connectorId]: {
                    ...existing,
                    transactionId: transactionId ?? existing.transactionId,
                    transactionKey: transactionId ?? existing.transactionKey,
                    cmsTransactionKey: transactionId ?? existing.cmsTransactionKey
                  }
                };
              });
            }
            if (recordedSample) {
              const processedSample: NormalizedSample = recordedSample;
              setSessionsByConnector((current) => {
                const existing = current[connectorId];
                if (!existing) {
                  return current;
                }
                return {
                  ...current,
                  [connectorId]: {
                    ...existing,
                    finalSample: processedSample,
                    lastSampleAt: processedSample.isoTimestamp
                  }
                };
              });
              appendTelemetrySample(connectorId, processedSample);
              if (shouldRecordTelemetry(connectorId, processedSample.isoTimestamp)) {
                const runtimeSnapshot = sessionsRef.current[connectorId];
                const telemetryMetrics: TimelineMetric[] = [];
                const powerLabel = `${processedSample.powerKw.toFixed(2)} kW`;
                const currentLabel = `${processedSample.currentA.toFixed(1)} A`;
                const energyValue = processedSample.energyKwh;
                telemetryMetrics.push({
                  label: "Energy",
                  value: `${formatNumber(energyValue, { digits: 3 })} kWh`
                });
                telemetryMetrics.push({ label: "Power", value: powerLabel });
                telemetryMetrics.push({ label: "Current", value: currentLabel, muted: true });
                const runtimeState = runtimeSnapshot?.state;
                const runtimeStateLabel = runtimeState
                  ? getSessionStatusLabel(runtimeState)
                  : "Telemetry";
                const txLabel = transactionId ?? runtimeSnapshot?.transactionId;
                pushTimelineEvent({
                  dedupeKey: `meter:${connectorId}:${processedSample.isoTimestamp}`,
                  timestamp: processedSample.isoTimestamp,
                  kind: "meter",
                  title: "Telemetry update",
                  subtitle: `Connector #${connectorId}${txLabel ? ` · Tx ${txLabel}` : ""}`,
                  badge: runtimeStateLabel,
                  tone: "info",
                  icon: "gauge",
                  metrics: telemetryMetrics
                });
              }
            }
          })();
          break;
        case "session.started": {
          const connectorIdRaw = event.connectorId as number | string | undefined;
          const connectorId = Number(connectorIdRaw);
          if (!Number.isFinite(connectorId) || connectorId <= 0) {
            break;
          }
          delete telemetryThrottleRef.current[connectorId];
          const rawStartTransaction = event.transactionId as string | number | undefined;
          const transactionId = resolveEventTransactionId(rawStartTransaction);
          const startedAt =
            typeof event.startedAt === "string"
              ? event.startedAt
              : new Date().toISOString();
          const rawMeterStart = Number(event.meterStartWh);
          let normalizedMeterStart = Number.isFinite(rawMeterStart) ? rawMeterStart : undefined;
          const pricePerKwh =
            typeof event.pricePerKwh === "number"
              ? event.pricePerKwh
              : data?.price_per_kwh ?? null;
          const maxKw =
            typeof event.maxKw === "number"
              ? event.maxKw
              : null;
          const idTag =
            typeof event.idTag === "string" ? event.idTag : undefined;
          frozenConnectorsRef.current.delete(connectorId);
          setSessionsByConnector((current) => {
            const existing = current[connectorId];
            const previousStop = existing?.meterStopWh;
            let resolvedStart = normalizedMeterStart ?? previousStop ?? 0;
            if (typeof previousStop === "number" && resolvedStart < previousStop) {
              resolvedStart = previousStop;
            }
            normalizedMeterStart = resolvedStart;
            return {
              ...current,
              [connectorId]: {
                connectorId,
                transactionId: transactionId ?? existing?.transactionId,
                transactionKey: transactionId ?? existing?.transactionKey,
                cmsTransactionKey: transactionId ?? existing?.cmsTransactionKey,
                idTag: idTag ?? existing?.idTag,
                startedAt,
                completedAt: undefined,
                updatedAt: startedAt,
                state: "charging",
                meterStartWh: resolvedStart,
                meterStopWh: undefined,
                pricePerKwh: pricePerKwh ?? existing?.pricePerKwh ?? null,
                maxKw: maxKw ?? existing?.maxKw ?? null,
                cmsSessionId: existing?.cmsSessionId,
                finalSample: null,
                lastSampleAt: startedAt
              }
            };
          });
          let baselineSample: NormalizedSample | null = null;
          setMeterTimelines((current) => {
            const existing = current[connectorId];
            baselineSample = normalizeSample(
              {
                connectorId,
                timestamp: startedAt,
                valueWh: normalizedMeterStart ?? 0,
                powerKw: 0,
                currentA: 0,
                energyKwh: Number(((normalizedMeterStart ?? 0) / 1000).toFixed(3)),
                transactionId: transactionId ?? existing?.transactionId
              },
              undefined
            );
            const updatedSamples = appendSample(existing?.samples ?? [], baselineSample);
            return {
              ...current,
              [connectorId]: {
                transactionId: transactionId ?? existing?.transactionId,
                transactionKey: transactionId ?? existing?.transactionKey,
                samples: trimWindow(updatedSamples, TELEMETRY_WINDOW_MS)
              }
            };
          });
          if (baselineSample) {
            appendTelemetrySample(connectorId, baselineSample);
          }
          patchConnectorStatus(connectorId, "CHARGING");
          patchTelemetrySnapshot(connectorId, {
            transactionId: transactionId ?? undefined,
            state: "CHARGING",
            meterStartWh: normalizedMeterStart ?? undefined,
            meterStopWh: undefined,
            lastSample: snapshotPayloadFromSample(baselineSample)
          });
          queryClient.invalidateQueries({
            queryKey: queryKeys.sessions({ simulator: simulatorId, active: true })
          });
          queryClient.invalidateQueries({
            queryKey: queryKeys.meterValues({ simulator: simulatorId, limit: 120 })
          });
          telemetryThrottleRef.current[connectorId] = 0;
          const startEnergyKwh =
            typeof normalizedMeterStart === "number"
              ? Number((normalizedMeterStart / 1000).toFixed(3))
              : null;
          const startMetrics: TimelineMetric[] = [];
          if (startEnergyKwh !== null) {
            startMetrics.push({ label: "Meter start", value: `${startEnergyKwh} kWh` });
          }
          if (typeof pricePerKwh === "number") {
            startMetrics.push({
              label: "Price",
              value: `${pricePerKwh.toFixed(2)} per kWh`,
              muted: true
            });
          }
          if (typeof maxKw === "number") {
            startMetrics.push({ label: "Max power", value: `${maxKw.toFixed(1)} kW`, muted: true });
          }
          pushTimelineEvent({
            dedupeKey: `session:${connectorId}:${transactionId ?? startedAt}:start`,
            timestamp: startedAt,
            kind: "session",
            title: "Session started",
            subtitle: `Connector #${connectorId}${idTag ? ` · ${idTag}` : ""}`,
            badge: transactionId ? `Tx ${transactionId}` : undefined,
            tone: "success",
            icon: "zap",
            metrics: startMetrics.length ? startMetrics : undefined
          });
          break;
        }
        case "session.stopped": {
          const connectorIdRaw = event.connectorId as number | string | undefined;
          const connectorId = Number(connectorIdRaw);
          if (!Number.isFinite(connectorId) || connectorId <= 0) {
            break;
          }
          const rawStopTransaction = event.transactionId as string | number | undefined;
          const transactionId = resolveEventTransactionId(rawStopTransaction);
          const meterStopWh = Number(event.meterStopWh ?? "");
          const endedAt =
            typeof event.endedAt === "string"
              ? event.endedAt
              : typeof event.timestamp === "string"
                ? event.timestamp
                : new Date().toISOString();
          const finalPowerKw = toNumber(event.powerKw ?? event.power);
          const finalCurrentA = toNumber(event.currentA ?? event.current);
          const finalVoltageV = toNumber(event.voltageV ?? event.voltage);
          const finalEnergyKwh = toNumber(event.energyKwh ?? event.energy_kwh);
          const stopDeltaWh = toNumber(event.deltaWh);
          const sampleTimestamp =
            typeof event.sampleTimestamp === "string"
              ? event.sampleTimestamp
              : endedAt;
          const previousSession = sessionsRef.current[connectorId];
          const timelineSnapshot = meterTimelines[connectorId];
          const stopSample =
            Number.isFinite(meterStopWh)
              ? normalizeSample(
                  {
                    connectorId,
                    timestamp: sampleTimestamp ?? endedAt,
                    valueWh: meterStopWh as number,
                    energyKwh: finalEnergyKwh ?? Number(((meterStopWh as number) / 1000).toFixed(3)),
                    transactionId: transactionId ?? timelineSnapshot?.transactionId,
                    powerKw: finalPowerKw,
                    currentA: finalCurrentA,
                    voltageV: finalVoltageV,
                    deltaWh: stopDeltaWh
                  },
                  timelineSnapshot?.samples?.at(-1)
                )
              : null;
          setSessionsByConnector((current) => {
            const existing = current[connectorId];
            if (!existing) {
              return current;
            }
            if (transactionId && existing.transactionId && existing.transactionId !== transactionId) {
              return current;
            }
            const updatedSession: SessionRuntime = {
              ...existing,
              state: "completed",
              completedAt: sampleTimestamp ?? endedAt,
              updatedAt: sampleTimestamp ?? endedAt,
              meterStopWh: Number.isFinite(meterStopWh) ? meterStopWh : existing.meterStopWh,
              transactionId: transactionId ?? existing.transactionId,
              transactionKey: transactionId ?? existing.transactionKey,
              cmsTransactionKey: transactionId ?? existing.cmsTransactionKey,
              finalSample: stopSample ?? existing.finalSample ?? null,
              lastSampleAt: stopSample?.isoTimestamp ?? sampleTimestamp ?? existing.lastSampleAt ?? null
            };
            sessionsRef.current[connectorId] = updatedSession;
            return {
              ...current,
              [connectorId]: updatedSession
            };
          });
          frozenConnectorsRef.current.add(connectorId);
          let finalizedSample: NormalizedSample | null = null;
          const historyTransaction = transactionId ?? timelineSnapshot?.transactionId ?? previousSession?.transactionId;
          if (Number.isFinite(meterStopWh)) {
            setMeterTimelines((current) => {
              const existing = current[connectorId];
              const samples = existing?.samples ?? [];
              const normalizedSample = stopSample ?? normalizeSample(
                {
                  connectorId,
                  timestamp: sampleTimestamp ?? endedAt,
                  valueWh: meterStopWh as number,
                  energyKwh: finalEnergyKwh ?? Number(((meterStopWh as number) / 1000).toFixed(3)),
                  transactionId: transactionId ?? existing?.transactionId,
                  powerKw: finalPowerKw,
                  currentA: finalCurrentA,
                  voltageV: finalVoltageV,
                  deltaWh: stopDeltaWh
                },
                samples.at(-1)
              );
              finalizedSample = normalizedSample;
              const appended = appendSample(samples, normalizedSample);
              const updated = trimWindow(appended, TELEMETRY_WINDOW_MS);
              return {
                ...current,
                [connectorId]: {
                  transactionId: transactionId ?? existing?.transactionId,
                  transactionKey: transactionId ?? existing?.transactionKey,
                  samples: updated
                }
              };
            });
          }
          if (finalizedSample) {
            appendTelemetrySample(connectorId, finalizedSample);
          }
          patchConnectorStatus(connectorId, "AVAILABLE");
          patchTelemetrySnapshot(connectorId, {
            transactionId: transactionId ?? undefined,
            state: "COMPLETED",
            meterStopWh: Number.isFinite(meterStopWh) ? meterStopWh : undefined,
            lastSample: snapshotPayloadFromSample(finalizedSample ?? stopSample)
          });
          void hydrateConnectorHistory(connectorId, historyTransaction);
          queryClient.invalidateQueries({
            queryKey: queryKeys.sessions({ simulator: simulatorId, active: true })
          });
          queryClient.invalidateQueries({
            queryKey: queryKeys.meterValues({ simulator: simulatorId, limit: 120 })
          });
          const energyDeliveredKwh =
            Number.isFinite(meterStopWh) && previousSession?.meterStartWh !== undefined
              ? Number(
                  (Math.max((meterStopWh as number) - (previousSession.meterStartWh ?? 0), 0) / 1000).toFixed(3)
                )
              : undefined;
          const stopMetrics: TimelineMetric[] = [];
          if (Number.isFinite(meterStopWh)) {
            stopMetrics.push({
              label: "Meter stop",
              value: `${formatNumber(meterStopWh / 1000, { digits: 3 })} kWh`
            });
          }
          if (energyDeliveredKwh !== undefined) {
            stopMetrics.push({
              label: "Energy",
              value: `+${formatNumber(energyDeliveredKwh, { digits: 3 })} kWh`
            });
          }
          if (typeof finalPowerKw === "number") {
            stopMetrics.push({
              label: "Power",
              value: `${formatNumber(finalPowerKw, { digits: 2 })} kW`,
              muted: true
            });
          }
          if (typeof finalCurrentA === "number") {
            stopMetrics.push({
              label: "Current",
              value: `${formatNumber(finalCurrentA, { digits: 1 })} A`,
              muted: true
            });
          }
          if (typeof event.reason === "string") {
            stopMetrics.push({ label: "Reason", value: event.reason, muted: true });
          }
          pushTimelineEvent({
            dedupeKey: `session:${connectorId}:${transactionId ?? endedAt}:stop:${sampleTimestamp ?? endedAt}`,
            timestamp: sampleTimestamp ?? endedAt,
            kind: "session",
            title: "Session completed",
            subtitle: `Connector #${connectorId}${previousSession?.idTag ? ` · ${previousSession.idTag}` : ""}`,
            badge: transactionId ? `Tx ${transactionId}` : undefined,
            tone: "success",
            icon: "zap",
            metrics: stopMetrics.length ? stopMetrics : undefined
          });
          break;
        }
        case "command.failed":
          pushTimelineEvent({
            dedupeKey: `command:${event.commandLogId ?? event.action}:failed:${Date.now()}`,
            timestamp: new Date().toISOString(),
            kind: "command",
            title: `Command ${event.action ?? ""} failed`,
            subtitle:
              typeof event.error === "string"
                ? event.error
                : `Command ${event.action ?? ""} failed`,
            badge: "Failed",
            tone: "danger",
            icon: "alert"
          });
          pushToast({
            title: "Command failed",
            description:
              typeof event.error === "string"
                ? event.error
                : `Command ${event.action ?? ""} failed`,
            level: "error"
          });
          break;
        case "command.retry":
          pushTimelineEvent({
            dedupeKey: `command:${event.commandLogId ?? event.action}:retry:${event.attempt ?? "1"}`,
            timestamp: new Date().toISOString(),
            kind: "command",
            title: `Retry scheduled for ${event.action ?? "command"}`,
            subtitle: `Attempt ${event.attempt ?? "?"}`,
            badge: "Retry",
            tone: "warning",
            icon: "info"
          });
          pushToast({
            title: "Command retry queued",
            description: `Retrying ${event.action ?? "command"} (attempt ${event.attempt ?? "?"})`,
            level: "info",
            timeoutMs: 3000
          });
          break;
        case "heartbeat": {
          const timestamp =
            typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString();
          const chargerId =
            typeof event.chargerId === "string"
              ? event.chargerId
              : typeof event.cpid === "string"
                ? event.cpid
                : data?.charger_id ?? `Charger ${simulatorId}`;
          const connectorCountRaw =
            event.connectorCount ?? event.connectors ?? null;
          const connectorCount = Number(connectorCountRaw);
          const simulatorIdentifier = (event.simulatorId ?? data?.id) as number | string | undefined;
          setHeartbeatEvents((current) => {
            const entry: HeartbeatFeedEntry = {
              id: `${timestamp}:${chargerId}:${simulatorIdentifier ?? ""}`,
              timestamp,
              chargerId,
              simulatorId: simulatorIdentifier,
              connectorCount: Number.isFinite(connectorCount) ? Number(connectorCount) : undefined
            };
            const filtered = current.filter((item) => item.id !== entry.id);
            const next = [entry, ...filtered];
            return next.slice(0, HEARTBEAT_HISTORY_LIMIT);
          });
          break;
        }
        default:
          break;
      }
    },
    [
      pushToast,
      queryClient,
      simulatorId,
      data?.price_per_kwh,
      data?.charger_id,
      data?.id,
      pushTimelineEvent,
      shouldRecordTelemetry,
      refreshSimulator,
      getSessionStatusLabel,
      lifecycleState
    ]
  );

  const handleRemoteStart = async (payload: { connectorId: number; idTag: string }) => {
    if (!data) return;
    if (!cmsConnected) {
      const offlineMessage = "CMS connection is offline. Reconnect the simulator before starting a session.";
      pushToast({
        title: "CMS offline",
        description: offlineMessage,
        level: "warning",
        timeoutMs: 4000
      });
      throw new Error(offlineMessage);
    }
    setCommandBusy("start");
    try {
      await api.request(`/api/ocpp-simulator/simulated-chargers/${data.id}/remote-start/`, {
        method: "POST",
        body: { connectorId: payload.connectorId, idTag: payload.idTag }
      });
      pushToast({
        title: "Remote start dispatched",
        description: "RemoteStartTransaction has been queued for the charger.",
        level: "success",
        timeoutMs: 3500
      });
      setShowStartModal(false);
      refreshSimulator();
    } catch (error) {
      const message = extractErrorMessage(error);
      throw new Error(message);
    } finally {
      setCommandBusy(null);
    }
  };

  const handleRemoteStop = async (payload: { connectorId?: number; transactionId?: string }) => {
    if (!data) return;
    if (!payload.connectorId && !payload.transactionId) {
      throw new Error("Provide a connector or transaction ID.");
    }
    setCommandBusy("stop");
    try {
      await api.request(`/api/ocpp-simulator/simulated-chargers/${data.id}/remote-stop/`, {
        method: "POST",
        body: {
          ...(payload.connectorId ? { connectorId: payload.connectorId } : {}),
          ...(payload.transactionId ? { transactionId: payload.transactionId } : {})
        }
      });
      pushToast({
        title: "Remote stop dispatched",
        description: "RemoteStopTransaction has been queued for the charger.",
        level: "success",
        timeoutMs: 3500
      });
      setShowStopModal(false);
      refreshSimulator();
    } catch (error) {
      const message = extractErrorMessage(error);
      throw new Error(message);
    } finally {
      setCommandBusy(null);
    }
  };

  const handleConnectRequest = async () => {
    if (!data) return;
    setCommandBusy("connect");
    try {
      await api.request(`/api/ocpp-simulator/simulated-chargers/${data.id}/connect/`, {
        method: "POST"
      });
      pushToast({
        title: "Connecting to CMS",
        description: "BootNotification will be replayed shortly.",
        level: "info",
        timeoutMs: 3500
      });
    } catch (error) {
      const message = extractErrorMessage(error);
      pushToast({
        title: "Connect failed",
        description: message,
        level: "error"
      });
    } finally {
      refreshSimulator();
      setCommandBusy(null);
    }
  };

  const handleDisconnectRequest = async () => {
    if (!data) return;
    setCommandBusy("disconnect");
    try {
      await api.request(`/api/ocpp-simulator/simulated-chargers/${data.id}/disconnect/`, {
        method: "POST"
      });
      pushToast({
        title: "Disconnect requested",
        description: "Simulator WebSocket will close shortly.",
        level: "info",
        timeoutMs: 3500
      });
    } catch (error) {
      const message = extractErrorMessage(error);
      pushToast({
        title: "Disconnect failed",
        description: message,
        level: "error"
      });
    } finally {
      refreshSimulator();
      setCommandBusy(null);
    }
  };

  const handlePlugConnector = async (connectorId?: number) => {
    if (!data) return;
    const targetConnectorId = Number(
      connectorId ?? actionConnectorId ?? connectorsSummary[0]?.connectorId ?? data.connectors?.[0]?.connector_id
    );
    if (!Number.isFinite(targetConnectorId)) {
      pushToast({
        title: "No connector available",
        description: "Add a connector to the simulator before setting it to Preparing.",
        level: "warning"
      });
      return;
    }
    setCommandConnectorId(targetConnectorId);
    setCommandBusy("plug");
    try {
      await api.request(`/api/ocpp-simulator/simulated-chargers/${data.id}/status-update/`, {
        method: "POST",
        body: { connectorId: targetConnectorId, status: "Preparing" }
      });
      patchConnectorStatus(targetConnectorId, "PREPARING");
      pushToast({
        title: "Connector set to Preparing",
        description: `Connector #${targetConnectorId} is now plugged in.`,
        level: "success",
        timeoutMs: 3000
      });
      refreshSimulator();
    } catch (error) {
      const message = extractErrorMessage(error);
      pushToast({
        title: "Plug-in failed",
        description: message,
        level: "error"
      });
    } finally {
      setCommandConnectorId(null);
      setCommandBusy(null);
    }
  };

  const handleUnplugConnector = async (connectorId?: number) => {
    if (!data) return;
    const targetConnectorId = Number(
      connectorId ?? actionConnectorId ?? connectorsSummary[0]?.connectorId ?? data.connectors?.[0]?.connector_id
    );
    if (!Number.isFinite(targetConnectorId)) {
      pushToast({
        title: "No connector available",
        description: "Add a connector to the simulator before setting it to Available.",
        level: "warning"
      });
      return;
    }
    setCommandConnectorId(targetConnectorId);
    setCommandBusy("unplug");
    try {
      await api.request(`/api/ocpp-simulator/simulated-chargers/${data.id}/status-update/`, {
        method: "POST",
        body: { connectorId: targetConnectorId, status: "Available" }
      });
      patchConnectorStatus(targetConnectorId, "AVAILABLE");
      pushToast({
        title: "Connector set to Available",
        description: `Connector #${targetConnectorId} unplugged.`,
        level: "success",
        timeoutMs: 3000
      });
      refreshSimulator();
    } catch (error) {
      const message = extractErrorMessage(error);
      pushToast({
        title: "Unplug failed",
        description: message,
        level: "error"
      });
    } finally {
      setCommandConnectorId(null);
      setCommandBusy(null);
    }
  };

  const handleFaultInjection = async (payload: {
    connectorId: number;
    faultCode: string;
    status: string;
  }) => {
    if (!data) {
      return;
    }
    setFaultPending(true);
    try {
      await api.request(`/api/ocpp-simulator/simulated-chargers/${data.id}/fault-injection/`, {
        method: "POST",
        body: {
          faultCode: payload.faultCode,
          connectorId: payload.connectorId,
          status: payload.status
        }
      });
      pushToast({
        title: "Fault injected",
        description: `Sent ${payload.faultCode} to connector ${payload.connectorId}.`,
        level: "warning",
        timeoutMs: 3500
      });
      setShowFaultModal(false);
      queryClient.invalidateQueries({ queryKey: ["command-logs"] });
      queryClient.invalidateQueries({ queryKey: ["fault-injections"] });
    } catch (error) {
      const message = extractErrorMessage(error);
      throw new Error(message);
    } finally {
      setFaultPending(false);
    }
  };

  const handleResetCharger = async (resetType: "Soft" | "Hard") => {
    if (!data) return;
    setCommandBusy("reset");
    try {
      await api.request(`/api/ocpp-simulator/simulated-chargers/${data.id}/reset/`, {
        method: "POST",
        body: { type: resetType }
      });
      pushToast({
        title: "Reset requested",
        description: `${resetType} reset command queued for the charger.`,
        level: "info",
        timeoutMs: 3500
      });
      setShowResetModal(false);
      const initialStage: ResetFlowStage = resetType === "Hard" ? "requested" : "rebooting";
      setResetFlow({ type: resetType, stage: initialStage });
      if (resetType === "Soft") {
        refreshSimulator();
      }
    } catch (error) {
      const message = extractErrorMessage(error);
      pushToast({
        title: "Reset failed",
        description: message,
        level: "error"
      });
      throw new Error(message);
    } finally {
      setCommandBusy(null);
    }
  };

  const handleForceReset = async () => {
    if (!data) return;
    setCommandBusy("force-reset");
    try {
      await api.request(`/api/ocpp-simulator/simulated-chargers/${data.id}/force-reset/`, {
        method: "POST"
      });
      pushToast({
        title: "Force reset requested",
        description: "Terminating sessions and rebooting the charger.",
        level: "warning",
        timeoutMs: 4000
      });
      setShowForceResetModal(false);
      setResetFlow({ type: "Force", stage: "requested" });
    } catch (error) {
      const message = extractErrorMessage(error);
      pushToast({
        title: "Force reset failed",
        description: message,
        level: "error"
      });
    } finally {
      refreshSimulator();
      setCommandBusy(null);
    }
  };

  const chargerCode = data?.charger_id ?? null;
  const { status: socketStatus } = useSimulatorChannel({
    chargerId: chargerCode,
    enabled: Boolean(chargerCode),
    onEvent: handleSimulatorEvent
  });
  useEffect(() => {
    if (socketStatus !== "open") {
      setDashboardOnline(false);
    }
  }, [socketStatus]);
  useEffect(() => {
    setDashboardOnline(false);
  }, [simulatorId]);

  const resolveConnectorChipClass = (status?: ConnectorStatus | string): string => {
    const tone = connectorStatusTone(status);
    if (tone === "success") return styles.connectorChipCharging;
    if (tone === "danger") return styles.connectorChipFaulted;
    if (tone === "warning") return styles.connectorChipUnavailable;
    if (tone === "info") return styles.connectorChipReserved;
    return styles.connectorChipAvailable;
  };

  if (!Number.isFinite(simulatorId)) {
    return (
      <Card className={styles.errorCard}>
        <p>Invalid simulator identifier.</p>
        <Button variant="secondary" onClick={() => router.push("/simulators")}>Go back</Button>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className={styles.errorCard}>
        <p>Loading simulator…</p>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card className={styles.errorCard}>
        <p>Unable to load simulator detail.</p>
        <Button variant="secondary" onClick={() => router.push("/simulators")}>Back to list</Button>
      </Card>
    );
  }

  const socketStatusLabel = renderSocketStatusLabel(socketStatus);
  const socketBadgeClass = clsx(styles.connectionBadge, resolveSocketStatusClass(socketStatus));
  const liveFeedLabel = dashboardOnline ? "Connected" : socketStatusLabel;
  const liveFeedBadgeClass = dashboardOnline
    ? clsx(styles.connectionBadge, styles.socketStatusLive)
    : socketBadgeClass;
  const lifecycleMeta = getLifecycleStatusMeta(lifecycleState);
  const lifecycleToneClass = statusToneClassMap[lifecycleMeta.tone] ?? styles.statusNeutral;
  const lifecycleBadgeClass = clsx(styles.connectionBadge, lifecycleToneClass);
  const simulatorTitle = data.alias ?? data.charger_id ?? `Simulator #${data.id}`;
  const simulatorSubtitle = `${data.charger_id ?? `Charger ${data.charger}`}${
    data.alias ? ` · Simulator #${data.id}` : ""
  }`;
  const lastHeartbeatIso =
    cmsHeartbeatIso ??
    heartbeatEvents[0]?.timestamp ??
    data?.latest_instance_last_heartbeat ??
    latestInstance?.last_heartbeat ??
    null;
  const lastHeartbeatLabel = lastHeartbeatIso
    ? new Date(lastHeartbeatIso).toLocaleString()
    : "Waiting for heartbeat";
  const overviewFields = [
    { label: "CMS Status", value: cmsConnected ? "Online" : "Offline" },
    { label: "Protocol", value: data.protocol_variant?.toUpperCase() ?? "—" },
    { label: "Heartbeat Interval", value: `${data.default_heartbeat_interval}s` },
    { label: "Status Interval", value: `${data.default_status_interval}s` },
    { label: "Firmware", value: data.firmware_baseline ?? "Unknown" },
    { label: "Meter Interval", value: `${data.default_meter_value_interval}s` },
    { label: "TLS Required", value: data.require_tls ? "Yes" : "No" }
  ];
  const capabilitiesJson =
    data.smart_charging_profile && Object.keys(data.smart_charging_profile).length
      ? JSON.stringify(data.smart_charging_profile, null, 2)
      : "{}";
  const faultCatalog = faultDefinitionsQuery.data?.results ?? [];
  const faultButtonDisabled =
    !connectorsConfigured || !faultCatalog.length || faultDefinitionsQuery.isLoading;
  const ocppCapabilities =
    data.ocpp_capabilities?.length ? data.ocpp_capabilities : ["RemoteStartStop", "Diagnostics"];
  const isCharging = lifecycleState === "CHARGING";
  const canInitiateStart = cmsConnected && lifecycleState === "CONNECTED";
  const toggleDisabled = commandBusy !== null || (!isCharging && !canInitiateStart);
  const toggleLabel =
    commandBusy === "start"
      ? "Starting…"
      : commandBusy === "stop"
        ? "Stopping…"
        : isCharging
          ? "Stop Charging"
          : "Start Charging";
  const startToggleHint = (() => {
    if (isCharging) {
      return undefined;
    }
    if (lifecycleState === "OFFLINE") {
      return "Charger offline — cannot start session.";
    }
    if (!cmsConnected) {
      return "CMS offline — reconnect before starting a session.";
    }
    if (lifecycleState !== "CONNECTED") {
      return "Simulator runtime is not connected yet.";
    }
    return undefined;
  })();
  const handleToggleClick = () => {
    if (isCharging) {
      void handleQuickStop();
    } else {
      setShowStartModal(true);
    }
  };
  const hideConnectionControls =
    lifecycleState === "OFFLINE" || lifecycleState === "ERROR" || lifecycleState === "CHARGING";
  const needsReconnect = !cmsConnected && !hideConnectionControls;
  const showConnectControl =
    !hideConnectionControls &&
    (lifecycleState === "POWERED_ON" || lifecycleState === "CONNECTING" || needsReconnect);
  const showDisconnectControl = !hideConnectionControls && cmsConnected;
  const connectButtonLabel =
    commandBusy === "connect" || lifecycleState === "CONNECTING"
      ? "Connecting…"
      : needsReconnect
        ? "Reconnect"
        : "Connect";
  const disconnectButtonLabel =
    commandBusy === "disconnect" || lifecycleState === "CONNECTING" ? "Disconnecting…" : "Disconnect";
  const connectControlDisabled = commandBusy !== null || lifecycleState === "CONNECTING";
  const disconnectControlDisabled = commandBusy !== null || lifecycleState === "CONNECTING";
  const connectControlTitle =
    lifecycleState === "CONNECTING"
      ? "CMS connection in progress."
      : needsReconnect
        ? "CMS heartbeat missing — reconnect to resume telemetry."
        : "Connect the simulator to the CMS.";
  const disconnectControlTitle =
    lifecycleState === "CONNECTING"
      ? "Waiting for the CMS handshake."
      : commandBusy === "disconnect"
        ? "Disconnect request already pending."
        : undefined;
  const timelinePlaceholderMessage = cmsConnected
    ? "Waiting for live charger activity."
    : "Connect the simulator to stream live charger events.";
  const meterPlaceholderMessage = meterValuesQuery.isLoading
    ? "Loading meter data…"
    : connectorsConfigured
      ? "Waiting for simulator telemetry."
      : "No connectors configured.";
  const meterInfoFields = primaryConnector
    ? [
        {
          label: "Energy (kWh)",
          value: `${primaryConnector.energyKwh.toFixed(3)}`,
          hint:
            primaryConnector.deltaKwh !== null
              ? `+${primaryConnector.deltaKwh.toFixed(3)} kWh`
              : null
        },
        {
          label: "Meter Start",
          value: `${primaryConnector.meterStartKwh.toFixed(3)} kWh`,
          hint: `${(primaryConnector.meterStartKwh * 1000).toFixed(0)} Wh`
        },
        {
          label: "Meter Stop",
          value: `${primaryConnector.meterStopKwh.toFixed(3)} kWh`,
          hint: `${(primaryConnector.meterStopKwh * 1000).toFixed(0)} Wh`
        },
        {
          label: "Duration",
          value: primaryConnector.duration
        },
        {
          label: "Last Sample",
          value: formatLocalTimestamp(primaryConnector.lastSampleAt, { withSeconds: true })
        },
        {
          label: "Power",
          value:
            typeof primaryConnector.powerKw === "number"
              ? `${formatNumber(primaryConnector.powerKw, { digits: 2 })} kW`
              : "—"
        },
        {
          label: "Current",
          value:
            typeof primaryConnector.current === "number"
              ? `${formatNumber(primaryConnector.current, { digits: 1 })} A`
              : "—"
        },
        {
          label: "ID Tag",
          value: primaryConnector.idTag ?? "—"
        }
      ]
    : [];
  const meterContextLabel = primaryConnector
    ? `Connector #${primaryConnector.connectorId} · ${
        primaryConnector.transactionId ? `CMS Tx ${primaryConnector.transactionId}` : "No CMS Tx"
      } · ${primaryConnector.statusLabel}`
    : null;
  const totalEnergyDelivered = primaryConnector?.energyKwh ?? 0;
  const renderSimulatorHeader = () => (
    <header className={styles.topBar}>
      <button type="button" className={styles.backLink} onClick={() => router.push("/simulators")}>
        ← Back to Simulators
      </button>
      <div className={styles.headerInfo}>
        <div className={styles.headerTitleRow}>
          <h1 className={styles.headerTitle}>{simulatorTitle}</h1>
          <span className={lifecycleBadgeClass}>{lifecycleMeta.label}</span>
        </div>
        <p className={styles.headerSubtext}>{simulatorSubtitle}</p>
      </div>
      <div className={styles.headerActions}>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setShowEditModal(true)}
          disabled={editBusy}
        >
          Edit Simulator
        </Button>
      </div>
    </header>
  );

  const renderOverviewCard = () => (
    <Card className={clsx(styles.overviewCard, styles.stretchCard)}>
      <div className={styles.cardHeader}>
        <div>
          <span className={styles.cardEyebrow}>Simulator</span>
          <h2 className={styles.cardTitle}>Overview</h2>
        </div>
      </div>
      <div className={styles.toggleRow}>
        <Button
          variant="secondary"
          className={clsx(styles.controlToggle, isCharging && styles.controlToggleStop)}
          disabled={toggleDisabled}
          onClick={handleToggleClick}
          title={startToggleHint}
        >
          {toggleLabel}
        </Button>
        {isCharging ? (
          <button
            type="button"
            className={styles.subtleAction}
            disabled={commandBusy === "stop"}
            onClick={() => setShowStopModal(true)}
          >
            Advanced stop options
          </button>
        ) : null}
      </div>
      {!cmsConnected ? (
        <div className={styles.cmsWarning} role="status">
          <strong>CMS offline.</strong> Reconnect to resume heartbeats and enable session controls.
        </div>
      ) : null}
      {(showConnectControl || showDisconnectControl) && (
        <div className={styles.connectionControls}>
          {showConnectControl ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className={styles.connectionButton}
              disabled={connectControlDisabled}
              title={connectControlTitle}
              icon={<Plug size={16} />}
              onClick={handleConnectRequest}
            >
              {connectButtonLabel}
            </Button>
          ) : null}
          {showDisconnectControl ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className={styles.connectionButton}
              disabled={disconnectControlDisabled}
              title={disconnectControlTitle}
              icon={<Plug size={16} />}
              onClick={handleDisconnectRequest}
            >
              {disconnectButtonLabel}
            </Button>
          ) : null}
        </div>
      )}
      <div className={styles.overviewGrid}>
        {overviewFields.map((field) => (
          <div key={field.label} className={styles.overviewItem}>
            <span className={styles.statLabel}>{field.label}</span>
            <span className={styles.statValue}>{field.value}</span>
          </div>
        ))}
      </div>
      <div className={styles.lastHeartbeat}>
        <span>Last heartbeat</span>
        <span>{lastHeartbeatLabel}</span>
      </div>
    </Card>
  );

  const renderGraphCard = () => {
    const graphBadgeItems =
      graphIsFrozen
        ? [
            {
              key: "snapshot",
              label: "Frozen snapshot",
              className: clsx(styles.graphMetaBadge, styles.graphMetaBadgeSecondary)
            }
          ]
        : [
            {
              key: "raw",
              label: "Raw telemetry",
              className: clsx(styles.graphMetaBadge, styles.graphMetaBadgeSecondary)
            },
            {
              key: "smooth",
              label: "Smoothed overlay",
              className: styles.graphMetaBadge
            }
          ];
    return (
      <Card className={clsx(styles.graphCard, styles.stretchCard)}>
        <section className={styles.graphPanel}>
          <div className={styles.graphHeader}>
            <div>
              <span className={styles.cardEyebrow}>
                {primaryConnector ? `Connector #${primaryConnector.connectorId}` : "Connector"}
              </span>
              <h2 className={styles.cardTitle}>Live Power · Current · Energy</h2>
            </div>
            <div className={styles.graphStatus}>
              <span className={styles.graphStatusLabel}>
                {primaryConnector ? primaryConnector.statusLabel : "Idle"}
              </span>
              <span className={styles.graphStatusMeta}>
                {primaryConnector?.transactionId
                  ? `Tx ${primaryConnector.transactionId}`
                  : primaryConnector
                    ? "No transaction"
                    : "Select a connector"}
              </span>
            </div>
          </div>
          <div className={styles.connectorSwitcher}>
            {connectorsSummary.length ? (
              connectorsSummary.map((summary) => {
                const isActive = summary.connectorId === activeConnectorId;
                const hasTelemetry = summary.samples.length > 0;
                return (
                  <button
                    key={summary.connectorId}
                    type="button"
                    className={clsx(
                      styles.connectorToggle,
                      isActive && styles.connectorToggleActive,
                      !hasTelemetry && styles.connectorToggleMuted
                    )}
                    onClick={() => setSelectedConnectorId(summary.connectorId)}
                    aria-pressed={isActive}
                  >
                    Connector #{summary.connectorId}
                    {!hasTelemetry ? (
                      <span className={styles.connectorToggleHint}>No recent data</span>
                    ) : null}
                  </button>
                );
              })
            ) : (
              <span className={styles.connectorSwitcherEmpty}>No connectors streaming telemetry.</span>
            )}
          </div>
          <LiveGraph
            samples={graphSamples}
            chargingState={lifecycleState}
            sessionState={primaryConnector?.sessionState}
            connectorId={primaryConnector?.connectorId ?? null}
            frozen={graphIsFrozen}
          />
          <div className={styles.graphFooter}>
            <span className={styles.graphSummary}>
              Total energy delivered: <strong>{totalEnergyDelivered.toFixed(3)} kWh</strong>
            </span>
            <div className={styles.graphMetaBadges}>
              {graphBadgeItems.map((badge) => (
                <span key={badge.key} className={badge.className}>
                  {badge.label}
                </span>
              ))}
            </div>
            <p className={styles.graphCaption}>
              Tooltips and totals reflect raw CMS samples; the thicker line applies a light-moving average for readability.
            </p>
          </div>
        </section>
      </Card>
    );
  };

  const renderMeterCard = () => (
    <Card className={clsx(styles.meterCard, styles.stretchCard)}>
      <section className={styles.meterInfo}>
        <div className={styles.meterHeadline}>
          <div>
            <span className={styles.cardEyebrow}>Live meter values</span>
            <h2 className={styles.cardTitle}>Meter Info</h2>
          </div>
          <div className={styles.meterBadgeGroup}>
            <span
              className={clsx(
                styles.statusChip,
                primaryConnector
                  ? statusToneClassMap[primaryConnector.statusTone ?? "neutral"]
                  : statusToneClassMap.neutral
              )}
            >
              {primaryConnector ? primaryConnector.statusLabel : "Idle"}
            </span>
            <span className={styles.telemetryBadge}>
              {graphIsFrozen ? "Frozen snapshot" : "Raw telemetry"}
            </span>
          </div>
        </div>
        {primaryConnector ? (
          <>
            <p className={styles.meterContext}>{meterContextLabel}</p>
            <div className={styles.infoGrid}>
              {meterInfoFields.map((field) => (
                <div key={field.label} className={styles.infoItem}>
                  <span className={styles.statLabel}>{field.label}</span>
                  <span className={styles.infoValue}>{field.value}</span>
                  {field.hint ? <span className={styles.infoHint}>{field.hint}</span> : null}
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className={styles.telemetryPlaceholder}>{meterPlaceholderMessage}</p>
        )}
      </section>
    </Card>
  );

  const renderConnectorCard = () => (
    <Card className={clsx(styles.connectorsCard, styles.stretchCard)}>
      <div className={styles.cardHeader}>
        <div>
          <span className={styles.cardEyebrow}>Connectors</span>
          <h2 className={styles.cardTitle}>Connector Details</h2>
        </div>
        <div className={styles.connectorHeaderActions}>
          <span className={lifecycleBadgeClass}>{lifecycleMeta.label}</span>
          {connectorSelectOptions.length ? (
            <div className={styles.connectorTargetSelector}>
              <label className={styles.connectorTargetLabel} htmlFor={connectorTargetSelectId}>
                Action target
              </label>
              <select
                id={connectorTargetSelectId}
                className={styles.connectorTargetSelect}
                value={actionConnectorId ?? connectorSelectOptions[0].id ?? ""}
                onChange={(event) => setSelectedConnectorId(Number(event.target.value))}
                disabled={commandBusy !== null}
              >
                {connectorSelectOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            disabled={commandBusy !== null}
            onClick={() => setShowResetModal(true)}
          >
            {commandBusy === "reset" ? "Resetting…" : "Reset Charger"}
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={commandBusy !== null}
            onClick={() => setShowForceResetModal(true)}
          >
            {commandBusy === "force-reset" ? "Force resetting…" : "Force Reset"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={faultButtonDisabled}
            onClick={() => setShowFaultModal(true)}
            title={
              faultButtonDisabled
                ? faultDefinitionsQuery.isLoading
                  ? "Loading fault definitions…"
                  : "Add fault definitions to enable injections."
                : "Simulate a StatusNotification fault"
            }
          >
            Inject Fault
          </Button>
            {resetStatusLabel ? (
              <span
                className={clsx(
                  styles.resetStatusBadge,
                  resetFlow?.stage === "reconnected"
                    ? styles.resetStatusSuccess
                    : styles.resetStatusPending
                )}
              >
                {resetStatusLabel}
              </span>
            ) : null}
          </div>
        </div>
      {connectorsConfigured ? (
        <>
          <div className={styles.connectorsList}>
            {connectorsSummary.map((summary) => {
              const status = summary.statusLabel;
              const isSelected = summary.connectorId === actionConnectorId;
              const plugging = commandBusy === "plug" && commandConnectorId === summary.connectorId;
              const unplugging = commandBusy === "unplug" && commandConnectorId === summary.connectorId;
              return (
                <div
                  key={summary.connectorId}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  onClick={() => setSelectedConnectorId(summary.connectorId)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedConnectorId(summary.connectorId);
                    }
                  }}
                  className={clsx(
                    styles.connectorChip,
                    resolveConnectorChipClass(summary.connectorStatus),
                    styles.connectorChipInteractive,
                    isSelected && styles.connectorChipActive
                  )}
                >
                  <span className={styles.connectorId}>#{summary.connectorId}</span>
                  {summary.connector?.format ? (
                    <span className={styles.connectorMeta}>{summary.connector.format}</span>
                  ) : null}
                  {summary.connector?.max_kw ? (
                    <span className={styles.connectorMeta}>{summary.connector.max_kw} kW</span>
                  ) : null}
                  <span className={styles.connectorStatus}>{status}</span>
                  <div className={styles.connectorActions}>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={plugging || unplugging}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handlePlugConnector(summary.connectorId);
                      }}
                    >
                      {plugging ? "Plugging…" : "Plug"}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={plugging || unplugging}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleUnplugConnector(summary.connectorId);
                      }}
                    >
                      {unplugging ? "Unplugging…" : "Unplug"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <DataTable
            data={connectorsSummary}
            className={styles.connectorTable}
            getRowId={(row) => row.connector?.id ?? row.connectorId}
            columns={[
              { header: "Connector", accessor: (row) => `#${row.connectorId}` },
              { header: "Format", accessor: (row) => row.connector?.format ?? "—" },
              { header: "Max kW", accessor: (row) => (row.connector?.max_kw ? `${row.connector?.max_kw}` : "—") },
              { header: "Phase", accessor: (row) => row.connector?.phase_count ?? "—" },
              { header: "Status", accessor: (row) => row.statusLabel }
            ]}
          />
        </>
      ) : (
        <p className={styles.telemetryPlaceholder}>No connectors configured yet.</p>
      )}
      <div className={styles.capabilitiesSection}>
        <span className={styles.capabilitiesLabel}>Capabilities</span>
        <div className={styles.capabilityChips}>
          {ocppCapabilities.map((capability) => (
            <span key={capability} className={styles.capabilityChip}>
              {capability}
            </span>
          ))}
        </div>
        <div className={styles.capabilitiesBox}>
          <span className={styles.capabilitiesSubLabel}>Smart Charging Profile</span>
          <pre className={styles.capabilitiesCode}>{capabilitiesJson}</pre>
        </div>
      </div>
    </Card>
  );

  const renderTimelineSection = () => (
    <section className={styles.timelineSection}>
      <EventTimelineCard
        ref={timelineCardRef}
        meterPlaceholderMessage={meterPlaceholderMessage}
        timelinePlaceholderMessage={timelinePlaceholderMessage}
        lifecycleBadgeClass={lifecycleBadgeClass}
        lifecycleStatusLabel={lifecycleMeta.label}
        socketBadgeClass={liveFeedBadgeClass}
        socketStatusLabel={liveFeedLabel}
        socketStatus={dashboardOnline ? "open" : socketStatus}
        heartbeatInterval={data.default_heartbeat_interval ?? 60}
      />
    </section>
  );

  return (
    <div className={styles.page}>
      {renderSimulatorHeader()}
      <section className={styles.detailGrid}>
        {renderOverviewCard()}
        {renderConnectorCard()}
        {renderMeterCard()}
      {renderGraphCard()}
      {renderTimelineSection()}
    </section>
      <RemoteStartModal
        open={showStartModal}
        connectors={connectorOptions}
        busy={commandBusy === "start"}
        onCancel={() => setShowStartModal(false)}
        onSubmit={handleRemoteStart}
      />
      <RemoteStopModal
        open={showStopModal}
        connectors={connectorOptions}
        busy={commandBusy === "stop"}
        onCancel={() => setShowStopModal(false)}
        onSubmit={handleRemoteStop}
      />
      <FaultInjectionModal
        open={showFaultModal}
        onClose={() => setShowFaultModal(false)}
        connectors={connectorOptions}
        definitions={faultCatalog}
        submitting={faultPending}
        onSubmit={handleFaultInjection}
      />
      <ForceResetModal
        open={showForceResetModal}
        busy={commandBusy === "force-reset"}
        onCancel={() => setShowForceResetModal(false)}
        onConfirm={handleForceReset}
      />
      <ResetModal
        open={showResetModal}
        busy={commandBusy === "reset"}
        onCancel={() => setShowResetModal(false)}
        onSubmit={handleResetCharger}
      />
      <EditSimulatorModal
        open={showEditModal}
        simulator={data}
        busy={editBusy}
        onCancel={() => setShowEditModal(false)}
        onSubmit={handleSimulatorUpdate}
      />
    </div>
  );
};

type EventTimelineCardProps = {
  meterPlaceholderMessage: string;
  timelinePlaceholderMessage: string;
  lifecycleBadgeClass: string;
  lifecycleStatusLabel: string;
  socketBadgeClass: string;
  socketStatusLabel: string;
  socketStatus: string;
  heartbeatInterval?: number;
};

const EMPTY_SIGNATURE = "__empty__";

const signatureForTelemetry = (entries: TelemetryFeedEntry[]): string => {
  if (!entries.length) {
    return EMPTY_SIGNATURE;
  }
  return entries.map((entry) => `${entry.connectorId}-${entry.timestamp}`).join("|");
};

const signatureForTimeline = (entries: TimelineEvent[]): string => {
  if (!entries.length) {
    return EMPTY_SIGNATURE;
  }
  return entries.map((entry) => entry.id).join("|");
};

const signatureForHeartbeats = (entries: HeartbeatFeedEntry[]): string => {
  if (!entries.length) {
    return EMPTY_SIGNATURE;
  }
  return entries.map((entry) => entry.id).join("|");
};

const TIMELINE_TABS = [
  { id: "telemetry", label: "Telemetry" },
  { id: "lifecycle", label: "Lifecycle" },
  { id: "faults", label: "Faults" },
  { id: "commands", label: "Commands & Sessions" },
  { id: "logs", label: "Logs" },
  { id: "heartbeats", label: "Heartbeats" }
] as const;

type TimelineTab = (typeof TIMELINE_TABS)[number]["id"];

const EventTimelineCard = memo(
  forwardRef<EventTimelineHandle, EventTimelineCardProps>(function EventTimelineCard(
    {
      meterPlaceholderMessage,
      timelinePlaceholderMessage,
      lifecycleBadgeClass,
      lifecycleStatusLabel,
      socketBadgeClass,
      socketStatusLabel,
      socketStatus,
      heartbeatInterval
    },
    ref
  ) {
    const [activeTab, setActiveTab] = useState<TimelineTab>("telemetry");
    const containerRef = useRef<HTMLDivElement | null>(null);
    const telemetryFeedRef = useRef<TelemetryFeedEntry[]>([]);
    const timelineEventsRef = useRef<TimelineEvent[]>([]);
    const heartbeatEventsRef = useRef<HeartbeatFeedEntry[]>([]);
    const telemetrySignatureRef = useRef<string>(EMPTY_SIGNATURE);
    const timelineSignatureRef = useRef<string>(EMPTY_SIGNATURE);
    const heartbeatSignatureRef = useRef<string>(EMPTY_SIGNATURE);
    const [renderVersion, forceRender] = useReducer((value: number) => value + 1, 0);
    const pinnedRef = useRef<Record<TimelineTab, boolean>>({
      telemetry: true,
      lifecycle: true,
      faults: true,
      commands: true,
      logs: true,
      heartbeats: true
    });
    const scrollPositionsRef = useRef<Record<TimelineTab, number>>({
      telemetry: 0,
      lifecycle: 0,
      faults: 0,
      commands: 0,
      logs: 0,
      heartbeats: 0
    });
    const heightRef = useRef<Record<TimelineTab, number>>({
      telemetry: 0,
      lifecycle: 0,
      faults: 0,
      commands: 0,
      logs: 0,
      heartbeats: 0
    });
    const activeTabRef = useRef<TimelineTab>("telemetry");

    useEffect(() => {
      activeTabRef.current = activeTab;
      const node = containerRef.current;
      if (!node) {
        return;
      }
      const savedPosition = scrollPositionsRef.current[activeTab] ?? 0;
      node.scrollTop = savedPosition;
      pinnedRef.current[activeTab] = savedPosition < 16;
    }, [activeTab]);

    useEffect(() => {
      const node = containerRef.current;
      if (!node) {
        return;
      }
      const handleScroll = () => {
        const tabKey = activeTabRef.current;
        const pinned = node.scrollTop < 16;
        pinnedRef.current[tabKey] = pinned;
        scrollPositionsRef.current[tabKey] = node.scrollTop;
      };
      handleScroll();
      node.addEventListener("scroll", handleScroll);
      return () => {
        node.removeEventListener("scroll", handleScroll);
      };
    }, []);

    const syncTelemetry = useCallback(
      (entries: TelemetryFeedEntry[]) => {
        const signature = signatureForTelemetry(entries);
        if (signature === telemetrySignatureRef.current) {
          return;
        }
        telemetrySignatureRef.current = signature;
        telemetryFeedRef.current = entries.map((entry) => ({ ...entry }));
        forceRender();
      },
      [forceRender]
    );

    const syncTimeline = useCallback(
      (entries: TimelineEvent[]) => {
        const signature = signatureForTimeline(entries);
        if (signature === timelineSignatureRef.current) {
          return;
        }
        timelineSignatureRef.current = signature;
        timelineEventsRef.current = entries.map((entry) => ({ ...entry }));
        forceRender();
      },
      [forceRender]
    );

    const syncHeartbeats = useCallback(
      (entries: HeartbeatFeedEntry[]) => {
        const signature = signatureForHeartbeats(entries);
        if (signature === heartbeatSignatureRef.current) {
          return;
        }
        heartbeatSignatureRef.current = signature;
        heartbeatEventsRef.current = entries.map((entry) => ({ ...entry }));
        forceRender();
      },
      [forceRender]
    );

    const reset = useCallback(() => {
      telemetryFeedRef.current = [];
      timelineEventsRef.current = [];
      heartbeatEventsRef.current = [];
      telemetrySignatureRef.current = EMPTY_SIGNATURE;
      timelineSignatureRef.current = EMPTY_SIGNATURE;
      heartbeatSignatureRef.current = EMPTY_SIGNATURE;
      pinnedRef.current = {
        telemetry: true,
        lifecycle: true,
        faults: true,
        commands: true,
        logs: true,
        heartbeats: true
      };
      heightRef.current = {
        telemetry: 0,
        lifecycle: 0,
        faults: 0,
        commands: 0,
        logs: 0,
        heartbeats: 0
      };
      scrollPositionsRef.current = {
        telemetry: 0,
        lifecycle: 0,
        faults: 0,
        commands: 0,
        logs: 0,
        heartbeats: 0
      };
      if (containerRef.current) {
        containerRef.current.scrollTop = 0;
      }
      forceRender();
    }, [forceRender]);

    useImperativeHandle(
      ref,
      () => ({
        syncTelemetry,
        syncTimeline,
        syncHeartbeats,
        reset
      }),
      [reset, syncTelemetry, syncTimeline, syncHeartbeats]
    );

    useLayoutEffect(() => {
      const node = containerRef.current;
      if (!node) {
        return;
      }
      const key = activeTabRef.current;
      const previousHeight = heightRef.current[key];
      const nextHeight = node.scrollHeight;
      if (pinnedRef.current[key]) {
        node.scrollTop = 0;
        scrollPositionsRef.current[key] = 0;
      } else if (nextHeight !== previousHeight) {
        const updatedScroll = Math.max(node.scrollTop + (nextHeight - previousHeight), 0);
        node.scrollTop = updatedScroll;
        scrollPositionsRef.current[key] = updatedScroll;
      }
      heightRef.current[key] = nextHeight;
    }, [renderVersion, activeTab]);

    const telemetryFeed = telemetryFeedRef.current;
    const baseTimelineEvents = timelineEventsRef.current.filter((event) => event.kind !== "meter");
    const lifecycleEvents = baseTimelineEvents.filter(
      (event) => event.kind === "lifecycle" || event.kind === "connector" || event.kind === "fault"
    );
    const faultEvents = baseTimelineEvents.filter((event) => {
      if (event.kind === "fault") {
        return true;
      }
      if (event.kind === "lifecycle" && event.badge) {
        return event.badge.toUpperCase().includes("FAULT");
      }
      return false;
    });
    const commandEvents = baseTimelineEvents.filter(
      (event) => event.kind === "command" || event.kind === "session"
    );
    const commandEventsLatestFirst = [...commandEvents].sort(compareTimelineEventsDesc);
    const logEvents = baseTimelineEvents.filter((event) => event.kind === "log");
    const heartbeatEventsList = heartbeatEventsRef.current;

    const telemetryFeedHasData = telemetryFeed.length > 0;
    const isSocketLive = socketStatus === "open";
    const latestHeartbeat = heartbeatEventsList[0];
    const heartbeatWindowMs = Math.max((heartbeatInterval ?? 60) * 2 * 1000, 30_000);
    const heartbeatAge =
      latestHeartbeat && Number.isFinite(Date.parse(latestHeartbeat.timestamp))
        ? Date.now() - Date.parse(latestHeartbeat.timestamp)
        : Infinity;
    const heartbeatLive = isSocketLive && heartbeatAge < heartbeatWindowMs;

    const renderEventItem = (entry: TimelineEvent) => {
      const IconComponent = timelineIconComponents[entry.icon] ?? Info;
      const toneSuffix = entry.tone.charAt(0).toUpperCase() + entry.tone.slice(1);
      const markerClass = clsx(styles.timelineMarker, styles[`timelineMarker${toneSuffix}`]);
      const badgeClass = clsx(styles.timelineBadge, styles[`timelineBadge${toneSuffix}`]);
      return (
        <li key={entry.id} className={styles.timelineItem}>
          <span className={markerClass}>
            <IconComponent size={14} strokeWidth={1.75} />
          </span>
          <div className={styles.timelineCard}>
            <div className={styles.timelineHeader}>
              <div>
                <p className={styles.timelineTitle}>{entry.title}</p>
                {entry.subtitle ? <p className={styles.timelineSubtitle}>{entry.subtitle}</p> : null}
              </div>
              <span className={styles.timelineTimestamp}>
                {formatTimelineTimestamp(entry.timestamp)}
              </span>
            </div>
            <div className={styles.timelineMetaRow}>
              {entry.badge ? <span className={badgeClass}>{entry.badge}</span> : null}
              {entry.meta ? <span className={styles.timelineMeta}>{entry.meta}</span> : null}
            </div>
            {entry.metrics ? (
              <dl className={styles.timelineMetrics}>
                {entry.metrics.map((metric) => (
                  <div key={`${entry.id}-${metric.label}`} className={styles.timelineMetric}>
                    <dt>{metric.label}</dt>
                    <dd className={metric.muted ? styles.timelineMetricMuted : undefined}>
                      {metric.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </li>
      );
    };

    const renderTimelineList = (events: TimelineEvent[], emptyMessage: string) => {
      if (!events.length) {
        return <p className={styles.logPlaceholder}>{emptyMessage}</p>;
      }
      return <ol className={styles.timelineList}>{events.map(renderEventItem)}</ol>;
    };

    const renderContent = () => {
      switch (activeTab) {
        case "telemetry":
          return (
            <>
              <div className={styles.timelinePanelHeader}>
                <div className={styles.timelinePanelBadges}>
                  <span
                    className={clsx(
                      styles.timelineBadgePill,
                      isSocketLive ? styles.timelineBadgeLive : styles.timelineBadgeMuted
                    )}
                  >
                    {isSocketLive ? "LIVE STREAMING" : "STREAM OFFLINE"}
                  </span>
                  <span className={styles.timelineBadgePill}>RAW TELEMETRY</span>
                </div>
                <p className={styles.timelinePanelHint}>
                  Power, current, and cumulative energy exactly as reported by the simulator feed.
                </p>
              </div>
              {telemetryFeedHasData ? (
                <ul className={styles.logsList}>
                  {telemetryFeed.map((entry) => (
                    <li key={`${entry.connectorId}-${entry.timestamp}`} className={styles.logRow}>
                      <span className={styles.logTimestamp}>
                        {new Date(entry.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit"
                        })}
                      </span>
                      <div className={styles.logContext}>
                        <span className={styles.logTitle}>
                          Connector #{entry.connectorId}
                          {entry.transactionId ? ` · Tx ${entry.transactionId}` : ""}
                          {entry.idTag ? ` · ${entry.idTag}` : ""}
                        </span>
                        <span className={styles.logSnapshot}>
                          {entry.powerKw !== null ? `${entry.powerKw.toFixed(2)} kW` : "— kW"} ·{" "}
                          {entry.current !== null ? `${Math.round(entry.current)} A` : "— A"} ·{" "}
                          {entry.energyKwh !== null ? `${entry.energyKwh.toFixed(3)} kWh` : "— kWh"}
                          {entry.energyRegisterKwh !== null &&
                          entry.energyRegisterKwh !== entry.energyKwh
                            ? ` (reg ${entry.energyRegisterKwh.toFixed(3)} kWh)`
                            : ""}
                        </span>
                      </div>
                      <span className={clsx(styles.statusChip, entry.statusClass)}>
                        {entry.statusLabel}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.telemetryPlaceholder}>{meterPlaceholderMessage}</p>
              )}
            </>
          );
        case "lifecycle":
          return (
            <>
              <div className={styles.timelinePanelHeader}>
                <div className={styles.timelineStatusGroup}>
                  <div className={styles.statusWithLabel}>
                    <span className={styles.statusLabel}>Simulator</span>
                    <span className={lifecycleBadgeClass}>{lifecycleStatusLabel}</span>
                  </div>
                  <div className={styles.statusWithLabel}>
                    <span className={styles.statusLabel}>WebSocket</span>
                    <span className={socketBadgeClass}>{socketStatusLabel}</span>
                  </div>
                </div>
                <p className={styles.timelinePanelHint}>
                  Boot notifications, connect/disconnect events, and lifecycle transitions remain in
                  the order received from the CMS.
                </p>
              </div>
              {renderTimelineList(
                lifecycleEvents,
                timelinePlaceholderMessage || "Lifecycle activity will appear here."
              )}
            </>
          );
        case "faults":
          return (
            <>
              <div className={styles.timelinePanelHeader}>
                <p className={styles.timelinePanelHint}>
                  Fault reports from connectors and simulator state changes, including vendor
                  diagnostics when provided by the backend.
                </p>
              </div>
              {renderTimelineList(
                faultEvents,
                "No connector or charger faults have been reported yet."
              )}
            </>
          );
        case "commands":
          return (
            <>
              <div className={styles.timelinePanelHeader}>
                <p className={styles.timelinePanelHint}>
                  Remote commands and session state transitions exactly as confirmed by the backend.
                </p>
              </div>
              {renderTimelineList(
                commandEventsLatestFirst,
                "No commands or session transitions recorded yet."
              )}
            </>
          );
        case "logs":
          return (
            <>
              <div className={styles.timelinePanelHeader}>
                <p className={styles.timelinePanelHint}>
                  Runtime warnings, errors, and diagnostic logs coming directly from the simulator.
                </p>
              </div>
              {renderTimelineList(logEvents, "No log messages yet.")}
            </>
          );
        case "heartbeats":
          return (
            <>
              <div className={styles.timelinePanelHeader}>
                <p className={styles.timelinePanelHint}>
                  Each item reflects a Heartbeat CALL acknowledged by the CMS.
                </p>
              </div>
              {heartbeatEventsList.length ? (
                <ul className={styles.heartbeatList}>
                  {heartbeatEventsList.map((entry) => (
                    <li key={entry.id} className={styles.heartbeatRow}>
                      <div className={styles.heartbeatMeta}>
                        <span className={styles.heartbeatTime}>
                          {new Date(entry.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit"
                          })}
                        </span>
                        <div>
                          <span className={styles.heartbeatTitle}>Heartbeat received</span>
                          <span className={styles.heartbeatSubtitle}>
                            Simulator: {entry.chargerId}
                          </span>
                        </div>
                      </div>
                      <div className={styles.heartbeatDetails}>
                        <span>
                          Connectors:{" "}
                          {entry.connectorCount !== undefined ? entry.connectorCount : "—"}
                        </span>
                        <span className={styles.heartbeatBadge}>Heartbeat</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.logPlaceholder}>No heartbeat events yet.</p>
              )}
            </>
          );
        default:
          return null;
      }
    };

    return (
      <Card className={styles.logsCard}>
        <div className={styles.cardHeader}>
          <div>
            <span className={styles.cardEyebrow}>Live feed</span>
            <h2 className={styles.cardTitle}>Event Timeline</h2>
          </div>
        <div className={styles.timelineStatusGroup}>
          <div className={styles.statusWithLabel}>
            <span className={styles.statusLabel}>Simulator</span>
            <span className={lifecycleBadgeClass}>{lifecycleStatusLabel}</span>
          </div>
          <div className={styles.statusWithLabel}>
            <span className={styles.statusLabel}>Live Feed</span>
            <span className={socketBadgeClass}>{socketStatusLabel}</span>
          </div>
          <div className={styles.heartbeatStatus}>
            <span
              className={clsx(
                styles.heartbeatDot,
                heartbeatLive ? styles.heartbeatDotLive : styles.heartbeatDotIdle
              )}
            />
            <span className={styles.heartbeatStatusLabel}>
              {heartbeatLive ? "LIVE HEARTBEAT: CONNECTED" : "LIVE HEARTBEAT: OFFLINE"}
            </span>
          </div>
        </div>
        </div>
        <div className={styles.timelineTabs}>
          {TIMELINE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={clsx(
                styles.timelineTab,
                activeTab === tab.id && styles.timelineTabActive
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div ref={containerRef} className={styles.logsBody}>
          {renderContent()}
        </div>
      </Card>
    );
  })
);

EventTimelineCard.displayName = "EventTimelineCard";
