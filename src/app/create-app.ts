import { Bot } from "grammy";

import type { AppConfig } from "../config/config.js";
import { createAssistantAgentGateway } from "../integrations/ai/openai-assistant-agent-gateway.js";
import { createPlanningTextParserGateway } from "../integrations/ai/openai-planning-parser-gateway.js";
import { createCalendarGateway } from "../integrations/calendar/google-calendar-gateway.js";
import { createPlanningCommands } from "../integrations/telegram/planning-commands.js";
import { createVoiceTranscriptionGateway } from "../integrations/voice/openai-transcription-gateway.js";
import { FilePlannedActivityRepository } from "../storage/file-planned-activity-repository.js";
import { ConsoleLogger } from "../utils/logger.js";

export type App = {
  start: () => Promise<void>;
};

export function createApp(config: AppConfig): App {
  const logger = new ConsoleLogger();
  const bot = new Bot(config.telegramBotToken);
  const plannedActivities = new FilePlannedActivityRepository(config.dataDir);
  const calendar = createCalendarGateway(config);
  const voiceTranscription = createVoiceTranscriptionGateway(config);
  const assistantAgent = createAssistantAgentGateway(config);
  const planningTextParser = createPlanningTextParserGateway(config);

  createPlanningCommands({
    bot,
    assistantAgent,
    calendar,
    config,
    logger,
    plannedActivities,
    planningTextParser,
    voiceTranscription,
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
