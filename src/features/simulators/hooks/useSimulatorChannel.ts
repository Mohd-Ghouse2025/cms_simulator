import { useEffect, useMemo } from "react";
import { WebSocketStatus } from "@/hooks/useWebSocketChannel";
import { useSimulatorChannelContext } from "@/features/simulators/SimulatorChannelProvider";
import { useRef, useCallback } from "react";

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
  lastMessageAt: number | null;
  intent: "disconnected" | "connecting" | "connected";
  connect: () => void;
  disconnect: () => void;
};

export const useSimulatorChannel = ({
  chargerId,
  enabled = true,
  onEvent
}: UseSimulatorChannelOptions): UseSimulatorChannelResult => {
  const { subscribe, getSnapshot, getIntent, connect, disconnect, resetEpoch } = useSimulatorChannelContext();
  const listenerRef = useRef<typeof onEvent>(onEvent);

  // Always forward to the latest handler without resubscribing the socket listener.
  useEffect(() => {
    listenerRef.current = onEvent;
  }, [onEvent]);

  const stableListener = useCallback(
    (event: SimulatorEvent) => {
      listenerRef.current?.(event);
    },
    []
  );

  useEffect(() => {
    if (!enabled || !chargerId) {
      return;
    }
    const unsubscribe = subscribe(chargerId, stableListener);
    return () => {
      unsubscribe();
    };
    // resetEpoch lets us resubscribe after provider resets listeners/activeIds
  }, [chargerId, enabled, stableListener, subscribe, resetEpoch]);

  const snapshot = useMemo(
    () => (chargerId ? getSnapshot(chargerId) : undefined),
    [chargerId, getSnapshot]
  );

  return {
    status: snapshot?.status ?? "idle",
    error: snapshot?.error ?? null,
    lastMessageAt: snapshot?.lastMessageAt ?? null,
    intent: chargerId ? getIntent(chargerId) : "disconnected",
    connect: () => {
      if (chargerId) connect(chargerId);
    },
    disconnect: () => {
      if (chargerId) disconnect(chargerId);
    }
  };
};
