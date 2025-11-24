import { useCallback, useMemo, useState } from "react";
import clsx from "clsx";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from "recharts";
import { ChargerLifecycleState } from "@/types";
import { getLifecycleStatusMeta, normalizeLifecycleState } from "@/lib/simulatorLifecycle";
import { formatLocalTimestamp } from "@/lib/time";
import {
  NormalizedSample,
  buildGraphData,
  downsampleSeries,
  smoothSamples,
  GraphPoint
} from "../graphHelpers";
import styles from "../SimulatorDetailPage.module.css";

type LiveGraphProps = {
  samples: NormalizedSample[];
  chargingState?: ChargerLifecycleState | string | null;
  sessionState?: string | null;
  connectorId?: number | null;
  frozen?: boolean;
};

type ChartDatum = GraphPoint & {
  smoothedPowerKw: number;
  smoothedCurrentA: number;
};

type GraphBadgeState =
  | "idle"
  | "pending"
  | "authorized"
  | "charging"
  | "finishing"
  | "completed"
  | "errored";

const getSessionBadgeState = (state?: string | null): GraphBadgeState | null => {
  if (!state) {
    return null;
  }
  const normalized = state.toLowerCase();
  switch (normalized) {
    case "charging":
    case "authorized":
    case "idle":
    case "pending":
    case "completed":
    case "finishing":
    case "errored":
      return normalized as GraphBadgeState;
    case "timeout":
      return "errored";
    default:
      return null;
  }
};

const getLifecycleBadgeState = (state?: ChargerLifecycleState): GraphBadgeState => {
  switch (state) {
    case "CHARGING":
      return "charging";
    case "CONNECTING":
      return "authorized";
    case "POWERED_ON":
      return "pending";
    case "ERROR":
      return "errored";
    case "CONNECTED":
      return "idle";
    case "OFFLINE":
    default:
      return "idle";
  }
};

export const LiveGraph = ({
  samples,
  chargingState,
  sessionState,
  connectorId,
  frozen
}: LiveGraphProps) => {
  const [activeTab, setActiveTab] = useState<"power" | "energy">("power");
  const formatTimeLabel = useCallback(
    (value: number) => formatLocalTimestamp(value, { withSeconds: true }),
    []
  );
  const lifecycleState = normalizeLifecycleState(chargingState ?? undefined);
  const sessionBadgeState = getSessionBadgeState(sessionState);
  const lifecycleBadgeState = lifecycleState
    ? getLifecycleBadgeState(lifecycleState)
    : "idle";
  const badgeState = sessionBadgeState ?? lifecycleBadgeState;
  const isFrozen = frozen ?? (badgeState === "completed" || badgeState === "finishing");
  const orderedSamples = useMemo(
    () => [...samples].sort((a, b) => a.timestamp - b.timestamp),
    [samples]
  );
  const windowedSamples = useMemo(() => {
    if (!orderedSamples.length) {
      return orderedSamples;
    }
    if (isFrozen) {
      return orderedSamples;
    }
    const latest = orderedSamples[orderedSamples.length - 1].timestamp;
    const maxWindow = 10 * 60 * 1000;
    const minWindow = 5 * 60 * 1000;
    let filtered = orderedSamples.filter((sample) => sample.timestamp >= latest - maxWindow);
    if (!filtered.length) {
      filtered = orderedSamples.filter((sample) => sample.timestamp >= latest - minWindow);
    }
    return filtered.length ? filtered : orderedSamples;
  }, [orderedSamples, isFrozen]);
  const reducedSamples = useMemo(
    () => downsampleSeries(windowedSamples, 540),
    [windowedSamples]
  );
  const smoothedSamples = useMemo(
    () => (frozen ? reducedSamples : smoothSamples(reducedSamples, 5)),
    [reducedSamples, frozen]
  );
  const rawChartData = useMemo(() => buildGraphData(reducedSamples, formatTimeLabel), [reducedSamples]);
  const smoothedChartData = useMemo(
    () => buildGraphData(smoothedSamples, formatTimeLabel),
    [smoothedSamples, formatTimeLabel]
  );
  const chartData: ChartDatum[] = useMemo(() => {
    if (!rawChartData.length) {
      return [];
    }
    return rawChartData.map((point, index) => ({
      ...point,
      smoothedPowerKw: smoothedChartData[index]?.powerKw ?? point.powerKw,
      smoothedCurrentA: smoothedChartData[index]?.currentA ?? point.currentA
    }));
  }, [rawChartData, smoothedChartData]);
  const showLiveOverlay = !isFrozen;
  const statusLabel = isFrozen
    ? "FROZEN"
    : sessionBadgeState
      ? sessionBadgeState.toUpperCase()
      : lifecycleState
        ? getLifecycleStatusMeta(lifecycleState).label.toUpperCase()
        : "IDLE";
  const badgeClass = clsx(styles.graphBadge, {
    [styles.graphBadgeLive]: badgeState === "charging" || badgeState === "authorized",
    [styles.graphBadgeIdle]: badgeState === "idle" || badgeState === "pending",
    [styles.graphBadgeFrozen]: badgeState === "completed" || badgeState === "finishing",
    [styles.graphBadgeFault]: badgeState === "errored"
  });
  const showPlaceholder =
    !chartData.length &&
    (badgeState === "idle" || badgeState === "pending" || badgeState === "authorized");
  const placeholder =
    badgeState === "errored"
      ? "Connector fault – telemetry unavailable."
      : badgeState === "completed" || badgeState === "finishing"
        ? "Session completed. Displaying final telemetry."
        : "Waiting for telemetry…";
  const resolvePowerDomain = (max: number) => {
    const value = Number.isFinite(max) ? max : 0;
    const headroom = value <= 0 ? 1 : value * 1.15 + 0.1;
    const rounded = Math.ceil(headroom * 10) / 10;
    return Number.isFinite(rounded) ? rounded : 1;
  };
  const resolveCurrentDomain = (max: number) => {
    const value = Number.isFinite(max) ? max : 0;
    const headroom = value <= 0 ? 2 : value * 1.15 + 0.5;
    const rounded = Math.ceil(headroom * 10) / 10;
    return Number.isFinite(rounded) ? rounded : 2;
  };
  const resolveEnergyDomain = (max: number) => {
    const value = Number.isFinite(max) ? max : 0;
    const headroom = value <= 0 ? 0.01 : value * 1.08 + 0.005;
    const rounded = Math.ceil(headroom * 1000) / 1000;
    return Number.isFinite(rounded) ? rounded : 0.01;
  };

  return (
    <div className={styles.liveGraph}>
      <div className={styles.graphToolbar}>
        <div className={styles.graphBadgeGroup}>
          <span className={badgeClass}>{statusLabel.toUpperCase()}</span>
          <span className={styles.graphConnectorMeta}>
            {connectorId ? `Connector #${connectorId}` : "Connector not selected"}
          </span>
        </div>
        <div className={styles.graphTabs}>
          <button
            type="button"
            className={clsx(styles.graphTab, activeTab === "power" && styles.graphTabActive)}
            onClick={() => setActiveTab("power")}
          >
            Power & Current
          </button>
          <button
            type="button"
            className={clsx(styles.graphTab, activeTab === "energy" && styles.graphTabActive)}
            onClick={() => setActiveTab("energy")}
          >
            Energy Delivered
          </button>
        </div>
      </div>
      {showPlaceholder ? (
        <div className={styles.graphPlaceholderLarge}>{placeholder}</div>
      ) : (
        <>
          {activeTab === "power" ? (
            <div className={styles.graphCanvas}>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={chartData} margin={{ top: 12, right: 32, left: 12, bottom: 8 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" />
                  <XAxis
                    dataKey="timestamp"
                    stroke="#94a3b8"
                    fontSize={11}
                    minTickGap={48}
                    tickFormatter={(value: number) => formatTimeLabel(value)}
                  />
                  <YAxis
                    yAxisId="power"
                    stroke="#0f172a"
                    label={{ value: "Power (kW)", angle: -90, position: "insideLeft" }}
                    fontSize={11}
                    width={48}
                    domain={[0, resolvePowerDomain]}
                    allowDecimals
                    tickFormatter={(value: number) => value.toFixed(1)}
                  />
                  <YAxis
                    yAxisId="current"
                    orientation="right"
                    stroke="#22c55e"
                    label={{ value: "Current (A)", angle: 90, position: "insideRight" }}
                    fontSize={11}
                    width={48}
                    domain={[0, resolveCurrentDomain]}
                    allowDecimals
                    tickFormatter={(value: number) => value.toFixed(1)}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) {
                        return null;
                      }
                      const point = payload[0].payload as {
                        timeLabel: string;
                        powerKw: number;
                        currentA: number;
                      };
                      return (
                        <div className={styles.graphTooltip}>
                          <p className={styles.graphTooltipTitle}>{point.timeLabel}</p>
                          <span>Power: <strong>{point.powerKw.toFixed(2)} kW</strong></span>
                          <span>Current: <strong>{point.currentA.toFixed(1)} A</strong></span>
                        </div>
                      );
                    }}
                  />
                  {showLiveOverlay ? (
                    <Line
                      type="monotone"
                      dataKey="powerKw"
                      yAxisId="power"
                      stroke="#0f172a"
                      strokeDasharray="4 4"
                      strokeOpacity={0.6}
                      strokeWidth={1.5}
                      dot={chartData.length <= 2 ? { r: 3 } : false}
                      activeDot={{ r: 4 }}
                      isAnimationActive={false}
                    />
                  ) : null}
                  <Line
                    type="monotone"
                    dataKey="smoothedPowerKw"
                    yAxisId="power"
                    stroke="#0f172a"
                    strokeWidth={2.5}
                    dot={chartData.length <= 2 ? { r: 3 } : false}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                  {showLiveOverlay ? (
                    <Line
                      type="monotone"
                      dataKey="currentA"
                      yAxisId="current"
                      stroke="#22c55e"
                      strokeDasharray="4 4"
                      strokeOpacity={0.6}
                      strokeWidth={1.25}
                      dot={chartData.length <= 2 ? { r: 3 } : false}
                      activeDot={{ r: 4 }}
                      isAnimationActive={false}
                    />
                  ) : null}
                  <Line
                    type="monotone"
                    dataKey="smoothedCurrentA"
                    yAxisId="current"
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={chartData.length <= 2 ? { r: 3 } : false}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className={styles.graphCanvas}>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={chartData} margin={{ top: 12, right: 24, left: 12, bottom: 8 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" />
                  <XAxis
                    dataKey="timestamp"
                    stroke="#94a3b8"
                    fontSize={11}
                    minTickGap={48}
                    tickFormatter={(value: number) => formatTimeLabel(value)}
                  />
                  <YAxis
                    stroke="#8a4fff"
                    label={{ value: "Energy (kWh)", angle: -90, position: "insideLeft" }}
                    fontSize={11}
                    width={48}
                    domain={[0, resolveEnergyDomain]}
                    tickFormatter={(value: number) => value.toFixed(3)}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) {
                        return null;
                      }
                      const point = payload[0].payload as { timeLabel: string; energyKwh: number };
                      return (
                        <div className={styles.graphTooltip}>
                          <p className={styles.graphTooltipTitle}>{point.timeLabel}</p>
                          <span>Energy: <strong>{point.energyKwh.toFixed(3)} kWh</strong></span>
                        </div>
                      );
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="energyKwh"
                    stroke="#8a4fff"
                    fill="rgba(138, 79, 255, 0.2)"
                    strokeWidth={2}
                    dot={chartData.length <= 1 ? { r: 3 } : false}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
};
