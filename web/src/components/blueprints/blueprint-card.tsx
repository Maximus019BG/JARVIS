'use client';

import React from 'react';
import { format } from 'date-fns';
import { 
  Clock, 
  User, 
  Settings, 
  Copy, 
  Trash2, 
  Edit3, 
  Play,
  MoreVertical,
  Star,
  Tag
} from 'lucide-react';
import { Card, CardContent, CardFooter, CardHeader } from '~/components/ui/card';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip';
import { type Blueprint } from '~/lib/api/blueprints';

interface BlueprintCardProps {
  blueprint: Blueprint;
  onEdit?: (blueprint: Blueprint) => void;
  onDelete?: (blueprint: Blueprint) => void;
  onClone?: (blueprint: Blueprint) => void;
  onRun?: (blueprint: Blueprint) => void;
  onView?: (blueprint: Blueprint) => void;
}

export function BlueprintCard({
  blueprint,
  onEdit,
  onDelete,
  onClone,
  onRun,
  onView
}: BlueprintCardProps) {
  const handleCardClick = () => {
    onView?.(blueprint);
  };

  return (
    <TooltipProvider>
      <Card 
        className="group relative h-full transition-all duration-200 hover:shadow-lg hover:shadow-blue-100 dark:hover:shadow-blue-900/20 cursor-pointer border-l-4 border-l-blue-500"
        onClick={handleCardClick}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex-1 space-y-1">
              <h3 className="font-semibold text-lg leading-tight group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                {blueprint.name}
              </h3>
              {blueprint.description && (
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {blueprint.description}
                </p>
              )}
            </div>
            
            <div className="flex items-center space-x-2">
              {blueprint.isActive && (
                <Tooltip>
                  <TooltipTrigger>
                    <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Active Blueprint</p>
                  </TooltipContent>
                </Tooltip>
              )}
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {onRun && (
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRun(blueprint); }}>
                      <Play className="h-4 w-4 mr-2" />
                      Run Blueprint
                    </DropdownMenuItem>
                  )}
                  {onEdit && (
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(blueprint); }}>
                      <Edit3 className="h-4 w-4 mr-2" />
                      Edit
                    </DropdownMenuItem>
                  )}
                  {onClone && (
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onClone(blueprint); }}>
                      <Copy className="h-4 w-4 mr-2" />
                      Clone
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  {onDelete && (
                    <DropdownMenuItem 
                      onClick={(e) => { e.stopPropagation(); onDelete(blueprint); }}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pb-4">
          <div className="space-y-3">
            {blueprint.tags && blueprint.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {blueprint.tags.slice(0, 3).map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    <Tag className="h-3 w-3 mr-1" />
                    {tag}
                  </Badge>
                ))}
                {blueprint.tags.length > 3 && (
                  <Badge variant="outline" className="text-xs">
                    +{blueprint.tags.length - 3}
                  </Badge>
                )}
              </div>
            )}

            <div className="flex items-center space-x-4 text-sm text-muted-foreground">
              <div className="flex items-center space-x-1">
                <Clock className="h-4 w-4" />
                <span>{format(new Date(blueprint.createdAt), 'MMM dd, yyyy')}</span>
              </div>
              
              {blueprint.version && (
                <div className="flex items-center space-x-1">
                  <Settings className="h-4 w-4" />
                  <span>v{blueprint.version}</span>
                </div>
              )}
            </div>

            {blueprint.author && (
              <div className="flex items-center space-x-2">
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="text-xs">
                    {blueprint.author.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{blueprint.author.name}</span>
                  <span className="text-xs text-muted-foreground">{blueprint.author.email}</span>
                </div>
              </div>
            )}
          </div>
        </CardContent>

        <CardFooter className="pt-0">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center space-x-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={(e) => { e.stopPropagation(); onView?.(blueprint); }}
                className="h-8"
              >
                View Details
              </Button>
              
              {onRun && (
                <Button 
                  size="sm" 
                  onClick={(e) => { e.stopPropagation(); onRun(blueprint); }}
                  className="h-8"
                >
                  <Play className="h-3 w-3 mr-1" />
                  Run
                </Button>
              )}
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <Star className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Add to Favorites</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </CardFooter>
      </Card>
    </TooltipProvider>
  );
}
