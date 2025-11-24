import { useEffect } from "react";
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

  useEffect(() => {
    const timers = toasts.map((toast) => {
      if (!toast.timeoutMs) {
        return null;
      }
      return window.setTimeout(() => removeToast(toast.id), toast.timeoutMs);
    });
    return () => {
      timers.forEach((timer) => {
        if (timer) {
          window.clearTimeout(timer);
        }
      });
    };
  }, [removeToast, toasts]);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className={styles.container}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`${styles.toast} ${LEVEL_CLASS[toast.level ?? "info"]}`}
          role="status"
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
        </div>
      ))}
    </div>
  );
};
