'use client';

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/common/Card";
import { DataTable } from "@/components/common/DataTable";
import { Badge } from "@/components/common/Badge";
import { Button } from "@/components/common/Button";
import { useTenantApi } from "@/hooks/useTenantApi";
import { queryKeys } from "@/lib/queryKeys";
import { endpoints } from "@/lib/endpoints";
import { FaultDefinition, FaultInjection } from "@/types";
import styles from "./FaultsPage.module.css";

export const FaultsPage = () => {
  const api = useTenantApi();
  const definitionsQuery = useQuery({
    queryKey: queryKeys.faultDefinitions,
    queryFn: () =>
      api.requestPaginated<FaultDefinition>(endpoints.faultDefinitions)
  });

  const scheduleQuery = useQuery({
    queryKey: queryKeys.faultInjections(),
    queryFn: () =>
      api.requestPaginated<FaultInjection>(endpoints.faultInjections)
  });

  return (
    <div className={styles.page}>
      <Card
        title={<span className="heading-md">Fault Definitions</span>}
        toolbar={<Button variant="secondary">+ Fault</Button>}
      >
        <DataTable
          data={definitionsQuery.data?.results ?? []}
          columns={[
            { header: "Fault", accessor: (row) => row.fault_code },
            { header: "Category", accessor: (row) => row.category ?? "—" },
            {
              header: "Severity",
              accessor: (row) => <Badge tone={row.severity === "CRITICAL" ? "danger" : "warning"} label={row.severity ?? "INFO"} />
            },
            { header: "Description", accessor: (row) => row.description ?? "—" }
          ]}
          emptyState={definitionsQuery.isLoading ? "Loading fault definitions…" : "No definitions"}
        />
      </Card>
      <Card title={<span className="heading-md">Scheduled Faults</span>}>
        <DataTable
          data={scheduleQuery.data?.results ?? []}
          columns={[
            { header: "Time", accessor: (row) => row.scheduled_for ?? "—" },
            { header: "Simulator", accessor: (row) => row.simulator },
            { header: "Connector", accessor: (row) => row.connector ?? "—" },
            { header: "Fault", accessor: (row) => row.fault_definition },
            { header: "Status", accessor: (row) => row.status }
          ]}
          emptyState={scheduleQuery.isLoading ? "Loading schedule…" : "No scheduled faults"}
        />
      </Card>
    </div>
  );
};
