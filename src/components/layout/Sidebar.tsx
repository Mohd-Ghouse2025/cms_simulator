'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { primaryNavigation } from "@/lib/navigation";
import { useLayoutStore } from "@/store/layoutStore";
import styles from "./Sidebar.module.css";

type LucideIconComponent = LucideIcon;

const toPascalCase = (value: string) =>
  value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join("");

const resolveIcon = (icon?: string): LucideIconComponent | null => {
  if (!icon) {
    return null;
  }
  const key = toPascalCase(icon);
  const candidate = (LucideIcons as unknown as Record<
    string,
    LucideIconComponent | undefined
  >)[key];
  return candidate ?? null;
};

export const Sidebar = () => {
  const { sidebarCollapsed, toggleSidebar } = useLayoutStore();
  const pathname = usePathname();
  const CollapseIcon: LucideIconComponent = sidebarCollapsed
    ? LucideIcons.ChevronRight
    : LucideIcons.ChevronLeft;
  const sidebarClassName = sidebarCollapsed
    ? `${styles.sidebar} ${styles.sidebarCollapsed}`
    : styles.sidebar;

  return (
    <aside className={sidebarClassName}>
      <div className={styles.topBar}>
        <div className={styles.brand} aria-label="JP Simulator">
          <div className={styles.brandMark}>JP</div>
          <div className={styles.brandMeta}>
            <span className={styles.brandName}>Simulator</span>
          </div>
        </div>
        <button
          type="button"
          className={styles.collapseButton}
          onClick={toggleSidebar}
          aria-expanded={!sidebarCollapsed}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {CollapseIcon ? <CollapseIcon size={18} strokeWidth={2} /> : null}
        </button>
      </div>
      <div className={styles.sectionLabel}>
        <span className={styles.sectionTitle}>Operations</span>
      </div>
      <nav className={styles.nav} aria-label="Main">
        {primaryNavigation.map((item) => {
          const active = pathname.startsWith(item.path);
          const className = [
            styles.link,
            active ? styles.active : null,
            sidebarCollapsed ? styles.collapsedLink : null
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <Link key={item.path} href={item.path} className={className}>
              <span className={styles.icon} aria-hidden>
                {(() => {
                  const Icon = resolveIcon(item.icon);
                  if (!Icon) {
                    return item.label.charAt(0).toUpperCase();
                  }
                  return <Icon size={18} strokeWidth={1.8} />;
                })()}
              </span>
              <span className={styles.label}>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
};
