export type RawSampleInput = {
  connectorId: number;
  timestamp?: number | string;
  valueWh?: number;
  deltaWh?: number;
  intervalSeconds?: number;
  powerKw?: number;
  currentA?: number;
  voltageV?: number;
  energyKwh?: number;
  transactionId?: string;
};

export type NormalizedSample = {
  connectorId: number;
  timestamp: number;
  isoTimestamp: string;
  valueWh: number;
  powerKw: number;
  currentA: number;
  energyKwh: number;
  deltaWh?: number;
  intervalSeconds?: number;
  voltageV?: number;
  transactionId?: string;
};

export type GraphPoint = {
  timestamp: number;
  timeLabel: string;
  powerKw: number;
  currentA: number;
  energyKwh: number;
};

const DEFAULT_VOLTAGE = 400;
const MAX_POINTS = 720;

const resolveTimestamp = (value?: number | string): { timestamp: number; isoTimestamp: string } => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { timestamp: value, isoTimestamp: new Date(value).toISOString() };
  }
  if (typeof value === "string" && value.trim().length) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return { timestamp: parsed, isoTimestamp: new Date(parsed).toISOString() };
    }
  }
  const now = Date.now();
  return { timestamp: now, isoTimestamp: new Date(now).toISOString() };
};

export const normalizeSample = (
  input: RawSampleInput,
  previous?: NormalizedSample
): NormalizedSample => {
  const { timestamp, isoTimestamp } = resolveTimestamp(input.timestamp);
  const rawWh = Number.isFinite(input.valueWh) ? Number(input.valueWh) : undefined;
  // Clamp to previous value to avoid backward energy jumps
  const valueWh =
    rawWh !== undefined && Number.isFinite(rawWh)
      ? previous && rawWh < previous.valueWh
        ? previous.valueWh
        : rawWh
      : previous?.valueWh ?? 0;
  const rawEnergyKwh = Number.isFinite(input.energyKwh)
    ? Number(input.energyKwh)
    : valueWh / 1000;
  const deltaWh = Number.isFinite(input.deltaWh)
    ? Number(input.deltaWh)
    : previous
      ? valueWh - previous.valueWh
      : undefined;
  const intervalSeconds = Number.isFinite(input.intervalSeconds)
    ? Number(input.intervalSeconds)
    : previous
      ? (timestamp - previous.timestamp) / 1000
      : undefined;
  const computedPower =
    typeof input.powerKw === "number"
      ? input.powerKw
      : deltaWh && intervalSeconds && intervalSeconds > 0
        ? (deltaWh / 1000) / (intervalSeconds / 3600)
        : previous?.powerKw ?? 0;
  const voltage = Number.isFinite(input.voltageV)
    ? Number(input.voltageV)
    : DEFAULT_VOLTAGE;
  const computedCurrent =
    typeof input.currentA === "number"
      ? input.currentA
      : voltage > 0
        ? (computedPower * 1000) / voltage
        : previous?.currentA ?? 0;
  const roundedPower = Number(Number(computedPower).toFixed(2));
  const roundedCurrent = Number(Number(computedCurrent).toFixed(2));
  const roundedEnergy = Number(Number(rawEnergyKwh).toFixed(3));
  const roundedVoltage = Number(Number(voltage).toFixed(1));

  return {
    connectorId: input.connectorId,
    timestamp,
    isoTimestamp,
    valueWh,
    powerKw: Number.isFinite(roundedPower) ? roundedPower : 0,
    currentA: Number.isFinite(roundedCurrent) ? roundedCurrent : 0,
    energyKwh: Number.isFinite(roundedEnergy) ? roundedEnergy : 0,
    deltaWh,
    intervalSeconds,
    voltageV: Number.isFinite(roundedVoltage) ? roundedVoltage : undefined,
    transactionId: input.transactionId
  };
};

export const appendSample = (
  samples: NormalizedSample[],
  sample: NormalizedSample
): NormalizedSample[] => {
  const existingIndex = samples.findIndex((item) => item.timestamp === sample.timestamp);
  if (existingIndex !== -1) {
    const next = [...samples];
    next[existingIndex] = sample;
    return next;
  }
  const next = [...samples, sample].sort((a, b) => a.timestamp - b.timestamp);
  return next;
};

export const trimWindow = (
  samples: NormalizedSample[],
  windowMs: number
): NormalizedSample[] => {
  if (!samples.length) {
    return samples;
  }
  const latestTs = samples[samples.length - 1].timestamp;
  const cutoff = latestTs - windowMs;
  const filtered = samples.filter((sample) => sample.timestamp >= cutoff);
  if (filtered.length <= MAX_POINTS) {
    return filtered;
  }
  const stride = Math.ceil(filtered.length / MAX_POINTS);
  const reduced: NormalizedSample[] = [];
  for (let index = 0; index < filtered.length; index += stride) {
    reduced.push(filtered[index]);
  }
  if (reduced[reduced.length - 1] !== filtered[filtered.length - 1]) {
    reduced.push(filtered[filtered.length - 1]);
  }
  return reduced;
};

const defaultTimeFormatter = (value: number): string =>
  new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

export const buildGraphData = (
  samples: NormalizedSample[],
  formatTime: (timestamp: number) => string = defaultTimeFormatter
): GraphPoint[] =>
  samples.map((sample) => ({
    timestamp: sample.timestamp,
    timeLabel: formatTime(sample.timestamp),
    powerKw: Math.max(sample.powerKw, 0),
    currentA: Math.max(sample.currentA, 0),
    energyKwh: Math.max(sample.energyKwh, 0)
  }));

const jitterFromTimestamp = (timestamp: number): number => {
  const x = Math.sin(timestamp / 98765) * 10000;
  return ((x - Math.floor(x)) * 2 - 1) || 0;
};

const applyMovingAverage = (samples: NormalizedSample[], window = 3): NormalizedSample[] =>
  samples.map((sample, index) => {
    const start = Math.max(0, index - window + 1);
    const slice = samples.slice(start, index + 1);
    const average = (key: "powerKw" | "currentA") =>
      slice.reduce((sum, entry) => sum + entry[key], 0) / slice.length;
    const smoothedPower = Number(average("powerKw").toFixed(3));
    const smoothedCurrent = Number(average("currentA").toFixed(2));
    return {
      ...sample,
      powerKw: smoothedPower,
      currentA: smoothedCurrent
    };
  });

export const smoothSamples = (samples: NormalizedSample[], window = 3): NormalizedSample[] => {
  if (samples.length <= 2) {
    return samples;
  }
  const ordered = [...samples].sort((a, b) => a.timestamp - b.timestamp);
  const withMinimalJitter = ordered.map((sample, index) => {
    const jitter = jitterFromTimestamp(sample.timestamp) * 0.01;
    const adjustedPower = Math.max(sample.powerKw * (1 + jitter), 0);
    return {
      ...sample,
      powerKw: Number(adjustedPower.toFixed(3))
    };
  });
  return applyMovingAverage(withMinimalJitter, window);
};

export const downsampleSeries = <T extends { timestamp: number }>(
  samples: T[],
  maxPoints = 360
): T[] => {
  if (samples.length <= maxPoints) {
    return samples;
  }
  const stride = Math.ceil(samples.length / maxPoints);
  const reduced: T[] = [];
  for (let index = 0; index < samples.length; index += stride) {
    reduced.push(samples[index]);
  }
  const last = samples[samples.length - 1];
  if (reduced[reduced.length - 1] !== last) {
    reduced.push(last);
  }
  return reduced;
};
