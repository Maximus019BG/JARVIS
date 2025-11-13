"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import React from "react";
import { useForm } from "react-hook-form";
import { AvatarUpload } from "~/components/common/avatar-upload";
import { LoadingButton } from "~/components/common/loading-button";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "~/components/ui/form";
import { Input } from "~/components/ui/input";
import { convertToBase64 } from "~/lib/image";
import {
  generateRandomSlug,
  workstationCreateSchema,
  type WorkstationCreate,
} from "~/lib/validation/workstations";
import { toast } from "sonner";
import { useCreateWorkstation } from "~/lib/workstation-hooks";

export function CreateWorkstationDialog({
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof Dialog>) {
  const createMutation = useCreateWorkstation();

  const [isLoading, setIsLoading] = React.useState(false);

  const form = useForm<WorkstationCreate>({
    resolver: zodResolver(workstationCreateSchema),
    defaultValues: {
      id: "",
      name: "",
      logo: undefined,
    },
    disabled: isLoading,
  });

  async function onSubmit(formData: WorkstationCreate) {
    // Check for client-side validation errors
    const errors = form.formState.errors;
    if (errors.name) {
      toast.error(errors.name.message ?? "Invalid workstation name");
      return;
    }
    if (errors.logo) {
      toast.error(errors.logo.message ?? "Invalid logo");
      return;
    }

    setIsLoading(true);

    try {
      await createMutation.mutateAsync({
        name: formData.name,
        slug: generateRandomSlug(),
        logo: formData.logo ? await convertToBase64(formData.logo) : undefined,
      });

      toast.success("Workstation created successfully");
      form.reset();
      props.onOpenChange?.(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create workstation",
      );
    } finally {
      setIsLoading(false);
    }
  }

  const onFileReject = React.useCallback(
    (_: File, message: string) => {
      form.setError("logo", {
        type: "custom",
        message,
      });
    },
    [form],
  );

  const onFileClear = React.useCallback(() => {
    form.clearErrors("logo");
  }, [form]);

  return (
    <Dialog {...props}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>Create a new workstation</DialogTitle>
            </DialogHeader>
            <div className="grid gap-6 py-4">
              <FormField
                control={form.control}
                name="logo"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Logo</FormLabel>
                    <FormControl>
                      <AvatarUpload
                        invalid={fieldState.invalid}
                        onFileReject={onFileReject}
                        onFileClear={onFileClear}
                        {...field}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Workstation Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter workstation name" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Workstation ID</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter workstation id" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={form.formState.disabled}
                >
                  Cancel
                </Button>
              </DialogClose>
              <LoadingButton
                isLoading={isLoading}
                disabled={form.formState.disabled}
              >
                Create workstation
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
