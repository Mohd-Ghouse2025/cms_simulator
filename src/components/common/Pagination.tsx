import clsx from "clsx";
import styles from "./Pagination.module.css";

type PaginationProps = {
  page: number;
  pageSize: number;
  total?: number | null;
  isLoading?: boolean;
  onPageChange: (nextPage: number) => void;
  className?: string;
};

export const Pagination = ({
  page,
  pageSize,
  total,
  isLoading,
  onPageChange,
  className
}: PaginationProps) => {
  const safePage = Math.max(1, page);
  const count = typeof total === "number" && total >= 0 ? total : null;
  const totalPages = count ? Math.max(1, Math.ceil(count / pageSize)) : null;
  const start = count ? Math.min((safePage - 1) * pageSize + 1, count) : null;
  const end = count ? Math.min(safePage * pageSize, count) : null;

  const canGoPrev = safePage > 1;
  const canGoNext = totalPages ? safePage < totalPages : true;

  return (
    <div className={clsx(styles.pagination, className)}>
      <span className={styles.status}>
        {isLoading
          ? "Loading…"
          : count && start && end
            ? `Showing ${start}-${end} of ${count}`
            : `Page ${safePage}${totalPages ? ` of ${totalPages}` : ""}`}
      </span>
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.button}
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={!canGoPrev || isLoading}
        >
          Previous
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => onPageChange(safePage + 1)}
          disabled={!canGoNext || isLoading}
        >
          Next
        </button>
      </div>
    </div>
  );
};
