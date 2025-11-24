'use client';

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/common/Card";
import { Badge } from "@/components/common/Badge";
import { useTenantApi } from "@/hooks/useTenantApi";
import { queryKeys } from "@/lib/queryKeys";
import { getLifecycleStatusMeta } from "@/lib/simulatorLifecycle";
import { CommandLog, SimulatedCharger } from "@/types";
import styles from "./CommandDetailPage.module.css";

const STATUS_TONE: Record<CommandLog["status"], "warning" | "info" | "success" | "danger"> = {
  queued: "warning",
  sent: "info",
  ack: "info",
  completed: "success",
  failed: "danger"
};

const prettyJson = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

type CommandDetailPageProps = {
  commandId: number;
};

export const CommandDetailPage = ({ commandId: commandIdProp }: CommandDetailPageProps) => {
  const commandId = Number(commandIdProp);
  const router = useRouter();
  const api = useTenantApi();

  const commandQuery = useQuery({
    queryKey: queryKeys.commandLog(commandId),
    enabled: Number.isFinite(commandId),
    queryFn: () =>
      api.request<CommandLog>(`/api/ocpp-simulator/command-logs/${commandId}/`)
  });

  const simulatorId = commandQuery.data?.simulator;
  const simulatorQuery = useQuery({
    queryKey: ["simulator", simulatorId],
    enabled: Boolean(simulatorId),
    queryFn: () =>
      api.request<SimulatedCharger>(
        `/api/ocpp-simulator/simulated-chargers/${simulatorId}/`
      )
  });

  if (commandQuery.isLoading) {
    return (
      <div className={styles.page}>
        <Card>
          <p>Loading command…</p>
        </Card>
      </div>
    );
  }

  const command = commandQuery.data;
  if (!command) {
    return (
      <div className={styles.page}>
        <Card>
          <p>Command not found.</p>
          <button className={styles.backButton} onClick={() => router.back()}>
            Go back
          </button>
        </Card>
      </div>
    );
  }

  const simulatorLabel =
    command.simulator_alias ?? command.simulator_charger_id ?? `Simulator ${command.simulator}`;
  const latencyLabel = command.latency_ms ? `${(command.latency_ms / 1000).toFixed(2)} s` : "—";

  return (
    <div className={styles.page}>
      <div className={styles.breadcrumb}>
        <Link href="/commands" className={styles.breadcrumbLink}>
          ← Commands
        </Link>
        <span>Command #{command.id}</span>
      </div>

      <div className={styles.grid}>
        <Card className={styles.summaryCard}>
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionLabel}>Command</span>
              <h2 className={styles.sectionTitle}>{command.action}</h2>
            </div>
            <Badge tone={STATUS_TONE[command.status]} label={command.status} />
          </div>
          <dl className={styles.definitionList}>
            <div>
              <dt>Simulator</dt>
              <dd>{simulatorLabel}</dd>
            </div>
            <div>
              <dt>Request ID</dt>
              <dd>{command.cms_request_id ?? "—"}</dd>
            </div>
            <div>
              <dt>Scenario Run</dt>
              <dd>{command.scenario_run ?? "—"}</dd>
            </div>
            <div>
              <dt>Latency</dt>
              <dd>{latencyLabel}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{command.created_at ? new Date(command.created_at).toLocaleString() : "—"}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{command.updated_at ? new Date(command.updated_at).toLocaleString() : "—"}</dd>
            </div>
            <div>
              <dt>Error</dt>
              <dd className={command.error ? styles.error : undefined}>{command.error ?? "—"}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionLabel}>Request</span>
              <h3 className={styles.sectionTitle}>Payload</h3>
            </div>
          </div>
          <pre className={styles.json}>{prettyJson(command.payload)}</pre>
        </Card>

        <Card>
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionLabel}>Response</span>
              <h3 className={styles.sectionTitle}>Return Payload</h3>
            </div>
          </div>
          <pre className={styles.json}>{prettyJson(command.response_payload ?? {})}</pre>
        </Card>

        {simulatorQuery.data ? (
          <Card>
            <div className={styles.sectionHeader}>
              <div>
                <span className={styles.sectionLabel}>Simulator</span>
                <h3 className={styles.sectionTitle}>Profile</h3>
              </div>
            </div>
            <div className={styles.simulatorMeta}>
              <div>
                <span className={styles.metricLabel}>Charger ID</span>
                <span className={styles.metricValue}>
                  {simulatorQuery.data.charger_id ?? simulatorQuery.data.alias}
                </span>
              </div>
              <div>
                <span className={styles.metricLabel}>Protocol</span>
                <span className={styles.metricValue}>{simulatorQuery.data.protocol_variant}</span>
              </div>
              <div>
                <span className={styles.metricLabel}>Lifecycle</span>
                <span className={styles.metricValue}>
                  {getLifecycleStatusMeta(simulatorQuery.data.lifecycle_state).label}
                </span>
              </div>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
};
