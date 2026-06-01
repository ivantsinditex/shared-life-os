import { z } from "zod";

import type { AppConfig } from "../../config/config.js";

export type ParsedNaturalPlanningCommand =
  | {
      action: "plan";
      title: string;
      participant: ParsedParticipant;
      category: ParsedCategory;
      start: string;
      durationMinutes: number;
      privacy: ParsedPrivacy;
    }
  | {
      action: "update";
      shortId: string;
      title: string;
      participant: ParsedParticipant;
      category: ParsedCategory;
      start: string;
      durationMinutes: number;
      privacy: ParsedPrivacy;
    }
  | {
      action: "unknown";
      reason: string;
    };

type ParsedParticipant = "vania" | "nastia" | "both";
type ParsedCategory =
  | "sport"
  | "work"
  | "learning"
  | "reading"
  | "dogs"
  | "horse"
  | "care"
  | "together"
  | "other";
type ParsedPrivacy = "private" | "busy_only" | "shared_details";

export type NaturalPlanningParserInput = {
  text: string;
  timezone: string;
  now: string;
};

export interface PlanningTextParserGateway {
  isEnabled(): boolean;
  parse(input: NaturalPlanningParserInput): Promise<ParsedNaturalPlanningCommand>;
}

const parsedResponseSchema = z.object({
  action: z.enum(["plan", "update", "unknown"]),
  short_id: z.string(),
  title: z.string(),
  participant: z.enum(["vania", "nastia", "both", ""]),
  category: z.enum([
    "sport",
    "work",
    "learning",
    "reading",
    "dogs",
    "horse",
    "care",
    "together",
    "other",
    "",
  ]),
  start: z.string(),
  duration_minutes: z.number().int(),
  privacy: z.enum(["private", "busy_only", "shared_details", ""]),
  reason: z.string(),
});

export function createPlanningTextParserGateway(config: AppConfig): PlanningTextParserGateway {
  if (!config.openAiApiKey) {
    return new DisabledPlanningTextParserGateway();
  }

  return new OpenAiPlanningTextParserGateway({
    apiKey: config.openAiApiKey,
    model: config.openAiPlanningModel,
  });
}

class DisabledPlanningTextParserGateway implements PlanningTextParserGateway {
  isEnabled(): boolean {
    return false;
  }

  async parse(): Promise<ParsedNaturalPlanningCommand> {
    return {
      action: "unknown",
      reason: "Natural-language planning is disabled. Set OPENAI_API_KEY to enable it.",
    };
  }
}

class OpenAiPlanningTextParserGateway implements PlanningTextParserGateway {
  constructor(private readonly config: { apiKey: string; model: string }) {}

  isEnabled(): boolean {
    return true;
  }

  async parse(input: NaturalPlanningParserInput): Promise<ParsedNaturalPlanningCommand> {
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
            content: buildSystemPrompt(input.timezone, input.now),
          },
          {
            role: "user",
            content: input.text,
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "planning_command",
            strict: true,
            schema: planningCommandSchema,
          },
        },
      }),
    });

    const payload = (await response.json()) as OpenAiResponsesPayload;

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `OpenAI planning parse failed: ${response.status}`);
    }

    const outputText = extractOutputText(payload);
    const parsed = parsedResponseSchema.parse(JSON.parse(outputText));

    return toDomainParsedCommand(parsed);
  }
}

function buildSystemPrompt(timezone: string, now: string): string {
  return [
    "You convert Ukrainian or English calendar planning text into JSON.",
    "Return only data matching the JSON schema.",
    `Current timezone: ${timezone}. Current local datetime: ${now}.`,
    "Participants: vania means Vania/Ivan/Vanya/мені/мене/Іван/Ваня; nastia means Nastia/Настя; both means together/us/разом/нам.",
    "Categories: sport, work, learning, reading, dogs, horse, care, together, other.",
    "Privacy: busy only/busy/зайнятий -> busy_only; private/приватно -> private; shared details/details/деталі -> shared_details.",
    "Use 24-hour local time formatted as YYYY-MM-DD HH:mm.",
    "If date is omitted but time is present, use the nearest future date.",
    "If duration is omitted, use 60 minutes.",
    "For updates, action must be update only when a short id is explicitly present.",
    "If required planning details are too ambiguous, action must be unknown and reason must explain what is missing.",
  ].join("\n");
}

function extractOutputText(payload: OpenAiResponsesPayload): string {
  const text = payload.output
    ?.flatMap((item) => item.content ?? [])
    .find((content) => content.type === "output_text")?.text;

  if (!text) {
    throw new Error("OpenAI planning parse response did not include output text.");
  }

  return text;
}

function toDomainParsedCommand(
  parsed: z.infer<typeof parsedResponseSchema>,
): ParsedNaturalPlanningCommand {
  if (parsed.action === "unknown") {
    return {
      action: "unknown",
      reason: parsed.reason || "I could not understand the planning request.",
    };
  }

  const common = {
    title: parsed.title,
    participant: parsed.participant as ParsedParticipant,
    category: parsed.category as ParsedCategory,
    start: parsed.start,
    durationMinutes: parsed.duration_minutes,
    privacy: parsed.privacy as ParsedPrivacy,
  };

  if (!common.title || !common.participant || !common.category || !common.start || !common.privacy) {
    return {
      action: "unknown",
      reason: "Required planning details are missing.",
    };
  }

  if (parsed.action === "update") {
    if (!parsed.short_id) {
      return {
        action: "unknown",
        reason: "Update requests need an activity short id.",
      };
    }

    return {
      action: "update",
      shortId: parsed.short_id,
      ...common,
    };
  }

  return {
    action: "plan",
    ...common,
  };
}

const planningCommandSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "action",
    "short_id",
    "title",
    "participant",
    "category",
    "start",
    "duration_minutes",
    "privacy",
    "reason",
  ],
  properties: {
    action: {
      type: "string",
      enum: ["plan", "update", "unknown"],
    },
    short_id: {
      type: "string",
      description: "Activity short id for update requests, otherwise empty.",
    },
    title: {
      type: "string",
      description: "Human readable activity title, otherwise empty.",
    },
    participant: {
      type: "string",
      enum: ["vania", "nastia", "both", ""],
    },
    category: {
      type: "string",
      enum: ["sport", "work", "learning", "reading", "dogs", "horse", "care", "together", "other", ""],
    },
    start: {
      type: "string",
      description: "Local start time in YYYY-MM-DD HH:mm, otherwise empty.",
    },
    duration_minutes: {
      type: "integer",
      description: "Positive duration in minutes, or 0 when unknown.",
    },
    privacy: {
      type: "string",
      enum: ["private", "busy_only", "shared_details", ""],
    },
    reason: {
      type: "string",
      description: "Explanation when action is unknown, otherwise empty.",
    },
  },
} as const;

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
