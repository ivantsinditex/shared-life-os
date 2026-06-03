import { z } from "zod";

const optionalTelegramUserId = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.coerce.number().optional(),
);

const optionalReminderMinutes = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.coerce.number().int().nonnegative().default(30),
);

const configSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  APP_TIMEZONE: z.string().default("Europe/Kiev"),
  DATA_DIR: z.string().default("./data"),
  GOOGLE_CALENDAR_ID: z.string().optional(),
  GOOGLE_CLIENT_EMAIL: z.string().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),
  GOOGLE_EVENT_REMINDER_MINUTES: optionalReminderMinutes,
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_TRANSCRIPTION_MODEL: z.string().default("gpt-4o-mini-transcribe"),
  OPENAI_PLANNING_MODEL: z.string().default("gpt-4o-mini"),
  VANIA_TELEGRAM_USER_ID: optionalTelegramUserId,
  NASTIA_TELEGRAM_USER_ID: optionalTelegramUserId,
});

export type AppConfig = {
  telegramBotToken: string;
  timezone: string;
  dataDir: string;
  googleCalendarId?: string;
  googleClientEmail?: string;
  googlePrivateKey?: string;
  googleEventReminderMinutes: number;
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
    googlePrivateKey: normalizeGooglePrivateKey(env.GOOGLE_PRIVATE_KEY),
    googleEventReminderMinutes: env.GOOGLE_EVENT_REMINDER_MINUTES,
    openAiApiKey: env.OPENAI_API_KEY,
    openAiTranscriptionModel: env.OPENAI_TRANSCRIPTION_MODEL,
    openAiPlanningModel: env.OPENAI_PLANNING_MODEL,
    users: [
      {
        key: "vania",
        displayName: "Vania",
        telegramUserId: env.VANIA_TELEGRAM_USER_ID,
      },
      {
        key: "nastia",
        displayName: "Nastia",
        telegramUserId: env.NASTIA_TELEGRAM_USER_ID,
      },
    ],
  };
}

function normalizeGooglePrivateKey(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  const unquoted = (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  )
    ? trimmed.slice(1, -1)
    : trimmed;

  return unquoted.replace(/\\n/g, "\n");
}
