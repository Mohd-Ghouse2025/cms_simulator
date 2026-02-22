'use client';

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useTenantAuth } from "@/features/auth/useTenantAuth";
import { useWebSocketChannel, WebSocketStatus } from "@/hooks/useWebSocketChannel";
import { buildSimulatorSocketUrl } from "./hooks/socketUrl";

type SimulatorEvent = {
  type?: string;
  [key: string]: unknown;
};

type ChannelSnapshot = {
  status: WebSocketStatus;
  error: Event | null;
  lastMessageAt: number | null;
};

type ChannelListener = (event: SimulatorEvent) => void;

type SimulatorChannelContextValue = {
  subscribe: (chargerId: string, listener?: ChannelListener) => () => void;
  getSnapshot: (chargerId: string) => ChannelSnapshot | undefined;
  /**
   * Bumps whenever the provider clears listeners/activeIds so consumers can resubscribe.
   * Dev-only; omitted from production logs.
   */
  resetEpoch: number;
};

const SimulatorChannelContext = createContext<SimulatorChannelContextValue | null>(null);
const LAST_CHARGER_KEY = "ocpp-sim-last-charger";

const parseEventPayload = (event: MessageEvent<unknown>): SimulatorEvent => {
  const payload = event.data;
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload) as SimulatorEvent;
    } catch {
      return { type: "log.entry", message: payload, level: "info" } as SimulatorEvent;
    }
  }
  if (typeof payload === "object" && payload !== null) {
    return payload as SimulatorEvent;
  }
  return { type: "unknown" };
};

type BridgeProps = {
  chargerId: string;
  url: string | null;
  shouldConnect: boolean;
  onStatus: (status: WebSocketStatus, error: Event | null) => void;
  notify: (payload: SimulatorEvent) => void;
  onUnauthorized: () => Promise<boolean> | boolean;
  authFingerprint: string;
};

const SimulatorSocketBridge = ({
  chargerId,
  url,
  shouldConnect,
  onStatus,
  notify,
  onUnauthorized,
  authFingerprint
}: BridgeProps) => {
  const { status, error } = useWebSocketChannel({
    url,
    shouldConnect,
    autoReconnect: true,
    reconnectDelayMs: 1800,
    heartbeatIntervalMs: 25000,
    onMessage: (event) => notify(parseEventPayload(event)),
    onUnauthorized
  });

  useEffect(() => {
    onStatus(status, error);
  }, [status, error, onStatus]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" || typeof window === "undefined") return;
    const ts = new Date().toISOString();
    // eslint-disable-next-line no-console
    console.debug("[simulator][bridge][mount]", { ts, chargerId, url, shouldConnect, authFingerprint });
    return () => {
      const endTs = new Date().toISOString();
      // eslint-disable-next-line no-console
      console.debug("[simulator][bridge][unmount]", { ts: endTs, chargerId });
    };
  }, [authFingerprint, chargerId, shouldConnect, url]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" || typeof window === "undefined") return;
    const ts = new Date().toISOString();
    const closeCode = (error as CloseEvent | undefined)?.code ?? undefined;
    const closeReason = (error as CloseEvent | undefined)?.reason ?? undefined;
    // eslint-disable-next-line no-console
    console.debug("[simulator][bridge][status]", {
      ts,
      chargerId,
      status,
      error: error?.type,
      closeCode,
      closeReason,
      url,
      shouldConnect
    });
  }, [chargerId, error?.type, shouldConnect, status, url]);

  return null;
};

export const SimulatorChannelProvider = ({ children }: { children: ReactNode }) => {
  const { baseUrl, tokens, tenant, logout, refreshTokens, isAuthenticated, hydrated } = useTenantAuth();
  const accessToken = tokens?.access ?? null;
  const tenantSchema = tenant ?? null;
  const canConnect = hydrated && isAuthenticated && Boolean(accessToken && tenantSchema && baseUrl);
  const authFingerprint = `${tenantSchema ?? ""}:${accessToken ?? ""}`;

  const [snapshots, setSnapshots] = useState<Record<string, ChannelSnapshot>>({});
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const [resetEpoch, setResetEpoch] = useState(0);
  const listenersRef = useRef<Map<string, Set<ChannelListener>>>(new Map());
  const activeIdsRef = useRef<string[]>([]);
  const hydratedLastRef = useRef(false);
  const prevCanConnectRef = useRef<boolean>(canConnect);
  const prevAuthRef = useRef<boolean>(isAuthenticated);
  const lastTenantRef = useRef<string | null>(tenantSchema ?? null);

  const handleStatus = useCallback(
    (chargerId: string, status: WebSocketStatus, error: Event | null) => {
      setSnapshots((prev) => {
        const existing = prev[chargerId];
        if (existing?.status === status && existing?.error === error) {
          return prev;
        }
        return {
          ...prev,
          [chargerId]: {
            status,
            error,
            lastMessageAt: existing?.lastMessageAt ?? null
          }
        };
      });
    },
    []
  );

  const notifyListeners = useCallback((chargerId: string, payload: SimulatorEvent) => {
    const nowTs = Date.now();
    setSnapshots((prev) => {
      const existing = prev[chargerId];
      if (!existing) {
        return { ...prev, [chargerId]: { status: "open", error: null, lastMessageAt: nowTs } };
      }
      if (existing.lastMessageAt === nowTs) return prev;
      return { ...prev, [chargerId]: { ...existing, lastMessageAt: nowTs } };
    });

    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
      const { type, connectorId, transactionId } = payload as Record<string, unknown>;
      const valueWh = (payload as Record<string, unknown>).valueWh ?? (payload as Record<string, unknown>).value;
      const energyKwh = (payload as Record<string, unknown>).energyKwh;
      const ts =
        (payload as Record<string, unknown>).sampleTimestamp ??
        (payload as Record<string, unknown>).timestamp ??
        null;
      // eslint-disable-next-line no-console
      console.debug("[simulator][ws]", { type, connectorId, transactionId, valueWh, energyKwh, timestamp: ts });
    }
    const listeners = listenersRef.current.get(chargerId);
    if (!listeners || !listeners.size) {
      return;
    }
    listeners.forEach((listener) => {
      try {
        listener(payload);
      } catch {
        // ignore listener errors
      }
    });
  }, []);

  const subscribe = useCallback(
    (chargerId: string, listener?: ChannelListener) => {
      if (!chargerId) {
        return () => {};
      }
      setActiveIds((prev) => {
        const alreadyActive = prev.includes(chargerId);
        const next = alreadyActive ? prev : [...prev, chargerId];
        if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
          // eslint-disable-next-line no-console
          console.debug("[simulator][provider][subscribe]", {
            ts: new Date().toISOString(),
            chargerId,
            alreadyActive,
            nextCount: next.length,
            resetEpoch
          });
        }
        return next;
      });
      try {
        window.localStorage.setItem(LAST_CHARGER_KEY, chargerId);
      } catch {
        // best effort
      }
      if (listener) {
        const current = listenersRef.current.get(chargerId) ?? new Set<ChannelListener>();
        current.add(listener);
        listenersRef.current.set(chargerId, current);
      }
      return () => {
        if (listener) {
          const current = listenersRef.current.get(chargerId);
          if (current) {
            current.delete(listener);
            if (!current.size) {
              listenersRef.current.delete(chargerId);
            }
          }
        }
      };
    },
    [resetEpoch]
  );

  const getSnapshot = useCallback(
    (chargerId: string) => snapshots[chargerId],
    [snapshots]
  );

  const resetAll = useCallback((reason = "unspecified") => {
    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
      // eslint-disable-next-line no-console
      console.debug("[simulator][provider][reset]", {
        ts: new Date().toISOString(),
        reason,
        activeCount: activeIdsRef.current.length,
        listenerCount: listenersRef.current.size
      });
    }
    listenersRef.current.clear();
    setActiveIds([]);
    setSnapshots({});
    setResetEpoch((prev) => prev + 1);
    hydratedLastRef.current = false;
    try {
      window.localStorage.removeItem(LAST_CHARGER_KEY);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    activeIdsRef.current = activeIds;
    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
      // eslint-disable-next-line no-console
      console.debug("[simulator][provider][activeIds]", {
        ts: new Date().toISOString(),
        activeIds
      });
    }
  }, [activeIds]);

  useEffect(() => {
    const wasAuthenticated = prevAuthRef.current;
    if (wasAuthenticated && !isAuthenticated && hydrated) {
      resetAll("logout");
    }
    prevAuthRef.current = isAuthenticated;
  }, [hydrated, isAuthenticated, resetAll]);

  useEffect(() => {
    const previousTenant = lastTenantRef.current;
    if (previousTenant && tenantSchema && previousTenant !== tenantSchema) {
      resetAll("tenant-changed");
    }
    lastTenantRef.current = tenantSchema ?? null;
  }, [resetAll, tenantSchema]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" || typeof window === "undefined") return;
    const prev = prevCanConnectRef.current;
    if (prev !== canConnect) {
      // eslint-disable-next-line no-console
      console.debug("[simulator][provider][canConnect]", {
        ts: new Date().toISOString(),
        prev,
        next: canConnect,
        activeCount: activeIdsRef.current.length
      });
    }
    prevCanConnectRef.current = canConnect;
  }, [canConnect]);

  useEffect(() => {
    if (!canConnect || hydratedLastRef.current) {
      return;
    }
    hydratedLastRef.current = true;
    try {
      const stored = window.localStorage.getItem(LAST_CHARGER_KEY);
      if (stored) {
        setActiveIds((prev) => (prev.length ? prev : [stored]));
      }
    } catch {
      // ignore hydration failures
    }
  }, [canConnect]);

  const contextValue = useMemo<SimulatorChannelContextValue>(
    () => ({
      subscribe,
      getSnapshot,
      resetEpoch
    }),
    [subscribe, getSnapshot, resetEpoch]
  );

  const handleUnauthorized = useCallback(async () => {
    const refreshed = await refreshTokens();
    if (!refreshed) {
      logout({ reason: "expired" });
      return false;
    }
    return true;
  }, [logout, refreshTokens]);

  return (
    <SimulatorChannelContext.Provider value={contextValue}>
      {children}
      {activeIds.map((chargerId) => {
        const url = canConnect
          ? buildSimulatorSocketUrl(baseUrl, chargerId, accessToken, tenantSchema)
          : null;
        const shouldConnect = canConnect && Boolean(url);
        return (
          <SimulatorSocketBridge
            key={`${chargerId}:${authFingerprint}`}
            chargerId={chargerId}
            url={url}
            shouldConnect={shouldConnect}
            onStatus={(status, error) => handleStatus(chargerId, status, error)}
            notify={(payload) => notifyListeners(chargerId, payload)}
            onUnauthorized={handleUnauthorized}
            authFingerprint={authFingerprint}
          />
        );
      })}
    </SimulatorChannelContext.Provider>
  );
};

export const useSimulatorChannelContext = () => {
  const ctx = useContext(SimulatorChannelContext);
  if (!ctx) {
    throw new Error("useSimulatorChannel must be used within SimulatorChannelProvider");
  }
  return ctx;
};
