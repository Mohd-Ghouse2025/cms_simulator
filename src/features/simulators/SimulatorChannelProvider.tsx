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

type ChannelIntent = "disconnected" | "connecting" | "connected";

type ChannelListener = (event: SimulatorEvent) => void;

type SimulatorChannelContextValue = {
  subscribe: (chargerId: string, listener?: ChannelListener) => () => void;
  getSnapshot: (chargerId: string) => ChannelSnapshot | undefined;
  getIntent: (chargerId: string) => ChannelIntent;
  connect: (chargerId: string) => void;
  disconnect: (chargerId: string) => void;
  forceReconnect: (chargerId: string) => void;
  setDesiredIntent: (chargerId: string, desired: boolean) => void;
  setDisconnectHold: (chargerId: string, hold: boolean) => void;
  getDisconnectHold: (chargerId: string) => boolean;
  /**
   * Bumps whenever the provider clears listeners/activeIds so consumers can resubscribe.
   * Dev-only; omitted from production logs.
   */
  resetEpoch: number;
};

const SimulatorChannelContext = createContext<SimulatorChannelContextValue | null>(null);

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
  registerControls: (
    chargerId: string,
    controls: {
      connect: () => void;
      disconnect: (code?: number, reason?: string) => void;
      forceReconnect: () => void;
    } | null
  ) => void;
};

const SimulatorSocketBridge = ({
  chargerId,
  url,
  shouldConnect,
  onStatus,
  notify,
  onUnauthorized,
  authFingerprint,
  registerControls
}: BridgeProps) => {
  const { status, error, connect, disconnect, forceReconnect } = useWebSocketChannel({
    url,
    shouldConnect,
    autoReconnect: false,
    reconnectDelayMs: 1800,
    heartbeatIntervalMs: 25000,
    onMessage: (event) => notify(parseEventPayload(event)),
    onUnauthorized
  });

  useEffect(() => {
    registerControls(chargerId, { connect, disconnect, forceReconnect });
    return () => registerControls(chargerId, null);
  }, [chargerId, connect, disconnect, forceReconnect, registerControls]);

  useEffect(() => {
    if (shouldConnect) {
      connect();
    } else {
      disconnect();
    }
  }, [connect, disconnect, shouldConnect]);

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
  const HOLD_STORAGE_KEY = "simulator-disconnect-hold";

  const loadHolds = useCallback(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.sessionStorage.getItem(HOLD_STORAGE_KEY);
      if (!raw) return {};
      return JSON.parse(raw) as Record<string, boolean>;
    } catch {
      return {};
    }
  }, []);

  const persistHolds = useCallback((holds: Record<string, boolean>) => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(HOLD_STORAGE_KEY, JSON.stringify(holds));
    } catch {
      // ignore storage failures
    }
  }, []);

  const [snapshots, setSnapshots] = useState<Record<string, ChannelSnapshot>>({});
  const [intentByCharger, setIntentByCharger] = useState<Record<string, ChannelIntent>>({});
  const [desiredByCharger, setDesiredByCharger] = useState<Record<string, boolean>>({});
  const [disconnectHoldByCharger, setDisconnectHoldByCharger] = useState<Record<string, boolean>>(() => loadHolds());
  const [resetEpoch, setResetEpoch] = useState(0);
  const listenersRef = useRef<Map<string, Set<ChannelListener>>>(new Map());
  const activeIdsRef = useRef<string[]>([]);
  const bridgeControlsRef = useRef<
    Record<
      string,
      {
        connect: () => void;
        disconnect: (code?: number, reason?: string) => void;
        forceReconnect: () => void;
      }
    >
  >({});
  const prevCanConnectRef = useRef<boolean>(canConnect);
  const prevAuthRef = useRef<boolean>(isAuthenticated);
  const lastTenantRef = useRef<string | null>(tenantSchema ?? null);
  const lastDesiredRef = useRef<Record<string, boolean>>({});

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

      setIntentByCharger((prev) => {
        const current = prev[chargerId] ?? "disconnected";
        if (status === "open" && current !== "connected") {
          return { ...prev, [chargerId]: "connected" };
        }
        if (status === "connecting" && current !== "connecting") {
          return { ...prev, [chargerId]: "connecting" };
        }
        return prev;
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

  const getIntent = useCallback(
    (chargerId: string) => intentByCharger[chargerId] ?? "disconnected",
    [intentByCharger]
  );

  const scopedKey = useCallback(
    (chargerId: string) => `${tenantSchema ?? ""}:${chargerId}`,
    [tenantSchema]
  );

  const setDisconnectHold = useCallback(
    (chargerId: string, hold: boolean) => {
      if (!chargerId) return;
      setDisconnectHoldByCharger((prev) => {
        const key = scopedKey(chargerId);
        if (prev[key] === hold) return prev;
        const next = { ...prev };
        if (hold) {
          next[key] = true;
        } else {
          delete next[key];
        }
        persistHolds(next);
        return next;
      });
    },
    [persistHolds, scopedKey]
  );

  const getDisconnectHold = useCallback(
    (chargerId: string) => {
      if (!chargerId) return false;
      return Boolean(disconnectHoldByCharger[scopedKey(chargerId)]);
    },
    [disconnectHoldByCharger, scopedKey]
  );

  const connect = useCallback((chargerId: string) => {
    if (!chargerId) return;
    setIntentByCharger((prev) => ({ ...prev, [chargerId]: "connecting" }));
    setSnapshots((prev) => ({
      ...prev,
      [chargerId]: prev[chargerId] ?? { status: "idle", error: null, lastMessageAt: null }
    }));
    bridgeControlsRef.current[chargerId]?.connect();
  }, []);

  const disconnect = useCallback((chargerId: string) => {
    if (!chargerId) return;
    setIntentByCharger((prev) => ({ ...prev, [chargerId]: "disconnected" }));
    setSnapshots((prev) => {
      const existing = prev[chargerId];
      if (!existing) return prev;
      return {
        ...prev,
        [chargerId]: { ...existing, status: "closed", lastMessageAt: null }
      };
    });
    bridgeControlsRef.current[chargerId]?.disconnect(1000, "manual-disconnect");
  }, []);

  const forceReconnect = useCallback((chargerId: string) => {
    if (!chargerId) return;
    setIntentByCharger((prev) => ({ ...prev, [chargerId]: "connecting" }));
    setSnapshots((prev) => ({
      ...prev,
      [chargerId]: prev[chargerId] ?? { status: "idle", error: null, lastMessageAt: null }
    }));
    bridgeControlsRef.current[chargerId]?.forceReconnect();
  }, []);

  const setDesiredIntent = useCallback((chargerId: string, desired: boolean) => {
    if (!chargerId) return;
    setDesiredByCharger((prev) => {
      if (prev[chargerId] === desired) {
        return prev;
      }
      return { ...prev, [chargerId]: desired };
    });
  }, []);

  useEffect(() => {
    // Apply connect/disconnect only on transitions to avoid storms.
    Object.entries(desiredByCharger).forEach(([chargerId, desired]) => {
      const prev = lastDesiredRef.current[chargerId];
      if (prev === desired) return;
      lastDesiredRef.current[chargerId] = desired;
      if (desired) {
        connect(chargerId);
      } else {
        disconnect(chargerId);
      }
    });
    // Handle removals: if an entry was present previously but now absent, treat as desired=false.
    Object.keys(lastDesiredRef.current).forEach((chargerId) => {
      if (!(chargerId in desiredByCharger)) {
        if (lastDesiredRef.current[chargerId]) {
          disconnect(chargerId);
        }
        delete lastDesiredRef.current[chargerId];
      }
    });
  }, [desiredByCharger, connect, disconnect]);

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
    bridgeControlsRef.current = {};
    setDesiredByCharger({});
    setIntentByCharger({});
    setSnapshots({});
    setDisconnectHoldByCharger({});
    persistHolds({});
    setResetEpoch((prev) => prev + 1);
  }, [persistHolds]);

  useEffect(() => {
    const activeIds = Object.entries(intentByCharger)
      .filter(([, intent]) => intent !== "disconnected")
      .map(([id]) => id);
    activeIdsRef.current = activeIds;
    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
      // eslint-disable-next-line no-console
      console.debug("[simulator][provider][activeIds]", {
        ts: new Date().toISOString(),
        activeIds
      });
    }
  }, [intentByCharger]);

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

  useEffect(
    () => () => {
      resetAll("unmount");
    },
    [resetAll]
  );

  const contextValue = useMemo<SimulatorChannelContextValue>(
    () => ({
      subscribe,
      getSnapshot,
      getIntent,
      connect,
      disconnect,
      forceReconnect,
      setDesiredIntent,
      setDisconnectHold,
      getDisconnectHold,
      resetEpoch
    }),
    [
      subscribe,
      getSnapshot,
      getIntent,
      connect,
      disconnect,
      forceReconnect,
      setDesiredIntent,
      setDisconnectHold,
      getDisconnectHold,
      resetEpoch
    ]
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
      {Object.entries(intentByCharger)
        .filter(([, intent]) => intent !== "disconnected")
        .map(([chargerId, intent]) => {
          const url = canConnect
            ? buildSimulatorSocketUrl(baseUrl, chargerId, accessToken, tenantSchema)
            : null;
          const shouldConnect = canConnect && Boolean(url) && intent !== "disconnected";
          return (
            <SimulatorSocketBridge
              key={`${tenantSchema ?? "tenant"}:${chargerId}`}
              chargerId={chargerId}
              url={url}
              shouldConnect={shouldConnect}
              onStatus={(status, error) => handleStatus(chargerId, status, error)}
              notify={(payload) => notifyListeners(chargerId, payload)}
              onUnauthorized={handleUnauthorized}
              authFingerprint={authFingerprint}
              registerControls={(id, controls) => {
                if (!controls) {
                  delete bridgeControlsRef.current[id];
                  return;
                }
                bridgeControlsRef.current[id] = controls;
              }}
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
