"use client";

import type { VariantProps } from "class-variance-authority";
import type React from "react";
import { create } from "zustand";
import type { buttonVariants } from "~/components/ui/button";
// Replace dependency on UI form types with a local lightweight message shape
export type AlertMessage = {
  message?: string;
  variant?: "success" | "error" | "warning" | "info";
  icon?: React.ReactNode;
};

export interface TypeToConfirmOptions {
  title?: string;
  description?: React.ReactNode;
  confirmText?: string;
  caseInensitive?: boolean;
  message?: AlertMessage;
  warning?: string | null;
  isLoading?: boolean;
  confirmButtonText?: string;
  confirmButtonVariant?: VariantProps<typeof buttonVariants>["variant"];
  cancelButtonText?: string;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
  onClose?: () => void;
}

export interface TypeToConfirmState extends TypeToConfirmOptions {
  open: boolean;
}

interface TypeToConfirmStore {
  state: TypeToConfirmState;
  resolve: ((value: boolean) => void) | null;
  show: (options: TypeToConfirmOptions) => Promise<boolean>;
  close: (success?: boolean) => void;
  setMessage: (message?: AlertMessage) => void;
  setIsLoading: (isLoading: boolean) => void;
  _confirm: () => void | Promise<void>;
  _cancel: () => void;
}

export const useAlertStore = create<TypeToConfirmStore>((set, get) => ({
  state: { open: false },
  resolve: null,
  show: (options) =>
    new Promise<boolean>((resolve) => {
      set({
        state: { open: true, ...options },
        resolve,
      });
    }),
  close: (success = false) => {
    const { resolve, state } = get();
    if (state.isLoading && !success) return;
    set({ state: { ...state, open: false } });
    state.onClose?.();
    resolve?.(success);
    set({ resolve: null });
  },
  setMessage: (message) => {
    set({ state: { ...get().state, message } });
  },
  setIsLoading: (isLoading) => {
    set({ state: { ...get().state, isLoading } });
  },
  _confirm: () => {
    const { state } = get();
    if (state.isLoading) return;
    void state.onConfirm?.();
  },
  _cancel: () => {
    const { close, state } = get();
    if (state.isLoading) return;
    state.onCancel?.();
    close(false);
  },
}));

export const typeToConfirm = {
  show: (opts: TypeToConfirmOptions) => useAlertStore.getState().show(opts),
  close: (success?: boolean) => useAlertStore.getState().close(success),
  setMessage: (message?: AlertMessage) =>
    useAlertStore.getState().setMessage(message),
  setIsLoading: (isLoading: boolean) =>
    useAlertStore.getState().setIsLoading(isLoading),
};
