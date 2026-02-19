/* eslint-disable @typescript-eslint/no-misused-promises */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { queryKeys } from "@/lib/queryKeys";
import {
  getLifecycleStatusMeta,
  normalizeLifecycleState,
  type StatusTone
} from "@/lib/simulatorLifecycle";
import { formatLocalTimestamp } from "@/lib/time";
import type { ConnectorTelemetrySnapshot, FaultDefinition } from "@/types";
import { ConnectorStatus, SimulatedCharger, SimulatedSession } from "@/types";
import { useSimulatorQueries } from "./hooks/useSimulatorQueries";
import { useSimulatorTelemetry } from "./hooks/useSimulatorTelemetry";
import {
  ConnectorSummary,
  ResetFlowState,
  SessionLifecycle
} from "./types/detail";
import { RemoteStartModal } from "./components/RemoteStartModal";
import { RemoteStopModal } from "./components/RemoteStopModal";
import { FaultInjectionModal } from "./components/FaultInjectionModal";
import { ResetModal } from "./components/ResetModal";
import { ForceResetModal } from "./components/ForceResetModal";
import { useNotificationStore } from "@/store/notificationStore";
import { useSimulatorCommands } from "./hooks/useSimulatorCommands";
import styles from "./SimulatorDetailPage.module.css";
import { EditSimulatorModal, SimulatorUpdatePayload } from "./components/EditSimulatorModal";
import {
  connectorStatusTone,
  normalizeConnectorStatus
} from "./utils/status";
import { SimulatorHeader } from "./components/detail/SimulatorHeader";
import { OverviewCard } from "./components/detail/OverviewCard";
import { GraphCard } from "./components/detail/GraphCard";
import { MeterCard } from "./components/detail/MeterCard";
import { ConnectorCard } from "./components/detail/ConnectorCard";
import { EventTimelineCard } from "./components/detail/EventTimelineCard";
import { useConnectorSummaries } from "./hooks/useConnectorSummaries";
import { formatNumber } from "./detail/detailHelpers";
import { pickActiveConnectorId, resolveConnectorSelection } from "./utils/selection";
import { formatCurrency } from "@/lib/currency";

type DetailResponse = SimulatedCharger;

const statusToneClassMap: Record<StatusTone, string> = {
  success: styles.statusSuccess,
  info: styles.statusInfo,
  warning: styles.statusWarning,
  danger: styles.statusDanger,
  neutral: styles.statusNeutral
};

type SimulatorDetailPageProps = {
  simulatorId: number;
};

export const SimulatorDetailPage = ({ simulatorId: simulatorIdProp }: SimulatorDetailPageProps) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pushToast = useNotificationStore((state) => state.pushToast);
  const simulatorId = Number(simulatorIdProp);
  const [resetFlow, setResetFlow] = useState<ResetFlowState | null>(null);

  const {
    data,
    isLoading,
    isError,
    cmsConnected,
    cmsHeartbeatIso,
    instancesQuery,
    meterValuesQuery,
    sessionsQuery,
    recentSessionsQuery,
    cmsConnectorIndex,
    cmsSessionsIndex,
    simulatorConnectorByPk,
    telemetrySnapshotMap,
    telemetryHistoryMap,
    faultDefinitionsQuery
  } = useSimulatorQueries(simulatorId);

  const normalizedLifecycle = normalizeLifecycleState(data?.lifecycle_state) ?? "OFFLINE";
  const [liveLifecycleState, setLiveLifecycleState] = useState(normalizedLifecycle);

  useEffect(() => {
    setLiveLifecycleState(normalizedLifecycle);
  }, [normalizedLifecycle, simulatorId]);

  const lifecycleState = liveLifecycleState ?? normalizedLifecycle;

  const refreshSimulator = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.simulatorDetail(simulatorId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.simulatorInstances });
    queryClient.invalidateQueries({ queryKey: ["simulators"] });
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
    queryClient.invalidateQueries({ queryKey: ["meter-values"] });
    if (data?.charger_id) {
      queryClient.invalidateQueries({ queryKey: ["cms-connectors", data.charger_id] });
      queryClient.invalidateQueries({ queryKey: ["cms-charging-sessions", data.charger_id] });
    }
  }, [queryClient, simulatorId, data?.charger_id]);

  const patchSimulatorDetail = useCallback(
    (mutator: (current: DetailResponse) => DetailResponse) => {
      queryClient.setQueryData<DetailResponse | undefined>(
        queryKeys.simulatorDetail(simulatorId),
        (current) => (current ? mutator(current) : current)
      );
    },
    [queryClient, simulatorId]
  );

  const patchConnectorStatus = useCallback(
    (connectorId: number, status?: string) => {
      patchSimulatorDetail((current) => {
        const connectors = current.connectors ?? [];
        let changed = false;
        const next = connectors.map((connector) => {
          if (connector.connector_id !== connectorId) {
            return connector;
          }
          const resolvedStatus =
            normalizeConnectorStatus(status ?? connector.initial_status ?? "AVAILABLE") ??
            normalizeConnectorStatus(connector.initial_status) ??
            (connector.initial_status as ConnectorStatus | undefined) ??
            "AVAILABLE";
          if (connector.initial_status === resolvedStatus) {
            return connector;
          }
          changed = true;
          return { ...connector, initial_status: resolvedStatus as ConnectorStatus };
        });
        if (!changed) {
          return current;
        }
        return { ...current, connectors: next };
      });
    },
    [patchSimulatorDetail]
  );

  const patchTelemetrySnapshot = useCallback(
    (connectorId: number, updates: Record<string, unknown>) => {
      patchSimulatorDetail((current) => {
        const key = connectorId.toString();
        const snapshot = { ...(current.telemetrySnapshot ?? {}) };
        const existing = snapshot[key] ?? { connectorId };
        const existingTx = (existing as ConnectorTelemetrySnapshot | undefined)?.transactionId;
        const nextPayload =
          updates.transactionId && existingTx && updates.transactionId !== existingTx
            ? { connectorId, ...updates }
            : { ...existing, ...updates };
        snapshot[key] = nextPayload;
        return { ...current, telemetrySnapshot: snapshot };
      });
    },
    [patchSimulatorDetail]
  );

  const {
    timelineCardRef,
    timelineEvents,
    heartbeatEvents,
    meterTimelines,
    telemetryHistory,
    sessionsByConnector,
    pendingLimitsByConnector,
    nowTs,
    selectedConnectorId,
    setSelectedConnectorId,
    dashboardOnline,
    telemetryFeed,
    activeSession,
    activeSessionConnectorId,
    activeSessionState,
    socketStatus,
    resolveMeterStart,
    hydrateConnectorHistory,
    getStartAnchor
  } = useSimulatorTelemetry({
    simulatorId,
    data,
    telemetrySnapshotMap,
    telemetryHistoryMap,
    cmsConnectorIndex,
    cmsSessionsIndex,
    simulatorConnectorByPk,
    meterValuesResults: meterValuesQuery.data?.results,
    sessionsResults: sessionsQuery.data?.results,
    recentSessionsResults: recentSessionsQuery.data?.results,
    instancesResults: instancesQuery.data?.results,
    lifecycleState,
    setLiveLifecycleState,
    pushToast,
    queryClient,
    refreshSimulator,
    patchConnectorStatus,
    patchTelemetrySnapshot,
    setResetFlow,
    resetFlow
  });

  const userHasSelectedRef = useRef(false);


  const resolveConnectorNumber = useCallback(
    (session: SimulatedSession): number | null => {
      const mapped = simulatorConnectorByPk.get(session.connector);
      if (mapped) {
        return mapped.connector_id;
      }
      const metadataConnectorId =
        typeof session.metadata === "object" && session.metadata !== null
          ? (session.metadata as { connector_id?: number }).connector_id
          : undefined;
      const fallback = Number(metadataConnectorId ?? 0);
      if (!Number.isFinite(fallback) || fallback <= 0) {
        return null;
      }
      return fallback;
    },
    [simulatorConnectorByPk]
  );

  const getSessionStatusLabel = useCallback((state: SessionLifecycle): string => {
    switch (state) {
      case "pending":
        return "Pending";
      case "authorized":
        return "Authorized";
      case "charging":
        return "Charging";
      case "finishing":
        return "Finishing";
      case "completed":
        return "Completed";
      case "errored":
        return "Error";
      case "timeout":
        return "Timeout";
      default:
        return "Idle";
    }
  }, []);

  const getSessionStatusClass = useCallback((state: SessionLifecycle): string => {
    switch (state) {
      case "pending":
        return styles.statusPending;
      case "authorized":
        return styles.statusAuthorized;
      case "charging":
        return styles.statusCharging;
      case "finishing":
        return styles.statusFinishing;
      case "completed":
        return styles.statusCompleted;
      case "errored":
        return styles.statusErrored;
      case "timeout":
        return styles.statusTimeout;
      default:
        return styles.statusIdle;
    }
  }, []);

  const {
    connectorsSummary,
    connectorSelectOptions,
    defaultConnectorId,
    connectorsConfigured,
    connectorsForCards,
    connectorBaselines,
    connectorOptions
  } = useConnectorSummaries({
    data,
    meterTimelines,
    sessionsByConnector,
    pendingLimits: pendingLimitsByConnector,
    nowTs,
    cmsSessionsIndex,
    cmsConnectorIndex,
    defaultPricePerKwh: data?.price_per_kwh ?? null,
    resolveMeterStart,
    getStartAnchor,
    getSessionStatusLabel,
    getSessionStatusClass,
    activeSessionConnectorId,
    activeSessionState
  });

  const preferredConnectorId = useMemo(() => {
    if (!connectorsSummary.length) return null;
    const activeId = pickActiveConnectorId(connectorsSummary, activeSessionConnectorId);
    if (activeId !== null) return activeId;
    return connectorsSummary[0]?.connectorId ?? null;
  }, [connectorsSummary, activeSessionConnectorId]);

  const connectorTargetSelectId = useMemo(
    () => `connector-target-${simulatorId}`,
    [simulatorId]
  );

  const actionConnectorId = useMemo(
    () => (selectedConnectorId !== null ? selectedConnectorId : preferredConnectorId ?? defaultConnectorId),
    [selectedConnectorId, preferredConnectorId, defaultConnectorId]
  );

  useEffect(() => {
    connectorsSummary.forEach((summary) => {
      if (
        (summary.sessionState === "completed" || summary.sessionState === "finishing") &&
        summary.transactionKey &&
        (!telemetryHistory[summary.connectorId] || telemetryHistory[summary.connectorId].length <= 1)
      ) {
        void hydrateConnectorHistory(summary.connectorId, summary.transactionKey);
      }
    });
  }, [connectorsSummary, telemetryHistory, hydrateConnectorHistory]);

  useEffect(() => {
    if (!connectorsSummary.length) {
      if (selectedConnectorId !== null) {
        setSelectedConnectorId(null);
      }
      userHasSelectedRef.current = false;
      return;
    }
    const validIds = connectorsSummary.map((s) => s.connectorId);
    const selectedValid = selectedConnectorId !== null && validIds.includes(selectedConnectorId);
    if (userHasSelectedRef.current && selectedValid) {
      return;
    }
    const nextId = resolveConnectorSelection({
      preferredConnectorId,
      selectedConnectorId,
      validConnectorIds: validIds,
      userHasSelected: userHasSelectedRef.current
    });
    if (nextId !== null && nextId !== selectedConnectorId) {
      setSelectedConnectorId(nextId);
    }
  }, [connectorsSummary, preferredConnectorId, selectedConnectorId]);

  const primaryConnector =
    (selectedConnectorId
      ? connectorsSummary.find((summary) => summary.connectorId === selectedConnectorId)
      : null) ??
    connectorsSummary.find((summary) => summary.samples.length > 0) ??
    connectorsSummary[0] ??
    null;
  const graphIsFrozen =
    primaryConnector?.sessionState === "completed" ||
    primaryConnector?.sessionState === "finishing" ||
    (primaryConnector?.lastSampleAt ? nowTs - Date.parse(primaryConnector.lastSampleAt) > 15_000 : false);
  const lastSampleIsStale =
    primaryConnector?.lastSampleAt && !graphIsFrozen
      ? nowTs - Date.parse(primaryConnector.lastSampleAt) > 15_000
      : false;

  const connectorSummaryMap = useMemo(
    () => Object.fromEntries(connectorsSummary.map((summary) => [summary.connectorId, summary])),
    [connectorsSummary]
  );

  const handleSelectConnector = useCallback((id: number | null) => {
    if (id === null) return;
    userHasSelectedRef.current = true;
    setSelectedConnectorId(id);
  }, [setSelectedConnectorId]);

  useEffect(() => {
    timelineCardRef.current?.reset();
  }, [simulatorId]);

  const telemetryFeedWithStatus = useMemo(() => {
    return telemetryFeed.map((entry) => {
      const status = entry.status as SessionLifecycle;
      const statusLabel = getSessionStatusLabel(status);
      const statusClass = getSessionStatusClass(status);
      const startKwh = connectorBaselines.get(entry.connectorId);
      const deliveredKwh =
        entry.energyKwh !== null && startKwh !== undefined ? Math.max((entry.energyKwh ?? 0) - startKwh, 0) : entry.energyKwh;
      return {
        ...entry,
        energyKwh: deliveredKwh,
        statusLabel,
        statusClass
      };
    });
  }, [telemetryFeed, getSessionStatusClass, getSessionStatusLabel, connectorBaselines]);

  useEffect(() => {
    timelineCardRef.current?.syncTelemetry(telemetryFeedWithStatus);
  }, [telemetryFeedWithStatus]);

  useEffect(() => {
    timelineCardRef.current?.syncTimeline(timelineEvents);
  }, [timelineEvents]);

  useEffect(() => {
    timelineCardRef.current?.syncHeartbeats(heartbeatEvents);
  }, [heartbeatEvents]);

  const activeConnectorId = primaryConnector?.connectorId ?? selectedConnectorId;
  const liveGraphSamples = primaryConnector?.samples ?? [];
  const resolvedConnectorId =
    typeof activeConnectorId === "number" && Number.isFinite(activeConnectorId)
      ? activeConnectorId
      : null;
  const frozenGraphSamples =
    graphIsFrozen && resolvedConnectorId !== null ? telemetryHistory[resolvedConnectorId] ?? [] : [];
  const graphSamples =
    graphIsFrozen && frozenGraphSamples.length ? frozenGraphSamples : liveGraphSamples;

  const resetStatusLabel = useMemo(() => {
    if (!resetFlow) {
      return null;
    }
    if (resetFlow.stage === "requested") {
      return resetFlow.type === "Force" ? "Force reset queued…" : "Reset queued…";
    }
    if (resetFlow.stage === "rebooting") {
      if (resetFlow.type === "Soft") {
        return "Restarting…";
      }
      return resetFlow.type === "Force" ? "Force rebooting…" : "Rebooting…";
    }
    return "Reconnected";
  }, [resetFlow]);

  const latestInstance = useMemo(() => {
    const instances = instancesQuery.data?.results ?? [];
    const scoped = instances.filter((instance) => instance.sim === simulatorId);
    if (!scoped.length) {
      return null;
    }
    const ordered = [...scoped].sort((a, b) => {
      const aTime = a.created_at ? Date.parse(a.created_at) : 0;
      const bTime = b.created_at ? Date.parse(b.created_at) : 0;
      return bTime - aTime;
    });
    return ordered[0] ?? null;
  }, [instancesQuery.data?.results, simulatorId]);

  const {
    commandBusy,
    commandConnectorId,
    showStartModal,
    showStopModal,
    showFaultModal,
    showResetModal,
    showForceResetModal,
    showEditModal,
    setShowStartModal,
    setShowStopModal,
    setShowFaultModal,
    setShowResetModal,
    setShowForceResetModal,
    setShowEditModal,
    editBusy,
    faultPending,
    handleRemoteStart,
    handleRemoteStop,
    handleConnectRequest,
    handleDisconnectRequest,
    handlePlugConnector,
    handleUnplugConnector,
    handleFaultInjection,
    handleResetCharger,
    handleForceReset,
    handleSimulatorUpdate,
    handleQuickStop
  } = useSimulatorCommands({
    simulatorId,
    data,
    connectorsSummary,
    actionConnectorId,
    activeSession,
    resolveConnectorNumber,
    refreshSimulator,
    patchConnectorStatus,
    setResetFlow
  });

  const renderSocketStatusLabel = useCallback((status: string): string => {
    switch (status) {
      case "open":
        return "Connected";
      case "connecting":
        return "Connecting…";
      case "error":
        return "Error";
      case "closed":
        return "Offline";
      default:
        return "Offline";
    }
  }, []);

  const resolveSocketStatusClass = useCallback((status: string): string => {
    if (status === "open") {
      return styles.socketStatusLive;
    }
    if (status === "connecting") {
      return styles.socketStatusPending;
    }
    if (status === "error") {
      return styles.socketStatusError;
    }
    return styles.socketStatusIdle;
  }, []);


  const resolveConnectorChipClass = (status?: ConnectorStatus | string): string => {
    const tone = connectorStatusTone(status);
    if (tone === "success") return styles.connectorChipCharging;
    if (tone === "danger") return styles.connectorChipFaulted;
    if (tone === "warning") return styles.connectorChipUnavailable;
    if (tone === "info") return styles.connectorChipReserved;
    return styles.connectorChipAvailable;
  };

  if (!Number.isFinite(simulatorId)) {
    return (
      <Card className={styles.errorCard}>
        <p>Invalid simulator identifier.</p>
        <Button variant="secondary" onClick={() => router.push("/simulators")}>Go back</Button>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className={styles.errorCard}>
        <p>Loading simulator…</p>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card className={styles.errorCard}>
        <p>Unable to load simulator detail.</p>
        <Button variant="secondary" onClick={() => router.push("/simulators")}>Back to list</Button>
      </Card>
    );
  }

  const socketStatusLabel = renderSocketStatusLabel(socketStatus);
  const socketBadgeClass = clsx(styles.connectionBadge, resolveSocketStatusClass(socketStatus));
  const liveFeedLabel = dashboardOnline ? "Connected" : socketStatusLabel;
  const liveFeedBadgeClass = dashboardOnline
    ? clsx(styles.connectionBadge, styles.socketStatusLive)
    : socketBadgeClass;
  const lifecycleMeta = getLifecycleStatusMeta(lifecycleState);
  const lifecycleToneClass = statusToneClassMap[lifecycleMeta.tone] ?? styles.statusNeutral;
  const lifecycleBadgeClass = clsx(styles.connectionBadge, lifecycleToneClass);
  const simulatorTitle = data.alias ?? data.charger_id ?? `Simulator #${data.id}`;
  const simulatorSubtitle = `${data.charger_id ?? `Charger ${data.charger}`}${
    data.alias ? ` · Simulator #${data.id}` : ""
  }`;
  const lastHeartbeatIso =
    cmsHeartbeatIso ??
    heartbeatEvents[0]?.timestamp ??
    data?.latest_instance_last_heartbeat ??
    latestInstance?.last_heartbeat ??
    null;
  const lastHeartbeatLabel = lastHeartbeatIso
    ? new Date(lastHeartbeatIso).toLocaleString()
    : "Waiting for heartbeat";
  const overviewFields = [
    { label: "CMS Status", value: cmsConnected ? "Online" : "Offline" },
    { label: "Protocol", value: data.protocol_variant?.toUpperCase() ?? "—" },
    { label: "Heartbeat Interval", value: `${data.default_heartbeat_interval}s` },
    { label: "Status Interval", value: `${data.default_status_interval}s` },
    { label: "Firmware", value: data.firmware_baseline ?? "Unknown" },
    { label: "Meter Interval", value: `${data.default_meter_value_interval}s` },
    { label: "TLS Required", value: data.require_tls ? "Yes" : "No" }
  ];
  const capabilitiesJson =
    data.smart_charging_profile && Object.keys(data.smart_charging_profile).length
      ? JSON.stringify(data.smart_charging_profile, null, 2)
      : "{}";
  const faultCatalog = (faultDefinitionsQuery.data as { results?: FaultDefinition[] } | undefined)?.results ?? [];
  const faultButtonDisabled =
    !connectorsConfigured || !faultCatalog.length || faultDefinitionsQuery.isLoading || faultDefinitionsQuery.isError;
  const ocppCapabilities =
    data.ocpp_capabilities?.length ? data.ocpp_capabilities : ["RemoteStartStop", "Diagnostics"];
  const isCharging = lifecycleState === "CHARGING";
  const canInitiateStart = cmsConnected && lifecycleState === "CONNECTED";
  const toggleDisabledBase = commandBusy !== null || (!isCharging && !canInitiateStart);
  const toggleDisabled = toggleDisabledBase || showStartModal || commandBusy === "start";
  const toggleLabel =
    commandBusy === "start"
      ? "Starting…"
      : commandBusy === "stop"
        ? "Stopping…"
        : isCharging
          ? "Stop Charging"
          : "Start Charging";
  const startToggleHint = (() => {
    if (isCharging) {
      return undefined;
    }
    if (lifecycleState === "OFFLINE") {
      return "Charger offline — cannot start session.";
    }
    if (!cmsConnected) {
      return "CMS offline — reconnect before starting a session.";
    }
    if (lifecycleState !== "CONNECTED") {
      return "Simulator runtime is not connected yet.";
    }
    return undefined;
  })();
  const handleToggleClick = () => {
    if (isCharging) {
      void handleQuickStop();
    } else {
      setShowStartModal(true);
    }
  };
  const latestInstanceStatus = latestInstance?.status ?? data.latest_instance_status ?? null;
  const hasActiveRuntime =
    latestInstanceStatus === "running" || latestInstanceStatus === "pending";
  const hideConnectionControls =
    lifecycleState === "OFFLINE" || lifecycleState === "ERROR" || lifecycleState === "CHARGING";
  const needsReconnect = !cmsConnected && !hideConnectionControls;
  const showConnectControl =
    !hideConnectionControls &&
    (lifecycleState === "POWERED_ON" || lifecycleState === "CONNECTING" || needsReconnect);
  const disconnectLifecycleAllowed =
    lifecycleState === "CONNECTING" ||
    lifecycleState === "CONNECTED" ||
    lifecycleState === "POWERED_ON";
  const showDisconnectControl =
    !hideConnectionControls && hasActiveRuntime && disconnectLifecycleAllowed;
  const connectButtonLabel =
    commandBusy === "connect" || lifecycleState === "CONNECTING"
      ? "Connecting…"
      : needsReconnect
        ? "Reconnect"
        : "Connect";
  const disconnectButtonLabel =
    commandBusy === "disconnect" || lifecycleState === "CONNECTING" ? "Disconnecting…" : "Disconnect";
  const connectControlDisabled = commandBusy !== null || lifecycleState === "CONNECTING";
  const disconnectControlDisabled = commandBusy !== null || !hasActiveRuntime;
  const connectControlTitle =
    lifecycleState === "CONNECTING"
      ? "CMS connection in progress."
      : needsReconnect
        ? "CMS heartbeat missing — reconnect to resume telemetry."
        : "Connect the simulator to the CMS.";
  const disconnectControlTitle = (() => {
    if (!hasActiveRuntime) {
      return "No active simulator runtime to disconnect.";
    }
    if (lifecycleState === "CONNECTING") {
      return "Cancel the pending CMS connection.";
    }
    if (commandBusy === "disconnect") {
      return "Disconnect request already pending.";
    }
    return undefined;
  })();
  const timelinePlaceholderMessage = cmsConnected
    ? "Waiting for live charger activity."
    : "Connect the simulator to stream live charger events.";
  const meterPlaceholderMessage = meterValuesQuery.isLoading
    ? "Loading meter data…"
    : connectorsConfigured
      ? "Waiting for simulator telemetry."
      : "No connectors configured.";
  const meterInfoFields = primaryConnector
    ? [
        {
          label: "Energy (kWh)",
          value: `${primaryConnector.energyKwh.toFixed(3)}`,
          hint:
            primaryConnector.deltaKwh !== null
              ? `+${primaryConnector.deltaKwh.toFixed(3)} kWh`
              : null
        },
        {
          label: "Meter Start",
          value: `${primaryConnector.meterStartKwh.toFixed(3)} kWh`,
          hint: `${(primaryConnector.meterStartKwh * 1000).toFixed(0)} Wh`
        },
        {
          label: "Meter Stop",
          value: `${primaryConnector.meterStopKwh.toFixed(3)} kWh`,
          hint: `${(primaryConnector.meterStopKwh * 1000).toFixed(0)} Wh`
        },
        (() => {
          const limitType = primaryConnector.limitType;
          const userLimit = primaryConnector.userLimit;
          if (!limitType || userLimit === null || userLimit === undefined) {
            return { label: "Limit", value: "None" };
          }
          if (limitType === "KWH") {
            return { label: "Limit", value: `${userLimit.toFixed(3)} kWh` };
          }
          if (limitType === "AMOUNT") {
            return { label: "Limit", value: formatCurrency(userLimit) };
          }
          return { label: "Limit", value: "None" };
        })(),
        {
          label: "Duration",
          value: primaryConnector.duration ?? "—"
        },
        {
          label: "Last Sample",
          value: formatLocalTimestamp(primaryConnector.lastSampleAt, { withSeconds: true })
        },
        {
          label: "Power",
          value:
            typeof primaryConnector.powerKw === "number"
              ? `${formatNumber(primaryConnector.powerKw, { digits: 2 })} kW`
              : "—"
        },
        {
          label: "Current",
          value:
            typeof primaryConnector.current === "number"
              ? `${formatNumber(primaryConnector.current, { digits: 1 })} A`
              : "—"
        },
        {
          label: "ID Tag",
          value: primaryConnector.idTag ?? "—"
        }
      ]
    : [];
  const meterContextLabel = primaryConnector
    ? `Connector #${primaryConnector.connectorId} · ${
        primaryConnector.transactionId ? `CMS Tx ${primaryConnector.transactionId}` : "No CMS Tx"
      } · ${primaryConnector.statusLabel}`
    : null;

  return (
    <div className={styles.page}>
      <SimulatorHeader
        simulatorTitle={simulatorTitle}
        simulatorSubtitle={simulatorSubtitle}
        lifecycleBadgeClass={lifecycleBadgeClass}
        lifecycleLabel={lifecycleMeta.label}
        onBack={() => router.push("/simulators")}
        onEdit={() => setShowEditModal(true)}
        editBusy={editBusy}
      />
      <section className={styles.detailGrid}>
        <OverviewCard
          isCharging={isCharging}
          toggleDisabled={toggleDisabled}
          toggleLabel={toggleLabel}
          startToggleHint={startToggleHint}
          onToggleClick={handleToggleClick}
          onShowStopModal={() => setShowStopModal(true)}
          cmsConnected={cmsConnected}
          showConnectControl={showConnectControl}
          showDisconnectControl={showDisconnectControl}
          connectControlDisabled={connectControlDisabled}
          disconnectControlDisabled={disconnectControlDisabled}
          connectControlTitle={connectControlTitle}
          disconnectControlTitle={disconnectControlTitle}
          connectButtonLabel={connectButtonLabel}
          disconnectButtonLabel={disconnectButtonLabel}
          onConnect={handleConnectRequest}
          onDisconnect={handleDisconnectRequest}
          overviewFields={overviewFields}
          lastHeartbeatLabel={lastHeartbeatLabel}
          commandBusy={commandBusy}
        />
        <ConnectorCard
          connectorsForCards={connectorsForCards}
          connectorSelectOptions={connectorSelectOptions}
          actionConnectorId={actionConnectorId}
          connectorTargetSelectId={connectorTargetSelectId}
          lifecycleBadgeClass={lifecycleBadgeClass}
          lifecycleLabel={lifecycleMeta.label}
          commandBusy={commandBusy}
          commandConnectorId={commandConnectorId}
          resetFlow={resetFlow}
          resetStatusLabel={resetStatusLabel}
          faultButtonDisabled={faultButtonDisabled}
          ocppCapabilities={ocppCapabilities}
          capabilitiesJson={capabilitiesJson}
          resolveConnectorChipClass={resolveConnectorChipClass}
          onSelectConnector={(id) => handleSelectConnector(id)}
          onPlug={(id) => void handlePlugConnector(id)}
          onUnplug={(id) => void handleUnplugConnector(id)}
          onShowResetModal={() => setShowResetModal(true)}
          onShowForceResetModal={() => setShowForceResetModal(true)}
          onShowFaultModal={() => {
            if (faultDefinitionsQuery.isError) {
              pushToast({
                title: "Fault catalog unavailable",
                description: "Retry after reloading the page.",
                level: "warning",
                timeoutMs: 3500
              });
              return;
            }
            setShowFaultModal(true);
          }}
        />
        <MeterCard
          primaryConnector={primaryConnector}
          meterContextLabel={meterContextLabel}
          meterInfoFields={meterInfoFields}
          meterPlaceholderMessage={meterPlaceholderMessage}
          graphIsFrozen={graphIsFrozen}
          lastSampleIsStale={lastSampleIsStale}
          statusToneClassMap={statusToneClassMap}
        />
        <GraphCard
          connectorsSummary={connectorsSummary}
          activeConnectorId={activeConnectorId}
          primaryConnector={primaryConnector}
          graphSamples={graphSamples}
          lifecycleState={lifecycleState}
          graphIsFrozen={graphIsFrozen}
          onSelectConnector={(id) => handleSelectConnector(id)}
        />
        <section className={styles.timelineSection}>
          <EventTimelineCard
            ref={timelineCardRef}
            meterPlaceholderMessage={meterPlaceholderMessage}
            timelinePlaceholderMessage={timelinePlaceholderMessage}
            lifecycleBadgeClass={lifecycleBadgeClass}
            lifecycleStatusLabel={lifecycleMeta.label}
            socketBadgeClass={liveFeedBadgeClass}
            socketStatusLabel={liveFeedLabel}
            socketStatus={dashboardOnline ? "open" : socketStatus}
            heartbeatInterval={data.default_heartbeat_interval ?? 60}
          />
        </section>
      </section>
      <RemoteStartModal
        open={showStartModal}
        connectors={connectorOptions}
        busy={commandBusy === "start"}
        initialConnectorId={actionConnectorId ?? undefined}
        summaryByConnector={connectorSummaryMap}
        defaultPricePerKwh={data.price_per_kwh ?? null}
        onCancel={() => setShowStartModal(false)}
        onSubmit={handleRemoteStart}
      />
      <RemoteStopModal
        open={showStopModal}
        connectors={connectorOptions}
        busy={commandBusy === "stop"}
        onCancel={() => setShowStopModal(false)}
        onSubmit={handleRemoteStop}
      />
      <FaultInjectionModal
        open={showFaultModal}
        onClose={() => setShowFaultModal(false)}
        connectors={connectorOptions}
        definitions={faultCatalog}
        submitting={faultPending}
        onSubmit={handleFaultInjection}
      />
      <ForceResetModal
        open={showForceResetModal}
        busy={commandBusy === "force-reset"}
        onCancel={() => setShowForceResetModal(false)}
        onConfirm={handleForceReset}
      />
      <ResetModal
        open={showResetModal}
        busy={commandBusy === "reset"}
        onCancel={() => setShowResetModal(false)}
        onSubmit={handleResetCharger}
      />
      <EditSimulatorModal
        open={showEditModal}
        simulator={data}
        busy={editBusy}
        onCancel={() => setShowEditModal(false)}
        onSubmit={handleSimulatorUpdate}
      />
    </div>
  );
};
