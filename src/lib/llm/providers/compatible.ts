import OpenAI from "openai";
import { LlmError, LlmRateLimited, type LlmProvider, type LlmRequest, type LlmResponse } from "../types";

/**
 * Free-tier LLM providers that speak the OpenAI Chat Completions API.
 * Order matters for the "free" chain: largest free daily quota first.
 *
 * Free-tier limits as documented (Nov 2026) — check each console, they change:
 * - Cerebras gpt-oss-120b: 1M tokens/day, 5 req/min.
 * - Groq openai/gpt-oss-120b: 200K tokens/day, 8K tokens/min, 1K req/day.
 * - Gemini (AI Studio): Flash-Lite ~500 req/day. Free-tier data may be used for training outside the UK/CH/EEA/EU.
 * - Mistral (La Plateforme "Experiment" tier): ~1 req/s, very high monthly tokens; requires opting in to data training + phone verification.
 * - NVIDIA (build.nvidia.com): ~40 req/min; phone verification.
 * - OpenRouter ":free" models: 50 req/day (1,000/day after a one-time $10 top-up), shared across models.
 */
export interface Endpoint {
  id: "cerebras" | "groq" | "gemini" | "mistral" | "nvidia" | "openrouter" | "custom";
  label: string;
  baseURL: string;
  apiKey: string;
  model: string;
}

const PRESETS = [
  { id: "cerebras", label: "Cerebras", baseURL: "https://api.cerebras.ai/v1", key: "CEREBRAS_API_KEY", modelVar: "CEREBRAS_MODEL", model: "gpt-oss-120b" },
  { id: "groq", label: "Groq", baseURL: "https://api.groq.com/openai/v1", key: "GROQ_API_KEY", modelVar: "GROQ_MODEL", model: "openai/gpt-oss-120b" },
  {
    id: "gemini",
    label: "Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    key: "GEMINI_API_KEY",
    modelVar: "GEMINI_MODEL",
    // Comma-separated = try in order. Flash-Lite has the biggest free daily quota but is often overloaded (503).
    model: "gemini-3.1-flash-lite,gemini-3.5-flash",
  },
  { id: "mistral", label: "Mistral", baseURL: "https://api.mistral.ai/v1", key: "MISTRAL_API_KEY", modelVar: "MISTRAL_MODEL", model: "mistral-small-latest" },
  { id: "nvidia", label: "NVIDIA", baseURL: "https://integrate.api.nvidia.com/v1", key: "NVIDIA_API_KEY", modelVar: "NVIDIA_MODEL", model: "nvidia/nemotron-3.5-super-vl-120b-a12b,nvidia/nemotron-3-ultra-550b-a55b" },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    key: "OPENROUTER_API_KEY",
    modelVar: "OPENROUTER_MODEL",
    model: "openai/gpt-oss-120b:free",
  },
] as const;

export const FREE_KEY_VARS = [...PRESETS.map((p) => p.key), "LLM_API_KEY"];

/** Endpoints with a key configured, in fallback order. `only` restricts to one provider id. */
export function configuredEndpoints(env: Record<string, string | undefined> = process.env, only?: Endpoint["id"]): Endpoint[] {
  // A provider's model setting may list several models ("a,b"): each becomes its own fallback endpoint.
  const list: Endpoint[] = PRESETS.filter((p) => env[p.key]).flatMap((p) => {
    const models = (env[p.modelVar] || p.model).split(",").map((m) => m.trim()).filter(Boolean);
    return models.map((model) => ({
      id: p.id,
      label: models.length > 1 ? `${p.label} (${model})` : p.label,
      baseURL: p.baseURL,
      apiKey: env[p.key] as string,
      model,
    }));
  });
  if (env.LLM_API_KEY && env.LLM_BASE_URL && env.LLM_MODEL)
    list.push({ id: "custom", label: "Custom", baseURL: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL });
  return only ? list.filter((e) => e.id === only) : list;
}

// Process-local memory so a rate-limited or JSON-schema-incapable endpoint is skipped quickly on later calls.
const cooldownUntil = new Map<string, number>();
const noStrictSchema = new Set<string>();
const keyOf = (e: Endpoint) => `${e.id}:${e.model}`;

const DEFAULT_COOLDOWN_MS = 60_000;
/** Free tiers count max output tokens against per-minute budgets (Groq: 8K TPM), so keep requests modest. */
const MAX_OUTPUT_TOKENS = 4_000;

export class CompatibleProvider implements LlmProvider {
  readonly name: string;

  constructor(
    private endpoints: Endpoint[],
    name = "free",
    private fetchImpl?: typeof fetch,
  ) {
    this.name = name;
  }

  /** The Settings model is ignored: each endpoint uses its own model (env override or preset default). */
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const now = Date.now();
    const ready = this.endpoints.filter((e) => (cooldownUntil.get(keyOf(e)) ?? 0) <= now);
    if (!ready.length) {
      // Everything is rate limited: don't spend a request just to get another 429.
      const wait = Math.min(...this.endpoints.map((ep) => (cooldownUntil.get(keyOf(ep)) ?? 0) - now));
      throw new LlmRateLimited(`Free LLM quota reached — all providers cooling down (${this.endpoints.map((e) => e.label).join(", ")})`, Math.max(wait, 5_000));
    }
    const order = ready;
    const errors: string[] = [];
    let retryable = false;
    let allRateLimited = true;

    for (const ep of order) {
      try {
        return await this.call(ep, req);
      } catch (e) {
        const { message, status, retryAfterMs } = describe(e);
        errors.push(`${ep.label}: ${message}`);
        const transient = status === 429 || status === 413 || (status !== undefined && status >= 500) || e instanceof OpenAI.APIConnectionError;
        if (transient) {
          retryable = true;
          cooldownUntil.set(keyOf(ep), Date.now() + (retryAfterMs ?? DEFAULT_COOLDOWN_MS));
        }
        if (status !== 429 && status !== 413) allRateLimited = false;
        if (e instanceof LlmError && e.retryable) retryable = true;
      }
    }
    if (allRateLimited && errors.length) {
      const wait = Math.max(...order.map((ep) => (cooldownUntil.get(keyOf(ep)) ?? 0) - Date.now()));
      throw new LlmRateLimited(`Free LLM quota reached — ${errors.join(" | ")}`.slice(0, 900), Math.max(wait, DEFAULT_COOLDOWN_MS));
    }
    throw new LlmError(`All free LLM providers failed — ${errors.join(" | ")}`.slice(0, 900), retryable);
  }

  private client(ep: Endpoint) {
    return new OpenAI({ apiKey: ep.apiKey, baseURL: ep.baseURL, maxRetries: 0, timeout: 120_000, ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}) });
  }

  private async call(ep: Endpoint, req: LlmRequest): Promise<LlmResponse> {
    const client = this.client(ep);
    const strictKey = `${ep.id}:${ep.model}`;
    const reasoning = /gpt-oss|qwen-?3/i.test(ep.model) ? { reasoning_effort: "low" as const } : {};
    const base = {
      model: ep.model,
      max_completion_tokens: Math.min(req.maxTokens, MAX_OUTPUT_TOKENS),
      ...reasoning,
    };

    let res: OpenAI.Chat.Completions.ChatCompletion;
    if (!noStrictSchema.has(strictKey)) {
      try {
        res = await client.chat.completions.create({
          ...base,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.prompt },
          ],
          response_format: { type: "json_schema", json_schema: { name: req.schemaName, schema: req.schema, strict: true } },
        });
        return toResponse(res, ep);
      } catch (e) {
        // Model/endpoint doesn't do strict schemas → fall back to JSON mode with the schema in the prompt.
        if (!(e instanceof OpenAI.BadRequestError) || !/response_format|json_schema|schema|structured/i.test(e.message)) throw e;
        noStrictSchema.add(strictKey);
      }
    }
    res = await client.chat.completions.create({
      ...base,
      messages: [
        {
          role: "system",
          content: `${req.system}\n\nRespond with a single JSON object only (no prose, no code fences) that validates against this JSON Schema:\n${JSON.stringify(req.schema)}`,
        },
        { role: "user", content: req.prompt },
      ],
      response_format: { type: "json_object" },
    });
    return toResponse(res, ep);
  }
}

function toResponse(res: OpenAI.Chat.Completions.ChatCompletion, ep: Endpoint): LlmResponse {
  const choice = res.choices?.[0];
  if (choice?.finish_reason === "length") throw new LlmError(`${ep.label} hit the output token limit`, true);
  const text = stripFences(choice?.message?.content ?? "");
  if (!text) throw new LlmError(`${ep.label} returned an empty response`, true);
  return {
    text,
    model: `${ep.id}/${res.model || ep.model}`,
    inputTokens: res.usage?.prompt_tokens ?? 0,
    outputTokens: res.usage?.completion_tokens ?? 0,
  };
}

export function stripFences(s: string): string {
  const t = s.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1] : t;
}

function describe(e: unknown): { message: string; status?: number; retryAfterMs?: number } {
  if (e instanceof OpenAI.APIError) {
    const ra = Number(e.headers?.get?.("retry-after"));
    return { message: `${e.status ?? ""} ${e.message}`.trim().slice(0, 200), status: e.status, retryAfterMs: Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined };
  }
  if (e instanceof LlmError) return { message: e.message };
  return { message: String((e as Error)?.message ?? e).slice(0, 200) };
}

/** Test hook. */
export function _resetCompatibleState() {
  cooldownUntil.clear();
  noStrictSchema.clear();
}
