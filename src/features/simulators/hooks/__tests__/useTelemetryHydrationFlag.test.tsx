import { renderHook, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTelemetryHydrationFlag } from "../useSimulatorTelemetry";
import { ConnectorTelemetryHistory } from "@/types";

describe("useTelemetryHydrationFlag", () => {
  it("resets hydration flag when telemetry history map changes", () => {
    const mapA = new Map<number, ConnectorTelemetryHistory>();
    mapA.set(1, { connectorId: 1, samples: [] });
    const mapB = new Map<number, ConnectorTelemetryHistory>();
    mapB.set(2, { connectorId: 2, samples: [] });

    const { result, rerender } = renderHook(({ history }) => useTelemetryHydrationFlag(history), {
      initialProps: { history: mapA }
    });

    act(() => {
      result.current.setTelemetryHydrated(true);
    });
    expect(result.current.telemetryHydrated).toBe(true);

    rerender({ history: mapB });
    expect(result.current.telemetryHydrated).toBe(false);
  });
});
