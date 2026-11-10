import Anthropic from "@anthropic-ai/sdk";
import type { ProviderId } from "./types";

export type Completion = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

export type CallOptions = {
  provider: ProviderId;
  model: string;
  apiKey: string;
  system: string;
  user: string;
  maxTokens?: number;
  // When set, the model must reply with JSON matching this schema.
  jsonSchema?: { name: string; schema: Record<string, unknown> };
};

export class ProviderError extends Error {
  constructor(public provider: ProviderId, message: string) {
    super(message);
  }
}

export async function complete(opts: CallOptions): Promise<Completion> {
  const started = Date.now();
  try {
    const out =
      opts.provider === "anthropic"
        ? await callAnthropic(opts)
        : opts.provider === "openai"
          ? await callOpenAI(opts)
          : await callGemini(opts);
    return { ...out, latencyMs: Date.now() - started };
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError(opts.provider, (e as Error).message);
  }
}

async function callAnthropic(opts: CallOptions) {
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 2, timeout: REQUEST_TIMEOUT_MS });
  try {
    const response = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 8000,
      system: opts.system || undefined,
      messages: [{ role: "user", content: opts.user }],
      ...(opts.jsonSchema
        ? { output_config: { format: { type: "json_schema" as const, schema: opts.jsonSchema.schema } } }
        : {}),
    });
    if (response.stop_reason === "refusal") {
      throw new ProviderError("anthropic", "Claude declined to answer this situation.");
    }
    const text = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    return {
      text,
      inputTokens:
        response.usage.input_tokens +
        (response.usage.cache_read_input_tokens ?? 0) +
        (response.usage.cache_creation_input_tokens ?? 0),
      outputTokens: response.usage.output_tokens,
    };
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new ProviderError("anthropic", "Claude API key was rejected.");
    if (e instanceof Anthropic.RateLimitError) throw new ProviderError("anthropic", "Claude rate limit hit. Try again in a minute.");
    if (e instanceof Anthropic.APIConnectionTimeoutError) {
      throw new ProviderError("anthropic", `No answer after ${REQUEST_TIMEOUT_MS / 1000} seconds. Try a different model with --model.`);
    }
    if (e instanceof Anthropic.APIError) {
      // e.error is the parsed response body: { type, error: { type, message } }
      const detail = (e.error as { error?: { message?: string } } | undefined)?.error?.message ?? e.message;
      if (/credit balance/i.test(detail)) {
        throw new ProviderError("anthropic", "This Claude key has no credit. Add credit at console.anthropic.com.");
      }
      throw new ProviderError("anthropic", `Claude error ${e.status}: ${detail}`);
    }
    throw new ProviderError("anthropic", `Could not reach Claude: ${(e as Error).message}`);
  }
}

type OpenAIResponse = {
  output?: { type: string; content?: { type: string; text?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
};

async function callOpenAI(opts: CallOptions) {
  const res = await fetchWithRetry("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({
      model: opts.model,
      instructions: opts.system || undefined,
      input: opts.user,
      max_output_tokens: opts.maxTokens ?? 8000,
      ...(opts.jsonSchema
        ? { text: { format: { type: "json_schema", name: opts.jsonSchema.name, schema: opts.jsonSchema.schema, strict: true } } }
        : {}),
    }),
  });
  const body = (await res.json().catch(() => ({}))) as OpenAIResponse;
  if (!res.ok) {
    if (res.status === 401) throw new ProviderError("openai", "ChatGPT API key was rejected.");
    if (res.status === 429 && body.error?.message && /credit|quota|billing/i.test(body.error.message)) {
      throw new ProviderError("openai", "This ChatGPT key has no credit. Add credit at platform.openai.com.");
    }
    throw new ProviderError("openai", `ChatGPT error ${res.status}: ${body.error?.message ?? res.statusText}`);
  }
  const text = (body.output ?? [])
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .map((c) => (c.type === "output_text" ? (c.text ?? "") : ""))
    .join("")
    .trim();
  return { text, inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 };
}

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  error?: { message?: string };
};

async function callGemini(opts: CallOptions) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`;
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": opts.apiKey },
    body: JSON.stringify({
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      contents: [{ role: "user", parts: [{ text: opts.user }] }],
      generationConfig: {
        maxOutputTokens: opts.maxTokens ?? 8000,
        ...(opts.jsonSchema ? { responseMimeType: "application/json", responseJsonSchema: opts.jsonSchema.schema } : {}),
      },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (!res.ok) {
    if (res.status === 400 && /api key/i.test(body.error?.message ?? "")) {
      throw new ProviderError("gemini", "Gemini API key was rejected.");
    }
    if (res.status === 429) {
      const limit = limitFrom(body as ErrorBody, res.headers);
      throw new ProviderError(
        "gemini",
        limit.daily
          ? "Gemini's daily limit for this key is used up. It resets tomorrow, or turn on billing in Google AI Studio for more."
          : limit.outOfCredit
            ? "This Gemini key is out of quota. Check its billing in Google AI Studio."
            : "Gemini is busy (too many requests per minute). Try again in a minute.",
      );
    }
    throw new ProviderError("gemini", `Gemini error ${res.status}: ${body.error?.message ?? res.statusText}`);
  }
  const candidate = body.candidates?.[0];
  if (!candidate?.content) {
    throw new ProviderError("gemini", `Gemini returned no answer (${candidate?.finishReason ?? "blocked"}).`);
  }
  const text = (candidate.content.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  const u = body.usageMetadata ?? {};
  return {
    text,
    inputTokens: u.promptTokenCount ?? 0,
    // Thinking tokens are billed as output.
    outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
  };
}

const REQUEST_TIMEOUT_MS = 90_000;

// The longest we wait when a provider says "try again in N seconds".
const MAX_RETRY_WAIT_MS = 40_000;

// Retries rate limits, server errors and dropped connections with backoff, waiting as long
// as the provider asks when it says so.
// A timeout is not retried: a model that hung once will usually hang again.
// An "out of credit" 429 is not retried either: it won't fix itself.
async function fetchWithRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  let last: Response | undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      last = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (e) {
      if ((e as Error).name === "TimeoutError") {
        throw new Error(`No answer after ${REQUEST_TIMEOUT_MS / 1000} seconds. Try a different model with --model.`);
      }
      if (i === attempts - 1) throw e;
      await sleep(1000 * 2 ** i);
      continue;
    }
    if (last.status !== 429 && last.status < 500) return last;
    const limit =
      last.status === 429 ? limitFrom((await last.clone().json().catch(() => ({}))) as ErrorBody, last.headers) : null;
    if (limit?.outOfCredit) return last;
    if (i === attempts - 1) break;
    const wait = limit?.retryAfterMs ?? 1000 * 2 ** i + Math.random() * 500;
    if (wait > MAX_RETRY_WAIT_MS) return last;
    await sleep(wait);
  }
  return last!;
}

type ErrorBody = {
  error?: {
    code?: string | number;
    message?: string;
    details?: { "@type"?: string; retryDelay?: string; violations?: { quotaId?: string }[] }[];
  };
};

// Tells a temporary limit ("wait 24s", per-minute quotas) apart from an account that is out
// of credit or past a daily cap. Both come back as 429 and often both say "quota".
function limitFrom(body: ErrorBody, headers: Headers): { outOfCredit: boolean; daily: boolean; retryAfterMs: number | null } {
  const e = body.error ?? {};
  const message = e.message ?? "";
  const header = Number(headers.get("retry-after"));
  const delay = e.details?.find((d) => d.retryDelay)?.retryDelay ?? message.match(/retry in ([\d.]+)\s*s/i)?.[1];
  const retryAfterMs = header > 0 ? header * 1000 : delay ? Math.ceil(parseFloat(delay) * 1000) : null;
  const quotaIds = (e.details ?? []).flatMap((d) => d.violations ?? []).map((v) => v.quotaId ?? "");
  const daily = quotaIds.some((q) => /PerDay/i.test(q));
  // A provider that says when to retry means it's temporary, even if the message also
  // mentions billing (Gemini's per-minute limit does).
  const outOfCredit =
    e.code === "insufficient_quota" || daily || (retryAfterMs == null && /credit|billing|quota/i.test(message));
  return { outOfCredit, daily, retryAfterMs };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
