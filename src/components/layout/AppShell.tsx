'use client';

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { RouteTabs } from "@/components/layout/RouteTabs";
import { routeTabs } from "@/lib/navigation";
import { useLayoutStore } from "@/store/layoutStore";
import styles from "./AppShell.module.css";

type AppShellProps = {
  children: ReactNode;
};

export const AppShell = ({ children }: AppShellProps) => {
  const pathname = usePathname();
  const sidebarCollapsed = useLayoutStore((state) => state.sidebarCollapsed);
  const basePath = Object.keys(routeTabs).find((key) =>
    pathname.startsWith(key)
  );

  const contentAreaClass = clsx(
    styles.contentArea,
    sidebarCollapsed ? styles.contentShiftCollapsed : styles.contentShift
  );

  return (
    <div className={styles.wrapper}>
      <Sidebar />
      <div className={contentAreaClass}>
        <Header />
        <main className={styles.main}>
          <div className={styles.pageHeader}>
            <Breadcrumbs />
            {basePath ? (
              <RouteTabs basePath={basePath} tabs={routeTabs[basePath]} />
            ) : null}
          </div>
          <div className={styles.pageBody}>{children}</div>
        </main>
      </div>
    </div>
  );
};
