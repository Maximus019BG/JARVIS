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
  User,
  Tag,
  Settings
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
import { type BlueprintFilters } from '~/lib/api/blueprints';

interface BlueprintFiltersProps {
  filters: BlueprintFilters;
  onFiltersChange: (filters: BlueprintFilters) => void;
  onCreateNew?: () => void;
  availableTags?: string[];
  availableAuthors?: Array<{ id: string; name: string }>;
  availableWorkstations?: Array<{ id: string; name: string }>;
  totalCount?: number;
}

export function BlueprintFiltersComponent({
  filters,
  onFiltersChange,
  onCreateNew,
  availableTags = [],
  availableAuthors = [],
  availableWorkstations = [],
  totalCount
}: BlueprintFiltersProps) {
  const updateFilter = (key: keyof BlueprintFilters, value: any) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const addTag = (tag: string) => {
    const currentTags = filters.tags || [];
    if (!currentTags.includes(tag)) {
      updateFilter('tags', [...currentTags, tag]);
    }
  };

  const removeTag = (tag: string) => {
    const currentTags = filters.tags || [];
    updateFilter('tags', currentTags.filter(t => t !== tag));
  };

  const clearFilters = () => {
    onFiltersChange({
      search: '',
      tags: [],
      author: undefined,
      workstationId: undefined,
      sortBy: 'createdAt',
      sortOrder: 'desc'
    });
  };

  const hasActiveFilters = Boolean(
    filters.search || 
    (filters.tags && filters.tags.length > 0) || 
    filters.author || 
    filters.workstationId
  );

  const getSortIcon = () => {
    return filters.sortOrder === 'asc' ? <SortAsc className="h-4 w-4" /> : <SortDesc className="h-4 w-4" />;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex flex-1 items-center space-x-4 w-full sm:w-auto">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search blueprints..."
              value={filters.search || ''}
              onChange={(e) => updateFilter('search', e.target.value)}
              className="pl-10"
            />
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="relative">
                <Filter className="h-4 w-4 mr-2" />
                Filter
                {hasActiveFilters && (
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
                      <User className="h-4 w-4 mr-2" />
                      Author
                    </label>
                    <Select value={filters.author || ''} onValueChange={(value) => updateFilter('author', value || undefined)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select author" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">All Authors</SelectItem>
                        {availableAuthors.map((author) => (
                          <SelectItem key={author.id} value={author.id}>
                            {author.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-2 flex items-center">
                      <Settings className="h-4 w-4 mr-2" />
                      Workstation
                    </label>
                    <Select value={filters.workstationId || ''} onValueChange={(value) => updateFilter('workstationId', value || undefined)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select workstation" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">All Workstations</SelectItem>
                        {availableWorkstations.map((workstation) => (
                          <SelectItem key={workstation.id} value={workstation.id}>
                            {workstation.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-2 flex items-center">
                      <Tag className="h-4 w-4 mr-2" />
                      Tags
                    </label>
                    <div className="space-y-2">
                      <Select value="" onValueChange={addTag}>
                        <SelectTrigger>
                          <SelectValue placeholder="Add tag..." />
                        </SelectTrigger>
                        <SelectContent>
                          {availableTags
                            .filter(tag => !filters.tags?.includes(tag))
                            .map((tag) => (
                              <SelectItem key={tag} value={tag}>
                                {tag}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      
                      {filters.tags && filters.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {filters.tags.map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs">
                              {tag}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="ml-1 h-4 w-4 p-0 hover:bg-transparent"
                                onClick={() => removeTag(tag)}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <Select 
            value={`${filters.sortBy || 'createdAt'}-${filters.sortOrder || 'desc'}`}
            onValueChange={(value) => {
              const [sortBy, sortOrder] = value.split('-') as [string, 'asc' | 'desc'];
              updateFilter('sortBy', sortBy);
              updateFilter('sortOrder', sortOrder);
            }}
          >
            <SelectTrigger className="w-auto">
              <div className="flex items-center space-x-2">
                {getSortIcon()}
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
        <div className="flex items-center space-x-2">
          <span className="text-sm text-muted-foreground">Active filters:</span>
          {filters.search && (
            <Badge variant="outline">
              Search: "{filters.search}"
              <Button
                variant="ghost"
                size="sm"
                className="ml-1 h-4 w-4 p-0 hover:bg-transparent"
                onClick={() => updateFilter('search', '')}
              >
                <X className="h-3 w-3" />
              </Button>
            </Badge>
          )}
          {filters.author && (
            <Badge variant="outline">
              Author: {availableAuthors.find(a => a.id === filters.author)?.name || filters.author}
              <Button
                variant="ghost"
                size="sm"
                className="ml-1 h-4 w-4 p-0 hover:bg-transparent"
                onClick={() => updateFilter('author', undefined)}
              >
                <X className="h-3 w-3" />
              </Button>
            </Badge>
          )}
          {filters.workstationId && (
            <Badge variant="outline">
              Workstation: {availableWorkstations.find(w => w.id === filters.workstationId)?.name || filters.workstationId}
              <Button
                variant="ghost"
                size="sm"
                className="ml-1 h-4 w-4 p-0 hover:bg-transparent"
                onClick={() => updateFilter('workstationId', undefined)}
              >
                <X className="h-3 w-3" />
              </Button>
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
