import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type WebSocketStatus =
  | "idle"
  | "connecting"
  | "open"
  | "closed"
  | "error";

type UseWebSocketChannelOptions = {
  url: string | null;
  shouldConnect?: boolean;
  protocols?: string | string[];
  autoReconnect?: boolean;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  /** optional keep-alive interval in ms; when provided we send a light ping frame */
  heartbeatIntervalMs?: number;
  onMessage?: (data: MessageEvent<unknown>) => void;
  onUnauthorized?: () => void | boolean | Promise<void | boolean>;
};

const AUTH_CLOSE_CODES = new Set([4001, 4003, 4400, 4401, 4403]);
const MIN_RECONNECT_DELAY = 1000;
const JITTER_RATIO = 0.35;

const isCloseEvent = (event: Event | CloseEvent): event is CloseEvent =>
  typeof (event as CloseEvent).code === "number";

const isUnauthorizedEvent = (event: Event | CloseEvent): boolean => {
  if (!isCloseEvent(event)) {
    return false;
  }
  if (AUTH_CLOSE_CODES.has(event.code) || event.code === 1008 || event.code === 403) {
    return true;
  }
  const reason = (event.reason ?? "").toLowerCase();
  return reason.includes("auth") || reason.includes("token");
};

export const useWebSocketChannel = ({
  url,
  shouldConnect = true,
  protocols,
  autoReconnect = true,
  reconnectDelayMs = 3000,
  maxReconnectDelayMs,
  onMessage,
  heartbeatIntervalMs,
  onUnauthorized
}: UseWebSocketChannelOptions) => {
  const [status, setStatus] = useState<WebSocketStatus>("idle");
  const [lastMessage, setLastMessage] = useState<unknown>(null);
  const [error, setError] = useState<Event | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const connectRef = useRef<() => void>(() => {});
  const manualCloseRef = useRef(false);
  const messageHandlerRef = useRef<typeof onMessage>(onMessage);
  const unauthorizedHandlerRef = useRef<typeof onUnauthorized>(onUnauthorized);
  const reconnectDelayRef = useRef(Math.max(reconnectDelayMs ?? MIN_RECONNECT_DELAY, MIN_RECONNECT_DELAY));
  const baseDelay = Math.max(reconnectDelayMs ?? MIN_RECONNECT_DELAY, MIN_RECONNECT_DELAY);
  const maxDelay = Math.max(
    maxReconnectDelayMs ?? baseDelay * 10,
    baseDelay
  );
  const heartbeatTimerRef = useRef<number | null>(null);
  const connectionIdRef = useRef<string>("");
  if (!connectionIdRef.current) {
    try {
      const cryptoApi = typeof crypto !== "undefined" ? crypto : null;
      connectionIdRef.current = cryptoApi?.randomUUID?.() ?? `ws-${Date.now()}`;
    } catch {
      connectionIdRef.current = `ws-${Date.now()}`;
    }
  }

  useEffect(() => {
    messageHandlerRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    unauthorizedHandlerRef.current = onUnauthorized;
  }, [onUnauthorized]);

  useEffect(() => {
    reconnectDelayRef.current = baseDelay;
  }, [baseDelay]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimer.current) {
      window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (!autoReconnect || reconnectTimer.current || !shouldConnect) {
      return;
    }
    const delayBase = Math.min(reconnectDelayRef.current ?? baseDelay, maxDelay);
    const jitter = delayBase * JITTER_RATIO;
    const delay = Math.max(0, delayBase + (Math.random() * jitter * 2 - jitter));
    reconnectTimer.current = window.setTimeout(() => {
      reconnectTimer.current = null;
      reconnectDelayRef.current = Math.min(delay * 2, maxDelay);
      connectRef.current();
    }, delay);
  }, [autoReconnect, baseDelay, maxDelay, shouldConnect]);

  const disposeSocket = useCallback(
    (code = 1000, reason?: string) => {
      if (!socketRef.current) {
        return;
      }
      manualCloseRef.current = true;
      try {
        socketRef.current.close(code, reason);
      } catch {
        // ignored — attempting to close already closed socket
      }
    },
    []
  );

  const connect = useCallback(() => {
    if (!url || !shouldConnect) {
      return;
    }
    const existing = socketRef.current;
    if (
      existing &&
      existing.url === url &&
      (existing.readyState === WebSocket.CONNECTING || existing.readyState === WebSocket.OPEN)
    ) {
      return;
    }
    try {
      manualCloseRef.current = false;
      clearReconnectTimer();
      setStatus("connecting");
      setError(null);
      const socket = new WebSocket(url, protocols);
      socketRef.current = socket;
      socket.onopen = () => {
        reconnectDelayRef.current = baseDelay;
        setStatus("open");
        if (process.env.NODE_ENV !== "production") {
          console.debug(`[ws:${connectionIdRef.current}] open ${url}`);
        }
      };
      socket.onerror = (event) => {
        setStatus("error");
        setError(event);
        if (process.env.NODE_ENV !== "production") {
          console.debug(`[ws:${connectionIdRef.current}] error ${url}`, event);
        }
      };
      socket.onclose = (event) => {
        socketRef.current = null;
        if (process.env.NODE_ENV !== "production") {
          console.debug(
            `[ws:${connectionIdRef.current}] close code=${isCloseEvent(event) ? event.code : "n/a"} reason=${isCloseEvent(event) ? event.reason : ""}`
          );
        }
        setStatus("closed");
        if (manualCloseRef.current) {
          manualCloseRef.current = false;
          return;
        }
        const triggerReconnect = () => {
          if (manualCloseRef.current) {
            manualCloseRef.current = false;
            return;
          }
          scheduleReconnect();
        };
        if (isUnauthorizedEvent(event)) {
          const outcome = unauthorizedHandlerRef.current?.();
          if (outcome && typeof (outcome as Promise<unknown>).then === "function") {
            (outcome as Promise<unknown>)
              .then((shouldReconnect) => {
                if (shouldReconnect === false) {
                  return;
                }
                triggerReconnect();
              })
              .catch(() => triggerReconnect());
          } else if (outcome !== false) {
            triggerReconnect();
          }
          return;
        }
        scheduleReconnect();
      };
      socket.onmessage = (event) => {
        if (event.data) {
          try {
            setLastMessage(JSON.parse(String(event.data)));
          } catch {
            setLastMessage(event.data);
          }
        } else {
          setLastMessage(null);
        }
        messageHandlerRef.current?.(event as MessageEvent<unknown>);
      };
    } catch (err) {
      console.error("WebSocket connection failed", err);
      setStatus("error");
      scheduleReconnect();
    }
  }, [baseDelay, protocols, scheduleReconnect, shouldConnect, url, clearReconnectTimer]);

  connectRef.current = connect;

  const clearHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    clearHeartbeat();
    if (!heartbeatIntervalMs || heartbeatIntervalMs <= 0) {
      return;
    }
    heartbeatTimerRef.current = window.setInterval(() => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        try {
          socketRef.current.send(JSON.stringify({ action: "ping", ts: Date.now() }));
          if (process.env.NODE_ENV !== "production") {
            console.debug(`[ws:${connectionIdRef.current}] ping`);
          }
        } catch {
          // ignore send failures; close handler will trigger reconnect
        }
      }
    }, Math.max(heartbeatIntervalMs, 5000));
  }, [clearHeartbeat, heartbeatIntervalMs]);

  const send = useCallback(
    (payload: unknown) => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify(payload));
      } else {
        throw new Error("WebSocket is not connected");
      }
    },
    []
  );

  useEffect(() => {
    if (!url || !shouldConnect) {
      disposeSocket();
      clearReconnectTimer();
      clearHeartbeat();
      setStatus("idle");
      return undefined;
    }
    connect();
    startHeartbeat();
    return () => {
      clearReconnectTimer();
      clearHeartbeat();
      disposeSocket();
    };
  }, [clearReconnectTimer, clearHeartbeat, connect, disposeSocket, shouldConnect, startHeartbeat, url]);

  return useMemo(
    () => ({
      status,
      lastMessage,
      send,
      error
    }),
    [error, lastMessage, send, status]
  );
};
