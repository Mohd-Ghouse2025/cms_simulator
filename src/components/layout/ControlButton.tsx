import { forwardRef, ButtonHTMLAttributes } from "react";
import clsx from "clsx";
import styles from "./ControlButton.module.css";

type ControlButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
};

export const ControlButton = forwardRef<HTMLButtonElement, ControlButtonProps>(
  ({ className, active, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={clsx(styles.button, active && styles.active, className)}
      {...props}
    />
  )
);

ControlButton.displayName = "ControlButton";
