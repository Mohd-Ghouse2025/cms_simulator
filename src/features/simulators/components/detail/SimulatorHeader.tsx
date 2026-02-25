import { Button } from "@/components/common/Button";
import styles from "../../SimulatorDetailPage.module.css";

export type SimulatorHeaderProps = {
  simulatorTitle: string;
  simulatorSubtitle: string;
  lifecycleBadgeClass: string;
  lifecycleLabel: string;
  onBack: () => void;
  onEdit: () => void;
  editBusy: boolean;
  socketButtonLabel: string;
  onSocketToggle: () => void;
  socketButtonDisabled?: boolean;
};

export const SimulatorHeader = ({
  simulatorTitle,
  simulatorSubtitle,
  lifecycleBadgeClass,
  lifecycleLabel,
  onBack,
  onEdit,
  editBusy,
  socketButtonLabel,
  onSocketToggle,
  socketButtonDisabled
}: SimulatorHeaderProps) => (
  <header className={styles.topBar}>
    <button type="button" className={styles.backLink} onClick={onBack}>
      ← Back to Simulators
    </button>
    <div className={styles.headerInfo}>
      <div className={styles.headerTitleRow}>
        <h1 className={styles.headerTitle}>{simulatorTitle}</h1>
        <span className={lifecycleBadgeClass}>{lifecycleLabel}</span>
      </div>
      <p className={styles.headerSubtext}>{simulatorSubtitle}</p>
    </div>
    <div className={styles.headerActions}>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onSocketToggle}
        disabled={socketButtonDisabled}
      >
        {socketButtonLabel}
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onEdit}
        disabled={editBusy}
      >
        Edit Simulator
      </Button>
    </div>
  </header>
);
