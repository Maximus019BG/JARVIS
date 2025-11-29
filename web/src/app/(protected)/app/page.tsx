"use client";

import React from "react";
import { Plus } from "lucide-react";
import { Header } from "~/components/dashboard/header";
import { DashboardSidebar } from "~/components/dashboard/dashboard-sidebar";
import { Card, CardHeader, CardTitle, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

export default function DashboardPage() {
  return (
    <div className="h-screen flex flex-col bg-background">
      <Header />

      <div className="flex flex-1 overflow-hidden">
        <DashboardSidebar />

        <main className="flex-1 p-6 overflow-auto">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Dashboard</h1>
              <p className="text-muted-foreground">Overview of your workspaces, blueprints and automations</p>
            </div>

            <div className="flex items-center gap-3">
              <Input placeholder="Search blueprints, automations..." className="max-w-xs" />
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                New
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 mb-6">
            <Card>
              <CardHeader>
                <CardTitle>Blueprints</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold">24</div>
                <p className="text-sm text-muted-foreground">Total blueprints across your workstations</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Automations</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold">12</div>
                <p className="text-sm text-muted-foreground">Active automations running</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Workstations</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold">3</div>
                <p className="text-sm text-muted-foreground">Connected workstations</p>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Recent Blueprints</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="w-full overflow-auto">
                  <table className="w-full text-left">
                    <thead className="text-sm text-muted-foreground">
                      <tr>
                        <th className="py-2">Name</th>
                        <th className="py-2">Workstation</th>
                        <th className="py-2">Updated</th>
                        <th className="py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t">
                        <td className="py-3">Welcome Blueprint</td>
                        <td className="py-3">Home Lab</td>
                        <td className="py-3">2 days ago</td>
                        <td className="py-3">
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm">Edit</Button>
                            <Button variant="ghost" size="sm">Run</Button>
                          </div>
                        </td>
                      </tr>
                      <tr className="border-t">
                        <td className="py-3">Auto Lights</td>
                        <td className="py-3">Office</td>
                        <td className="py-3">5 days ago</td>
                        <td className="py-3">
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm">Edit</Button>
                            <Button variant="ghost" size="sm">Run</Button>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
}
