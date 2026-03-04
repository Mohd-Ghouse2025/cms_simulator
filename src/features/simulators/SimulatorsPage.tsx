/* eslint-disable @typescript-eslint/no-misused-promises */
"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Info, Plug, Power, Search, Zap } from "lucide-react";
import { Card } from "@/components/common/Card";
import { Button } from "@/components/common/Button";
import { Skeleton } from "@/components/common/Skeleton";
import { Pagination } from "@/components/common/Pagination";
import { useTenantApi } from "@/hooks/useTenantApi";
import { queryKeys } from "@/lib/queryKeys";
import {
  getLifecycleStatusMeta,
  isActiveLifecycleState,
  normalizeLifecycleState,
  type StatusTone
} from "@/lib/simulatorLifecycle";
import { useNotificationStore } from "@/store/notificationStore";
import { ApiError } from "@/lib/api";
import { endpoints } from "@/lib/endpoints";
import { ChargerLifecycleState, SimulatedCharger, SimulatorInstance } from "@/types";
import { AddSimulatorModal } from "./components/AddSimulatorModal";
import styles from "./SimulatorsPage.module.css";
import { useSimulatorChannel } from "./hooks/useSimulatorChannel";

type SimulatorAction = "powerOn" | "powerOff" | "connect" | "disconnect";

const SIMULATOR_PAGE_SIZE = 20;
const INSTANCE_CACHE_LIMIT = 100;

const successToastByAction: Record<SimulatorAction, { title: string; description: string }> = {
  powerOn: {
    title: "Simulator powered on",
    description: "Runtime is ready to establish an OCPP connection."
  },
  powerOff: {
    title: "Simulator powered off",
    description: "Runtime has been shut down and marked offline."
  },
  connect: {
    title: "Connection initiated",
    description: "BootNotification will be sent to the CMS shortly."
  },
  disconnect: {
    title: "Disconnect requested",
    description: "The simulator will close the CMS session shortly."
  }
};

const formatTimestamp = (value?: string | null) => {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return `${date.toLocaleDateString()} · ${date.toLocaleTimeString()}`;
};

const formatRuntimeStatus = (status?: string | null) => {
  if (!status) {
    return "—";
  }
  return status
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
};

const cmsBadgeFor = (connected: boolean | undefined, online: boolean | undefined): { label: string; tone: StatusTone } => {
  if (connected) return { label: "Connected", tone: "success" };
  if (online === true) return { label: "Online", tone: "warning" };
  if (online === false) return { label: "Offline", tone: "danger" };
  return { label: "Unknown", tone: "neutral" };
};

const CMS_MIN_HEARTBEAT_WINDOW_MS = 180_000;

const resolveCmsOnline = (simulator: SimulatedCharger): boolean | undefined => {
  if (typeof simulator.cms_online === "boolean") {
    return simulator.cms_online;
  }
  const heartbeatIso = simulator.cms_last_heartbeat;
  if (!heartbeatIso) {
    return undefined;
  }
  const timestamp = Date.parse(heartbeatIso);
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }
  const heartbeatInterval = simulator.default_heartbeat_interval ?? 60;
  const staleThreshold = Math.max(heartbeatInterval * 3 * 1000, CMS_MIN_HEARTBEAT_WINDOW_MS);
  return Date.now() - timestamp < staleThreshold;
};

const resolveCmsConnectivity = (simulator: SimulatedCharger): { connected: boolean; online: boolean | undefined } => {
  const online = resolveCmsOnline(simulator);
  const connected = Boolean(
    simulator.cms_present ?? (typeof simulator.cms_online === "boolean" ? simulator.cms_online : false)
  );
  return { connected, online };
};

const renderStatusChip = (label: string, tone: StatusTone) => (
  <span className={clsx(styles.statusChip, styles[`status${tone[0].toUpperCase()}${tone.slice(1)}`])}>
    {label}
  </span>
);

const formatRelativeLastSeen = (value?: string | null) => {
  if (!value) {
    return null;
  }
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return null;
  }
  const diffMs = Date.now() - timestamp;
  const minute = 60_000;
  if (diffMs < minute) {
    return "Last seen just now";
  }
  const minutes = Math.floor(diffMs / minute);
  if (minutes < 60) {
    return `Last seen ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `Last seen ${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(hours / 24);
  return `Last seen ${days} day${days === 1 ? "" : "s"} ago`;
};

export const SimulatorsPage = () => {
  const api = useTenantApi();
  const queryClient = useQueryClient();
  const pushToast = useNotificationStore((state) => state.pushToast);
  const router = useRouter();
  const [isAddModalOpen, setAddModalOpen] = useState(false);
  const [busyActions, setBusyActions] = useState<Record<number, SimulatorAction | null>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "offline">("all");
  const [page, setPage] = useState(1);


  const lifecycleQuery = useMemo(() => {
    if (statusFilter === "active") {
      return "POWERED_ON,CONNECTING,CONNECTED,CHARGING";
    }
    if (statusFilter === "offline") {
      return "OFFLINE,ERROR";
    }
    return undefined;
  }, [statusFilter]);

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.simulators({ page, lifecycle: lifecycleQuery }),
    queryFn: async () =>
      api.requestPaginated<SimulatedCharger>(endpoints.simulators.list, {
        query: {
          page,
          page_size: SIMULATOR_PAGE_SIZE,
          ...(lifecycleQuery ? { lifecycle_state: lifecycleQuery } : {})
        }
      }),
    refetchInterval: (query) => {
      const items = (query.state.data as { results?: SimulatedCharger[] } | undefined)?.results ?? [];
      const transitional = items.some((sim) =>
        ["PREPARING", "CHARGING", "SUSPENDEDEV", "SUSPENDEDEVSE", "FINISHING", "CONNECTING", "POWERED_ON"].includes(
          normalizeLifecycleState(sim.lifecycle_state) ?? ""
        )
      );
      return transitional ? 5_000 : false;
    },
    refetchOnWindowFocus: (query) => {
      const items = (query.state.data as { results?: SimulatedCharger[] } | undefined)?.results ?? [];
      return items.some((sim) =>
        ["PREPARING", "CHARGING", "SUSPENDEDEV", "SUSPENDEDEVSE", "FINISHING", "CONNECTING", "POWERED_ON"].includes(
          normalizeLifecycleState(sim.lifecycle_state) ?? ""
        )
      );
    }
  });

  const instanceQuery = useQuery({
    queryKey: queryKeys.simulatorInstances,
    queryFn: async () =>
      api.requestPaginated<SimulatorInstance>(endpoints.simulatorInstances, {
        query: { page_size: INSTANCE_CACHE_LIMIT }
      }),
    refetchInterval: 10_000
  });

  const patchSimulatorCaches = useCallback(
    (simId: number, mutator: (sim: SimulatedCharger) => SimulatedCharger) => {
      queryClient.setQueriesData<
        { results: SimulatedCharger[]; count: number } | undefined
      >({ queryKey: ["simulators"] }, (existing) => {
        if (!existing) return existing;
        const results = existing.results.map((item) =>
          item.id === simId ? mutator(item) : item
        );
        return { ...existing, results };
      });

      queryClient.setQueriesData<SimulatedCharger | undefined>(
        { queryKey: queryKeys.simulatorDetail(simId) },
        (existing) => (existing ? mutator(existing) : existing)
      );
    },
    [queryClient]
  );

  const instancesBySimulator: Record<number, SimulatorInstance | null> = useMemo(() => {
    const map: Record<number, SimulatorInstance | null> = {};
    for (const instance of instanceQuery.data?.results ?? []) {
      const existing = map[instance.sim];
      if (!existing) {
        map[instance.sim] = instance;
        continue;
      }
      const existingTime = existing.created_at ? new Date(existing.created_at).getTime() : 0;
      const currentTime = instance.created_at ? new Date(instance.created_at).getTime() : 0;
      if (currentTime >= existingTime) {
        map[instance.sim] = instance;
      }
    }
    return map;
  }, [instanceQuery.data?.results]);

  const waitForState = useCallback(
    async (
      simulatorId: number,
      label: string,
      predicate: (sim: SimulatedCharger) => boolean
    ) => {
      const timeoutMs = 30_000;
      const intervalMs = 1_000;
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const fresh = await api.request<SimulatedCharger>(endpoints.simulators.detail(simulatorId));
        if (predicate(fresh)) {
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      pushToast({
        title: `${label} is taking longer than expected`,
        description: "We’ll keep watching for status changes. Refresh if it continues.",
        level: "warning",
        timeoutMs: 4500
      });
      return false;
    },
    [api, pushToast]
  );

  const performAction = useCallback(async (simulator: SimulatedCharger, action: SimulatorAction) => {
    setBusyActions((current) => ({
      ...current,
      [simulator.id]: action
    }));

    const extractErrorMessage = (error: unknown): string => {
      if (error instanceof ApiError) {
        return error.message;
      }
      if (error instanceof Error) {
        return error.message;
      }
      return "Request failed";
    };

    let shouldPoll = false;
    try {
      let response: unknown;
      switch (action) {
        case "powerOn":
          response = await api.request(endpoints.simulators.startProcess(simulator.id), {
            method: "POST"
          });
          break;
        case "powerOff":
          response = await api.request(endpoints.simulators.stopProcess(simulator.id), {
            method: "POST"
          });
          break;
        case "connect":
          response = await api.request(endpoints.simulators.connect(simulator.id), {
            method: "POST"
          });
          {
            const payload = (response ?? {}) as {
              state?: string;
              instance?: SimulatorInstance;
            };
            const lifecycle =
              (payload.state?.toUpperCase() as ChargerLifecycleState | undefined) ?? "CONNECTING";
            const instanceData = payload.instance;
            patchSimulatorCaches(simulator.id, (current) => ({
              ...current,
              lifecycle_state: lifecycle,
              latest_instance_status: instanceData?.status ?? current.latest_instance_status,
              latest_instance_last_heartbeat:
                instanceData?.last_heartbeat ?? current.latest_instance_last_heartbeat,
              cms_online: false,
              cms_last_heartbeat: null
            }));

            if (instanceData) {
              queryClient.setQueriesData<{ results: SimulatorInstance[] } | undefined>(
                { queryKey: queryKeys.simulatorInstances },
                (existing) => {
                  if (!existing) return existing;
                  const filtered = (existing.results ?? []).filter(
                    (item) => item.id !== instanceData.id
                  );
                  return { ...existing, results: [instanceData, ...filtered].slice(0, INSTANCE_CACHE_LIMIT) };
                }
              );
            }
          }
          break;
        case "disconnect":
          response = await api.request(endpoints.simulators.disconnect(simulator.id), {
            method: "POST"
          });
          break;
      }
      shouldPoll = response !== null && response !== undefined;

      const toast = successToastByAction[action];
      pushToast({
        ...toast,
        level: "success",
        timeoutMs: 3500
      });
      return response;
    } catch (error) {
      const message = extractErrorMessage(error);
      const isConflict = error instanceof ApiError && error.status === 409;
      pushToast({
        title: isConflict ? "Simulator already running" : "Action failed",
        description: message,
        level: isConflict ? "warning" : "error",
        timeoutMs: 5000
      });
      return null;
    } finally {
      const lifecycleSatisfied = (fresh: SimulatedCharger) => {
        const lifecycle = (fresh.lifecycle_state ?? "").toUpperCase();
        const cmsUp = Boolean(fresh.cms_online || fresh.cms_present);
        if (action === "powerOn") {
          return lifecycle === "POWERED_ON" || lifecycle === "CONNECTING" || lifecycle === "CONNECTED" || lifecycle === "CHARGING";
        }
        if (action === "connect") {
          return cmsUp || lifecycle === "CONNECTED" || lifecycle === "CHARGING";
        }
        if (action === "disconnect") {
          return lifecycle === "POWERED_ON" && !cmsUp;
        }
        if (action === "powerOff") {
          return lifecycle === "OFFLINE";
        }
        return true;
      };
      // Only short-poll when we actually issued the action successfully.
      if (shouldPoll) {
        try {
          await waitForState(
            simulator.id,
            action === "connect"
              ? "Connect"
              : action === "disconnect"
                ? "Disconnect"
                : action === "powerOn"
                  ? "Power on"
                  : "Power off",
            lifecycleSatisfied as (sim: SimulatedCharger) => boolean
          );
        } catch {
          /* swallow polling errors */
        }
      }
      queryClient.invalidateQueries({ queryKey: ["simulators"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.simulatorInstances });
      queryClient.invalidateQueries({ queryKey: queryKeys.chargers });
      setBusyActions((current) => ({
        ...current,
        [simulator.id]: null
      }));
    }
  }, [api, pushToast, queryClient, waitForState]);

  const simulators = useMemo(() => data?.results ?? [], [data?.results]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  const filteredSimulators = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return simulators.filter((simulator) => {
      const matchesQuery =
        !normalizedQuery ||
        [simulator.alias, simulator.charger_id, simulator.protocol_variant, String(simulator.id)]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(normalizedQuery));
      if (!matchesQuery) {
        return false;
      }
      if (statusFilter === "all") {
        return true;
      }
      const active = isActiveLifecycleState(simulator.lifecycle_state);
      return statusFilter === "active" ? active : !active;
    });
  }, [simulators, searchQuery, statusFilter]);

  const sections = useMemo(() => {
    const activeItems = filteredSimulators.filter((simulator) =>
      isActiveLifecycleState(simulator.lifecycle_state)
    );
    const offlineItems = filteredSimulators.filter(
      (simulator) => !isActiveLifecycleState(simulator.lifecycle_state)
    );

    return [
      activeItems.length
        ? { id: "active", label: "Active Simulators", items: activeItems }
        : null,
      offlineItems.length
        ? { id: "offline", label: "Offline & Idle", items: offlineItems }
        : null
    ].filter(Boolean) as { id: string; label: string; items: SimulatedCharger[] }[];
  }, [filteredSimulators]);

  const totalSimulators = data?.count ?? 0;
  const isListEmpty = !isLoading && totalSimulators === 0;
  const isFilteredEmpty = !isLoading && filteredSimulators.length === 0;

  const columnInfo: Record<string, string> = {
    simulator: "Simulator alias, charger ID, and protocol details.",
    lifecycle: "Lifecycle shows whether the simulator is powered, connected, or idle.",
    runtime: "Runtime displays the instance status and last heartbeat timestamp.",
    cms: "CMS indicates the current connection health to the central management system.",
    connectors: "Connector list with IDs and formats available for this simulator.",
    actions: "Quick controls to power, connect, or view simulator details."
  };

  let rowCounter = 0;

  return (
    <div className={styles.page}>
      <section className={styles.headerCard}>
        <div>
          <p className={styles.eyebrow}>Monitor</p>
          <div className={styles.headerRow}>
            <div>
              <h1 className={styles.title}>Simulator Control Center</h1>
              <p className={styles.subtitle}>
                Monitor lifecycle state, runtime heartbeat, and CMS connectivity for every simulated charger.
              </p>
            </div>
            <Button
              size="sm"
              className={styles.addSimulator}
              onClick={() => setAddModalOpen(true)}
            >
              + Simulator
            </Button>
          </div>
        </div>
      </section>

      <Card className={styles.tableCard} title={<span className={styles.cardTitle}>Live simulator inventory</span>}>
        <div className={styles.tableToolbar}>
          <label className="sr-only" htmlFor="simulator-search">
            Search simulators
          </label>
          <div className={styles.searchField}>
            <Search className={styles.searchIcon} size={16} aria-hidden="true" />
            <input
              id="simulator-search"
              className={styles.searchInput}
              type="search"
              placeholder="Search by name, charger ID, or protocol"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>
          <label className="sr-only" htmlFor="status-filter">
            Filter by status
          </label>
          <select
            id="status-filter"
            className={styles.filterSelect}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="offline">Offline &amp; idle</option>
          </select>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>
                  <span className={styles.columnHeading}>
                    Simulator
                    <button type="button" className={styles.infoButton} title={columnInfo.simulator} aria-label={columnInfo.simulator}>
                      <Info size={14} aria-hidden="true" />
                    </button>
                  </span>
                </th>
                <th>
                  <span className={styles.columnHeading}>
                    Lifecycle
                    <button type="button" className={styles.infoButton} title={columnInfo.lifecycle} aria-label={columnInfo.lifecycle}>
                      <Info size={14} aria-hidden="true" />
                    </button>
                  </span>
                </th>
                <th>
                  <span className={styles.columnHeading}>
                    Runtime
                    <button type="button" className={styles.infoButton} title={columnInfo.runtime} aria-label={columnInfo.runtime}>
                      <Info size={14} aria-hidden="true" />
                    </button>
                  </span>
                </th>
                <th>
                  <span className={styles.columnHeading}>
                    CMS
                    <button type="button" className={styles.infoButton} title={columnInfo.cms} aria-label={columnInfo.cms}>
                      <Info size={14} aria-hidden="true" />
                    </button>
                  </span>
                </th>
                <th>
                  <span className={styles.columnHeading}>
                    Connectors
                    <button type="button" className={styles.infoButton} title={columnInfo.connectors} aria-label={columnInfo.connectors}>
                      <Info size={14} aria-hidden="true" />
                    </button>
                  </span>
                </th>
                <th className={styles.actionsHeading}>
                  <span className={styles.columnHeading}>
                    Actions
                    <button type="button" className={styles.infoButton} title={columnInfo.actions} aria-label={columnInfo.actions}>
                      <Info size={14} aria-hidden="true" />
                    </button>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 4 }).map((_, index) => (
                  <tr key={`skeleton-${index}`} className={styles.row}>
                    <td><Skeleton width="70%" /></td>
                    <td><Skeleton width="55%" /></td>
                    <td><Skeleton width="80%" /></td>
                    <td><Skeleton width="45%" /></td>
                    <td><Skeleton width="90%" /></td>
                    <td><Skeleton width="100%" /></td>
                  </tr>
                ))
                : sections.length
                  ? sections.map((section) => (
                    <Fragment key={section.id}>
                      <tr className={styles.sectionRow}>
                        <td colSpan={6}>
                          <div className={styles.sectionHeading}>
                            <span>{section.label}</span>
                            <span className={styles.sectionCount}>{section.items.length} simulators</span>
                          </div>
                        </td>
                      </tr>
                      {section.items.map((simulator) => {
                        rowCounter += 1;
                        return (
                          <SimulatorRow
                          key={simulator.id}
                          simulator={simulator}
                          rowIndex={rowCounter}
                          instance={instancesBySimulator[simulator.id] ?? null}
                          busyAction={busyActions[simulator.id] ?? null}
                          performAction={performAction}
                          router={router}
                        />
                        );
                      })}
                    </Fragment>
                  ))
                  : null}
              {isFilteredEmpty && simulators.length > 0 ? (
                <tr className={styles.emptyRow}>
                  <td colSpan={6}>
                    <div className={styles.emptyState}>
                      <h3>No simulators match your filters</h3>
                      <p>Try adjusting the search term or status filter.</p>
                    </div>
                  </td>
                </tr>
              ) : null}
              {isListEmpty ? (
                <tr className={styles.emptyRow}>
                  <td colSpan={6}>
                    <div className={styles.emptyState}>
                      <h3>Bring your first simulator online</h3>
                      <p>Create a simulator to orchestrate lifelike OCPP test sessions.</p>
                      <Button variant="primary" onClick={() => setAddModalOpen(true)}>
                        Create simulator
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {isError ? <span className={styles.error}>Failed to load simulators</span> : null}
      </Card>

      <Pagination
        page={page}
        pageSize={SIMULATOR_PAGE_SIZE}
        total={totalSimulators}
        isLoading={isLoading}
        onPageChange={setPage}
      />

      <AddSimulatorModal
        open={isAddModalOpen}
        onClose={() => setAddModalOpen(false)}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ["simulators"] });
          setAddModalOpen(false);
        }}
      />
    </div>
  );
};

type SimulatorRowProps = {
  simulator: SimulatedCharger;
  rowIndex: number;
  instance: SimulatorInstance | null;
  busyAction: SimulatorAction | null;
  performAction: (simulator: SimulatedCharger, action: SimulatorAction) => void;
  router: ReturnType<typeof useRouter>;
};

const SimulatorRow = ({
  simulator,
  rowIndex,
  instance,
  busyAction,
  performAction,
  router
}: SimulatorRowProps) => {
  const lifecycle = normalizeLifecycleState(simulator.lifecycle_state) ?? "OFFLINE";
  const runtimeStatusRaw = instance?.status ?? simulator.latest_instance_status ?? null;
  const runtimeStatus = formatRuntimeStatus(runtimeStatusRaw);
  const heartbeatTimeoutMs = Math.max((simulator.default_heartbeat_interval ?? 60) * 3 * 1000, 180_000);
  const heartbeatIso = instance?.last_heartbeat ?? simulator.latest_instance_last_heartbeat ?? null;
  const nowTs = Date.now();
  const heartbeatTs = heartbeatIso ? Date.parse(heartbeatIso) : NaN;
  const heartbeatFresh = Number.isFinite(heartbeatTs) && nowTs - heartbeatTs <= heartbeatTimeoutMs;
  const isRuntimeRunningFresh = runtimeStatusRaw === "running" && heartbeatFresh;
  const pendingTimestamp = (() => {
    const candidate =
      instance?.started_at ??
      instance?.created_at ??
      simulator.latest_instance_last_heartbeat ??
      null;
    if (!candidate) {
      return null;
    }
    const ts = Date.parse(candidate);
    return Number.isFinite(ts) ? ts : null;
  })();
  const pendingGraceMs = 90_000;
  const runtimeBooting =
    runtimeStatusRaw === "pending" &&
    pendingTimestamp !== null &&
    nowTs - pendingTimestamp < pendingGraceMs;
  const runtimeRecent = pendingTimestamp !== null && nowTs - pendingTimestamp < pendingGraceMs;
  let hasActiveInstance = isRuntimeRunningFresh || runtimeBooting;
  let runtimeStale = false;
  if (lifecycle === "OFFLINE") {
    const offlineRunning = isRuntimeRunningFresh && runtimeRecent;
    runtimeStale = isRuntimeRunningFresh && !runtimeRecent;
    hasActiveInstance = offlineRunning || runtimeBooting;
  }
  const heartbeat = formatTimestamp(heartbeatIso);
  const connectors = simulator.connectors ?? [];
  const { connected: cmsConnected, online: cmsOnlineResolved } = resolveCmsConnectivity(simulator);
  const cmsBadge = cmsBadgeFor(cmsConnected, cmsOnlineResolved);
  const lifecycleBlocked = lifecycle === "OFFLINE" || lifecycle === "ERROR" || lifecycle === "CHARGING";
  const isBusy = Boolean(busyAction);
  const navigateToDetail = useCallback(() => {
    router.push(`/simulators/${simulator.id}`);
  }, [router, simulator.id]);

  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button")) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      navigateToDetail();
    }
  };

  const handleNameClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    navigateToDetail();
  };

  const handleNameKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      navigateToDetail();
    }
  };

  const isConnecting = busyAction === "connect" || lifecycle === "CONNECTING";
  const hasPreviousCms = Boolean(simulator.cms_last_heartbeat || simulator.cms_present || simulator.last_error_at);

  const getPrimaryAction = () => {
    if (lifecycle === "OFFLINE") {
      return {
        action: "powerOn" as SimulatorAction,
        label: busyAction === "powerOn" ? "Powering…" : "Power On",
        disabled: isBusy,
        variant: "powerOn" as const,
        title: runtimeStale ? "Previous runtime looks stale; start a fresh process." : undefined
      };
    }

    if (isConnecting) {
      return {
        action: null,
        label: "Connecting…",
        disabled: true,
        variant: "connect" as const,
        title: "CMS connection in progress."
      };
    }

    if (cmsConnected) {
      return {
        action: "disconnect" as SimulatorAction,
        label: busyAction === "disconnect" ? "Disconnecting…" : "Disconnect",
        disabled: isBusy,
        variant: "disconnect" as const,
        title: "Disconnect from the CMS."
      };
    }

    if (lifecycle === "POWERED_ON") {
      const label = hasPreviousCms || hasActiveInstance ? "Reconnect" : "Connect";
      return {
        action: "connect" as SimulatorAction,
        label,
        disabled: isBusy,
        variant: "connect" as const,
        title: label === "Reconnect"
          ? "CMS heartbeat missing — reconnect to resume telemetry."
          : "Connect the simulator to the CMS."
      };
    }

    if (lifecycle === "ERROR") {
      return {
        action: "powerOn" as SimulatorAction,
        label: busyAction === "powerOn" ? "Recovering…" : "Recover & Power",
        disabled: isBusy,
        variant: "powerOn" as const,
        title: "Recover the simulator runtime."
      };
    }

    if (lifecycle === "CHARGING") {
      return {
        action: null,
        label: "Charging…",
        disabled: true,
        variant: "neutral" as const,
        title: "Stop the active session before other actions."
      };
    }

    return {
      action: "connect" as SimulatorAction,
      label: "Connect",
      disabled: isBusy,
      variant: "connect" as const,
      title: "Connect the simulator to the CMS."
    };
  };

  const primary = getPrimaryAction();

  const showSecondaryPowerOff =
    primary.action !== "powerOff" && lifecycle !== "OFFLINE" && lifecycle !== "CHARGING";
  const secondaryPowerOff = showSecondaryPowerOff
    ? {
        action: "powerOff" as SimulatorAction,
        label: busyAction === "powerOff" ? "Powering…" : "Power Off",
        disabled: isBusy,
        title: !hasActiveInstance
          ? "Runtime already stopped – this will reset the simulator offline."
          : undefined
      }
    : null;

  const lifecycleMeta = getLifecycleStatusMeta(lifecycle);
  const showLastSeen = lifecycle === "OFFLINE" || lifecycle === "ERROR";
  const lastSeen = showLastSeen
    ? formatRelativeLastSeen(instance?.last_heartbeat ?? simulator.latest_instance_last_heartbeat)
    : null;

  return (
    <tr
      className={clsx(
        styles.row,
        styles.simRow,
        styles.rowClickable,
        rowIndex % 2 === 0 ? styles.rowAlt : styles.rowBase
      )}
      onClick={navigateToDetail}
      role="link"
      tabIndex={0}
      onKeyDown={handleRowKeyDown}
    >
      <td>
        <div className={styles.simInfo}>
          <button
            type="button"
            className={clsx(styles.simName, styles.simNameLink)}
            onClick={handleNameClick}
            onKeyDown={handleNameKeyDown}
          >
            {simulator.alias || simulator.charger_id || `Simulator #${simulator.id}`}
          </button>
          <span className={styles.simMeta}>
            Charger {simulator.charger_id ?? simulator.charger} · Protocol {simulator.protocol_variant.toUpperCase()}
          </span>
          {lastSeen ? <span className={styles.simLastSeen}>{lastSeen}</span> : null}
        </div>
      </td>
      <td>{renderStatusChip(lifecycleMeta.label, lifecycleMeta.tone)}</td>
      <td>
        <div className={styles.runtimeCell}>
          <span className={styles.runtimeStatus}>{runtimeStatus}</span>
          <span className={styles.runtimeMeta}>Last heartbeat: {heartbeat}</span>
        </div>
      </td>
      <td>{renderStatusChip(cmsBadge.label, cmsBadge.tone)}</td>
      <td>
        {connectors.length ? (
          <div className={styles.connectorCell}>
            {connectors.slice(0, 2).map((connector) => (
              <span key={connector.connector_id} className={styles.connectorChip}>
                #{connector.connector_id} · {connector.format ?? "Connector"}
              </span>
            ))}
            {connectors.length > 2 ? (
              <span className={styles.connectorMore}>+{connectors.length - 2} more</span>
            ) : null}
          </div>
        ) : (
          <span className={styles.muted}>No connectors configured</span>
        )}
      </td>
      <td>
        <div className={styles.actionGroup}>
          <Button
            size="sm"
            variant="secondary"
            className={clsx(
              styles.miniAction,
              styles.actionButton,
              primary.variant === "powerOn" && styles.actionPowerOn,
              primary.variant === "disconnect" && styles.actionPowerOff,
              primary.variant === "connect" && styles.actionConnect
            )}
            disabled={primary.disabled || !primary.action}
            title={primary.title}
            icon={primary.variant === "powerOn" ? <Zap size={16} /> : <Plug size={16} />}
            onClick={(event) => {
              event.stopPropagation();
              if (primary.action) {
                void performAction(simulator, primary.action);
              }
            }}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {primary.label}
          </Button>
          {secondaryPowerOff ? (
            <Button
              size="sm"
              variant="secondary"
              className={clsx(styles.miniAction, styles.actionButton, styles.actionPowerOff)}
              disabled={secondaryPowerOff.disabled}
              title={secondaryPowerOff.title}
              icon={<Power size={16} />}
              onClick={(event) => {
                event.stopPropagation();
                void performAction(simulator, secondaryPowerOff.action);
              }}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {secondaryPowerOff.label}
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
};

// Exposed only for tests
export const _SimulatorRowTestOnly = SimulatorRow;
