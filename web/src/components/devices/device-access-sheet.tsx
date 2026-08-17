"use client";

import type { DeviceRow } from "~/lib/api/blueprint-versions";
import { sheet } from "~/lib/sheet-store";
import { DeviceAccessForm } from "./device-access-form";
import type { LinkableBlueprint } from "./link-device-dialog";

/**
 * Floats `DeviceAccessForm` in the global sheet, for callers that live on a page rather than
 * inside a dialog — the devices table on the settings page is the only one today.
 */
export function openDeviceAccessSheet(
  device: DeviceRow,
  blueprints: LinkableBlueprint[],
  onSaved?: () => void,
) {
  sheet.open({
    title: `Access for ${device.name}`,
    description: "Choose what this device may reach. Enforced on every push and pull.",
    body: (
      <DeviceAccessForm
        device={device}
        blueprints={blueprints}
        onCancel={() => sheet.close()}
        onSaved={() => {
          onSaved?.();
          sheet.close();
        }}
      />
    ),
  });
}
