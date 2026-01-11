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
  onStatus: (status: WebSocketStatus, error: Event | null) => void;
  notify: (payload: SimulatorEvent) => void;
  onUnauthorized: () => void;
};

const SimulatorSocketBridge = ({
  chargerId,
  url,
  onStatus,
  notify,
  onUnauthorized
}: BridgeProps) => {
  const { status, error } = useWebSocketChannel({
    url,
    shouldConnect: Boolean(url),
    autoReconnect: true,
    onMessage: (event) => notify(parseEventPayload(event)),
    onUnauthorized
  });

  useEffect(() => {
    onStatus(status, error);
  }, [status, error, onStatus]);

  return null;
};

export const SimulatorChannelProvider = ({ children }: { children: ReactNode }) => {
  const { baseUrl, tokens, tenant, logout } = useTenantAuth();
  const accessToken = tokens?.access ?? null;
  const tenantSchema = tenant ?? null;

  const [snapshots, setSnapshots] = useState<Record<string, ChannelSnapshot>>({});
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const listenersRef = useRef<Map<string, Set<ChannelListener>>>(new Map());

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
      setActiveIds([chargerId]);
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
  }, []);

  useEffect(() => {
    if (!accessToken || !baseUrl || !tenantSchema) {
      resetAll();
    }
  }, [accessToken, baseUrl, tenantSchema, resetAll]);

  const contextValue = useMemo<SimulatorChannelContextValue>(
    () => ({
      subscribe,
      getSnapshot
    }),
    [subscribe, getSnapshot]
  );

  return (
    <SimulatorChannelContext.Provider value={contextValue}>
      {children}
      {activeIds.map((chargerId) => (
        <SimulatorSocketBridge
          key={chargerId}
          chargerId={chargerId}
          url={buildSimulatorSocketUrl(baseUrl, chargerId, accessToken, tenantSchema)}
          onStatus={(status, error) => handleStatus(chargerId, status, error)}
          notify={(payload) => notifyListeners(chargerId, payload)}
          onUnauthorized={() => logout({ reason: "expired" })}
        />
      ))}
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
