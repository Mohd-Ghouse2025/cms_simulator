import { describe, expect, it } from "vitest";
import { chooseStartedAtForTx, migrateNoTxAnchorValue } from "../useSimulatorTelemetry";

const anchorKey = (connectorId: number, tx?: string | null) => `${connectorId}:${tx ?? "no-tx"}`;

describe("useSimulatorTelemetry anchor helpers", () => {
  it("uses incoming start time when transaction changes", () => {
    const existingStart = "2026-02-18T10:00:00Z";
    const incomingStart = "2026-02-18T10:05:00Z";
    const result = chooseStartedAtForTx(existingStart, incomingStart, false);
    expect(result).toBe(incomingStart);
  });

  it("keeps earliest start within the same transaction", () => {
    const existingStart = "2026-02-18T10:00:00Z";
    const incomingStart = "2026-02-18T10:05:00Z";
    const result = chooseStartedAtForTx(existingStart, incomingStart, true);
    expect(result).toBe(existingStart);
  });

  it("migrates no-tx anchor to a known transaction and removes placeholder", () => {
    const store: Record<string, string | undefined> = { [anchorKey(2, null)]: "2026-02-18T10:00:00Z" };
    const merged = migrateNoTxAnchorValue(store, 2, "tx-123", "2026-02-18T10:10:00Z");
    expect(merged).toBe("2026-02-18T10:00:00Z");
    expect(store[anchorKey(2, "tx-123")]).toBe("2026-02-18T10:00:00Z");
    expect(store[anchorKey(2, null)]).toBeUndefined();
  });

  it("clears old and no-tx anchors when switching to a new transaction", () => {
    const connectorId = 3;
    const store: Record<string, string | undefined> = {
      [anchorKey(connectorId, "old-tx")]: "2026-02-18T09:00:00Z",
      [anchorKey(connectorId, null)]: "2026-02-18T09:05:00Z"
    };
    // Simulate tx change cleanup
    delete store[anchorKey(connectorId, "old-tx")];
    delete store[anchorKey(connectorId, null)];
    const newStart = "2026-02-18T10:15:00Z";
    store[anchorKey(connectorId, "new-tx")] = newStart;

    expect(store[anchorKey(connectorId, "old-tx")]).toBeUndefined();
    expect(store[anchorKey(connectorId, null)]).toBeUndefined();
    expect(store[anchorKey(connectorId, "new-tx")]).toBe(newStart);
  });
});
