import { z } from "zod";

import type { AppConfig } from "../../config/config.js";
import type { PlannedActivity } from "../../domain/planned-activity.js";
import type {
  ParsedPlanningKeepRule,
  ParsedPlanningScope,
} from "./openai-planning-parser-gateway.js";

type AgentParticipant = "vania" | "nastia" | "both";
type AgentCategory =
  | "sport"
  | "work"
  | "learning"
  | "reading"
  | "dogs"
  | "horse"
  | "care"
  | "together"
  | "other";
type AgentPrivacy = "private" | "busy_only" | "shared_details";

export type AssistantAgentInput = {
  text: string;
  timezone: string;
  now: string;
  recentActivities: PlannedActivity[];
};

export type AssistantAgentResult = {
  reply: string;
  actions: AssistantAgentAction[];
};

export type AssistantAgentAction =
  | {
      type: "answer";
      message: string;
    }
  | {
      type: "draft_create";
      title: string;
      participant: AgentParticipant;
      category: AgentCategory;
      start: string;
      durationMinutes: number;
      privacy: AgentPrivacy;
    }
  | {
      type: "list";
      scope: ParsedPlanningScope;
    }
  | {
      type: "draft_delete_many";
      scope: ParsedPlanningScope;
      keepRules: ParsedPlanningKeepRule[];
    }
  | {
      type: "draft_delete_recent";
      activityId?: string;
      titleContains?: string;
    }
  | {
      type: "draft_update_recent";
      activityId?: string;
      titleContains?: string;
      title?: string;
      participant?: AgentParticipant;
      category?: AgentCategory;
      start?: string;
      durationMinutes?: number;
      privacy?: AgentPrivacy;
    }
  | {
      type: "ask_clarification";
      message: string;
    };

export interface AssistantAgentGateway {
  isEnabled(): boolean;
  respond(input: AssistantAgentInput): Promise<AssistantAgentResult>;
}

const agentResponseSchema = z.object({
  reply: z.string(),
  actions: z.array(
    z.object({
      type: z.enum([
        "answer",
        "draft_create",
        "list",
        "draft_delete_many",
        "draft_delete_recent",
        "draft_update_recent",
        "ask_clarification",
      ]),
      message: z.string(),
      activity_id: z.string(),
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
      title_contains: z.string(),
    }),
  ),
});

export function createAssistantAgentGateway(config: AppConfig): AssistantAgentGateway {
  if (!config.openAiApiKey) {
    return new DisabledAssistantAgentGateway();
  }

  return new OpenAiAssistantAgentGateway({
    apiKey: config.openAiApiKey,
    model: config.openAiPlanningModel,
  });
}

class DisabledAssistantAgentGateway implements AssistantAgentGateway {
  isEnabled(): boolean {
    return false;
  }

  async respond(): Promise<AssistantAgentResult> {
    return {
      reply: "",
      actions: [],
    };
  }
}

class OpenAiAssistantAgentGateway implements AssistantAgentGateway {
  constructor(private readonly config: { apiKey: string; model: string }) {}

  isEnabled(): boolean {
    return true;
  }

  async respond(input: AssistantAgentInput): Promise<AssistantAgentResult> {
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
            content: buildAgentPrompt(input.timezone, input.now),
          },
          {
            role: "user",
            content: JSON.stringify({
              user_text: input.text,
              recent_activities: input.recentActivities.map(toRecentActivityContext),
            }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "assistant_agent_plan",
            strict: true,
            schema: agentPlanSchema,
          },
        },
      }),
    });

    const payload = (await response.json()) as OpenAiResponsesPayload;

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `OpenAI assistant agent failed: ${response.status}`);
    }

    const outputText = extractOutputText(payload);
    const parsed = agentResponseSchema.parse(JSON.parse(outputText));

    return {
      reply: parsed.reply,
      actions: parsed.actions.map(toAgentAction).filter((action): action is AssistantAgentAction => Boolean(action)),
    };
  }
}

function buildAgentPrompt(timezone: string, now: string): string {
  return [
    "You are a conversational life-planning assistant inside Telegram.",
    "You receive user text and recent activity context. Decide what the user wants and return JSON actions.",
    `Timezone: ${timezone}. Current local datetime: ${now}.`,
    "Act like a helpful assistant, but never directly perform destructive actions. For deletes, return draft_delete_recent or draft_delete_many so the app can ask for confirmation.",
    "For edits to existing activities, return draft_update_recent. Do not model an update as delete plus create.",
    "For phrases like replace Nastia with Vania, change participant from Nastia to Vania, заміни Настю на Ваню, use draft_update_recent with participant vania and the recent activity id.",
    "Use recent_activities to resolve phrases like this, that, it, last one, this workout, це, це тренування, останнє.",
    "Participants: me/my/мені/мене/мій/мого/Ivan/Vania/Vanya -> vania; Настя/Nastia -> nastia; together/us/разом -> both.",
    "Categories: yoga/workout/gym/run/йога/воркаут/зал/пробіжка -> sport.",
    "Default privacy for created activities is busy_only unless user asks private or shared details.",
    "Default duration is 60 minutes only when user implies an activity but omits duration.",
    "For draft_create start, use local format YYYY-MM-DD HH:mm, not ISO.",
    "For list/delete scope_start and scope_end, use local format YYYY-MM-DD HH:mm, not ISO.",
    "For vague create requests missing time/date, ask_clarification.",
    "For list/delete date ranges: today is local 00:00 to tomorrow 00:00; this week is Monday 00:00 to next Monday 00:00.",
    "Prefer a concise Ukrainian or English reply matching the user's language.",
    "If you can resolve a follow-up from recent activities, use the exact recent activity id.",
  ].join("\n");
}

function toRecentActivityContext(activity: PlannedActivity): Record<string, string> {
  return {
    id: activity.id,
    short_id: activity.id.slice(0, 8),
    title: activity.title,
    participant: activity.participant,
    category: activity.category,
    starts_at: activity.startsAt,
    ends_at: activity.endsAt,
    privacy: activity.privacy,
    sync_status: activity.syncStatus,
  };
}

function extractOutputText(payload: OpenAiResponsesPayload): string {
  const text = payload.output
    ?.flatMap((item) => item.content ?? [])
    .find((content) => content.type === "output_text")?.text;

  if (!text) {
    throw new Error("OpenAI assistant response did not include output text.");
  }

  return text;
}

function toAgentAction(action: z.infer<typeof agentResponseSchema>["actions"][number]): AssistantAgentAction | undefined {
  if (action.type === "answer") {
    return {
      type: "answer",
      message: action.message,
    };
  }

  if (action.type === "ask_clarification") {
    return {
      type: "ask_clarification",
      message: action.message,
    };
  }

  if (action.type === "draft_create") {
    if (!action.title || !action.participant || !action.category || !action.start || !action.privacy) {
      return {
        type: "ask_clarification",
        message: action.message || "Мені потрібно трохи більше деталей, щоб створити подію.",
      };
    }

    return {
      type: "draft_create",
      title: action.title,
      participant: action.participant as AgentParticipant,
      category: action.category as AgentCategory,
      start: action.start,
      durationMinutes: action.duration_minutes > 0 ? action.duration_minutes : 60,
      privacy: action.privacy as AgentPrivacy,
    };
  }

  if (action.type === "list") {
    if (!action.scope_start || !action.scope_end) {
      return {
        type: "ask_clarification",
        message: action.message || "За який період показати події?",
      };
    }

    return {
      type: "list",
      scope: toScope(action),
    };
  }

  if (action.type === "draft_delete_many") {
    if (!action.scope_start || !action.scope_end) {
      return {
        type: "ask_clarification",
        message: action.message || "За який період видалити події?",
      };
    }

    return {
      type: "draft_delete_many",
      scope: toScope(action),
      keepRules: action.keep_rules.map((rule) => ({
        count: rule.count,
        participant: emptyToUndefined(rule.participant) as AgentParticipant | undefined,
        category: emptyToUndefined(rule.category) as AgentCategory | undefined,
        titleContains: emptyToUndefined(rule.title_contains),
        startTime: emptyToUndefined(rule.start_time),
      })),
    };
  }

  if (action.type === "draft_delete_recent") {
    return {
      type: "draft_delete_recent",
      activityId: emptyToUndefined(action.activity_id),
      titleContains: emptyToUndefined(action.title_contains),
    };
  }

  if (action.type === "draft_update_recent") {
    return {
      type: "draft_update_recent",
      activityId: emptyToUndefined(action.activity_id),
      titleContains: emptyToUndefined(action.title_contains),
      title: emptyToUndefined(action.title),
      participant: emptyToUndefined(action.participant) as AgentParticipant | undefined,
      category: emptyToUndefined(action.category) as AgentCategory | undefined,
      start: emptyToUndefined(action.start),
      durationMinutes: action.duration_minutes > 0 ? action.duration_minutes : undefined,
      privacy: emptyToUndefined(action.privacy) as AgentPrivacy | undefined,
    };
  }

  return undefined;
}

function toScope(action: z.infer<typeof agentResponseSchema>["actions"][number]): ParsedPlanningScope {
  return {
    startsAt: action.scope_start,
    endsAt: action.scope_end,
    participant: emptyToUndefined(action.scope_participant) as AgentParticipant | undefined,
    category: emptyToUndefined(action.scope_category) as AgentCategory | undefined,
    titleContains: emptyToUndefined(action.scope_title_contains),
  };
}

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();

  return trimmed ? trimmed : undefined;
}

const agentPlanSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "actions"],
  properties: {
    reply: {
      type: "string",
    },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "type",
          "message",
          "activity_id",
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
          "title_contains",
        ],
        properties: {
          type: {
            type: "string",
            enum: [
              "answer",
              "draft_create",
              "list",
              "draft_delete_many",
              "draft_delete_recent",
              "draft_update_recent",
              "ask_clarification",
            ],
          },
          message: { type: "string" },
          activity_id: { type: "string" },
          title: { type: "string" },
          participant: { type: "string", enum: ["vania", "nastia", "both", ""] },
          category: {
            type: "string",
            enum: ["sport", "work", "learning", "reading", "dogs", "horse", "care", "together", "other", ""],
          },
          start: { type: "string" },
          duration_minutes: { type: "integer" },
          privacy: { type: "string", enum: ["private", "busy_only", "shared_details", ""] },
          scope_start: { type: "string" },
          scope_end: { type: "string" },
          scope_participant: { type: "string", enum: ["vania", "nastia", "both", ""] },
          scope_category: {
            type: "string",
            enum: ["sport", "work", "learning", "reading", "dogs", "horse", "care", "together", "other", ""],
          },
          scope_title_contains: { type: "string" },
          keep_rules: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["count", "participant", "category", "title_contains", "start_time"],
              properties: {
                count: { type: "integer" },
                participant: { type: "string", enum: ["vania", "nastia", "both", ""] },
                category: {
                  type: "string",
                  enum: ["sport", "work", "learning", "reading", "dogs", "horse", "care", "together", "other", ""],
                },
                title_contains: { type: "string" },
                start_time: { type: "string" },
              },
            },
          },
          title_contains: { type: "string" },
        },
      },
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
