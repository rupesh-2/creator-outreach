import { beforeEach, describe, expect, it } from "vitest";
import { CompatibleProvider, _resetCompatibleState, configuredEndpoints, stripFences, type Endpoint } from "./providers/compatible";
import { LlmError, type LlmRequest } from "./types";

const req: LlmRequest = {
  system: "sys",
  prompt: "hi",
  schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
  schemaName: "t",
  maxTokens: 8000,
};

const ep = (id: Endpoint["id"], baseURL = `https://${id}.test/v1`): Endpoint => ({ id, label: id, baseURL, apiKey: "k", model: `${id}-model` });

type Call = { url: string; body: Record<string, unknown> };

/** Fake fetch: `handler` decides the response per call. */
function fakeFetch(handler: (c: Call) => { status: number; json: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const c = { url: String(input), body: JSON.parse(String(init?.body ?? "{}")) };
    calls.push(c);
    const r = handler(c);
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  }) as typeof fetch;
  return { fn, calls };
}

const ok = (content: string, model = "m") => ({
  status: 200,
  json: { id: "x", object: "chat.completion", created: 0, model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 12, completion_tokens: 3 } },
});
const err = (status: number, message: string) => ({ status, json: { error: { message } } });

beforeEach(() => _resetCompatibleState());

describe("CompatibleProvider", () => {
  it("sends a strict json_schema request and returns usage", async () => {
    const f = fakeFetch(() => ok('{"ok":true}'));
    const r = await new CompatibleProvider([ep("groq")], "free", f.fn).complete(req);
    expect(r).toMatchObject({ text: '{"ok":true}', inputTokens: 12, outputTokens: 3, model: "groq/m" });
    const body = f.calls[0].body;
    expect(body.model).toBe("groq-model");
    expect((body.response_format as { type: string }).type).toBe("json_schema");
    expect(body.max_completion_tokens).toBe(4000);
  });

  it("falls over to the next provider on 429 and remembers the cooldown", async () => {
    const f = fakeFetch((c) => (c.url.includes("cerebras") ? err(429, "rate limited") : ok('{"ok":true}')));
    const p = new CompatibleProvider([ep("cerebras"), ep("groq")], "free", f.fn);
    expect((await p.complete(req)).model).toBe("groq/m");
    await p.complete(req);
    expect(f.calls.filter((c) => c.url.includes("cerebras"))).toHaveLength(1); // skipped while cooling down
  });

  it("retries in JSON mode when strict schemas are unsupported", async () => {
    const f = fakeFetch((c) =>
      (c.body.response_format as { type: string }).type === "json_schema" ? err(400, "response_format json_schema is not supported for this model") : ok('```json\n{"ok":true}\n```'),
    );
    const r = await new CompatibleProvider([ep("gemini")], "free", f.fn).complete(req);
    expect(r.text).toBe('{"ok":true}');
    expect(f.calls[1].body.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: "system", content: expect.stringContaining("JSON Schema") })]));
  });

  it("throws a retryable error when every provider is rate limited", async () => {
    const f = fakeFetch(() => err(429, "slow down"));
    const e = await new CompatibleProvider([ep("cerebras"), ep("groq")], "free", f.fn).complete(req).catch((x) => x);
    expect(e).toBeInstanceOf(LlmError);
    expect(e.retryable).toBe(true);
    expect(e.message).toMatch(/cerebras: 429.*groq: 429/);
  });

  it("does not retry when keys are rejected", async () => {
    const f = fakeFetch(() => err(401, "invalid api key"));
    const e = await new CompatibleProvider([ep("groq")], "free", f.fn).complete(req).catch((x) => x);
    expect(e.retryable).toBe(false);
  });
});

describe("configuredEndpoints", () => {
  it("orders by preset, applies model overrides, and needs all three custom vars", () => {
    const eps = configuredEndpoints({ GROQ_API_KEY: "g", CEREBRAS_API_KEY: "c", GROQ_MODEL: "openai/gpt-oss-20b", LLM_API_KEY: "x", LLM_BASE_URL: "https://x/v1" });
    expect(eps.map((e) => `${e.id}:${e.model}`)).toEqual(["cerebras:gpt-oss-120b", "groq:openai/gpt-oss-20b"]);
    expect(configuredEndpoints({ GROQ_API_KEY: "g", CEREBRAS_API_KEY: "c" }, "groq").map((e) => e.id)).toEqual(["groq"]);
  });

  it("strips code fences", () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFences(' {"a":1} ')).toBe('{"a":1}');
  });
});
