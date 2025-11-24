import clsx from "clsx";
import styles from "./Skeleton.module.css";

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  className?: string;
}

export const Skeleton = ({ width = "100%", height = 16, className }: SkeletonProps) => {
  return (
    <span
      className={clsx(styles.skeleton, className)}
      style={{ width, height }}
    />
  );
};
