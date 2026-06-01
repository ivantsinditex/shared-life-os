import { randomUUID } from "node:crypto";

import { DateTime } from "luxon";
import { InlineKeyboard, type Bot, type Context } from "grammy";

import type { AppConfig } from "../../config/config.js";
import {
  formatActivityConfirmation,
  formatActivityDeleted,
  formatActivitySaved,
  formatActivityUpdated,
  formatConflictWarning,
} from "../../domain/planned-activity-formatting.js";
import { findConflicts } from "../../domain/conflict-detection.js";
import {
  parsePlanCommand,
  parseUpdateCommand,
  getPlanCommandUsage,
  getUpdateCommandUsage,
} from "../../domain/plan-command-parser.js";
import {
  renderCalendarDescription,
  renderCalendarTitle,
  toGoogleVisibility,
} from "../../domain/privacy-rendering.js";
import type { CalendarBusySlot, CalendarGateway } from "../calendar/google-calendar-gateway.js";
import type {
  AssistantAgentAction,
  AssistantAgentGateway,
} from "../ai/openai-assistant-agent-gateway.js";
import type {
  ParsedNaturalPlanningCommand,
  ParsedPlanningDraft,
  ParsedPlanningMissingField,
  ParsedPlanningKeepRule,
  ParsedPlanningScope,
  PlanningTextParserGateway,
} from "../ai/openai-planning-parser-gateway.js";
import type { VoiceTranscriptionGateway } from "../voice/openai-transcription-gateway.js";
import {
  activityCategories,
  participants,
  privacyLevels,
  type NewPlannedActivity,
  type PlannedActivity,
} from "../../domain/planned-activity.js";
import type { PlannedActivityRepository } from "../../domain/planned-activity.js";
import {
  formatTaskClosed,
  formatTaskList,
  formatTaskMoved,
  formatTaskSaved,
} from "../../domain/task-formatting.js";
import type { WorkTask, WorkTaskRepository } from "../../domain/task.js";
import type { Logger } from "../../utils/logger.js";

type PlanningCommandDeps = {
  bot: Bot;
  assistantAgent: AssistantAgentGateway;
  calendar: CalendarGateway;
  config: AppConfig;
  logger: Logger;
  plannedActivities: PlannedActivityRepository;
  planningTextParser: PlanningTextParserGateway;
  voiceTranscription: VoiceTranscriptionGateway;
  workTasks: WorkTaskRepository;
};

export function createPlanningCommands(deps: PlanningCommandDeps): void {
  const {
    bot,
    assistantAgent,
    calendar,
    config,
    logger,
    plannedActivities,
    planningTextParser,
    voiceTranscription,
    workTasks,
  } = deps;
  const pendingPlans = new Map<string, NewPlannedActivity>();
  const pendingUpdates = new Map<string, PendingUpdate>();
  const pendingDeletes = new Map<string, PlannedActivity>();
  const pendingBulkDeletes = new Map<string, PendingBulkDelete>();
  const pendingClarifications = new Map<string, PendingClarification>();
  const recentActivitiesByUser = new Map<string, PlannedActivity[]>();
  const recentTasksByUser = new Map<string, WorkTask[]>();

  bot.command("start", async (ctx) => {
    await ctx.reply(
      [
        "Shared Life OS is awake.",
        "",
        "Available now:",
        "/health - check bot status",
        "/plan - create a planned activity",
        "/update - update a planned activity",
        "/sync_failed - show activities that need calendar retry",
        "/today - show today's planned activities",
        "/week - show this week's planned activities",
        "/task_add - add a task to a basket",
        "/tasks - show open tasks",
        "/task_move - move a task to another basket",
        "/task_close - close a task",
        "",
        "Voice messages can contain natural planning text too.",
      ].join("\n"),
    );
  });

  bot.command("health", async (ctx) => {
    logger.info("Health command received", {
      telegramUserId: ctx.from?.id,
    });

    await ctx.reply("OK. Planning service is running.");
  });

  const handlePlanInput = async (ctx: Context, input: string): Promise<void> => {
    if (!input) {
      await ctx.reply(getPlanCommandUsage());
      return;
    }

    const parsed = parsePlanCommand(input, config.timezone);

    if (!parsed.ok) {
      await ctx.reply(parsed.error);
      return;
    }

    const conflictCheck = await checkPlanConflicts(plannedActivities, calendar, parsed.activity);

    if (conflictCheck.conflicts.length > 0) {
      const token = randomUUID();
      pendingPlans.set(token, parsed.activity);

      await ctx.reply(formatConflictWarning({ requested: parsed.activity, ...conflictCheck }), {
        reply_markup: conflictCheck.alternatives.reduce(
          (keyboard, alternative, index) =>
            keyboard.text(`Use option ${index + 1}`, `plan:alternative:${token}:${index}`).row(),
          new InlineKeyboard(),
        ).text("Cancel", `plan:cancel:${token}`),
      });
      return;
    }

    const token = randomUUID();
    pendingPlans.set(token, parsed.activity);

    await ctx.reply(formatActivityConfirmation(parsed.activity), {
      reply_markup: new InlineKeyboard()
        .text("Create", `plan:create:${token}`)
        .text("Cancel", `plan:cancel:${token}`),
    });
  };

  const handleUpdateInput = async (ctx: Context, input: string): Promise<void> => {
    if (!input) {
      await ctx.reply(getUpdateCommandUsage());
      return;
    }

    const parsed = parseUpdateCommand(input, config.timezone);

    if (!parsed.ok) {
      await ctx.reply(parsed.error);
      return;
    }

    const existing = await plannedActivities.findByShortId(parsed.shortId);

    if (!existing || existing.syncStatus === "deleted") {
      await ctx.reply(`Could not find one active planned activity for id "${parsed.shortId}".`);
      return;
    }

    const updated: PlannedActivity = {
      ...existing,
      ...parsed.activity,
      googleCalendarEventId: existing.googleCalendarEventId,
      syncStatus: existing.syncStatus,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    };
    const conflictCheck = await checkPlanConflicts(
      plannedActivities,
      calendar,
      parsed.activity,
      existing.id,
    );

    if (conflictCheck.conflicts.length > 0) {
      await ctx.reply(formatConflictWarning({ requested: parsed.activity, ...conflictCheck }));
      return;
    }

    const token = randomUUID();
    pendingUpdates.set(token, { existing, updated });

    await ctx.reply(["Update planned activity?", "", formatUpdatePreview(existing, updated)].join("\n"), {
      reply_markup: new InlineKeyboard()
        .text("Update", `plan:update:${token}`)
        .text("Cancel", `plan:update-cancel:${token}`),
    });
  };

  const requestClarification = async (
    ctx: Context,
    parsed: Extract<ParsedNaturalPlanningCommand, { action: "needs_clarification" }>,
  ): Promise<void> => {
    const missingFields = parsed.missingFields.length > 0
      ? parsed.missingFields
      : getDraftMissingFields(parsed.draft);
    const token = randomUUID();

    if (missingFields.length === 0) {
      await handlePlanInput(ctx, formatPlanningDraft(parsed.draft));
      return;
    }

    pendingClarifications.set(token, {
      draft: parsed.draft,
      missingFields,
    });
    await replyWithClarificationQuestion(ctx, token, parsed.draft, missingFields, parsed.question);
  };

  bot.command("plan", async (ctx) => {
    await handlePlanInput(ctx, ctx.match.trim());
  });

  bot.on("message:voice", async (ctx) => {
    if (!voiceTranscription.isEnabled()) {
      await ctx.reply("Voice input is not configured yet. Set OPENAI_API_KEY and restart the bot.");
      return;
    }

    try {
      const transcript = await transcribeTelegramVoice(ctx, config, voiceTranscription);
      const routed = routeVoiceCommand(transcript);

      await ctx.reply(`Voice transcript:\n${transcript}`);

      if (routed.command === "plan") {
        await handlePlanInput(ctx, routed.input);
        return;
      }

      if (routed.command === "update") {
        await handleUpdateInput(ctx, routed.input);
        return;
      }

      await handleNaturalPlanningText(ctx, transcript);
    } catch (error) {
      logger.warn("Voice command failed", {
        error: error instanceof Error ? error.message : String(error),
        telegramUserId: ctx.from?.id,
      });

      await ctx.reply("Voice processing failed. Please try again or send the command as text.");
    }
  });

  const handleNaturalPlanningText = async (ctx: Context, text: string): Promise<void> => {
    if (!planningTextParser.isEnabled()) {
      await ctx.reply("Natural-language planning is not configured yet. Set OPENAI_API_KEY and restart the bot.");
      return;
    }

    if (await maybeHandleContextualDelete(ctx, text)) {
      return;
    }

    if (assistantAgent.isEnabled()) {
      const handledByAgent = await handleAgentText(ctx, text);

      if (handledByAgent) {
        return;
      }
    }

    const parsed = await planningTextParser.parse({
      text,
      timezone: config.timezone,
      now: DateTime.now().setZone(config.timezone).toFormat("yyyy-MM-dd HH:mm"),
    });

    if (parsed.action === "unknown") {
      await ctx.reply(`I could not turn that into a plan yet: ${parsed.reason}`);
      return;
    }

    if (parsed.action === "needs_clarification") {
      await requestClarification(ctx, parsed);
      return;
    }

    if (parsed.action === "list") {
      const activities = await listActivitiesByScope(plannedActivities, parsed.scope, config.timezone);

      rememberActivities(ctx, activities);
      await replyWithActivitySummary(ctx, "AI list result", activities, config.timezone);
      return;
    }

    if (parsed.action === "delete_many") {
      await previewBulkDelete(ctx, parsed.scope, parsed.keepRules);
      return;
    }

    const commandInput = formatNaturalPlanningCommand(parsed);

    await ctx.reply(`AI parsed command:\n${commandInput}`);

    if (parsed.action === "plan") {
      await handlePlanInput(ctx, commandInput);
      return;
    }

    await handleUpdateInput(ctx, commandInput);
  };

  async function handleAgentText(ctx: Context, text: string): Promise<boolean> {
    const contextActivities = await loadAgentContextActivities(ctx);

    const result = await assistantAgent.respond({
      text,
      timezone: config.timezone,
      now: DateTime.now().setZone(config.timezone).toFormat("yyyy-MM-dd HH:mm"),
      recentActivities: contextActivities,
      openTasks: await loadAgentContextTasks(ctx),
    });

    if (result.reply) {
      await ctx.reply(result.reply);
    }

    if (result.actions.length === 0) {
      return Boolean(result.reply);
    }

    for (const action of result.actions) {
      await handleAgentAction(ctx, action);
    }

    return true;
  }

  async function loadAgentContextTasks(ctx: Context): Promise<WorkTask[]> {
    const openTasks = await workTasks.list({ status: "open" });
    const recentTasks = recentTasksByUser.get(userContextKey(ctx)) ?? [];
    const uniqueTasks = Array.from(
      new Map([...recentTasks, ...openTasks].map((task) => [task.id, task])).values(),
    )
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
      .slice(0, 100);

    rememberTasks(ctx, uniqueTasks);

    return uniqueTasks;
  }

  async function loadAgentContextActivities(ctx: Context): Promise<PlannedActivity[]> {
    const now = DateTime.now().setZone(config.timezone);
    const nearbyActivities = await plannedActivities.listBetween({
      startsAt: toIso(now.startOf("week").minus({ weeks: 1 })),
      endsAt: toIso(now.plus({ years: 1 }).endOf("day")),
    });
    const recentActivities = recentActivitiesByUser.get(userContextKey(ctx)) ?? [];
    const activeActivities = [...recentActivities, ...nearbyActivities]
      .filter((activity) => activity.syncStatus !== "deleted");
    const uniqueActivities = Array.from(
      new Map(activeActivities.map((activity) => [activity.id, activity])).values(),
    )
      .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))
      .slice(0, 100);

    rememberActivities(ctx, uniqueActivities);

    return uniqueActivities;
  }

  async function handleAgentAction(ctx: Context, action: AssistantAgentAction): Promise<void> {
    if (action.type === "answer") {
      if (action.message) {
        await ctx.reply(action.message);
      }
      return;
    }

    if (action.type === "ask_clarification") {
      await ctx.reply(action.message);
      return;
    }

    if (action.type === "draft_create") {
      await handlePlanInput(ctx, formatAgentCreateAction(action));
      return;
    }

    if (action.type === "list") {
      const activities = await listActivitiesByScope(plannedActivities, action.scope, config.timezone);

      rememberActivities(ctx, activities);
      await replyWithActivitySummary(ctx, "Assistant list result", activities, config.timezone);
      return;
    }

    if (action.type === "draft_delete_many") {
      await previewBulkDelete(ctx, action.scope, action.keepRules);
      return;
    }

    if (action.type === "draft_delete_recent") {
      await previewRecentDelete(ctx, action);
      return;
    }

    if (action.type === "draft_update_recent") {
      await previewRecentUpdate(ctx, action);
      return;
    }

    if (action.type === "task_create") {
      const task = await workTasks.create({
        title: action.title,
        basket: action.basket,
        participant: action.participant,
      });

      rememberTasks(ctx, [task]);
      await ctx.reply(formatTaskSaved(task));
      return;
    }

    if (action.type === "task_list") {
      const tasks = await workTasks.list({ basket: action.basket, status: "open" });

      rememberTasks(ctx, tasks);
      await ctx.reply(formatTaskList(action.basket ? `Open tasks in ${action.basket}` : "Open tasks", tasks));
      return;
    }

    if (action.type === "task_move_recent") {
      const task = findRecentTask(ctx, action.taskId, action.titleContains);

      if (!task) {
        await ctx.reply("I could not find a matching open task to move.");
        return;
      }

      const updated = await workTasks.update({
        ...task,
        basket: action.basket,
      });

      rememberTasks(ctx, [updated]);
      await ctx.reply(formatTaskMoved(updated));
      return;
    }

    if (action.type === "task_close_recent") {
      const task = findRecentTask(ctx, action.taskId, action.titleContains);

      if (!task) {
        await ctx.reply("I could not find a matching open task to close.");
        return;
      }

      const updated = await workTasks.update({
        ...task,
        status: "closed",
        closedAt: new Date().toISOString(),
      });

      rememberTasks(ctx, [updated]);
      await ctx.reply(formatTaskClosed(updated));
    }
  }

  function formatAgentCreateAction(action: Extract<AssistantAgentAction, { type: "draft_create" }>): string {
    return [
      action.title,
      action.participant,
      action.category,
      formatLocalDateTimeForCommand(action.start, config.timezone),
      String(action.durationMinutes),
      action.privacy,
    ].join(" | ");
  }

  bot.callbackQuery(/^plan:create:(.+)$/, async (ctx) => {
    const token = ctx.match[1];
    const activity = pendingPlans.get(token);

    await ctx.answerCallbackQuery();

    if (!activity) {
      await ctx.reply("This planning confirmation expired. Please send /plan again.");
      return;
    }

    const conflictCheck = await checkPlanConflicts(plannedActivities, calendar, activity);

    if (conflictCheck.conflicts.length > 0) {
      await ctx.reply("This plan now conflicts with another activity. Please send /plan again.");
      pendingPlans.delete(token);
      return;
    }

    pendingPlans.delete(token);
    const saved = await plannedActivities.create(activity);
    const synced = await syncActivityToCalendar({
      activity: saved,
      calendar,
      logger,
      plannedActivities,
    });

    rememberActivities(ctx, [synced]);
    await ctx.reply(formatActivitySyncResult(synced, formatActivitySaved(synced)));
  });

  bot.callbackQuery(/^plan:cancel:(.+)$/, async (ctx) => {
    pendingPlans.delete(ctx.match[1]);
    await ctx.answerCallbackQuery();
    await ctx.reply("Planning cancelled. Nothing was saved.");
  });

  bot.callbackQuery(/^plan:alternative:(.+):(\d+)$/, async (ctx) => {
    const token = ctx.match[1];
    const index = Number(ctx.match[2]);
    const activity = pendingPlans.get(token);

    await ctx.answerCallbackQuery();

    if (!activity) {
      await ctx.reply("This planning confirmation expired. Please send /plan again.");
      return;
    }

    const conflictCheck = await checkPlanConflicts(plannedActivities, calendar, activity);
    const alternative = conflictCheck.alternatives[index];

    if (!alternative) {
      await ctx.reply("That alternative is no longer available. Please send /plan again.");
      pendingPlans.delete(token);
      return;
    }

    const updatedActivity: NewPlannedActivity = {
      ...activity,
      startsAt: alternative.startsAt,
      endsAt: alternative.endsAt,
    };

    pendingPlans.set(token, updatedActivity);

    await ctx.reply(formatActivityConfirmation(updatedActivity), {
      reply_markup: new InlineKeyboard()
        .text("Create", `plan:create:${token}`)
        .text("Cancel", `plan:cancel:${token}`),
    });
  });

  bot.command("update", async (ctx) => {
    await handleUpdateInput(ctx, ctx.match.trim());
  });

  bot.callbackQuery(/^plan:update:(.+)$/, async (ctx) => {
    const token = ctx.match[1];
    const pending = pendingUpdates.get(token);

    await ctx.answerCallbackQuery();

    if (!pending) {
      await ctx.reply("This update confirmation expired. Please send /update again.");
      return;
    }

    pendingUpdates.delete(token);
    const saved = await plannedActivities.update(pending.updated);
    const synced = await syncActivityToCalendar({
      activity: saved,
      calendar,
      logger,
      plannedActivities,
    });

    rememberActivities(ctx, [synced]);
    await ctx.reply(formatActivitySyncResult(synced, formatActivityUpdated(synced)));
  });

  bot.callbackQuery(/^plan:update-cancel:(.+)$/, async (ctx) => {
    pendingUpdates.delete(ctx.match[1]);
    await ctx.answerCallbackQuery();
    await ctx.reply("Update cancelled. Nothing was changed.");
  });

  bot.callbackQuery(/^plan:delete-request:(.+)$/, async (ctx) => {
    const activity = await plannedActivities.findByShortId(ctx.match[1]);

    await ctx.answerCallbackQuery();

    if (!activity || activity.syncStatus === "deleted") {
      await ctx.reply("Could not find that active planned activity.");
      return;
    }

    const token = randomUUID();
    pendingDeletes.set(token, activity);

    await ctx.reply(["Delete planned activity?", "", formatActivitySaved(activity)].join("\n"), {
      reply_markup: new InlineKeyboard()
        .text("Delete", `plan:delete-confirm:${token}`)
        .text("Cancel", `plan:delete-cancel:${token}`),
    });
  });

  bot.callbackQuery(/^plan:delete-confirm:(.+)$/, async (ctx) => {
    const token = ctx.match[1];
    const activity = pendingDeletes.get(token);

    await ctx.answerCallbackQuery();

    if (!activity) {
      await ctx.reply("This delete confirmation expired. Please choose the activity again.");
      return;
    }

    pendingDeletes.delete(token);

    try {
      if (activity.googleCalendarEventId) {
        await calendar.deleteEvent(activity.googleCalendarEventId);
      }

      const deleted = await plannedActivities.update({
        ...activity,
        syncStatus: "deleted",
      });

      await ctx.reply(formatActivityDeleted(deleted));
    } catch (error) {
      logger.warn("Calendar delete failed", {
        activityId: activity.id,
        error: error instanceof Error ? error.message : String(error),
      });

      const failed = await plannedActivities.update({
        ...activity,
        syncStatus: "sync_failed",
      });

      await ctx.reply(
        [
          "Calendar delete failed, so the activity was not marked deleted.",
          "",
          formatActivitySaved(failed),
        ].join("\n"),
      );
    }
  });

  bot.callbackQuery(/^plan:delete-cancel:(.+)$/, async (ctx) => {
    pendingDeletes.delete(ctx.match[1]);
    await ctx.answerCallbackQuery();
    await ctx.reply("Delete cancelled. Nothing was changed.");
  });

  bot.callbackQuery(/^plan:delete-many-confirm:(.+)$/, async (ctx) => {
    const pending = pendingBulkDeletes.get(ctx.match[1]);

    await ctx.answerCallbackQuery();

    if (!pending) {
      await ctx.reply("This bulk delete confirmation expired. Please send the request again.");
      return;
    }

    pendingBulkDeletes.delete(ctx.match[1]);

    const result = await deleteActivities({
      activities: pending.deleteCandidates,
      calendar,
      logger,
      plannedActivities,
    });

    await ctx.reply(
      [
        `Deleted ${result.deletedCount} planned activities.`,
        result.failedCount > 0 ? `${result.failedCount} activities failed to delete and were marked sync_failed.` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  });

  bot.callbackQuery(/^plan:delete-many-cancel:(.+)$/, async (ctx) => {
    pendingBulkDeletes.delete(ctx.match[1]);
    await ctx.answerCallbackQuery();
    await ctx.reply("Bulk delete cancelled. Nothing was changed.");
  });

  bot.callbackQuery(/^plan:clarify:(.+):([^:]+):(.+)$/, async (ctx) => {
    const [, token, field, value] = ctx.match;
    const pending = pendingClarifications.get(token);

    await ctx.answerCallbackQuery();

    if (!pending || !isClarifiableField(field)) {
      await ctx.reply("This clarification expired. Please send the request again.");
      return;
    }

    const updatedDraft = applyClarification(pending.draft, field, value);
    const missingFields = getDraftMissingFields(updatedDraft);

    if (missingFields.length > 0) {
      pendingClarifications.set(token, {
        draft: updatedDraft,
        missingFields,
      });
      await replyWithClarificationQuestion(ctx, token, updatedDraft, missingFields);
      return;
    }

    pendingClarifications.delete(token);
    await handlePlanInput(ctx, formatPlanningDraft(updatedDraft));
  });

  bot.command("sync_failed", async (ctx) => {
    const activities = (await plannedActivities.listAll()).filter(
      (activity) => activity.syncStatus === "sync_failed",
    );

    await replyWithActivitySummary(ctx, "Failed calendar syncs", activities, config.timezone, {
      showRetryButtons: true,
    });
  });

  bot.callbackQuery(/^plan:retry-sync:(.+)$/, async (ctx) => {
    const activity = await plannedActivities.findByShortId(ctx.match[1]);

    await ctx.answerCallbackQuery();

    if (!activity || activity.syncStatus === "deleted") {
      await ctx.reply("Could not find that active planned activity.");
      return;
    }

    if (activity.syncStatus !== "sync_failed") {
      await ctx.reply("This activity does not need calendar retry.");
      return;
    }

    const synced = await syncActivityToCalendar({
      activity,
      calendar,
      logger,
      plannedActivities,
    });

    await ctx.reply(formatActivitySyncResult(synced, formatActivitySaved(synced)));
  });

  bot.command("today", async (ctx) => {
    const now = DateTime.now().setZone(config.timezone);
    const activities = await plannedActivities.listBetween({
      startsAt: toIso(now.startOf("day")),
      endsAt: toIso(now.endOf("day")),
    });

    rememberActivities(ctx, activities);
    await replyWithActivitySummary(ctx, "Today", activities, config.timezone);
  });

  bot.command("week", async (ctx) => {
    const now = DateTime.now().setZone(config.timezone);
    const activities = await plannedActivities.listBetween({
      startsAt: toIso(now.startOf("week")),
      endsAt: toIso(now.endOf("week")),
    });

    rememberActivities(ctx, activities);
    await replyWithActivitySummary(ctx, "This week", activities, config.timezone);
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();

    if (!text || text.startsWith("/")) {
      return;
    }

    await handleNaturalPlanningText(ctx, text);
  });

  function rememberActivities(ctx: Context, activities: PlannedActivity[]): void {
    const key = userContextKey(ctx);
    const existing = recentActivitiesByUser.get(key) ?? [];
    const activeActivities = activities.filter((activity) => activity.syncStatus !== "deleted");
    const merged = [...activeActivities, ...existing];
    const unique = Array.from(new Map(merged.map((activity) => [activity.id, activity])).values());

    recentActivitiesByUser.set(
      key,
      unique
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .slice(0, 12),
    );
  }

  function rememberTasks(ctx: Context, tasks: WorkTask[]): void {
    const key = userContextKey(ctx);
    const existing = recentTasksByUser.get(key) ?? [];
    const openTasks = tasks.filter((task) => task.status === "open");
    const merged = [...openTasks, ...existing];
    const unique = Array.from(new Map(merged.map((task) => [task.id, task])).values());

    recentTasksByUser.set(
      key,
      unique
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .slice(0, 20),
    );
  }

  function findRecentTask(ctx: Context, taskId?: string, titleContains?: string): WorkTask | undefined {
    const candidates = (recentTasksByUser.get(userContextKey(ctx)) ?? [])
      .filter((task) => task.status === "open");

    if (taskId) {
      return candidates.find((task) => task.id === taskId || task.id.startsWith(taskId));
    }

    if (titleContains) {
      const normalized = titleContains.toLowerCase();
      const matches = candidates.filter((task) => task.title.toLowerCase().includes(normalized));

      return matches.length === 1 ? matches[0] : undefined;
    }

    return candidates[0];
  }

  async function maybeHandleContextualDelete(ctx: Context, text: string): Promise<boolean> {
    if (!looksLikeDeleteRequest(text) || !looksLikeContextualReference(text)) {
      return false;
    }

    const candidates = (recentActivitiesByUser.get(userContextKey(ctx)) ?? [])
      .filter((activity) => activity.syncStatus !== "deleted");
    const activity = selectContextualActivity(candidates, text, config.timezone);

    if (!activity) {
      return false;
    }

    const token = randomUUID();
    pendingDeletes.set(token, activity);

    await ctx.reply(["Delete this planned activity?", "", formatActivitySaved(activity)].join("\n"), {
      reply_markup: new InlineKeyboard()
        .text("Delete", `plan:delete-confirm:${token}`)
        .text("Cancel", `plan:delete-cancel:${token}`),
    });
    return true;
  }

  async function previewBulkDelete(
    ctx: Context,
    scope: ParsedPlanningScope,
    keepRules: ParsedPlanningKeepRule[],
  ): Promise<void> {
    const activities = await listActivitiesByScope(plannedActivities, scope, config.timezone);
    const deletionPlan = planBulkDelete(activities, keepRules, config.timezone);

    if (deletionPlan.unmatchedKeepRules.length > 0) {
      await ctx.reply(formatUnmatchedKeepRules(deletionPlan.unmatchedKeepRules));
      return;
    }

    if (deletionPlan.deleteCandidates.length === 0) {
      await ctx.reply("I found no matching activities to delete.");
      return;
    }

    const token = randomUUID();
    pendingBulkDeletes.set(token, {
      deleteCandidates: deletionPlan.deleteCandidates,
      keptActivities: deletionPlan.keptActivities,
    });
    rememberActivities(ctx, [...deletionPlan.keptActivities, ...deletionPlan.deleteCandidates]);

    await ctx.reply(formatBulkDeletePreview(deletionPlan, config.timezone), {
      reply_markup: new InlineKeyboard()
        .text(`Delete ${deletionPlan.deleteCandidates.length}`, `plan:delete-many-confirm:${token}`)
        .text("Cancel", `plan:delete-many-cancel:${token}`),
    });
  }

  async function previewRecentDelete(
    ctx: Context,
    action: Extract<AssistantAgentAction, { type: "draft_delete_recent" }>,
  ): Promise<void> {
    const candidates = recentActivitiesByUser.get(userContextKey(ctx)) ?? [];
    const activity = action.activityId
      ? candidates.find((candidate) => candidate.id === action.activityId)
      : candidates.find((candidate) =>
          !action.titleContains ||
          candidate.title.toLowerCase().includes(action.titleContains.toLowerCase()),
        );

    if (!activity || activity.syncStatus === "deleted") {
      await ctx.reply("I could not find the recent activity you mean. Try /today or describe it with date/time.");
      return;
    }

    const token = randomUUID();
    pendingDeletes.set(token, activity);

    await ctx.reply(["Delete this planned activity?", "", formatActivitySaved(activity)].join("\n"), {
      reply_markup: new InlineKeyboard()
        .text("Delete", `plan:delete-confirm:${token}`)
      .text("Cancel", `plan:delete-cancel:${token}`),
    });
  }

  async function previewRecentUpdate(
    ctx: Context,
    action: Extract<AssistantAgentAction, { type: "draft_update_recent" }>,
  ): Promise<void> {
    const existing = findRecentActivity(ctx, action.activityId, action.titleContains);

    if (!existing || existing.syncStatus === "deleted") {
      await ctx.reply("I could not find the recent activity you want to update. Try /today or describe it with date/time.");
      return;
    }

    const updated = buildUpdatedActivityFromAgent(existing, action, config.timezone);
    const conflictCheck = await checkPlanConflicts(
      plannedActivities,
      calendar,
      updated,
      existing.id,
    );

    if (conflictCheck.conflicts.length > 0) {
      await ctx.reply(formatConflictWarning({ requested: updated, ...conflictCheck }));
      return;
    }

    const token = randomUUID();
    pendingUpdates.set(token, { existing, updated });
    rememberActivities(ctx, [updated]);

    await ctx.reply(["Update planned activity?", "", formatUpdatePreview(existing, updated)].join("\n"), {
      reply_markup: new InlineKeyboard()
        .text("Update", `plan:update:${token}`)
        .text("Cancel", `plan:update-cancel:${token}`),
    });
  }

  function findRecentActivity(
    ctx: Context,
    activityId?: string,
    titleContains?: string,
  ): PlannedActivity | undefined {
    const candidates = recentActivitiesByUser.get(userContextKey(ctx)) ?? [];

    if (activityId) {
      return candidates.find((candidate) => candidate.id === activityId);
    }

    return candidates.find((candidate) =>
      !titleContains ||
      candidate.title.toLowerCase().includes(titleContains.toLowerCase()),
    );
  }
}

type PendingUpdate = {
  existing: PlannedActivity;
  updated: PlannedActivity;
};

type PendingBulkDelete = {
  deleteCandidates: PlannedActivity[];
  keptActivities: PlannedActivity[];
};

type PendingClarification = {
  draft: ParsedPlanningDraft;
  missingFields: ParsedPlanningMissingField[];
};

function userContextKey(ctx: Context): string {
  return String(ctx.from?.id ?? ctx.chat?.id ?? "unknown");
}

function looksLikeDeleteRequest(text: string): boolean {
  const normalized = normalizeText(text);

  return [
    "видал",
    "выдал",
    "удал",
    "прибери",
    "прибрать",
    "delete",
    "remove",
  ].some((token) => normalized.includes(token));
}

function looksLikeContextualReference(text: string): boolean {
  const normalized = normalizeText(text);

  return [
    "це",
    "это",
    "this",
    "that",
    "остан",
    "last",
    "одне",
    "одну",
    "один",
    "one",
    "його",
    "її",
    "его",
    "ее",
  ].some((token) => normalized.includes(token));
}

function selectContextualActivity(
  candidates: PlannedActivity[],
  text: string,
  timezone: string,
): PlannedActivity | undefined {
  const normalized = normalizeText(text);
  const todayOnly = normalized.includes("сьогодні") || normalized.includes("сегодня") || normalized.includes("today");
  const ranked = candidates
    .filter((activity) => !todayOnly || isToday(activity, timezone))
    .map((activity) => ({
      activity,
      score: scoreContextualActivity(activity, normalized, timezone),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.activity;
}

function scoreContextualActivity(activity: PlannedActivity, normalizedText: string, timezone: string): number {
  let score = 1;
  const normalizedTitle = normalizeText(activity.title);

  if (normalizedText.includes("остан") || normalizedText.includes("last")) {
    score += 5;
  }

  if (normalizedText.includes("трен") || normalizedText.includes("нав") || normalizedText.includes("workout")) {
    score += activity.category === "sport" ? 4 : 0;
  }

  if (normalizedText.includes("йог") || normalizedText.includes("yoga")) {
    score += normalizedTitle.includes("йог") || normalizedTitle.includes("yoga") ? 6 : 0;
  }

  if (normalizedText.includes("воркаут") || normalizedText.includes("workout")) {
    score += normalizedTitle.includes("воркаут") || normalizedTitle.includes("workout") ? 6 : 0;
  }

  if (normalizedText.includes("сьогодні") || normalizedText.includes("сегодня") || normalizedText.includes("today")) {
    score += isToday(activity, timezone) ? 3 : -10;
  }

  score += Math.max(0, 4 - hoursSinceUpdate(activity));

  return score;
}

function isToday(activity: PlannedActivity, timezone: string): boolean {
  const start = DateTime.fromISO(activity.startsAt).setZone(timezone);
  const now = DateTime.now().setZone(timezone);

  return start.hasSame(now, "day");
}

function hoursSinceUpdate(activity: PlannedActivity): number {
  return Math.max(0, (Date.now() - Date.parse(activity.updatedAt)) / 3_600_000);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е").replace(/і/g, "и").replace(/ї/g, "и");
}

function buildUpdatedActivityFromAgent(
  existing: PlannedActivity,
  action: Extract<AssistantAgentAction, { type: "draft_update_recent" }>,
  timezone: string,
): PlannedActivity {
  const startsAt = action.start
    ? parseAiDateTime(action.start, timezone)
    : DateTime.fromISO(existing.startsAt).setZone(timezone);
  const durationMinutes = action.durationMinutes ?? Math.round(
    DateTime.fromISO(existing.endsAt).diff(DateTime.fromISO(existing.startsAt), "minutes").minutes,
  );
  const endsAt = startsAt.plus({ minutes: durationMinutes });

  return {
    ...existing,
    title: action.title ?? existing.title,
    participant: action.participant ?? existing.participant,
    category: action.category ?? existing.category,
    startsAt: toIso(startsAt),
    endsAt: toIso(endsAt),
    privacy: action.privacy ?? existing.privacy,
    isSharedActivity: (action.participant ?? existing.participant) === "both",
  };
}

async function transcribeTelegramVoice(
  ctx: Context,
  config: AppConfig,
  voiceTranscription: VoiceTranscriptionGateway,
): Promise<string> {
  const voice = ctx.message?.voice;

  if (!voice) {
    throw new Error("Telegram update did not include a voice message.");
  }

  const file = await ctx.api.getFile(voice.file_id);

  if (!file.file_path) {
    throw new Error("Telegram did not return a voice file path.");
  }

  const response = await fetch(
    `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`,
  );

  if (!response.ok) {
    throw new Error(`Telegram voice download failed: ${response.status}`);
  }

  return voiceTranscription.transcribe({
    audio: await response.arrayBuffer(),
    filename: `${voice.file_unique_id}.ogg`,
    mimeType: "audio/ogg",
  });
}

function routeVoiceCommand(transcript: string):
  | { command: "plan"; input: string }
  | { command: "update"; input: string }
  | { command: "unknown" } {
  const normalized = transcript.trim();
  const commandMatch = normalized.match(/^\/?(plan|update)(?:@\w+)?\s+([\s\S]+)$/i);

  if (commandMatch?.[1] && commandMatch[2]) {
    return {
      command: commandMatch[1].toLowerCase() as "plan" | "update",
      input: commandMatch[2].trim(),
    };
  }

  if (normalized.includes("|")) {
    return {
      command: "plan",
      input: normalized,
    };
  }

  return { command: "unknown" };
}

function formatNaturalPlanningCommand(parsed: ParsedNaturalPlanningCommand): string {
  if (parsed.action !== "plan" && parsed.action !== "update") {
    return "";
  }

  const planParts = [
    parsed.title,
    parsed.participant,
    parsed.category,
    parsed.start,
    String(parsed.durationMinutes),
    parsed.privacy,
  ];

  if (parsed.action === "update") {
    return [parsed.shortId, ...planParts].join(" | ");
  }

  return planParts.join(" | ");
}

function getDraftMissingFields(draft: ParsedPlanningDraft): ParsedPlanningMissingField[] {
  return [
    !draft.title ? "title" : undefined,
    !draft.participant ? "participant" : undefined,
    !draft.category ? "category" : undefined,
    !draft.start ? "start" : undefined,
    !draft.durationMinutes ? "duration" : undefined,
    !draft.privacy ? "privacy" : undefined,
  ].filter((field): field is ParsedPlanningMissingField => Boolean(field));
}

async function replyWithClarificationQuestion(
  ctx: Context,
  token: string,
  draft: ParsedPlanningDraft,
  missingFields: ParsedPlanningMissingField[],
  question?: string,
): Promise<void> {
  const field = missingFields[0];
  const keyboard = buildClarificationKeyboard(token, field);

  await ctx.reply(
    [
      question || getClarificationQuestion(field),
      "",
      "Current draft:",
      formatDraftPreview(draft),
    ].join("\n"),
    keyboard ? { reply_markup: keyboard } : undefined,
  );
}

function buildClarificationKeyboard(
  token: string,
  field: ParsedPlanningMissingField,
): InlineKeyboard | undefined {
  if (field === "participant") {
    return participants.reduce(
      (keyboard, participant) => keyboard.text(participant, `plan:clarify:${token}:participant:${participant}`).row(),
      new InlineKeyboard(),
    );
  }

  if (field === "category") {
    return activityCategories.reduce(
      (keyboard, category) => keyboard.text(category, `plan:clarify:${token}:category:${category}`).row(),
      new InlineKeyboard(),
    );
  }

  if (field === "privacy") {
    return privacyLevels.reduce(
      (keyboard, privacy) => keyboard.text(privacy, `plan:clarify:${token}:privacy:${privacy}`).row(),
      new InlineKeyboard(),
    );
  }

  return undefined;
}

function getClarificationQuestion(field: ParsedPlanningMissingField): string {
  const questions: Record<ParsedPlanningMissingField, string> = {
    title: "What should I call this activity?",
    participant: "Who is this activity for?",
    category: "Which category should I use?",
    start: "When should it start?",
    duration: "How long should it last?",
    privacy: "Which privacy level should I use?",
  };

  return questions[field];
}

function applyClarification(
  draft: ParsedPlanningDraft,
  field: ParsedPlanningMissingField,
  value: string,
): ParsedPlanningDraft {
  if (field === "duration") {
    return {
      ...draft,
      durationMinutes: Number(value),
    };
  }

  return {
    ...draft,
    [field === "start" ? "start" : field]: value,
  };
}

function isClarifiableField(field: string): field is ParsedPlanningMissingField {
  return ["title", "participant", "category", "start", "duration", "privacy"].includes(field);
}

function formatPlanningDraft(draft: ParsedPlanningDraft): string {
  return [
    draft.title,
    draft.participant,
    draft.category,
    draft.start,
    String(draft.durationMinutes),
    draft.privacy,
  ].join(" | ");
}

function formatDraftPreview(draft: ParsedPlanningDraft): string {
  return [
    `Title: ${draft.title ?? "?"}`,
    `Participant: ${draft.participant ?? "?"}`,
    `Category: ${draft.category ?? "?"}`,
    `Start: ${draft.start ?? "?"}`,
    `Duration: ${draft.durationMinutes ? `${draft.durationMinutes} min` : "?"}`,
    `Privacy: ${draft.privacy ?? "?"}`,
  ].join("\n");
}

async function listActivitiesByScope(
  plannedActivities: PlannedActivityRepository,
  scope: ParsedPlanningScope,
  timezone: string,
): Promise<PlannedActivity[]> {
  const startsAt = parseScopeDate(scope.startsAt, timezone);
  const endsAt = parseScopeDate(scope.endsAt, timezone);
  const activities = await plannedActivities.listBetween({
    startsAt,
    endsAt,
    participant: scope.participant,
  });

  return activities.filter((activity) => {
    const categoryMatches = !scope.category || activity.category === scope.category;
    const titleMatches =
      !scope.titleContains ||
      activity.title.toLowerCase().includes(scope.titleContains.toLowerCase());

    return categoryMatches && titleMatches;
  });
}

function planBulkDelete(
  activities: PlannedActivity[],
  keepRules: ParsedPlanningKeepRule[],
  timezone: string,
): {
  deleteCandidates: PlannedActivity[];
  keptActivities: PlannedActivity[];
  unmatchedKeepRules: ParsedPlanningKeepRule[];
} {
  const activeKeepRules = keepRules.filter((rule) => rule.count > 0);

  if (activeKeepRules.length === 0) {
    return {
      deleteCandidates: activities,
      keptActivities: [],
      unmatchedKeepRules: [],
    };
  }

  const sortedActivities = [...activities].sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
  const keptActivities: PlannedActivity[] = [];
  const keptIds = new Set<string>();
  const unmatchedKeepRules: ParsedPlanningKeepRule[] = [];

  activeKeepRules.forEach((rule) => {
    const matches = sortedActivities
      .filter((activity) => !keptIds.has(activity.id))
      .filter((activity) => matchesKeepRule(activity, rule, timezone));
    const selected = matches.slice(0, rule.count);

    if (selected.length < rule.count) {
      unmatchedKeepRules.push(rule);
    }

    selected.forEach((activity) => {
      keptIds.add(activity.id);
      keptActivities.push(activity);
    });
  });

  return {
    deleteCandidates: sortedActivities.filter((activity) => !keptIds.has(activity.id)),
    keptActivities,
    unmatchedKeepRules,
  };
}

function matchesKeepRule(
  activity: PlannedActivity,
  keep: ParsedPlanningKeepRule,
  timezone: string,
): boolean {
  const participantMatches = !keep.participant || activity.participant === keep.participant;
  const categoryMatches = !keep.category || activity.category === keep.category;
  const titleMatches =
    !keep.titleContains ||
    activity.title.toLowerCase().includes(keep.titleContains.toLowerCase());
  const startTimeMatches =
    !keep.startTime ||
    DateTime.fromISO(activity.startsAt).setZone(timezone).toFormat("HH:mm") === keep.startTime;

  return participantMatches && categoryMatches && titleMatches && startTimeMatches;
}

function formatBulkDeletePreview(
  plan: {
    deleteCandidates: PlannedActivity[];
    keptActivities: PlannedActivity[];
    unmatchedKeepRules: ParsedPlanningKeepRule[];
  },
  timezone: string,
): string {
  const lines = [
    `Delete ${plan.deleteCandidates.length} planned activities?`,
  ];

  if (plan.keptActivities.length > 0) {
    lines.push("", "Keeping:", ...formatActivityLines(plan.keptActivities, timezone));
  }

  lines.push("", "Deleting:", ...formatActivityLines(plan.deleteCandidates, timezone));

  return lines.join("\n");
}

function formatUnmatchedKeepRules(rules: ParsedPlanningKeepRule[]): string {
  return [
    "I found matching activities to delete, but could not satisfy every keep exception.",
    "Nothing was deleted.",
    "",
    "Missing keep matches:",
    ...rules.map((rule, index) => `${index + 1}. ${formatKeepRule(rule)}`),
  ].join("\n");
}

function formatKeepRule(rule: ParsedPlanningKeepRule): string {
  return [
    `keep ${rule.count}`,
    rule.participant ? `participant=${rule.participant}` : "",
    rule.category ? `category=${rule.category}` : "",
    rule.titleContains ? `title contains "${rule.titleContains}"` : "",
    rule.startTime ? `time=${rule.startTime}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function formatActivityLines(activities: PlannedActivity[], timezone: string): string[] {
  return activities.map((activity, index) => {
    const start = DateTime.fromISO(activity.startsAt).setZone(timezone);
    const end = DateTime.fromISO(activity.endsAt).setZone(timezone);

    return [
      `${index + 1}.`,
      start.toFormat("ccc HH:mm"),
      "-",
      end.toFormat("HH:mm"),
      "|",
      activity.participant,
      "|",
      activity.category,
      "|",
      renderCalendarTitle(activity),
      "|",
      `id: ${shortId(activity.id)}`,
    ].join(" ");
  });
}

async function deleteActivities(params: {
  activities: PlannedActivity[];
  calendar: CalendarGateway;
  logger: Logger;
  plannedActivities: PlannedActivityRepository;
}): Promise<{ deletedCount: number; failedCount: number }> {
  let deletedCount = 0;
  let failedCount = 0;

  for (const activity of params.activities) {
    try {
      if (activity.googleCalendarEventId) {
        await params.calendar.deleteEvent(activity.googleCalendarEventId);
      }

      await params.plannedActivities.update({
        ...activity,
        syncStatus: "deleted",
      });
      deletedCount += 1;
    } catch (error) {
      params.logger.warn("Calendar bulk delete failed", {
        activityId: activity.id,
        error: error instanceof Error ? error.message : String(error),
      });

      await params.plannedActivities.update({
        ...activity,
        syncStatus: "sync_failed",
      });
      failedCount += 1;
    }
  }

  return { deletedCount, failedCount };
}

function parseScopeDate(value: string, timezone: string): string {
  const parsed = parseAiDateTime(value, timezone);

  if (!parsed.isValid) {
    throw new Error(`Could not understand AI scope date "${value}".`);
  }

  return toIso(parsed);
}

function formatLocalDateTimeForCommand(value: string, timezone: string): string {
  const parsed = parseAiDateTime(value, timezone);

  if (!parsed.isValid) {
    return value;
  }

  return parsed.setZone(timezone).toFormat("yyyy-MM-dd HH:mm");
}

function parseAiDateTime(value: string, timezone: string): DateTime {
  const formatted = DateTime.fromFormat(value, "yyyy-MM-dd HH:mm", { zone: timezone });

  if (formatted.isValid) {
    return formatted;
  }

  return DateTime.fromISO(value, { zone: timezone });
}

async function checkPlanConflicts(
  plannedActivities: PlannedActivityRepository,
  calendar: CalendarGateway,
  activity: NewPlannedActivity,
  ignoredActivityId?: string,
) {
  const window = {
    startsAt: DateTime.fromISO(activity.startsAt).minus({ days: 1 }).toISO() ?? activity.startsAt,
    endsAt: DateTime.fromISO(activity.endsAt).plus({ days: 1 }).toISO() ?? activity.endsAt,
  };
  const localCandidates = await plannedActivities.listBetween(window);
  const filteredLocalCandidates = localCandidates.filter(
    (candidate) => candidate.id !== ignoredActivityId,
  );
  const externalBusySlots = await calendar.listBusySlots({
    startsAt: window.startsAt,
    endsAt: window.endsAt,
  });
  const externalCandidates = externalBusySlots
    .filter(
      (slot) =>
        !localCandidates.some((candidate) => timeRangesOverlap(slot, candidate)) &&
        (!ignoredActivityId ||
          !localCandidates.some(
            (candidate) => candidate.id === ignoredActivityId && timeRangesOverlap(slot, candidate),
          )),
    )
    .map((slot) => toExternalBusyActivity(slot, activity.timezone));

  return findConflicts(activity, [...filteredLocalCandidates, ...externalCandidates]);
}

async function replyWithActivitySummary(
  ctx: Context,
  title: string,
  activities: PlannedActivity[],
  timezone: string,
  options: { showRetryButtons?: boolean } = {},
): Promise<void> {
  if (activities.length === 0) {
    await ctx.reply(`${title}: nothing planned yet.`);
    return;
  }

  const keyboard = new InlineKeyboard();

  activities.forEach((activity, index) => {
    if (options.showRetryButtons && activity.syncStatus === "sync_failed") {
      keyboard.text(`Retry ${index + 1}`, `plan:retry-sync:${shortId(activity.id)}`).row();
    }

    keyboard.text(`Delete ${index + 1}`, `plan:delete-request:${shortId(activity.id)}`).row();
  });

  await ctx.reply(formatActivitySummary(title, activities, timezone), {
    reply_markup: keyboard,
  });
}

function formatActivitySummary(
  title: string,
  activities: PlannedActivity[],
  timezone: string,
): string {
  const lines = activities.map((activity) => {
    const start = DateTime.fromISO(activity.startsAt).setZone(timezone);
    const end = DateTime.fromISO(activity.endsAt).setZone(timezone);

    return [
      start.toFormat("ccc HH:mm"),
      "-",
      end.toFormat("HH:mm"),
      "|",
      activity.participant,
      "|",
      activity.category,
      "|",
      renderCalendarTitle(activity),
      "|",
      `sync: ${activity.syncStatus}`,
      "|",
      `id: ${shortId(activity.id)}`,
    ].join(" ");
  });

  return [title, "", ...lines].join("\n");
}

async function syncActivityToCalendar(params: {
  activity: PlannedActivity;
  calendar: CalendarGateway;
  logger: Logger;
  plannedActivities: PlannedActivityRepository;
}): Promise<PlannedActivity> {
  try {
    const draft = {
      title: renderCalendarTitle(params.activity),
      startsAt: params.activity.startsAt,
      endsAt: params.activity.endsAt,
      timezone: params.activity.timezone,
      visibility: toGoogleVisibility(params.activity.privacy),
      transparency: "opaque" as const,
      description: renderCalendarDescription(params.activity),
    };
    const event = params.activity.googleCalendarEventId
      ? await params.calendar.updateEvent(params.activity.googleCalendarEventId, draft)
      : await params.calendar.createEvent(draft);

    return params.plannedActivities.update({
      ...params.activity,
      googleCalendarEventId: event.eventId,
      syncStatus: "synced",
    });
  } catch (error) {
    params.logger.warn("Calendar sync failed", {
      activityId: params.activity.id,
      error: error instanceof Error ? error.message : String(error),
    });

    return params.plannedActivities.update({
      ...params.activity,
      syncStatus: "sync_failed",
    });
  }
}

function formatActivitySyncResult(activity: PlannedActivity, successMessage: string): string {
  if (activity.syncStatus === "synced") {
    return successMessage;
  }

  return [
    successMessage,
    "",
    "Saved locally, but calendar sync failed.",
    "Check Google Calendar credentials and retry sync in a later task.",
  ].join("\n");
}

function formatUpdatePreview(existing: PlannedActivity, updated: PlannedActivity): string {
  return [
    "From:",
    formatActivitySaved(existing),
    "",
    "To:",
    formatActivitySaved(updated),
  ].join("\n");
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function toExternalBusyActivity(slot: CalendarBusySlot, timezone: string): PlannedActivity {
  const now = new Date().toISOString();

  return {
    id: `calendar-busy-${slot.startsAt}`,
    title: "External calendar busy",
    participant: "both",
    category: "other",
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    timezone,
    privacy: "busy_only",
    isSharedActivity: true,
    syncStatus: "synced",
    createdAt: now,
    updatedAt: now,
  };
}

function timeRangesOverlap(
  left: Pick<CalendarBusySlot, "startsAt" | "endsAt">,
  right: Pick<PlannedActivity, "startsAt" | "endsAt">,
): boolean {
  return Date.parse(left.startsAt) < Date.parse(right.endsAt)
    && Date.parse(left.endsAt) > Date.parse(right.startsAt);
}

function toIso(dateTime: DateTime): string {
  const iso = dateTime.toISO();

  if (!iso) {
    throw new Error("Unable to format date-time as ISO");
  }

  return iso;
}
