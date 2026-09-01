"use client";

import { applyOps, type Op } from "@blueprint/ops.ts";
import type { BlueprintDoc } from "@blueprint/schema.ts";
import axios, { AxiosError } from "axios";
import React from "react";
import { toast } from "sonner";

type Loaded = { doc: BlueprintDoc; version: number; legacy: boolean; name: string };

/**
 * The editor's document state.
 *
 * There is no undo stack and no command pattern here: unsaved work *is* a list of ops, and
 * the current drawing is that list replayed over the last saved document. Undo is a slice.
 * Saving is posting the same list to the server, which replays it again with the same
 * `applyOps` — so what the user sees and what gets stored cannot drift apart.
 */
export function useEditorDoc(blueprintId: string) {
  const [base, setBase] = React.useState<Loaded | null>(null);
  const [journal, setJournal] = React.useState<Op[]>([]);
  const [redoable, setRedoable] = React.useState<Op[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Nothing is set synchronously here: the hook starts in its loading state, and every
  // other write happens after the request resolves.
  const load = React.useCallback(async () => {
    try {
      const { data } = await axios.get<{
        doc: BlueprintDoc | null;
        version: number;
        legacy: boolean;
        name: string;
      }>(`/api/blueprint/${blueprintId}`);
      if (!data.doc) {
        setError("This blueprint has no readable content.");
        return;
      }
      setBase({ doc: data.doc, version: data.version, legacy: data.legacy, name: data.name });
      setJournal([]);
      setRedoable([]);
      setError(null);
    } catch {
      setError("Failed to load blueprint.");
    } finally {
      setLoading(false);
    }
  }, [blueprintId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const reload = React.useCallback(() => {
    setLoading(true);
    return load();
  }, [load]);

  const doc = React.useMemo(() => {
    if (!base) return null;
    if (journal.length === 0) return base.doc;
    // Every op was validated against this exact prefix when it was pushed, so the replay
    // cannot fail — but a throw here would blank the canvas, so it falls back to the base.
    try {
      return applyOps(base.doc, journal).doc;
    } catch {
      return base.doc;
    }
  }, [base, journal]);

  /** Applies ops optimistically, rejecting the batch if the engine refuses it. */
  const push = React.useCallback(
    (...ops: Op[]) => {
      if (ops.length === 0 || !doc) return false;
      try {
        applyOps(doc, ops);
      } catch (failure) {
        toast.error(failure instanceof Error ? failure.message : "Could not apply that");
        return false;
      }
      setJournal((current) => [...current, ...ops]);
      setRedoable([]);
      return true;
    },
    [doc],
  );

  const undo = React.useCallback(() => {
    setJournal((current) => {
      const last = current.at(-1);
      if (!last) return current;
      setRedoable((stack) => [...stack, last]);
      return current.slice(0, -1);
    });
  }, []);

  const redo = React.useCallback(() => {
    setRedoable((stack) => {
      const last = stack.at(-1);
      if (!last) return stack;
      setJournal((current) => [...current, last]);
      return stack.slice(0, -1);
    });
  }, []);

  const save = React.useCallback(
    async (options: { message?: string; name?: string } = {}) => {
      if (!base || saving) return;
      const rename = options.name && options.name !== base.name ? options.name : undefined;
      if (journal.length === 0 && !rename) return;
      setSaving(true);
      try {
        const { data } = await axios.post<{ version: number; doc: BlueprintDoc; summary: string }>(
          `/api/blueprint/${blueprintId}/edit`,
          { ops: journal, message: options.message, name: rename, expectedVersion: base.version },
        );
        setBase({ doc: data.doc, version: data.version, legacy: false, name: rename ?? base.name });
        setJournal([]);
        setRedoable([]);
        toast.success(`Saved v${data.version}`);
      } catch (failure) {
        const status = failure instanceof AxiosError ? failure.response?.status : undefined;
        if (status === 409) {
          // A device pushed while this editor was open. Work is still in the journal, so
          // nothing is lost by refusing — reloading and redrawing is the user's call.
          toast.error("This blueprint changed elsewhere. Reload to see the new version.", {
            action: { label: "Reload", onClick: () => window.location.reload() },
            duration: 10000,
          });
        } else {
          const message =
            failure instanceof AxiosError
              ? ((failure.response?.data as { error?: string } | undefined)?.error ?? failure.message)
              : "Failed to save";
          toast.error(message);
        }
      } finally {
        setSaving(false);
      }
    },
    [base, blueprintId, journal, saving],
  );

  return {
    doc,
    base,
    loading,
    saving,
    error,
    dirty: journal.length > 0,
    pendingCount: journal.length,
    canUndo: journal.length > 0,
    canRedo: redoable.length > 0,
    push,
    undo,
    redo,
    save,
    reload,
  };
}
