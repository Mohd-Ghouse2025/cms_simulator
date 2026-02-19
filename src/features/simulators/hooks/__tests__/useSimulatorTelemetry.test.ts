import { describe, expect, it } from "vitest";
import { chooseStartedAtForTx, hasTransactionChanged } from "../useSimulatorTelemetry";

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
