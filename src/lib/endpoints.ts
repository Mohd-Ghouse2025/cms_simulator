const SIM_BASE = "/api/ocpp-simulator";
const OCPP_BASE = "/api/ocpp";
const USERS_BASE = "/api/users";

export const endpoints = {
  auth: {
    health: "/api/health/",
    loginWithPassword: `${USERS_BASE}/login_with_password/`,
    refreshToken: `${USERS_BASE}/refresh_token/`,
  },
  simulators: {
    list: `${SIM_BASE}/simulated-chargers/`,
    detail: (id: number | string) => `${SIM_BASE}/simulated-chargers/${id}/`,
    startProcess: (id: number | string) => `${SIM_BASE}/simulated-chargers/${id}/start_process/`,
    stopProcess: (id: number | string) => `${SIM_BASE}/simulated-chargers/${id}/stop_process/`,
    connect: (id: number | string) => `${SIM_BASE}/simulated-chargers/${id}/connect/`,
    disconnect: (id: number | string) => `${SIM_BASE}/simulated-chargers/${id}/disconnect/`,
    remoteStart: (id: number | string) => `${SIM_BASE}/simulated-chargers/${id}/remote-start/`,
    remoteStop: (id: number | string) => `${SIM_BASE}/simulated-chargers/${id}/remote-stop/`,
    statusUpdate: (id: number | string) => `${SIM_BASE}/simulated-chargers/${id}/status-update/`,
    faultInjection: (id: number | string) => `${SIM_BASE}/simulated-chargers/${id}/fault-injection/`,
    reset: (id: number | string) => `${SIM_BASE}/simulated-chargers/${id}/reset/`,
    forceReset: (id: number | string) => `${SIM_BASE}/simulated-chargers/${id}/force-reset/`,
  },
  simulatorInstances: `${SIM_BASE}/simulator-instances/`,
  sessions: `${SIM_BASE}/sessions/`,
  meterValues: `${SIM_BASE}/meter-values/`,
  commandLogs: `${SIM_BASE}/command-logs/`,
  commandLog: (id: number | string) => `${SIM_BASE}/command-logs/${id}/`,
  commandDispatch: `${SIM_BASE}/command-logs/dispatch/`,
  scenarios: `${SIM_BASE}/scenarios/`,
  scenarioRuns: `${SIM_BASE}/scenario-runs/`,
  faultDefinitions: `${SIM_BASE}/fault-definitions/`,
  faultInjections: `${SIM_BASE}/fault-injections/`,
  dashboardSummary: `${SIM_BASE}/dashboard/summary/`,
  metrics: `${SIM_BASE}/metrics/`,
  cms: {
    chargingSessions: `${OCPP_BASE}/charging-sessions/`,
    chargingSession: (id: number | string) => `${OCPP_BASE}/charging-sessions/${id}/`,
    connectors: `${OCPP_BASE}/connectors/`,
    idTags: `${OCPP_BASE}/id-tags/`,
    chargers: `${OCPP_BASE}/chargers/`,
  },
  billing: {
    sessionBillingDetail: (id: number | string) => `${USERS_BASE}/session-billings/${id}/details/`,
  },
};
