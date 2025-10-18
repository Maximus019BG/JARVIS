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
  FormMessage,
  FormResponseMessage,
  type FormResponseMessageProps,
} from "~/components/ui/form";
import { Input } from "~/components/ui/input";
import { authClient } from "~/lib/auth-client";
import { convertToBase64 } from "~/lib/image";
import {
  generateRandomSlug,
  workstationCreateSchema,
  type WorkstationCreate,
} from "~/lib/validation/workstations";

export function CreateWorkstationDialog({
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof Dialog>) {
  const { refetch: refetchWorkstation } = authClient.useActiveOrganization();
  const { refetch: refetchMember } = authClient.useActiveMember();

  const [isLoading, setIsLoading] = React.useState(false);
  const [message, setMessage] = React.useState<FormResponseMessageProps>();

  const form = useForm<WorkstationCreate>({
    resolver: zodResolver(workstationCreateSchema),
    defaultValues: {
      name: "",
      logo: undefined,
    },
    disabled: isLoading,
  });

  async function onSubmit(formData: WorkstationCreate) {
    setIsLoading(true);
    setMessage(undefined);

    const { data: response, error } = await authClient.organization.create({
      name: formData.name,
      slug: generateRandomSlug(),
      logo: formData.logo ? await convertToBase64(formData.logo) : undefined,
      keepCurrentActiveOrganization: false,
    });
    refetchWorkstation();
    refetchMember();
    setIsLoading(false);

    if (error) {
      setMessage({ message: error.message });
      return;
    }
    if (!response) return;

    form.reset();
    props.onOpenChange?.(false);
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
              <FormResponseMessage {...message} />
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
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter workstation name" {...field} />
                    </FormControl>
                    <FormMessage />
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
