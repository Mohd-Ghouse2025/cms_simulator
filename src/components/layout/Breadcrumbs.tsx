'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./Breadcrumbs.module.css";

const formatSegment = (segment: string) =>
  segment
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export const Breadcrumbs = () => {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) {
    return null;
  }

  let path = "";

  return (
    <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
      <Link href="/dashboard" className={styles.link}>
        Home
      </Link>
      {segments.map((segment, index) => {
        path += `/${segment}`;
        const isLast = index === segments.length - 1;
        return (
          <span key={path} className={styles.segmentWrap}>
            <span className={styles.separator}>/</span>
            {isLast ? (
              <span className={styles.current}>{formatSegment(segment)}</span>
            ) : (
              <Link href={path} className={styles.link}>
                {formatSegment(segment)}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
};
