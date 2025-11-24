import { useCallback, useMemo } from "react";
import { useTenantAuth } from "@/features/auth/useTenantAuth";
import { useWebSocketChannel, WebSocketStatus } from "@/hooks/useWebSocketChannel";

type SimulatorEvent = {
  type?: string;
  [key: string]: unknown;
};

type UseSimulatorChannelOptions = {
  chargerId?: string | null;
  enabled?: boolean;
  onEvent?: (event: SimulatorEvent) => void;
};

type UseSimulatorChannelResult = {
  status: WebSocketStatus;
  error: Event | null;
};

const buildWebSocketUrl = (
  baseUrl: string,
  chargerId: string,
  token?: string | null,
  tenantSchema?: string | null
): string | null => {
  if (!baseUrl) {
    return null;
  }
  try {
    const url = new URL(baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const basePath = url.pathname.replace(/\/$/, "");
    url.pathname = `${basePath}/ws/ocpp-sim/${encodeURIComponent(chargerId)}/`;
    const params = new URLSearchParams();
    if (tenantSchema) {
      params.set("tenant_schema", tenantSchema);
    }
    if (token) {
      params.set("token", token);
    }
    const query = params.toString();
    url.search = query ? `?${query}` : "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
};

export const useSimulatorChannel = ({
  chargerId,
  enabled = true,
  onEvent
}: UseSimulatorChannelOptions): UseSimulatorChannelResult => {
  const { baseUrl, logout, tokens, tenant } = useTenantAuth();
  const accessToken = tokens?.access ?? null;

  const socketUrl = useMemo(() => {
    if (!chargerId) {
      return null;
    }
    return buildWebSocketUrl(baseUrl, chargerId, accessToken, tenant ?? null);
  }, [accessToken, baseUrl, chargerId, tenant]);

  const handleMessage = useCallback(
    (event: MessageEvent<unknown>) => {
      if (!onEvent) {
        return;
      }
      const payload = event.data;
      if (typeof payload === "string") {
        try {
          onEvent(JSON.parse(payload) as SimulatorEvent);
        } catch {
          onEvent({ type: "log.entry", message: payload, level: "info" });
        }
        return;
      }
      if (typeof payload === "object" && payload !== null) {
        onEvent(payload as SimulatorEvent);
      }
    },
    [onEvent]
  );

  const { status, error } = useWebSocketChannel({
    url: socketUrl,
    shouldConnect: enabled && Boolean(socketUrl),
    autoReconnect: true,
    onMessage: handleMessage,
    onUnauthorized: () => logout({ reason: "expired" })
  });

  return { status, error };
};
