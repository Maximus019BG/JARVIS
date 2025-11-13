import { Settings } from "~/components/animate-ui/icons/settings";
import { ChartColumn } from "~/components/animate-ui/icons/chart-column";

export const dashboardSidebarNav = [
  {
    title: "Dashboard",
    icon: ChartColumn,
    href: "/app",
    isActive: (href: string) => {
      return href === "/app";
    },
  },
  {
    title: "Blueprints",
    icon: Settings,
    href: "/app/blueprints",
    isActive: (href: string) => {
      return href.startsWith("/app/blueprints");
    },
  },
];
