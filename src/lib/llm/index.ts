import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { env } from "@/lib/env";
import { costUsd } from "./pricing";
import { AnthropicProvider } from "./providers/anthropic";
import { CompatibleProvider, configuredEndpoints, FREE_KEY_VARS, type Endpoint } from "./providers/compatible";
import { OpenAIProvider } from "./providers/openai";
import { toStrictJsonSchema } from "./schema";
import { LlmError, type LlmProvider } from "./types";

export { LlmError };

export function getProvider(name: string): LlmProvider {
  switch (name) {
    case "anthropic": {
      const k = env.anthropicKey();
      if (!k) throw new LlmError("ANTHROPIC_API_KEY is not set", false);
      return new AnthropicProvider(k);
    }
    case "openai": {
      const k = env.openaiKey();
      if (!k) throw new LlmError("OPENAI_API_KEY is not set", false);
      return new OpenAIProvider(k);
    }
    case "free": {
      const eps = configuredEndpoints();
      if (!eps.length) throw new LlmError(`${FREE_KEY_VARS.join(" / ")} is not set`, false);
      return new CompatibleProvider(eps, "free");
    }
    case "cerebras":
    case "groq":
    case "gemini":
    case "openrouter":
    case "custom": {
      const eps = configuredEndpoints(process.env, name as Endpoint["id"]);
      const keyVar = name === "custom" ? "LLM_API_KEY + LLM_BASE_URL + LLM_MODEL" : `${name.toUpperCase()}_API_KEY`;
      if (!eps.length) throw new LlmError(`${keyVar} is not set`, false);
      return new CompatibleProvider(eps, name);
    }
    default:
      throw new LlmError(`Unknown LLM provider "${name}"`, false);
  }
}

export interface GenerateJsonArgs<T extends z.ZodType> {
  db: SupabaseClient;
  ownerId: string;
  task: string;
  provider: string;
  model: string;
  system: string;
  prompt: string;
  schema: T;
  schemaName: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  /** set false to force a fresh generation */
  useCache?: boolean;
}

/**
 * Structured generation with: response cache, retry on transient errors and on
 * invalid JSON, zod validation, and a usage/cost row per call.
 */
export async function generateJson<T extends z.ZodType>(a: GenerateJsonArgs<T>): Promise<{ data: z.infer<T>; cached: boolean; model: string }> {
  const jsonSchema = toStrictJsonSchema(a.schema);
  const key = createHash("sha256")
    .update(JSON.stringify([a.provider, a.model, a.system, a.prompt, jsonSchema]))
    .digest("hex");

  if (a.useCache !== false) {
    const { data: hit } = await a.db.from("llm_cache").select("response").eq("key", key).eq("owner_id", a.ownerId).maybeSingle();
    if (hit) {
      const parsed = a.schema.safeParse(hit.response);
      if (parsed.success) {
        await a.db.from("llm_usage").insert({ owner_id: a.ownerId, task: a.task, provider: a.provider, model: a.model, cache_hit: true });
        return { data: parsed.data, cached: true, model: a.model };
      }
    }
  }

  const provider = getProvider(a.provider);
  const started = Date.now();
  let inTok = 0;
  let outTok = 0;
  let attempts = 0;
  let lastErr: unknown;

  for (attempts = 1; attempts <= 3; attempts++) {
    try {
      const res = await provider.complete(
        { system: a.system, prompt: a.prompt, schema: jsonSchema, schemaName: a.schemaName, maxTokens: a.maxTokens ?? 16000, effort: a.effort },
        a.model,
      );
      inTok += res.inputTokens;
      outTok += res.outputTokens;
      let json: unknown;
      try {
        json = JSON.parse(res.text);
      } catch {
        throw new LlmError("Model returned invalid JSON", true);
      }
      const parsed = a.schema.safeParse(json);
      if (!parsed.success) throw new LlmError(`Schema validation failed: ${parsed.error.message.slice(0, 300)}`, true);

      await a.db.from("llm_usage").insert({
        owner_id: a.ownerId, task: a.task, provider: a.provider, model: res.model,
        input_tokens: inTok, output_tokens: outTok, cost_usd: costUsd(a.model, inTok, outTok) ?? 0,
        latency_ms: Date.now() - started, attempts,
      });
      await a.db.from("llm_cache").upsert({ key, owner_id: a.ownerId, response: parsed.data });
      return { data: parsed.data, cached: false, model: res.model };
    } catch (e) {
      lastErr = e;
      // Quota exhaustion: hand back to the job queue to wait, instead of hammering the provider.
      const retryable = e instanceof LlmError && e.retryable && !(e as { rateLimited?: boolean }).rateLimited;
      if (!retryable || attempts === 3) break;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempts));
    }
  }

  await a.db.from("llm_usage").insert({
    owner_id: a.ownerId, task: a.task, provider: a.provider, model: a.model,
    input_tokens: inTok, output_tokens: outTok, cost_usd: costUsd(a.model, inTok, outTok) ?? 0,
    latency_ms: Date.now() - started, attempts: Math.min(attempts, 3), error: String((lastErr as Error)?.message ?? lastErr).slice(0, 500),
  });
  throw lastErr;
}
