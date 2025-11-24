export type NavItem = {
  label: string;
  path: string;
  icon?: string;
  badgeKey?: "activeSessions" | "openFaults";
};

export const primaryNavigation: NavItem[] = [
  { label: "Home", path: "/dashboard", icon: "layout-dashboard" },
  { label: "Simulators", path: "/simulators", icon: "cpu" },
  { label: "Sessions", path: "/sessions", icon: "bolt" },
  { label: "Commands", path: "/commands", icon: "terminal" },
  { label: "Scenarios", path: "/scenarios", icon: "workflow" },
  { label: "Fault Library", path: "/faults", icon: "alert-triangle" },
  { label: "Metrics", path: "/metrics", icon: "activity" }
];

export type RouteTab = {
  label: string;
  slug: string;
  description?: string;
};

export const routeTabs: Record<string, RouteTab[]> = {
  "/scenarios": [
    { label: "Templates", slug: "templates" },
    { label: "Runs", slug: "runs" }
  ]
};
