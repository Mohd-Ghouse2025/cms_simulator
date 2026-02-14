import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  connectorHasActiveSession,
  connectorStatusTone,
  formatConnectorStatusLabel,
  isConnectorPlugged,
  isActiveSessionState,
  normalizeConnectorStatus
} from "./status";

const renderLabel = (status: string) =>
  renderToStaticMarkup(<span>{formatConnectorStatusLabel(status)}</span>);

describe("connector status helpers", () => {
  it("normalizes mixed-case values", () => {
    expect(normalizeConnectorStatus("Preparing")).toBe("PREPARING");
    expect(normalizeConnectorStatus("SuspendedEV")).toBe("SUSPENDED_EV");
    expect(normalizeConnectorStatus("reserved")).toBe("RESERVED");
  });

  it("formats display labels for statuses", () => {
    expect(formatConnectorStatusLabel("FINISHING")).toBe("Finishing");
    expect(formatConnectorStatusLabel("FAULTED")).toBe("Faulted");
    expect(formatConnectorStatusLabel("SUSPENDED_EVSE")).toBe("Suspended EVSE");
  });

  it("renders badges with the expected labels", () => {
    expect(renderLabel("PREPARING")).toContain("Preparing");
    expect(renderLabel("FINISHING")).toContain("Finishing");
    expect(renderLabel("FAULTED")).toContain("Faulted");
  });

  it("returns tones suitable for chips and timeline entries", () => {
    expect(connectorStatusTone("CHARGING")).toBe("success");
    expect(connectorStatusTone("FAULTED")).toBe("danger");
    expect(connectorStatusTone("PREPARING")).toBe("info");
    expect(connectorStatusTone("UNAVAILABLE")).toBe("warning");
  });

  it("detects whether a connector is physically plugged", () => {
    expect(isConnectorPlugged("AVAILABLE")).toBe(false);
    expect(isConnectorPlugged("Preparing")).toBe(true);
    expect(isConnectorPlugged("CHARGING")).toBe(true);
    expect(isConnectorPlugged("SUSPENDED_EV")).toBe(true);
    expect(isConnectorPlugged("UNAVAILABLE")).toBe(true);
    expect(isConnectorPlugged("FAULTED")).toBe(false);
  });

  it("identifies active session states and ignores idle ones", () => {
    expect(isActiveSessionState("charging")).toBe(true);
    expect(isActiveSessionState("finishing")).toBe(true);
    expect(isActiveSessionState("completed")).toBe(false);
  });

  it("flags active sessions only on the matching connector", () => {
    expect(
      connectorHasActiveSession({
        sessionState: "idle",
        connectorId: 2,
        activeSessionConnectorId: 1,
        activeSessionState: "charging"
      })
    ).toBe(false);
    expect(
      connectorHasActiveSession({
        sessionState: "idle",
        connectorId: 1,
        activeSessionConnectorId: 1,
        activeSessionState: "charging"
      })
    ).toBe(true);
    expect(
      connectorHasActiveSession({
        sessionState: "authorized",
        connectorId: 3,
        activeSessionConnectorId: 99
      })
    ).toBe(true);
  });
});
