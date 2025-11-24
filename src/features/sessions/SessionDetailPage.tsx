'use client';

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/common/Card";
import { Badge } from "@/components/common/Badge";
import { Sparkline } from "@/components/charts/Sparkline";
import { useTenantApi } from "@/hooks/useTenantApi";
import { queryKeys } from "@/lib/queryKeys";
import { pickCanonicalTransactionId } from "@/lib/transactions";
import {
  ChargingSession,
  SessionBillingDetail,
  SimulatedMeterValue,
  SimulatedSession
} from "@/types";
import styles from "./SessionDetailPage.module.css";

interface PaginatedResponse<T> {
  count: number;
  results: T[];
}

const METER_HISTORY_LIMIT = 100;

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

type SessionDetailPageProps = {
  sessionId: number;
};

export const SessionDetailPage = ({ sessionId: sessionIdProp }: SessionDetailPageProps) => {
  const sessionId = Number(sessionIdProp);
  const router = useRouter();
  const api = useTenantApi();

  const sessionQuery = useQuery({
    queryKey: queryKeys.chargingSession(sessionId),
    enabled: Number.isFinite(sessionId),
    queryFn: () =>
      api.request<ChargingSession>(`/api/ocpp/charging-sessions/${sessionId}/`)
  });

  const sessionBillingId = sessionQuery.data?.session_billing_id;
  const billingQuery = useQuery({
    queryKey: queryKeys.sessionBilling(sessionBillingId ?? "none"),
    enabled: Boolean(sessionBillingId),
    queryFn: () =>
      api.request<SessionBillingDetail>(
        `/api/users/session-billings/${sessionBillingId}/details/`
      )
  });

  const transactionKey = pickCanonicalTransactionId(
    sessionQuery.data?.formatted_transaction_id,
    sessionQuery.data?.cms_transaction_key,
    sessionQuery.data?.transaction_id
  );

  const simulatedSessionQuery = useQuery({
    queryKey: ["sim-session", transactionKey],
    enabled: Boolean(transactionKey),
    queryFn: async () => {
      const response = await api.request<PaginatedResponse<SimulatedSession>>(
        "/api/ocpp-simulator/sessions/",
        { query: { cms_transaction_key: transactionKey as string, limit: 1 } }
      );
      return response.results[0] ?? null;
    }
  });

  const simulatedSessionId = simulatedSessionQuery.data?.id;
  const meterValuesQuery = useQuery({
    queryKey: queryKeys.meterValues({ session: simulatedSessionId, limit: METER_HISTORY_LIMIT }),
    enabled: Boolean(simulatedSessionId),
    queryFn: () =>
      api.request<PaginatedResponse<SimulatedMeterValue>>(
        "/api/ocpp-simulator/meter-values/",
        { query: { session: simulatedSessionId, page_size: METER_HISTORY_LIMIT } }
      )
  });

  const session = sessionQuery.data;
  const billing = billingQuery.data;
  const simulated = simulatedSessionQuery.data ?? undefined;
  const meterSamples = useMemo(
    () => meterValuesQuery.data?.results ?? [],
    [meterValuesQuery.data?.results]
  );
  const canonicalTransactionId =
    transactionKey ?? (session?.transaction_id ? String(session.transaction_id) : undefined);

  const sparklineData = useMemo(() => {
    if (!meterSamples.length) {
      return [];
    }
    const ordered = [...meterSamples].sort(
      (a, b) => new Date(a.sampledAt).getTime() - new Date(b.sampledAt).getTime()
    );
    return ordered.map((sample) => ({ value: sample.valueWh / 1000 }));
  }, [meterSamples]);

  const deltaPowers = useMemo(() => {
    if (!meterSamples.length) {
      return [];
    }
    const ordered = [...meterSamples].sort(
      (a, b) => new Date(a.sampledAt).getTime() - new Date(b.sampledAt).getTime()
    );
    const powers: number[] = [];
    for (let i = 1; i < ordered.length; i += 1) {
      const prev = ordered[i - 1];
      const current = ordered[i];
      const deltaWh = current.valueWh - prev.valueWh;
      const seconds =
        (new Date(current.sampledAt).getTime() - new Date(prev.sampledAt).getTime()) /
        1000;
      if (deltaWh > 0 && seconds > 0) {
        powers.push((deltaWh / 1000) / (seconds / 3600));
      }
    }
    return powers;
  }, [meterSamples]);

  const averagePowerKw = useMemo(() => {
    if (!session?.energy_kwh) {
      return null;
    }
    const durationSeconds = session.duration_seconds ??
      (session.start_time && session.end_time
        ? Math.floor(
            (new Date(session.end_time).getTime() - new Date(session.start_time).getTime()) /
              1000
          )
        : null);
    if (!durationSeconds || durationSeconds <= 0) {
      return null;
    }
    return session.energy_kwh / (durationSeconds / 3600);
  }, [session?.energy_kwh, session?.duration_seconds, session?.start_time, session?.end_time]);

  const peakPowerKw = deltaPowers.length ? Math.max(...deltaPowers) : null;

  const walletOrder = billing?.related_orders?.find((order) => order.wallet) ?? null;
  const walletEntry = walletOrder?.wallet ?? null;
  const walletAmounts = walletEntry
    ? {
        amount: Number(walletEntry.amount ?? 0),
        start: Number(walletEntry.start_balance ?? 0),
        end: Number(walletEntry.end_balance ?? 0)
      }
    : null;

  const anomalies: string[] = [];
  if (session?.reason) {
    anomalies.push(`Stop reason: ${session.reason}`);
  }
  if (session?.limit && session.limit_type) {
    anomalies.push(`Limit set: ${session.limit} ${session.limit_type}`);
  }
  if (walletOrder && walletOrder.status !== "Paid") {
    anomalies.push(`Order status is ${walletOrder.status}`);
  }
  if (!anomalies.length) {
    anomalies.push("No anomalies recorded");
  }

  const timeline = useMemo(() => {
    const items: Array<{ label: string; time: string | null }> = [];
    if (session?.start_time) {
      items.push({ label: "Session started", time: session.start_time ?? null });
    }
    if (simulated?.started_at) {
      items.push({ label: "Charging authorized", time: simulated.started_at ?? null });
    }
    if (walletEntry) {
      items.push({ label: "Wallet deduction applied", time: walletEntry.created_at ?? null });
    }
    if (session?.end_time) {
      items.push({ label: "Session completed", time: session.end_time ?? null });
    }
    return items;
  }, [session?.start_time, session?.end_time, simulated?.started_at, walletEntry]);

  const metadataProfile = simulated?.metadata &&
    typeof simulated.metadata === "object" &&
    simulated.metadata !== null
      ? (simulated.metadata as Record<string, unknown>).charging_profile
      : null;

  if (sessionQuery.isLoading) {
    return (
      <div className={styles.page}>
        <Card>
          <p>Loading session…</p>
        </Card>
      </div>
    );
  }

  if (!session) {
    return (
      <div className={styles.page}>
        <Card>
          <p>Session not found.</p>
          <button className={styles.backButton} onClick={() => router.back()}>
            Go back
          </button>
        </Card>
      </div>
    );
  }

  const state = (simulated?.state ?? session.session_state ?? "unknown").toLowerCase();
  const stateTone =
    state === "charging" || state === "authorized"
      ? "success"
      : state === "completed" || state === "finishing"
        ? "info"
        : state === "errored" || state === "timeout"
          ? "danger"
          : "warning";

  return (
    <div className={styles.page}>
      <div className={styles.breadcrumb}>
        <Link href="/sessions" className={styles.breadcrumbLink}>
          ← Sessions
        </Link>
        <span>{canonicalTransactionId ?? "—"}</span>
      </div>

      <div className={styles.grid}>
        <Card className={styles.summaryCard}>
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionLabel}>Session</span>
              <h2 className={styles.sectionTitle}>{canonicalTransactionId ?? "—"}</h2>
            </div>
            <Badge tone={stateTone} label={state} />
          </div>
          <div className={styles.metricList}>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Charger</span>
              <span className={styles.metricValue}>
                {session.charger_name ?? session.charger_id ?? "—"}
              </span>
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Connector</span>
              <span className={styles.metricValue}>{session.connector_number ?? session.connector}</span>
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>ID Tag</span>
              <span className={styles.metricValue}>{session.id_tag_value ?? "—"}</span>
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Started</span>
              <span className={styles.metricValue}>{formatDateTime(session.start_time)}</span>
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Finished</span>
              <span className={styles.metricValue}>{formatDateTime(session.end_time)}</span>
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Duration</span>
              <span className={styles.metricValue}>{formatDuration(session.duration_seconds)}</span>
            </div>
          </div>
        </Card>

        <Card>
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionLabel}>Meter</span>
              <h3 className={styles.sectionTitle}>Energy &amp; Power</h3>
            </div>
          </div>
          <div className={styles.metricList}>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Meter Start</span>
              <span className={styles.metricValue}>
                {session.meter_start_kwh !== null && session.meter_start_kwh !== undefined
                  ? `${session.meter_start_kwh.toFixed(3)} kWh`
                  : "—"}
              </span>
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Meter Stop</span>
              <span className={styles.metricValue}>
                {session.meter_stop_kwh !== null && session.meter_stop_kwh !== undefined
                  ? `${session.meter_stop_kwh.toFixed(3)} kWh`
                  : "—"}
              </span>
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Energy</span>
              <span className={styles.metricValue}>
                {session.energy_kwh !== null && session.energy_kwh !== undefined
                  ? `${session.energy_kwh.toFixed(3)} kWh`
                  : "—"}
              </span>
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Avg Power</span>
              <span className={styles.metricValue}>
                {averagePowerKw ? `${averagePowerKw.toFixed(1)} kW` : "—"}
              </span>
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Peak Power</span>
              <span className={styles.metricValue}>
                {peakPowerKw ? `${peakPowerKw.toFixed(1)} kW` : "—"}
              </span>
            </div>
          </div>
          <div className={styles.sparklineWrapper}>
            {sparklineData.length ? <Sparkline data={sparklineData} /> : <p>No meter samples yet.</p>}
          </div>
        </Card>

        <Card>
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionLabel}>Cost</span>
              <h3 className={styles.sectionTitle}>Billing &amp; Wallet</h3>
            </div>
          </div>
          <div className={styles.metricList}>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Tariff</span>
              <span className={styles.metricValue}>
                {session.price_per_kwh !== null && session.price_per_kwh !== undefined
                  ? `₹ ${(session.price_per_kwh ?? 0).toFixed(2)}/kWh`
                  : "—"}
              </span>
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Total Cost</span>
              <span className={styles.metricValue}>
                {session.cost !== null && session.cost !== undefined
                  ? `₹ ${session.cost.toFixed(2)}`
                  : "—"}
              </span>
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Wallet Deduction</span>
              <span className={styles.metricValue}>
                {walletAmounts ? `₹ ${Math.abs(walletAmounts.amount).toFixed(2)}` : "—"}
              </span>
              {walletAmounts ? (
                <span className={styles.metricHint}>
                  {`Balance: ₹ ${walletAmounts.end.toFixed(2)} (was ₹ ${walletAmounts.start.toFixed(2)})`}
                </span>
              ) : null}
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Order Status</span>
              <span className={styles.metricValue}>{walletOrder?.status ?? "—"}</span>
            </div>
          </div>
        </Card>

        <Card>
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionLabel}>Limits &amp; Reasons</span>
              <h3 className={styles.sectionTitle}>Session Controls</h3>
            </div>
          </div>
          <ul className={styles.list}>
            <li>
              <span className={styles.metricLabel}>Limit</span>
              <span className={styles.metricValue}>
                {session.limit ? `${session.limit} ${session.limit_type ?? ""}` : "No explicit limit"}
              </span>
            </li>
            <li>
              <span className={styles.metricLabel}>Stop Reason</span>
              <span className={styles.metricValue}>{session.reason ?? "—"}</span>
            </li>
            <li>
              <span className={styles.metricLabel}>Anomalies</span>
              <ul className={styles.anomalyList}>
                {anomalies.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </li>
            {metadataProfile ? (
              <li>
                <span className={styles.metricLabel}>Charging Profile</span>
                <pre className={styles.metadata}>{JSON.stringify(metadataProfile, null, 2)}</pre>
              </li>
            ) : null}
          </ul>
        </Card>

        <Card>
          <div className={styles.sectionHeader}>
            <div>
              <span className={styles.sectionLabel}>Timeline</span>
              <h3 className={styles.sectionTitle}>Session Events</h3>
            </div>
          </div>
          <ul className={styles.timeline}>
            {timeline.map((item, index) => (
              <li key={`${item.label}-${index}`}>
                <span className={styles.metricLabel}>{item.label}</span>
                <span className={styles.metricValue}>{formatDateTime(item.time)}</span>
              </li>
            ))}
            {!timeline.length ? <li>No timeline events captured.</li> : null}
          </ul>
        </Card>
      </div>
    </div>
  );
};
