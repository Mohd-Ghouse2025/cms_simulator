import { FormEvent, useEffect, useState } from "react";
import { Modal } from "@/components/common/Modal";
import { Button } from "@/components/common/Button";
import styles from "./ActionModal.module.css";

interface ResetModalProps {
  open: boolean;
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (resetType: "Soft" | "Hard") => Promise<void>;
}

type ResetOption = {
  value: "Soft" | "Hard";
  title: string;
  description: string;
};

const RESET_OPTIONS: ResetOption[] = [
  {
    value: "Soft",
    title: "Soft Reset",
    description: "Gracefully restarts simulator services without dropping the WebSocket."
  },
  {
    value: "Hard",
    title: "Hard Reset",
    description: "Simulates a full power cycle, closes the WebSocket, and replays BootNotification."
  }
];

export const ResetModal = ({ open, busy, onCancel, onSubmit }: ResetModalProps) => {
  const [selection, setSelection] = useState<"Soft" | "Hard">("Soft");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelection("Soft");
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await onSubmit(selection);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Reset request failed. Please try again.");
      }
    }
  };

  const handleClose = () => {
    setError(null);
    onCancel();
  };

  return (
    <Modal title="Reset Charger" open={open} onClose={handleClose}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <fieldset className={styles.field}>
          <legend className={styles.label}>Select reset type</legend>
          <div className={styles.radioGroup}>
            {RESET_OPTIONS.map((option) => (
              <label key={option.value} className={styles.radioOption}>
                <input
                  type="radio"
                  name="resetType"
                  className={styles.radio}
                  value={option.value}
                  checked={selection === option.value}
                  onChange={() => setSelection(option.value)}
                  disabled={busy}
                />
                <span>
                  <span className={styles.radioTitle}>{option.title}</span>
                  <span className={styles.helper}>{option.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {error ? <span className={styles.error}>{error}</span> : null}
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={handleClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Dispatching…" : `Send ${selection} reset`}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
