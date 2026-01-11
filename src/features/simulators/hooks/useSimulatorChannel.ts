import { useEffect, useMemo } from "react";
import { WebSocketStatus } from "@/hooks/useWebSocketChannel";
import { useSimulatorChannelContext } from "@/features/simulators/SimulatorChannelProvider";

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

export const useSimulatorChannel = ({
  chargerId,
  enabled = true,
  onEvent
}: UseSimulatorChannelOptions): UseSimulatorChannelResult => {
  const { subscribe, getSnapshot } = useSimulatorChannelContext();

  useEffect(() => {
    if (!enabled || !chargerId) {
      return;
    }
    const unsubscribe = subscribe(chargerId, onEvent);
    return () => {
      unsubscribe();
    };
  }, [chargerId, enabled, onEvent, subscribe]);

  const snapshot = useMemo(
    () => (chargerId ? getSnapshot(chargerId) : undefined),
    [chargerId, getSnapshot]
  );

  return {
    status: snapshot?.status ?? "idle",
    error: snapshot?.error ?? null
  };
};
