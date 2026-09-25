"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "~/components/ui/pagination";

import { BlueprintCreateDialog } from "~/components/blueprints/blueprint-create-dialog";
import { BlueprintFiltersComponent } from "~/components/blueprints/blueprint-filters";
import { BlueprintDetailModal } from "~/components/blueprints/blueprint-detail-modal";
import { BlueprintGridSkeleton } from "~/components/blueprints/blueprint-skeleton";
import { BlueprintsHeader } from "~/components/blueprints/blueprint-header";
import { BlueprintStats } from "~/components/blueprints/blueprint-stats";
import { BlueprintsGrid } from "~/components/blueprints/blueprint-grid";

import {
  applyBlueprintFilters,
  blueprintsApi,
  hasActiveBlueprintFilters,
  type Blueprint,
  type BlueprintFilters,
} from "~/lib/api/blueprints";
import { typeToConfirm } from "~/lib/type-to-confirm-store";
import { useActiveWorkstation } from "~/lib/workstation-hooks";

const PAGE_SIZE = 12;

export default function BlueprintsPage() {
  const router = useRouter();
  const { data: activeWorkstation } = useActiveWorkstation();

  // State management
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedBlueprint, setSelectedBlueprint] = useState<Blueprint | null>(
    null,
  );
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [stats, setStats] = useState<{
    total: number;
    active: number;
    byWorkstation: Record<string, number>;
    recentActivity: Array<{ date: string; count: number }>;
  } | null>(null);

  // Filter state
  const [filters, setFilters] = useState<BlueprintFilters>({
    search: "",
    sortBy: "createdAt",
    sortOrder: "desc",
  });

  const filtered = useMemo(
    () => applyBlueprintFilters(blueprints, filters),
    [blueprints, filters],
  );
  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  // Clamped so deleting the last card on the last page doesn't strand the user on an empty page.
  const page = Math.min(currentPage, totalPages);
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Load stats
  const loadStats = React.useCallback(async () => {
    try {
      const statsData = await blueprintsApi.getBlueprintStats();
      setStats(statsData);
    } catch (error) {
      console.error("Error loading blueprint stats:", error);
      // Don't show error toast for stats, just silently fail
    }
  }, []);

  // Load blueprints
  const loadBlueprints = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      if (!activeWorkstation?.id) {
        setBlueprints([]);
        return;
      }

      setBlueprints(await blueprintsApi.listBlueprints(activeWorkstation.id));
    } catch (error) {
      console.error("Error loading blueprints:", error);
      setError("Failed to load blueprints. Please try again.");
      toast.error("Failed to load blueprints");
    } finally {
      setLoading(false);
    }
  }, [activeWorkstation?.id]);

  // Effects
  useEffect(() => {
    void loadBlueprints();
  }, [loadBlueprints]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  // Event handlers
  const handleFiltersChange = (newFilters: BlueprintFilters) => {
    setFilters(newFilters);
    setCurrentPage(1); // Reset to first page when filters change
  };

  const handleCreateNew = () => setIsCreateOpen(true);

  const handleViewBlueprint = (blueprint: Blueprint) => {
    setSelectedBlueprint(blueprint);
    setIsDetailModalOpen(true);
  };

  const handleEditBlueprint = (blueprint: Blueprint) => {
    const userId = blueprint.createdBy;
    const workstationId = blueprint.workstationId;
    router.push(
      `/app/blueprints/${workstationId}/${blueprint.id}/${userId}/edit`,
    );
  };

  // Card menu and detail modal both land here, so neither can delete without confirming.
  const handleDeleteBlueprint = (blueprint: Blueprint) => {
    void typeToConfirm.show({
      title: `Delete ${blueprint.name}?`,
      description:
        "The blueprint and its whole version history are removed for everyone on this workstation.",
      confirmText: blueprint.name,
      confirmButtonText: "Delete blueprint",
      confirmButtonVariant: "destructive",
      onConfirm: async () => {
        typeToConfirm.setIsLoading(true);
        try {
          await blueprintsApi.deleteBlueprint(blueprint.id);
          toast.success(`Blueprint "${blueprint.name}" deleted`);
          typeToConfirm.close(true);
          setIsDetailModalOpen(false);
          void loadBlueprints();
          void loadStats();
        } catch (error) {
          console.error("Error deleting blueprint:", error);
          toast.error("Failed to delete blueprint");
        } finally {
          typeToConfirm.setIsLoading(false);
        }
      },
    });
  };

  const handleCloneBlueprint = async (blueprint: Blueprint) => {
    try {
      // The server picks a free name; sending one here just means two places decide it.
      const clonedBlueprint = await blueprintsApi.cloneBlueprint(blueprint.id);
      toast.success(`Blueprint cloned as "${clonedBlueprint.name}"`);
      void loadBlueprints(); // Refresh the list
    } catch (error) {
      console.error("Error cloning blueprint:", error);
      toast.error("Failed to clone blueprint");
    }
  };

  const handleRunBlueprint = (blueprint: Blueprint) => {
    // Navigate to the viewer page which will request metadata and render the blueprint
    const userId = blueprint.createdBy;
    const workstationId = blueprint.workstationId;
    void router.push(
      `/app/blueprints/${workstationId}/${blueprint.id}/${userId}/view`,
    );
  };

  const handleHistoryBlueprint = (blueprint: Blueprint) => {
    void router.push(
      `/app/blueprints/${blueprint.workstationId}/${blueprint.id}/${blueprint.createdBy}/history`,
    );
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Render pagination
  const renderPagination = () => {
    if (totalPages <= 1) return null;

    // pages computed directly via range
    const maxVisiblePages = 5;
    const startPage = Math.max(
      1,
      page - Math.floor(maxVisiblePages / 2),
    );
    const endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    return (
      <Pagination className="mt-8">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              onClick={() => handlePageChange(Math.max(1, page - 1))}
              className={
                page === 1 ? "pointer-events-none opacity-50" : ""
              }
            />
          </PaginationItem>

          {startPage > 1 && (
            <>
              <PaginationItem>
                <PaginationLink onClick={() => handlePageChange(1)}>
                  1
                </PaginationLink>
              </PaginationItem>
              {startPage > 2 && (
                <PaginationItem>
                  <PaginationEllipsis />
                </PaginationItem>
              )}
            </>
          )}

          {Array.from(
            { length: endPage - startPage + 1 },
            (_, i) => startPage + i,
          ).map((n) => (
            <PaginationItem key={n}>
              <PaginationLink
                onClick={() => handlePageChange(n)}
                isActive={n === page}
              >
                {n}
              </PaginationLink>
            </PaginationItem>
          ))}

          {endPage < totalPages && (
            <>
              {endPage < totalPages - 1 && (
                <PaginationItem>
                  <PaginationEllipsis />
                </PaginationItem>
              )}
              <PaginationItem>
                <PaginationLink onClick={() => handlePageChange(totalPages)}>
                  {totalPages}
                </PaginationLink>
              </PaginationItem>
            </>
          )}

          <PaginationItem>
            <PaginationNext
              onClick={() =>
                handlePageChange(Math.min(totalPages, page + 1))
              }
              className={
                page === totalPages
                  ? "pointer-events-none opacity-50"
                  : ""
              }
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    );
  };

  if (!activeWorkstation) return null;

  return (
    <div className="container mx-auto space-y-8 p-6">
      {/* Header */}
      <div className="flex flex-col space-y-4">
        <BlueprintsHeader onRefresh={() => loadBlueprints()} />
        <BlueprintStats stats={stats} />
      </div>

      {/* Filters */}
      <BlueprintFiltersComponent
        filters={filters}
        onFiltersChange={handleFiltersChange}
        onCreateNew={handleCreateNew}
        totalCount={totalCount}
      />

      {/* Error State */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Loading State */}
      {loading && <BlueprintGridSkeleton />}

      {/* Blueprints Grid */}
      {!loading && !error && (
        <>
          <BlueprintsGrid
            blueprints={visible}
            hasActiveFilters={hasActiveBlueprintFilters(filters)}
            onCreateNew={handleCreateNew}
            onView={handleViewBlueprint}
            onEdit={handleEditBlueprint}
            onDelete={handleDeleteBlueprint}
            onClone={handleCloneBlueprint}
            onRun={handleRunBlueprint}
            onHistory={handleHistoryBlueprint}
          />

          {/* Pagination */}
          {renderPagination()}
        </>
      )}

      <BlueprintCreateDialog
        workstationId={activeWorkstation.id}
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
      />

      {/* Blueprint Detail Modal */}
      <BlueprintDetailModal
        blueprint={selectedBlueprint}
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        onEdit={handleEditBlueprint}
        onClone={handleCloneBlueprint}
        onRun={handleRunBlueprint}
        onDelete={handleDeleteBlueprint}
        onDownload={(blueprint) => {
          toast.info(`Downloading blueprint "${blueprint.name}"...`);
        }}
        onShare={(blueprint) => {
          toast.info(`Sharing blueprint "${blueprint.name}"...`);
        }}
      />
    </div>
  );
}
