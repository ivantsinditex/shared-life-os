import { Bot } from "grammy";

import type { AppConfig } from "../config/config.js";
import { createAnalyticsInsightsGateway } from "../integrations/ai/openai-analytics-insights-gateway.js";
import { createAssistantAgentGateway } from "../integrations/ai/openai-assistant-agent-gateway.js";
import { createPlanningTextParserGateway } from "../integrations/ai/openai-planning-parser-gateway.js";
import { createCalendarGateway } from "../integrations/calendar/google-calendar-gateway.js";
import { createAnalyticsCommands } from "../integrations/telegram/analytics-commands.js";
import { createPlanningCommands } from "../integrations/telegram/planning-commands.js";
import { createTaskCommands } from "../integrations/telegram/task-commands.js";
import { createTimeCommands } from "../integrations/telegram/time-commands.js";
import { createVoiceTranscriptionGateway } from "../integrations/voice/openai-transcription-gateway.js";
import { FilePlannedActivityRepository } from "../storage/file-planned-activity-repository.js";
import { FileTimeEntryRepository } from "../storage/file-time-entry-repository.js";
import { FileWorkProjectRepository } from "../storage/file-work-project-repository.js";
import { FileWorkTaskRepository } from "../storage/file-work-task-repository.js";
import { ConsoleLogger } from "../utils/logger.js";

export type App = {
  start: () => Promise<void>;
};

export function createApp(config: AppConfig): App {
  const logger = new ConsoleLogger();
  const bot = new Bot(config.telegramBotToken);
  const plannedActivities = new FilePlannedActivityRepository(config.dataDir);
  const workProjects = new FileWorkProjectRepository(config.dataDir);
  const workTasks = new FileWorkTaskRepository(config.dataDir);
  const timeEntries = new FileTimeEntryRepository(config.dataDir);
  const calendar = createCalendarGateway(config);
  const voiceTranscription = createVoiceTranscriptionGateway(config);
  const analyticsInsights = createAnalyticsInsightsGateway(config);
  const assistantAgent = createAssistantAgentGateway(config);
  const planningTextParser = createPlanningTextParserGateway(config);

  createTaskCommands({
    bot,
    config,
    timeEntries,
    workProjects,
    workTasks,
  });
  createTimeCommands({
    bot,
    config,
    timeEntries,
    workTasks,
  });
  createAnalyticsCommands({
    bot,
    config,
    analyticsInsights,
    plannedActivities,
    timeEntries,
    workTasks,
  });
  createPlanningCommands({
    bot,
    assistantAgent,
    calendar,
    config,
    logger,
    plannedActivities,
    planningTextParser,
    timeEntries,
    voiceTranscription,
    workTasks,
  });

  return {
    async start() {
      logger.info("Starting Shared Life OS bot", {
        timezone: config.timezone,
        dataDir: config.dataDir,
      });

      await plannedActivities.init();
      await workProjects.init();
      await workTasks.init();
      await timeEntries.init();
      await bot.start();
    },
  };
}
