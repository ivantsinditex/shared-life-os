import { Bot } from "grammy";

import type { AppConfig } from "../config/config.js";
import { createPlanningCommands } from "../integrations/telegram/planning-commands.js";
import { FilePlannedActivityRepository } from "../storage/file-planned-activity-repository.js";
import { ConsoleLogger } from "../utils/logger.js";

export type App = {
  start: () => Promise<void>;
};

export function createApp(config: AppConfig): App {
  const logger = new ConsoleLogger();
  const bot = new Bot(config.telegramBotToken);
  const plannedActivities = new FilePlannedActivityRepository(config.dataDir);

  createPlanningCommands({
    bot,
    config,
    logger,
    plannedActivities,
  });

  return {
    async start() {
      logger.info("Starting Shared Life OS bot", {
        timezone: config.timezone,
        dataDir: config.dataDir,
      });

      await plannedActivities.init();
      await bot.start();
    },
  };
}
