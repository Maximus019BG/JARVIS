import { Settings } from "~/components/animate-ui/icons/settings";
import { ChartColumn } from "~/components/animate-ui/icons/chart-column";
import { GalleryVerticalEnd } from "~/components/animate-ui/icons/gallery-horizontal-end";
import { Fingerprint } from "~/components/animate-ui/icons/fingerprint";

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
    icon: GalleryVerticalEnd ,
    href: "/app/blueprints",
    isActive: (href: string) => {
      return href.startsWith("/app/blueprints");
    },
  },
  {
    title: "Automations",
    icon: Fingerprint ,
    href: "/app/automations",
    isActive: (href: string) => {
      return href.startsWith("/app/automations");
    },
  },
  {
    title: "Settings",
    icon: Settings,
    href: "/app/settings",
    isActive: (href: string) => {
      return href.startsWith("/app/settings");
    },
  },
];
