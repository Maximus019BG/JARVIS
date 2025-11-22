"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { toast } from "sonner";

export interface Workstation {
  id: string;
  name: string;
  slug: string | null;
  logo: string | null;
  createdAt: Date;
  metadata: string | null;
  userId: string;
}

// List all workstations for the current user
export function useListWorkstations() {
  return useQuery({
    queryKey: ["workstations", "list"],
    queryFn: async () => {
      const { data } = await axios.get<Workstation[]>("/api/workstation/list");
      return data;
    },
    retry: false, // Don't retry on 401 errors
  });
}

// Check if user is unauthorized to access workstations
export function useWorkstationAuthStatus() {
  const { error } = useListWorkstations();
  
  const isUnauthorized = error && 
    axios.isAxiosError(error) && 
    error.response?.status === 401;
    
  return { isUnauthorized };
}

// Get the active workstation
export function useActiveWorkstation() {
  const { data: activeId } = useQuery({
    queryKey: ["workstations", "active"],
    queryFn: async () => {
      const { data } = await axios.get<{ id: string } | null>(
        "/api/workstation/active",
      );
      return data?.id ?? null;
    },
  });

  const { data: workstations } = useListWorkstations();

  return useQuery({
    queryKey: ["workstations", "active", activeId],
    queryFn: () => {
      if (!activeId || !workstations) return null;
      return workstations.find((w) => w.id === activeId) ?? null;
    },
    enabled: !!activeId && !!workstations,
  });
}

// Set active workstation
export function useSetActiveWorkstation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (workstationId: string) => {
      const { data } = await axios.post<{ id: string }>(
        "/api/workstation/active",
        {
          workstationId,
        },
      );
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workstations"] });
      toast.success("Workstation activated successfully");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to activate workstation",
      );
    },
  });
}

// Create a new workstation
export function useCreateWorkstation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      id: string;
      name: string;
      logo?: string;
    }) => {
      const { data } = await axios.post<Workstation>(
        "/api/workstation/create",
        input,
      );
      return data;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["workstations"] });
      // Auto-set as active
      void queryClient.setQueryData(["workstations", "active"], {
        id: data.id,
      });
      toast.success(`Workstation "${data.name}" created successfully`);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to create workstation",
      );
    },
  });
}
