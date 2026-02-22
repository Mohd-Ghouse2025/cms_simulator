import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LiveMeterCardV2 } from "../detail/LiveMeterCardV2";
import { ConnectorSummary } from "../../types/detail";

const baseConnector: ConnectorSummary = {
  connectorId: 1,
  connector: null,
  samples: [
    {
      connectorId: 1,
      timestamp: Date.now() - 1000,
      isoTimestamp: new Date(Date.now() - 1000).toISOString(),
      valueWh: 1000,
      powerKw: 7,
      currentA: 16,
      energyKwh: 1,
      deltaWh: 500,
      intervalSeconds: 1,
      transactionId: "tx1"
    },
    {
      connectorId: 1,
      timestamp: Date.now(),
      isoTimestamp: new Date().toISOString(),
      valueWh: 1500,
      powerKw: 7.2,
      currentA: 16.5,
      energyKwh: 1.5,
      deltaWh: 500,
      intervalSeconds: 1,
      transactionId: "tx1"
    }
  ],
  sessionState: "charging",
  connectorStatus: "CHARGING",
  statusLabel: "Charging",
  statusTone: "success",
  sessionStatusLabel: "Charging",
  sessionStatusClass: "",
  transactionId: "tx1",
  transactionKey: "tx1",
  runtime: undefined,
  energyKwh: 1.5,
  pricePerKwh: 10,
  meterStartKwh: 0,
  meterStopKwh: 1.5,
  meterStopFinalWh: undefined,
  isFinal: false,
  deltaKwh: 0.5,
  powerKw: 7.2,
  costSoFar: 15,
  lastUpdated: null,
  lastSampleAt: new Date().toISOString(),
  duration: "00:00:05",
  userLimit: 2,
  limitType: "KWH",
  cmsSession: undefined,
  current: 16.5,
  idTag: "TAG",
  activeSession: true,
  isPlugged: true
};

describe("LiveMeterCard", () => {
  it("renders key meter fields and progress", () => {
    render(
      <LiveMeterCardV2
        primaryConnector={baseConnector}
        placeholderMessage="placeholder"
        graphIsFrozen={false}
        lastSampleIsStale={false}
        meterIntervalSeconds={1}
        statusToneClassMap={{
          success: "",
          info: "",
          warning: "",
          danger: "",
          neutral: ""
        }}
      />
    );

    expect(screen.getByText(/Energy/i)).toBeInTheDocument();
    expect(screen.getByText(/Meter start/i)).toBeInTheDocument();
    expect(screen.getByText(/Meter now/i)).toBeInTheDocument();
    expect(screen.getByText(/Cost so far/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Limit/i).length).toBeGreaterThan(0);
  });
});
