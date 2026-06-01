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
  ParsedNaturalPlanningCommand,
  ParsedPlanningKeepRule,
  ParsedPlanningScope,
  PlanningTextParserGateway,
} from "../ai/openai-planning-parser-gateway.js";
import type { VoiceTranscriptionGateway } from "../voice/openai-transcription-gateway.js";
import type { NewPlannedActivity, PlannedActivity } from "../../domain/planned-activity.js";
import type { PlannedActivityRepository } from "../../domain/planned-activity.js";
import type { Logger } from "../../utils/logger.js";

type PlanningCommandDeps = {
  bot: Bot;
  calendar: CalendarGateway;
  config: AppConfig;
  logger: Logger;
  plannedActivities: PlannedActivityRepository;
  planningTextParser: PlanningTextParserGateway;
  voiceTranscription: VoiceTranscriptionGateway;
};

export function createPlanningCommands(deps: PlanningCommandDeps): void {
  const {
    bot,
    calendar,
    config,
    logger,
    plannedActivities,
    planningTextParser,
    voiceTranscription,
  } = deps;
  const pendingPlans = new Map<string, NewPlannedActivity>();
  const pendingUpdates = new Map<string, PendingUpdate>();
  const pendingDeletes = new Map<string, PlannedActivity>();
  const pendingBulkDeletes = new Map<string, PendingBulkDelete>();

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

    const parsed = await planningTextParser.parse({
      text,
      timezone: config.timezone,
      now: DateTime.now().setZone(config.timezone).toFormat("yyyy-MM-dd HH:mm"),
    });

    if (parsed.action === "unknown") {
      await ctx.reply(`I could not turn that into a plan yet: ${parsed.reason}`);
      return;
    }

    if (parsed.action === "list") {
      const activities = await listActivitiesByScope(plannedActivities, parsed.scope, config.timezone);

      await replyWithActivitySummary(ctx, "AI list result", activities, config.timezone);
      return;
    }

    if (parsed.action === "delete_many") {
      const activities = await listActivitiesByScope(plannedActivities, parsed.scope, config.timezone);
      const deletionPlan = planBulkDelete(activities, parsed.keep);

      if (deletionPlan.deleteCandidates.length === 0) {
        await ctx.reply("I found no matching activities to delete.");
        return;
      }

      const token = randomUUID();
      pendingBulkDeletes.set(token, {
        deleteCandidates: deletionPlan.deleteCandidates,
        keptActivities: deletionPlan.keptActivities,
      });

      await ctx.reply(formatBulkDeletePreview(deletionPlan, config.timezone), {
        reply_markup: new InlineKeyboard()
          .text(`Delete ${deletionPlan.deleteCandidates.length}`, `plan:delete-many-confirm:${token}`)
          .text("Cancel", `plan:delete-many-cancel:${token}`),
      });
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

    await replyWithActivitySummary(ctx, "Today", activities, config.timezone);
  });

  bot.command("week", async (ctx) => {
    const now = DateTime.now().setZone(config.timezone);
    const activities = await plannedActivities.listBetween({
      startsAt: toIso(now.startOf("week")),
      endsAt: toIso(now.endOf("week")),
    });

    await replyWithActivitySummary(ctx, "This week", activities, config.timezone);
  });
}

type PendingUpdate = {
  existing: PlannedActivity;
  updated: PlannedActivity;
};

type PendingBulkDelete = {
  deleteCandidates: PlannedActivity[];
  keptActivities: PlannedActivity[];
};

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
  keep: ParsedPlanningKeepRule,
): { deleteCandidates: PlannedActivity[]; keptActivities: PlannedActivity[] } {
  if (keep.count <= 0) {
    return {
      deleteCandidates: activities,
      keptActivities: [],
    };
  }

  const sortedActivities = [...activities].sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
  const keptActivities = sortedActivities.filter((activity) => matchesKeepRule(activity, keep)).slice(0, keep.count);
  const keptIds = new Set(keptActivities.map((activity) => activity.id));

  return {
    deleteCandidates: sortedActivities.filter((activity) => !keptIds.has(activity.id)),
    keptActivities,
  };
}

function matchesKeepRule(activity: PlannedActivity, keep: ParsedPlanningKeepRule): boolean {
  const participantMatches = !keep.participant || activity.participant === keep.participant;
  const categoryMatches = !keep.category || activity.category === keep.category;
  const titleMatches =
    !keep.titleContains ||
    activity.title.toLowerCase().includes(keep.titleContains.toLowerCase());

  return participantMatches && categoryMatches && titleMatches;
}

function formatBulkDeletePreview(
  plan: { deleteCandidates: PlannedActivity[]; keptActivities: PlannedActivity[] },
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
  const parsed = DateTime.fromFormat(value, "yyyy-MM-dd HH:mm", { zone: timezone });

  if (!parsed.isValid) {
    throw new Error(`Could not understand AI scope date "${value}".`);
  }

  return toIso(parsed);
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
