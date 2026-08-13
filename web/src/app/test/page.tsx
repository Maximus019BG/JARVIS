"use client";

import type { NextPage } from "next";
import { useState } from "react";
import { toast } from "sonner";

import { LoadingButton } from "~/components/common/loading-button";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Separator } from "~/components/ui/separator";
import { Skeleton } from "~/components/ui/skeleton";
import { Slider } from "~/components/ui/slider";
import { Switch } from "~/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Textarea } from "~/components/ui/textarea";

const BUTTON_VARIANTS = [
  "default",
  "destructive",
  "outline",
  "secondary",
  "ghost",
  "link",
] as const;
const BUTTON_SIZES = ["default", "sm", "lg"] as const;
const BADGE_VARIANTS = ["default", "secondary", "destructive", "outline"] as const;

const UTILITIES = [
  "bp-grid",
  "bp-hatch",
  "bp-hatch-animated",
  "bp-ticks",
  "bp-notch",
  "bp-dashed",
  "bp-surface",
] as const;

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-baseline gap-3">
        <span className="bp-label">{id}</span>
        <h2 className="font-mono text-sm tracking-[0.1em] uppercase">{title}</h2>
        <Separator variant="dashed" className="flex-1" />
      </div>
      {children}
    </section>
  );
}

function Gallery() {
  const [isLoading, setIsLoading] = useState(false);

  return (
    <div className="bg-background text-foreground min-h-dvh space-y-10 p-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-mono text-2xl tracking-[0.18em] uppercase">
            Component Gallery
          </h1>
          <p className="bp-label mt-2">JARVIS · blueprint design system</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="bp-crosshair" aria-hidden />
          <span className="bp-registration" aria-hidden />
        </div>
      </header>

      <Section id="00" title="Utilities">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {UTILITIES.map((utility) => (
            <div key={utility} className="space-y-2">
              <div
                className={`${utility} border-border h-20 w-full ${utility === "bp-notch" ? "" : "border"}`}
                aria-hidden
              />
              <p className="bp-label">{utility}</p>
            </div>
          ))}
          <div className="space-y-2">
            <div className="flex h-20 items-center">
              <div className="bp-dim-x w-full" aria-hidden />
            </div>
            <p className="bp-label">bp-dim-x</p>
          </div>
        </div>
      </Section>

      <Section id="01" title="Buttons">
        <div className="space-y-3">
          {BUTTON_SIZES.map((size) => (
            <div key={size} className="flex flex-wrap items-center gap-3">
              <span className="bp-label w-16">{size}</span>
              {BUTTON_VARIANTS.map((variant) => (
                <Button key={variant} variant={variant} size={size}>
                  {variant}
                </Button>
              ))}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <span className="bp-label w-16">state</span>
            <Button disabled>disabled</Button>
            <Button variant="outline" aria-invalid>
              invalid
            </Button>
            <LoadingButton
              isLoading={isLoading}
              onClick={() => setIsLoading((prev) => !prev)}
            >
              toggle load
            </LoadingButton>
          </div>
        </div>
      </Section>

      <Section id="02" title="Badges">
        <div className="flex flex-wrap items-center gap-3">
          {BADGE_VARIANTS.map((variant) => (
            <Badge key={variant} variant={variant}>
              {variant}
            </Badge>
          ))}
          <Avatar>
            <AvatarFallback>JV</AvatarFallback>
          </Avatar>
        </div>
      </Section>

      <Section id="03" title="Surfaces">
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Workstation 01</CardTitle>
              <CardDescription>
                Notched corners, corner ticks and dashed section rules.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm">
              Cards compose bp-surface, bp-notch and bp-ticks. The notch outline
              is redrawn by a masked pseudo-element so the diagonal stays lined.
            </CardContent>
            <CardFooter className="gap-3">
              <Button size="sm">Confirm</Button>
              <Button size="sm" variant="outline">
                Cancel
              </Button>
            </CardFooter>
          </Card>

          <div className="space-y-4">
            <Alert>
              <AlertTitle>Calibration required</AlertTitle>
              <AlertDescription>
                Projector alignment has drifted past tolerance.
              </AlertDescription>
            </Alert>
            <Alert variant="destructive">
              <AlertTitle>Sensor offline</AlertTitle>
              <AlertDescription>Depth camera not responding.</AlertDescription>
            </Alert>
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        </div>
      </Section>

      <Section id="04" title="Empty state">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <span className="bp-crosshair" aria-hidden />
            </EmptyMedia>
            <EmptyTitle>No blueprints</EmptyTitle>
            <EmptyDescription>
              Nothing has been drafted for this workstation yet.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm">New blueprint</Button>
          </EmptyContent>
        </Empty>
      </Section>

      <Section id="05" title="Form controls">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="g-name">Designation</Label>
              <Input id="g-name" placeholder="workstation id" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="g-invalid">Invalid field</Label>
              <Input id="g-invalid" aria-invalid defaultValue="bad value" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="g-disabled">Disabled field</Label>
              <Input id="g-disabled" disabled placeholder="locked" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="g-notes">Notes</Label>
              <Textarea id="g-notes" placeholder="annotations" />
            </div>
          </div>

          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <Checkbox id="g-c1" />
              <Label htmlFor="g-c1">Unchecked</Label>
              <Checkbox id="g-c2" defaultChecked />
              <Label htmlFor="g-c2">Checked</Label>
              <Checkbox id="g-c3" disabled />
              <Label htmlFor="g-c3">Disabled</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch id="g-s1" />
              <Label htmlFor="g-s1">Off</Label>
              <Switch id="g-s2" defaultChecked />
              <Label htmlFor="g-s2">On</Label>
            </div>
            <RadioGroup defaultValue="a" className="flex gap-4">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="a" id="g-r1" />
                <Label htmlFor="g-r1">Metric</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="b" id="g-r2" />
                <Label htmlFor="g-r2">Imperial</Label>
              </div>
            </RadioGroup>
            <div className="space-y-2">
              <Label>Tolerance</Label>
              <Slider defaultValue={[40]} />
            </div>
          </div>
        </div>
      </Section>

      <Section id="06" title="Tabs & table">
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="config">Config</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="pt-4">
            <div className="border-border border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Entity</TableHead>
                    <TableHead>Layer</TableHead>
                    <TableHead className="text-right">Length</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    ["ARC-001", "structure", "142.50"],
                    ["LIN-014", "dimension", "88.25"],
                    ["POL-003", "annotation", "310.00"],
                    ["CIR-009", "structure", "45.75"],
                    ["LIN-021", "hidden", "12.00"],
                  ].map(([id, layer, length]) => (
                    <TableRow key={id}>
                      <TableCell className="bp-num">{id}</TableCell>
                      <TableCell>{layer}</TableCell>
                      <TableCell className="bp-num text-right">
                        {length}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
          <TabsContent value="history" className="bp-label pt-4">
            No revisions recorded.
          </TabsContent>
          <TabsContent value="config" className="bp-label pt-4">
            Defaults applied.
          </TabsContent>
        </Tabs>
      </Section>

      <Section id="07" title="Overlays">
        <div className="flex flex-wrap items-center gap-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                Dialog
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm revision</DialogTitle>
                <DialogDescription>
                  This writes a new revision to the blueprint history.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button size="sm">Commit</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Sheet>
            <SheetTrigger asChild>
              <Button size="sm" variant="outline">
                Sheet
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Device access</SheetTitle>
                <SheetDescription>Grant scoped permissions.</SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>

          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline">
                Popover
              </Button>
            </PopoverTrigger>
            <PopoverContent>Notched popover surface.</PopoverContent>
          </Popover>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                Dropdown
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Layers</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Structure</DropdownMenuItem>
              <DropdownMenuItem>Dimension</DropdownMenuItem>
              <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Select>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="units" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mm">Millimetres</SelectItem>
              <SelectItem value="in">Inches</SelectItem>
            </SelectContent>
          </Select>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="outline">
                  Tooltip
                </Button>
              </TooltipTrigger>
              <TooltipContent>Registration mark</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <Button size="sm" onClick={() => toast("Revision committed")}>
            Toast
          </Button>
        </div>
      </Section>

      <Section id="08" title="Separators">
        <div className="space-y-4">
          <Separator />
          <Separator variant="dashed" />
          <Separator variant="dim" />
        </div>
      </Section>
    </div>
  );
}

const TestPage: NextPage = () => {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2">
      <Gallery />
      {/* @custom-variant dark (&:is(.dark *)) makes this render the dark theme
          inline, so both themes are diffable in one screenshot. */}
      <div className="dark border-border border-l">
        <Gallery />
      </div>
    </div>
  );
};

export default TestPage;
