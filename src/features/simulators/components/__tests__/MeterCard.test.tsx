import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MeterCard } from "../detail/MeterCard";
import { ConnectorSummary } from "../../types/detail";

const baseConnector: ConnectorSummary = {
  connectorId: 1,
  connector: null,
  samples: [],
  sessionState: "charging",
  connectorStatus: "CHARGING",
  statusLabel: "Charging",
  statusTone: "success",
  sessionStatusLabel: "Charging",
  sessionStatusClass: "",
  transactionId: "tx1",
  transactionKey: "tx1",
  runtime: undefined,
  energyKwh: 0.5,
  pricePerKwh: 10,
  meterStartKwh: 0,
  meterStopKwh: 0.5,
  meterStopFinalWh: undefined,
  isFinal: false,
  deltaKwh: 0.01,
  powerKw: 1,
  costSoFar: 5,
  lastUpdated: null,
  lastSampleAt: null,
  duration: "00:00:05",
  userLimit: 1,
  limitType: "KWH",
  cmsSession: undefined,
  current: 2,
  idTag: "TAG",
  activeSession: true,
  isPlugged: true
};

describe("MeterCard", () => {
  it("renders live progress in meter info card", () => {
    render(
      <MeterCard
        primaryConnector={baseConnector}
        meterContextLabel="Connector #1"
        meterInfoFields={[]}
        meterPlaceholderMessage="placeholder"
        graphIsFrozen={false}
        statusToneClassMap={{
          success: "",
          info: "",
          warning: "",
          danger: "",
          neutral: ""
        }}
      />
    );

    expect(screen.getByText(/Energy delivered/i)).toBeInTheDocument();
    expect(screen.getByText(/Cost so far/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Limit/i).length).toBeGreaterThan(0);
  });

  it("shows capped cost when provided", () => {
    const cappedConnector = {
      ...baseConnector,
      limitType: "AMOUNT",
      userLimit: 1,
      costSoFar: 1,
      energyKwh: 0.06,
      pricePerKwh: 25 // would compute 1.50 if uncapped
    };

    render(
      <MeterCard
        primaryConnector={cappedConnector}
        meterContextLabel="Connector #1"
        meterInfoFields={[]}
        meterPlaceholderMessage="placeholder"
        graphIsFrozen={false}
        statusToneClassMap={{
          success: "",
          info: "",
          warning: "",
          danger: "",
          neutral: ""
        }}
      />
    );

    expect(screen.getByText("₹1.00")).toBeInTheDocument();
  });
});
