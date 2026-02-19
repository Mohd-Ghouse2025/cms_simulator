import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useTenantApi } from "@/hooks/useTenantApi";
import { queryKeys } from "@/lib/queryKeys";
import { endpoints } from "@/lib/endpoints";
import {
  SimulatedCharger,
  SimulatorInstance,
  SimulatedMeterValue,
  SimulatedSession,
  ConnectorTelemetrySnapshot,
  ConnectorTelemetryHistory
} from "@/types";
import { CmsChargingSession, CmsConnector } from "../types/detail";
import {
  INSTANCE_HISTORY_LIMIT,
  METER_HISTORY_LIMIT
} from "../detail/detailHelpers";

export type SimulatorQueriesResult = {
  data: SimulatedCharger | undefined;
  isLoading: boolean;
  isError: boolean;
  normalizedLifecycle: SimulatedCharger["lifecycle_state"] | "OFFLINE";
  cmsConnected: boolean;
  cmsHeartbeatIso: string | null;
  instancesQuery: UseQueryResult<{ results: SimulatorInstance[] }>;
  meterValuesQuery: UseQueryResult<{ results: SimulatedMeterValue[] }>;
  sessionsQuery: UseQueryResult<{ results: SimulatedSession[] }>;
  recentSessionsQuery: UseQueryResult<{ results: SimulatedSession[] }>;
  cmsConnectorsQuery: UseQueryResult<{ results: CmsConnector[] }>;
  cmsSessionsQuery: UseQueryResult<{ results: CmsChargingSession[] }>;
  faultDefinitionsQuery: UseQueryResult;
  simulatorConnectorByPk: Map<number, SimulatedCharger["connectors"][number]>;
  cmsConnectorIndex: {
    byId: Map<number, CmsConnector>;
    byNumber: Map<number, CmsConnector>;
  };
  cmsSessionsIndex: {
    byId: Map<number, CmsChargingSession>;
    byFormatted: Map<string, CmsChargingSession>;
    byConnectorNumber: Map<number, CmsChargingSession[]>;
  };
  telemetrySnapshotMap: Map<number, ConnectorTelemetrySnapshot>;
  telemetryHistoryMap: Map<number, ConnectorTelemetryHistory>;
};

export const useSimulatorQueries = (
  simulatorId: number
): SimulatorQueriesResult => {
  const api = useTenantApi();

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.simulatorDetail(simulatorId),
    enabled: Number.isFinite(simulatorId),
    queryFn: async () => api.request<SimulatedCharger>(endpoints.simulators.detail(simulatorId)),
    staleTime: 0
  });

  const normalizedLifecycle = (data?.lifecycle_state ?? "OFFLINE") as SimulatorQueriesResult["normalizedLifecycle"];
  const cmsConnected = data?.cms_online ?? (data?.cms_present ?? false);
  const cmsHeartbeatIso = data?.cms_last_heartbeat ?? null;

  const instancesQuery = useQuery({
    queryKey: ["simulator-instance", simulatorId],
    enabled: Number.isFinite(simulatorId),
    queryFn: async () =>
      api.requestPaginated<SimulatorInstance>(endpoints.simulatorInstances, {
        query: { page_size: INSTANCE_HISTORY_LIMIT }
      }),
    staleTime: 15_000,
    refetchOnWindowFocus: true
  });

  const meterValuesQuery = useQuery({
    queryKey: queryKeys.meterValues({ simulator: simulatorId, limit: METER_HISTORY_LIMIT }),
    enabled: !!data && Number.isFinite(simulatorId),
    queryFn: async () =>
      api.requestPaginated<SimulatedMeterValue>(endpoints.meterValues, {
        query: {
          simulator: simulatorId,
          page_size: METER_HISTORY_LIMIT
        }
      }),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: false
  });

  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions({ simulator: simulatorId, active: true }),
    enabled: Number.isFinite(simulatorId),
    queryFn: async () =>
      api.requestPaginated<SimulatedSession>(endpoints.sessions, {
        query: { simulator: simulatorId, active: true, limit: 10 }
      }),
    refetchInterval: normalizedLifecycle === "CHARGING" ? 5_000 : 15_000,
    staleTime: 0
  });

  const recentSessionsQuery = useQuery({
    queryKey: queryKeys.sessions({ simulator: simulatorId, limit: 20 }),
    enabled: Number.isFinite(simulatorId),
    queryFn: async () =>
      api.requestPaginated<SimulatedSession>(endpoints.sessions, {
        query: { simulator: simulatorId, limit: 20 }
      }),
    staleTime: 30_000,
    refetchInterval: normalizedLifecycle === "CHARGING" ? 20_000 : false
  });

  const cmsConnectorsQuery = useQuery({
    queryKey: ["cms-connectors", data?.charger_id],
    enabled: Boolean(data?.charger_id),
    queryFn: async () =>
      api.requestPaginated<CmsConnector>(endpoints.cms.connectors, {
        query: { charger_id: data?.charger_id, page_size: 50 }
      }),
    staleTime: 60_000,
    refetchInterval: normalizedLifecycle === "CHARGING" ? 20_000 : 120_000
  });

  const cmsSessionsQuery = useQuery({
    queryKey: ["cms-charging-sessions", data?.charger_id],
    enabled: Boolean(data?.charger_id),
    queryFn: async () =>
      api.requestPaginated<CmsChargingSession>(endpoints.cms.chargingSessions, {
        query: { charger_id: data?.charger_id, page_size: 25 }
      }),
    staleTime: 60_000,
    refetchInterval: normalizedLifecycle === "CHARGING" ? 15_000 : 120_000
  });

  const faultDefinitionsQuery = useQuery({
    queryKey: queryKeys.faultDefinitions,
    queryFn: async () =>
      api.requestPaginated(endpoints.faultDefinitions, {
        query: { page_size: 100 }
      }),
    staleTime: 120_000
  });

  const simulatorConnectorByPk = useMemo(() => {
    const map = new Map<number, SimulatedCharger["connectors"][number]>();
    (data?.connectors ?? []).forEach((connector) => {
      map.set(connector.id, connector);
    });
    return map;
  }, [data?.connectors]);

  const cmsConnectorIndex = useMemo(() => {
    const byId = new Map<number, CmsConnector>();
    const byNumber = new Map<number, CmsConnector>();
    const results = cmsConnectorsQuery.data?.results ?? [];
    results.forEach((connector) => {
      byId.set(connector.id, connector);
      byNumber.set(connector.connector_id, connector);
    });
    return { byId, byNumber };
  }, [cmsConnectorsQuery.data?.results]);

  const cmsSessionsIndex = useMemo(() => {
    const byId = new Map<number, CmsChargingSession>();
    const byFormatted = new Map<string, CmsChargingSession>();
    const byConnectorNumber = new Map<number, CmsChargingSession[]>();
    const sessions = cmsSessionsQuery.data?.results ?? [];
    sessions.forEach((session) => {
      byId.set(session.id, session);
      const formatted = session.formatted_transaction_id ?? session.cms_transaction_key ?? session.transaction_id;
      if (formatted) {
        byFormatted.set(formatted, session);
      }
      const cmsConnector = cmsConnectorIndex.byId.get(session.connector);
      if (cmsConnector) {
        const list = byConnectorNumber.get(cmsConnector.connector_id) ?? [];
        list.push(session);
        byConnectorNumber.set(cmsConnector.connector_id, list);
      }
    });
    byConnectorNumber.forEach((list, connectorNumber) => {
      const ordered = [...list].sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
      byConnectorNumber.set(connectorNumber, ordered);
    });
    return { byId, byFormatted, byConnectorNumber };
  }, [cmsSessionsQuery.data?.results, cmsConnectorIndex]);

  const telemetrySnapshotMap = useMemo(() => {
    const raw = data?.telemetrySnapshot;
    const entries: Array<[number, ConnectorTelemetrySnapshot]> = [];
    if (raw && typeof raw === "object") {
      Object.entries(raw).forEach(([key, snapshot]) => {
        const connectorId = Number(key);
        if (!Number.isFinite(connectorId) || connectorId <= 0 || !snapshot) {
          return;
        }
        entries.push([connectorId, snapshot as ConnectorTelemetrySnapshot]);
      });
    }
    return new Map(entries);
  }, [data?.telemetrySnapshot]);

  const telemetryHistoryMap = useMemo(() => {
    const raw = data?.telemetryHistory;
    const entries: Array<[number, ConnectorTelemetryHistory]> = [];
    if (raw && typeof raw === "object") {
      Object.entries(raw).forEach(([key, history]) => {
        const connectorId = Number(key);
        if (!Number.isFinite(connectorId) || connectorId <= 0 || !history) {
          return;
        }
        entries.push([connectorId, history as ConnectorTelemetryHistory]);
      });
    }
    return new Map(entries);
  }, [data?.telemetryHistory]);

  return {
    data,
    isLoading,
    isError,
    normalizedLifecycle,
    cmsConnected,
    cmsHeartbeatIso,
    instancesQuery,
    meterValuesQuery,
    sessionsQuery,
    recentSessionsQuery,
    cmsConnectorsQuery,
    cmsSessionsQuery,
    faultDefinitionsQuery,
    simulatorConnectorByPk,
    cmsConnectorIndex,
    cmsSessionsIndex,
    telemetrySnapshotMap,
    telemetryHistoryMap
  } as SimulatorQueriesResult;
};
