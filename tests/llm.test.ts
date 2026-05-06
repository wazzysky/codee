import { describe, expect, it, vi } from "vitest";
import {
  MockLlmClient,
  OpenAICompatibleLlmClient
} from "../packages/core/src/index";

describe("LLM adapters", () => {
  it("MockLlmClient returns configured text and JSON responses", async () => {
    const client = new MockLlmClient({
      textResponse: "mock text",
      jsonResponse: {
        summary: "demo"
      }
    });

    await expect(
      client.completeText({
        prompt: "hello"
      })
    ).resolves.toEqual(
      expect.objectContaining({
        model: "mock-llm",
        text: "mock text"
      })
    );

    await expect(
      client.completeJson({
        prompt: "json",
        schema: {
          parse: (input: unknown) => input as { summary: string }
        }
      })
    ).resolves.toEqual({
      summary: "demo"
    });

    expect(client.textRequests).toHaveLength(1);
    expect(client.jsonRequests).toHaveLength(1);
  });

  it("OpenAICompatibleLlmClient validates JSON responses with zod", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          model: "demo-model",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ok: true,
                  value: 42
                })
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    });

    const client = new OpenAICompatibleLlmClient({
      baseUrl: "https://example.com/v1",
      apiKey: "test-key",
      model: "demo-model",
      fetchImpl: fetchImpl as typeof fetch
    });

    await expect(
      client.completeJson({
        prompt: "Return JSON",
        schema: {
          parse: (input: unknown) => input as { ok: boolean; value: number }
        }
      })
    ).resolves.toEqual({
      ok: true,
      value: 42
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
