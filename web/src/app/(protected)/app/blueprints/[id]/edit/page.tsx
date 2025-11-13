'use client';

import React from 'react';
import { ArrowLeft, Save, Play, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';

interface EditBlueprintPageProps {
  params: {
    id: string;
  };
}

export default function EditBlueprintPage({ params }: EditBlueprintPageProps) {
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
            <h1 className="text-3xl font-bold tracking-tight">Edit Blueprint</h1>
            <p className="text-muted-foreground">
              Modify blueprint {params.id}
            </p>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm">
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
          <Button variant="outline">
            <Play className="h-4 w-4 mr-2" />
            Test
          </Button>
          <Button>
            <Save className="h-4 w-4 mr-2" />
            Save Changes
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Blueprint Editor</CardTitle>
          <CardDescription>
            Edit the configuration and workflow for blueprint {params.id}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-96 border-2 border-dashed border-muted rounded-lg flex items-center justify-center">
            <div className="text-center">
              <p className="text-muted-foreground">Blueprint Editor</p>
              <p className="text-sm text-muted-foreground mt-1">
                Blueprint editing interface will be loaded here
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
