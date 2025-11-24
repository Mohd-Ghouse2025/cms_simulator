import { FormEvent } from "react";
import { Modal } from "@/components/common/Modal";
import { Button } from "@/components/common/Button";
import styles from "./ActionModal.module.css";

interface ForceResetModalProps {
  open: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

export const ForceResetModal = ({ open, busy, onCancel, onConfirm }: ForceResetModalProps) => {
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await onConfirm();
  };

  return (
    <Modal title="Force Reset Charger" open={open} onClose={onCancel}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <p className={styles.helper}>
          This will terminate any active charging sessions locally, clear simulator state, and issue a
          hard reset even if the CMS is offline. Use when standard stop/reset commands fail.
        </p>
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={busy}>
            {busy ? "Force resetting…" : "Force reset"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
