"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { problem } from "~/lib/api/error";

type QueuedPrompt = {
  id: string;
  prompt: string;
  status: string;
  createdAt: string;
  deliveredAt: string | null;
};

/** Pace of the "has the terminal taken it yet?" check. Matches the TUI's own poll. */
const POLL_MS = 5_000;

/**
 * Sends a prompt to the terminal running this session.
 *
 * Nothing here can make the prompt run: the TUI only polls when `remoteSteering` is on in its
 * config, and whatever the agent then tries still goes through its permission gate. So the
 * honest status is "queued" until a workstation actually claims it, which is what this shows.
 */
export function SessionPromptForm({ sessionId }: { sessionId: string }) {
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["session", sessionId, "prompts"],
    queryFn: async () => {
      const { data } = await axios.get<{ prompts: QueuedPrompt[] }>(`/api/session/${sessionId}/prompt`);
      return data.prompts;
    },
    // Only while something is outstanding. A session nobody is steering costs no requests.
    refetchInterval: (query) =>
      query.state.data?.some((entry) => entry.status === "pending") ? POLL_MS : false,
  });

  const pending = (data ?? []).filter((entry) => entry.status === "pending");
  const lastDelivered = (data ?? []).find((entry) => entry.status === "delivered");

  const send = async () => {
    const text = prompt.trim();
    if (!text) return;
    setSending(true);
    try {
      await axios.post(`/api/session/${sessionId}/prompt`, { prompt: text });
      setPrompt("");
      toast.success("Queued — the terminal will pick it up on its next poll");
      await queryClient.invalidateQueries({ queryKey: ["session", sessionId, "prompts"] });
      // The transcript is a server component and only grows when the TUI pushes the session
      // back up, which happens at the end of the turn this prompt starts.
      router.refresh();
    } catch (error) {
      toast.error(problem(error, "Could not queue that prompt"));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Send a prompt to this session</p>
        {pending.length > 0 && (
          <Badge variant="secondary">
            {pending.length} queued, waiting for the workstation
          </Badge>
        )}
      </div>

      <Textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="Actually, do it the other way round…"
        rows={3}
        // Cmd/Ctrl+Enter rather than Enter: this is a paragraph of direction, and a stray
        // newline should not fire an agent turn on a machine you are not sitting at.
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
        }}
      />

      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
          {lastDelivered
            ? `Last picked up ${new Date(lastDelivered.deliveredAt ?? lastDelivered.createdAt).toLocaleTimeString()}`
            : "Needs remoteSteering enabled in the workstation's jarvis config."}
        </p>
        <Button onClick={send} disabled={sending || !prompt.trim()} size="sm">
          Send
        </Button>
      </div>
    </div>
  );
}
