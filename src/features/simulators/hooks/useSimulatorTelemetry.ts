import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QueryClient } from "@tanstack/react-query";
import { endpoints } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";
import { pickCanonicalTransactionId } from "@/lib/transactions";
import {
  ConnectorStatus,
  SimulatedCharger,
  SimulatorInstance,
  SimulatedMeterValue,
  SimulatedSession,
  ConnectorTelemetrySnapshot,
  ConnectorTelemetryHistory
} from "@/types";
import { normalizeLifecycleState } from "@/lib/simulatorLifecycle";
import {
  CmsChargingSession,
  CmsConnector,
  ConnectorMeterTimeline,
  EventTimelineHandle,
  HeartbeatFeedEntry,
  ResetFlowState,
  SessionLifecycle,
  SessionRuntime,
  SimulatorEventPayload,
  TimelineEvent,
  TimelineEventInput,
  TimelineKind,
  TimelineMetric,
  TimelineTone
} from "../types/detail";
import { useTenantApi } from "@/hooks/useTenantApi";
import { useSimulatorChannel } from "./useSimulatorChannel";
import {
  NormalizedSample,
  appendSample,
  normalizeSample,
  trimWindow
} from "../graphHelpers";
import {
  TELEMETRY_EVENT_COOLDOWN_MS,
  TELEMETRY_FEED_LIMIT,
  TELEMETRY_HISTORY_LIMIT,
  TELEMETRY_WINDOW_MS,
  METER_HISTORY_LIMIT,
  HEARTBEAT_HISTORY_LIMIT,
  TIMELINE_EVENT_LIMIT,
  buildSnapshotSample,
  formatNumber,
  limitTelemetryHistory,
  mergeTelemetryHistory,
  resolveEventTransactionId,
  snapshotPayloadFromSample,
  timelineToneForStatus,
  toNumber
} from "../detail/detailHelpers";

const anchorKey = (connectorId: number, txId?: string | null) => `${connectorId}:${txId ?? "no-tx"}`;

const pickEarliestIso = (candidates: Array<string | undefined | null>): string | null => {
  const valid = candidates
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => ({ value, ts: Date.parse(value) }))
    .filter(({ ts }) => Number.isFinite(ts));
  if (!valid.length) return null;
  return valid.reduce((earliest, current) => (current.ts < earliest.ts ? current : earliest)).value;
};

export const chooseStartedAtForTx = (existing: string | undefined, candidate: string | undefined, isSameTx: boolean): string | undefined => {
  if (!isSameTx) {
    return candidate;
  }
  const earliest = pickEarliestIso([existing, candidate]);
  return earliest ?? undefined;
};

export const hasTransactionChanged = (existingTx?: string | null, incomingTx?: string | null): boolean => {
  if (!existingTx && !incomingTx) return false;
  return existingTx !== incomingTx;
};

export const migrateNoTxAnchorValue = (
  store: Record<string, string | undefined>,
  connectorId: number,
  transactionId: string | null | undefined,
  fallbackStart?: string | null
): string | null => {
  if (!connectorId || !transactionId) return null;
  const noTxKey = anchorKey(connectorId, null);
  const existingNoTx = store[noTxKey] ?? null;
  const merged = pickEarliestIso([existingNoTx, fallbackStart]);
  if (merged) {
    store[anchorKey(connectorId, transactionId)] = merged;
  }
  if (store[noTxKey]) {
    delete store[noTxKey];
  }
  return merged;
};
import {
  connectorStatusTone,
  formatConnectorStatusLabel,
  normalizeConnectorStatus
} from "../utils/status";

export type UseSimulatorTelemetryArgs = {
  simulatorId: number;
  data: SimulatedCharger | undefined;
  telemetrySnapshotMap: Map<number, ConnectorTelemetrySnapshot>;
  telemetryHistoryMap: Map<number, ConnectorTelemetryHistory>;
  cmsConnectorIndex: { byId: Map<number, CmsConnector>; byNumber: Map<number, CmsConnector> };
  cmsSessionsIndex: {
    byId: Map<number, CmsChargingSession>;
    byFormatted: Map<string, CmsChargingSession>;
    byConnectorNumber: Map<number, CmsChargingSession[]>;
  };
  simulatorConnectorByPk: Map<number, SimulatedCharger["connectors"][number]>;
  meterValuesResults?: SimulatedMeterValue[];
  sessionsResults?: SimulatedSession[];
  recentSessionsResults?: SimulatedSession[];
  instancesResults?: SimulatorInstance[];
  lifecycleState: SimulatedCharger["lifecycle_state"] | "OFFLINE";
  setLiveLifecycleState: (state: SimulatedCharger["lifecycle_state"] | "OFFLINE") => void;
  pushToast: (toast: { title: string; description?: string; level: "success" | "info" | "warning" | "error"; timeoutMs?: number }) => void;
  queryClient: QueryClient;
  refreshSimulator: () => void;
  patchConnectorStatus: (connectorId: number, status?: string) => void;
  patchTelemetrySnapshot: (connectorId: number, updates: Record<string, unknown>) => void;
  setResetFlow: (state: ResetFlowState | null | ((current: ResetFlowState | null) => ResetFlowState | null)) => void;
  resetFlow: ResetFlowState | null;
};

export const useTelemetryHydrationFlag = (telemetryHistoryMap: Map<number, ConnectorTelemetryHistory>) => {
  const [telemetryHydrated, setTelemetryHydrated] = useState(false);

  // Whenever the history payload from the API changes (new Map reference),
  // clear the hydrated flag so fresh data can be applied without a page reload.
  useEffect(() => {
    setTelemetryHydrated(false);
  }, [telemetryHistoryMap]);

  return { telemetryHydrated, setTelemetryHydrated };
};

export const useSimulatorTelemetry = (args: UseSimulatorTelemetryArgs) => {
  const {
    simulatorId,
    data,
    telemetrySnapshotMap,
    telemetryHistoryMap,
    cmsConnectorIndex,
    cmsSessionsIndex,
    simulatorConnectorByPk,
    meterValuesResults,
    sessionsResults,
    recentSessionsResults,
    instancesResults,
    lifecycleState,
    setLiveLifecycleState,
    pushToast,
    queryClient,
    refreshSimulator,
    patchConnectorStatus,
    patchTelemetrySnapshot,
    setResetFlow,
    resetFlow
  } = args;

  const api = useTenantApi();

  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [dashboardOnline, setDashboardOnline] = useState(false);
  const [heartbeatEvents, setHeartbeatEvents] = useState<HeartbeatFeedEntry[]>([]);
  const [meterTimelines, setMeterTimelines] = useState<Record<number, ConnectorMeterTimeline>>({});
  const [telemetryHistory, setTelemetryHistory] = useState<Record<number, NormalizedSample[]>>({});
  const { telemetryHydrated, setTelemetryHydrated } = useTelemetryHydrationFlag(telemetryHistoryMap);
  const [sessionsByConnector, setSessionsByConnector] = useState<Record<number, SessionRuntime>>({});
  const [pendingLimitsByConnector, setPendingLimitsByConnector] = useState<Record<number, { limitType: "KWH" | "AMOUNT"; userLimit: number }>>({});
  const pendingLimitsRef = useRef<Record<number, { limitType: "KWH" | "AMOUNT"; userLimit: number }>>({});
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [selectedConnectorId, setSelectedConnectorId] = useState<number | null>(null);

  const timelineKeysRef = useRef<Set<string>>(new Set());
  const futureStartWarnedRef = useRef<Set<string>>(new Set());
  const telemetryThrottleRef = useRef<Record<number, number>>({});
  const sessionsRef = useRef<Record<number, SessionRuntime>>({});
  const frozenConnectorsRef = useRef<Set<number>>(new Set());
  const meterStartCacheRef = useRef<Map<string, number>>(new Map());
  const sessionStartAnchorRef = useRef<Record<string, string>>({});
  const resetFlowRef = useRef<ResetFlowState | null>(null);
  const timelineCardRef = useRef<EventTimelineHandle | null>(null);
  const pendingHistoryFetchesRef = useRef<Set<string>>(new Set());
  // Tracks the last time we attempted to hydrate an active session that was missing live telemetry.
  const lastActiveHydrateRef = useRef<Record<string, number>>({});

  const clampFutureStart = useCallback(
    (iso: string | null | undefined, connectorId?: number, transactionId?: string | null, reason?: string) => {
      if (!iso) return iso ?? undefined;
      const parsed = Date.parse(iso);
      if (!Number.isFinite(parsed)) return iso;
      const skewMs = parsed - Date.now();
      if (skewMs <= 5000) return iso;
      const key = `${connectorId ?? "unknown"}:${transactionId ?? "no-tx"}:${reason ?? "start"}`;
      if (!futureStartWarnedRef.current.has(key) && process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
        futureStartWarnedRef.current.add(key);
        const browserNow = new Date().toISOString();
        // eslint-disable-next-line no-console
        console.debug("[simulator][start-clamped]", { connectorId, transactionId, reason, skewMs, rawStartedAt: iso, browserNow });
      }
      return new Date().toISOString();
    },
    []
  );

  const coerceNumber = useCallback((value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }, []);

  const normalizeLimitType = useCallback((value: unknown): "KWH" | "AMOUNT" | null => {
    if (value === null || value === undefined) return null;
    const upper = String(value).toUpperCase();
    return upper === "KWH" || upper === "AMOUNT" ? (upper as "KWH" | "AMOUNT") : null;
  }, []);

  useEffect(() => {
    setTelemetryHydrated(false);
    meterStartCacheRef.current.clear();
    sessionStartAnchorRef.current = {};
    lastActiveHydrateRef.current = {};
  }, [simulatorId]);

  const applyTelemetryHistory = useCallback(
    (updates: Record<number, NormalizedSample[]>) => {
      const entries = Object.entries(updates);
      if (!entries.length) return;
      setTelemetryHistory((current) => {
        const next = { ...current };
        let changed = false;
        entries.forEach(([key, samples]) => {
          const connectorId = Number(key);
          if (!Number.isFinite(connectorId) || connectorId <= 0 || !samples.length) return;
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
      if (!Number.isFinite(connectorId) || connectorId <= 0 || !sample) return;
      applyTelemetryHistory({ [connectorId]: [sample] });
    },
    [applyTelemetryHistory]
  );

  const rememberMeterStart = useCallback((transactionId?: string | null, startWh?: number | null) => {
    if (!transactionId) return;
    if (typeof startWh !== "number" || Number.isNaN(startWh)) return;
    const existing = meterStartCacheRef.current.get(transactionId);
    if (existing === undefined || startWh < existing) {
      meterStartCacheRef.current.set(transactionId, startWh);
    }
  }, []);

  const setStartAnchor = useCallback(
    (connectorId: number, transactionId: string | null | undefined, isoTimestamp?: string | null, overwrite = false, reason?: string) => {
      if (!connectorId || !isoTimestamp) return;
      const safeIso = clampFutureStart(isoTimestamp, connectorId, transactionId, reason ?? "anchor");
      const parsed = Date.parse(safeIso ?? "");
      if (!Number.isFinite(parsed)) return;
      const key = anchorKey(connectorId, transactionId);
      const existing = sessionStartAnchorRef.current[key];
      if (!existing || overwrite) {
        sessionStartAnchorRef.current[key] = safeIso!;
        return;
      }
      const existingParsed = Date.parse(existing);
      if (!Number.isFinite(existingParsed) || parsed < existingParsed) {
        sessionStartAnchorRef.current[key] = safeIso!;
      }
    },
    [clampFutureStart]
  );

  const getStartAnchor = useCallback((connectorId: number, transactionId?: string | null) => {
    if (!connectorId) return null;
    const key = anchorKey(connectorId, transactionId);
    return sessionStartAnchorRef.current[key] ?? null;
  }, []);

  const deleteAnchor = (connectorId: number, transactionId?: string | null) => {
    if (!connectorId) return;
    const key = anchorKey(connectorId, transactionId);
    if (sessionStartAnchorRef.current[key]) {
      delete sessionStartAnchorRef.current[key];
    }
  };

  const migrateNoTxAnchor = (connectorId: number, transactionId?: string | null, fallbackStart?: string | null) => {
    return migrateNoTxAnchorValue(sessionStartAnchorRef.current, connectorId, transactionId, fallbackStart);
  };

  const seedAnchorsFromHistory = useCallback(
    (map: Map<number, ConnectorTelemetryHistory>, normalizedBatches: Record<number, NormalizedSample[]>) => {
      map.forEach((history, connectorId) => {
        const samples = normalizedBatches[connectorId];
        const transactionId =
          history.transactionId ?? samples?.[0]?.transactionId ?? samples?.at(-1)?.transactionId ?? undefined;
        if (!transactionId) return;
        const historyStart = history.start_time ?? history.started_at ?? null;
        const sampleStart = samples?.[0]?.isoTimestamp ?? null;
        const anchor = historyStart ?? sampleStart;
        if (!anchor) return;
        setStartAnchor(connectorId, transactionId, anchor, Boolean(historyStart));
      });
    },
    [setStartAnchor]
  );

  const resolveMeterStart = useCallback(
    (transactionId: string | undefined, runtimeStart?: number | null, earliestSample?: number | null) => {
      if (typeof runtimeStart === "number" && Number.isFinite(runtimeStart)) {
        rememberMeterStart(transactionId, runtimeStart);
        return runtimeStart;
      }
      const cached = transactionId ? meterStartCacheRef.current.get(transactionId) : undefined;
      if (typeof cached === "number" && Number.isFinite(cached)) {
        return cached;
      }
      if (typeof earliestSample === "number" && Number.isFinite(earliestSample)) {
        rememberMeterStart(transactionId, earliestSample);
        return earliestSample;
      }
      return undefined;
    },
    [rememberMeterStart]
  );

  const hydrateConnectorHistory = useCallback(
    async (connectorId: number, transactionId?: string | null) => {
      if (!Number.isFinite(connectorId) || connectorId <= 0 || !transactionId) return;
      const fetchKey = `${connectorId}:${transactionId}`;
      if (pendingHistoryFetchesRef.current.has(fetchKey)) return;
      pendingHistoryFetchesRef.current.add(fetchKey);
      try {
        const response = await api.requestPaginated<SimulatedMeterValue>(endpoints.meterValues, {
          query: {
            simulator: simulatorId,
            connector: connectorId,
            transaction: transactionId,
            page_size: TELEMETRY_HISTORY_LIMIT
          }
        });
        const results = response.results ?? [];
        if (!results.length) return;
        const normalizedByConnector: Record<number, NormalizedSample[]> = {};
        const previousSampleByConnector: Record<number, NormalizedSample | undefined> = {};
        [...results]
          .sort((a, b) => new Date(a.sampledAt).getTime() - new Date(b.sampledAt).getTime())
          .forEach((reading) => {
            const connectorKey = Number(reading.connectorNumber ?? reading.connectorId ?? connectorId);
            if (!Number.isFinite(connectorKey) || connectorKey <= 0) return;
            const payload = reading.payload ?? {};
            const rawTransaction = reading.transactionId ?? (payload.transactionId as string | number | undefined);
            const sample = normalizeSample(
              {
                connectorId: connectorKey,
                timestamp: reading.sampledAt,
                valueWh: reading.valueWh,
                powerKw: toNumber(payload.powerKw ?? payload.power_kw ?? payload.power),
                currentA: toNumber(payload.currentA ?? payload.current_a ?? payload.current),
                voltageV: toNumber(payload.voltageV ?? payload.voltage_v ?? payload.voltage),
                energyKwh:
                  toNumber(payload.energyKwh ?? payload.energy_kwh) ?? Number((reading.valueWh / 1000).toFixed(3)),
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
        if (!Object.keys(normalizedByConnector).length) return;
        setMeterTimelines((current) => {
          const next = { ...current };
          Object.entries(normalizedByConnector).forEach(([key, samples]) => {
            if (!samples.length) return;
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
    pendingLimitsRef.current = pendingLimitsByConnector;
  }, [pendingLimitsByConnector]);

  useEffect(() => {
    resetFlowRef.current = resetFlow;
  }, [resetFlow]);

  useEffect(() => {
    if (!resetFlow) return;
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
  }, [resetFlow, setResetFlow]);

  const pushTimelineEvent = useCallback((entry: TimelineEventInput) => {
    if (timelineKeysRef.current.has(entry.dedupeKey)) return;
    timelineKeysRef.current.add(entry.dedupeKey);
    setTimelineEvents((current) => {
      const next = [{ ...entry, id: `${entry.dedupeKey}`, dedupeKey: entry.dedupeKey }, ...current];
      if (next.length > TIMELINE_EVENT_LIMIT) {
        const overflow = next.slice(TIMELINE_EVENT_LIMIT);
        overflow.forEach((item) => timelineKeysRef.current.delete(item.dedupeKey));
      }
      return next.slice(0, TIMELINE_EVENT_LIMIT);
    });
  }, []);

  const shouldRecordTelemetry = useCallback((connectorId: number, timestamp: string) => {
    const ts = Date.parse(timestamp);
    if (!Number.isFinite(ts)) return false;
    const last = telemetryThrottleRef.current[connectorId] ?? 0;
    if (ts - last < TELEMETRY_EVENT_COOLDOWN_MS) return false;
    telemetryThrottleRef.current[connectorId] = ts;
    return true;
  }, []);

  const telemetryHydrationEffect = useCallback(() => {
    if (!telemetryHistoryMap.size || telemetryHydrated) return;
    const historyBatches: Record<number, NormalizedSample[]> = {};
    const timelineDraft: Record<number, ConnectorMeterTimeline> = {};
    telemetryHistoryMap.forEach((history, connectorId) => {
      const samples = Array.isArray(history.samples) ? history.samples : [];
      if (!samples.length) return;
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
      if (!normalizedSamples.length) return;
      const historyTransaction = history.transactionId ?? normalizedSamples.at(-1)?.transactionId ?? normalizedSamples[0]?.transactionId;
      if (historyTransaction) {
        rememberMeterStart(historyTransaction, history.meterStartWh ?? normalizedSamples[0]?.valueWh);
      }
      historyBatches[connectorId] = normalizedSamples;
      timelineDraft[connectorId] = {
        transactionId: historyTransaction,
        transactionKey: historyTransaction,
        samples: trimWindow(normalizedSamples, TELEMETRY_WINDOW_MS)
      };
    });
    if (!Object.keys(historyBatches).length) return;
    applyTelemetryHistory(historyBatches);
    setMeterTimelines((current) => ({ ...current, ...timelineDraft }));
    setSessionsByConnector((current) => {
      const next = { ...current };
      telemetryHistoryMap.forEach((history, connectorId) => {
        const samples = historyBatches[connectorId];
        const finalSample = samples?.at(-1) ?? null;
        const existing = next[connectorId];
        const transactionId =
          history.transactionId ??
          finalSample?.transactionId ??
          samples?.[0]?.transactionId ??
          existing?.transactionId;
        const existingSameTx = existing && transactionId && existing.transactionId === transactionId ? existing : undefined;
        const historyStart = history.start_time ?? history.started_at ?? undefined;
        const historyEnd = history.end_time ?? history.completed_at ?? undefined;
        const meterStartWh = history.meterStartWh ?? existingSameTx?.meterStartWh;
        const meterStopWh =
          history.meterStopWh ??
          finalSample?.valueWh ??
          existingSameTx?.meterStopWh ??
          meterStartWh;
        const meterStopFinalWh =
          history.meterStopFinalWh ??
          (history.isFinal ? meterStopWh : undefined) ??
          existingSameTx?.meterStopFinalWh;
        const startedAt = clampFutureStart(historyStart ?? existingSameTx?.startedAt, connectorId, transactionId, "history");
        const completedAt = historyEnd ?? existingSameTx?.completedAt;
        next[connectorId] = {
          connectorId,
          transactionId,
          transactionKey: transactionId ?? existingSameTx?.transactionKey,
          cmsTransactionKey: transactionId ?? existingSameTx?.cmsTransactionKey,
          startedAt,
          completedAt,
          updatedAt: existingSameTx?.updatedAt,
          state: (history.state as SessionLifecycle) ?? existingSameTx?.state ?? "idle",
          meterStartWh,
          meterStopWh,
          meterStopFinalWh: meterStopFinalWh ?? existingSameTx?.meterStopFinalWh,
          isFinal: history.isFinal ?? existingSameTx?.isFinal ?? Boolean(history.end_time),
          activeSession: history.activeSession ?? existingSameTx?.activeSession ?? false,
          pricePerKwh: existingSameTx?.pricePerKwh ?? data?.price_per_kwh ?? null,
          maxKw: existingSameTx?.maxKw ?? null,
          finalSample,
          lastSampleAt: finalSample?.isoTimestamp ?? existingSameTx?.lastSampleAt ?? null
        };
      });
      return next;
    });
    seedAnchorsFromHistory(telemetryHistoryMap, historyBatches);
    setTelemetryHydrated(true);
  }, [applyTelemetryHistory, clampFutureStart, data?.price_per_kwh, rememberMeterStart, seedAnchorsFromHistory, telemetryHistoryMap, telemetryHydrated]);

  useEffect(() => {
    telemetryHydrationEffect();
  }, [telemetryHydrationEffect]);

  useEffect(() => {
    if (!telemetrySnapshotMap.size) return;
    const snapshotHistory: Record<number, NormalizedSample[]> = {};
    setSessionsByConnector((current) => {
      const next = { ...current };
      telemetrySnapshotMap.forEach((snapshot, connectorId) => {
        const samplePayload = snapshot.lastMeterSample ?? snapshot.lastSample;
        const sample = buildSnapshotSample(connectorId, samplePayload);
        if (sample) {
          if (!snapshotHistory[connectorId]) snapshotHistory[connectorId] = [];
          snapshotHistory[connectorId].push(sample);
        }
        const existing = next[connectorId];
        const transactionId = snapshot.transactionId ?? sample?.transactionId ?? existing?.transactionId;
        const existingSameTx = existing && transactionId && existing.transactionId === transactionId ? existing : undefined;
        rememberMeterStart(transactionId, snapshot.meterStartWh ?? sample?.valueWh);
        const resolvedState = (snapshot.state as SessionLifecycle) ?? existing?.state ?? "idle";
        const startedAt = clampFutureStart(
          snapshot.start_time ?? snapshot.started_at ?? existingSameTx?.startedAt,
          connectorId,
          transactionId,
          "snapshot"
        );
        const completedAt = snapshot.end_time ?? snapshot.completed_at ?? existingSameTx?.completedAt;
        const meterStopWh = snapshot.meterStopWh ?? sample?.valueWh ?? existingSameTx?.meterStopWh ?? snapshot.meterStartWh;
        const meterStopFinalWh = snapshot.meterStopFinalWh ?? (snapshot.isFinal ? meterStopWh : undefined) ?? existingSameTx?.meterStopFinalWh;
        next[connectorId] = {
          connectorId,
          transactionId,
          transactionKey: transactionId ?? existingSameTx?.transactionKey,
          cmsTransactionKey: transactionId ?? existingSameTx?.cmsTransactionKey,
          idTag: existingSameTx?.idTag,
          startedAt,
          completedAt,
          updatedAt: completedAt ?? startedAt ?? existingSameTx?.updatedAt,
          state: resolvedState,
          meterStartWh: snapshot.meterStartWh ?? existingSameTx?.meterStartWh,
          meterStopWh,
          meterStopFinalWh: meterStopFinalWh ?? existingSameTx?.meterStopFinalWh,
          isFinal: snapshot.isFinal ?? existingSameTx?.isFinal ?? Boolean(completedAt),
          activeSession: snapshot.activeSession ?? existingSameTx?.activeSession ?? false,
          pricePerKwh: existingSameTx?.pricePerKwh ?? data?.price_per_kwh ?? null,
          maxKw: existingSameTx?.maxKw ?? null,
          cmsSessionId: existingSameTx?.cmsSessionId ?? null,
          finalSample: sample ?? existingSameTx?.finalSample ?? null,
          lastSampleAt: sample?.isoTimestamp ?? existingSameTx?.lastSampleAt ?? null
        } as SessionRuntime;
      });
      return next;
    });
    setMeterTimelines((current) => {
      const next = { ...current };
      telemetrySnapshotMap.forEach((snapshot, connectorId) => {
        const recordedSamples = snapshotHistory[connectorId];
        const sample = recordedSamples?.[recordedSamples.length - 1] ?? buildSnapshotSample(connectorId, snapshot.lastMeterSample ?? snapshot.lastSample);
        if (!sample) return;
        const existing = next[connectorId];
        const transactionId = snapshot.transactionId ?? sample.transactionId ?? existing?.transactionId;
        const shouldReplace = !existing || existing.transactionId !== transactionId || !existing.samples.length;
        next[connectorId] = {
          transactionId,
          transactionKey: transactionId ?? existing?.transactionKey,
          samples: shouldReplace ? [sample] : existing.samples
        };
      });
      return next;
    });
    if (Object.keys(snapshotHistory).length) {
      applyTelemetryHistory(snapshotHistory);
    }
  }, [telemetrySnapshotMap, clampFutureStart, data?.price_per_kwh, applyTelemetryHistory, rememberMeterStart]);

  const resolveConnectorNumber = useCallback(
    (session: SimulatedSession): number | null => {
      const mapped = simulatorConnectorByPk.get(session.connector);
      if (mapped) return mapped.connector_id;
      const metadataConnectorId =
        typeof session.metadata === "object" && session.metadata !== null
          ? (session.metadata as { connector_id?: number }).connector_id
          : undefined;
      const fallback = Number(metadataConnectorId ?? 0);
      if (!Number.isFinite(fallback) || fallback <= 0) return null;
      return fallback;
    },
    [simulatorConnectorByPk]
  );

  const mergeSessionSnapshots = useCallback(
    (snapshots: SimulatedSession[]) => {
      if (!snapshots.length) return;
      setSessionsByConnector((current) => {
        const next = { ...current };
        snapshots.forEach((session) => {
          const connectorId = resolveConnectorNumber(session);
          if (!connectorId) return;
          const existing = next[connectorId];
          const connectorInfo = simulatorConnectorByPk.get(session.connector);
          const transactionId = pickCanonicalTransactionId(session.cms_transaction_key);
          const incomingStart = session.started_at ?? session.created_at ?? undefined;
          const completedAt = session.completed_at ?? existing?.completedAt;
          const meterStartWh = session.meter_start_wh ?? existing?.meterStartWh;
          const meterStopWh = session.meter_stop_wh ?? existing?.meterStopWh;
          const metadata = (session.metadata ?? {}) as Record<string, unknown>;
          const metaLimitType = metadata.limit_type ?? metadata.limitType;
          const metaUserLimit = metadata.user_limit ?? metadata.userLimit;
          const userLimit = coerceNumber(
            typeof session.user_limit === "number"
              ? session.user_limit
              : typeof metaUserLimit === "number"
                ? metaUserLimit
                : null
          );
          const limitType = normalizeLimitType(
            typeof session.limit_type === "string"
              ? session.limit_type
              : typeof metaLimitType === "string"
                ? metaLimitType
                : null
          );
          const state = (session.state ?? existing?.state ?? "idle") as SessionLifecycle;
          rememberMeterStart(transactionId, meterStartWh);
          const candidateUpdatedAt =
            session.updated_at ?? session.completed_at ?? session.started_at ?? session.created_at ?? existing?.updatedAt;
          const existingUpdatedAt = existing?.updatedAt ? Date.parse(existing.updatedAt) : null;
          const candidateUpdatedTs = candidateUpdatedAt ? Date.parse(candidateUpdatedAt) : null;
          if (existing && existingUpdatedAt !== null && candidateUpdatedTs !== null && candidateUpdatedTs < existingUpdatedAt) return;

          const existingTx = existing?.transactionId ?? null;
          const incomingTx = transactionId ?? null;
          const txChangedBase = hasTransactionChanged(existingTx, incomingTx);
          const isSameTx = !txChangedBase && Boolean(existingTx && incomingTx);
          const existingCompleted = existing?.isFinal || existing?.state === "completed";
          const incomingActive = state === "authorized" || state === "charging" || state === "finishing";
          const restartSameTx =
            isSameTx &&
            existingCompleted &&
            incomingActive &&
            incomingStart &&
            (!existing?.startedAt || Date.parse(incomingStart) > Date.parse(existing.startedAt));
          const txChanged = txChangedBase || restartSameTx;
          const resolvedStartedAt = clampFutureStart(
            isSameTx
              ? chooseStartedAtForTx(existing?.startedAt, incomingStart, true)
              : incomingStart ?? existing?.startedAt ?? candidateUpdatedAt ?? new Date().toISOString(),
            connectorId,
            incomingTx,
            "session-snapshot"
          );

          // Protect an active runtime from being overwritten by an older completed snapshot on the same connector.
          const existingActive =
            Boolean(existing?.activeSession) ||
            (existing?.state === "authorized" || existing?.state === "charging" || existing?.state === "finishing");
          if (existing && txChanged && existingActive && !incomingActive) {
            return;
          }

          if (txChanged) {
            deleteAnchor(connectorId, existingTx);
            deleteAnchor(connectorId, null);
            setStartAnchor(connectorId, incomingTx, resolvedStartedAt ?? incomingStart ?? null, true, "session-snapshot");
          } else {
            setStartAnchor(connectorId, incomingTx, resolvedStartedAt ?? incomingStart ?? null, false, "session-snapshot");
            // Reset stale no-tx anchors when a fresh session starts without prior Stop.
            if (!incomingTx && (state === "authorized" || state === "charging")) {
              deleteAnchor(connectorId, null);
              setStartAnchor(connectorId, incomingTx, resolvedStartedAt ?? incomingStart ?? null, false, "session-snapshot");
            }
          }

          if (process.env.NODE_ENV !== "production" && typeof window !== "undefined" && (txChanged || incomingStart)) {
            // eslint-disable-next-line no-console
            console.debug("[simulator][snapshot-merge]", {
              connectorId,
              incomingTx,
              existingTx,
              txChanged,
              resolvedStartedAt
            });
          }

          next[connectorId] = {
            connectorId,
            transactionId: (txChanged ? incomingTx : incomingTx ?? existing?.transactionId) ?? undefined,
            transactionKey: (txChanged ? incomingTx : incomingTx ?? existing?.transactionKey) ?? undefined,
            cmsTransactionKey: txChanged ? incomingTx : incomingTx ?? existing?.cmsTransactionKey,
            cmsSessionId: session.cms_transaction ?? existing?.cmsSessionId,
            idTag: session.id_tag ?? existing?.idTag,
            startedAt: resolvedStartedAt ?? undefined,
            completedAt: txChanged ? session.completed_at ?? undefined : completedAt,
            updatedAt: candidateUpdatedAt ?? existing?.updatedAt,
            state,
            meterStartWh,
            meterStopWh,
            meterStopFinalWh: (state === "completed" ? meterStopWh : undefined) ?? (txChanged ? undefined : existing?.meterStopFinalWh),
            isFinal: state === "completed" || (txChanged ? false : existing?.isFinal),
            activeSession: state === "authorized" || state === "charging" || state === "finishing",
            pricePerKwh: data?.price_per_kwh ?? existing?.pricePerKwh ?? null,
            maxKw: connectorInfo?.max_kw ?? existing?.maxKw ?? null,
            userLimit: isSameTx ? userLimit ?? existing?.userLimit ?? null : userLimit ?? null,
            limitType: isSameTx ? limitType ?? existing?.limitType ?? null : limitType ?? null
          };
        });
        return next;
      });
    },
    [clampFutureStart, data?.price_per_kwh, rememberMeterStart, resolveConnectorNumber, simulatorConnectorByPk]
  );

  useEffect(() => {
    const active = sessionsResults ?? [];
    const recent = recentSessionsResults ?? [];
    if (!active.length && !recent.length) return;
    const uniqueById = new Map<number, SimulatedSession>();
    active.forEach((session) => uniqueById.set(session.id, session));
    recent.forEach((session) => {
      if (!uniqueById.has(session.id)) uniqueById.set(session.id, session);
    });
    mergeSessionSnapshots(Array.from(uniqueById.values()));
  }, [mergeSessionSnapshots, recentSessionsResults, sessionsResults]);

  useEffect(() => {
    const results = meterValuesResults;
    if (!results || !results.length) return;
    const historyBatches: Record<number, NormalizedSample[]> = {};
    const targetTxByConnector = new Map<number, string | null | undefined>();
    // Prefer the newest transaction per connector so we don't pin to an old session
    const latestTxByConnector = new Map<number, string | null>();
    [...results]
      .sort((a, b) => new Date(b.sampledAt).getTime() - new Date(a.sampledAt).getTime())
      .forEach((reading) => {
          const connectorId = Number(reading.connectorNumber ?? reading.connectorId ?? 0);
        if (!Number.isFinite(connectorId) || connectorId <= 0) return;
        const payload = reading.payload;
        const payloadRecord =
          typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
        const rawTx =
          reading.transactionId ??
          (reading as { transaction_id?: string | number | null })?.transaction_id ??
          payloadRecord.transactionId ??
          payloadRecord.transaction_id ??
          undefined;
        const sampleTx = resolveEventTransactionId(rawTx);
        if (!latestTxByConnector.has(connectorId)) {
          latestTxByConnector.set(connectorId, sampleTx ?? null);
        }
      });
    const sessionSnapshot = { ...sessionsRef.current };
    setMeterTimelines((current) => {
      const ordered = [...results].sort((a, b) => new Date(a.sampledAt).getTime() - new Date(b.sampledAt).getTime());
      const draft: Record<number, ConnectorMeterTimeline> = { ...current };
      ordered.forEach((reading) => {
        const connectorId = Number(reading.connectorNumber ?? reading.connectorId ?? 0);
        if (!Number.isFinite(connectorId) || connectorId <= 0) return;
        const payload = reading.payload;
        const payloadRecord =
          typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
        const rawTransactionId =
          reading.transactionId ??
          // Legacy snake_case support
          (reading as { transaction_id?: string | number | null })?.transaction_id ??
          payloadRecord.transactionId ??
          payloadRecord.transaction_id ??
          undefined;
        const sampleTransaction = resolveEventTransactionId(rawTransactionId);
        const runtimeTransaction = sessionSnapshot[connectorId]?.transactionId;
        const existingTimeline = draft[connectorId];
        const existingTransaction = existingTimeline?.transactionId;

        let targetTransaction = targetTxByConnector.get(connectorId);
        if (targetTransaction === undefined) {
          targetTransaction =
            runtimeTransaction ??
            existingTransaction ??
            latestTxByConnector.get(connectorId) ??
            sampleTransaction ??
            null;
          targetTxByConnector.set(connectorId, targetTransaction);
        }
        if (targetTransaction && sampleTransaction && targetTransaction !== sampleTransaction) return;
        if (!targetTransaction && sampleTransaction) {
          targetTransaction = sampleTransaction;
          targetTxByConnector.set(connectorId, targetTransaction);
        }
        const transactionId = targetTransaction ?? sampleTransaction ?? runtimeTransaction ?? existingTransaction;
        if (!transactionId) return;
        const raw = {
          connectorId,
          timestamp: reading.sampledAt,
          valueWh: reading.valueWh,
          powerKw: toNumber(payloadRecord.powerKw ?? payloadRecord.power_kw ?? payloadRecord.power),
          currentA: toNumber(payloadRecord.currentA ?? payloadRecord.current_a ?? payloadRecord.current),
          voltageV: toNumber(payloadRecord.voltageV ?? payloadRecord.voltage_v ?? payloadRecord.voltage),
          energyKwh: toNumber(payloadRecord.energyKwh ?? payloadRecord.energy_kwh) ?? Number((reading.valueWh / 1000).toFixed(3)),
          transactionId
        };
        const baseTimeline = draft[connectorId];
        const baseSamples =
          baseTimeline && baseTimeline.transactionId && baseTimeline.transactionId !== transactionId
            ? []
            : baseTimeline?.samples ?? [];
        const previousSample = baseSamples.at(-1);
        const normalized = normalizeSample(raw, previousSample);
        if (!historyBatches[connectorId]) historyBatches[connectorId] = [];
        historyBatches[connectorId].push(normalized);
        if (!meterStartCacheRef.current.has(transactionId)) {
          rememberMeterStart(transactionId, normalized.valueWh);
        }
        const appended = appendSample(baseSamples, normalized);
        draft[connectorId] = {
          transactionId,
          transactionKey: transactionId ?? baseTimeline?.transactionKey,
          samples: trimWindow(appended, TELEMETRY_WINDOW_MS)
        };
      });
      return draft;
    });
    if (Object.keys(historyBatches).length) applyTelemetryHistory(historyBatches);
  }, [meterValuesResults, applyTelemetryHistory, rememberMeterStart]);

  useEffect(() => {
    const sessions = cmsSessionsIndex.byId ? Array.from(cmsSessionsIndex.byId.values()) : [];
    sessions.forEach((session) => {
      const cmsConnector = cmsConnectorIndex.byId.get(session.connector);
      const connectorNumber = cmsConnector?.connector_id;
      const tx = pickCanonicalTransactionId(session.formatted_transaction_id, session.cms_transaction_key, session.transaction_id);
      if (session.start_time) {
        const metrics: TimelineMetric[] = [];
        if (session.meter_start_kwh !== null && session.meter_start_kwh !== undefined) {
          metrics.push({ label: "Meter start", value: `${Number(session.meter_start_kwh).toFixed(3)} kWh` });
        }
        if (session.price_per_kwh !== null && session.price_per_kwh !== undefined) {
          metrics.push({ label: "Price", value: `${Number(session.price_per_kwh).toFixed(2)} per kWh`, muted: true });
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
          metrics.push({ label: "Energy", value: `${Number(session.energy_kwh).toFixed(3)} kWh` });
        }
        if (session.cost !== null && session.cost !== undefined) {
          const costValue = Number(session.cost ?? 0);
          metrics.push({ label: "Cost", value: `${costValue.toFixed(2)}`, muted: true });
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
  }, [cmsSessionsIndex, cmsConnectorIndex, pushTimelineEvent]);

  const handleSimulatorEvent = useCallback(
    (event: SimulatorEventPayload) => {
      if (!event || typeof event !== "object") return;
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
          if (level === "info") break;
          const message = typeof event.message === "string" ? event.message : JSON.stringify(event.message ?? "");
          const timestamp = typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString();
          const tone: TimelineTone = level === "error" ? "danger" : level === "warning" ? "warning" : "info";
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
          const snapshot = event.simulator as { connectors?: Array<{ id?: number; status?: string }> } | undefined;
          if (snapshot?.connectors?.length) {
            queryClient.setQueryData<SimulatedCharger | undefined>(
              queryKeys.simulatorDetail(simulatorId),
              (current) => {
                if (!current) return current;
                const connectors = current.connectors.map((connector) => {
                  const matched = snapshot.connectors?.find((item) => Number(item.id) === connector.connector_id);
                  if (!matched) return connector;
                  const status = normalizeConnectorStatus(matched.status) ?? normalizeConnectorStatus(connector.initial_status) ?? connector.initial_status;
                  return { ...connector, initial_status: (status ?? connector.initial_status) as ConnectorStatus };
                });
                return { ...current, connectors };
              }
            );
          }
          const timestamp = typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString();
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
            metrics: connectorCount ? [{ label: "Connectors", value: connectorCount.toString(), muted: true }] : undefined
          });
          break;
        }
        case "connector.status": {
          const connectorIdRaw = event.connectorId as number | string | undefined;
          const connectorId = Number(connectorIdRaw);
          const normalizedStatus = normalizeConnectorStatus(event.status);
          if (!Number.isNaN(connectorId)) {
            patchConnectorStatus(connectorId, normalizedStatus ?? (typeof event.status === "string" ? event.status : undefined));
          }
          const timestamp = typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString();
          const status = normalizedStatus ?? "AVAILABLE";
          const statusLabel = formatConnectorStatusLabel(status);
          const errorCode = typeof event.errorCode === "string" && event.errorCode !== "NoError" ? event.errorCode : undefined;
          const vendorErrorCode = typeof event.vendorErrorCode === "string" && event.vendorErrorCode.length ? event.vendorErrorCode : undefined;
          const isFault = Boolean(errorCode);
          const eventKind: TimelineKind = isFault ? "fault" : "connector";
          const subtitle = isFault ? (vendorErrorCode ? `Vendor error ${vendorErrorCode}` : undefined) : undefined;
          const badge = isFault ? errorCode : statusLabel;
          pushTimelineEvent({
            dedupeKey: `connector:${connectorId}:${timestamp}:${status}:${errorCode ?? "NoError"}:${vendorErrorCode ?? "none"}`,
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
            queryClient.invalidateQueries({ queryKey: ["simulators"] });
            const timestamp = typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString();
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
        case "meter.sample": {
          const connectorIdRaw = event.connectorId as number | string | undefined;
          const connectorId = Number(connectorIdRaw);
          if (!Number.isFinite(connectorId) || connectorId <= 0) return;
          const valueWh = Number(event.valueWh ?? event.value);
          if (!Number.isFinite(valueWh)) return;
          const rawTransactionId = event.transactionId as string | number | undefined;
        const transactionId = resolveEventTransactionId(rawTransactionId);
        const deltaWh = toNumber(event.deltaWh);
        const powerKw = toNumber(event.powerKw ?? event.power);
        const voltageV = toNumber(event.voltageV ?? event.voltage);
        const currentA = toNumber(event.currentA ?? event.current);
        const energyKwh = toNumber(event.energyKwh);
        const intervalSeconds = toNumber(event.intervalSeconds ?? event.interval);
        const sampleTimestamp = typeof event.sampleTimestamp === "string" ? event.sampleTimestamp : typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString();
        const sampleTimestampMs = Date.parse(sampleTimestamp);
        const runtimeSnapshot = sessionsRef.current[connectorId];
        const existingTimeline = meterTimelines[connectorId];
        const existingTx = runtimeSnapshot?.transactionId ?? existingTimeline?.transactionId;
        const migratedAnchor = transactionId ? migrateNoTxAnchor(connectorId, transactionId, sampleTimestamp) : null;
        const lastSampleIso = runtimeSnapshot?.lastSampleAt ?? runtimeSnapshot?.finalSample?.isoTimestamp ?? existingTimeline?.samples?.at(-1)?.isoTimestamp ?? null;
        const lastSampleTs = lastSampleIso ? Date.parse(lastSampleIso) : null;
        const isFrozen = frozenConnectorsRef.current.has(connectorId);
        const isDifferentTx = Boolean(transactionId && existingTx && transactionId !== existingTx);
        const isSampleNewer = lastSampleTs === null || (sampleTimestampMs && sampleTimestampMs >= lastSampleTs);
        const noTxRestart =
          !transactionId &&
          runtimeSnapshot &&
          (runtimeSnapshot.isFinal || runtimeSnapshot.state === "completed") &&
          isSampleNewer;
        const shouldSwitchToNewTx =
          (Boolean(transactionId) && isDifferentTx && (isSampleNewer || isFrozen || !runtimeSnapshot || runtimeSnapshot.isFinal || runtimeSnapshot.state === "completed")) ||
          noTxRestart;
        if (transactionId && isDifferentTx && !shouldSwitchToNewTx) return;
        if (isFrozen && !shouldSwitchToNewTx && (!transactionId || transactionId === existingTx)) return;
        let recordedSample: NormalizedSample | null = null;
        setMeterTimelines((current) => {
          const existing = current[connectorId];
          const transactionToUse = transactionId ?? (noTxRestart ? undefined : existing?.transactionId ?? existingTx);
          const samplesBase = shouldSwitchToNewTx || (existing?.transactionId && transactionToUse && existing.transactionId !== transactionToUse)
            ? []
            : existing?.samples ?? [];
          const previousSample = samplesBase.at(-1);
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
            const appended = appendSample(samplesBase, normalizedSample);
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
          if (!recordedSample) return;
        const sample = recordedSample as NormalizedSample;
        const resolvedTransaction = transactionId ?? sample.transactionId ?? existingTx;
        if (!resolvedTransaction && !noTxRestart) return;
        if (resolvedTransaction) {
          rememberMeterStart(resolvedTransaction, meterStartCacheRef.current.get(resolvedTransaction) ?? sample.valueWh);
        }
        let sampleLog: { connectorId: number; transactionId: string | null | undefined; existingTx: string | null | undefined; txChanged: boolean; startAnchor: string | null } | null = null;
        setSessionsByConnector((current) => {
          const existing = current[connectorId];
          if (existing && existing.transactionId && resolvedTransaction !== existing.transactionId && !shouldSwitchToNewTx) return current;
          const txChanged = Boolean(
            existing &&
              (hasTransactionChanged(existing.transactionId, resolvedTransaction) || noTxRestart) &&
              shouldSwitchToNewTx
          );
          const sameTxExisting = existing && existing.transactionId === resolvedTransaction ? existing : undefined;
          const runtimeStart = !txChanged && sameTxExisting && typeof sameTxExisting.meterStartWh === "number" ? sameTxExisting.meterStartWh : undefined;
          const meterStartWh = resolveMeterStart(resolvedTransaction, runtimeStart, sample.valueWh) ?? runtimeStart ?? sample.valueWh ?? 0;
          const updatedStop = Math.max(sample.valueWh, meterStartWh, sameTxExisting?.meterStopWh ?? meterStartWh);
          if (txChanged) {
            deleteAnchor(connectorId, existing?.transactionId);
            deleteAnchor(connectorId, null);
            const startIso = migratedAnchor ?? sample.isoTimestamp;
            setStartAnchor(connectorId, resolvedTransaction, startIso, true, "meter.sample");
            const pendingLimit = pendingLimitsRef.current[connectorId];
            return {
              ...current,
              [connectorId]: {
                connectorId,
                transactionId: resolvedTransaction,
                transactionKey: resolvedTransaction ?? sameTxExisting?.transactionKey,
                cmsTransactionKey: resolvedTransaction ?? sameTxExisting?.cmsTransactionKey,
                idTag: sameTxExisting?.idTag,
                startedAt: startIso,
                completedAt: undefined,
                updatedAt: sample.isoTimestamp,
                state: "charging",
                meterStartWh,
                meterStopWh: updatedStop,
                meterStopFinalWh: undefined,
                isFinal: false,
                activeSession: true,
                pricePerKwh: sameTxExisting?.pricePerKwh ?? data?.price_per_kwh ?? null,
                maxKw: sameTxExisting?.maxKw ?? null,
                cmsSessionId: sameTxExisting?.cmsSessionId ?? null,
                userLimit: pendingLimit?.userLimit ?? null,
                limitType: pendingLimit?.limitType ?? null,
                finalSample: sample,
                lastSampleAt: sample.isoTimestamp
              }
            };
          }
          if (!getStartAnchor(connectorId, resolvedTransaction)) {
            setStartAnchor(
              connectorId,
              resolvedTransaction,
              sameTxExisting?.startedAt ?? migratedAnchor ?? sample.isoTimestamp,
              false,
              "meter.sample"
            );
          }
          const firstSampleForTx = txChanged || !existing;
          if (firstSampleForTx) {
            sampleLog = {
              connectorId,
              transactionId: resolvedTransaction,
              existingTx: existing?.transactionId ?? existingTx ?? null,
              txChanged,
              startAnchor: getStartAnchor(connectorId, resolvedTransaction)
            };
          }
          return {
            ...current,
            [connectorId]: {
              connectorId,
              transactionId: resolvedTransaction,
              transactionKey: resolvedTransaction ?? sameTxExisting?.transactionKey,
              cmsTransactionKey: resolvedTransaction ?? sameTxExisting?.cmsTransactionKey,
              idTag: sameTxExisting?.idTag,
              startedAt: sameTxExisting?.startedAt ?? sample.isoTimestamp,
              completedAt: sameTxExisting?.completedAt,
              updatedAt: sample.isoTimestamp,
              state: "charging",
              meterStartWh,
              meterStopWh: updatedStop,
              meterStopFinalWh: sameTxExisting?.meterStopFinalWh,
              isFinal: false,
              activeSession: true,
              pricePerKwh: sameTxExisting?.pricePerKwh ?? data?.price_per_kwh ?? null,
              maxKw: sameTxExisting?.maxKw ?? null,
              cmsSessionId: sameTxExisting?.cmsSessionId ?? null,
              userLimit: sameTxExisting?.userLimit ?? null,
              limitType: sameTxExisting?.limitType ?? null,
              finalSample: sample,
              lastSampleAt: sample.isoTimestamp
            }
          };
        });
        if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
          if (sampleLog) {
            // eslint-disable-next-line no-console
            console.debug("[simulator][meter.sample]", sampleLog);
          }
        }
        frozenConnectorsRef.current.delete(connectorId);
        appendTelemetrySample(connectorId, sample);
          if (shouldRecordTelemetry(connectorId, sample.isoTimestamp)) {
            const runtimeState = sessionsRef.current[connectorId]?.state;
            const telemetryMetrics: TimelineMetric[] = [];
            const powerLabel = `${sample.powerKw.toFixed(2)} kW`;
            const currentLabel = `${sample.currentA.toFixed(1)} A`;
            const energyValue = sample.energyKwh;
            telemetryMetrics.push({ label: "Energy", value: `${formatNumber(energyValue, { digits: 3 })} kWh` });
            telemetryMetrics.push({ label: "Power", value: powerLabel });
            telemetryMetrics.push({ label: "Current", value: currentLabel, muted: true });
            const runtimeStateLabel = runtimeState ? runtimeState.charAt(0).toUpperCase() + runtimeState.slice(1) : "Telemetry";
            const txLabel = resolvedTransaction ?? runtimeSnapshot?.transactionId;
            pushTimelineEvent({
              dedupeKey: `meter:${connectorId}:${sample.isoTimestamp}:${resolvedTransaction ?? "no-tx"}`,
              timestamp: sample.isoTimestamp,
              kind: "meter",
              title: "Telemetry update",
              subtitle: `Connector #${connectorId}${txLabel ? ` · Tx ${txLabel}` : ""}`,
              badge: runtimeStateLabel,
              tone: "info",
              icon: "gauge",
              metrics: telemetryMetrics
            });
          }
          break;
        }
        case "session.started": {
          const connectorIdRaw = event.connectorId as number | string | undefined;
          const connectorId = Number(connectorIdRaw);
          if (!Number.isFinite(connectorId) || connectorId <= 0) break;
          delete telemetryThrottleRef.current[connectorId];
      const rawStartTransaction = event.transactionId as string | number | undefined;
      const transactionId = resolveEventTransactionId(rawStartTransaction);
          const rawStartedAt = typeof event.startedAt === "string" ? event.startedAt : new Date().toISOString();
          const startedAt = clampFutureStart(rawStartedAt, connectorId, transactionId, "session.started") ?? rawStartedAt;
      const rawMeterStart = coerceNumber(event.meterStartWh);
      const normalizedMeterStart = rawMeterStart !== null ? rawMeterStart : undefined;
          const pricePerKwh = coerceNumber(event.pricePerKwh) ?? data?.price_per_kwh ?? null;
          const maxKw = coerceNumber(event.maxKw);
          const idTag = typeof event.idTag === "string" ? event.idTag : undefined;
          const userLimit = coerceNumber(event.userLimit);
          const limitType = normalizeLimitType(event.limitType);
          if (limitType && typeof userLimit === "number" && userLimit > 0) {
            setPendingLimitsByConnector((current) => ({
              ...current,
              [connectorId]: { limitType, userLimit }
            }));
          } else {
            setPendingLimitsByConnector((current) => {
              const next = { ...current };
              delete next[connectorId];
              return next;
            });
          }
          const cachedStart = transactionId ? meterStartCacheRef.current.get(transactionId) : undefined;
          const baselineStart = normalizedMeterStart ?? cachedStart ?? 0;
          frozenConnectorsRef.current.delete(connectorId);
          setSessionsByConnector((current) => {
            const existing = current[connectorId];
            const cachedStartVal = transactionId ? meterStartCacheRef.current.get(transactionId) : undefined;
            const sameTxExisting = existing && transactionId && existing.transactionId === transactionId ? existing : undefined;
          const existingCompleted = existing?.isFinal || existing?.state === "completed";
          const restartSameTx =
            Boolean(sameTxExisting && existingCompleted && startedAt && (!sameTxExisting.startedAt || Date.parse(startedAt) > Date.parse(sameTxExisting.startedAt)));
          const txChanged = Boolean(existing && (hasTransactionChanged(existing.transactionId, transactionId) || restartSameTx));
          const resolvedStart = resolveMeterStart(transactionId, normalizedMeterStart ?? (txChanged ? undefined : sameTxExisting?.meterStartWh), undefined) ?? cachedStartVal ?? normalizedMeterStart ?? (txChanged ? undefined : sameTxExisting?.meterStartWh) ?? 0;
          rememberMeterStart(transactionId, resolvedStart);
          deleteAnchor(connectorId, null);
          if (txChanged) {
            deleteAnchor(connectorId, existing?.transactionId);
            setStartAnchor(connectorId, transactionId, startedAt, true, "session.started");
          } else {
            setStartAnchor(connectorId, transactionId, sameTxExisting?.startedAt ?? startedAt, false, "session.started");
          }
          const pendingLimit = pendingLimitsRef.current[connectorId];
          const nextLimit = typeof userLimit === "number" && userLimit > 0 ? userLimit : txChanged ? pendingLimit?.userLimit ?? null : sameTxExisting?.userLimit ?? pendingLimit?.userLimit ?? null;
          const nextLimitType = limitType ?? (txChanged ? pendingLimit?.limitType ?? null : sameTxExisting?.limitType ?? pendingLimit?.limitType ?? null);
          return {
            ...current,
            [connectorId]: {
              connectorId,
              transactionId: transactionId ?? sameTxExisting?.transactionId,
                transactionKey: transactionId ?? sameTxExisting?.transactionKey,
                cmsTransactionKey: transactionId ?? sameTxExisting?.cmsTransactionKey,
                idTag: idTag ?? sameTxExisting?.idTag,
                startedAt: txChanged ? startedAt : sameTxExisting?.startedAt ?? startedAt,
                completedAt: undefined,
                updatedAt: startedAt,
              state: "charging",
              meterStartWh: resolvedStart,
              meterStopWh: resolvedStart,
              meterStopFinalWh: undefined,
              isFinal: false,
              activeSession: true,
              pricePerKwh: pricePerKwh ?? existing?.pricePerKwh ?? null,
              maxKw: maxKw ?? existing?.maxKw ?? null,
              cmsSessionId: existing?.cmsSessionId,
              userLimit: nextLimit,
              limitType: nextLimitType,
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
                valueWh: baselineStart,
                powerKw: 0,
                currentA: 0,
                energyKwh: Number((baselineStart / 1000).toFixed(3)),
                transactionId: transactionId ?? existing?.transactionId ?? undefined
              },
              undefined
            );
            const baseSamples =
              existing?.transactionId && transactionId && existing.transactionId !== transactionId ? [] : existing?.samples ?? [];
            const updatedSamples = appendSample(baseSamples, baselineSample);
            return {
              ...current,
              [connectorId]: {
                transactionId: transactionId ?? existing?.transactionId ?? undefined,
                transactionKey: transactionId ?? existing?.transactionKey,
                samples: trimWindow(updatedSamples, TELEMETRY_WINDOW_MS)
              }
            };
          });
          if (baselineSample) appendTelemetrySample(connectorId, baselineSample);
          patchConnectorStatus(connectorId, "CHARGING");
          patchTelemetrySnapshot(connectorId, {
            transactionId: transactionId ?? undefined,
            state: "CHARGING",
            meterStartWh: normalizedMeterStart ?? baselineStart ?? undefined,
            meterStopWh: baselineStart,
            lastSample: snapshotPayloadFromSample(baselineSample)
          });
          queryClient.invalidateQueries({ queryKey: ["sessions", { simulator: simulatorId, active: true }] });
          queryClient.invalidateQueries({ queryKey: ["meter-values", { simulator: simulatorId, limit: 120 }] });
          telemetryThrottleRef.current[connectorId] = 0;
          const startEnergyKwh = typeof normalizedMeterStart === "number" ? Number((normalizedMeterStart / 1000).toFixed(3)) : null;
          const startMetrics: TimelineMetric[] = [];
          if (startEnergyKwh !== null) startMetrics.push({ label: "Meter start", value: `${startEnergyKwh} kWh` });
          if (typeof pricePerKwh === "number") startMetrics.push({ label: "Price", value: `${pricePerKwh.toFixed(2)} per kWh`, muted: true });
          if (typeof maxKw === "number") startMetrics.push({ label: "Max power", value: `${maxKw.toFixed(1)} kW`, muted: true });
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
          if (!Number.isFinite(connectorId) || connectorId <= 0) break;
          const rawStopTransaction = event.transactionId as string | number | undefined;
          const transactionId = resolveEventTransactionId(rawStopTransaction);
          const meterStopWh = coerceNumber(event.meterStopWh);
          const endedAt = typeof event.endedAt === "string" ? event.endedAt : typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString();
          const finalPowerKw = coerceNumber(event.powerKw ?? event.power) ?? undefined;
          const finalCurrentA = coerceNumber(event.currentA ?? event.current) ?? undefined;
          const finalVoltageV = coerceNumber(event.voltageV ?? event.voltage) ?? undefined;
        const finalEnergyKwh = coerceNumber(event.energyKwh ?? event.energy_kwh) ?? undefined;
        const stopDeltaWh = coerceNumber(event.deltaWh) ?? undefined;
        const sampleTimestamp = typeof event.sampleTimestamp === "string" ? event.sampleTimestamp : endedAt;
        const previousSession = sessionsRef.current[connectorId];
        const timelineSnapshot = meterTimelines[connectorId];
          const stopSample = Number.isFinite(meterStopWh)
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
            if (!existing) return current;
            if (transactionId && existing.transactionId && existing.transactionId !== transactionId) return current;
            const stopValue = Number.isFinite(meterStopWh) ? (meterStopWh as number) : existing.meterStopWh;
            const meterStartWh = existing.meterStartWh ?? previousSession?.meterStartWh ?? 0;
            const safeStop = typeof stopValue === "number" ? Math.max(stopValue, meterStartWh) : stopValue;
            const updatedSession: SessionRuntime = {
              ...existing,
              state: "completed",
              completedAt: sampleTimestamp ?? endedAt,
              updatedAt: sampleTimestamp ?? endedAt,
              meterStopWh: safeStop ?? existing.meterStopWh,
              meterStopFinalWh: safeStop ?? existing.meterStopFinalWh,
              isFinal: true,
              activeSession: false,
              transactionId: transactionId ?? existing.transactionId,
              transactionKey: transactionId ?? existing.transactionKey,
              cmsTransactionKey: transactionId ?? existing.cmsTransactionKey,
              finalSample: stopSample ?? existing.finalSample ?? null,
              lastSampleAt: stopSample?.isoTimestamp ?? sampleTimestamp ?? existing.lastSampleAt ?? null
            };
            sessionsRef.current[connectorId] = updatedSession;
            return { ...current, [connectorId]: updatedSession };
          });
          deleteAnchor(connectorId, transactionId ?? previousSession?.transactionId ?? null);
          deleteAnchor(connectorId, null);
          setPendingLimitsByConnector((current) => {
            const next = { ...current };
            delete next[connectorId];
            return next;
          });
          frozenConnectorsRef.current.add(connectorId);
          let finalizedSample: NormalizedSample | null = null;
          const historyTransaction = transactionId ?? timelineSnapshot?.transactionId ?? previousSession?.transactionId;
          if (Number.isFinite(meterStopWh)) {
            setMeterTimelines((current) => {
              const existing = current[connectorId];
              const samples = existing?.samples ?? [];
              const normalizedSample =
                stopSample ??
                normalizeSample(
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
          if (finalizedSample) appendTelemetrySample(connectorId, finalizedSample);
          patchConnectorStatus(connectorId, "AVAILABLE");
          patchTelemetrySnapshot(connectorId, {
            transactionId: transactionId ?? undefined,
            state: "COMPLETED",
            meterStopWh: Number.isFinite(meterStopWh) ? meterStopWh : undefined,
            meterStopFinalWh: Number.isFinite(meterStopWh) ? meterStopWh : undefined,
            isFinal: true,
            lastSample: snapshotPayloadFromSample(finalizedSample ?? stopSample)
          });
          void hydrateConnectorHistory(connectorId, historyTransaction);
          queryClient.invalidateQueries({ queryKey: ["sessions", { simulator: simulatorId, active: true }] });
          queryClient.invalidateQueries({ queryKey: ["meter-values", { simulator: simulatorId, limit: 120 }] });
          const energyDeliveredKwh =
            Number.isFinite(meterStopWh) && previousSession?.meterStartWh !== undefined
              ? Number((Math.max((meterStopWh as number) - (previousSession.meterStartWh ?? 0), 0) / 1000).toFixed(3))
              : undefined;
          const stopMetrics: TimelineMetric[] = [];
          if (Number.isFinite(meterStopWh)) {
            stopMetrics.push({ label: "Meter stop", value: `${formatNumber((meterStopWh as number) / 1000, { digits: 3 })} kWh` });
          }
          if (energyDeliveredKwh !== undefined) {
            stopMetrics.push({ label: "Energy", value: `+${formatNumber(energyDeliveredKwh, { digits: 3 })} kWh` });
          }
          if (typeof finalPowerKw === "number") {
            stopMetrics.push({ label: "Power", value: `${formatNumber(finalPowerKw, { digits: 2 })} kW`, muted: true });
          }
          if (typeof finalCurrentA === "number") {
            stopMetrics.push({ label: "Current", value: `${formatNumber(finalCurrentA, { digits: 1 })} A`, muted: true });
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
            subtitle: typeof event.error === "string" ? event.error : `Command ${event.action ?? ""} failed`,
            badge: "Failed",
            tone: "danger",
            icon: "alert"
          });
          pushToast({
            title: "Command failed",
            description: typeof event.error === "string" ? event.error : `Command ${event.action ?? ""} failed`,
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
          const timestamp = typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString();
          const chargerId = typeof event.chargerId === "string" ? event.chargerId : typeof event.cpid === "string" ? event.cpid : data?.charger_id ?? `Charger ${simulatorId}`;
          const connectorCountRaw = event.connectorCount ?? event.connectors ?? null;
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
      applyTelemetryHistory,
      data?.charger_id,
      data?.id,
      data?.price_per_kwh,
      formatNumber,
      hydrateConnectorHistory,
      lifecycleState,
      meterTimelines,
      clampFutureStart,
      patchConnectorStatus,
      patchTelemetrySnapshot,
      pushTimelineEvent,
      pushToast,
      queryClient,
      refreshSimulator,
      rememberMeterStart,
      resolveMeterStart,
      setLiveLifecycleState,
      setResetFlow,
      shouldRecordTelemetry,
      simulatorId
    ]
  );

  const { status: socketStatus } = useSimulatorChannel({
    chargerId: data?.charger_id ?? null,
    enabled: Boolean(data?.charger_id),
    onEvent: handleSimulatorEvent
  });

  useEffect(() => {
    if (socketStatus !== "open") setDashboardOnline(false);
  }, [socketStatus]);
  useEffect(() => {
    setDashboardOnline(false);
  }, [simulatorId]);

  /**
   * Fallback polling: while a session is active, if the websocket is not open
   * OR the latest meter.sample is older than 2× the meter interval, refetch
   * meter values every 3–5 seconds until live samples resume.
   */
  useEffect(() => {
    const meterIntervalMs = Math.max((data?.default_meter_value_interval ?? 5) * 1000, 3000);
    const staleThreshold = meterIntervalMs * 2;
    const pollPeriod = Math.min(Math.max(meterIntervalMs, 3000), 5000);

    const latestSampleTs = Object.values(meterTimelines)
      .map((timeline) => timeline?.samples?.at(-1)?.timestamp ?? null)
      .filter((ts): ts is number => ts !== null && Number.isFinite(ts))
      .reduce<number | null>((max, ts) => (max === null ? ts : Math.max(max, ts)), null);

    const hasActiveSession = Object.values(sessionsByConnector).some((runtime) =>
      ["authorized", "charging", "finishing"].includes(runtime.state)
    );

    const shouldPoll =
      hasActiveSession &&
      (socketStatus !== "open" ||
        latestSampleTs === null ||
        Date.now() - latestSampleTs > staleThreshold);

    if (!shouldPoll) {
      return;
    }

    const timer = window.setInterval(() => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.meterValues({ simulator: simulatorId, limit: METER_HISTORY_LIMIT })
      });
    }, pollPeriod);

    return () => window.clearInterval(timer);
  }, [
    data?.default_meter_value_interval,
    meterTimelines,
    sessionsByConnector,
    socketStatus,
    simulatorId,
    queryClient
  ]);

  const activeSession = useMemo(() => {
    const sessions = sessionsResults ?? [];
    const charging = sessions.find((session) => session.state === "charging" || session.state === "authorized");
    return charging ?? sessions[0] ?? null;
  }, [sessionsResults]);
  const activeSessionConnectorId = activeSession ? resolveConnectorNumber(activeSession) : null;
  const activeSessionState = (activeSession?.state ?? null) as SessionLifecycle | null;

  const telemetryFeed = useMemo(() => {
    const sourceHistory =
      Object.keys(telemetryHistory).length > 0
        ? telemetryHistory
        : Object.fromEntries(Object.entries(meterTimelines).map(([connectorKey, timeline]) => [connectorKey, timeline?.samples ?? []]));
    const entries = Object.entries(sourceHistory).flatMap(([connectorKey, samples]) => {
      const connectorId = Number(connectorKey);
      if (!Number.isFinite(connectorId)) return [];
      return samples.map((sample) => ({ connectorId, sample }));
    });
    return entries
      .sort((a, b) => b.sample.timestamp - a.sample.timestamp)
      .slice(0, TELEMETRY_FEED_LIMIT)
      .map(({ connectorId, sample }) => {
        const runtime = sessionsByConnector[connectorId];
        const status = runtime?.state ?? "idle";
        const rawEnergyKwh = typeof sample.energyKwh === "number" && Number.isFinite(sample.energyKwh) ? sample.energyKwh : null;
        return {
          connectorId,
          timestamp: sample.isoTimestamp,
          transactionId: runtime?.transactionId ?? sample.transactionId,
          powerKw: sample.powerKw,
          current: sample.currentA,
          energyKwh: rawEnergyKwh,
          energyRegisterKwh: rawEnergyKwh,
          status,
          statusLabel: status,
          statusClass: status,
          idTag: runtime?.idTag
        };
      });
  }, [meterTimelines, sessionsByConnector, telemetryHistory]);

  // Fallback: if an active session lacks fresh live samples (e.g., websocket missed early events),
  // hydrate recent meter values from the API so the meter card shows data without a hard reload.
  useEffect(() => {
    const now = Date.now();
    Object.values(sessionsByConnector).forEach((runtime) => {
      const connectorId = runtime.connectorId;
      const isActive = runtime.state === "authorized" || runtime.state === "charging" || runtime.state === "finishing";
      if (!isActive) return;
      const timeline = meterTimelines[connectorId];
      const latestSampleTs = timeline?.samples?.at(-1)?.timestamp ?? null;
      const hasFreshSample = latestSampleTs !== null && now - latestSampleTs <= 10_000;
      if (hasFreshSample) return;
      const transactionId = runtime.transactionId ?? runtime.transactionKey ?? runtime.cmsTransactionKey ?? null;
      if (!transactionId) return;
      const hydrateKey = `${connectorId}:${transactionId}`;
      const lastAttempt = lastActiveHydrateRef.current[hydrateKey] ?? 0;
      if (now - lastAttempt < 5_000) return;
      lastActiveHydrateRef.current[hydrateKey] = now;
      void hydrateConnectorHistory(connectorId, transactionId);
    });
  }, [sessionsByConnector, meterTimelines, hydrateConnectorHistory]);

  // Hydrate timelines for recent sessions when we have no samples yet (covers hard refresh during/after a session)
  useEffect(() => {
    const sessions = recentSessionsResults ?? [];
    sessions.forEach((session) => {
      const connectorId = resolveConnectorNumber(session);
      if (!connectorId) return;
      const transactionId = pickCanonicalTransactionId(session.cms_transaction_key, session.cms_transaction_key, session.id);
      const hasTimeline = meterTimelines[connectorId]?.samples?.length;
      if (!hasTimeline && transactionId) {
        const hydrateKey = `${connectorId}:${transactionId}`;
        const lastAttempt = lastActiveHydrateRef.current[hydrateKey] ?? 0;
        const nowTsLocal = Date.now();
        if (nowTsLocal - lastAttempt < 2_000) return;
        lastActiveHydrateRef.current[hydrateKey] = nowTsLocal;
        void hydrateConnectorHistory(connectorId, transactionId);
      }
    });
  }, [recentSessionsResults, meterTimelines, hydrateConnectorHistory, resolveConnectorNumber]);

  // When the dashboard socket reconnects, proactively hydrate active sessions to cover gaps
  // that may have been missed during the outage.
  useEffect(() => {
    if (!dashboardOnline) return;
    const now = Date.now();
    Object.values(sessionsByConnector).forEach((runtime) => {
      const connectorId = runtime.connectorId;
      const isActive = runtime.state === "authorized" || runtime.state === "charging" || runtime.state === "finishing";
      if (!isActive) return;
      const transactionId = runtime.transactionId ?? runtime.transactionKey ?? runtime.cmsTransactionKey ?? null;
      if (!transactionId) return;
      const hydrateKey = `${connectorId}:${transactionId}`;
      const lastAttempt = lastActiveHydrateRef.current[hydrateKey] ?? 0;
      if (now - lastAttempt < 2_000) return;
      lastActiveHydrateRef.current[hydrateKey] = now;
      void hydrateConnectorHistory(connectorId, transactionId);
    });
  }, [dashboardOnline, sessionsByConnector, hydrateConnectorHistory]);

  return {
    timelineCardRef,
    timelineEvents,
    heartbeatEvents,
    meterTimelines,
    telemetryHistory,
    telemetryHydrated,
    sessionsByConnector,
    pendingLimitsByConnector,
    nowTs,
    selectedConnectorId,
    setSelectedConnectorId,
    dashboardOnline,
    setDashboardOnline,
    handleSimulatorEvent,
    resolveMeterStart,
    hydrateConnectorHistory,
    rememberMeterStart,
    getStartAnchor,
    telemetryFeed,
    activeSession,
    activeSessionConnectorId,
    activeSessionState,
    socketStatus
  };
};
