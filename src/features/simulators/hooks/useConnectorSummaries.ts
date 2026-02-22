import { useMemo } from "react";
import { formatLocalTimestamp } from "@/lib/time";
import { pickCanonicalTransactionId } from "@/lib/transactions";
import {
  connectorHasActiveSession,
  connectorStatusTone,
  formatConnectorStatusLabel,
  isConnectorPlugged,
  normalizeConnectorStatus
} from "../utils/status";
import { ConnectorStatus, SimulatedConnector } from "@/types";
import {
  CmsChargingSession,
  CmsConnector,
  ConnectorMeterTimeline,
  ConnectorSummary,
  SessionLifecycle,
  SessionRuntime
} from "../types/detail";
import styles from "../SimulatorDetailPage.module.css";
import { formatDurationLabel } from "../detail/detailHelpers";

const simDebugEnabled = () =>
  process.env.NEXT_PUBLIC_SIM_DEBUG === "1" ||
  process.env.NODE_ENV !== "production" ||
  (typeof window !== "undefined" && window.localStorage.getItem("sim-debug") === "1");

const simDebug = (label: string, payload?: unknown) => {
  if (!simDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.info(`[simulator][${label}]`, payload ?? "");
};

// Persist a synthetic start time per connector to avoid resetting duration on every render
// when upstream payloads don't include started_at yet.
const syntheticStartRef = new Map<number, string>();

type CmsSessionsIndex = {
  byId: Map<number, CmsChargingSession>;
  byFormatted: Map<string, CmsChargingSession>;
  byConnectorNumber: Map<number, CmsChargingSession[]>;
};

type CmsConnectorIndex = {
  byId: Map<number, CmsConnector>;
  byNumber: Map<number, CmsConnector>;
};

type Args = {
  data?: { connectors?: SimulatedConnector[] };
  meterTimelines: Record<number, ConnectorMeterTimeline>;
  sessionsByConnector: Record<number, SessionRuntime>;
  nowTs: number;
  cmsSessionsIndex: CmsSessionsIndex;
  cmsConnectorIndex: CmsConnectorIndex;
  defaultPricePerKwh?: number | null;
  pendingLimits?: Record<number, { limitType: "KWH" | "AMOUNT"; userLimit: number }>;
  resolveMeterStart: (
    transactionId: string | undefined,
    runtimeStart?: number | null,
    earliestSample?: number | null
  ) => number | undefined;
  getStartAnchor: (connectorId: number, transactionId?: string | null) => string | null;
  getSessionStatusLabel: (state: SessionLifecycle) => string;
  getSessionStatusClass: (state: SessionLifecycle) => string;
  activeSessionConnectorId: number | null;
  activeSessionState: SessionLifecycle | null;
};

export const useConnectorSummaries = ({
  data,
  meterTimelines,
  sessionsByConnector,
  nowTs,
  cmsSessionsIndex,
  cmsConnectorIndex,
  defaultPricePerKwh,
  pendingLimits,
  resolveMeterStart,
  getStartAnchor,
  getSessionStatusLabel,
  getSessionStatusClass,
  activeSessionConnectorId,
  activeSessionState
}: Args) => {
  const toFiniteNumber = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const normalizeLimitType = (value: unknown): "KWH" | "AMOUNT" | null => {
    if (value === null || value === undefined) return null;
    const upper = String(value).toUpperCase();
    return upper === "KWH" || upper === "AMOUNT" ? (upper as "KWH" | "AMOUNT") : null;
  };

  const connectorsSummary: ConnectorSummary[] = useMemo<ConnectorSummary[]>(() => {
    const normalizeIsoMillis = (value?: string | null): string | null => {
      if (!value || typeof value !== "string") return value ?? null;
      return value.replace(/(\.\d{3})\d+/, "$1");
    };

    const connectors = data?.connectors ?? [];
    const connectorsByNumber = new Map<number, SimulatedConnector>();
    connectors.forEach((connector) => {
      connectorsByNumber.set(connector.connector_id, connector);
    });
    const maxFinite = (values: Array<number | null | undefined>) => {
      const numbers = values.filter(
        (val): val is number => typeof val === "number" && Number.isFinite(val)
      );
      return numbers.length ? Math.max(...numbers) : undefined;
    };
    const firstFinite = (values: Array<number | null | undefined>) => {
      for (const val of values) {
        if (typeof val === "number" && Number.isFinite(val)) return val;
      }
      return undefined;
    };
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
      const sampleIsFresh = latestTimestamp !== null ? nowTs - latestTimestamp <= 15_000 : false;
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
      const cmsDurationSeconds =
        typeof cmsSession?.duration_seconds === "number" && cmsSession.duration_seconds >= 0
          ? cmsSession.duration_seconds
          : null;

      const liveStatus = normalizeConnectorStatus((connector as any)?.live_status);
      const cmsStatus = normalizeConnectorStatus((connector as any)?.metadata?.cms_status);
      const initialStatus = normalizeConnectorStatus(connector?.initial_status);
      const connectorStatus = liveStatus ?? cmsStatus ?? initialStatus ?? "AVAILABLE";
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

      const runtimeTxMatches =
        runtime?.transactionId && transactionId ? runtime.transactionId === transactionId : false;

      const sessionState: SessionLifecycle =
        (runtime?.state as SessionLifecycle | undefined) ??
        (telemetryState as SessionLifecycle | undefined) ??
        ((cmsSession && !cmsSession.end_time ? "charging" : undefined) as SessionLifecycle | undefined) ??
        stateFromConnector;
      const connectorHasSession = connectorHasActiveSession({
        sessionState,
        sessionActive: runtime?.activeSession,
        connectorId,
        activeSessionConnectorId,
        activeSessionState
      });

      const runtimeActive = runtime?.activeSession || connectorHasSession;
      const runtimeMeterStartWh =
        runtimeTxMatches || runtimeActive ? runtime?.meterStartWh : undefined;
      const earliestSampleWh = samples[0]?.valueWh ?? null;
      const meterStartWh = resolveMeterStart(transactionId, runtimeMeterStartWh, earliestSampleWh) ?? 0;

      const latestSampleWh = toFiniteNumber(latestSample?.valueWh);
      const liveStopWh = latestSampleWh ?? meterStartWh;
      const runtimeStopWh = runtime?.meterStopWh;
      const runtimeFinalWh = runtime?.meterStopFinalWh;
      const cmsMeterStopWh = cmsSession?.meter_stop;
      const sessionFinished =
        runtime?.isFinal ||
        runtime?.state === "completed" ||
        Boolean(runtime?.completedAt ?? cmsSession?.end_time);
      // Treat a session as completed only when telemetry / runtime both indicate completion
      // and no active session is detected on this connector.
      const isCompleted = sessionFinished && !connectorHasSession && sessionState === "completed";
      const activeStopInputs = [runtimeStopWh, latestSampleWh, cmsMeterStopWh, meterStartWh];
      const activeStop = maxFinite(activeStopInputs);
      const finalStopRaw = firstFinite([runtimeFinalWh, cmsMeterStopWh, runtimeStopWh, latestSampleWh, meterStartWh]);
      const finalStop = typeof finalStopRaw === "number" && Number.isFinite(finalStopRaw)
        ? Math.max(finalStopRaw, meterStartWh)
        : undefined;
      // Prefer the live sample for active sessions; fall back to recorded stop values.
      const meterStopCandidate = isCompleted ? finalStop : activeStop;
      const meterStopWh = (() => {
        if (isCompleted && typeof finalStop === "number" && Number.isFinite(finalStop)) {
          return Math.max(finalStop, meterStartWh);
        }
        return Math.max(
          meterStartWh,
          typeof liveStopWh === "number" && Number.isFinite(liveStopWh) ? liveStopWh : meterStartWh,
          typeof meterStopCandidate === "number" && Number.isFinite(meterStopCandidate) ? meterStopCandidate : meterStartWh
        );
      })();
      const meterStopFinalWh = isCompleted
        ? Math.max(
            typeof finalStop === "number" && Number.isFinite(finalStop) ? finalStop : meterStopWh,
            meterStartWh
          )
        : undefined;
      const energyWh = Math.max(meterStopWh - meterStartWh, 0);
      const energyKwh = Number((energyWh / 1000).toFixed(3));

      const pendingLimit = pendingLimits?.[connectorId];
      const limitType =
        normalizeLimitType(runtimeTxMatches ? runtime?.limitType : null) ??
        normalizeLimitType(cmsSession?.limit_type) ??
        normalizeLimitType(pendingLimit?.limitType);
      const userLimit = (() => {
        const runtimeLimit = runtimeTxMatches ? toFiniteNumber(runtime?.userLimit) : null;
        const cmsLimit = toFiniteNumber(cmsSession?.limit);
        const pendingUserLimit = toFiniteNumber(pendingLimit?.userLimit);
        if (runtimeLimit !== null && runtimeLimit > 0) return runtimeLimit;
        if (pendingUserLimit !== null && pendingUserLimit > 0) return pendingUserLimit;
        if (cmsLimit !== null && cmsLimit > 0) return cmsLimit;
        if (runtimeLimit !== null) return runtimeLimit;
        if (pendingUserLimit !== null) return pendingUserLimit;
        if (cmsLimit !== null) return cmsLimit;
        return null;
      })();
      const pricePerKwh =
        typeof runtime?.pricePerKwh === "number"
          ? runtime.pricePerKwh
          : typeof cmsSession?.price_per_kwh === "number"
            ? cmsSession.price_per_kwh
            : typeof defaultPricePerKwh === "number"
              ? defaultPricePerKwh
              : null;
      const rawCost =
        pricePerKwh !== null && Number.isFinite(pricePerKwh) ? energyKwh * pricePerKwh : null;
      const roundedCost = rawCost !== null ? Math.round(rawCost * 100) / 100 : null;
      const backendCost = toFiniteNumber(
        (cmsSession as any)?.cost_final ??
          cmsSession?.payable_amount ??
          cmsSession?.cost ??
          cmsSession?.cost_raw
      );
      const costSoFar = (() => {
        if (limitType === "AMOUNT") {
          const preferred = backendCost ?? roundedCost;
          if (preferred === null) return null;
          const capped = userLimit !== null && userLimit !== undefined ? Math.min(preferred, userLimit) : preferred;
          return Math.round(capped * 100) / 100;
        }
        return roundedCost;
      })();
      const earliestSampleIso = samples.length ? normalizeIsoMillis(samples[0]?.isoTimestamp ?? null) : null;
      const anchorStart =
        normalizeIsoMillis(getStartAnchor(connectorId, transactionId)) ??
        (runtime?.transactionId ? normalizeIsoMillis(getStartAnchor(connectorId, runtime.transactionId)) : null) ??
        normalizeIsoMillis(getStartAnchor(connectorId, null));
      // Pick the earliest reliable start we have. Allow the first sample timestamp
      // to seed an in-flight session so the duration timer doesn't wait for a full refresh
      // or a missing CMS start time.
      const startedAt = normalizeIsoMillis(
        (runtimeActive ? runtime?.startedAt : null) ??
          cmsSession?.start_time ??
          anchorStart ??
          earliestSampleIso ??
          runtime?.lastSampleAt ??
          syntheticStartRef.get(connectorId) ??
          null
      );
      // As a last resort, if we still lack a start but have signs of an active session,
      // seed with a stable synthetic value (only once) so the duration ticks without resetting.
      let effectiveStartedAt = startedAt;
      if (
        !effectiveStartedAt &&
        (connectorHasSession ||
          sessionState !== "idle" ||
          Boolean(transactionId) ||
          samples.length > 0)
      ) {
        const synthetic = new Date(nowTs).toISOString();
        syntheticStartRef.set(connectorId, synthetic);
        effectiveStartedAt = synthetic;
      }
      if (!connectorHasSession && sessionState === "completed") {
        syntheticStartRef.delete(connectorId);
      }
      const completedAt =
        runtime?.completedAt ??
        (cmsSession?.end_time ??
          (isCompleted ? runtime?.lastSampleAt ?? latestSample?.isoTimestamp ?? undefined : undefined));
      const debugEndMs = completedAt ? Date.parse(completedAt) : nowTs;
      const debugStartMs = effectiveStartedAt ? Date.parse(effectiveStartedAt) : null;
      const startDeltaMs = debugStartMs !== null && Number.isFinite(debugStartMs) ? debugStartMs - debugEndMs : null;
      const elapsedSeconds =
        debugStartMs !== null && Number.isFinite(debugStartMs) && Number.isFinite(debugEndMs)
          ? Math.max(0, Math.floor((debugEndMs - Math.min(debugStartMs, debugEndMs)) / 1000))
          : null;
      const duration = formatDurationLabel({
        startedAt: effectiveStartedAt,
        completedAt,
        nowTs,
        cmsDurationSeconds
      });
      if (process.env.NODE_ENV !== "production" && connectorHasSession && typeof window !== "undefined") {
        // Dev-only duration trace for the active connector to diagnose session timing drift.
        // eslint-disable-next-line no-console
        console.debug("[simulator][duration]", {
          connectorId,
          sessionState,
          transactionId,
          runtimeStartedAt: runtime?.startedAt ?? null,
          anchorStart,
          chosenStartedAt: startedAt,
          parsedStartMs: debugStartMs,
          completedAt,
          nowTs,
          endMs: debugEndMs,
          elapsedSeconds,
          startDeltaMs,
          durationLabel: duration,
          cmsDurationSeconds
        });
      }

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

      if (runtimeActive) {
        simDebug("meter.summary", {
          connectorId,
          transactionId,
          samples: samples.length,
          meterStartWh,
          meterStopWh,
          energyWh,
          energyKwh,
          latestSampleWh,
          latestSampleWhType: typeof latestSampleWh,
          liveStopWh,
          activeStopInputs,
          lastSampleAt: latestSample?.isoTimestamp ?? null,
          sessionState,
          runtimeState: runtime?.state ?? null,
          startedAt: runtime?.startedAt ?? cmsSession?.start_time ?? anchorStart ?? earliestSampleIso ?? syntheticStartRef.get(connectorId) ?? null,
          effectiveStartedAt,
          nowTs,
          durationLabel: formatDurationLabel({
            startedAt: effectiveStartedAt,
            completedAt,
            nowTs,
            cmsDurationSeconds
          })
        });
      }

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
          runtime?.transactionKey ?? timeline?.transactionKey ?? (runtime?.cmsTransactionKey ?? undefined),
        runtime,
        energyKwh,
        pricePerKwh,
        meterStartKwh,
        meterStopKwh,
        meterStopFinalWh: meterStopFinalWh ?? (isCompleted ? meterStopWh : undefined),
        isFinal: isCompleted,
        deltaKwh,
        powerKw,
        startedAt: effectiveStartedAt ?? null,
        completedAt: completedAt ?? null,
        lastUpdated,
        lastSampleAt: lastSampleIso,
        duration,
        userLimit,
        limitType,
        costSoFar: costSoFar ?? null,
        cmsSession,
        current,
        idTag,
        activeSession: connectorHasSession,
        isPlugged: isConnectorPlugged(connectorStatus)
      };
    });
  }, [
    data?.connectors,
    meterTimelines,
    sessionsByConnector,
    nowTs,
    cmsSessionsIndex,
    resolveMeterStart,
    getSessionStatusLabel,
    getSessionStatusClass,
    activeSessionConnectorId,
    activeSessionState,
    defaultPricePerKwh,
    pendingLimits
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

  const connectorsConfigured = connectorsSummary.length > 0;
  const connectorsForCards = connectorsConfigured
    ? connectorsSummary
    : (cmsConnectorIndex.byNumber.size
        ? Array.from(cmsConnectorIndex.byNumber.values()).map((connector) => {
            const normalizedStatus = normalizeConnectorStatus(connector.status) ?? "AVAILABLE";
            return {
              connectorId: connector.connector_id,
              connector: {
                id: connector.id,
                connector_id: connector.connector_id,
                format: connector.type ?? "Connector",
                max_kw: connector.max_kw ?? connector.max_charging_power ?? undefined,
                phase_count: connector.phase_count ?? undefined,
                initial_status: normalizedStatus as ConnectorStatus,
                metadata: { source: "cms" }
              },
              connectorStatus: normalizedStatus,
              statusLabel: formatConnectorStatusLabel(normalizedStatus),
              statusTone: connectorStatusTone(normalizedStatus),
              sessionState: "idle" as SessionLifecycle,
              samples: [],
              runtime: undefined,
              energyKwh: 0,
              pricePerKwh: null,
              meterStartKwh: 0,
              meterStopKwh: 0,
              meterStopFinalWh: undefined,
              isFinal: true,
              deltaKwh: null,
              powerKw: null,
              costSoFar: null,
              lastUpdated: null,
              lastSampleAt: null,
              duration: null,
              sessionStatusLabel: getSessionStatusLabel("idle"),
              sessionStatusClass: getSessionStatusClass("idle"),
              cmsSession: undefined,
              current: null,
              idTag: undefined,
              activeSession: false,
              isPlugged: isConnectorPlugged(normalizedStatus)
            };
          })
        : []);

  const connectorBaselines = useMemo(() => {
    const map = new Map<number, number>();
    connectorsSummary.forEach((summary) => {
      if (typeof summary.meterStartKwh === "number" && Number.isFinite(summary.meterStartKwh)) {
        map.set(summary.connectorId, summary.meterStartKwh);
      }
    });
    return map;
  }, [connectorsSummary]);

  const connectorOptions = useMemo(() => {
    const map = new Map<number, SimulatedConnector>();

    connectorsSummary.forEach((summary) => {
      map.set(summary.connectorId, {
        id: summary.connector?.id ?? summary.connectorId,
        connector_id: summary.connectorId,
        format: summary.connector?.format ?? "Unknown",
        max_kw: summary.connector?.max_kw ?? undefined,
        phase_count: summary.connector?.phase_count ?? undefined,
        initial_status: (summary.connectorStatus ?? "AVAILABLE") as ConnectorStatus,
        metadata: summary.connector?.metadata ?? {}
      });
    });

    Array.from(cmsConnectorIndex.byNumber.values()).forEach((cmsConnector) => {
      if (map.has(cmsConnector.connector_id)) {
        return;
      }
      const status = normalizeConnectorStatus(cmsConnector.status) ?? "AVAILABLE";
      const maxKw = cmsConnector.max_kw ?? cmsConnector.max_charging_power ?? undefined;
      map.set(cmsConnector.connector_id, {
        id: cmsConnector.id,
        connector_id: cmsConnector.connector_id,
        format: cmsConnector.type ?? "Connector",
        max_kw: maxKw,
        phase_count: cmsConnector.phase_count ?? undefined,
        initial_status: status as ConnectorStatus,
        metadata: { source: "cms" }
      });
    });

    return Array.from(map.values()).sort((a, b) => a.connector_id - b.connector_id);
  }, [connectorsSummary, cmsConnectorIndex.byNumber]);

  return {
    connectorsSummary,
    connectorSelectOptions,
    defaultConnectorId,
    connectorsConfigured,
    connectorsForCards,
    connectorBaselines,
    connectorOptions
  };
};
