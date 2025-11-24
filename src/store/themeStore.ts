import { create } from "zustand";

type Theme = "light" | "dark";

type ThemeState = {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
};

const getInitialTheme = (): Theme => {
  if (typeof window === "undefined") {
    return "light";
  }
  const stored = window.localStorage.getItem("ocpp-theme");
  if (stored === "dark" || stored === "light") {
    return stored;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

const applyTheme = (theme: Theme) => {
  if (typeof document === "undefined") {
    return;
  }
  document.body.classList.toggle("theme-dark", theme === "dark");
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.setAttribute("data-theme", theme);
};

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: getInitialTheme(),
  toggleTheme: () => {
    const nextTheme = get().theme === "dark" ? "light" : "dark";
    set({ theme: nextTheme });
    if (typeof window !== "undefined") {
      window.localStorage.setItem("ocpp-theme", nextTheme);
      applyTheme(nextTheme);
    }
  },
  setTheme: (theme) => {
    set({ theme });
    if (typeof window !== "undefined") {
      window.localStorage.setItem("ocpp-theme", theme);
      applyTheme(theme);
    }
  }
}));

if (typeof window !== "undefined") {
  applyTheme(getInitialTheme());
}
