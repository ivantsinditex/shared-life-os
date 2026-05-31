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
import { renderCalendarTitle, toGoogleVisibility } from "../../domain/privacy-rendering.js";
import type { CalendarGateway } from "../calendar/google-calendar-gateway.js";
import type { NewPlannedActivity, PlannedActivity } from "../../domain/planned-activity.js";
import type { PlannedActivityRepository } from "../../domain/planned-activity.js";
import type { Logger } from "../../utils/logger.js";

type PlanningCommandDeps = {
  bot: Bot;
  calendar: CalendarGateway;
  config: AppConfig;
  logger: Logger;
  plannedActivities: PlannedActivityRepository;
};

export function createPlanningCommands(deps: PlanningCommandDeps): void {
  const { bot, calendar, config, logger, plannedActivities } = deps;
  const pendingPlans = new Map<string, NewPlannedActivity>();
  const pendingUpdates = new Map<string, PendingUpdate>();
  const pendingDeletes = new Map<string, PlannedActivity>();

  bot.command("start", async (ctx) => {
    await ctx.reply(
      [
        "Shared Life OS is awake.",
        "",
        "Available now:",
        "/health - check bot status",
        "/plan - create a planned activity",
        "/update - update a planned activity",
        "/today - show today's planned activities",
        "/week - show this week's planned activities",
      ].join("\n"),
    );
  });

  bot.command("health", async (ctx) => {
    logger.info("Health command received", {
      telegramUserId: ctx.from?.id,
    });

    await ctx.reply("OK. Planning service is running.");
  });

  bot.command("plan", async (ctx) => {
    const input = ctx.match.trim();

    if (!input) {
      await ctx.reply(getPlanCommandUsage());
      return;
    }

    const parsed = parsePlanCommand(input, config.timezone);

    if (!parsed.ok) {
      await ctx.reply(parsed.error);
      return;
    }

    const conflictCheck = await checkPlanConflicts(plannedActivities, parsed.activity);

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
  });

  bot.callbackQuery(/^plan:create:(.+)$/, async (ctx) => {
    const token = ctx.match[1];
    const activity = pendingPlans.get(token);

    await ctx.answerCallbackQuery();

    if (!activity) {
      await ctx.reply("This planning confirmation expired. Please send /plan again.");
      return;
    }

    const conflictCheck = await checkPlanConflicts(plannedActivities, activity);

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

    const conflictCheck = await checkPlanConflicts(plannedActivities, activity);
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
    const input = ctx.match.trim();

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
    const conflictCheck = await checkPlanConflicts(plannedActivities, parsed.activity, existing.id);

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

async function checkPlanConflicts(
  plannedActivities: PlannedActivityRepository,
  activity: NewPlannedActivity,
  ignoredActivityId?: string,
) {
  const candidates = await plannedActivities.listBetween({
    startsAt: DateTime.fromISO(activity.startsAt).minus({ days: 1 }).toISO() ?? activity.startsAt,
    endsAt: DateTime.fromISO(activity.endsAt).plus({ days: 1 }).toISO() ?? activity.endsAt,
  });

  return findConflicts(
    activity,
    candidates.filter((candidate) => candidate.id !== ignoredActivityId),
  );
}

async function replyWithActivitySummary(
  ctx: Context,
  title: string,
  activities: PlannedActivity[],
  timezone: string,
): Promise<void> {
  if (activities.length === 0) {
    await ctx.reply(`${title}: nothing planned yet.`);
    return;
  }

  const keyboard = new InlineKeyboard();

  activities.forEach((activity, index) => {
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
    const visibleTitle = activity.privacy === "shared_details" ? activity.title : "Busy";

    return [
      start.toFormat("ccc HH:mm"),
      "-",
      end.toFormat("HH:mm"),
      "|",
      activity.participant,
      "|",
      activity.category,
      "|",
      visibleTitle,
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
      description: [
        "Created by Shared Life OS.",
        `Internal title: ${params.activity.title}`,
        `Participant: ${params.activity.participant}`,
        `Category: ${params.activity.category}`,
        `Privacy: ${params.activity.privacy}`,
      ].join("\n"),
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

function toIso(dateTime: DateTime): string {
  const iso = dateTime.toISO();

  if (!iso) {
    throw new Error("Unable to format date-time as ISO");
  }

  return iso;
}
