/** USD per 1M tokens [input, output]. Override or extend with LLM_PRICING_JSON='{"model":[in,out]}'. */
const BUILTIN: Record<string, [number, number]> = {
  "claude-fable-5-2": [8, 40],
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

function table(): Record<string, [number, number]> {
  try {
    return { ...BUILTIN, ...(process.env.LLM_PRICING_JSON ? JSON.parse(process.env.LLM_PRICING_JSON) : {}) };
  } catch {
    return BUILTIN;
  }
}

/** Returns null when the model has no known price (logged as unpriced rather than $0 guesses). */
export function costUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const p = table()[model];
  if (!p) return null;
  return (inputTokens * p[0] + outputTokens * p[1]) / 1_000_000;
}
