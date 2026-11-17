import OpenAI from "openai";
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "../types";

export class OpenAIProvider implements LlmProvider {
  readonly name = "openai";
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey, maxRetries: 3, timeout: 120_000 });
  }

  async complete(req: LlmRequest, model: string): Promise<LlmResponse> {
    try {
      const res = await this.client.responses.create({
        model,
        instructions: req.system,
        input: req.prompt,
        max_output_tokens: req.maxTokens,
        text: { format: { type: "json_schema", name: req.schemaName, schema: req.schema, strict: true } },
      });
      if (res.status === "incomplete") throw new LlmError(`OpenAI response incomplete: ${res.incomplete_details?.reason}`, false);
      return {
        text: res.output_text,
        model: res.model,
        inputTokens: res.usage?.input_tokens ?? 0,
        outputTokens: res.usage?.output_tokens ?? 0,
      };
    } catch (e) {
      if (e instanceof LlmError) throw e;
      if (e instanceof OpenAI.RateLimitError || e instanceof OpenAI.InternalServerError || e instanceof OpenAI.APIConnectionError)
        throw new LlmError(`OpenAI: ${e.message}`, true);
      if (e instanceof OpenAI.APIError) throw new LlmError(`OpenAI ${e.status}: ${e.message}`, false);
      throw e;
    }
  }
}
