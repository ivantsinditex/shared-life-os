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
      action: "needs_clarification";
      draft: ParsedPlanningDraft;
      missingFields: ParsedPlanningMissingField[];
      question: string;
    }
  | {
      action: "list";
      scope: ParsedPlanningScope;
    }
  | {
      action: "delete_many";
      scope: ParsedPlanningScope;
      keepRules: ParsedPlanningKeepRule[];
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
export type ParsedPlanningMissingField =
  | "title"
  | "participant"
  | "category"
  | "start"
  | "duration"
  | "privacy";

export type ParsedPlanningDraft = {
  title?: string;
  participant?: ParsedParticipant;
  category?: ParsedCategory;
  start?: string;
  durationMinutes?: number;
  privacy?: ParsedPrivacy;
};

export type ParsedPlanningScope = {
  startsAt: string;
  endsAt: string;
  participant?: ParsedParticipant;
  category?: ParsedCategory;
  titleContains?: string;
};

export type ParsedPlanningKeepRule = {
  count: number;
  participant?: ParsedParticipant;
  category?: ParsedCategory;
  titleContains?: string;
  startTime?: string;
};

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
  action: z.enum(["plan", "update", "needs_clarification", "list", "delete_many", "unknown"]),
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
  scope_start: z.string(),
  scope_end: z.string(),
  scope_participant: z.enum(["vania", "nastia", "both", ""]),
  scope_category: z.enum([
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
  scope_title_contains: z.string(),
  keep_rules: z.array(
    z.object({
      count: z.number().int(),
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
      title_contains: z.string(),
      start_time: z.string(),
    }),
  ),
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
    "If privacy is omitted for a plan, use busy_only by default.",
    "Yoga, workout, gym, run, йога, воркаут, зал, пробіжка are sport.",
    "If the user says me/my/мені/моє/мого, use participant vania.",
    "Use 24-hour local time formatted as YYYY-MM-DD HH:mm.",
    "If date is omitted but time is present, use the nearest future date.",
    "If duration is omitted, use 60 minutes.",
    "For updates, action must be update only when a short id is explicitly present.",
    "For list or delete_many, scope_start and scope_end must describe the requested local time window.",
    "For 'today', use today's 00:00 through tomorrow's 00:00. For 'this week', use the local Monday 00:00 through next Monday 00:00.",
    "For delete_many phrases with exceptions, put each exception into keep_rules.",
    "For 'except one workout', create one keep rule with count 1 and title_contains workout or category sport when appropriate.",
    "For 'except Nastia yoga and one workout at 18', create two keep rules: one for Nastia yoga, one for workout with start_time 18:00.",
    "Use start_time only when the user names a time for the exception. Format it as HH:mm.",
    "Use delete_many only for deletion requests. The application will ask for confirmation before deleting.",
    "If a plan is likely but title, participant, category, start, duration, or privacy cannot be inferred, use action needs_clarification and fill every draft field you can infer.",
    "For needs_clarification, reason should stay empty and question should ask one concise question.",
    "Use unknown only when the text is not a calendar planning/list/delete/update request.",
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

  if (parsed.action === "needs_clarification") {
    const draft = toPlanningDraft(parsed);
    const missingFields = getMissingFields(draft);

    return {
      action: "needs_clarification",
      draft,
      missingFields,
      question: parsed.reason || `I need ${missingFields.join(", ")} to finish this plan.`,
    };
  }

  if (parsed.action === "list" || parsed.action === "delete_many") {
    if (!parsed.scope_start || !parsed.scope_end) {
      return {
        action: "unknown",
        reason: "List and delete requests need a date range.",
      };
    }

    const scope: ParsedPlanningScope = {
      startsAt: parsed.scope_start,
      endsAt: parsed.scope_end,
      participant: emptyToUndefined(parsed.scope_participant) as ParsedParticipant | undefined,
      category: emptyToUndefined(parsed.scope_category) as ParsedCategory | undefined,
      titleContains: emptyToUndefined(parsed.scope_title_contains),
    };

    if (parsed.action === "list") {
      return {
        action: "list",
        scope,
      };
    }

    return {
      action: "delete_many",
      scope,
      keepRules: parsed.keep_rules.map((rule) => ({
        count: rule.count,
        participant: emptyToUndefined(rule.participant) as ParsedParticipant | undefined,
        category: emptyToUndefined(rule.category) as ParsedCategory | undefined,
        titleContains: emptyToUndefined(rule.title_contains),
        startTime: emptyToUndefined(rule.start_time),
      })),
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
      const draft = toPlanningDraft(parsed);
      const missingFields = getMissingFields(draft);

      return {
        action: "needs_clarification",
        draft,
        missingFields,
        question: `I need ${missingFields.join(", ")} to finish this plan.`,
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

function toPlanningDraft(parsed: z.infer<typeof parsedResponseSchema>): ParsedPlanningDraft {
  return {
    title: emptyToUndefined(parsed.title),
    participant: emptyToUndefined(parsed.participant) as ParsedParticipant | undefined,
    category: emptyToUndefined(parsed.category) as ParsedCategory | undefined,
    start: emptyToUndefined(parsed.start),
    durationMinutes: parsed.duration_minutes > 0 ? parsed.duration_minutes : undefined,
    privacy: emptyToUndefined(parsed.privacy) as ParsedPrivacy | undefined,
  };
}

function getMissingFields(draft: ParsedPlanningDraft): ParsedPlanningMissingField[] {
  return [
    !draft.title ? "title" : undefined,
    !draft.participant ? "participant" : undefined,
    !draft.category ? "category" : undefined,
    !draft.start ? "start" : undefined,
    !draft.durationMinutes ? "duration" : undefined,
    !draft.privacy ? "privacy" : undefined,
  ].filter((field): field is ParsedPlanningMissingField => Boolean(field));
}

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();

  return trimmed ? trimmed : undefined;
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
    "scope_start",
    "scope_end",
    "scope_participant",
    "scope_category",
    "scope_title_contains",
    "keep_rules",
    "reason",
  ],
  properties: {
    action: {
      type: "string",
      enum: ["plan", "update", "needs_clarification", "list", "delete_many", "unknown"],
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
    scope_start: {
      type: "string",
      description: "Local inclusive range start in YYYY-MM-DD HH:mm for list/delete_many, otherwise empty.",
    },
    scope_end: {
      type: "string",
      description: "Local exclusive range end in YYYY-MM-DD HH:mm for list/delete_many, otherwise empty.",
    },
    scope_participant: {
      type: "string",
      enum: ["vania", "nastia", "both", ""],
      description: "Optional participant filter for list/delete_many.",
    },
    scope_category: {
      type: "string",
      enum: ["sport", "work", "learning", "reading", "dogs", "horse", "care", "together", "other", ""],
      description: "Optional category filter for list/delete_many.",
    },
    scope_title_contains: {
      type: "string",
      description: "Optional case-insensitive title text filter for list/delete_many.",
    },
    keep_rules: {
      type: "array",
      description: "Exception rules for delete_many. Empty when there are no exceptions.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["count", "participant", "category", "title_contains", "start_time"],
        properties: {
          count: {
            type: "integer",
            description: "How many matching activities to keep for this exception rule.",
          },
          participant: {
            type: "string",
            enum: ["vania", "nastia", "both", ""],
            description: "Optional participant filter for this keep exception.",
          },
          category: {
            type: "string",
            enum: ["sport", "work", "learning", "reading", "dogs", "horse", "care", "together", "other", ""],
            description: "Optional category filter for this keep exception.",
          },
          title_contains: {
            type: "string",
            description: "Optional case-insensitive title text filter for this keep exception.",
          },
          start_time: {
            type: "string",
            description: "Optional local start time filter in HH:mm for this keep exception.",
          },
        },
      },
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
