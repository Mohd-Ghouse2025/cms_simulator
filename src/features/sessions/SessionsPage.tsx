'use client';

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/common/Card";
import { DataTable } from "@/components/common/DataTable";
import { Badge } from "@/components/common/Badge";
import { Pagination } from "@/components/common/Pagination";
import { useTenantApi } from "@/hooks/useTenantApi";
import { queryKeys } from "@/lib/queryKeys";
import { pickCanonicalTransactionId } from "@/lib/transactions";
import { endpoints } from "@/lib/endpoints";
import { ChargingSession, SimulatedSession } from "@/types";
import styles from "./SessionsPage.module.css";

const SESSION_PAGE_SIZE = 10;
const SIMULATED_LOOKBACK_PAGE_SIZE = 200;

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

interface SessionRow {
  id: number;
  transaction: string | null;
  chargerLabel: string;
  connector: string | number;
  state: string;
  badgeTone: BadgeTone;
  started?: string | null;
  completed?: string | null;
  energyKwh: number | null;
  durationSeconds: number | null;
  costLabel: string;
  pricePerKwh: string;
}

export const SessionsPage = () => {
  const api = useTenantApi();
  const [page, setPage] = useState(1);
  const cmsSessionsQuery = useQuery({
    queryKey: queryKeys.chargingSessions({ page, page_size: SESSION_PAGE_SIZE }),
    queryFn: () =>
      api.requestPaginated<ChargingSession>(endpoints.cms.chargingSessions, {
        query: {
          ordering: "-start_time",
          page_size: SESSION_PAGE_SIZE,
          page
        }
      }),
    staleTime: 30_000
  });

  const simulatedSessionsQuery = useQuery({
    queryKey: queryKeys.sessions({ page_size: SIMULATED_LOOKBACK_PAGE_SIZE }),
    queryFn: () =>
      api.requestPaginated<SimulatedSession>(endpoints.sessions, {
        query: { page_size: SIMULATED_LOOKBACK_PAGE_SIZE }
      }),
    staleTime: 30_000
  });

  const formatDateTime = (value?: string | null) =>
    value ? new Date(value).toLocaleString() : "—";

  const formatDuration = (seconds?: number | null): string => {
    if (!seconds || seconds <= 0) {
      return "—";
    }
    const hrs = Math.floor(seconds / 3600)
      .toString()
      .padStart(2, "0");
    const mins = Math.floor((seconds % 3600) / 60)
      .toString()
      .padStart(2, "0");
    const secs = Math.floor(seconds % 60)
      .toString()
      .padStart(2, "0");
    return `${hrs}:${mins}:${secs}`;
  };

  const rows: SessionRow[] = useMemo(() => {
    const cmsSessions = cmsSessionsQuery.data?.results ?? [];
    const simulatedSessions = simulatedSessionsQuery.data?.results ?? [];

    const simulatedByTx = new Map<string, SimulatedSession>();
    simulatedSessions.forEach((session) => {
      const key = pickCanonicalTransactionId(
        session.cms_transaction_key,
        session.cms_transaction,
        session.id
      );
      if (key) {
        simulatedByTx.set(key, session);
      }
    });

    return cmsSessions.map((session) => {
      const transactionKey = pickCanonicalTransactionId(
        session.formatted_transaction_id,
        session.cms_transaction_key,
        session.transaction_id
      );
      const simulated = transactionKey ? simulatedByTx.get(transactionKey) : undefined;

      const energyKwh =
        session.energy_kwh !== null && session.energy_kwh !== undefined
          ? session.energy_kwh
          : session.meter_start_kwh !== null &&
              session.meter_start_kwh !== undefined &&
              session.meter_stop_kwh !== null &&
              session.meter_stop_kwh !== undefined
            ? Math.max(session.meter_stop_kwh - session.meter_start_kwh, 0)
            : null;

      const durationSeconds =
        session.duration_seconds !== null && session.duration_seconds !== undefined
          ? session.duration_seconds
          : session.start_time && session.end_time
            ? Math.floor((new Date(session.end_time).getTime() - new Date(session.start_time).getTime()) / 1000)
            : null;

      const costLabel =
        session.cost !== null && session.cost !== undefined
          ? `₹ ${session.cost.toFixed(2)}`
          : "—";

      const state = (simulated?.state ?? session.session_state ?? "unknown").toLowerCase();

      const badgeTone: BadgeTone =
        state === "charging" || state === "authorized"
          ? "success"
          : state === "completed" || state === "finishing"
            ? "info"
            : state === "errored" || state === "timeout"
              ? "danger"
              : "warning";

      return {
        id: session.id,
        transaction: transactionKey ?? null,
        chargerLabel: session.charger_name ?? session.charger_id ?? "—",
        connector: session.connector_number ?? session.connector ?? "—",
        state,
        badgeTone,
        started: session.start_time,
        completed: session.end_time,
        energyKwh,
        durationSeconds,
        costLabel,
        pricePerKwh:
          session.price_per_kwh !== null && session.price_per_kwh !== undefined
            ? `₹ ${(session.price_per_kwh ?? 0).toFixed(2)}/kWh`
            : "—"
      };
    });
  }, [cmsSessionsQuery.data?.results, simulatedSessionsQuery.data?.results]);

  const isLoading = cmsSessionsQuery.isLoading || simulatedSessionsQuery.isLoading;
  const totalSessions = cmsSessionsQuery.data?.count ?? 0;

  return (
    <div className={styles.page}>
      <Card title={<span className="heading-md">Session History</span>}>
        <DataTable
          data={rows}
          columns={[
            {
              header: "Transaction",
              accessor: (row) =>
                row.transaction ? (
                <Link href={`/sessions/${row.id}`} className={styles.link}>
                    {row.transaction}
                  </Link>
                ) : (
                  "—"
                )
            },
            { header: "Charger", accessor: (row) => row.chargerLabel },
            { header: "Connector", accessor: (row) => row.connector },
            {
              header: "State",
              accessor: (row) => (
                <Badge
                  tone={row.badgeTone}
                  label={row.state}
                />
              )
            },
            {
              header: "Energy",
              accessor: (row) =>
                row.energyKwh !== null && row.energyKwh !== undefined
                  ? `${row.energyKwh.toFixed(3)} kWh`
                  : "—"
            },
            {
              header: "Cost",
              accessor: (row) => (
                <span>
                  {row.costLabel}
                  <span className={styles.hint}>{row.pricePerKwh}</span>
                </span>
              )
            },
            {
              header: "Duration",
              accessor: (row) => formatDuration(row.durationSeconds)
            },
            {
              header: "Started",
              accessor: (row) => formatDateTime(row.started)
            },
            {
              header: "Completed",
              accessor: (row) => formatDateTime(row.completed)
            }
          ]}
          emptyState={isLoading ? "Loading sessions…" : "No sessions found"}
        />
        <Pagination
          page={page}
          pageSize={SESSION_PAGE_SIZE}
          total={totalSessions}
          isLoading={cmsSessionsQuery.isLoading}
          onPageChange={setPage}
        />
      </Card>
    </div>
  );
};
