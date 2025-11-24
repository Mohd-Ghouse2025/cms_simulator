import clsx from "clsx";
import styles from "./Badge.module.css";

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

interface BadgeProps {
  tone?: BadgeTone;
  label: string;
}

export const Badge = ({ tone = "neutral", label }: BadgeProps) => {
  return <span className={clsx(styles.badge, styles[tone])}>{label}</span>;
};
