import { FormEvent, useEffect, useId, useMemo, useState } from "react";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "@/components/common/Modal";
import { Button } from "@/components/common/Button";
import { CmsIdTag, SimulatedConnector } from "@/types";
import styles from "./ActionModal.module.css";
import { useTenantApi } from "@/hooks/useTenantApi";
import { queryKeys } from "@/lib/queryKeys";
import { useTenantAuth } from "@/features/auth/useTenantAuth";
import { getUserIdFromToken } from "@/lib/jwt";
import { endpoints } from "@/lib/endpoints";
import { connectorStatusTone, formatConnectorStatusLabel, normalizeConnectorStatus } from "../utils/status";

interface RemoteStartModalProps {
  open: boolean;
  connectors: SimulatedConnector[];
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (payload: { connectorId: number; idTag: string }) => Promise<void>;
}

export const RemoteStartModal = ({
  open,
  connectors,
  busy,
  onCancel,
  onSubmit
}: RemoteStartModalProps) => {
  const firstConnectorId = useMemo(() => connectors[0]?.connector_id ?? 1, [connectors]);
  const [connectorId, setConnectorId] = useState<number>(firstConnectorId);
  const [idTag, setIdTag] = useState("SIM");
  const [error, setError] = useState<string | null>(null);
  const datalistId = useId();
  const api = useTenantApi();
  const { tokens } = useTenantAuth();

  const userId = useMemo(() => getUserIdFromToken(tokens?.access), [tokens]);
  const selectedConnector = useMemo(
    () => connectors.find((connector) => connector.connector_id === connectorId),
    [connectors, connectorId]
  );
  const connectorStatus = useMemo(
    () => normalizeConnectorStatus(selectedConnector?.initial_status ?? "AVAILABLE"),
    [selectedConnector]
  );
  const statusLabel = useMemo(() => formatConnectorStatusLabel(connectorStatus), [connectorStatus]);
  const statusTone = useMemo(() => connectorStatusTone(connectorStatus), [connectorStatus]);
  const statusToneClass = useMemo(() => {
    switch (statusTone) {
      case "success":
        return styles.toneSuccess;
      case "warning":
        return styles.toneWarning;
      case "danger":
        return styles.toneDanger;
      case "info":
        return styles.toneInfo;
      default:
        return styles.toneNeutral;
    }
  }, [statusTone]);

  const {
    data: idTagResponse,
    isLoading: idTagsLoading,
    isError: idTagsError
  } = useQuery({
    queryKey: queryKeys.idTags({ userId }),
    enabled: open,
    staleTime: 60_000,
    queryFn: async () =>
      api.requestPaginated<CmsIdTag>(endpoints.cms.idTags, {
        query: { page_size: 200, is_blocked: false, ...(userId ? { user_id: userId } : {}) }
      })
  });

  const idTags = useMemo(() => idTagResponse?.results ?? [], [idTagResponse?.results]);

  useEffect(() => {
    if (open) {
      setConnectorId(firstConnectorId);
      setIdTag("SIM");
      setError(null);
    }
  }, [open, firstConnectorId]);

  useEffect(() => {
    if (!open || !idTags.length) {
      return;
    }
    setIdTag((current) => {
      if (!current || current === "SIM") {
        return idTags[0].idtag;
      }
      return current;
    });
  }, [open, idTags]);

  const handleClose = () => {
    setError(null);
    setConnectorId(firstConnectorId);
    setIdTag("SIM");
    onCancel();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await onSubmit({ connectorId, idTag: idTag.trim() || "SIM" });
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to start charging. Please try again.");
      }
    }
  };

  return (
    <Modal title="Start Charging Session" open={open} onClose={handleClose}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="connector-select">
            Connector
          </label>
          <select
            id="connector-select"
            className={styles.select}
            value={connectorId}
            onChange={(event) => setConnectorId(Number(event.target.value))}
            disabled={busy}
          >
            {connectors.map((connector) => (
              <option key={connector.connector_id} value={connector.connector_id}>
                #{connector.connector_id} · {connector.format ?? "Connector"} ·{" "}
                {connector.max_kw ? `${connector.max_kw} kW` : "Power unknown"}
              </option>
            ))}
            {!connectors.length ? <option value={1}>Connector 1</option> : null}
          </select>
          <span className={styles.helper}>
            The CMS will receive a RemoteStartTransaction for the selected connector.
          </span>
        </div>
        <div className={styles.statusRow}>
          <div className={styles.statusMeta}>
            <span className={styles.label}>Status</span>
            <span className={clsx(styles.statusBadge, statusToneClass)}>
              <span className={styles.statusDot} />
              {statusLabel}
            </span>
          </div>
          <span className={styles.helper}>
            Plug the connector before starting — status should read PREPARING once the gun is inserted.
          </span>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="idtag-input">
            Id Tag
          </label>
          <input
            id="idtag-input"
            className={styles.input}
            value={idTag}
            onChange={(event) => setIdTag(event.target.value)}
            maxLength={64}
            disabled={busy}
            placeholder="SIM"
            list={idTags.length ? datalistId : undefined}
          />
          {idTagsLoading ? (
            <span className={styles.helper}>Loading ID tags…</span>
          ) : idTagsError ? (
            <span className={styles.helper}>Defaults to “SIM” if left blank.</span>
          ) : idTags.length ? (
            <span className={styles.helper}>
              Choose an existing ID tag from the CMS or type a custom value.
            </span>
          ) : (
            <span className={styles.helper}>Defaults to “SIM” if no tags are available.</span>
          )}
          {idTags.length ? (
            <datalist id={datalistId}>
              {idTags.map((tag) => (
                <option key={tag.id} value={tag.idtag} />
              ))}
            </datalist>
          ) : null}
        </div>
        {error ? <span className={styles.error}>{error}</span> : null}
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={handleClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Starting…" : "Start charging"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
