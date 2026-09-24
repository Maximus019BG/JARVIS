import { z } from "zod";
import { audioGateway } from "~/server/gateway/audio";
import { speechCostMicros } from "~/server/gateway/usage";
import { AUDIO } from "~/server/gateway/upstreams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Loose, like the chat body: only the fields with a cost consequence are constrained. */
const bodySchema = z.looseObject({
  model: z.enum(AUDIO.speech.models),
  input: z.string().min(1).max(AUDIO.maxSpeechChars),
  voice: z.string().max(100).optional(),
  instructions: z.string().max(4096).optional(),
  speed: z.number().min(0.25).max(4).optional(),
});

/** `/audio/speech` on Groq's Orpheus, on the owner's key. The audio streams back as it is generated. */
export function POST(request: Request) {
  return audioGateway(request, async (req) => {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      const modelIssue = parsed.error.issues.some(
        (issue) => issue.path[0] === "model",
      );
      return modelIssue
        ? {
            status: 404,
            code: "model_not_found",
            message: "no such speech model",
          }
        : {
            status: 400,
            code: "invalid_request",
            message: JSON.stringify(parsed.error.issues.slice(0, 5)),
          };
    }
    const { voice } = parsed.data;
    const body = {
      ...parsed.data,
      voice:
        voice && (AUDIO.speech.voices as readonly string[]).includes(voice)
          ? voice
          : AUDIO.speech.defaultVoice,
      response_format: AUDIO.speech.responseFormat,
    };
    return {
      upstream: AUDIO.speech,
      model: parsed.data.model,
      path: "/audio/speech",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      costMicros: speechCostMicros(parsed.data.input.length),
    };
  });
}
