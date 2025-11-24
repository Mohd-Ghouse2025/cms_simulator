'use client';

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RouteTab } from "@/lib/navigation";
import styles from "./RouteTabs.module.css";

interface RouteTabsProps {
  basePath: string;
  tabs: RouteTab[];
}

export const RouteTabs = ({ basePath, tabs }: RouteTabsProps) => {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const activeSlug = useMemo(() => {
    const slug = params.get("view");
    if (slug) {
      return slug;
    }
    return tabs[0]?.slug ?? "overview";
  }, [params, tabs]);

  if (!tabs.length || !pathname.startsWith(basePath)) {
    return null;
  }

  return (
    <div className={styles.tabs}>
      {tabs.map((tab) => (
        <button
          key={tab.slug}
          type="button"
          onClick={() => router.push(`${basePath}?view=${tab.slug}`)}
          className={
            tab.slug === activeSlug
              ? `${styles.tab} ${styles.active}`
              : styles.tab
          }
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
};
