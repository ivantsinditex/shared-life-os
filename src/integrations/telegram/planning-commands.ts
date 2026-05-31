import { randomUUID } from "node:crypto";

import { DateTime } from "luxon";
import { InlineKeyboard, type Bot } from "grammy";

import type { AppConfig } from "../../config/config.js";
import {
  formatActivityConfirmation,
  formatActivitySaved,
} from "../../domain/planned-activity-formatting.js";
import { parsePlanCommand, getPlanCommandUsage } from "../../domain/plan-command-parser.js";
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

  bot.command("start", async (ctx) => {
    await ctx.reply(
      [
        "Shared Life OS is awake.",
        "",
        "Available now:",
        "/health - check bot status",
        "/plan - create a planned activity",
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

    pendingPlans.delete(token);
    const saved = await plannedActivities.create(activity);

    try {
      const event = await calendar.createEvent({
        title: renderCalendarTitle(saved),
        startsAt: saved.startsAt,
        endsAt: saved.endsAt,
        timezone: saved.timezone,
        visibility: toGoogleVisibility(saved.privacy),
        transparency: "opaque",
        description: [
          "Created by Shared Life OS.",
          `Internal title: ${saved.title}`,
          `Participant: ${saved.participant}`,
          `Category: ${saved.category}`,
          `Privacy: ${saved.privacy}`,
        ].join("\n"),
      });

      const synced = await plannedActivities.update({
        ...saved,
        googleCalendarEventId: event.eventId,
        syncStatus: "synced",
      });

      await ctx.reply([formatActivitySaved(synced), event.htmlLink].filter(Boolean).join("\n"));
    } catch (error) {
      logger.warn("Calendar sync failed after planned activity create", {
        activityId: saved.id,
        error: error instanceof Error ? error.message : String(error),
      });

      const failed = await plannedActivities.update({
        ...saved,
        syncStatus: "sync_failed",
      });

      await ctx.reply(
        [
          formatActivitySaved(failed),
          "",
          "Saved locally, but calendar sync failed.",
          "Check Google Calendar credentials and retry sync in a later task.",
        ].join("\n"),
      );
    }
  });

  bot.callbackQuery(/^plan:cancel:(.+)$/, async (ctx) => {
    pendingPlans.delete(ctx.match[1]);
    await ctx.answerCallbackQuery();
    await ctx.reply("Planning cancelled. Nothing was saved.");
  });

  bot.command("today", async (ctx) => {
    const now = DateTime.now().setZone(config.timezone);
    const activities = await plannedActivities.listBetween({
      startsAt: toIso(now.startOf("day")),
      endsAt: toIso(now.endOf("day")),
    });

    await ctx.reply(formatActivitySummary("Today", activities, config.timezone));
  });

  bot.command("week", async (ctx) => {
    const now = DateTime.now().setZone(config.timezone);
    const activities = await plannedActivities.listBetween({
      startsAt: toIso(now.startOf("week")),
      endsAt: toIso(now.endOf("week")),
    });

    await ctx.reply(formatActivitySummary("This week", activities, config.timezone));
  });
}

function formatActivitySummary(
  title: string,
  activities: PlannedActivity[],
  timezone: string,
): string {
  if (activities.length === 0) {
    return `${title}: nothing planned yet.`;
  }

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
    ].join(" ");
  });

  return [title, "", ...lines].join("\n");
}

function toIso(dateTime: DateTime): string {
  const iso = dateTime.toISO();

  if (!iso) {
    throw new Error("Unable to format date-time as ISO");
  }

  return iso;
}
