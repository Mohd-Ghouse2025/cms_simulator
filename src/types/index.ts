export type ProtocolVariant = "1.6j" | "2.0.1";

export type ConnectorStatus =
  | "AVAILABLE"
  | "PREPARING"
  | "CHARGING"
  | "SUSPENDED_EV"
  | "SUSPENDED_EVSE"
  | "FINISHING"
  | "FAULTED"
  | "UNAVAILABLE";

export type ChargerLifecycleState =
  | "OFFLINE"
  | "POWERED_ON"
  | "CONNECTING"
  | "CONNECTED"
  | "CHARGING"
  | "ERROR";
export type SimulatorInstanceStatus =
  | "pending"
  | "running"
  | "stopped"
  | "error";

export type CommandStatus =
  | "queued"
  | "sent"
  | "ack"
  | "completed"
  | "failed";

export interface SimulatedConnector {
  id: number;
  connector_id: number;
  format?: string;
  max_kw?: number;
  phase_count?: number;
  initial_status: ConnectorStatus;
  metadata?: Record<string, unknown>;
}

export interface TelemetrySampleSnapshot {
  timestamp?: string | null;
  valueWh?: number | null;
  energyKwh?: number | null;
  powerKw?: number | null;
  currentA?: number | null;
  voltageV?: number | null;
  deltaWh?: number | null;
  intervalSeconds?: number | null;
  transactionId?: string | null;
}

export interface ConnectorTelemetryHistory {
  connectorId: number;
  sessionId?: number | null;
  cmsSessionId?: number | null;
  transactionId?: string | null;
  state?: string | null;
  meterStartWh?: number | null;
  meterStopWh?: number | null;
  samples: TelemetrySampleSnapshot[];
  finalSample?: TelemetrySampleSnapshot | null;
}

export interface ConnectorTelemetrySnapshot {
  connectorId: number;
  sessionId?: number | null;
  transactionId?: string | null;
  state?: string | null;
  meterStartWh?: number | null;
  meterStopWh?: number | null;
  lastSample?: TelemetrySampleSnapshot | null;
}

export interface CmsIdTag {
  id: number;
  idtag: string;
  user: number;
  parent_idtag?: string | null;
  is_blocked: boolean;
  expiry_date?: string | null;
  is_expired: boolean;
}

export interface SimulatedMeterValue {
  id: number;
  simulatorId: number;
  sessionId?: number | null;
  connectorId?: number | null;
  connectorNumber: number;
  valueWh: number;
  sampledAt: string;
  transactionId?: string | null;
  payload: Record<string, unknown>;
}

export interface SimulatedCharger {
  id: number;
  charger: number;
  charger_id?: string;
  alias?: string;
  protocol_variant: ProtocolVariant;
  simulator_version?: string;
  firmware_baseline?: string;
  require_tls: boolean;
  allowed_cidrs: string[];
  default_heartbeat_interval: number;
  default_meter_value_interval: number;
  default_status_interval: number;
  smart_charging_profile?: Record<string, unknown>;
  ocpp_capabilities?: string[];
  notes?: string;
  lifecycle_state: ChargerLifecycleState;
  latest_instance_status?: SimulatorInstanceStatus | null;
  latest_instance_last_heartbeat?: string | null;
  created_at: string;
  updated_at: string;
  connectors: SimulatedConnector[];
  price_per_kwh?: number | null;
  telemetrySnapshot?: Record<string, ConnectorTelemetrySnapshot> | null;
  telemetryHistory?: Record<string, ConnectorTelemetryHistory> | null;
  cms_online?: boolean;
  cms_present?: boolean;
  cms_last_heartbeat?: string | null;
}

export interface SimulatorInstance {
  id: number;
  sim: number;
  status: SimulatorInstanceStatus;
  protocol_driver: string;
  celery_queue?: string;
  worker_hostname?: string;
  process_id?: string | null;
  runtime_pidfile?: string | null;
  started_at?: string | null;
  stopped_at?: string | null;
  last_heartbeat?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommandLog {
  id: number;
  simulator: number;
  simulator_alias?: string | null;
  simulator_charger_id?: string | null;
  scenario_run?: number | null;
  action: string;
  payload: Record<string, unknown>;
  response_payload?: Record<string, unknown> | null;
  status: CommandStatus;
  cms_request_id?: string | null;
  latency_ms?: number | null;
  error?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SimulatedSession {
  id: number;
  simulator: number;
  connector: number;
  cms_transaction?: number | null;
  cms_transaction_key?: string | null;
  id_tag?: string;
  state:
    | "pending"
    | "authorized"
    | "charging"
    | "finishing"
    | "completed"
    | "errored"
    | "timeout";
  started_at?: string | null;
  completed_at?: string | null;
  meter_start_wh?: number | null;
  meter_stop_wh?: number | null;
  meter_target_wh?: number | null;
  meter_curve?: unknown[];
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface ChargingSession {
  id: number;
  connector: number;
  connector_number?: number | null;
  simulator_id?: number | null;
  charger_id?: string | null;
  charger_name?: string | null;
  transaction_id: number;
  formatted_transaction_id: string;
  cms_transaction_key?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  meter_start?: number | null;
  meter_stop?: number | null;
  meter_start_kwh?: number | null;
  meter_stop_kwh?: number | null;
  energy_kwh?: number | null;
  duration_seconds?: number | null;
  reservation_id?: string | null;
  limit?: number | null;
  reason?: string | null;
  limit_type?: string | null;
  id_tag?: number | null;
  id_tag_value?: string | null;
  stop_id_tag?: number | null;
  stop_id_tag_value?: string | null;
  auth_method?: string | null;
  ocpi_session_id?: string | null;
  ocpi_emsp_id?: string | null;
  price_per_kwh?: number | null;
  cost?: number | null;
  session_billing_id?: string | null;
  session_state?: string | null;
}

export interface WalletEntry {
  id: string;
  user?: number;
  username?: string;
  amount: number;
  start_balance: number;
  end_balance: number;
  reason: string;
  created_at: string;
  updated_at: string;
}

export interface OrderSummary {
  id: string;
  user?: number;
  username?: string;
  amount: number;
  tax: number;
  gateway_id?: string | null;
  gateway_name?: string | null;
  order_serial?: number | null;
  status: string;
  limit_type?: string | null;
  type: string;
  property?: Record<string, unknown> | null;
  payment_info?: unknown;
  session_billing?: unknown;
  wallet?: WalletEntry | null;
}

export interface SessionBillingDetail {
  id: string;
  session: ChargingSession;
  amount_added: number;
  amount_consumed?: number | null;
  amount_refunded?: number | null;
  time_added?: number | null;
  time_consumed?: number | null;
  time_refunded?: number | null;
  kwh_added: number;
  kwh_consumed?: number | null;
  kwh_refunded?: number | null;
  cdr_sent: boolean;
  related_orders: OrderSummary[];
  is_active: boolean;
  duration?: {
    hours: number;
    minutes: number;
    formatted: string;
    seconds: number;
  } | null;
}

export type ScenarioStep = {
  action?: string;
  params?: Record<string, unknown>;
  delay?: number;
};

export interface Scenario {
  id: number;
  name: string;
  slug: string;
  description?: string;
  ocpp_version: ProtocolVariant;
  tags: string[];
  is_active: boolean;
  default_parameters?: {
    steps?: ScenarioStep[];
    [key: string]: unknown;
  };
}

export interface ScenarioRun {
  id: number;
  scenario: Scenario | null;
  simulator_instance: number | null;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  progress_percent?: number | null;
  metrics?: Record<string, unknown> | null;
  result_summary?: Record<string, unknown> | null;
  error_detail?: string | null;
  parameters?: Record<string, unknown> | null;
  log_stream_id?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at: string;
}

export interface FaultDefinition {
  id: number;
  fault_code: string;
  category?: string;
  severity?: "INFO" | "WARN" | "CRITICAL";
  payload_template?: Record<string, unknown>;
  description?: string;
}

export interface FaultInjection {
  id: number;
  fault_definition: number;
  simulator: number;
  connector?: number | null;
  status: "planned" | "active" | "resolved" | "failed";
  scheduled_for?: string | null;
  auto_recover?: boolean;
}

export interface MetricSample {
  name: string;
  value: number;
  labels?: Record<string, string>;
  timestamp: string;
}
