import { DateTime } from "luxon";
import type { Bot } from "grammy";

import type { AppConfig } from "../../config/config.js";
import type { PlannedActivity } from "../../domain/planned-activity.js";
import type { PlannedActivityRepository } from "../../domain/planned-activity.js";
import type { Logger } from "../../utils/logger.js";

type PlanningCommandDeps = {
  bot: Bot;
  config: AppConfig;
  logger: Logger;
  plannedActivities: PlannedActivityRepository;
};

export function createPlanningCommands(deps: PlanningCommandDeps): void {
  const { bot, config, logger, plannedActivities } = deps;

  bot.command("start", async (ctx) => {
    await ctx.reply(
      [
        "Shared Life OS is awake.",
        "",
        "Available now:",
        "/health - check bot status",
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
