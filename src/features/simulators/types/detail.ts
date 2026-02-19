import { SimulatedConnector, SimulatedSession } from "@/types";
import { NormalizedSample } from "../graphHelpers";

export type SimulatorEventPayload = {
  type?: string;
  [key: string]: unknown;
};

export type ConnectorMeterTimeline = {
  transactionId?: string;
  transactionKey?: string;
  samples: NormalizedSample[];
};

export interface CmsChargingSession {
  id: number;
  connector: number;
  transaction_id: number;
  formatted_transaction_id: string;
  cms_transaction_key?: string | null;
  start_time: string;
  end_time: string | null;
  meter_start: number;
  meter_stop: number | null;
  meter_start_kwh?: number | null;
  meter_stop_kwh?: number | null;
  energy_kwh?: number | null;
  price_per_kwh?: number | null;
  cost: number | null;
  id_tag?: number | null;
  limit_type?: string | null;
  limit?: number | null;
   duration_seconds?: number | null;
}

export interface CmsConnector {
  id: number;
  connector_id: number;
  status: string;
  type: string;
  charger_id: number;
  max_kw?: number | null;
  max_charging_power?: number | null;
  phase_count?: number | null;
}

export type SessionLifecycle = SimulatedSession["state"] | "idle";

export type SessionRuntime = {
  connectorId: number;
  transactionId?: string;
  transactionKey?: string;
  idTag?: string;
  userLimit?: number | null;
  limitType?: "KWH" | "AMOUNT" | null;
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
  state: SessionLifecycle;
  meterStartWh?: number;
  meterStopWh?: number;
  meterStopFinalWh?: number;
  isFinal?: boolean;
  activeSession?: boolean;
  pricePerKwh?: number | null;
  maxKw?: number | null;
  cmsSessionId?: number | null;
  cmsTransactionKey?: string | null;
  finalSample?: NormalizedSample | null;
  lastSampleAt?: string | null;
};

export type TimelineTone = "info" | "success" | "warning" | "danger" | "neutral";
export type TimelineIconKey = "activity" | "plug" | "power" | "zap" | "gauge" | "alert" | "info";
export type TimelineKind =
  | "lifecycle"
  | "fault"
  | "connector"
  | "session"
  | "meter"
  | "command"
  | "log"
  | "heartbeat";

export type TimelineMetric = {
  label: string;
  value: string;
  muted?: boolean;
};

export type TimelineEvent = {
  id: string;
  dedupeKey: string;
  timestamp: string;
  kind: TimelineKind;
  title: string;
  subtitle?: string;
  badge?: string;
  tone: TimelineTone;
  icon: TimelineIconKey;
  metrics?: TimelineMetric[];
  meta?: string;
};

export type TimelineEventInput = Omit<TimelineEvent, "id">;

export type ConnectorSummary = {
  connectorId: number;
  connector: SimulatedConnector | null;
  samples: NormalizedSample[];
  sessionState: SessionLifecycle;
  connectorStatus: string;
  statusLabel: string;
  statusTone: TimelineTone;
  sessionStatusLabel: string;
  sessionStatusClass: string;
  transactionId?: string;
  transactionKey?: string;
  runtime?: SessionRuntime;
  energyKwh: number;
  meterStartKwh: number;
  meterStopKwh: number;
  meterStopFinalWh?: number;
  isFinal: boolean;
  deltaKwh: number | null;
  powerKw: number | null;
  costSoFar?: number | null;
  pricePerKwh?: number | null;
  lastUpdated: string | null;
  lastSampleAt: string | null;
  duration: string | null;
  userLimit?: number | null;
  limitType?: "KWH" | "AMOUNT" | null;
  cmsSession?: CmsChargingSession;
  current: number | null;
  idTag?: string;
  activeSession: boolean;
  isPlugged: boolean;
};

export type TelemetryFeedEntry = {
  connectorId: number;
  timestamp: string;
  transactionId?: string;
  powerKw: number | null;
  current: number | null;
  energyKwh: number | null;
  energyRegisterKwh?: number | null;
  status: SessionLifecycle | string;
  statusClass: string;
  statusLabel: string;
  idTag?: string;
};

export type HeartbeatFeedEntry = {
  id: string;
  timestamp: string;
  chargerId: string;
  simulatorId?: number | string;
  connectorCount?: number | null;
};

export type ResetFlowStage = "requested" | "rebooting" | "reconnected";
export type ResetFlowState = {
  type: "Soft" | "Hard" | "Force";
  stage: ResetFlowStage;
};

export type EventTimelineHandle = {
  syncTelemetry: (entries: TelemetryFeedEntry[]) => void;
  syncTimeline: (entries: TimelineEvent[]) => void;
  syncHeartbeats: (entries: HeartbeatFeedEntry[]) => void;
  reset: () => void;
};
