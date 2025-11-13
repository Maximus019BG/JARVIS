'use client';

import React from 'react';
import { format } from 'date-fns';
import {
  Clock,
  User,
  Settings,
  Copy,
  Edit3,
  Play,
  Download,
  Share,
  Tag,
  Calendar,
  FileText,
  Activity,
  X
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar';
import { Separator } from '~/components/ui/separator';
import { ScrollArea } from '~/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { type Blueprint } from '~/lib/api/blueprints';

interface BlueprintDetailModalProps {
  blueprint: Blueprint | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit?: (blueprint: Blueprint) => void;
  onClone?: (blueprint: Blueprint) => void;
  onRun?: (blueprint: Blueprint) => void;
  onDownload?: (blueprint: Blueprint) => void;
  onShare?: (blueprint: Blueprint) => void;
}

export function BlueprintDetailModal({
  blueprint,
  isOpen,
  onClose,
  onEdit,
  onClone,
  onRun,
  onDownload,
  onShare
}: BlueprintDetailModalProps) {
  if (!blueprint) return null;

  const parsedMetadata = blueprint.metadata ? JSON.parse(blueprint.metadata) : {};

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] p-0">
        <div className="flex flex-col h-full">
          <DialogHeader className="p-6 pb-4">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <DialogTitle className="text-2xl font-bold">{blueprint.name}</DialogTitle>
                {blueprint.description && (
                  <DialogDescription className="text-base">
                    {blueprint.description}
                  </DialogDescription>
                )}
                <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                  <div className="flex items-center space-x-1">
                    <Calendar className="h-4 w-4" />
                    <span>Created {format(new Date(blueprint.createdAt), 'PPP')}</span>
                  </div>
                  {blueprint.version && (
                    <div className="flex items-center space-x-1">
                      <Settings className="h-4 w-4" />
                      <span>Version {blueprint.version}</span>
                    </div>
                  )}
                  {blueprint.isActive && (
                    <Badge variant="default" className="bg-green-500">
                      <Activity className="h-3 w-3 mr-1" />
                      Active
                    </Badge>
                  )}
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                {onRun && (
                  <Button onClick={() => onRun(blueprint)}>
                    <Play className="h-4 w-4 mr-2" />
                    Run
                  </Button>
                )}
                {onEdit && (
                  <Button variant="outline" onClick={() => onEdit(blueprint)}>
                    <Edit3 className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                )}
                <Button variant="ghost" onClick={onClose}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </DialogHeader>

          <Separator />

          <ScrollArea className="flex-1 p-6">
            <Tabs defaultValue="overview" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="configuration">Configuration</TabsTrigger>
                <TabsTrigger value="metadata">Metadata</TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="mt-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center text-lg">
                        <User className="h-5 w-5 mr-2" />
                        Author Information
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {blueprint.author ? (
                        <div className="flex items-center space-x-3">
                          <Avatar>
                            <AvatarFallback>
                              {blueprint.author.name.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">{blueprint.author.name}</p>
                            <p className="text-sm text-muted-foreground">{blueprint.author.email}</p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-muted-foreground">No author information available</p>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center text-lg">
                        <Clock className="h-5 w-5 mr-2" />
                        Timeline
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div>
                        <p className="text-sm font-medium">Created</p>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(blueprint.createdAt), 'PPP p')}
                        </p>
                      </div>
                      {blueprint.lastModified && (
                        <div>
                          <p className="text-sm font-medium">Last Modified</p>
                          <p className="text-sm text-muted-foreground">
                            {format(new Date(blueprint.lastModified), 'PPP p')}
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {blueprint.tags && blueprint.tags.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center text-lg">
                        <Tag className="h-5 w-5 mr-2" />
                        Tags
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-2">
                        {blueprint.tags.map((tag) => (
                          <Badge key={tag} variant="secondary">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center text-lg">
                      <FileText className="h-5 w-5 mr-2" />
                      Description
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed">
                      {blueprint.description || 'No description provided for this blueprint.'}
                    </p>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="configuration" className="mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Blueprint Configuration</CardTitle>
                    <CardDescription>
                      Technical configuration and settings for this blueprint
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-sm font-medium">Blueprint ID</label>
                          <p className="text-sm text-muted-foreground font-mono">{blueprint.id}</p>
                        </div>
                        <div>
                          <label className="text-sm font-medium">Workstation ID</label>
                          <p className="text-sm text-muted-foreground font-mono">{blueprint.workstationId}</p>
                        </div>
                        {blueprint.version && (
                          <div>
                            <label className="text-sm font-medium">Version</label>
                            <p className="text-sm text-muted-foreground">{blueprint.version}</p>
                          </div>
                        )}
                        <div>
                          <label className="text-sm font-medium">Status</label>
                          <Badge variant={blueprint.isActive ? 'default' : 'secondary'}>
                            {blueprint.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="metadata" className="mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Raw Metadata</CardTitle>
                    <CardDescription>
                      Additional metadata and configuration data stored with this blueprint
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <pre className="bg-muted p-4 rounded-md text-sm overflow-auto max-h-96">
                      {JSON.stringify(parsedMetadata, null, 2)}
                    </pre>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="activity" className="mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center text-lg">
                      <Activity className="h-5 w-5 mr-2" />
                      Recent Activity
                    </CardTitle>
                    <CardDescription>
                      Recent actions and changes to this blueprint
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex items-center space-x-3 p-3 border rounded-md">
                        <div className="h-2 w-2 bg-blue-500 rounded-full" />
                        <div className="flex-1">
                          <p className="text-sm font-medium">Blueprint created</p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(blueprint.createdAt), 'PPP p')}
                          </p>
                        </div>
                      </div>
                      {blueprint.lastModified && (
                        <div className="flex items-center space-x-3 p-3 border rounded-md">
                          <div className="h-2 w-2 bg-yellow-500 rounded-full" />
                          <div className="flex-1">
                            <p className="text-sm font-medium">Blueprint modified</p>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(blueprint.lastModified), 'PPP p')}
                            </p>
                          </div>
                        </div>
                      )}
                      {/* Add more activity items as needed */}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </ScrollArea>

          <Separator />

          <div className="p-6 pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                {onClone && (
                  <Button variant="outline" onClick={() => onClone(blueprint)}>
                    <Copy className="h-4 w-4 mr-2" />
                    Clone
                  </Button>
                )}
                {onDownload && (
                  <Button variant="outline" onClick={() => onDownload(blueprint)}>
                    <Download className="h-4 w-4 mr-2" />
                    Export
                  </Button>
                )}
                {onShare && (
                  <Button variant="outline" onClick={() => onShare(blueprint)}>
                    <Share className="h-4 w-4 mr-2" />
                    Share
                  </Button>
                )}
              </div>
              
              <div className="flex items-center space-x-2">
                <Button variant="outline" onClick={onClose}>
                  Close
                </Button>
                {onRun && (
                  <Button onClick={() => onRun(blueprint)}>
                    <Play className="h-4 w-4 mr-2" />
                    Run Blueprint
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
