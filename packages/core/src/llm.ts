import { z } from "zod";
import type {
  LlmClient,
  LlmJsonRequest,
  LlmTextRequest,
  LlmTextResponse
} from "./types.js";

const openAiCompatibleResponseSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.union([
            z.string(),
            z.array(
              z.object({
                type: z.string().optional(),
                text: z.string().optional()
              })
            )
          ])
        })
      })
    )
    .min(1)
});

export interface OpenAICompatibleClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

export interface MockLlmClientOptions {
  textResponse?:
    | string
    | ((request: LlmTextRequest) => Promise<string> | string);
  jsonResponse?:
    | unknown
    | (<T>(request: LlmJsonRequest<T>) => Promise<unknown> | unknown);
}

function stripMarkdownCodeFence(text: string): string {
  const trimmed = text.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/u);
  return fencedMatch ? fencedMatch[1] : trimmed;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/u, "");
}

function extractMessageContent(content: string | Array<{ text?: string }>): string {
  if (typeof content === "string") {
    return content;
  }

  return content.map((part) => part.text ?? "").join("").trim();
}

export class MockLlmClient implements LlmClient {
  public readonly textRequests: LlmTextRequest[] = [];
  public readonly jsonRequests: Array<LlmJsonRequest<unknown>> = [];

  public constructor(private readonly options: MockLlmClientOptions = {}) {}

  public async completeText(request: LlmTextRequest): Promise<LlmTextResponse> {
    this.textRequests.push(request);

    const response =
      typeof this.options.textResponse === "function"
        ? await this.options.textResponse(request)
        : (this.options.textResponse ?? "");

    return {
      text: response,
      model: "mock-llm"
    };
  }

  public async completeJson<T>(request: LlmJsonRequest<T>): Promise<T> {
    this.jsonRequests.push(request as LlmJsonRequest<unknown>);

    if (this.options.jsonResponse !== undefined) {
      const value =
        typeof this.options.jsonResponse === "function"
          ? await this.options.jsonResponse(request)
          : this.options.jsonResponse;

      return request.schema.parse(value);
    }

    const response = await this.completeText(request);
    return request.schema.parse(JSON.parse(stripMarkdownCodeFence(response.text)));
  }
}

export class OpenAICompatibleLlmClient implements LlmClient {
  private readonly fetchImpl: typeof fetch;

  public constructor(private readonly options: OpenAICompatibleClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async completeText(request: LlmTextRequest): Promise<LlmTextResponse> {
    const response = await this.fetchImpl(`${normalizeBaseUrl(this.options.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.options.model,
        messages: [
          ...(request.systemPrompt
            ? [{ role: "system", content: request.systemPrompt }]
            : []),
          { role: "user", content: request.prompt }
        ],
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens
      })
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`LLM request failed with status ${response.status}: ${responseText}`);
    }

    const raw = openAiCompatibleResponseSchema.parse(await response.json());
    const text = extractMessageContent(raw.choices[0].message.content);

    return {
      text,
      model: raw.model ?? this.options.model,
      raw
    };
  }

  public async completeJson<T>(request: LlmJsonRequest<T>): Promise<T> {
    const response = await this.completeText({
      ...request,
      prompt: `${request.prompt}\n\nReturn JSON only. Do not wrap it in markdown code fences.`
    });

    return request.schema.parse(JSON.parse(stripMarkdownCodeFence(response.text)));
  }
}

export function createOpenAICompatibleLlmClientFromEnv(
  env: NodeJS.ProcessEnv = process.env
): OpenAICompatibleLlmClient | undefined {
  const baseUrl = env.REPO_LENS_LLM_BASE_URL;
  const apiKey = env.REPO_LENS_LLM_API_KEY;
  const model = env.REPO_LENS_LLM_MODEL;

  if (!baseUrl || !apiKey || !model) {
    return undefined;
  }

  return new OpenAICompatibleLlmClient({
    baseUrl,
    apiKey,
    model
  });
}
