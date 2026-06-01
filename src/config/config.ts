import { z } from "zod";

const configSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  APP_TIMEZONE: z.string().default("Europe/Kiev"),
  DATA_DIR: z.string().default("./data"),
  GOOGLE_CALENDAR_ID: z.string().optional(),
  GOOGLE_CLIENT_EMAIL: z.string().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_TRANSCRIPTION_MODEL: z.string().default("gpt-4o-mini-transcribe"),
  OPENAI_PLANNING_MODEL: z.string().default("gpt-4o-mini"),
});

export type AppConfig = {
  telegramBotToken: string;
  timezone: string;
  dataDir: string;
  googleCalendarId?: string;
  googleClientEmail?: string;
  googlePrivateKey?: string;
  openAiApiKey?: string;
  openAiTranscriptionModel: string;
  openAiPlanningModel: string;
  users: KnownUser[];
};

export type KnownUser = {
  key: "vania" | "nastia";
  telegramUserId?: number;
  displayName: string;
};

export function loadConfig(): AppConfig {
  const env = configSchema.parse(process.env);

  return {
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    timezone: env.APP_TIMEZONE,
    dataDir: env.DATA_DIR,
    googleCalendarId: env.GOOGLE_CALENDAR_ID,
    googleClientEmail: env.GOOGLE_CLIENT_EMAIL,
    googlePrivateKey: env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    openAiApiKey: env.OPENAI_API_KEY,
    openAiTranscriptionModel: env.OPENAI_TRANSCRIPTION_MODEL,
    openAiPlanningModel: env.OPENAI_PLANNING_MODEL,
    users: [
      {
        key: "vania",
        displayName: "Vania",
      },
      {
        key: "nastia",
        displayName: "Nastia",
      },
    ],
  };
}
