import { google } from "googleapis";

import type { AppConfig } from "../../config/config.js";

export type CalendarEventDraft = {
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  description?: string;
  colorId?: string;
  visibility?: "default" | "public" | "private" | "confidential";
  transparency?: "opaque" | "transparent";
};

export type CalendarEventLink = {
  eventId: string;
  htmlLink?: string;
};

export type CalendarBusySlot = {
  startsAt: string;
  endsAt: string;
};

export interface CalendarGateway {
  createEvent(draft: CalendarEventDraft): Promise<CalendarEventLink>;
  updateEvent(eventId: string, draft: CalendarEventDraft): Promise<CalendarEventLink>;
  deleteEvent(eventId: string): Promise<void>;
  listBusySlots(params: { startsAt: string; endsAt: string }): Promise<CalendarBusySlot[]>;
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
}

type RequiredGoogleCalendarConfig = AppConfig & {
  googleCalendarId: string;
  googleClientEmail: string;
  googlePrivateKey: string;
};

function toGoogleEvent(draft: CalendarEventDraft) {
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
  };
}
