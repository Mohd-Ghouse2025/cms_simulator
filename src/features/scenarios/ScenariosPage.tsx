'use client';

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card } from "@/components/common/Card";
import { DataTable } from "@/components/common/DataTable";
import { Button } from "@/components/common/Button";
import { Badge } from "@/components/common/Badge";
import { useTenantApi } from "@/hooks/useTenantApi";
import { queryKeys } from "@/lib/queryKeys";
import {
  Scenario,
  ScenarioRun,
  ScenarioStep,
  SimulatedCharger,
  SimulatorInstance
} from "@/types";
import { useNotificationStore } from "@/store/notificationStore";
import { RunScenarioModal } from "./components/RunScenarioModal";
import styles from "./ScenariosPage.module.css";

interface PaginatedResponse<T> {
  count: number;
  results: T[];
}

export const ScenariosPage = () => {
  const api = useTenantApi();
  const params = useSearchParams();
  const pushToast = useNotificationStore((state) => state.pushToast);
  const view = params.get("view") ?? "templates";
  const [selectedScenarioId, setSelectedScenarioId] = useState<number | null>(null);
  const [isRunModalOpen, setRunModalOpen] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const templatesQuery = useQuery({
    queryKey: queryKeys.scenarios,
    queryFn: () =>
      api.request<PaginatedResponse<Scenario>>("/api/ocpp-simulator/scenarios/")
  });

  const runsQuery = useQuery({
    queryKey: queryKeys.scenarioRuns,
    queryFn: () =>
      api.request<PaginatedResponse<ScenarioRun>>("/api/ocpp-simulator/scenario-runs/")
  });

  const simulatorsQuery = useQuery({
    queryKey: queryKeys.simulators(),
    queryFn: () =>
      api.request<PaginatedResponse<SimulatedCharger>>(
        "/api/ocpp-simulator/simulated-chargers/",
        { query: { page_size: 200 } }
      )
  });

  const simulatorInstancesQuery = useQuery({
    queryKey: queryKeys.simulatorInstances,
    queryFn: () =>
      api.request<PaginatedResponse<SimulatorInstance>>(
        "/api/ocpp-simulator/simulator-instances/",
        { query: { page_size: 200 } }
      )
  });

  const templates = useMemo(
    () => templatesQuery.data?.results ?? [],
    [templatesQuery.data?.results]
  );
  const runs = useMemo(() => runsQuery.data?.results ?? [], [runsQuery.data?.results]);

  useEffect(() => {
    if (!templates.length) {
      setSelectedScenarioId(null);
      return;
    }
    if (!selectedScenarioId || !templates.some((scenario) => scenario.id === selectedScenarioId)) {
      setSelectedScenarioId(templates[0].id);
    }
  }, [templates, selectedScenarioId]);

  const selectedScenario = useMemo(
    () => templates.find((scenario) => scenario.id === selectedScenarioId) ?? null,
    [templates, selectedScenarioId]
  );

  const scenarioSteps: ScenarioStep[] = useMemo(() => {
    if (!selectedScenario?.default_parameters) {
      return [];
    }
    const rawSteps = selectedScenario.default_parameters.steps;
    return Array.isArray(rawSteps) ? (rawSteps as ScenarioStep[]) : [];
  }, [selectedScenario]);

  const simulatorLabelMap = useMemo(() => {
    const map = new Map<number, string>();
    (simulatorsQuery.data?.results ?? []).forEach((sim) => {
      const label = sim.alias || sim.charger_id || `Simulator ${sim.id}`;
      map.set(sim.id, label);
    });
    return map;
  }, [simulatorsQuery.data?.results]);

  const simulatorInstanceLabelMap = useMemo(() => {
    const map = new Map<number, string>();
    (simulatorInstancesQuery.data?.results ?? []).forEach((instance) => {
      const simulatorLabel = simulatorLabelMap.get(instance.sim) ?? `Simulator ${instance.sim}`;
      const statusLabel = instance.status.charAt(0).toUpperCase() + instance.status.slice(1);
      map.set(instance.id, `${simulatorLabel} • ${statusLabel}`);
    });
    return map;
  }, [simulatorInstancesQuery.data?.results, simulatorLabelMap]);

  const runningInstances = useMemo(
    () =>
      (simulatorInstancesQuery.data?.results ?? []).filter(
        (instance) => instance.status === "running"
      ),
    [simulatorInstancesQuery.data?.results]
  );

  const simulatorLabelDictionary = useMemo(() => {
    const dictionary: Record<number, string> = {};
    simulatorLabelMap.forEach((label, id) => {
      dictionary[id] = label;
    });
    return dictionary;
  }, [simulatorLabelMap]);

  const runScenarioMutation = useMutation({
    mutationFn: async (instanceId: number) => {
      if (!selectedScenario) {
        throw new Error("Select a scenario first");
      }
      return api.request(`/api/ocpp-simulator/scenarios/${selectedScenario.id}/run/`, {
        method: "POST",
        body: { simulator_instance: instanceId }
      });
    },
    onSuccess: () => {
      pushToast({
        title: "Scenario queued",
        description: "Execution started on the selected simulator instance",
        level: "success",
        timeoutMs: 4000
      });
      runsQuery.refetch();
      setRunModalOpen(false);
    },
    onError: (error) => {
      const message =
        error instanceof Error ? error.message : "Failed to queue scenario execution";
      setRunError(message);
    }
  });

  const handleRunScenario = (instanceId: number) => {
    setRunError(null);
    runScenarioMutation.mutate(instanceId);
  };

  const formatSummary = (summary: ScenarioRun["result_summary"]) => {
    if (!summary) {
      return "—";
    }
    if (typeof summary === "string") {
      return summary;
    }
    if (typeof summary === "object") {
      const serialized = JSON.stringify(summary);
      return serialized.length > 80 ? `${serialized.slice(0, 80)}...` : serialized;
    }
    return "—";
  };

  const formatProgress = (value?: number | null) => {
    if (value === null || value === undefined) {
      return "0%";
    }
    return `${Math.round(value)}%`;
  };

  const emptyTemplatesMessage = templatesQuery.isLoading
    ? "Loading templates..."
    : "No scenarios";

  const emptyRunsMessage = runsQuery.isLoading ? "Loading runs..." : "No scenario executions";

  return (
    <div className={styles.page}>
      {view === "templates" ? (
        <section className={styles.templatesSection}>
          <Card
            title={<span className="heading-md">Scenario Templates</span>}
            toolbar={
              <Button variant="secondary" type="button" disabled title="Template creation coming soon">
                + Template
              </Button>
            }
          >
            <DataTable
              data={templates}
              columns={[
                {
                  header: "Name",
                  accessor: (row) => row.name
                },
                {
                  header: "OCPP Version",
                  accessor: (row) => row.ocpp_version
                },
                { header: "Tags", accessor: (row) => (row.tags ?? []).join(", ") || "—" },
                {
                  header: "Steps",
                  accessor: (row) => row.default_parameters?.steps?.length ?? 0
                }
              ]}
              emptyState={emptyTemplatesMessage}
              getRowId={(row) => row.id}
              onRowClick={(row) => setSelectedScenarioId(row.id)}
              getRowClassName={(row) =>
                row.id === selectedScenarioId ? styles.selectedRow : undefined
              }
            />
          </Card>
          {selectedScenario ? (
            <Card title="Selected Scenario">
              <div className={styles.scenarioHeader}>
                <div>
                  <p className={styles.description}>
                    {selectedScenario.description?.trim() || "No description provided"}
                  </p>
                </div>
                <div className={styles.meta}>
                  <Badge tone="info" label={selectedScenario.ocpp_version.toUpperCase()} />
                  <Badge
                    tone={selectedScenario.is_active ? "success" : "warning"}
                    label={selectedScenario.is_active ? "Active" : "Disabled"}
                  />
                </div>
              </div>
              {selectedScenario.tags?.length ? (
                <div className={styles.tagList}>
                  {selectedScenario.tags.map((tag) => (
                    <span key={tag} className={styles.tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
              <h4 className={styles.sectionHeading}>Default Steps</h4>
              {scenarioSteps.length ? (
                <ol className={styles.steps}>
                  {scenarioSteps.map((step, index) => (
                    <li key={`${step.action ?? "step"}-${index}`}>
                      <div className={styles.stepHeader}>
                        <span className={styles.stepAction}>{step.action ?? "wait"}</span>
                        {step.delay ? (
                          <span className={styles.stepMeta}>{step.delay}s delay</span>
                        ) : null}
                      </div>
                      {step.params && Object.keys(step.params).length ? (
                        <pre className={styles.stepParams}>
                          {JSON.stringify(step.params, null, 2)}
                        </pre>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <div className={styles.noSteps}>No default steps defined</div>
              )}
              <div className={styles.runActions}>
                <Button
                  variant="primary"
                  type="button"
                  onClick={() => setRunModalOpen(true)}
                  disabled={runScenarioMutation.isPending}
                >
                  Run on Simulator
                </Button>
              </div>
            </Card>
          ) : null}
        </section>
      ) : null}
      {view === "runs" ? (
        <Card
          title={<span className="heading-md">Scenario Runs</span>}
          toolbar={
            <Button
              variant="ghost"
              type="button"
              onClick={() => runsQuery.refetch()}
              disabled={runsQuery.isLoading}
            >
              Refresh
            </Button>
          }
        >
          <DataTable
            data={runs}
            columns={[
              { header: "Run ID", accessor: (row) => row.id },
              {
                header: "Scenario",
                accessor: (row) => row.scenario?.name ?? "—"
              },
              {
                header: "Instance",
                accessor: (row) =>
                  row.simulator_instance
                    ? simulatorInstanceLabelMap.get(row.simulator_instance) ??
                      `Instance #${row.simulator_instance}`
                    : "—"
              },
              { header: "Status", accessor: (row) => row.status },
              { header: "Progress", accessor: (row) => formatProgress(row.progress_percent) },
              {
                header: "Result",
                accessor: (row) => formatSummary(row.result_summary)
              }
            ]}
            emptyState={emptyRunsMessage}
          />
        </Card>
      ) : null}

      <RunScenarioModal
        open={isRunModalOpen}
        onClose={() => {
          setRunModalOpen(false);
          setRunError(null);
        }}
        scenarioName={selectedScenario?.name ?? ""}
        instances={runningInstances}
        instanceLabelMap={simulatorLabelDictionary}
        refreshInstances={() => simulatorInstancesQuery.refetch()}
        loadingInstances={simulatorInstancesQuery.isLoading || simulatorInstancesQuery.isFetching}
        submitting={runScenarioMutation.isPending}
        onSubmit={handleRunScenario}
        error={runError}
      />
    </div>
  );
};
