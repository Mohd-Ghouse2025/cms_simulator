import { create } from "zustand";

export type ToastLevel = "info" | "success" | "warning" | "error";

export type Toast = {
  id: string;
  title: string;
  description?: string;
  level?: ToastLevel;
  timeoutMs?: number;
};

type NotificationState = {
  toasts: Toast[];
  pushToast: (toast: Omit<Toast, "id"> & { id?: string }) => void;
  removeToast: (id: string) => void;
  clear: () => void;
};

const createId = () => crypto.randomUUID();
const MAX_TOASTS = 3;
const toastTimers = new Map<string, number>();

const sameToast = (a: Toast, b: Toast) =>
  (a.level ?? "info") === (b.level ?? "info") &&
  a.title === b.title &&
  (a.description ?? "") === (b.description ?? "");

export const useNotificationStore = create<NotificationState>((set, get) => ({
  toasts: [],
  pushToast: (toast) => {
    const state = get();
    const normalized: Toast = {
      id: toast.id ?? createId(),
      level: toast.level ?? "info",
      ...toast
    };

    const duplicate = state.toasts.find((existing) => sameToast(existing, normalized));
    const toastId = duplicate?.id ?? normalized.id;
    const mergedToast: Toast = { ...duplicate, ...normalized, id: toastId };

    const nextToasts = [...state.toasts.filter((item) => item.id !== toastId), mergedToast];
    const trimmed = nextToasts.length > MAX_TOASTS ? nextToasts.slice(nextToasts.length - MAX_TOASTS) : nextToasts;

    set({ toasts: trimmed });

    if (mergedToast.timeoutMs && typeof window !== "undefined") {
      const existingTimer = toastTimers.get(toastId);
      if (existingTimer) {
        window.clearTimeout(existingTimer);
      }
      const timer = window.setTimeout(() => {
        toastTimers.delete(toastId);
        get().removeToast(toastId);
      }, mergedToast.timeoutMs);
      toastTimers.set(toastId, timer);
    }
  },
  removeToast: (id) => {
    const timer = toastTimers.get(id);
    if (timer) {
      window.clearTimeout(timer);
      toastTimers.delete(id);
    }
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id)
    }));
  },
  clear: () => {
    toastTimers.forEach((timer) => window.clearTimeout(timer));
    toastTimers.clear();
    set({ toasts: [] });
  }
}));
