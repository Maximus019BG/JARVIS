"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AxiosError } from "axios";
import { useRouter } from "next/navigation";
import React from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { LoadingButton } from "~/components/common/loading-button";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "~/components/ui/form";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import { blueprintsApi } from "~/lib/api/blueprints";
import { BLUEPRINT_NAME_RE, slugifyBlueprintName } from "~/lib/blueprint-name";

/**
 * Sheet sizes in millimetres, which is what `DEFAULT_VIEW_BOX` uses and what a drawing
 * measured against the real world is in. Picking another unit converts the numbers rather
 * than relabelling them, so an A4 sheet in inches is 11.69 × 8.27 and still A4.
 */
const PRESETS = [
  { id: "a4-landscape", label: "A4", hint: "landscape", w: 297, h: 210 },
  { id: "a4-portrait", label: "A4", hint: "portrait", w: 210, h: 297 },
  { id: "a3-landscape", label: "A3", hint: "landscape", w: 420, h: 297 },
  { id: "custom", label: "Custom", hint: "your size", w: 0, h: 0 },
] as const;

const UNITS = [
  { id: "mm", label: "mm", perMm: 1 },
  { id: "cm", label: "cm", perMm: 0.1 },
  { id: "in", label: "in", perMm: 1 / 25.4 },
  { id: "px", label: "px", perMm: 96 / 25.4 },
] as const;

type Units = (typeof UNITS)[number]["id"];

const formSchema = z.object({
  name: z.string().min(1, "Give it a name").regex(BLUEPRINT_NAME_RE, {
    message: "Lowercase letters, digits and hyphens only",
  }),
  width: z.number().positive("Must be greater than zero"),
  height: z.number().positive("Must be greater than zero"),
});

type FormValues = z.infer<typeof formSchema>;

const round = (value: number) => Math.round(value * 100) / 100;

export function BlueprintCreateDialog({
  workstationId,
  open,
  onOpenChange,
}: {
  workstationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [units, setUnits] = React.useState<Units>("mm");
  const [preset, setPreset] = React.useState<string>("a4-landscape");
  const [isLoading, setIsLoading] = React.useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", width: 297, height: 210 },
    disabled: isLoading,
  });

  const name = form.watch("name");
  const width = form.watch("width");
  const height = form.watch("height");

  // Typing a human name should suggest the machine one rather than just refusing it.
  const suggestion = React.useMemo(() => {
    if (!name || BLUEPRINT_NAME_RE.test(name)) return null;
    const slug = slugifyBlueprintName(name);
    return slug && slug !== name ? slug : null;
  }, [name]);

  const perMm = UNITS.find((entry) => entry.id === units)!.perMm;

  const choosePreset = (id: string) => {
    setPreset(id);
    const found = PRESETS.find((entry) => entry.id === id);
    if (!found || found.id === "custom") return;
    form.setValue("width", round(found.w * perMm), { shouldValidate: true });
    form.setValue("height", round(found.h * perMm), { shouldValidate: true });
  };

  const chooseUnits = (next: Units) => {
    const nextPerMm = UNITS.find((entry) => entry.id === next)!.perMm;
    const factor = nextPerMm / perMm;
    form.setValue("width", round(width * factor));
    form.setValue("height", round(height * factor));
    setUnits(next);
  };

  React.useEffect(() => {
    if (!open) {
      form.reset();
      setUnits("mm");
      setPreset("a4-landscape");
    }
  }, [open, form]);

  async function onSubmit(values: FormValues) {
    setIsLoading(true);
    try {
      const created = await blueprintsApi.createBlueprint({
        workstationId,
        name: values.name,
        units,
        viewBox: [0, 0, values.width, values.height],
      });
      toast.success(`Created "${created.name}"`);
      onOpenChange(false);
      // Straight into the editor: a new blueprint is an empty sheet you want to draw on,
      // not a card to find again in the list.
      router.push(`/app/blueprints/${workstationId}/${created.id}/${created.createdBy}/edit`);
    } catch (error) {
      const message =
        error instanceof AxiosError
          ? ((error.response?.data as { error?: string } | undefined)?.error ?? error.message)
          : "Failed to create blueprint";
      toast.error(message);
      setIsLoading(false);
    }
  }

  // The preview keeps the sheet's real proportions, so portrait and landscape are told
  // apart by looking rather than by reading the numbers back.
  const ratio = width > 0 && height > 0 ? width / height : 1;
  const previewWidth = ratio >= 1 ? 100 : 100 * ratio;
  const previewHeight = ratio >= 1 ? 100 / ratio : 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>New blueprint</DialogTitle>
              <DialogDescription>
                An empty sheet you can draw on here, and pull down to any paired device.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-5 py-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="workbench-layout" autoFocus {...field} />
                    </FormControl>
                    {suggestion ? (
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground w-fit text-xs underline-offset-2 hover:underline"
                        onClick={() => form.setValue("name", suggestion, { shouldValidate: true })}
                      >
                        Use <span className="font-mono">{suggestion}</span>
                      </button>
                    ) : (
                      <p className="text-muted-foreground text-xs">
                        Becomes the filename on every device that syncs it.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <FormLabel>Sheet</FormLabel>
                <div className="grid grid-cols-4 gap-2">
                  {PRESETS.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => choosePreset(entry.id)}
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-md border p-2.5 text-center transition-colors",
                        preset === entry.id
                          ? "border-primary bg-primary/5"
                          : "hover:border-muted-foreground/40",
                      )}
                    >
                      <span
                        className={cn(
                          "border",
                          preset === entry.id ? "border-primary/60" : "border-muted-foreground/40",
                        )}
                        style={
                          entry.id === "custom"
                            ? { width: 20, height: 20, borderStyle: "dashed" }
                            : { width: Math.round((entry.w / 420) * 24), height: Math.round((entry.h / 420) * 24) }
                        }
                      />
                      <span className="text-xs leading-none font-medium">{entry.label}</span>
                      <span className="text-muted-foreground text-[10px] leading-none">{entry.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
                <FormField
                  control={form.control}
                  name="width"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Width</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="any"
                          min={0}
                          value={field.value}
                          onChange={(event) => {
                            setPreset("custom");
                            field.onChange(event.target.valueAsNumber);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="height"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Height</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="any"
                          min={0}
                          value={field.value}
                          onChange={(event) => {
                            setPreset("custom");
                            field.onChange(event.target.valueAsNumber);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="bg-muted/40 flex rounded-md border p-0.5">
                  {UNITS.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => chooseUnits(entry.id)}
                      className={cn(
                        "rounded px-2 py-1.5 text-xs transition-colors",
                        units === entry.id
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-muted/30 flex h-28 items-center justify-center rounded-md border">
                <div
                  className="border-primary/50 bg-background relative border"
                  style={{ width: `${previewWidth * 0.8}px`, height: `${previewHeight * 0.8}px` }}
                >
                  <span className="text-muted-foreground absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] whitespace-nowrap">
                    {round(width)} × {round(height)} {units}
                  </span>
                </div>
              </div>
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={isLoading}>
                  Cancel
                </Button>
              </DialogClose>
              <LoadingButton isLoading={isLoading} disabled={isLoading}>
                Create and open
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
