import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./UserMenu";
import { ControlButton } from "./ControlButton";
import styles from "./Header.module.css";

const NotificationIcon = () => (
  <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
    <path d="M15 17h5l-1.4-1.4a2 2 0 0 1-.6-1.4v-3.2a5 5 0 0 0-4-4.9V4a2 2 0 0 0-4 0v1.1a5 5 0 0 0-4 4.9v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
    <path d="M11 4a7 7 0 1 0 4.9 12L21 21" />
  </svg>
);

export const Header = () => {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <div className={styles.left}>
          <label className="sr-only" htmlFor="global-header-search">
            Search content
          </label>
          <div className={styles.search}>
            <SearchIcon />
            <input
              id="global-header-search"
              className={styles.searchInput}
              type="search"
              placeholder="Search stations, sessions, users..."
            />
          </div>
        </div>
        <div className={styles.actions}>
          <ThemeToggle />
          <ControlButton className={styles.notificationButton} type="button" aria-label="Notifications">
            <NotificationIcon />
            <span className={styles.badge} aria-hidden="true">
              3
            </span>
          </ControlButton>
          <UserMenu />
        </div>
      </div>
    </header>
  );
};
