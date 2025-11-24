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
  onMessage?: (data: MessageEvent<unknown>) => void;
  onUnauthorized?: () => void;
};

const AUTH_CLOSE_CODES = new Set([4001, 4003, 4400, 4401, 4403]);
const MIN_RECONNECT_DELAY = 1000;

const isCloseEvent = (event: Event | CloseEvent): event is CloseEvent =>
  typeof (event as CloseEvent).code === "number";

const isUnauthorizedEvent = (event: Event | CloseEvent): boolean => {
  if (!isCloseEvent(event)) {
    return false;
  }
  if (AUTH_CLOSE_CODES.has(event.code) || event.code === 1008) {
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
  onUnauthorized
}: UseWebSocketChannelOptions) => {
  const [status, setStatus] = useState<WebSocketStatus>("idle");
  const [lastMessage, setLastMessage] = useState<unknown>(null);
  const [error, setError] = useState<Event | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const connectRef = useRef<() => void>(() => {});
  const manualCloseRef = useRef(false);
  const messageHandlerRef = useRef<typeof onMessage>();
  const unauthorizedHandlerRef = useRef<typeof onUnauthorized>();
  const reconnectDelayRef = useRef(Math.max(reconnectDelayMs ?? MIN_RECONNECT_DELAY, MIN_RECONNECT_DELAY));
  const baseDelay = Math.max(reconnectDelayMs ?? MIN_RECONNECT_DELAY, MIN_RECONNECT_DELAY);
  const maxDelay = Math.max(
    maxReconnectDelayMs ?? baseDelay * 8,
    baseDelay
  );

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
    const delay = Math.min(reconnectDelayRef.current ?? baseDelay, maxDelay);
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
      };
      socket.onerror = (event) => {
        setStatus("error");
        setError(event);
      };
      socket.onclose = (event) => {
        socketRef.current = null;
        setStatus("closed");
        if (manualCloseRef.current) {
          manualCloseRef.current = false;
          return;
        }
        if (isUnauthorizedEvent(event)) {
          unauthorizedHandlerRef.current?.();
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
      setStatus("idle");
      return undefined;
    }
    connect();
    return () => {
      clearReconnectTimer();
      disposeSocket();
    };
  }, [clearReconnectTimer, connect, disposeSocket, shouldConnect, url]);

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
