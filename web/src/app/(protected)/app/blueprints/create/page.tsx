'use client';

import React from 'react';
import { ArrowLeft, Save, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Textarea } from '~/components/ui/textarea';
import { Badge } from '~/components/ui/badge';

export default function CreateBlueprintPage() {
  const router = useRouter();

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Create Blueprint</h1>
            <p className="text-muted-foreground">
              Design and configure your automation blueprint
            </p>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <Button variant="outline">
            <Play className="h-4 w-4 mr-2" />
            Test
          </Button>
          <Button>
            <Save className="h-4 w-4 mr-2" />
            Save Blueprint
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
              <CardDescription>
                Configure the basic properties of your blueprint
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Blueprint Name</Label>
                <Input id="name" placeholder="Enter blueprint name..." />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea 
                  id="description" 
                  placeholder="Describe what this blueprint does..." 
                  rows={3}
                />
              </div>
              
              <div className="space-y-2">
                <Label>Tags</Label>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">automation</Badge>
                  <Badge variant="secondary">workflow</Badge>
                  <Badge variant="outline">+ Add Tag</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Blueprint Configuration</CardTitle>
              <CardDescription>
                Define the workflow and automation logic
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-96 border-2 border-dashed border-muted rounded-lg flex items-center justify-center">
                <div className="text-center">
                  <p className="text-muted-foreground">Blueprint Designer</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Drag and drop components to build your workflow
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Properties</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="version">Version</Label>
                <Input id="version" placeholder="1.0.0" />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="workstation">Workstation</Label>
                <Input id="workstation" placeholder="Select workstation..." />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Blueprint preview will appear here once configured
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
