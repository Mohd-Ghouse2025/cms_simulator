import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  connectorStatusTone,
  formatConnectorStatusLabel,
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
});
