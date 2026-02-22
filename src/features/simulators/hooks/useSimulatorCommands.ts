import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTenantApi } from "@/hooks/useTenantApi";
import { endpoints } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";
import { pickCanonicalTransactionId } from "@/lib/transactions";
import { ApiError } from "@/lib/api";
import { ConnectorSummary } from "../types/detail";
import { SimulatedCharger, SimulatedSession } from "@/types";
import { ResetFlowStage, ResetFlowState } from "../types/detail";
import { connectorHasActiveSession, isConnectorPlugged, normalizeConnectorStatus } from "../utils/status";
import { useNotificationStore } from "@/store/notificationStore";
import { SimulatorUpdatePayload } from "../components/EditSimulatorModal";

type UseSimulatorCommandsArgs = {
  simulatorId: number;
  data: SimulatedCharger | undefined;
  connectorsSummary: ConnectorSummary[];
  actionConnectorId: number | null;
  activeSession: SimulatedSession | null;
  resolveConnectorNumber: (session: SimulatedSession) => number | null;
  refreshSimulator: () => void;
  patchConnectorStatus: (connectorId: number, status?: string) => void;
  setResetFlow: (state: ResetFlowState | null | ((current: ResetFlowState | null) => ResetFlowState | null)) => void;
};

export const useSimulatorCommands = ({
  simulatorId,
  data,
  connectorsSummary,
  actionConnectorId,
  activeSession,
  resolveConnectorNumber,
  refreshSimulator,
  patchConnectorStatus,
  setResetFlow
}: UseSimulatorCommandsArgs) => {
  const simDebug = useCallback((label: string, payload?: unknown) => {
    const enabled =
      process.env.NEXT_PUBLIC_SIM_DEBUG === "1" ||
      process.env.NODE_ENV !== "production" ||
      (typeof window !== "undefined" && window.localStorage.getItem("sim-debug") === "1");
    if (!enabled) return;
    // eslint-disable-next-line no-console
    console.info(`[simulator][${label}]`, payload ?? "");
  }, []);

  const api = useTenantApi();
  const queryClient = useQueryClient();
  const pushToast = useNotificationStore((state) => state.pushToast);

  const [commandBusy, setCommandBusy] = useState<
    "start" | "stop" | "reset" | "force-reset" | "connect" | "disconnect" | "plug" | "unplug" | null
  >(null);
  const [commandConnectorId, setCommandConnectorId] = useState<number | null>(null);
  const [showStartModal, setShowStartModal] = useState(false);
  const [showStopModal, setShowStopModal] = useState(false);
  const [showFaultModal, setShowFaultModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showForceResetModal, setShowForceResetModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [faultPending, setFaultPending] = useState(false);

  const extractErrorMessage = useCallback((error: unknown): string => {
    if (error instanceof ApiError) {
      return error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return "Request failed";
  }, []);

  const handleRemoteStart = useCallback(
    async (payload: { connectorId: number; idTag: string; userLimit?: number | null; limitType?: "KWH" | "AMOUNT" | null }) => {
      if (!data) return;
      if (!(data.cms_online ?? data.cms_present)) {
        const offlineMessage = "CMS connection is offline. Reconnect the simulator before starting a session.";
        pushToast({
          title: "CMS offline",
          description: offlineMessage,
          level: "warning",
          timeoutMs: 4000
        });
        throw new Error(offlineMessage);
      }
      const targetConnectorId = payload.connectorId;
      const connectorSummary = connectorsSummary.find((summary) => summary.connectorId === targetConnectorId);
      const hasActiveSession = connectorHasActiveSession({
        sessionState: connectorSummary?.sessionState,
        sessionActive: connectorSummary?.activeSession,
        connectorId: connectorSummary?.connectorId,
        activeSessionConnectorId: activeSession ? resolveConnectorNumber(activeSession) : null,
        activeSessionState: activeSession?.state ?? null
      });
      if (hasActiveSession) {
        throw new Error(`Connector ${targetConnectorId} already has an active session.`);
      }
      setCommandBusy("start");
      simDebug("remoteStart:dispatch", {
        simulatorId: data.id,
        connectorId: payload.connectorId,
        idTag: payload.idTag,
        limitType: payload.limitType,
        userLimit: payload.userLimit
      });
      try {
        await api.request(endpoints.simulators.remoteStart(data.id), {
          method: "POST",
          body: {
            connectorId: payload.connectorId,
            idTag: payload.idTag,
            ...(payload.limitType ? { limitType: payload.limitType } : {}),
            ...(payload.userLimit !== undefined ? { userLimit: payload.userLimit } : {})
          }
        });
        // Optimistically mark as Preparing only after RemoteStart succeeds.
        const connectorStatus = normalizeConnectorStatus(
          connectorSummary?.connectorStatus ?? connectorSummary?.connector?.initial_status ?? "AVAILABLE"
        );
        if (connectorStatus !== "PREPARING") {
          await api.request(endpoints.simulators.statusUpdate(data.id), {
            method: "POST",
            body: { connectorId: targetConnectorId, status: "Preparing" }
          });
          patchConnectorStatus(targetConnectorId, "PREPARING");
        }
        simDebug("remoteStart:accepted", { simulatorId: data.id, connectorId: targetConnectorId });
        pushToast({
          title: "Remote start dispatched",
          description: "RemoteStartTransaction has been queued for the charger.",
          level: "success",
          timeoutMs: 3500
        });
        setShowStartModal(false);
        refreshSimulator();
      } catch (error) {
        const message = extractErrorMessage(error);
        simDebug("remoteStart:error", { simulatorId: data?.id, connectorId: targetConnectorId, message, error });
        throw new Error(message);
      } finally {
        setCommandBusy(null);
      }
    },
    [api, data, extractErrorMessage, pushToast, refreshSimulator]
  );

  const handleRemoteStop = useCallback(
    async (payload: { connectorId?: number; transactionId?: string }) => {
      if (!data) return;
      if (!payload.connectorId && !payload.transactionId) {
        throw new Error("Provide a connector or transaction ID.");
      }
      setCommandBusy("stop");
      const attemptRemoteStop = async () =>
        api.request(endpoints.simulators.remoteStop(data.id), {
          method: "POST",
          body: {
            ...(payload.connectorId ? { connectorId: payload.connectorId } : {}),
            ...(payload.transactionId ? { transactionId: payload.transactionId } : {})
          }
        });

      try {
        await attemptRemoteStop();
        pushToast({
          title: "Remote stop dispatched",
          description: "RemoteStopTransaction has been queued for the charger.",
          level: "success",
          timeoutMs: 3500
        });
        setShowStopModal(false);
        refreshSimulator();
        if (typeof window !== "undefined") {
          window.setTimeout(() => refreshSimulator(), 2000);
          window.setTimeout(() => refreshSimulator(), 6000);
        }
      } catch (error) {
        const asApiError = error as ApiError;
        // If stop was rejected due to lifecycle, try a connector-only fallback (idempotent)
        if (asApiError?.status === 400 && payload.transactionId && payload.connectorId) {
          try {
            await api.request(endpoints.simulators.remoteStop(data.id), {
              method: "POST",
              body: { connectorId: payload.connectorId }
            });
            pushToast({
              title: "Connector stop queued",
              description: "Fallback stop issued using connector only.",
              level: "info",
              timeoutMs: 4500
            });
            setShowStopModal(false);
            refreshSimulator();
            return;
          } catch (fallbackErr) {
            // fall through to surface original error
            error = fallbackErr;
          }
        }
        const message = extractErrorMessage(error);
        if (asApiError?.status === 400) {
          pushToast({
            title: "Stop rejected",
            description: "Charger is not in CHARGING state. Reconnect, then retry stop.",
            level: "warning",
            timeoutMs: 5000
          });
        }
        throw new Error(message);
      } finally {
        setCommandBusy(null);
      }
    },
    [api, data, extractErrorMessage, pushToast, refreshSimulator]
  );

  const handleConnectRequest = useCallback(async () => {
    if (!data) return;
    setCommandBusy("connect");
    try {
      await api.request(endpoints.simulators.connect(data.id), { method: "POST" });
      pushToast({
        title: "Connecting to CMS",
        description: "BootNotification will be replayed shortly.",
        level: "info",
        timeoutMs: 3500
      });
    } catch (error) {
      const message = extractErrorMessage(error);
      pushToast({ title: "Connect failed", description: message, level: "error" });
    } finally {
      refreshSimulator();
      setCommandBusy(null);
    }
  }, [api, data, extractErrorMessage, pushToast, refreshSimulator]);

  const handleDisconnectRequest = useCallback(async () => {
    if (!data) return;
    setCommandBusy("disconnect");
    try {
      await api.request(endpoints.simulators.disconnect(data.id), { method: "POST" });
      pushToast({
        title: "Disconnect requested",
        description: "Simulator WebSocket will close shortly.",
        level: "info",
        timeoutMs: 3500
      });
    } catch (error) {
      const message = extractErrorMessage(error);
      pushToast({ title: "Disconnect failed", description: message, level: "error" });
    } finally {
      refreshSimulator();
      setCommandBusy(null);
    }
  }, [api, data, extractErrorMessage, pushToast, refreshSimulator]);

  const resolveTargetConnector = useCallback(
    () =>
      Number(
        actionConnectorId ??
          connectorsSummary[0]?.connectorId ??
          data?.connectors?.[0]?.connector_id
      ),
    [actionConnectorId, connectorsSummary, data?.connectors]
  );

  const handlePlugConnector = useCallback(
    async (connectorId?: number) => {
      if (!data) return;
      const targetConnectorId = Number(connectorId ?? resolveTargetConnector());
      if (!Number.isFinite(targetConnectorId)) {
        pushToast({
          title: "No connector available",
          description: "Add a connector to the simulator before setting it to Preparing.",
          level: "warning"
        });
        return;
      }
      setCommandConnectorId(targetConnectorId);
      setCommandBusy("plug");
      try {
        await api.request(endpoints.simulators.statusUpdate(data.id), {
          method: "POST",
          body: { connectorId: targetConnectorId, status: "Preparing" }
        });
        patchConnectorStatus(targetConnectorId, "PREPARING");
        queryClient.invalidateQueries({ queryKey: queryKeys.simulatorDetail(simulatorId) });
        pushToast({
          title: "Connector set to Preparing",
          description: `Connector #${targetConnectorId} is now plugged in.`,
          level: "success",
          timeoutMs: 3000
        });
        if (typeof window !== "undefined") {
          window.setTimeout(() => refreshSimulator(), 1200);
        }
      } catch (error) {
        const message = extractErrorMessage(error);
        pushToast({ title: "Plug-in failed", description: message, level: "error" });
      } finally {
        setCommandConnectorId(null);
        setCommandBusy(null);
      }
    },
    [
      actionConnectorId,
      api,
      connectorsSummary,
      data,
      extractErrorMessage,
      patchConnectorStatus,
      pushToast,
      queryClient,
      refreshSimulator,
      resolveTargetConnector,
      simulatorId
    ]
  );

  const handleUnplugConnector = useCallback(
    async (connectorId?: number) => {
      if (!data) return;
      const targetConnectorId = Number(connectorId ?? resolveTargetConnector());
      if (!Number.isFinite(targetConnectorId)) {
        pushToast({
          title: "No connector available",
          description: "Add a connector to the simulator before setting it to Available.",
          level: "warning"
        });
        return;
      }
      setCommandConnectorId(targetConnectorId);
      setCommandBusy("unplug");
      const connectorSummary = connectorsSummary.find((summary) => summary.connectorId === targetConnectorId);
      const isPlugged = isConnectorPlugged(
        connectorSummary?.connectorStatus ?? connectorSummary?.connector?.initial_status
      );
      const hasActiveSession = connectorHasActiveSession({
        sessionState: connectorSummary?.sessionState,
        sessionActive: connectorSummary?.activeSession,
        connectorId: targetConnectorId,
        activeSessionConnectorId: activeSession ? resolveConnectorNumber(activeSession) : null,
        activeSessionState: activeSession?.state ?? null
      });
      if (!isPlugged) {
        setCommandConnectorId(null);
        setCommandBusy(null);
        return;
      }
      try {
        if (hasActiveSession) {
          await api.request(endpoints.simulators.unplug(data.id), {
            method: "POST",
            body: { connectorId: targetConnectorId }
          });
          queryClient.invalidateQueries({ queryKey: queryKeys.simulatorDetail(simulatorId) });
          pushToast({
            title: "Unplug requested",
            description: `StopTransaction will be sent for connector #${targetConnectorId}.`,
            level: "success",
            timeoutMs: 3000
          });
        } else {
          await api.request(endpoints.simulators.statusUpdate(data.id), {
            method: "POST",
            body: { connectorId: targetConnectorId, status: "Available" }
          });
          patchConnectorStatus(targetConnectorId, "AVAILABLE");
          queryClient.invalidateQueries({ queryKey: queryKeys.simulatorDetail(simulatorId) });
          pushToast({
            title: "Connector set to Available",
            description: `Connector #${targetConnectorId} unplugged.`,
            level: "success",
            timeoutMs: 3000
          });
        }
        if (typeof window !== "undefined") {
          window.setTimeout(() => refreshSimulator(), 1200);
        }
      } catch (error) {
        const message = extractErrorMessage(error);
        pushToast({ title: "Unplug failed", description: message, level: "error" });
        refreshSimulator();
      } finally {
        setCommandConnectorId(null);
        setCommandBusy(null);
      }
    },
    [
      actionConnectorId,
      activeSession,
      api,
      connectorsSummary,
      data,
      extractErrorMessage,
      patchConnectorStatus,
      pushToast,
      queryClient,
      refreshSimulator,
      resolveConnectorNumber,
      resolveTargetConnector,
      simulatorId
    ]
  );

  const handleFaultInjection = useCallback(
    async (payload: { connectorId: number; faultCode: string; status: string }) => {
      if (!data) {
        return;
      }
      setFaultPending(true);
      try {
        await api.request(endpoints.simulators.faultInjection(data.id), {
          method: "POST",
          body: {
            faultCode: payload.faultCode,
            connectorId: payload.connectorId,
            status: payload.status
          }
        });
        pushToast({
          title: "Fault injected",
          description: `Sent ${payload.faultCode} to connector ${payload.connectorId}.`,
          level: "warning",
          timeoutMs: 3500
        });
        setShowFaultModal(false);
        queryClient.invalidateQueries({ queryKey: ["command-logs"] });
        queryClient.invalidateQueries({ queryKey: ["fault-injections"] });
      } catch (error) {
        const message = extractErrorMessage(error);
        throw new Error(message);
      } finally {
        setFaultPending(false);
      }
    },
    [api, data, extractErrorMessage, pushToast, queryClient]
  );

  const handleResetCharger = useCallback(
    async (resetType: "Soft" | "Hard") => {
      if (!data) return;
      setCommandBusy("reset");
      try {
        await api.request(endpoints.simulators.reset(data.id), {
          method: "POST",
          body: { type: resetType }
        });
        pushToast({
          title: "Reset requested",
          description: `${resetType} reset command queued for the charger.`,
          level: "info",
          timeoutMs: 3500
        });
        setShowResetModal(false);
        const initialStage: ResetFlowStage = resetType === "Hard" ? "requested" : "rebooting";
        setResetFlow({ type: resetType, stage: initialStage });
        if (resetType === "Soft") {
          refreshSimulator();
        }
      } catch (error) {
        const message = extractErrorMessage(error);
        pushToast({ title: "Reset failed", description: message, level: "error" });
        throw new Error(message);
      } finally {
        setCommandBusy(null);
      }
    },
    [api, data, extractErrorMessage, pushToast, refreshSimulator, setResetFlow]
  );

  const handleForceReset = useCallback(async () => {
    if (!data) return;
    setCommandBusy("force-reset");
    try {
      await api.request(endpoints.simulators.forceReset(data.id), { method: "POST" });
      pushToast({
        title: "Force reset requested",
        description: "Terminating sessions and rebooting the charger.",
        level: "warning",
        timeoutMs: 4000
      });
      setShowForceResetModal(false);
      setResetFlow({ type: "Force", stage: "requested" });
    } catch (error) {
      const message = extractErrorMessage(error);
      pushToast({ title: "Force reset failed", description: message, level: "error" });
    } finally {
      refreshSimulator();
      setCommandBusy(null);
    }
  }, [api, data, extractErrorMessage, pushToast, refreshSimulator, setResetFlow]);

  const handleSimulatorUpdate = useCallback(
    async (payload: SimulatorUpdatePayload) => {
      if (!data) {
        throw new Error("Simulator not loaded.");
      }
      setEditBusy(true);
      try {
        const updated = await api.request<SimulatedCharger>(
          endpoints.simulators.detail(data.id),
          { method: "PATCH", body: payload }
        );
        queryClient.setQueryData(queryKeys.simulatorDetail(simulatorId), updated);
        queryClient.invalidateQueries({ queryKey: queryKeys.simulators() });
        pushToast({
          title: "Simulator updated",
          description: "Configuration saved",
          level: "success",
          timeoutMs: 3500
        });
        setShowEditModal(false);
      } catch (error) {
        throw new Error(extractErrorMessage(error));
      } finally {
        setEditBusy(false);
      }
    },
    [api, data, extractErrorMessage, pushToast, queryClient, simulatorId]
  );

  const handleQuickStop = useCallback(async () => {
    if (!data) return;
    if (!activeSession) {
      setShowStopModal(true);
      return;
    }
    try {
      const sessionTransactionKey = pickCanonicalTransactionId(
        activeSession.cms_transaction_key,
        activeSession.cms_transaction
      );
      const matchedConnector = sessionTransactionKey
        ? connectorsSummary.find((summary) => summary.transactionKey === sessionTransactionKey)
        : null;
      const connectorNumberFromSession = activeSession ? resolveConnectorNumber(activeSession) : null;
      const connectorToStop = matchedConnector?.connectorId ?? connectorNumberFromSession ?? undefined;
      await handleRemoteStop({
        transactionId: sessionTransactionKey,
        connectorId: connectorToStop
      });
    } catch (error) {
      const message = extractErrorMessage(error);
      pushToast({ title: "Stop failed", description: message, level: "error" });
    }
  }, [
    activeSession,
    connectorsSummary,
    data,
    extractErrorMessage,
    handleRemoteStop,
    pushToast,
    resolveConnectorNumber
  ]);

  return {
    commandBusy,
    commandConnectorId,
    setCommandConnectorId,
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
  };
};
