'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { 
  Zap, 
  TrendingUp, 
  Users, 
  Clock,
  AlertCircle,
  RefreshCw
} from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Button } from '~/components/ui/button';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { 
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '~/components/ui/pagination';

import { BlueprintCard } from '~/components/blueprints/blueprint-card';
import { BlueprintFiltersComponent } from '~/components/blueprints/blueprint-filters';
import { BlueprintDetailModal } from '~/components/blueprints/blueprint-detail-modal';
import { BlueprintGridSkeleton } from '~/components/blueprints/blueprint-skeleton';

import { 
  blueprintsApi, 
  type Blueprint, 
  type BlueprintFilters,
  type BlueprintsResponse 
} from '~/lib/api/blueprints';

export default function BlueprintsPage() {
  const router = useRouter();
  
  // State management
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedBlueprint, setSelectedBlueprint] = useState<Blueprint | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [stats, setStats] = useState<{
    total: number;
    active: number;
    byWorkstation: Record<string, number>;
    recentActivity: Array<{ date: string; count: number }>;
  } | null>(null);

  // Filter state
  const [filters, setFilters] = useState<BlueprintFilters>({
    search: '',
    tags: [],
    sortBy: 'createdAt',
    sortOrder: 'desc'
  });

  // Mock data for filters (in real app, fetch from API)
  const availableTags = ['automation', 'workflow', 'data-processing', 'ml', 'analytics', 'testing'];
  const availableAuthors = [
    { id: '1', name: 'John Doe' },
    { id: '2', name: 'Jane Smith' },
    { id: '3', name: 'Mike Johnson' }
  ];
  const availableWorkstations = [
    { id: '1', name: 'Development Station' },
    { id: '2', name: 'Production Station' },
    { id: '3', name: 'Testing Station' }
  ];

  // Generate mock blueprints for demo
  const generateMockBlueprints = (): BlueprintsResponse => {
    const mockBlueprints: Blueprint[] = Array.from({ length: 50 }, (_, index) => {
      const id = (index + 1).toString();
      const tags = availableTags.slice(0, Math.floor(Math.random() * 4) + 1);
      const authorIndex = Math.floor(Math.random() * availableAuthors.length);
      const workstationIndex = Math.floor(Math.random() * availableWorkstations.length);
      const selectedAuthor = availableAuthors[authorIndex]!;
      const selectedWorkstation = availableWorkstations[workstationIndex]!;
      
      return {
        id,
        name: `Blueprint ${id}: ${['Data Pipeline', 'ML Model', 'Workflow', 'Automation', 'Analytics'][Math.floor(Math.random() * 5)]}`,
        description: [
          'Advanced automation blueprint for streamlining data processing workflows',
          'Machine learning pipeline for predictive analytics and model training',
          'Comprehensive workflow system for enterprise data management',
          'Automated testing framework with CI/CD integration',
          'Real-time analytics dashboard with interactive visualizations'
        ][Math.floor(Math.random() * 5)],
        createdAt: new Date(2024, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1).toISOString(),
        createdBy: selectedAuthor.id,
        metadata: JSON.stringify({
          complexity: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
          performance: Math.floor(Math.random() * 100) + 1,
          dependencies: Math.floor(Math.random() * 10) + 1
        }),
        workstationId: selectedWorkstation.id,
        author: {
          name: selectedAuthor.name,
          email: `${selectedAuthor.name.toLowerCase().replace(' ', '.')}@example.com`
        },
        tags,
        isActive: Math.random() > 0.3,
        lastModified: new Date(2024, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1).toISOString(),
        version: `${Math.floor(Math.random() * 3) + 1}.${Math.floor(Math.random() * 10)}.${Math.floor(Math.random() * 10)}`
      };
    });

    // Apply filters
    let filteredBlueprints = mockBlueprints;

    if (filters.search) {
      filteredBlueprints = filteredBlueprints.filter(blueprint =>
        blueprint.name.toLowerCase().includes(filters.search!.toLowerCase()) ||
        blueprint.description?.toLowerCase().includes(filters.search!.toLowerCase())
      );
    }

    if (filters.tags && filters.tags.length > 0) {
      filteredBlueprints = filteredBlueprints.filter(blueprint =>
        blueprint.tags?.some(tag => filters.tags!.includes(tag))
      );
    }

    if (filters.author) {
      filteredBlueprints = filteredBlueprints.filter(blueprint =>
        blueprint.createdBy === filters.author
      );
    }

    if (filters.workstationId) {
      filteredBlueprints = filteredBlueprints.filter(blueprint =>
        blueprint.workstationId === filters.workstationId
      );
    }

    // Apply sorting
    if (filters.sortBy && filters.sortOrder) {
      filteredBlueprints.sort((a, b) => {
        let aValue, bValue;
        
        switch (filters.sortBy) {
          case 'name':
            aValue = a.name;
            bValue = b.name;
            break;
          case 'createdAt':
            aValue = new Date(a.createdAt);
            bValue = new Date(b.createdAt);
            break;
          case 'lastModified':
            aValue = new Date(a.lastModified || a.createdAt);
            bValue = new Date(b.lastModified || b.createdAt);
            break;
          default:
            return 0;
        }

        if (aValue < bValue) return filters.sortOrder === 'asc' ? -1 : 1;
        if (aValue > bValue) return filters.sortOrder === 'asc' ? 1 : -1;
        return 0;
      });
    }

    // Apply pagination
    const limit = 12;
    const start = (currentPage - 1) * limit;
    const paginatedBlueprints = filteredBlueprints.slice(start, start + limit);

    return {
      blueprints: paginatedBlueprints,
      total: filteredBlueprints.length,
      page: currentPage,
      limit,
      totalPages: Math.ceil(filteredBlueprints.length / limit)
    };
  };

  // Generate mock stats
  const generateMockStats = () => ({
    total: 50,
    active: 35,
    byWorkstation: {
      'Development Station': 20,
      'Production Station': 18,
      'Testing Station': 12
    },
    recentActivity: [
      { date: '2024-11-01', count: 5 },
      { date: '2024-11-02', count: 3 },
      { date: '2024-11-03', count: 7 },
      { date: '2024-11-04', count: 2 },
      { date: '2024-11-05', count: 4 },
    ]
  });

  // Load blueprints
  const loadBlueprints = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 800));
      
      const response = generateMockBlueprints();
      setBlueprints(response.blueprints);
      setTotalPages(response.totalPages);
      setTotalCount(response.total);
      
      if (!stats) {
        setStats(generateMockStats());
      }
    } catch (error) {
      console.error('Error loading blueprints:', error);
      setError('Failed to load blueprints. Please try again.');
      toast.error('Failed to load blueprints');
    } finally {
      setLoading(false);
    }
  };

  // Effects
  useEffect(() => {
    loadBlueprints();
  }, [currentPage, filters]);

  // Event handlers
  const handleFiltersChange = (newFilters: BlueprintFilters) => {
    setFilters(newFilters);
    setCurrentPage(1); // Reset to first page when filters change
  };

  const handleCreateNew = () => {
    router.push('/app/blueprints/create');
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
      loadBlueprints(); // Refresh the list
    } catch (error) {
      console.error('Error deleting blueprint:', error);
      toast.error('Failed to delete blueprint');
    }
  };

  const handleCloneBlueprint = async (blueprint: Blueprint) => {
    try {
      const clonedBlueprint = await blueprintsApi.cloneBlueprint(blueprint.id, `${blueprint.name} (Copy)`);
      toast.success(`Blueprint cloned as "${clonedBlueprint.name}"`);
      loadBlueprints(); // Refresh the list
    } catch (error) {
      console.error('Error cloning blueprint:', error);
      toast.error('Failed to clone blueprint');
    }
  };

  const handleRunBlueprint = (blueprint: Blueprint) => {
    toast.info(`Running blueprint "${blueprint.name}"...`);
    // Implement blueprint execution logic
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Render pagination
  const renderPagination = () => {
    if (totalPages <= 1) return null;

    const pages = [];
    const maxVisiblePages = 5;
    const startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    const endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    return (
      <Pagination className="mt-8">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious 
              onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
              className={currentPage === 1 ? 'pointer-events-none opacity-50' : ''}
            />
          </PaginationItem>

          {startPage > 1 && (
            <>
              <PaginationItem>
                <PaginationLink onClick={() => handlePageChange(1)}>1</PaginationLink>
              </PaginationItem>
              {startPage > 2 && (
                <PaginationItem>
                  <PaginationEllipsis />
                </PaginationItem>
              )}
            </>
          )}

          {Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i).map((page) => (
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
                <PaginationLink onClick={() => handlePageChange(totalPages)}>{totalPages}</PaginationLink>
              </PaginationItem>
            </>
          )}

          <PaginationItem>
            <PaginationNext 
              onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
              className={currentPage === totalPages ? 'pointer-events-none opacity-50' : ''}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    );
  };

  return (
    <div className="container mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="flex flex-col space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Blueprints</h1>
            <p className="text-muted-foreground">
              Manage and deploy your automation blueprints with precision and control
            </p>
          </div>
          <Button onClick={() => loadBlueprints()} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Blueprints</CardTitle>
                <Zap className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.total}</div>
                <p className="text-xs text-muted-foreground">
                  Across all workstations
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Blueprints</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.active}</div>
                <p className="text-xs text-muted-foreground">
                  {Math.round((stats.active / stats.total) * 100)}% of total
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Workstations</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{Object.keys(stats.byWorkstation).length}</div>
                <p className="text-xs text-muted-foreground">
                  Connected workstations
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Recent Activity</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stats.recentActivity.reduce((sum, day) => sum + day.count, 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  Last 5 days
                </p>
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
          <AlertDescription>
            {error}
          </AlertDescription>
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
                <Zap className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No blueprints found</h3>
                <p className="text-muted-foreground mb-4">
                  {Object.values(filters).some(value => value && (Array.isArray(value) ? value.length > 0 : true))
                    ? "No blueprints match your current filters. Try adjusting your search criteria."
                    : "Get started by creating your first blueprint."}
                </p>
                <Button onClick={handleCreateNew}>
                  <Zap className="h-4 w-4 mr-2" />
                  Create Your First Blueprint
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
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