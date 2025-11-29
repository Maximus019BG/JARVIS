"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Zap,
  TrendingUp,
  Users,
  Clock,
  AlertCircle,
  RefreshCw,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Alert, AlertDescription } from "~/components/ui/alert";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "~/components/ui/pagination";

import { BlueprintCard } from "~/components/blueprints/blueprint-card";
import { BlueprintFiltersComponent } from "~/components/blueprints/blueprint-filters";
import { BlueprintDetailModal } from "~/components/blueprints/blueprint-detail-modal";
import { BlueprintGridSkeleton } from "~/components/blueprints/blueprint-skeleton";

import {
  blueprintsApi,
  type Blueprint,
  type BlueprintFilters,
} from "~/lib/api/blueprints";
import { useActiveWorkstation } from "~/lib/workstation-hooks";

export default function BlueprintsPage() {
  const router = useRouter();
  const { data: activeWorkstation } = useActiveWorkstation();

  // State management
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedBlueprint, setSelectedBlueprint] = useState<Blueprint | null>(
    null,
  );
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [stats, setStats] = useState<{
    total: number;
    active: number;
    byWorkstation: Record<string, number>;
    recentActivity: Array<{ date: string; count: number }>;
  } | null>(null);

  // Filter state
  const [filters, setFilters] = useState<BlueprintFilters>({
    search: "",
    tags: [],
    sortBy: "createdAt",
    sortOrder: "desc",
  });

  // Mock data for filters (in real app, fetch from API)
  const availableTags = [
    "automation",
    "workflow",
    "data-processing",
    "ml",
    "analytics",
    "testing",
  ];
  const availableAuthors = [
    { id: "1", name: "John Doe" },
    { id: "2", name: "Jane Smith" },
    { id: "3", name: "Mike Johnson" },
  ];
  const availableWorkstations = [
    { id: "1", name: "Development Station" },
    { id: "2", name: "Production Station" },
    { id: "3", name: "Testing Station" },
  ];

  // No client-side mock generator in use anymore

  // Mock stats still used if server-side not available
  const generateMockStats = () => ({
    total: 50,
    active: 35,
    byWorkstation: {
      "Development Station": 20,
      "Production Station": 18,
      "Testing Station": 12,
    },
    recentActivity: [
      { date: "2024-11-01", count: 5 },
      { date: "2024-11-02", count: 3 },
      { date: "2024-11-03", count: 7 },
      { date: "2024-11-04", count: 2 },
      { date: "2024-11-05", count: 4 },
    ],
  });

  // Load blueprints
  const loadBlueprints = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      if (!activeWorkstation?.id) {
        setBlueprints([]);
        setTotalPages(1);
        setTotalCount(0);
        setLoading(false);
        return;
      }

      const response = await blueprintsApi.getBlueprints(
        activeWorkstation.id,
        currentPage,
        12,
        filters,
        true,
      );
      setBlueprints(response.blueprints);
      setTotalPages(response.totalPages);
      setTotalCount(response.total);

      if (!stats) {
        setStats(generateMockStats());
      }
    } catch (error) {
      console.error("Error loading blueprints:", error);
      setError("Failed to load blueprints. Please try again.");
      toast.error("Failed to load blueprints");
    } finally {
      setLoading(false);
    }
  }, [activeWorkstation?.id, currentPage, filters, stats]);

  // Effects
  useEffect(() => {
    void loadBlueprints();
  }, [loadBlueprints]);

  // Event handlers
  const handleFiltersChange = (newFilters: BlueprintFilters) => {
    setFilters(newFilters);
    setCurrentPage(1); // Reset to first page when filters change
  };

  const handleCreateNew = () => {
    toast.info("Create a new blueprint by using jarvis")
  };

  const handleViewBlueprint = (blueprint: Blueprint) => {
    setSelectedBlueprint(blueprint);
    setIsDetailModalOpen(true);
  };

  const handleEditBlueprint = (blueprint: Blueprint) => {
    router.push(`/app/blueprints/${blueprint.id}/edit`);
  };

  const handleDeleteBlueprint = async (blueprint: Blueprint) => {
    try {
      await blueprintsApi.deleteBlueprint(blueprint.id);
      toast.success(`Blueprint "${blueprint.name}" deleted successfully`);
      void loadBlueprints(); // Refresh the list
    } catch (error) {
      console.error("Error deleting blueprint:", error);
      toast.error("Failed to delete blueprint");
    }
  };

  const handleCloneBlueprint = async (blueprint: Blueprint) => {
    try {
      const clonedBlueprint = await blueprintsApi.cloneBlueprint(
        blueprint.id,
        `${blueprint.name} (Copy)`,
      );
      toast.success(`Blueprint cloned as "${clonedBlueprint.name}"`);
      void loadBlueprints(); // Refresh the list
    } catch (error) {
      console.error("Error cloning blueprint:", error);
      toast.error("Failed to clone blueprint");
    }
  };

  const handleRunBlueprint = (blueprint: Blueprint) => {
    toast.info(`Running blueprint "${blueprint.name}"...`);
    // Implement blueprint execution logic
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
      currentPage - Math.floor(maxVisiblePages / 2),
    );
    const endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    return (
      <Pagination className="mt-8">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
              className={
                currentPage === 1 ? "pointer-events-none opacity-50" : ""
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
          ).map((page) => (
            <PaginationItem key={page}>
              <PaginationLink
                onClick={() => handlePageChange(page)}
                isActive={page === currentPage}
              >
                {page}
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
                handlePageChange(Math.min(totalPages, currentPage + 1))
              }
              className={
                currentPage === totalPages
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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Blueprints</h1>
            <p className="text-muted-foreground">
              Manage and deploy your automation blueprints with precision and
              control
            </p>
          </div>
          <Button onClick={() => loadBlueprints()} variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Total Blueprints
                </CardTitle>
                <Zap className="text-muted-foreground h-4 w-4" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.total}</div>
                <p className="text-muted-foreground text-xs">
                  Across all workstations
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Active Blueprints
                </CardTitle>
                <TrendingUp className="text-muted-foreground h-4 w-4" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.active}</div>
                <p className="text-muted-foreground text-xs">
                  {Math.round((stats.active / stats.total) * 100)}% of total
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Workstations
                </CardTitle>
                <Users className="text-muted-foreground h-4 w-4" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {Object.keys(stats.byWorkstation).length}
                </div>
                <p className="text-muted-foreground text-xs">
                  Connected workstations
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Recent Activity
                </CardTitle>
                <Clock className="text-muted-foreground h-4 w-4" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stats.recentActivity.reduce(
                    (sum, day) => sum + day.count,
                    0,
                  )}
                </div>
                <p className="text-muted-foreground text-xs">Last 5 days</p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Filters */}
      <BlueprintFiltersComponent
        filters={filters}
        onFiltersChange={handleFiltersChange}
        onCreateNew={handleCreateNew}
        availableTags={availableTags}
        availableAuthors={availableAuthors}
        availableWorkstations={availableWorkstations}
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
          {blueprints.length === 0 ? (
            <Card className="p-12 text-center">
              <CardContent>
                <Zap className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
                <h3 className="mb-2 text-lg font-semibold">
                  No blueprints found
                </h3>
                <p className="text-muted-foreground mb-4">
                  {Object.values(filters).some(
                    (value) =>
                      value && (Array.isArray(value) ? value.length > 0 : true),
                  )
                    ? "No blueprints match your current filters. Try adjusting your search criteria."
                    : "Get started by creating your first blueprint."}
                </p>
                <Button onClick={handleCreateNew}>
                  <Zap className="mr-2 h-4 w-4" />
                  Create Your First Blueprint
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {blueprints.map((blueprint) => (
                <BlueprintCard
                  key={blueprint.id}
                  blueprint={blueprint}
                  onView={handleViewBlueprint}
                  onEdit={handleEditBlueprint}
                  onDelete={handleDeleteBlueprint}
                  onClone={handleCloneBlueprint}
                  onRun={handleRunBlueprint}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {renderPagination()}
        </>
      )}

      {/* Blueprint Detail Modal */}
      <BlueprintDetailModal
        blueprint={selectedBlueprint}
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        onEdit={handleEditBlueprint}
        onClone={handleCloneBlueprint}
        onRun={handleRunBlueprint}
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
