"use client";

import React from "react";
import { ArrowLeft, Save, Play, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { useActiveWorkstation } from "~/lib/workstation-hooks";
import { useEffect } from "react";
import { blueprintsApi } from "~/lib/api/blueprints";

interface EditBlueprintPageProps {
  // Next can pass `params` directly to client pages. Keep it optional
  // and typed as an object to avoid Promise-related type issues.
  params?: { id: string };
}

export default function EditBlueprintPage({ params }: EditBlueprintPageProps) {
  const router = useRouter();
  const { data: activeWorkstation } = useActiveWorkstation();
  const id = params?.id;
  const [content, setContent] = React.useState("");
  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  useEffect(() => {
    const load = async () => {
      if (!activeWorkstation?.id || !id) return;
      try {
        const res = await fetch(
          `/api/workstation/blueprint/load/${activeWorkstation.id}/${id}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        setContent(JSON.stringify(data, null, 2));
      } catch (e) {
        console.error(e);
      }
    };
    void load();
  }, [activeWorkstation?.id, id]);

  if (!activeWorkstation) return null;

  return (
    <div className="container mx-auto space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Edit Blueprint
            </h1>
            <p className="text-muted-foreground">
              Modify blueprint {id}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm">
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
          <Button variant="outline">
            <Play className="mr-2 h-4 w-4" />
            Test
          </Button>
          <Button
            onClick={async () => {
              if (!activeWorkstation?.id) return;
              setLoading(true);
              try {
                await fetch(
                  `/api/workstation/blueprint/save/${activeWorkstation.id}/${id}`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      name: name || `Blueprint ${id}`,
                      data: JSON.parse(content || "{}"),
                    }),
                  },
                );
              } catch (e) {
                console.error(e);
              }
              setLoading(false);
            }}
          >
            <Save className="mr-2 h-4 w-4" />
            Save Changes
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Blueprint Editor</CardTitle>
          <CardDescription>
            Edit the configuration and workflow for blueprint {id}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border-muted flex h-96 flex-col rounded-lg border-2 border-dashed">
            <textarea
              className="h-full w-full bg-transparent p-4 font-mono text-sm"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
