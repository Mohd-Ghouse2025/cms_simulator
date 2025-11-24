export const queryKeys = {
  simulators: (filters?: unknown) => ["simulators", filters] as const,
  simulatorDetail: (id: number | string) =>
    ["simulator-detail", id] as const,
  simulatorInstances: ["simulator-instances"] as const,
  sessions: (filters?: unknown) => ["sessions", filters] as const,
  chargingSessions: (filters?: unknown) => ["charging-sessions", filters] as const,
  chargingSession: (id: number | string) => ["charging-session", id] as const,
  sessionBilling: (id: string | number) => ["session-billing", id] as const,
  commandLogs: (filters?: unknown) => ["command-logs", filters] as const,
  commandLog: (id: number | string) => ["command-log", id] as const,
  scenarios: ["scenarios"] as const,
  scenarioRuns: ["scenario-runs"] as const,
  faultDefinitions: ["fault-definitions"] as const,
  faultInjections: (filters?: unknown) => ["fault-injections", filters] as const,
  dashboardSummary: ["dashboard-summary"] as const,
  metrics: ["metrics"] as const,
  chargers: ["chargers"] as const,
  idTags: (filters?: unknown) => ["id-tags", filters] as const,
  meterValues: (filters?: unknown) => ["meter-values", filters] as const
};
