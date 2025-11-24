import { ButtonHTMLAttributes, ReactNode } from "react";
import clsx from "clsx";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
}

export const Button = ({
  variant = "primary",
  size = "md",
  icon,
  children,
  className,
  ...rest
}: ButtonProps) => {
  return (
    <button
      className={clsx(styles.button, styles[variant], styles[size], className)}
      {...rest}
    >
      {icon ? <span className={styles.icon}>{icon}</span> : null}
      <span>{children}</span>
    </button>
  );
};
