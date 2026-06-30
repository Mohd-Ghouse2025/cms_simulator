export type ResolveConnectorSelectionArgs = {
  preferredConnectorId: number | null;
  selectedConnectorId: number | null;
  validConnectorIds: number[];
  userHasSelected: boolean;
};

export const resolveConnectorSelection = ({
  preferredConnectorId,
  selectedConnectorId,
  validConnectorIds,
  userHasSelected
}: ResolveConnectorSelectionArgs): number | null => {
  if (!validConnectorIds.length) {
    return null;
  }
  const selectedValid = selectedConnectorId !== null && validConnectorIds.includes(selectedConnectorId);
  if (userHasSelected && selectedValid) {
    return selectedConnectorId;
  }
  const preferredValid = preferredConnectorId !== null && validConnectorIds.includes(preferredConnectorId);
  if (preferredValid) {
    return preferredConnectorId;
  }
  if (selectedValid) {
    return selectedConnectorId;
  }
  return validConnectorIds[0] ?? null;
};

export type PreferredConnectorCandidate = {
  connectorId: number;
  activeSession?: boolean;
  sessionState?: string | null;
  completedAt?: string | null;
  lastSampleAt?: string | null;
  startedAt?: string | null;
};

const getLatestConnectorTimestamp = (connector: PreferredConnectorCandidate): number | null => {
  const timestamps = [connector.completedAt, connector.lastSampleAt, connector.startedAt]
    .map((value) => (value ? Date.parse(value) : NaN))
    .filter((value) => Number.isFinite(value));
  if (!timestamps.length) return null;
  return Math.max(...timestamps);
};

export const pickActiveConnectorId = (
  connectors: PreferredConnectorCandidate[],
  activeSessionConnectorId: number | null
): number | null => {
  if (!connectors.length) return null;
  const validIds = new Set(connectors.map((c) => c.connectorId));
  if (activeSessionConnectorId && validIds.has(activeSessionConnectorId)) {
    return activeSessionConnectorId;
  }
  const runtimeActive = connectors.find((c) => c.activeSession);
  if (runtimeActive && validIds.has(runtimeActive.connectorId)) {
    return runtimeActive.connectorId;
  }
  const stateActive = connectors.find((c) =>
    ["charging", "authorized", "finishing"].includes((c.sessionState ?? "").toLowerCase())
  );
  if (stateActive && validIds.has(stateActive.connectorId)) {
    return stateActive.connectorId;
  }
  const latestHistorical = connectors
    .map((connector) => ({ connector, timestamp: getLatestConnectorTimestamp(connector) }))
    .filter((entry): entry is { connector: PreferredConnectorCandidate; timestamp: number } => entry.timestamp !== null)
    .sort((a, b) => b.timestamp - a.timestamp)[0]?.connector;
  if (latestHistorical && validIds.has(latestHistorical.connectorId)) {
    return latestHistorical.connectorId;
  }
  return connectors[0]?.connectorId ?? null;
};
