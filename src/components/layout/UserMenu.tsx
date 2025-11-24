import { useEffect, useRef, useState } from "react";
import { useTenantAuth } from "@/features/auth/useTenantAuth";
import styles from "./UserMenu.module.css";

const LogoutIcon = () => (
  <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
    <path d="M15 6v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2" />
    <path d="M9 12h12" />
    <path d="m16 9 3 3-3 3" />
  </svg>
);

const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
    <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const UserMenu = () => {
  const { profile, logout } = useTenantAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handlePointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  const initials = profile?.initials ?? "OP";
  const displayName = profile?.name ?? "Operator";
  const secondaryLabel = "Online";
  const email = profile?.email ?? "user@example.com";

  const handleLogout = () => {
    logout({ reason: "manual" });
    setOpen(false);
  };

  return (
    <div className={styles.menu} ref={containerRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={styles.avatar} aria-hidden="true">
          {initials}
        </span>
        <span className={styles.meta}>
          <span className={styles.name}>{displayName}</span>
          <span className={styles.role}>{secondaryLabel}</span>
        </span>
        <span className={styles.chevron} aria-hidden="true">
          <ChevronIcon />
        </span>
      </button>
      {open ? (
        <div className={styles.dropdown} role="menu">
          <div className={styles.dropdownHeader}>
            <span className={styles.avatarLarge} aria-hidden="true">
              {initials}
            </span>
            <div className={styles.dropdownMeta}>
              <span className={styles.name}>{displayName}</span>
              <span className={styles.role}>{email}</span>
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            className={styles.dropdownItem}
            onClick={() => setOpen(false)}
          >
            Account preferences
          </button>
          <div className={styles.dropdownDivider} role="separator" />
          <button
            type="button"
            role="menuitem"
            className={`${styles.dropdownItem} ${styles.danger}`}
            onClick={handleLogout}
          >
            <span className={styles.dropdownIcon} aria-hidden="true">
              <LogoutIcon />
            </span>
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
};
