"use client";

import { useQuery } from "@tanstack/react-query";
import axios from "axios";

export type WorkstationBlueprint = { id: string; name: string };

type ListResponse = { blueprints?: { id: string; name: string }[] };

/**
 * Names and ids of every blueprint in a workstation — just enough for the access
 * checkbox lists. Deliberately not the full blueprint payload the grid uses.
 */
export function useWorkstationBlueprints(workstationId: string | undefined): WorkstationBlueprint[] {
  const { data } = useQuery({
    queryKey: ["workstation", workstationId, "blueprint-names"],
    enabled: Boolean(workstationId),
    queryFn: async () => {
      const { data } = await axios.get<ListResponse>(`/api/workstation/blueprint/list/${workstationId!}`);
      return (data.blueprints ?? []).map((row) => ({ id: row.id, name: row.name }));
    },
  });
  return data ?? [];
}
