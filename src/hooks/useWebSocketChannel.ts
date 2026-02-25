import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type WebSocketStatus =
  | "idle"
  | "connecting"
  | "open"
  | "closed"
  | "error";

type OnUnauthorizedResult = boolean | void | Promise<boolean | void>;

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
  onUnauthorized?: () => OnUnauthorizedResult;
};

const comparableUrl = (value: string | null): string | null => {
  if (!value) return value;
  try {
    const parsed = new URL(value);
    parsed.searchParams.delete("token");
    parsed.searchParams.delete("access");
    parsed.searchParams.delete("access_token");
    const query = parsed.searchParams.toString();
    parsed.search = query ? `?${query}` : "";
    return parsed.toString();
  } catch {
    return value;
  }
};

const isCloseEvent = (event: Event | CloseEvent): event is CloseEvent =>
  typeof (event as CloseEvent).code === "number";

export const useWebSocketChannel = ({
  url,
  shouldConnect = false,
  protocols,
  autoReconnect = false,
  reconnectDelayMs = 3000,
  maxReconnectDelayMs,
  onMessage,
  heartbeatIntervalMs,
  onUnauthorized
}: UseWebSocketChannelOptions) => {
  void autoReconnect;
  void reconnectDelayMs;
  void maxReconnectDelayMs;
  const [status, setStatus] = useState<WebSocketStatus>("idle");
  const [lastMessage, setLastMessage] = useState<unknown>(null);
  const [error, setError] = useState<Event | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const connectRef = useRef<() => void>(() => {});
  const manualCloseRef = useRef(false);
  const messageHandlerRef = useRef<typeof onMessage>(onMessage);
  const unauthorizedHandlerRef = useRef<typeof onUnauthorized>(onUnauthorized);
  const lastUrlRef = useRef<string | null>(null);
  const lastComparableUrlRef = useRef<string | null>(null);
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

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimer.current) {
      window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    // Manual mode: no automatic reconnect attempts
    return;
  }, []);

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

  const disposeSocket = useCallback(
    (code = 1000, reason?: string) => {
      const socket = socketRef.current;
      if (!socket) {
        return;
      }
      manualCloseRef.current = true;

      // In React 18 StrictMode, effects mount/cleanup twice. Closing a socket
      // while it is still CONNECTING triggers noisy "closed before the connection
      // is established" errors in the console. Defer the close until after the
      // handshake completes to keep dev tools quiet without leaking the socket.
      if (socket.readyState === WebSocket.CONNECTING) {
        const abort = () => {
          try {
            socket.close(code, reason);
          } catch {
            /* ignore close races */
          }
        };
        socket.addEventListener("open", abort, { once: true });
        socket.addEventListener("error", abort, { once: true });
        socketRef.current = null;
        return;
      }

      try {
        socket.close(code, reason);
      } catch {
        // ignored — attempting to close already closed socket
      }
      socketRef.current = null;
      clearHeartbeat();
      clearReconnectTimer();
      setStatus("closed");
    },
    [clearHeartbeat, clearReconnectTimer]
  );

  const connect = useCallback(() => {
    if (!url || !shouldConnect) {
      return;
    }
    const existing = socketRef.current;
    const nextComparableUrl = comparableUrl(url);
    if (existing) {
      const isActive =
        existing.readyState === WebSocket.CONNECTING || existing.readyState === WebSocket.OPEN;
      if (isActive) {
        const existingComparable = comparableUrl(existing.url);
        if (existingComparable === nextComparableUrl) {
          lastUrlRef.current = url;
          lastComparableUrlRef.current = existingComparable;
          return;
        }
      }
      if (isActive && existing.url === url) {
        return;
      }
      if (isActive && existing.readyState === WebSocket.CONNECTING && existing.url !== url) {
        // Avoid aborting an in-flight handshake; let it settle and rely on natural reconnect.
        if (process.env.NODE_ENV !== "production") {
          console.debug(`[ws:${connectionIdRef.current}] url changed during CONNECTING; letting socket finish`, {
            from: existing.url,
            to: url
          });
        }
        return;
      }
      if (isActive && existing.url !== url) {
        if (process.env.NODE_ENV !== "production") {
          console.debug(`[ws:${connectionIdRef.current}] closing for url change`, {
            from: existing.url,
            to: url
          });
        }
        existing.onclose = null;
        existing.onopen = null;
        existing.onerror = null;
        existing.onmessage = null;
        try {
          existing.close(1000, "reconnect:url-changed");
        } catch {
          // ignore close errors
        }
        socketRef.current = null;
      }
    }
    try {
      manualCloseRef.current = false;
      clearReconnectTimer();
      setStatus("connecting");
      setError(null);
      // Prefer native WebSocket; browsers like Safari sometimes keep a stale
      // TCP connection alive after a devtools reload. Force a new connection
      // by constructing with a fresh URL object (adds no-op search param when
      // token is present) to avoid sharing cached handshake state.
      const freshUrl = new URL(url);
      if (freshUrl.searchParams.has("token")) {
        freshUrl.searchParams.set("_ts", Date.now().toString());
      }
      const socket = new WebSocket(freshUrl.toString(), protocols);
      socketRef.current = socket;
      lastUrlRef.current = url;
      lastComparableUrlRef.current = nextComparableUrl;
      socket.onopen = () => {
        setStatus("open");
        startHeartbeat();
        if (process.env.NODE_ENV !== "production") {
          console.debug(`[ws:${connectionIdRef.current}] open ${url}`);
        }
      };
      const triggerUnauthorizedReconnect = () => {
        unauthorizedHandlerRef.current?.();
      };
      socket.onerror = (event) => {
        setStatus("error");
        setError(event);
        clearHeartbeat();
        if (process.env.NODE_ENV !== "production") {
          console.debug(`[ws:${connectionIdRef.current}] error ${url}`, event);
        }
        // Handshake failures (HTTP 403/4401) surface only as `error` in browsers,
        // so proactively treat any error as potentially auth-related and trigger
        // the unauthorized handler to refresh tokens before reconnecting.
        triggerUnauthorizedReconnect();
      };
      socket.onclose = (event) => {
        socketRef.current = null;
        if (process.env.NODE_ENV !== "production") {
          console.debug(
            `[ws:${connectionIdRef.current}] close code=${isCloseEvent(event) ? event.code : "n/a"} reason=${isCloseEvent(event) ? event.reason : ""} manual=${manualCloseRef.current} url=${url ?? lastUrlRef.current ?? ""}`
          );
        }
        setError(event);
        setStatus("closed");
        clearHeartbeat();
        if (manualCloseRef.current) {
          manualCloseRef.current = false;
          return;
        }
        // manual mode: do not auto-reconnect
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
    }
  }, [protocols, shouldConnect, url, clearReconnectTimer, startHeartbeat]);

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
      clearHeartbeat();
      setStatus("idle");
      return undefined;
    }
    return () => {
      clearReconnectTimer();
      clearHeartbeat();
      disposeSocket();
    };
  }, [clearReconnectTimer, clearHeartbeat, disposeSocket, shouldConnect, url]);

  // Ensure sockets are closed on unmount regardless of shouldConnect state.
  useEffect(() => () => disposeSocket(), [disposeSocket]);

  return useMemo(
    () => ({
      status,
      lastMessage,
      send,
      error,
      connect,
      disconnect: disposeSocket
    }),
    [connect, disposeSocket, error, lastMessage, send, status]
  );
};
