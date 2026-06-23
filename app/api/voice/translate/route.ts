import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

const groqAudioTranscriptionsUrl = "https://api.groq.com/openai/v1/audio/transcriptions";
const openAiAudioTranscriptionsUrl = "https://api.openai.com/v1/audio/transcriptions";
const maxAudioBytes = 25 * 1024 * 1024;

function errorMessage(data: unknown, fallback: string) {
  if (
    data &&
    typeof data === "object" &&
    "error" in data &&
    data.error &&
    typeof data.error === "object" &&
    "message" in data.error &&
    typeof data.error.message === "string"
  ) {
    return data.error.message;
  }

  return fallback;
}

async function transcribeAudio(file: File, apiKey: string, endpoint: string, model: string) {
  const outboundForm = new FormData();
  outboundForm.set("model", model);
  outboundForm.set("file", file, file.name || "voice.webm");
  outboundForm.set("response_format", "json");

  return fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: outboundForm,
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const groqApiKey = process.env.GROQ_API_KEY;
  const openAiApiKey = process.env.OPENAI_API_KEY;

  if (!groqApiKey && !openAiApiKey) {
    return Response.json({ error: "Missing GROQ_API_KEY or OPENAI_API_KEY" }, { status: 500 });
  }

  const inboundForm = await req.formData();
  const file = inboundForm.get("audio");

  if (!(file instanceof File)) {
    return Response.json({ error: "Audio file is required" }, { status: 400 });
  }

  if (file.size > maxAudioBytes) {
    return Response.json({ error: "Audio file is larger than the 25 MB limit" }, { status: 413 });
  }

  const providers = [
    groqApiKey
      ? {
          endpoint: groqAudioTranscriptionsUrl,
          apiKey: groqApiKey,
          model: "whisper-large-v3-turbo",
          label: "Groq",
        }
      : null,
    openAiApiKey
      ? {
          endpoint: openAiAudioTranscriptionsUrl,
          apiKey: openAiApiKey,
          model: "whisper-1",
          label: "OpenAI",
        }
      : null,
  ].filter(Boolean) as Array<{
    endpoint: string;
    apiKey: string;
    model: string;
    label: string;
  }>;

  let lastError = "Voice transcription failed";

  for (const provider of providers) {
    const response = await transcribeAudio(file, provider.apiKey, provider.endpoint, provider.model);
    const data = await response.json().catch(() => ({}));

    if (response.ok) {
      return Response.json({ text: typeof data.text === "string" ? data.text : "" });
    }

    lastError = errorMessage(data, `${provider.label} voice transcription failed with ${response.status}`);

    const quotaExceeded =
      response.status === 429 ||
      (typeof lastError === "string" && /quota|billing|insufficient/i.test(lastError));

    if (!quotaExceeded) {
      return Response.json({ error: lastError }, { status: response.status });
    }
  }

  return Response.json({ error: lastError }, { status: 429 });
}
