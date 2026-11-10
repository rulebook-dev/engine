import type { ModelChoice, ProviderId } from "./types";

export type ModelInfo = {
  id: string;
  label: string;
  // USD per 1M tokens
  input: number;
  output: number;
};

export const PROVIDERS: Record<ProviderId, { label: string; company: string; models: ModelInfo[] }> = {
  anthropic: {
    label: "Claude",
    company: "Anthropic",
    models: [
      { id: "claude-sonnet-5", label: "Claude Sonnet 5", input: 2, output: 10 },
      { id: "claude-opus-5-5", label: "Claude Opus 5.5", input: 4, output: 20 },
      { id: "claude-opus-5", label: "Claude Opus 5", input: 5, output: 25 },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", input: 1, output: 5 },
    ],
  },
  openai: {
    label: "ChatGPT",
    company: "OpenAI",
    models: [
      { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", input: 2, output: 10 },
      { id: "gpt-6.1-terra", label: "GPT-6.1 Terra", input: 1, output: 5 },
      { id: "gpt-6-luna", label: "GPT-6 Luna", input: 0.1, output: 0.5 },
    ],
  },
  gemini: {
    label: "Gemini",
    company: "Google",
    models: [
      { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", input: 0.75, output: 3.75 },
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", input: 0.75, output: 3.75 },
      { id: "gemini-4-argon", label: "Gemini 4 Argon", input: 2, output: 10 },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", input: 0.3, output: 2.5 },
    ],
  },
};

export const PROVIDER_IDS: ProviderId[] = ["anthropic", "openai", "gemini"];

export const DEFAULT_MODELS: ModelChoice = {
  anthropic: { enabled: true, model: "claude-sonnet-5" },
  openai: { enabled: true, model: "gpt-6.1-sol" },
  gemini: { enabled: true, model: "gemini-3.6-flash" },
};

// The judge reads answers and scores them. One per provider, used in this order
// depending on which keys are available.
export const JUDGE_MODELS: Record<ProviderId, string> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-6.1-sol",
  gemini: "gemini-3.6-flash",
};

export function modelInfo(provider: ProviderId, model: string): ModelInfo | undefined {
  return PROVIDERS[provider].models.find((m) => m.id === model);
}

export function costOf(provider: ProviderId, model: string, inTok: number, outTok: number): number {
  const m = modelInfo(provider, model);
  if (!m) return 0;
  return (inTok * m.input + outTok * m.output) / 1_000_000;
}

export function modelLabel(provider: ProviderId, model: string): string {
  return modelInfo(provider, model)?.label ?? model;
}
