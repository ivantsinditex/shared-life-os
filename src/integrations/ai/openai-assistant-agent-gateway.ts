import { z } from "zod";
import { DateTime } from "luxon";

import type { AppConfig } from "../../config/config.js";
import type { PlannedActivity } from "../../domain/planned-activity.js";
import type { TaskBasket, WorkTask } from "../../domain/task.js";
import type { TimeEntry } from "../../domain/time-entry.js";
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

export type AssistantConversationTurn = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type AssistantAgentInput = {
  text: string;
  timezone: string;
  now: string;
  recentActivities: PlannedActivity[];
  openTasks: WorkTask[];
  conversationHistory?: AssistantConversationTurn[];
  activeTimeEntry?: TimeEntry;
  currentParticipant?: AgentParticipant;
  enableWebSearch?: boolean;
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
    }
  | {
      type: "task_create";
      title: string;
      basket: TaskBasket;
      participant?: AgentParticipant;
    }
  | {
      type: "task_list";
      basket?: TaskBasket;
    }
  | {
      type: "task_move_recent";
      taskId?: string;
      titleContains?: string;
      basket: TaskBasket;
    }
  | {
      type: "task_close_recent";
      taskId?: string;
      titleContains?: string;
    }
  | {
      type: "time_start";
      basket?: TaskBasket;
      taskId?: string;
      title?: string;
      participant?: AgentParticipant;
    }
  | {
      type: "time_stop";
      participant?: AgentParticipant;
    }
  | {
      type: "time_status";
      participant?: AgentParticipant;
    }
  | {
      type: "time_summary";
      startsAt: string;
      endsAt: string;
      participant?: AgentParticipant;
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
        "task_create",
        "task_list",
        "task_move_recent",
        "task_close_recent",
        "time_start",
        "time_stop",
        "time_status",
        "time_summary",
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
      task_id: z.string(),
      task_title: z.string(),
      task_basket: z.enum(["911", "operational", "deep_work", "random", "personal_brand", "other", ""]),
      task_participant: z.enum(["vania", "nastia", "both", ""]),
      target_task_basket: z.enum(["911", "operational", "deep_work", "random", "personal_brand", "other", ""]),
      time_basket: z.enum(["911", "operational", "deep_work", "random", "personal_brand", "other", ""]),
      time_title: z.string(),
      time_participant: z.enum(["vania", "nastia", "both", ""]),
      time_task_id: z.string(),
      time_scope_start: z.string(),
      time_scope_end: z.string(),
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
  private readonly timeoutMs = 90_000;

  constructor(private readonly config: { apiKey: string; model: string }) {}

  isEnabled(): boolean {
    return true;
  }

  async respond(input: AssistantAgentInput): Promise<AssistantAgentResult> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.timeoutMs);

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: abortController.signal,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.model,
        input: [
          {
            role: "system",
            content: buildAgentPrompt(input.timezone, input.now, input.currentParticipant),
          },
          {
            role: "user",
            content: JSON.stringify({
              user_text: input.text,
              conversation_history: input.conversationHistory ?? [],
              recent_activities: input.recentActivities.map(toRecentActivityContext),
              open_tasks: input.openTasks.map(toOpenTaskContext),
              active_time_entry: input.activeTimeEntry ? toActiveTimeEntryContext(input.activeTimeEntry) : null,
              current_participant: input.currentParticipant ?? "",
              web_search_enabled: input.enableWebSearch === true,
            }),
          },
        ],
        tools: input.enableWebSearch
          ? [
            {
              type: "web_search",
              user_location: {
                type: "approximate",
                country: "UA",
                timezone: input.timezone,
              },
            },
          ]
          : undefined,
        tool_choice: input.enableWebSearch ? "auto" : undefined,
        text: {
          format: {
            type: "json_schema",
            name: "assistant_agent_plan",
            strict: true,
            schema: agentPlanSchema,
          },
        },
      }),
    }).finally(() => clearTimeout(timeout));

    const payload = (await response.json()) as OpenAiResponsesPayload;

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `OpenAI assistant agent failed: ${response.status}`);
    }

    const outputText = extractOutputText(payload);
    const parsed = agentResponseSchema.parse(JSON.parse(outputText));

    const actions = parsed.actions
      .map(toAgentAction)
      .filter((action): action is AssistantAgentAction => Boolean(action));

    return {
      reply: parsed.reply,
      actions: normalizeAgentActions({
        text: input.text,
        actions,
        timezone: input.timezone,
        now: input.now,
        currentParticipant: input.currentParticipant,
      }),
    };
  }
}

function buildAgentPrompt(timezone: string, now: string, currentParticipant?: AgentParticipant): string {
  return [
    "You are a conversational life-planning assistant inside Telegram.",
    "You receive user text, conversation history, tasks, and nearby calendar events. Decide what the user wants and return JSON actions.",
    `Timezone: ${timezone}. Current local datetime: ${now}.`,
    "Use conversation_history as short-term memory for normal chat. Resolve follow-ups like 'the first one', 'цей перший', 'про перший', 'розкажи детальніше', 'продовжи', 'а другий?', and pronouns from the last relevant assistant/user turns.",
    "If the user asks a general non-calendar question, answer normally with action type answer. Do not force every message into planning.",
    "If the user asks for current/latest news, live prices, today's events, or other live facts and web_search_enabled is true, use web search and answer with source links/citations when available.",
    "If the user asks for current/latest news, live prices, today's events, or other live facts and web_search_enabled is false, say that live web search is not connected for this request. Do not invent fresh news.",
    "For general recommendations or explanations, keep enough detail to make follow-up questions meaningful, and preserve names/titles so later ordinals can refer to them.",
    "Family context: the household has seven members: Nastia, Vania, the dogs Drive/Драйв and Fedr/Федр, the cats Barney/Барні and Xiola/Ксіола, and Nastia's horse Gift/Подарунок. These animals are recurring real-life participants in events.",
    "Act like a helpful assistant, but never directly perform destructive actions. For deletes, return draft_delete_recent or draft_delete_many so the app can ask for confirmation.",
    "Create intent words such as зроби, постав, заплануй, створи, додай, schedule, plan, create, add mean draft_create unless the user clearly says to update/change/move/replace/delete an existing activity.",
    "Update intent words are онови, зміни, перенеси, заміни, update, change, move, replace. Only use draft_update_recent when the user clearly refers to an existing activity.",
    "If the user asks to create several future activities in one message, return one draft_create action for every activity. Never turn one of the requested activities into a plain answer.",
    "For daily or weekly plan dictation, split the message into all concrete time blocks. A line like '05-08 біг' means a draft_create with start 05:00 and duration 180 minutes.",
    "For weekday labels in Ukrainian/Russian/English (ПН/понеділок/Monday, ВТ, СР, ЧТ, ПТ, СБ, НД), map them to the requested week. 'цей тиждень/на тиждень' means the current local week; 'наступний тиждень' means the next local week. If the week is truly ambiguous, ask a clarification.",
    "For new create requests with a weekday but without an explicit week, choose the nearest future occurrence of that weekday. Example: if today is Friday and the user says 'на понеділок', use the next Monday, not today and not the previous Monday.",
    "If the user gives both weekday and date, such as 'понеділок 8 червня', trust the explicit date and keep the weekday only as context.",
    "For flexible scheduling phrases like random hours/рандомні години/сам розберись/будь-які години, choose reasonable non-overlapping local times yourself using recent_activities as constraints. Prefer daytime slots 09:00-20:00 unless the user gave a specific time window.",
    "If the user requests daily work/reading/learning blocks without exact hours, create one draft_create per day and choose available-looking times. Do not ask for exact hours just because the user allowed random hours.",
    "If the user asks to find free slots, avoid booked slots, or choose the time yourself, do not return ask_clarification for missing start time. Pick concrete local start times.",
    "For requests like 'на решту днів до кінця тижня по дві години навчання і дві години читання', return two draft_create actions per remaining day: one learning block and one reading block.",
    "When the user says one activity should happen every day this week starting today, create it for every remaining day of the current local week including today. 'Через день' means every other day.",
    "If the user gives a soft preferred hour like 'можна о четвертій', schedule that activity at 16:00 unless it conflicts with a supplied explicit block; otherwise choose a nearby reasonable time.",
    "When a work block contains a comma-separated task list, create the calendar work block and also create one task_create action per concrete task. Put operational/операційка tasks in the operational basket, urgent/911 tasks in 911, deep work tasks in deep_work, random/light work/зустрічі in random, personal brand/особистий бренд in personal_brand.",
    "Important: if several work tasks share one explicit time range, such as '11-16: task A, task B, task C', do not split the range into sequential calendar events. Return exactly one draft_create for the whole 11:00-16:00 work block, plus task_create actions for task A, task B, task C.",
    "If the user gives broad work windows like 'з 9 до 13 і з 14 до 19' and then lists several work errands/items, create the broad work windows as calendar draft_create actions and the listed items as task_create actions. Do not invent one-hour calendar events inside those windows unless the user gave exact times for each item.",
    "If the user says tasks/таски/задачі for a time range, treat the listed items as task_create actions, not separate calendar activities, unless each item has its own explicit time.",
    "Do not create task_create actions for ordinary life activities like run, yoga, gym, horses, dogs, care, family, date, or together time unless the user explicitly calls them tasks.",
    "If the user asks to start tracking time now in the same message, add one time_start action for the current work basket/task. Do not start timers for future planned activities unless the user explicitly says to start now.",
    "When returning create/update/delete/task/time actions, keep top-level reply empty unless you must ask a clarification.",
    "For edits to existing activities, return draft_update_recent. Do not model an update as delete plus create.",
    "For phrases like replace Nastia with Vania, change participant from Nastia to Vania, заміни Настю на Ваню, use draft_update_recent with participant vania and the matching activity id.",
    "Use recent_activities to resolve phrases like this, that, it, last one, this workout, Wednesday operational work, це, це тренування, останнє, у середу операційна робота.",
    "When the user describes an existing activity by day/date/title/participant and exactly one recent_activities item matches, use that exact activity id.",
    "If a matching activity exists in recent_activities, do not ask to create a new activity.",
    currentParticipant
      ? `Current Telegram user participant is ${currentParticipant}. Pronouns like me/my/мені/мене/мій/моя/почав/почала should map to ${currentParticipant}.`
      : "Current Telegram user participant is unknown. If user says me/my/мені/мене without a name, ask a clarification.",
    "Explicit participants: Ivan/Vania/Vanya/Ваня/Іван -> vania; Настя/Nastia -> nastia; together/us/разом/нам -> both.",
    "If the current user says to create/schedule/put an event 'з Ванею' or 'з Настею', it is a couple/shared event: participant both and category together.",
    "If the current user mentions an animal without the other human partner, keep participant as the current user. Drive/Драйв and Fedr/Федр are dogs -> category dogs. Gift/Подарунок is Nastia's horse -> participant nastia and category horse unless another human participant is explicit. Barney/Барні and Xiola/Ксіола are cats -> category other unless care is explicit, then category care.",
    "Categories: yoga/workout/gym/run/йога/воркаут/зал/пробіжка -> sport.",
    "Categories: пес/собака/драйв/федр/вигул/прогулянка з собакою -> dogs.",
    "Categories: подарунок/конюшня/кінь/верхова їзда/horse/riding -> horse. Dates/побачення/вечір разом/зустріч для пари -> together.",
    "For 'побачення з Ванею/Настею', create a calendar activity with participant both and category together, because it involves the current user plus the named partner.",
    "Ukrainian time phrase 'на третю годину' usually means 15:00 unless morning/night is explicit. 'на десяту' usually means 10:00.",
    "Default privacy for created activities is busy_only unless user asks private or shared details.",
    "Default duration is 60 minutes only when user implies an activity but omits duration.",
    "For draft_create start, use local format YYYY-MM-DD HH:mm, not ISO.",
    "For list/delete scope_start and scope_end, use local format YYYY-MM-DD HH:mm, not ISO.",
    "For vague create requests missing time/date, ask_clarification.",
    "For list/delete date ranges: today is local 00:00 to tomorrow 00:00; this week is Monday 00:00 to next Monday 00:00.",
    "Prefer a concise Ukrainian or English reply matching the user's language.",
    "If you can resolve a follow-up from recent activities, use the exact recent activity id.",
    "You also manage work task baskets. Baskets: 911, operational, deep_work, random, personal_brand, other.",
    "For requests like add/закинь/додай task to 911/операційка/deep work, return task_create.",
    "For requests like show/list/покажи 911/операційку/tasks, return task_list.",
    "For requests like move/перенеси this task to deep work, return task_move_recent with the matching open task id and target basket.",
    "For requests like close/done/закрий task, return task_close_recent with the matching open task id.",
    "Use open_tasks to resolve task follow-ups like this task, last task, цю задачу, останню задачу, or title references.",
    "You also manage time tracking. For 'start/почав/почала трекати deep work/911/операційку', return time_start.",
    "For casual phrases like 'почала операційку', 'почав deep work', 'стартани 911', return time_start for that basket and current participant.",
    "For 'start tracking this task/почав цю задачу', return time_start with matching open task id.",
    "For 'stop/закінчив/закінчила/стоп/зупини таймер', return time_stop.",
    "For 'what is active/що зараз трекається/status', return time_status.",
    "For 'how much today/скільки сьогодні/цього тижня було 911/deep work', return time_summary with local scope_start and scope_end.",
    "For time_summary date ranges: today is local 00:00 to tomorrow 00:00; this week is Monday 00:00 to next Monday 00:00.",
    "For task/time replies, prefer Ukrainian wording and avoid explaining the internal action type.",
  ].join("\n");
}

export function normalizeAgentActions(params: {
  text: string;
  actions: AssistantAgentAction[];
  timezone: string;
  now: string;
  currentParticipant?: AgentParticipant;
}): AssistantAgentAction[] {
  const createIntent = hasCreateIntent(params.text) && !hasExplicitUpdateOrDeleteIntent(params.text);

  return params.actions.map((action) => {
    const createAction = createIntent && action.type === "draft_update_recent"
      ? updateActionToCreateAction(action, params)
      : action;

    if (createAction.type === "draft_create") {
      return normalizeDraftCreateAction(createAction, params);
    }

    return createAction;
  });
}

function normalizeDraftCreateAction(
  action: Extract<AssistantAgentAction, { type: "draft_create" }>,
  params: {
    text: string;
    timezone: string;
    now: string;
    currentParticipant?: AgentParticipant;
  },
): Extract<AssistantAgentAction, { type: "draft_create" }> {
  const normalizedFamilyAction = normalizeFamilySemantics(action, params.text, params.currentParticipant);
  const normalizedStart = normalizeCreateStartFromUserText(
    normalizedFamilyAction.start,
    params.text,
    params.timezone,
    params.now,
  );

  return {
    ...normalizedFamilyAction,
    start: normalizedStart,
  };
}

function updateActionToCreateAction(
  action: Extract<AssistantAgentAction, { type: "draft_update_recent" }>,
  params: {
    text: string;
    timezone: string;
    now: string;
    currentParticipant?: AgentParticipant;
  },
): AssistantAgentAction {
  if (!action.start && !action.title && !action.titleContains) {
    return action;
  }

  return normalizeDraftCreateAction(
    {
      type: "draft_create",
      title: action.title ?? action.titleContains ?? "Подія",
      participant: action.participant ?? inferParticipant(params.text, params.currentParticipant),
      category: action.category ?? inferCategory(params.text),
      start: action.start ?? params.now,
      durationMinutes: action.durationMinutes ?? 60,
      privacy: action.privacy ?? "busy_only",
    },
    params,
  );
}

function normalizeCreateStartFromUserText(
  modelStart: string,
  text: string,
  timezone: string,
  nowText: string,
): string {
  const start = parseLocalDateTime(modelStart, timezone);
  const now = parseLocalDateTime(nowText, timezone);

  if (!start.isValid || !now.isValid) {
    return modelStart;
  }

  const explicitDate = detectExplicitDayMonth(text, now, timezone);
  const targetDate = explicitDate ?? detectNearestFutureWeekday(text, now);

  if (!targetDate) {
    return modelStart;
  }

  return targetDate
    .set({
      hour: start.hour,
      minute: start.minute,
      second: 0,
      millisecond: 0,
    })
    .toFormat("yyyy-MM-dd HH:mm");
}

function parseLocalDateTime(value: string, timezone: string): DateTime {
  const local = DateTime.fromFormat(value, "yyyy-MM-dd HH:mm", { zone: timezone });

  if (local.isValid) {
    return local;
  }

  return DateTime.fromISO(value, { zone: timezone }).setZone(timezone);
}

function detectExplicitDayMonth(text: string, now: DateTime, timezone: string): DateTime | undefined {
  const normalized = normalizeText(text);
  const match = normalized.match(/(\d{1,2})\s*(січня|января|january|лютого|февраля|february|березня|марта|march|квітня|апреля|april|травня|мая|may|червня|июня|june|липня|июля|july|серпня|августа|august|вересня|сентября|september|жовтня|октября|october|листопада|ноября|november|грудня|декабря|december)/);

  if (!match) {
    return undefined;
  }

  const day = Number(match[1]);
  const month = monthNumber(match[2]);

  if (!month) {
    return undefined;
  }

  let date = DateTime.fromObject({ year: now.year, month, day }, { zone: timezone }).startOf("day");

  if (!date.isValid) {
    return undefined;
  }

  if (date < now.startOf("day")) {
    date = date.plus({ years: 1 });
  }

  return date;
}

function detectNearestFutureWeekday(text: string, now: DateTime): DateTime | undefined {
  const targetWeekday = detectWeekday(text);

  if (!targetWeekday) {
    return undefined;
  }

  const daysUntilTarget = (targetWeekday - now.weekday + 7) % 7;
  return now.startOf("day").plus({ days: daysUntilTarget === 0 ? 0 : daysUntilTarget });
}

function detectWeekday(text: string): number | undefined {
  const normalized = normalizeText(text);
  const weekdayPatterns: Array<[number, { words: string[]; tokens: string[] }]> = [
    [1, { words: ["понеділок", "понедельник", "monday"], tokens: ["пн", "mon"] }],
    [2, { words: ["вівторок", "вторник", "tuesday"], tokens: ["вт", "tue"] }],
    [3, { words: ["середа", "среда", "wednesday"], tokens: ["ср", "wed"] }],
    [4, { words: ["четвер", "четверг", "thursday"], tokens: ["чт", "thu"] }],
    [5, { words: ["пʼятниця", "п'ятниця", "пятниця", "пятница", "friday"], tokens: ["пт", "fri"] }],
    [6, { words: ["субота", "суббота", "saturday"], tokens: ["сб", "sat"] }],
    [7, { words: ["неділя", "воскресенье", "sunday"], tokens: ["нд", "sun"] }],
  ];

  return weekdayPatterns.find(([, patterns]) =>
    patterns.words.some((pattern) => normalized.includes(pattern)) ||
    patterns.tokens.some((pattern) => includesToken(normalized, pattern)),
  )?.[0];
}

function monthNumber(month: string): number | undefined {
  const months: Record<string, number> = {
    "січня": 1,
    "января": 1,
    january: 1,
    "лютого": 2,
    "февраля": 2,
    february: 2,
    "березня": 3,
    "марта": 3,
    march: 3,
    "квітня": 4,
    "апреля": 4,
    april: 4,
    "травня": 5,
    "мая": 5,
    may: 5,
    "червня": 6,
    "июня": 6,
    june: 6,
    "липня": 7,
    "июля": 7,
    july: 7,
    "серпня": 8,
    "августа": 8,
    august: 8,
    "вересня": 9,
    "сентября": 9,
    september: 9,
    "жовтня": 10,
    "октября": 10,
    october: 10,
    "листопада": 11,
    "ноября": 11,
    november: 11,
    "грудня": 12,
    "декабря": 12,
    december: 12,
  };

  return months[month];
}

function normalizeFamilySemantics(
  action: Extract<AssistantAgentAction, { type: "draft_create" }>,
  text: string,
  currentParticipant?: AgentParticipant,
): Extract<AssistantAgentAction, { type: "draft_create" }> {
  if (mentionsHumanPartner(text, currentParticipant)) {
    return {
      ...action,
      participant: "both",
      category: "together",
    };
  }

  if (mentionsGiftHorse(text)) {
    return {
      ...action,
      participant: "nastia",
      category: "horse",
    };
  }

  if (mentionsDog(text)) {
    return {
      ...action,
      participant: currentParticipant ?? action.participant,
      category: "dogs",
    };
  }

  if (mentionsCat(text)) {
    return {
      ...action,
      participant: action.participant === "both" ? "both" : currentParticipant ?? action.participant,
      category: mentionsCare(text) ? "care" : action.category,
    };
  }

  return action;
}

function inferParticipant(text: string, currentParticipant?: AgentParticipant): AgentParticipant {
  if (mentionsHumanPartner(text, currentParticipant)) {
    return "both";
  }

  if (mentionsGiftHorse(text)) {
    return "nastia";
  }

  const normalized = normalizeText(text);

  if (includesAny(normalized, ["настя", "насті", "nastia"])) {
    return "nastia";
  }

  if (includesAny(normalized, ["ваня", "ванею", "іван", "ivan", "vania", "vanya"])) {
    return "vania";
  }

  return currentParticipant ?? "both";
}

function inferCategory(text: string): AgentCategory {
  const normalized = normalizeText(text);

  if (mentionsHumanPartner(text, undefined) || includesAny(normalized, ["побачення", "вечір разом", "разом"])) {
    return "together";
  }

  if (mentionsGiftHorse(text) || includesAny(normalized, ["кінь", "конюшн", "верхова", "horse", "riding"])) {
    return "horse";
  }

  if (mentionsDog(text)) {
    return "dogs";
  }

  if (includesAny(normalized, ["йога", "воркаут", "зал", "спорт", "пробіж", "run", "gym", "workout", "yoga"])) {
    return "sport";
  }

  if (includesAny(normalized, ["робот", "операцій", "зйомк", "клієнт", "таск", "задач", "work"])) {
    return "work";
  }

  return "other";
}

function hasCreateIntent(text: string): boolean {
  return includesAny(normalizeText(text), ["зроби", "постав", "заплануй", "створи", "додай", "добав", "schedule", "plan", "create", "add"]);
}

function hasExplicitUpdateOrDeleteIntent(text: string): boolean {
  return includesAny(normalizeText(text), ["онови", "зміни", "зміні", "перенеси", "замін", "видали", "delete", "remove", "update", "change", "move", "replace"]);
}

function mentionsHumanPartner(text: string, currentParticipant?: AgentParticipant): boolean {
  const normalized = normalizeText(text);
  const mentionsVania = includesAny(normalized, ["з ванею", "з іваном", "with vania", "with ivan", "ваня", "іван", "ivan", "vania", "vanya"]);
  const mentionsNastia = includesAny(normalized, ["з настею", "with nastia", "настя", "nastia"]);

  if (currentParticipant === "vania") {
    return mentionsNastia;
  }

  if (currentParticipant === "nastia") {
    return mentionsVania;
  }

  return includesAny(normalized, ["побачення", "разом", "нам", "для нас"]) || (mentionsVania && mentionsNastia);
}

function mentionsDog(text: string): boolean {
  return includesAny(normalizeText(text), ["драйв", "федр", "пес", "песи", "собака", "собаки", "dog", "dogs"]);
}

function mentionsGiftHorse(text: string): boolean {
  return includesAny(normalizeText(text), ["подарун", "кінь", "конюшн", "horse"]);
}

function mentionsCat(text: string): boolean {
  return includesAny(normalizeText(text), ["барні", "ксіола", "кіт", "коти", "cat", "cats"]);
}

function mentionsCare(text: string): boolean {
  return includesAny(normalizeText(text), ["догляд", "доглянути", "нагодувати", "корм", "care"]);
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е");
}

function includesAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

function includesToken(text: string, token: string): boolean {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(token)}($|[^\\p{L}\\p{N}])`, "u").test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function toActiveTimeEntryContext(entry: TimeEntry): Record<string, string> {
  return {
    id: entry.id,
    basket: entry.basket,
    title: entry.title,
    participant: entry.participant ?? "",
    task_id: entry.taskId ?? "",
    started_at: entry.startedAt,
  };
}

function toOpenTaskContext(task: WorkTask): Record<string, string> {
  return {
    id: task.id,
    short_id: task.id.slice(0, 8),
    title: task.title,
    basket: task.basket,
    participant: task.participant ?? "",
    status: task.status,
    created_at: task.createdAt,
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

  if (action.type === "task_create") {
    if (!action.task_title && !action.title) {
      return {
        type: "ask_clarification",
        message: action.message || "Яку задачу додати?",
      };
    }

    if (!action.task_basket) {
      return {
        type: "ask_clarification",
        message: action.message || "У який кошик додати задачу?",
      };
    }

    return {
      type: "task_create",
      title: action.task_title || action.title,
      basket: action.task_basket as TaskBasket,
      participant: emptyToUndefined(action.task_participant) as AgentParticipant | undefined,
    };
  }

  if (action.type === "task_list") {
    return {
      type: "task_list",
      basket: emptyToUndefined(action.task_basket) as TaskBasket | undefined,
    };
  }

  if (action.type === "task_move_recent") {
    if (!action.target_task_basket) {
      return {
        type: "ask_clarification",
        message: action.message || "У який кошик перенести задачу?",
      };
    }

    return {
      type: "task_move_recent",
      taskId: emptyToUndefined(action.task_id),
      titleContains: emptyToUndefined(action.title_contains || action.task_title),
      basket: action.target_task_basket as TaskBasket,
    };
  }

  if (action.type === "task_close_recent") {
    return {
      type: "task_close_recent",
      taskId: emptyToUndefined(action.task_id),
      titleContains: emptyToUndefined(action.title_contains || action.task_title),
    };
  }

  if (action.type === "time_start") {
    return {
      type: "time_start",
      basket: emptyToUndefined(action.time_basket) as TaskBasket | undefined,
      taskId: emptyToUndefined(action.time_task_id || action.task_id),
      title: emptyToUndefined(action.time_title || action.task_title || action.title),
      participant: emptyToUndefined(action.time_participant || action.task_participant) as AgentParticipant | undefined,
    };
  }

  if (action.type === "time_stop") {
    return {
      type: "time_stop",
      participant: emptyToUndefined(action.time_participant) as AgentParticipant | undefined,
    };
  }

  if (action.type === "time_status") {
    return {
      type: "time_status",
      participant: emptyToUndefined(action.time_participant) as AgentParticipant | undefined,
    };
  }

  if (action.type === "time_summary") {
    if (!action.time_scope_start || !action.time_scope_end) {
      return {
        type: "ask_clarification",
        message: action.message || "За який період показати трекінг часу?",
      };
    }

    return {
      type: "time_summary",
      startsAt: action.time_scope_start,
      endsAt: action.time_scope_end,
      participant: emptyToUndefined(action.time_participant) as AgentParticipant | undefined,
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
          "task_id",
          "task_title",
          "task_basket",
          "task_participant",
          "target_task_basket",
          "time_basket",
          "time_title",
          "time_participant",
          "time_task_id",
          "time_scope_start",
          "time_scope_end",
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
              "task_create",
              "task_list",
              "task_move_recent",
              "task_close_recent",
              "time_start",
              "time_stop",
              "time_status",
              "time_summary",
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
          task_id: { type: "string" },
          task_title: { type: "string" },
          task_basket: {
            type: "string",
            enum: ["911", "operational", "deep_work", "random", "personal_brand", "other", ""],
          },
          task_participant: { type: "string", enum: ["vania", "nastia", "both", ""] },
          target_task_basket: {
            type: "string",
            enum: ["911", "operational", "deep_work", "random", "personal_brand", "other", ""],
          },
          time_basket: {
            type: "string",
            enum: ["911", "operational", "deep_work", "random", "personal_brand", "other", ""],
          },
          time_title: { type: "string" },
          time_participant: { type: "string", enum: ["vania", "nastia", "both", ""] },
          time_task_id: { type: "string" },
          time_scope_start: { type: "string" },
          time_scope_end: { type: "string" },
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
