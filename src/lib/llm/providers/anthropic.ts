import Anthropic from "@anthropic-ai/sdk";
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "../types";

// Models that support the server-side refusal fallback.
const FALLBACK_MODELS = new Set(["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(apiKey: string) {
    // SDK retries 408/409/429/5xx and connection errors with backoff.
    this.client = new Anthropic({ apiKey, maxRetries: 3, timeout: 120_000 });
  }

  async complete(req: LlmRequest, model: string): Promise<LlmResponse> {
    const fallback = FALLBACK_MODELS.has(model);
    try {
      const res = await this.client.beta.messages.create({
        model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: req.prompt }],
        output_config: {
          format: { type: "json_schema", schema: req.schema },
          ...(req.effort ? { effort: req.effort } : {}),
        },
        ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });

      if (res.stop_reason === "refusal") throw new LlmError("Model declined the request (refusal).", false);
      if (res.stop_reason === "max_tokens") throw new LlmError("Response truncated (max_tokens). Increase the limit.", false);

      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      return { text, model: res.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
    } catch (e) {
      if (e instanceof LlmError) throw e;
      if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError)
        throw new LlmError(`Anthropic: ${e.message}`, true);
      if (e instanceof Anthropic.APIError) throw new LlmError(`Anthropic ${e.status}: ${e.message}`, false);
      throw e;
    }
  }
}
