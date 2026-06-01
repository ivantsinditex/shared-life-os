import { z } from "zod";

import type { AppConfig } from "../../config/config.js";

export interface AnalyticsInsightsGateway {
  isEnabled(): boolean;
  generate(input: { report: string; languageHint?: string }): Promise<string | undefined>;
}

const insightResponseSchema = z.object({
  insight: z.string(),
});

export function createAnalyticsInsightsGateway(config: AppConfig): AnalyticsInsightsGateway {
  if (!config.openAiApiKey) {
    return new DisabledAnalyticsInsightsGateway();
  }

  return new OpenAiAnalyticsInsightsGateway({
    apiKey: config.openAiApiKey,
    model: config.openAiPlanningModel,
  });
}

class DisabledAnalyticsInsightsGateway implements AnalyticsInsightsGateway {
  isEnabled(): boolean {
    return false;
  }

  async generate(): Promise<string | undefined> {
    return undefined;
  }
}

class OpenAiAnalyticsInsightsGateway implements AnalyticsInsightsGateway {
  constructor(private readonly config: { apiKey: string; model: string }) {}

  isEnabled(): boolean {
    return true;
  }

  async generate(input: { report: string; languageHint?: string }): Promise<string | undefined> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.model,
        input: [
          {
            role: "system",
            content: [
              "You are an analytics coach for a couple using a shared life planning system.",
              "Read the report and return a short, practical interpretation.",
              "Focus on patterns, risks, and one or two concrete next actions.",
              "Do not invent data that is not in the report.",
              "Use Ukrainian unless the report is clearly English-only.",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              language_hint: input.languageHint ?? "uk",
              report: input.report,
            }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "analytics_insight",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["insight"],
              properties: {
                insight: { type: "string" },
              },
            },
          },
        },
      }),
    });

    const payload = (await response.json()) as OpenAiResponsesPayload;

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `OpenAI analytics insight failed: ${response.status}`);
    }

    const outputText = payload.output
      ?.flatMap((item) => item.content ?? [])
      .find((content) => content.type === "output_text")?.text;

    if (!outputText) {
      throw new Error("OpenAI analytics insight response did not include output text.");
    }

    return insightResponseSchema.parse(JSON.parse(outputText)).insight.trim();
  }
}

type OpenAiResponsesPayload = {
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};
