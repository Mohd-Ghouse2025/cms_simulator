import { ReactNode } from "react";
import clsx from "clsx";
import styles from "./DataTable.module.css";

export interface Column<T> {
  header: string;
  accessor: (row: T) => ReactNode;
  width?: string;
  align?: "left" | "right" | "center";
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  emptyState?: ReactNode;
  className?: string;
  getRowId?: (row: T, index: number) => string | number;
  onRowClick?: (row: T) => void;
  getRowClassName?: (row: T) => string | undefined;
}

export const DataTable = <T,>({
  data,
  columns,
  emptyState,
  className,
  getRowId,
  onRowClick,
  getRowClassName
}: DataTableProps<T>) => {
  if (!data.length) {
    return <div className={clsx(styles.empty, className)}>{emptyState ?? "No records"}</div>;
  }

  return (
    <table className={clsx(styles.table, className)}>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.header} style={{ width: column.width }}>{column.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row, index) => (
          <tr
            key={getRowId ? getRowId(row, index) : index}
            className={clsx(
              styles.row,
              onRowClick ? styles.clickable : null,
              getRowClassName ? getRowClassName(row) : null
            )}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          >
            {columns.map((column) => (
              <td key={column.header} className={column.align ? styles[column.align] : undefined}>
                {column.accessor(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
};
