import { describe, it, expect } from "vitest";
import { pickActiveConnectorId, resolveConnectorSelection } from "./selection";

describe("resolveConnectorSelection", () => {
  it("prefers active/preferred connector when user has not selected", () => {
    const next = resolveConnectorSelection({
      preferredConnectorId: 2,
      selectedConnectorId: 1,
      validConnectorIds: [1, 2],
      userHasSelected: false
    });
    expect(next).toBe(2);
  });

  it("keeps user selection when userHasSelected is true", () => {
    const next = resolveConnectorSelection({
      preferredConnectorId: 2,
      selectedConnectorId: 1,
      validConnectorIds: [1, 2],
      userHasSelected: true
    });
    expect(next).toBe(1);
  });

  it("falls back to first valid connector when none selected", () => {
    const next = resolveConnectorSelection({
      preferredConnectorId: null,
      selectedConnectorId: null,
      validConnectorIds: [3, 4],
      userHasSelected: false
    });
    expect(next).toBe(3);
  });
});

describe("pickActiveConnectorId", () => {
  it("prefers the active connector over historical telemetry", () => {
    const next = pickActiveConnectorId(
      [
        { connectorId: 1, completedAt: "2026-06-26T07:56:05.000Z" },
        { connectorId: 2, activeSession: true, startedAt: "2026-06-26T07:55:00.000Z" }
      ],
      null
    );

    expect(next).toBe(2);
  });

  it("falls back to the most recent completed telemetry when there is no active connector", () => {
    const next = pickActiveConnectorId(
      [
        { connectorId: 1, completedAt: "2026-06-25T08:25:59.000Z" },
        { connectorId: 2, completedAt: "2026-06-26T07:56:05.000Z" }
      ],
      null
    );

    expect(next).toBe(2);
  });

  it("uses the latest sample timestamp when a completed timestamp is missing", () => {
    const next = pickActiveConnectorId(
      [
        { connectorId: 1, lastSampleAt: "2026-06-25T08:25:59.000Z" },
        { connectorId: 2, lastSampleAt: "2026-06-26T07:56:05.000Z" }
      ],
      null
    );

    expect(next).toBe(2);
  });
});
