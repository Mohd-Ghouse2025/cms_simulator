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
};

type ChannelListener = (event: SimulatorEvent) => void;

type SimulatorChannelContextValue = {
  subscribe: (chargerId: string, listener?: ChannelListener) => () => void;
  getSnapshot: (chargerId: string) => ChannelSnapshot | undefined;
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
};

const SimulatorSocketBridge = ({
  chargerId,
  url,
  shouldConnect,
  onStatus,
  notify,
  onUnauthorized
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

  return null;
};

export const SimulatorChannelProvider = ({ children }: { children: ReactNode }) => {
  const { baseUrl, tokens, tenant, logout, refreshTokens, isAuthenticated, hydrated } = useTenantAuth();
  const accessToken = tokens?.access ?? null;
  const tenantSchema = tenant ?? null;
  const canConnect = hydrated && isAuthenticated && Boolean(accessToken && tenantSchema && baseUrl);

  const [snapshots, setSnapshots] = useState<Record<string, ChannelSnapshot>>({});
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const listenersRef = useRef<Map<string, Set<ChannelListener>>>(new Map());
  const hydratedLastRef = useRef(false);

  const handleStatus = useCallback(
    (chargerId: string, status: WebSocketStatus, error: Event | null) => {
      setSnapshots((prev) => {
        const existing = prev[chargerId];
        if (existing?.status === status && existing?.error === error) {
          return prev;
        }
        return { ...prev, [chargerId]: { status, error } };
      });
    },
    []
  );

  const notifyListeners = useCallback((chargerId: string, payload: SimulatorEvent) => {
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
      setActiveIds((prev) => (prev.includes(chargerId) ? prev : [...prev, chargerId]));
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
    []
  );

  const getSnapshot = useCallback(
    (chargerId: string) => snapshots[chargerId],
    [snapshots]
  );

  const resetAll = useCallback(() => {
    listenersRef.current.clear();
    setActiveIds([]);
    setSnapshots({});
    hydratedLastRef.current = false;
    try {
      window.localStorage.removeItem(LAST_CHARGER_KEY);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!canConnect) {
      resetAll();
    }
  }, [canConnect, resetAll]);

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
      getSnapshot
    }),
    [subscribe, getSnapshot]
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
            key={chargerId}
            chargerId={chargerId}
            url={url}
            shouldConnect={shouldConnect}
            onStatus={(status, error) => handleStatus(chargerId, status, error)}
            notify={(payload) => notifyListeners(chargerId, payload)}
            onUnauthorized={handleUnauthorized}
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
