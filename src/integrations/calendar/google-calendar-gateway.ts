import { google, type calendar_v3 } from "googleapis";

import type { AppConfig } from "../../config/config.js";

export const DEFAULT_GOOGLE_EVENT_REMINDER_MINUTES = 30;

export type CalendarEventDraft = {
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  description?: string;
  colorId?: string;
  visibility?: "default" | "public" | "private" | "confidential";
  transparency?: "opaque" | "transparent";
  reminderMinutes?: number;
};

export type CalendarEventLink = {
  eventId: string;
  htmlLink?: string;
};

export type CalendarBusySlot = {
  startsAt: string;
  endsAt: string;
};

export type CalendarEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
};

export interface CalendarGateway {
  createEvent(draft: CalendarEventDraft): Promise<CalendarEventLink>;
  updateEvent(eventId: string, draft: CalendarEventDraft): Promise<CalendarEventLink>;
  deleteEvent(eventId: string): Promise<void>;
  listBusySlots(params: { startsAt: string; endsAt: string }): Promise<CalendarBusySlot[]>;
  listEvents(params: { startsAt: string; endsAt: string }): Promise<CalendarEvent[]>;
}

export function createCalendarGateway(config: AppConfig): CalendarGateway {
  if (!config.googleCalendarId || !config.googleClientEmail || !config.googlePrivateKey) {
    return new DisabledCalendarGateway();
  }

  return new GoogleCalendarGateway({
    ...config,
    googleCalendarId: config.googleCalendarId,
    googleClientEmail: config.googleClientEmail,
    googlePrivateKey: config.googlePrivateKey,
  });
}

export class GoogleCalendarGateway implements CalendarGateway {
  private readonly calendar = google.calendar("v3");
  private readonly auth;

  constructor(private readonly config: RequiredGoogleCalendarConfig) {
    this.auth = new google.auth.JWT({
      email: config.googleClientEmail,
      key: config.googlePrivateKey,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
  }

  async createEvent(draft: CalendarEventDraft): Promise<CalendarEventLink> {
    const response = await this.calendar.events.insert({
      auth: this.auth,
      calendarId: this.config.googleCalendarId,
      requestBody: toGoogleEvent(draft),
    });

    if (!response.data.id) {
      throw new Error("Google Calendar did not return an event id");
    }

    return {
      eventId: response.data.id,
      htmlLink: response.data.htmlLink ?? undefined,
    };
  }

  async updateEvent(eventId: string, draft: CalendarEventDraft): Promise<CalendarEventLink> {
    const response = await this.calendar.events.update({
      auth: this.auth,
      calendarId: this.config.googleCalendarId,
      eventId,
      requestBody: toGoogleEvent(draft),
    });

    if (!response.data.id) {
      throw new Error("Google Calendar did not return an event id");
    }

    return {
      eventId: response.data.id,
      htmlLink: response.data.htmlLink ?? undefined,
    };
  }

  async deleteEvent(eventId: string): Promise<void> {
    await this.calendar.events.delete({
      auth: this.auth,
      calendarId: this.config.googleCalendarId,
      eventId,
    });
  }

  async listBusySlots(params: { startsAt: string; endsAt: string }): Promise<CalendarBusySlot[]> {
    const response = await this.calendar.freebusy.query({
      auth: this.auth,
      requestBody: {
        timeMin: params.startsAt,
        timeMax: params.endsAt,
        items: [
          {
            id: this.config.googleCalendarId,
          },
        ],
      },
    });
    const busySlots = response.data.calendars?.[this.config.googleCalendarId]?.busy ?? [];

    return busySlots
      .filter((slot) => slot.start && slot.end)
      .map((slot) => ({
        startsAt: slot.start as string,
        endsAt: slot.end as string,
      }));
  }

  async listEvents(params: { startsAt: string; endsAt: string }): Promise<CalendarEvent[]> {
    const response = await this.calendar.events.list({
      auth: this.auth,
      calendarId: this.config.googleCalendarId,
      timeMin: params.startsAt,
      timeMax: params.endsAt,
      timeZone: this.config.timezone,
      singleEvents: true,
      orderBy: "startTime",
      showDeleted: false,
      maxResults: 2500,
    });

    return (response.data.items ?? [])
      .map(toCalendarEvent)
      .filter((event): event is CalendarEvent => Boolean(event));
  }
}

export class DisabledCalendarGateway implements CalendarGateway {
  async createEvent(): Promise<CalendarEventLink> {
    throw new Error("Google Calendar credentials are not configured");
  }

  async updateEvent(): Promise<CalendarEventLink> {
    throw new Error("Google Calendar credentials are not configured");
  }

  async deleteEvent(): Promise<void> {
    throw new Error("Google Calendar credentials are not configured");
  }

  async listBusySlots(): Promise<CalendarBusySlot[]> {
    return [];
  }

  async listEvents(_params: { startsAt: string; endsAt: string }): Promise<CalendarEvent[]> {
    throw new Error("Google Calendar credentials are not configured");
  }
}

type RequiredGoogleCalendarConfig = AppConfig & {
  googleCalendarId: string;
  googleClientEmail: string;
  googlePrivateKey: string;
};

export function toGoogleEvent(draft: CalendarEventDraft) {
  const reminderMinutes = draft.reminderMinutes ?? DEFAULT_GOOGLE_EVENT_REMINDER_MINUTES;

  return {
    summary: draft.title,
    description: draft.description,
    start: {
      dateTime: draft.startsAt,
      timeZone: draft.timezone,
    },
    end: {
      dateTime: draft.endsAt,
      timeZone: draft.timezone,
    },
    visibility: draft.visibility ?? "default",
    transparency: draft.transparency ?? "opaque",
    colorId: draft.colorId,
    reminders: {
      useDefault: false,
      overrides: [
        {
          method: "popup",
          minutes: reminderMinutes,
        },
      ],
    },
  };
}

function toCalendarEvent(event: calendar_v3.Schema$Event): CalendarEvent | undefined {
  const startsAt = event.start?.dateTime ?? event.start?.date;
  const endsAt = event.end?.dateTime ?? event.end?.date;

  if (!event.id || !startsAt || !endsAt) {
    return undefined;
  }

  return {
    id: event.id,
    title: event.summary ?? "Подія календаря",
    startsAt,
    endsAt,
  };
}
