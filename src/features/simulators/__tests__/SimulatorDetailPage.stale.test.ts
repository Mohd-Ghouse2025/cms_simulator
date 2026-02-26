import { describe, expect, it } from "vitest";
import { evaluateWsStaleness } from "../SimulatorDetailPage";

const baseArgs = {
  status: "open",
  connectedAt: Date.now() - 5_000,
  hasActiveSession: false,
  meterIntervalMs: 5_000,
  heartbeatIntervalMs: 30_000,
  statusIntervalMs: 60_000
};

describe("evaluateWsStaleness", () => {
  it("does not mark stale when telemetry is disconnected", () => {
    const result = evaluateWsStaleness({
      ...baseArgs,
      intent: "disconnected",
      lastMessageAt: null
    });
    expect(result.disconnected).toBe(true);
    expect(result.isStale).toBe(false);
  });

  it("marks stale when connected and last message exceeds idle threshold", () => {
    const now = Date.now();
    const result = evaluateWsStaleness({
      ...baseArgs,
      intent: "connected",
      lastMessageAt: now - 200_000,
      now
    });
    expect(result.disconnected).toBe(false);
    expect(result.isStale).toBe(true);
  });

  it("remains fresh when connected and last message within threshold", () => {
    const now = Date.now();
    const result = evaluateWsStaleness({
      ...baseArgs,
      intent: "connected",
      lastMessageAt: now - 20_000,
      now
    });
    expect(result.isStale).toBe(false);
  });
});

