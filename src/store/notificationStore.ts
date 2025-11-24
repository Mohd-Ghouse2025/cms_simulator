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

export const useNotificationStore = create<NotificationState>((set) => ({
  toasts: [],
  pushToast: (toast) =>
    set((state) => {
      const id = toast.id ?? createId();
      return { toasts: [...state.toasts, { ...toast, id }] };
    }),
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id)
    })),
  clear: () => set({ toasts: [] })
}));
