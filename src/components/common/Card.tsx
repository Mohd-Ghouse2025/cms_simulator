import { ReactNode } from "react";
import clsx from "clsx";
import styles from "./Card.module.css";

interface CardProps {
  title?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  className?: string;
}

export const Card = ({ title, toolbar, children, className }: CardProps) => {
  return (
    <section className={clsx(styles.card, className)}>
      {(title || toolbar) && (
        <header className={styles.header}>
          <div className={styles.title}>{title}</div>
          {toolbar ? <div className={styles.toolbar}>{toolbar}</div> : null}
        </header>
      )}
      <div className={styles.body}>{children}</div>
    </section>
  );
};
