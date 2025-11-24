'use client';

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/common/Card";
import { DataTable } from "@/components/common/DataTable";
import { useTenantApi } from "@/hooks/useTenantApi";
import { queryKeys } from "@/lib/queryKeys";
import { MetricSample } from "@/types";
import styles from "./MetricsPage.module.css";

const parsePrometheus = (source: string): MetricSample[] => {
  const samples: MetricSample[] = [];
  const lines = source.split(/\n+/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }
    const labelStart = trimmed.indexOf("{");
    const labelEnd = trimmed.indexOf("}");
    let name = trimmed;
    let labels: Record<string, string> = {};
    let valuePart = trimmed;
    if (labelStart !== -1 && labelEnd !== -1) {
      name = trimmed.slice(0, labelStart);
      valuePart = trimmed.slice(labelEnd + 1).trim();
      const labelSource = trimmed.slice(labelStart + 1, labelEnd);
      labels = Object.fromEntries(
        labelSource.split(",").map((segment) => {
          const [key, raw] = segment.split("=");
          return [key, raw?.replace(/"/g, "") ?? ""];
        })
      );
    } else {
      const parts = trimmed.split(/[\s]+/);
      name = parts[0];
      valuePart = parts[1] ?? "0";
    }
    samples.push({
      name,
      value: Number(valuePart.split(" ")[0]),
      labels,
      timestamp: new Date().toISOString()
    });
  });
  return samples;
};

export const MetricsPage = () => {
  const api = useTenantApi();
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.metrics,
    queryFn: async () =>
      api.request<string>("/api/ocpp-simulator/metrics/", {
        headers: { Accept: "text/plain" },
        responseType: "text"
      }),
    refetchInterval: 30_000
  });

  const samples = useMemo(() => (data ? parsePrometheus(data) : []), [data]);
  const topSamples = samples.slice(0, 10);

  return (
    <div className={styles.page}>
      <Card title={<span className="heading-md">Metrics Observatory</span>}>
        {isLoading ? <p>Loading metrics…</p> : null}
        {isError ? <p className={styles.error}>Metrics endpoint unavailable</p> : null}
        <DataTable
          data={topSamples}
          columns={[
            { header: "Metric", accessor: (row) => row.name },
            {
              header: "Labels",
              accessor: (row) =>
                Object.entries(row.labels ?? {})
                  .map(([key, value]) => `${key}=${value}`)
                  .join(", ") || "—"
            },
            { header: "Value", accessor: (row) => row.value }
          ]}
          emptyState={isLoading ? "" : "No metrics"}
        />
      </Card>
    </div>
  );
};
