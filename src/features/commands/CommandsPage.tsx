'use client';

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/common/Card";
import { DataTable } from "@/components/common/DataTable";
import { Badge } from "@/components/common/Badge";
import { Button } from "@/components/common/Button";
import { Pagination } from "@/components/common/Pagination";
import { useTenantApi } from "@/hooks/useTenantApi";
import { queryKeys } from "@/lib/queryKeys";
import { CommandLog, SimulatedCharger } from "@/types";
import { CommandComposer } from "./components/CommandComposer";
import styles from "./CommandsPage.module.css";

interface PaginatedResponse<T> {
  count: number;
  results: T[];
}

const COMMANDS_PAGE_SIZE = 25;

const STATUS_TONE: Record<CommandLog["status"], "warning" | "info" | "success" | "danger"> = {
  queued: "warning",
  sent: "info",
  ack: "info",
  completed: "success",
  failed: "danger"
};

export const CommandsPage = () => {
  const api = useTenantApi();
  const [composerOpen, setComposerOpen] = useState(false);
  const [simFilter, setSimFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [simFilter, statusFilter]);

  const simulatorsQuery = useQuery({
    queryKey: queryKeys.simulators(),
    queryFn: () =>
      api.request<PaginatedResponse<SimulatedCharger>>("/api/ocpp-simulator/simulated-chargers/", {
        query: { page_size: 200 }
      }),
    staleTime: 60_000
  });

  const commandLogsQuery = useQuery({
    queryKey: queryKeys.commandLogs({
      simulator: simFilter || undefined,
      status: statusFilter || undefined,
      page
    }),
    queryFn: () =>
      api.request<PaginatedResponse<CommandLog>>("/api/ocpp-simulator/command-logs/", {
        query: {
          ordering: "-created_at",
          page,
          page_size: COMMANDS_PAGE_SIZE,
          ...(simFilter ? { simulator: simFilter } : {}),
          ...(statusFilter ? { status: statusFilter } : {})
        }
      }),
    refetchInterval: 5_000
  });

  const rows = useMemo(() => {
    return (commandLogsQuery.data?.results ?? []).map((log) => {
      const simulatorLabel = log.simulator_alias ?? log.simulator_charger_id ?? `Simulator ${log.simulator}`;
      const latencyLabel =
        log.latency_ms && log.latency_ms > 0
          ? `${(log.latency_ms / 1000).toFixed(2)} s`
          : "—";
      return {
        ...log,
        simulatorLabel,
        latencyLabel,
        createdLabel: log.created_at ? new Date(log.created_at).toLocaleString() : "—",
        updatedLabel: log.updated_at ? new Date(log.updated_at).toLocaleString() : "—",
        errorLabel: log.error ? log.error : "—"
      };
    });
  }, [commandLogsQuery.data?.results]);

  const isLoading = commandLogsQuery.isLoading;
  const simulatorOptions = simulatorsQuery.data?.results ?? [];

  return (
    <div className={styles.page}>
      <Card
        title={<span className="heading-md">Command Logs</span>}
        toolbar={<Button onClick={() => setComposerOpen(true)}>Dispatch Command</Button>}
      >
        <div className={styles.filters}>
          <label className={styles.filterControl}>
            <span>Simulator</span>
            <select value={simFilter} onChange={(event) => setSimFilter(event.target.value)}>
              <option value="">All simulators</option>
              {simulatorOptions.map((sim) => (
                <option key={sim.id} value={String(sim.id)}>
                  {sim.alias ?? sim.charger_id ?? `Simulator ${sim.id}`}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.filterControl}>
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">Any status</option>
              <option value="queued">Queued</option>
              <option value="sent">Sent</option>
              <option value="ack">Acknowledged</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          {(simFilter || statusFilter) ? (
            <Button variant="secondary" onClick={() => { setSimFilter(""); setStatusFilter(""); }}>
              Reset filters
            </Button>
          ) : null}
        </div>
        <DataTable
          data={rows}
          columns={[
            {
              header: "Action",
              accessor: (row) => (
                <Link href={`/commands/${row.id}`} className={styles.link}>
                  {row.action}
                </Link>
              )
            },
            { header: "Simulator", accessor: (row) => row.simulatorLabel },
            {
              header: "Status",
              accessor: (row) => (
                <Badge tone={STATUS_TONE[row.status]} label={row.status} />
              )
            },
            {
              header: "Latency",
              accessor: (row) => row.latencyLabel
            },
            {
              header: "Created",
              accessor: (row) => row.createdLabel
            },
            {
              header: "Updated",
              accessor: (row) => row.updatedLabel
            },
            {
              header: "Error",
              accessor: (row) => row.errorLabel
            }
          ]}
          emptyState={isLoading ? "Loading commands…" : "No command logs yet"}
        />
        <Pagination
          page={page}
          pageSize={COMMANDS_PAGE_SIZE}
          total={commandLogsQuery.data?.count ?? 0}
          isLoading={commandLogsQuery.isLoading}
          onPageChange={setPage}
        />
      </Card>
      <CommandComposer open={composerOpen} onClose={() => setComposerOpen(false)} />
    </div>
  );
};
