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

  it("prefers live_status over initial_status for connector status", () => {
    const { result } = renderHook(() =>
      useConnectorSummaries({
        ...baseArgs,
        data: { connectors: [{ connector_id: 1, initial_status: "FINISHING", live_status: "AVAILABLE" }] },
        meterTimelines: {},
        sessionsByConnector: {},
        cmsSessionsIndex: { byId: new Map(), byFormatted: new Map(), byConnectorNumber: new Map() },
        cmsConnectorIndex: { byId: new Map(), byNumber: new Map() },
        defaultPricePerKwh: null
      })
    );

    const summary = result.current.connectorsSummary[0];
    expect(summary.connectorStatus).toBe("AVAILABLE");
    expect(summary.statusLabel).toBe("Available");
  });

  it("resets duration anchors when transaction changes", () => {
    const fixedNow = 1_771_432_000_000;
    const firstStart = new Date(fixedNow - 3_600_000).toISOString(); // 1h ago
    const base = {
      ...baseArgs,
      data: { connectors: [{ connector_id: 1, initial_status: "CHARGING" }] },
      cmsSessionsIndex: { byId: new Map(), byFormatted: new Map(), byConnectorNumber: new Map() },
      cmsConnectorIndex: { byId: new Map(), byNumber: new Map() },
      defaultPricePerKwh: null,
      resolveMeterStart: () => 0
    };
    const { result, rerender } = renderHook(
      (props: any) =>
        useConnectorSummaries({
          ...props.base,
          nowTs: props.nowTs,
          meterTimelines: props.timeline,
          sessionsByConnector: props.sessions
        }),
      {
        initialProps: {
          base,
          nowTs: fixedNow,
          timeline: {
            1: {
              transactionId: "tx-old",
              transactionKey: "tx-old",
              samples: [
                {
                  ...sample,
                  connectorId: 1,
                  transactionId: "tx-old",
                  timestamp: Date.parse(firstStart),
                  isoTimestamp: firstStart
                }
              ]
            }
          },
          sessions: {
            1: {
              connectorId: 1,
              transactionId: "tx-old",
              state: "charging",
              activeSession: true,
              startedAt: firstStart,
              meterStartWh: 0,
              meterStopWh: 100
            }
          }
        }
      }
    );

    const initial = result.current.connectorsSummary[0];
    expect(initial.duration?.startsWith("01:00")).toBe(true);

    const newSampleTs = fixedNow - 2_000;
    const newStart = new Date(newSampleTs).toISOString();
    rerender({
      base,
      nowTs: fixedNow,
      timeline: {
        1: {
          transactionId: "tx-new",
          transactionKey: "tx-new",
          samples: [
            {
              ...sample,
              connectorId: 1,
              transactionId: "tx-new",
              timestamp: newSampleTs,
              isoTimestamp: newStart
            }
          ]
        }
      },
      sessions: {
        1: {
          connectorId: 1,
          transactionId: "tx-new",
          state: "charging",
          activeSession: true,
          startedAt: newStart,
          meterStartWh: 0,
          meterStopWh: 50
        }
      }
    });

    const next = result.current.connectorsSummary[0];
    expect(next.transactionId).toBe("tx-new");
    expect(next.duration).toBe("00:00:02");
  });

  it("falls back to metadata.cms_status when live_status is missing", () => {
    const { result } = renderHook(() =>
      useConnectorSummaries({
        ...baseArgs,
        data: {
          connectors: [
            { connector_id: 1, initial_status: "FINISHING", live_status: null, metadata: { cms_status: "CHARGING" } }
          ]
        },
        meterTimelines: {},
        sessionsByConnector: {},
        cmsSessionsIndex: { byId: new Map(), byFormatted: new Map(), byConnectorNumber: new Map() },
        cmsConnectorIndex: { byId: new Map(), byNumber: new Map() },
        defaultPricePerKwh: null
      })
    );

    const summary = result.current.connectorsSummary[0];
    expect(summary.connectorStatus).toBe("CHARGING");
    expect(summary.statusLabel).toBe("Charging");
  });

  it("falls back to initial_status when live and cms_status are missing", () => {
    const { result } = renderHook(() =>
      useConnectorSummaries({
        ...baseArgs,
        data: { connectors: [{ connector_id: 1, initial_status: "FAULTED" }] },
        meterTimelines: {},
        sessionsByConnector: {},
        cmsSessionsIndex: { byId: new Map(), byFormatted: new Map(), byConnectorNumber: new Map() },
        cmsConnectorIndex: { byId: new Map(), byNumber: new Map() },
        defaultPricePerKwh: null
      })
    );

    const summary = result.current.connectorsSummary[0];
    expect(summary.connectorStatus).toBe("FAULTED");
    expect(summary.statusLabel).toBe("Faulted");
  });

  it("uses latest live sample for meter stop and energy during charging", () => {
    const nowTs = Date.now();
    const samples: NormalizedSample[] = [
      {
        connectorId: 1,
        timestamp: nowTs - 2000,
        isoTimestamp: new Date(nowTs - 2000).toISOString(),
        valueWh: 19034,
        powerKw: 0.7,
        currentA: 3,
        energyKwh: 19.034
      },
      {
        connectorId: 1,
        timestamp: nowTs - 1000,
        isoTimestamp: new Date(nowTs - 1000).toISOString(),
        valueWh: 19035.4543,
        powerKw: 1.1,
        currentA: 5,
        energyKwh: 19.0354543
      }
    ];

    const { result } = renderHook(() =>
      useConnectorSummaries({
        ...baseArgs,
        nowTs,
        data: { connectors: [{ connector_id: 1, initial_status: "CHARGING" }] },
        meterTimelines: { 1: { transactionId: "tx-live", transactionKey: "tx-live", samples } },
        sessionsByConnector: {},
        cmsSessionsIndex: { byId: new Map(), byFormatted: new Map(), byConnectorNumber: new Map() },
        cmsConnectorIndex: { byId: new Map(), byNumber: new Map() },
        defaultPricePerKwh: null,
        resolveMeterStart: () => 19034
      })
    );

    const summary = result.current.connectorsSummary[0];
    expect(summary.meterStopKwh).toBeCloseTo(19.035, 3);
    expect(summary.energyKwh).toBeCloseTo((19035.4543 - 19034) / 1000, 3);
  });
});
