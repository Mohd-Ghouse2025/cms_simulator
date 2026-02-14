import { AnimatePresence, motion } from "framer-motion";
import { useNotificationStore } from "@/store/notificationStore";
import styles from "./NotificationOutlet.module.css";

const LEVEL_CLASS: Record<string, string> = {
  info: styles.info,
  success: styles.success,
  warning: styles.warning,
  error: styles.error
};

export const NotificationOutlet = () => {
  const { toasts, removeToast } = useNotificationStore();

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className={styles.container} role="region" aria-label="Notifications">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className={`${styles.toast} ${LEVEL_CLASS[toast.level ?? "info"]}`}
            role="status"
            aria-live="polite"
          >
            <div className={styles.toastHeader}>
              <span className={styles.toastTitle}>{toast.title}</span>
              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                className={styles.dismiss}
                aria-label="Dismiss notification"
              >
                ×
              </button>
            </div>
            {toast.description ? (
              <p className={styles.toastDescription}>{toast.description}</p>
            ) : null}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
