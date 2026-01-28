'use client';

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/common/Card";
import { DataTable } from "@/components/common/DataTable";
import { Badge } from "@/components/common/Badge";
import { useTenantApi } from "@/hooks/useTenantApi";
import { queryKeys } from "@/lib/queryKeys";
import { getLifecycleStatusMeta } from "@/lib/simulatorLifecycle";
import { endpoints } from "@/lib/endpoints";
import {
  CommandLog,
  FaultInjection,
  SimulatedCharger,
  SimulatedSession
} from "@/types";
import styles from "./DashboardPage.module.css";

interface DashboardSummary {
  simulators: {
    total: number;
    connected: number;
    charging: number;
    powered_on: number;
    offline: number;
    error: number;
  };
  sessions: {
    active: number;
  };
  commands: {
    pending: number;
    failed: number;
  };
  faults: {
    open: number;
  };
}

const SESSION_TONE: Record<SimulatedSession["state"], "info" | "success" | "warning" | "danger"> =
  {
    pending: "warning",
    authorized: "info",
    charging: "success",
    finishing: "info",
    completed: "info",
    errored: "danger",
    timeout: "danger"
  };

const COMMAND_TONE: Record<CommandLog["status"], "danger" | "success" | "warning"> = {
  failed: "danger",
  completed: "success",
  queued: "warning",
  sent: "warning",
  ack: "warning"
};

export const DashboardPage = () => {
  const api = useTenantApi();

  const summaryQuery = useQuery({
    queryKey: queryKeys.dashboardSummary,
    queryFn: () =>
      api.request<DashboardSummary>(endpoints.dashboardSummary),
    staleTime: 5_000
  });

  const activeSessionsQuery = useQuery({
    queryKey: queryKeys.sessions({ active: true, limit: 8 }),
    queryFn: () =>
      api.requestPaginated<SimulatedSession>(endpoints.sessions, {
        query: { active: true, limit: 8 }
      }),
    staleTime: 5_000
  });

  const commandLogsQuery = useQuery({
    queryKey: queryKeys.commandLogs({ limit: 8, status: "queued,sent,failed" }),
    queryFn: () =>
      api.requestPaginated<CommandLog>(endpoints.commandLogs, {
        query: { limit: 8, status: "queued,sent,failed" }
      }),
    staleTime: 5_000
  });

  const activeFaultsQuery = useQuery({
    queryKey: queryKeys.faultInjections({ status: "active", limit: 5 }),
    queryFn: () =>
      api.requestPaginated<FaultInjection>(endpoints.faultInjections, {
        query: { status: "active", limit: 5 }
      }),
    staleTime: 10_000
  });

  const offlineSimulatorsQuery = useQuery({
    queryKey: queryKeys.simulators({ lifecycle_state: "OFFLINE,ERROR", limit: 5 }),
    queryFn: () =>
      api.requestPaginated<SimulatedCharger>(endpoints.simulators.list, {
        query: { lifecycle_state: "OFFLINE,ERROR", limit: 5 }
      }),
    staleTime: 10_000
  });

  const summaryItems = useMemo(() => {
    const summary = summaryQuery.data;
    const loading = summaryQuery.isLoading;
    if (!summary) {
      return [
        { label: "Connected simulators", value: 0, hint: "—", loading },
        { label: "Charging connectors", value: 0, hint: "—", loading },
        { label: "Active sessions", value: 0, hint: "—", loading },
        { label: "Pending commands", value: 0, hint: "—", loading },
        { label: "Open faults", value: 0, hint: "—", loading },
        { label: "Simulators needing attention", value: 0, hint: "—", loading }
      ];
    }
    const attentionCount = summary.simulators.offline + summary.simulators.error;
    return [
      {
        label: "Connected simulators",
        value: summary.simulators.connected,
        hint: `${summary.simulators.connected}/${summary.simulators.total} of fleet`,
        loading
      },
      {
        label: "Charging connectors",
        value: summary.simulators.charging,
        hint: `${summary.simulators.charging} connector${summary.simulators.charging === 1 ? "" : "s"} delivering energy`,
        loading
      },
      {
        label: "Active sessions",
        value: summary.sessions.active,
        hint:
          summary.sessions.active > 0
            ? "Includes pending / charging states"
            : "No active sessions",
        loading
      },
      {
        label: "Pending commands",
        value: summary.commands.pending,
        hint:
          summary.commands.pending > 0
            ? `${summary.commands.pending} queued or awaiting acknowledgement`
            : "Command queue is empty",
        loading
      },
      {
        label: "Open faults",
        value: summary.faults.open,
        hint: summary.faults.open > 0 ? "Requires attention" : "All clear",
        loading
      },
      {
        label: "Simulators needing attention",
        value: attentionCount,
        hint:
          attentionCount > 0
            ? `${summary.simulators.offline} offline · ${summary.simulators.error} error`
            : "All simulators responsive",
        loading
      }
    ];
  }, [summaryQuery.data, summaryQuery.isLoading]);

  const activeSessions = activeSessionsQuery.data?.results ?? [];
  const recentCommands = commandLogsQuery.data?.results ?? [];
  const activeFaults = activeFaultsQuery.data?.results ?? [];
  const offlineSimulators = offlineSimulatorsQuery.data?.results ?? [];

  return (
    <div className={styles.page}>
      <section className={styles.summaryGrid}>
        {summaryItems.map((item) => (
          <div key={item.label} className={styles.summaryCard}>
            <span className={styles.summaryLabel}>{item.label}</span>
            <span className={styles.summaryValue}>
              {item.loading ? "…" : item.value}
            </span>
            <span className={styles.summaryHint}>{item.hint}</span>
          </div>
        ))}
      </section>

      <section className={styles.columns}>
        <div className={styles.primaryColumn}>
          <Card
            title={<span className="heading-sm">Active charging sessions</span>}
            toolbar={
              activeSessionsQuery.isFetching ? <span className={styles.toolbarInfo}>Refreshing…</span> : null
            }
          >
            <DataTable
              data={activeSessions}
              columns={[
                {
                  header: "Session",
                  accessor: (row) => row.cms_transaction_key ?? `#${row.id}`
                },
                {
                  header: "Simulator",
                  accessor: (row) => row.simulator
                },
                {
                  header: "Connector",
                  accessor: (row) => row.connector ?? "—"
                },
                {
                  header: "State",
                  accessor: (row) => (
                    <Badge tone={SESSION_TONE[row.state]} label={row.state} />
                  )
                },
                {
                  header: "Started",
                  accessor: (row) =>
                    row.started_at ? new Date(row.started_at).toLocaleString() : "—"
                }
              ]}
              emptyState={
                activeSessionsQuery.isLoading ? "Loading sessions…" : "No active sessions"
              }
            />
          </Card>

          <Card
            title={<span className="heading-sm">Command queue & recent failures</span>}
            toolbar={
              commandLogsQuery.isFetching ? <span className={styles.toolbarInfo}>Refreshing…</span> : null
            }
          >
            <DataTable
              data={recentCommands}
              columns={[
                { header: "Action", accessor: (row) => row.action },
                { header: "Simulator", accessor: (row) => row.simulator },
                {
                  header: "Status",
                  accessor: (row) => (
                    <Badge tone={COMMAND_TONE[row.status]} label={row.status} />
                  )
                },
                {
                  header: "Updated",
                  accessor: (row) =>
                    row.updated_at
                      ? new Date(row.updated_at).toLocaleTimeString()
                      : "—"
                }
              ]}
              emptyState={
                commandLogsQuery.isLoading ? "Loading command logs…" : "No queued commands"
              }
            />
          </Card>
        </div>
        <div className={styles.secondaryColumn}>
          <Card
            title={<span className="heading-sm">Offline / error simulators</span>}
            toolbar={
              offlineSimulatorsQuery.isFetching ? <span className={styles.toolbarInfo}>Refreshing…</span> : null
            }
          >
            {offlineSimulators.length ? (
              <ul className={styles.list}>
                {offlineSimulators.map((sim) => {
                  const lifecycleMeta = getLifecycleStatusMeta(sim.lifecycle_state);
                  return (
                    <li key={sim.id} className={styles.listItem}>
                      <div className={styles.listPrimary}>
                        {sim.alias || sim.charger_id || `Simulator #${sim.id}`}
                      </div>
                      <div className={styles.listMeta}>
                        <Badge tone={lifecycleMeta.tone} label={lifecycleMeta.label} />
                        <span className={styles.listTimestamp}>
                          {sim.latest_instance_last_heartbeat
                            ? `Last heartbeat ${new Date(sim.latest_instance_last_heartbeat).toLocaleString()}`
                            : "No heartbeat recorded"}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={styles.placeholder}>
                {offlineSimulatorsQuery.isLoading
                  ? "Loading simulators…"
                  : "All simulators are responsive"}
              </p>
            )}
          </Card>

          <Card
            title={<span className="heading-sm">Active fault injections</span>}
            toolbar={
              activeFaultsQuery.isFetching ? <span className={styles.toolbarInfo}>Refreshing…</span> : null
            }
          >
            <DataTable
              data={activeFaults}
              columns={[
                {
                  header: "Simulator",
                  accessor: (row) => row.simulator
                },
                {
                  header: "Connector",
                  accessor: (row) => row.connector ?? "—"
                },
                {
                  header: "Fault",
                  accessor: (row) => row.fault_definition
                },
                {
                  header: "Scheduled",
                  accessor: (row) =>
                    row.scheduled_for
                      ? new Date(row.scheduled_for).toLocaleString()
                      : "—"
                }
              ]}
              emptyState={
                activeFaultsQuery.isLoading ? "Checking faults…" : "No active faults"
              }
            />
          </Card>
        </div>
      </section>
    </div>
  );
};
