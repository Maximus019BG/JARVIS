"use client";

import { useQuery } from "@tanstack/react-query";
import axios from "axios";

export type WorkstationBlueprint = { id: string; name: string };

/**
 * Names and ids of every blueprint in a workstation — just enough for the access
 * checkbox lists. Deliberately not the full blueprint payload the grid uses.
 *
 * The route replies with a bare array. This used to read `data.blueprints`, which is always
 * `undefined`, so every checkbox list built on this hook — link a device, manage its access,
 * scope an MCP token — silently showed "no blueprints" no matter how many existed.
 */
export function useWorkstationBlueprints(workstationId: string | undefined): WorkstationBlueprint[] {
  const { data } = useQuery({
    queryKey: ["workstation", workstationId, "blueprint-names"],
    enabled: Boolean(workstationId),
    queryFn: async () => {
      const { data } = await axios.get<{ id: string; name: string }[]>(
        `/api/workstation/blueprint/list/${workstationId!}`,
      );
      return (data ?? []).map((row) => ({ id: row.id, name: row.name }));
    },
  });
  return data ?? [];
}
