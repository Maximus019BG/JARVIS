'use client';

import React from 'react';
import {
  Search,
  Filter,
  SortAsc,
  SortDesc,
  X,
  Plus,
  Calendar,
  RefreshCw,
} from 'lucide-react';
import { Input } from '~/components/ui/input';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover';
import { Separator } from '~/components/ui/separator';
import {
  hasActiveBlueprintFilters,
  type BlueprintFilters,
} from '~/lib/api/blueprints';

interface BlueprintFiltersProps {
  filters: BlueprintFilters;
  onFiltersChange: (filters: BlueprintFilters) => void;
  onCreateNew?: () => void;
  totalCount?: number;
}

// Radix Select throws on an empty-string item value, so "no filter" needs a real sentinel.
const ALL = 'all';

const SYNC_LABELS = { synced: 'Synced', pending: 'Pending' } as const;

function RemovableBadge({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <Badge variant="outline">
      {children}
      <Button
        variant="ghost"
        size="sm"
        className="ml-1 h-4 w-4 p-0 hover:bg-transparent"
        onClick={onRemove}
        aria-label="Remove filter"
      >
        <X className="h-3 w-3" />
      </Button>
    </Badge>
  );
}

export function BlueprintFiltersComponent({
  filters,
  onFiltersChange,
  onCreateNew,
  totalCount
}: BlueprintFiltersProps) {
  const update = (patch: Partial<BlueprintFilters>) => {
    onFiltersChange({ ...filters, ...patch });
  };

  const clearFilters = () => {
    update({ search: '', syncStatus: undefined, modifiedWithinDays: undefined });
  };

  const hasActiveFilters = hasActiveBlueprintFilters(filters);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-4 w-full sm:w-auto">
          <div className="relative flex-1 min-w-48 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search blueprints..."
              value={filters.search || ''}
              onChange={(e) => update({ search: e.target.value })}
              className="pl-10"
            />
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="relative">
                <Filter className="h-4 w-4 mr-2" />
                Filter
                {(filters.syncStatus || filters.modifiedWithinDays) && (
                  <div className="absolute -top-1 -right-1 h-3 w-3 bg-blue-500 rounded-full" />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="start">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">Filter Blueprints</h4>
                  {hasActiveFilters && (
                    <Button variant="ghost" size="sm" onClick={clearFilters}>
                      <X className="h-4 w-4 mr-1" />
                      Clear
                    </Button>
                  )}
                </div>

                <Separator />

                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium mb-2 flex items-center">
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Sync status
                    </label>
                    <Select
                      value={filters.syncStatus ?? ALL}
                      onValueChange={(value) =>
                        update({ syncStatus: value === ALL ? undefined : (value as 'synced' | 'pending') })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL}>All</SelectItem>
                        <SelectItem value="synced">{SYNC_LABELS.synced}</SelectItem>
                        <SelectItem value="pending">{SYNC_LABELS.pending}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-2 flex items-center">
                      <Calendar className="h-4 w-4 mr-2" />
                      Modified
                    </label>
                    <Select
                      value={filters.modifiedWithinDays ? String(filters.modifiedWithinDays) : ALL}
                      onValueChange={(value) =>
                        update({ modifiedWithinDays: value === ALL ? undefined : (Number(value) as 7 | 30) })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL}>Any time</SelectItem>
                        <SelectItem value="7">Last 7 days</SelectItem>
                        <SelectItem value="30">Last 30 days</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <Select
            value={`${filters.sortBy || 'createdAt'}-${filters.sortOrder || 'desc'}`}
            onValueChange={(value) => {
              const [sortBy, sortOrder] = value.split('-') as [
                NonNullable<BlueprintFilters['sortBy']>,
                NonNullable<BlueprintFilters['sortOrder']>,
              ];
              update({ sortBy, sortOrder });
            }}
          >
            <SelectTrigger className="w-auto">
              <div className="flex items-center space-x-2">
                {filters.sortOrder === 'asc' ? <SortAsc className="h-4 w-4" /> : <SortDesc className="h-4 w-4" />}
                <SelectValue />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name-asc">Name A-Z</SelectItem>
              <SelectItem value="name-desc">Name Z-A</SelectItem>
              <SelectItem value="createdAt-desc">Newest First</SelectItem>
              <SelectItem value="createdAt-asc">Oldest First</SelectItem>
              <SelectItem value="lastModified-desc">Recently Modified</SelectItem>
              <SelectItem value="lastModified-asc">Least Recently Modified</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center space-x-3">
          {totalCount !== undefined && (
            <span className="text-sm text-muted-foreground">
              {totalCount} blueprint{totalCount !== 1 ? 's' : ''}
            </span>
          )}

          {onCreateNew && (
            <Button onClick={onCreateNew} className="whitespace-nowrap">
              <Plus className="h-4 w-4 mr-2" />
              Create Blueprint
            </Button>
          )}
        </div>
      </div>

      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Active filters:</span>
          {filters.search && (
            <RemovableBadge onRemove={() => update({ search: '' })}>
              Search: &quot;{filters.search}&quot;
            </RemovableBadge>
          )}
          {filters.syncStatus && (
            <RemovableBadge onRemove={() => update({ syncStatus: undefined })}>
              Sync: {SYNC_LABELS[filters.syncStatus]}
            </RemovableBadge>
          )}
          {filters.modifiedWithinDays && (
            <RemovableBadge onRemove={() => update({ modifiedWithinDays: undefined })}>
              Modified: last {filters.modifiedWithinDays} days
            </RemovableBadge>
          )}
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
}
