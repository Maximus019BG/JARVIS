import { Settings } from "~/components/animate-ui/icons/settings";
import { ChartColumn } from "~/components/animate-ui/icons/chart-column";
import { GalleryVerticalEnd } from "~/components/animate-ui/icons/gallery-horizontal-end";
import { Fingerprint } from "~/components/animate-ui/icons/fingerprint";
import { Hammer } from "~/components/animate-ui/icons/hammer";
import { DollarSign } from "lucide-react";

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
    title: "Sessions",
    icon: Hammer,
    href: "/app/sessions",
    isActive: (href: string) => {
      return href.startsWith("/app/sessions");
    },
  },
  {
    // Plain lucide icon: the animate-ui set is hand-wrapped one file per icon, and a
    // sidebar entry does not need an animation badly enough to add another.
    title: "Usage",
    icon: DollarSign,
    href: "/app/usage",
    isActive: (href: string) => {
      return href.startsWith("/app/usage");
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
