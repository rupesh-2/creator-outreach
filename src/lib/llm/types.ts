export interface LlmRequest {
  system: string;
  prompt: string;
  /** JSON Schema the response must conform to (strict: all props required, no extras) */
  schema: Record<string, unknown>;
  schemaName: string;
  maxTokens: number;
  effort?: "low" | "medium" | "high";
}

export interface LlmResponse {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmProvider {
  readonly name: string;
  complete(req: LlmRequest, model: string): Promise<LlmResponse>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** Every provider is out of quota right now. Callers should wait `retryAfterMs`, not count it as a failed attempt. */
export class LlmRateLimited extends LlmError {
  readonly rateLimited = true;
  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message, true);
  }
}
