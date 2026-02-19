import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useReducer,
  useRef,
  useState
} from "react";
import clsx from "clsx";
import { Activity, AlertTriangle, GaugeCircle, Info, Plug, Power, Zap } from "lucide-react";
import { Card } from "@/components/common/Card";
import { formatLocalTimestamp } from "@/lib/time";
import {
  EventTimelineHandle,
  HeartbeatFeedEntry,
  TelemetryFeedEntry,
  TimelineEvent
} from "../../types/detail";
import styles from "../../SimulatorDetailPage.module.css";

const timelineIconComponents = {
  activity: Activity,
  plug: Plug,
  power: Power,
  zap: Zap,
  gauge: GaugeCircle,
  alert: AlertTriangle,
  info: Info
} as const;

const formatTimelineTimestamp = (value: string): string =>
  formatLocalTimestamp(value, { withSeconds: true });

const compareTimelineEventsDesc = (a: TimelineEvent, b: TimelineEvent): number => {
  const aTime = Date.parse(a.timestamp);
  const bTime = Date.parse(b.timestamp);
  const aValid = Number.isFinite(aTime);
  const bValid = Number.isFinite(bTime);
  if (!aValid && !bValid) {
    return 0;
  }
  if (!aValid) {
    return 1;
  }
  if (!bValid) {
    return -1;
  }
  return bTime - aTime;
};

const EMPTY_SIGNATURE = "__empty__";

const signatureForTelemetry = (entries: TelemetryFeedEntry[]): string => {
  if (!entries.length) {
    return EMPTY_SIGNATURE;
  }
  return entries.map((entry) => `${entry.connectorId}-${entry.timestamp}`).join("|");
};

const signatureForTimeline = (entries: TimelineEvent[]): string => {
  if (!entries.length) {
    return EMPTY_SIGNATURE;
  }
  return entries.map((entry) => entry.id).join("|");
};

const signatureForHeartbeats = (entries: HeartbeatFeedEntry[]): string => {
  if (!entries.length) {
    return EMPTY_SIGNATURE;
  }
  return entries.map((entry) => entry.id).join("|");
};

const TIMELINE_TABS = [
  { id: "telemetry", label: "Telemetry" },
  { id: "lifecycle", label: "Lifecycle" },
  { id: "faults", label: "Faults" },
  { id: "commands", label: "Commands & Sessions" },
  { id: "logs", label: "Logs" },
  { id: "heartbeats", label: "Heartbeats" }
] as const;

export type EventTimelineCardProps = {
  meterPlaceholderMessage: string;
  timelinePlaceholderMessage: string;
  lifecycleBadgeClass: string;
  lifecycleStatusLabel: string;
  socketBadgeClass: string;
  socketStatusLabel: string;
  socketStatus: string;
  heartbeatInterval?: number;
};

type TimelineTab = (typeof TIMELINE_TABS)[number]["id"];

export const EventTimelineCard = memo(
  forwardRef<EventTimelineHandle, EventTimelineCardProps>(function EventTimelineCard(
    {
      meterPlaceholderMessage,
      timelinePlaceholderMessage,
      lifecycleBadgeClass,
      lifecycleStatusLabel,
      socketBadgeClass,
      socketStatusLabel,
      socketStatus,
      heartbeatInterval
    },
    ref
  ) {
    const [activeTab, setActiveTab] = useState<TimelineTab>("telemetry");
    const containerRef = useRef<HTMLDivElement | null>(null);
    const telemetryFeedRef = useRef<TelemetryFeedEntry[]>([]);
    const timelineEventsRef = useRef<TimelineEvent[]>([]);
    const heartbeatEventsRef = useRef<HeartbeatFeedEntry[]>([]);
    const telemetrySignatureRef = useRef<string>(EMPTY_SIGNATURE);
    const timelineSignatureRef = useRef<string>(EMPTY_SIGNATURE);
    const heartbeatSignatureRef = useRef<string>(EMPTY_SIGNATURE);
    const [renderVersion, forceRender] = useReducer((value: number) => value + 1, 0);
    const pinnedRef = useRef<Record<TimelineTab, boolean>>({
      telemetry: true,
      lifecycle: true,
      faults: true,
      commands: true,
      logs: true,
      heartbeats: true
    });
    const scrollPositionsRef = useRef<Record<TimelineTab, number>>({
      telemetry: 0,
      lifecycle: 0,
      faults: 0,
      commands: 0,
      logs: 0,
      heartbeats: 0
    });
    const heightRef = useRef<Record<TimelineTab, number>>({
      telemetry: 0,
      lifecycle: 0,
      faults: 0,
      commands: 0,
      logs: 0,
      heartbeats: 0
    });
    const activeTabRef = useRef<TimelineTab>("telemetry");

    useEffect(() => {
      activeTabRef.current = activeTab;
      const node = containerRef.current;
      if (!node) {
        return;
      }
      const savedPosition = scrollPositionsRef.current[activeTab] ?? 0;
      node.scrollTop = savedPosition;
      pinnedRef.current[activeTab] = savedPosition < 16;
    }, [activeTab]);

    useEffect(() => {
      const node = containerRef.current;
      if (!node) {
        return;
      }
      const handleScroll = () => {
        const tabKey = activeTabRef.current;
        const pinned = node.scrollTop < 16;
        pinnedRef.current[tabKey] = pinned;
        scrollPositionsRef.current[tabKey] = node.scrollTop;
      };
      handleScroll();
      node.addEventListener("scroll", handleScroll);
      return () => {
        node.removeEventListener("scroll", handleScroll);
      };
    }, []);

    const syncTelemetry = useCallback(
      (entries: TelemetryFeedEntry[]) => {
        const signature = signatureForTelemetry(entries);
        if (signature === telemetrySignatureRef.current) {
          return;
        }
        telemetrySignatureRef.current = signature;
        telemetryFeedRef.current = entries.map((entry) => ({ ...entry }));
        forceRender();
      },
      [forceRender]
    );

    const syncTimeline = useCallback(
      (entries: TimelineEvent[]) => {
        const signature = signatureForTimeline(entries);
        if (signature === timelineSignatureRef.current) {
          return;
        }
        timelineSignatureRef.current = signature;
        timelineEventsRef.current = entries.map((entry) => ({ ...entry }));
        forceRender();
      },
      [forceRender]
    );

    const syncHeartbeats = useCallback(
      (entries: HeartbeatFeedEntry[]) => {
        const signature = signatureForHeartbeats(entries);
        if (signature === heartbeatSignatureRef.current) {
          return;
        }
        heartbeatSignatureRef.current = signature;
        heartbeatEventsRef.current = entries.map((entry) => ({ ...entry }));
        forceRender();
      },
      [forceRender]
    );

    const reset = useCallback(() => {
      telemetryFeedRef.current = [];
      timelineEventsRef.current = [];
      heartbeatEventsRef.current = [];
      telemetrySignatureRef.current = EMPTY_SIGNATURE;
      timelineSignatureRef.current = EMPTY_SIGNATURE;
      heartbeatSignatureRef.current = EMPTY_SIGNATURE;
      pinnedRef.current = {
        telemetry: true,
        lifecycle: true,
        faults: true,
        commands: true,
        logs: true,
        heartbeats: true
      };
      heightRef.current = {
        telemetry: 0,
        lifecycle: 0,
        faults: 0,
        commands: 0,
        logs: 0,
        heartbeats: 0
      };
      scrollPositionsRef.current = {
        telemetry: 0,
        lifecycle: 0,
        faults: 0,
        commands: 0,
        logs: 0,
        heartbeats: 0
      };
      if (containerRef.current) {
        containerRef.current.scrollTop = 0;
      }
      forceRender();
    }, [forceRender]);

    useImperativeHandle(
      ref,
      () => ({
        syncTelemetry,
        syncTimeline,
        syncHeartbeats,
        reset
      }),
      [reset, syncTelemetry, syncTimeline, syncHeartbeats]
    );

    useLayoutEffect(() => {
      const node = containerRef.current;
      if (!node) {
        return;
      }
      const key = activeTabRef.current;
      const previousHeight = heightRef.current[key];
      const nextHeight = node.scrollHeight;
      if (pinnedRef.current[key]) {
        node.scrollTop = 0;
        scrollPositionsRef.current[key] = 0;
      } else if (nextHeight !== previousHeight) {
        const updatedScroll = Math.max(node.scrollTop + (nextHeight - previousHeight), 0);
        node.scrollTop = updatedScroll;
        scrollPositionsRef.current[key] = updatedScroll;
      }
      heightRef.current[key] = nextHeight;
    }, [renderVersion, activeTab]);

    const telemetryFeed = telemetryFeedRef.current;
    const baseTimelineEvents = timelineEventsRef.current.filter((event) => event.kind !== "meter");
    const lifecycleEvents = baseTimelineEvents.filter(
      (event) => event.kind === "lifecycle" || event.kind === "connector" || event.kind === "fault"
    );
    const faultEvents = baseTimelineEvents.filter((event) => {
      if (event.kind === "fault") {
        return true;
      }
      if (event.kind === "lifecycle" && event.badge) {
        return event.badge.toUpperCase().includes("FAULT");
      }
      return false;
    });
    const commandEvents = baseTimelineEvents.filter(
      (event) => event.kind === "command" || event.kind === "session"
    );
    const commandEventsLatestFirst = [...commandEvents].sort(compareTimelineEventsDesc);
    const logEvents = baseTimelineEvents.filter((event) => event.kind === "log");
    const heartbeatEventsList = heartbeatEventsRef.current;

    const telemetryFeedHasData = telemetryFeed.length > 0;
    const isSocketLive = socketStatus === "open";
    const latestHeartbeat = heartbeatEventsList[0];
    const heartbeatWindowMs = Math.max((heartbeatInterval ?? 60) * 2 * 1000, 30_000);
    const heartbeatAge =
      latestHeartbeat && Number.isFinite(Date.parse(latestHeartbeat.timestamp))
        ? Date.now() - Date.parse(latestHeartbeat.timestamp)
        : Infinity;
    const heartbeatLive = isSocketLive && heartbeatAge < heartbeatWindowMs;

    const renderEventItem = (entry: TimelineEvent) => {
      const IconComponent = timelineIconComponents[entry.icon] ?? Info;
      const toneSuffix = entry.tone.charAt(0).toUpperCase() + entry.tone.slice(1);
      const markerClass = clsx(styles.timelineMarker, styles[`timelineMarker${toneSuffix}`]);
      const badgeClass = clsx(styles.timelineBadge, styles[`timelineBadge${toneSuffix}`]);
      return (
        <li key={entry.id} className={styles.timelineItem}>
          <span className={markerClass}>
            <IconComponent size={14} strokeWidth={1.75} />
          </span>
          <div className={styles.timelineCard}>
            <div className={styles.timelineHeader}>
              <div>
                <p className={styles.timelineTitle}>{entry.title}</p>
                {entry.subtitle ? <p className={styles.timelineSubtitle}>{entry.subtitle}</p> : null}
              </div>
              <span className={styles.timelineTimestamp}>
                {formatTimelineTimestamp(entry.timestamp)}
              </span>
            </div>
            <div className={styles.timelineMetaRow}>
              {entry.badge ? <span className={badgeClass}>{entry.badge}</span> : null}
              {entry.meta ? <span className={styles.timelineMeta}>{entry.meta}</span> : null}
            </div>
            {entry.metrics ? (
              <dl className={styles.timelineMetrics}>
                {entry.metrics.map((metric) => (
                  <div key={`${entry.id}-${metric.label}`} className={styles.timelineMetric}>
                    <dt>{metric.label}</dt>
                    <dd className={metric.muted ? styles.timelineMetricMuted : undefined}>
                      {metric.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </li>
      );
    };

    const renderTimelineList = (events: TimelineEvent[], emptyMessage: string) => {
      if (!events.length) {
        return <p className={styles.logPlaceholder}>{emptyMessage}</p>;
      }
      return <ol className={styles.timelineList}>{events.map(renderEventItem)}</ol>;
    };

    const renderContent = () => {
      switch (activeTab) {
        case "telemetry":
          return (
            <>
              <div className={styles.timelinePanelHeader}>
                <div className={styles.timelinePanelBadges}>
                  <span
                    className={clsx(
                      styles.timelineBadgePill,
                      isSocketLive ? styles.timelineBadgeLive : styles.timelineBadgeMuted
                    )}
                  >
                    {isSocketLive ? "LIVE STREAMING" : "STREAM OFFLINE"}
                  </span>
                  <span className={styles.timelineBadgePill}>RAW TELEMETRY</span>
                </div>
                <p className={styles.timelinePanelHint}>
                  Power, current, and cumulative energy exactly as reported by the simulator feed.
                </p>
              </div>
              {telemetryFeedHasData ? (
                <ul className={styles.logsList}>
                  {telemetryFeed.map((entry) => (
                    <li key={`${entry.connectorId}-${entry.timestamp}`} className={styles.logRow}>
                      <span className={styles.logTimestamp}>
                        {new Date(entry.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit"
                        })}
                      </span>
                      <div className={styles.logContext}>
                        <span className={styles.logTitle}>
                          Connector #{entry.connectorId}
                          {entry.transactionId ? ` · Tx ${entry.transactionId}` : ""}
                          {entry.idTag ? ` · ${entry.idTag}` : ""}
                        </span>
                        <span className={styles.logSnapshot}>
                          {entry.powerKw !== null ? `${entry.powerKw.toFixed(2)} kW` : "— kW"} ·{" "}
                          {entry.current !== null ? `${Math.round(entry.current)} A` : "— A"} ·{" "}
                          {entry.energyKwh !== null ? `${entry.energyKwh.toFixed(3)} kWh` : "— kWh"}
                          {entry.energyRegisterKwh != null &&
                          entry.energyRegisterKwh !== entry.energyKwh
                            ? ` (reg ${entry.energyRegisterKwh.toFixed(3)} kWh)`
                            : ""}
                        </span>
                      </div>
                      <span className={clsx(styles.statusChip, entry.statusClass)}>
                        {entry.statusLabel}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.telemetryPlaceholder}>{meterPlaceholderMessage}</p>
              )}
            </>
          );
        case "lifecycle":
          return (
            <>
              <div className={styles.timelinePanelHeader}>
                <div className={styles.timelineStatusGroup}>
                  <div className={styles.statusWithLabel}>
                    <span className={styles.statusLabel}>Simulator</span>
                    <span className={lifecycleBadgeClass}>{lifecycleStatusLabel}</span>
                  </div>
                  <div className={styles.statusWithLabel}>
                    <span className={styles.statusLabel}>WebSocket</span>
                    <span className={socketBadgeClass}>{socketStatusLabel}</span>
                  </div>
                </div>
                <p className={styles.timelinePanelHint}>
                  Boot notifications, connect/disconnect events, and lifecycle transitions remain in
                  the order received from the CMS.
                </p>
              </div>
              {renderTimelineList(
                lifecycleEvents,
                timelinePlaceholderMessage || "Lifecycle activity will appear here."
              )}
            </>
          );
        case "faults":
          return (
            <>
              <div className={styles.timelinePanelHeader}>
                <p className={styles.timelinePanelHint}>
                  Fault reports from connectors and simulator state changes, including vendor
                  diagnostics when provided by the backend.
                </p>
              </div>
              {renderTimelineList(
                faultEvents,
                "No connector or charger faults have been reported yet."
              )}
            </>
          );
        case "commands":
          return (
            <>
              <div className={styles.timelinePanelHeader}>
                <p className={styles.timelinePanelHint}>
                  Remote commands and session state transitions exactly as confirmed by the backend.
                </p>
              </div>
              {renderTimelineList(
                commandEventsLatestFirst,
                "No commands or session transitions recorded yet."
              )}
            </>
          );
        case "logs":
          return (
            <>
              <div className={styles.timelinePanelHeader}>
                <p className={styles.timelinePanelHint}>
                  Runtime warnings, errors, and diagnostic logs coming directly from the simulator.
                </p>
              </div>
              {renderTimelineList(logEvents, "No log messages yet.")}
            </>
          );
        case "heartbeats":
          return (
            <>
              <div className={styles.timelinePanelHeader}>
                <p className={styles.timelinePanelHint}>
                  Each item reflects a Heartbeat CALL acknowledged by the CMS.
                </p>
              </div>
              {heartbeatEventsList.length ? (
                <ul className={styles.heartbeatList}>
                  {heartbeatEventsList.map((entry) => (
                    <li key={entry.id} className={styles.heartbeatRow}>
                      <div className={styles.heartbeatMeta}>
                        <span className={styles.heartbeatTime}>
                          {new Date(entry.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit"
                          })}
                        </span>
                        <div>
                          <span className={styles.heartbeatTitle}>Heartbeat received</span>
                          <span className={styles.heartbeatSubtitle}>
                            Simulator: {entry.chargerId}
                          </span>
                        </div>
                      </div>
                      <div className={styles.heartbeatDetails}>
                        <span>
                          Connectors: {" "}
                          {entry.connectorCount !== undefined ? entry.connectorCount : "—"}
                        </span>
                        <span className={styles.heartbeatBadge}>Heartbeat</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.logPlaceholder}>No heartbeat events yet.</p>
              )}
            </>
          );
        default:
          return null;
      }
    };

    return (
      <Card className={styles.logsCard}>
        <div className={styles.cardHeader}>
          <div>
            <span className={styles.cardEyebrow}>Live feed</span>
            <h2 className={styles.cardTitle}>Event Timeline</h2>
          </div>
        <div className={styles.timelineStatusGroup}>
          <div className={styles.statusWithLabel}>
            <span className={styles.statusLabel}>Simulator</span>
            <span className={lifecycleBadgeClass}>{lifecycleStatusLabel}</span>
          </div>
          <div className={styles.statusWithLabel}>
            <span className={styles.statusLabel}>Live Feed</span>
            <span className={socketBadgeClass}>{socketStatusLabel}</span>
          </div>
          <div className={styles.heartbeatStatus}>
            <span
              className={clsx(
                styles.heartbeatDot,
                heartbeatLive ? styles.heartbeatDotLive : styles.heartbeatDotIdle
              )}
            />
            <span className={styles.heartbeatStatusLabel}>
              {heartbeatLive ? "LIVE HEARTBEAT: CONNECTED" : "LIVE HEARTBEAT: OFFLINE"}
            </span>
          </div>
        </div>
        </div>
        <div className={styles.timelineTabs}>
          {TIMELINE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={clsx(
                styles.timelineTab,
                activeTab === tab.id && styles.timelineTabActive
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div ref={containerRef} className={styles.logsBody}>
          {renderContent()}
        </div>
      </Card>
    );
  })
);

EventTimelineCard.displayName = "EventTimelineCard";
