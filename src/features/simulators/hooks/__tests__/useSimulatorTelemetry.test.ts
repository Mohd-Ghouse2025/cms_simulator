import { describe, expect, it } from "vitest";
import {
  chooseStartedAtForTx,
  hasTransactionChanged,
  isRuntimeStaleForRestSamples,
  buildReconciledSession
} from "../useSimulatorTelemetry";
import { type SessionRuntime } from "../../types/detail";

describe("hasTransactionChanged", () => {
  it("returns false when both transactions are empty", () => {
    expect(hasTransactionChanged(null, null)).toBe(false);
    expect(hasTransactionChanged(undefined, undefined)).toBe(false);
  });

  it("detects change when existing is missing and incoming is present", () => {
    expect(hasTransactionChanged(null, "tx-1")).toBe(true);
  });

  it("detects change when existing is present and incoming is missing", () => {
    expect(hasTransactionChanged("tx-1", null)).toBe(true);
  });

  it("detects change when both are present and different", () => {
    expect(hasTransactionChanged("tx-1", "tx-2")).toBe(true);
  });

  it("returns false when both are present and equal", () => {
    expect(hasTransactionChanged("tx-1", "tx-1")).toBe(false);
  });
});

describe("isRuntimeStaleForRestSamples", () => {
  const baseRuntime: SessionRuntime = {
    connectorId: 1,
    state: "charging",
    activeSession: true,
    meterStartWh: 1000,
    meterStopWh: 1000
  };

  it("returns true when runtime missing", () => {
    expect(
      isRuntimeStaleForRestSamples({
        runtime: undefined,
        runtimeLastSampleTs: null,
        existingLastSampleTs: null,
        latestSampleTs: Date.now(),
        staleThreshold: 5000
      })
    ).toBe(true);
  });

  it("returns true when latest sample is newer than runtime beyond threshold", () => {
    const now = Date.now();
    expect(
      isRuntimeStaleForRestSamples({
        runtime: baseRuntime,
        runtimeLastSampleTs: now - 20_000,
        existingLastSampleTs: null,
        latestSampleTs: now,
        staleThreshold: 5000
      })
    ).toBe(true);
  });

  it("returns false when runtime is fresh", () => {
    const now = Date.now();
    expect(
      isRuntimeStaleForRestSamples({
        runtime: baseRuntime,
        runtimeLastSampleTs: now - 1000,
        existingLastSampleTs: null,
        latestSampleTs: now,
        staleThreshold: 5000
      })
    ).toBe(false);
  });

  it("does not treat preparing as stale", () => {
    const now = Date.now();
    expect(
      isRuntimeStaleForRestSamples({
        runtime: { ...baseRuntime, state: "preparing" },
        runtimeLastSampleTs: now - 1500,
        existingLastSampleTs: null,
        latestSampleTs: now,
        staleThreshold: 5000
      })
    ).toBe(false);
  });
});

describe("buildReconciledSession", () => {
  const runtime: SessionRuntime = {
    connectorId: 1,
    state: "charging",
    activeSession: true,
    meterStartWh: 1000,
    meterStopWh: 1200,
    transactionId: "tx-1",
    lastSampleAt: new Date(Date.now() - 10_000).toISOString()
  };

  it("marks completed and preserves monotonic meter values", () => {
    const reconciled = buildReconciledSession(runtime, {
      connectorId: 1,
      tx: "tx-1",
      meterStopWh: 1100,
      completedAt: new Date().toISOString(),
      finalSample: null
    });
    expect(reconciled.state).toBe("completed");
    expect(reconciled.meterStopWh).toBe(1200); // clamps to existing higher value
    expect(reconciled.isFinal).toBe(true);
    expect(reconciled.activeSession).toBe(false);
  });

  it("keeps anchor/duration by preserving lastSampleAt when completedAt absent", () => {
    const reconciled = buildReconciledSession(runtime, {
      connectorId: 1,
      tx: "tx-1",
      meterStopWh: 1300,
      completedAt: null,
      finalSample: {
        connectorId: 1,
        timestamp: runtime.lastSampleAt ? Date.parse(runtime.lastSampleAt) + 5000 : Date.now(),
        isoTimestamp: runtime.lastSampleAt ? new Date(Date.parse(runtime.lastSampleAt) + 5000).toISOString() : new Date().toISOString(),
        valueWh: 1300,
        powerKw: 0,
        currentA: 0,
        energyKwh: 1.3
      }
    });
    expect(reconciled.lastSampleAt).not.toBeNull();
  });
});

describe("chooseStartedAtForTx", () => {
  it("prefers candidate when tx changed", () => {
    expect(chooseStartedAtForTx("2024-01-01T00:00:00Z", "2024-02-01T00:00:00Z", false)).toBe("2024-02-01T00:00:00Z");
  });

  it("keeps earliest when same tx", () => {
    expect(
      chooseStartedAtForTx("2024-02-01T00:00:00Z", "2024-03-01T00:00:00Z", true)
    ).toBe("2024-02-01T00:00:00Z");
  });

  it("uses candidate when existing is missing for same tx", () => {
    expect(chooseStartedAtForTx(undefined, "2024-03-01T00:00:00Z", true)).toBe("2024-03-01T00:00:00Z");
  });
});
