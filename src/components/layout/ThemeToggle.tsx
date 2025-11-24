import { useThemeStore } from "@/store/themeStore";
import { ControlButton } from "./ControlButton";

const SunIcon = () => (
  <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
  </svg>
);

const MoonIcon = () => (
  <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
    <path d="M21 15.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 11.5 11.5Z" />
  </svg>
);

type ThemeToggleProps = {
  className?: string;
};

export const ThemeToggle = ({ className }: ThemeToggleProps) => {
  const { theme, toggleTheme } = useThemeStore();
  const triggerIcon = theme === "dark" ? <SunIcon /> : <MoonIcon />;

  return (
    <ControlButton
      className={className}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      aria-pressed={theme === "dark"}
      onClick={toggleTheme}
    >
      {triggerIcon}
    </ControlButton>
  );
};
