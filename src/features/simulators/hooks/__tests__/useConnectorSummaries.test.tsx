import { renderHook } from "@testing-library/react";
import { useConnectorSummaries } from "../useConnectorSummaries";
import { NormalizedSample } from "../../graphHelpers";
import { SessionLifecycle } from "../../types/detail";

const baseArgs = {
  nowTs: Date.now(),
  pendingLimits: {},
  resolveMeterStart: (transactionId: string | undefined, runtimeStart?: number | null) => runtimeStart ?? undefined,
  getStartAnchor: () => null,
  getSessionStatusLabel: (state: SessionLifecycle) => state,
  getSessionStatusClass: (state: SessionLifecycle) => state,
  activeSessionConnectorId: null,
  activeSessionState: null
};

const withHistoryStart = {
  ...baseArgs,
  getStartAnchor: () => "2026-02-18T10:00:00Z"
};

const sample: NormalizedSample = {
  connectorId: 1,
  timestamp: Date.now(),
  isoTimestamp: new Date().toISOString(),
  valueWh: 510,
  powerKw: 0,
  currentA: 0,
  energyKwh: 0.51,
  transactionId: "tx1"
};

describe("useConnectorSummaries cost capping", () => {
  it("caps amount-based cost at user limit", () => {
    const { result } = renderHook(() =>
      useConnectorSummaries({
        ...baseArgs,
        data: { connectors: [{ connector_id: 1, initial_status: "CHARGING" }] },
        meterTimelines: {
          1: { transactionId: "tx1", transactionKey: "tx1", samples: [sample] }
        },
        sessionsByConnector: {
          1: {
            connectorId: 1,
            transactionId: "tx1",
            state: "charging",
            meterStartWh: 465,
            meterStopWh: 510,
            activeSession: true,
            limitType: "AMOUNT",
            userLimit: 1,
            pricePerKwh: 22.5
          }
        },
        cmsSessionsIndex: { byId: new Map(), byFormatted: new Map(), byConnectorNumber: new Map() },
        cmsConnectorIndex: { byId: new Map(), byNumber: new Map() },
        defaultPricePerKwh: null
      })
    );

    const summary = result.current.connectorsSummary[0];
    expect(summary.costSoFar).toBe(1.0);
    expect(summary.limitType).toBe("AMOUNT");
  });

  it("leaves cost uncapped for kWh limits", () => {
    const { result } = renderHook(() =>
      useConnectorSummaries({
        ...baseArgs,
        nowTs: 1_771_430_655_733, // fixed timestamp for deterministic duration math
        data: { connectors: [{ connector_id: 1, initial_status: "CHARGING" }] },
        meterTimelines: {
          1: { transactionId: "tx1", transactionKey: "tx1", samples: [sample] }
        },
        sessionsByConnector: {
          1: {
            connectorId: 1,
            transactionId: "tx1",
            state: "charging",
            meterStartWh: 465,
            meterStopWh: 510,
            activeSession: true,
            limitType: "KWH",
            userLimit: 0.05,
            pricePerKwh: 22.5
          }
        },
        cmsSessionsIndex: { byId: new Map(), byFormatted: new Map(), byConnectorNumber: new Map() },
        cmsConnectorIndex: { byId: new Map(), byNumber: new Map() },
        defaultPricePerKwh: null
      })
    );

    const summary = result.current.connectorsSummary[0];
    expect(summary.costSoFar).toBeCloseTo(1.01, 2);
    expect(summary.limitType).toBe("KWH");
  });

  it("falls back to now when active session has no start hints", () => {
    const fixedNow = 1_771_430_600_000; // deterministic epoch
    const { result } = renderHook(() =>
      useConnectorSummaries({
        ...baseArgs,
        nowTs: fixedNow,
        data: { connectors: [{ connector_id: 1, initial_status: "CHARGING" }] },
        meterTimelines: {
          1: { transactionId: "tx1", transactionKey: "tx1", samples: [] }
        },
        sessionsByConnector: {
          1: {
            connectorId: 1,
            transactionId: "tx1",
            state: "charging",
            activeSession: true
          }
        },
        cmsSessionsIndex: { byId: new Map(), byFormatted: new Map(), byConnectorNumber: new Map() },
        cmsConnectorIndex: { byId: new Map(), byNumber: new Map() },
        defaultPricePerKwh: null
      })
    );

    const summary = result.current.connectorsSummary[0];
    expect(summary.duration).toBe("00:00:00");
    expect(summary.activeSession).toBe(true);
  });

  it("seeds duration when samples exist but no start markers", () => {
    const fixedNow = 1_771_430_700_000;
    const sampleOnly: NormalizedSample = {
      ...sample,
      timestamp: fixedNow - 2000,
      isoTimestamp: new Date(fixedNow - 2000).toISOString(),
      transactionId: undefined
    };
    const { result } = renderHook(() =>
      useConnectorSummaries({
        ...baseArgs,
        nowTs: fixedNow,
        data: { connectors: [{ connector_id: 1, initial_status: "AVAILABLE" }] },
        meterTimelines: { 1: { transactionId: undefined, transactionKey: undefined, samples: [sampleOnly] } },
        sessionsByConnector: {},
        cmsSessionsIndex: { byId: new Map(), byFormatted: new Map(), byConnectorNumber: new Map() },
        cmsConnectorIndex: { byId: new Map(), byNumber: new Map() },
        defaultPricePerKwh: null
      })
    );

    const summary = result.current.connectorsSummary[0];
    expect(summary.duration).toBe("00:00:02");
  });

  it("prefers CMS meter stop for completed sessions to avoid over-counting", () => {
    const { result } = renderHook(() =>
      useConnectorSummaries({
        ...baseArgs,
        nowTs: 1_771_430_900_000,
        data: { connectors: [{ connector_id: 1, initial_status: "AVAILABLE" }] },
        meterTimelines: {
          1: {
            transactionId: "tx1",
            transactionKey: "tx1",
            samples: [
              {
                ...sample,
                valueWh: 583,
                timestamp: 1_771_430_800_000,
                isoTimestamp: new Date(1_771_430_800_000).toISOString()
              }
            ]
          }
        },
        sessionsByConnector: {
          1: {
            connectorId: 1,
            transactionId: "tx1",
            state: "completed",
            meterStartWh: 493,
            meterStopWh: 582, // runtime stop
            meterStopFinalWh: undefined,
            activeSession: false,
            completedAt: new Date(1_771_430_800_000).toISOString()
          }
        },
        cmsSessionsIndex: {
          byId: new Map(),
          byFormatted: new Map(),
          byConnectorNumber: new Map()
        },
        cmsConnectorIndex: { byId: new Map(), byNumber: new Map() },
        defaultPricePerKwh: null
      })
    );

    const summary = result.current.connectorsSummary[0];
    // CMS stop (582 Wh) should beat sample (583 Wh) so diff = 89 Wh => 0.089 kWh
    expect(summary.energyKwh).toBeCloseTo(0.089, 3);
    expect(summary.meterStopKwh).toBeCloseTo(0.582, 3);
  });

  it("prefers active session connector id for selection helpers", () => {
    const { result } = renderHook(() =>
      useConnectorSummaries({
        ...baseArgs,
        data: { connectors: [{ connector_id: 1, initial_status: "AVAILABLE" }] },
        meterTimelines: {},
        sessionsByConnector: {
          1: {
            connectorId: 1,
            transactionId: "tx1",
            state: "charging",
            activeSession: true
          }
        },
        cmsSessionsIndex: { byId: new Map(), byFormatted: new Map(), byConnectorNumber: new Map() },
        cmsConnectorIndex: { byId: new Map(), byNumber: new Map() },
        defaultPricePerKwh: null,
        activeSessionConnectorId: 1
      })
    );

    expect(result.current.connectorsSummary[0].connectorId).toBe(1);
    expect(result.current.connectorsSummary[0].activeSession).toBe(true);
  });

  it("uses history start_time for duration seeding", () => {
    const fixedNow = 1_771_431_000_000; // deterministic epoch
    const historyStart = new Date(fixedNow - 5000).toISOString();
    const { result } = renderHook(() =>
      useConnectorSummaries({
        ...withHistoryStart,
        nowTs: fixedNow,
        data: { connectors: [{ connector_id: 1, initial_status: "CHARGING" }] },
        meterTimelines: {
          1: { transactionId: "tx1", transactionKey: "tx1", samples: [] }
        },
        sessionsByConnector: {
          1: {
            connectorId: 1,
            transactionId: "tx1",
            state: "charging",
            activeSession: true,
            startedAt: historyStart
          }
        },
        cmsSessionsIndex: { byId: new Map(), byFormatted: new Map(), byConnectorNumber: new Map() },
        cmsConnectorIndex: { byId: new Map(), byNumber: new Map() },
        defaultPricePerKwh: null
      })
    );

    const summary = result.current.connectorsSummary[0];
    expect(summary.duration).toBe("00:00:05");
  });
});
