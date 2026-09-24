import { audioGateway } from "~/server/gateway/audio";
import { transcribeCostMicros } from "~/server/gateway/usage";
import { AUDIO } from "~/server/gateway/upstreams";

/** Node for `AbortSignal.any`, postgres-js and device-auth's `node:crypto`, as in the chat route. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * `/audio/transcriptions` on Groq's Whisper, on the owner's key. The multipart body is forwarded as-is
 * (language, prompt, response_format pass through) once the file and model have been checked.
 */
export function POST(request: Request) {
  return audioGateway(request, async (req) => {
    const form = await req.formData();
    const file = form.get("file");
    const model = form.get("model");
    if (!(file instanceof File) || file.size === 0) {
      return {
        status: 400,
        code: "invalid_request",
        message: "an audio `file` is required",
      };
    }
    if (file.size > AUDIO.maxAudioBytes) {
      return {
        status: 413,
        code: "invalid_request",
        message: `audio exceeds ${AUDIO.maxAudioBytes} bytes`,
      };
    }
    if (
      typeof model !== "string" ||
      !(AUDIO.transcribe.models as readonly string[]).includes(model)
    ) {
      return {
        status: 404,
        code: "model_not_found",
        message: `no transcription model "${typeof model === "string" ? model : ""}"`,
      };
    }
    return {
      upstream: AUDIO.transcribe,
      model,
      path: "/audio/transcriptions",
      body: form,
      costMicros: transcribeCostMicros(file.size),
    };
  });
}
