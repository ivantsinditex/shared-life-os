export type CalendarEventDraft = {
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  description?: string;
};

export type CalendarEventLink = {
  eventId: string;
  htmlLink?: string;
};

export interface CalendarGateway {
  createEvent(draft: CalendarEventDraft): Promise<CalendarEventLink>;
  updateEvent(eventId: string, draft: CalendarEventDraft): Promise<CalendarEventLink>;
  deleteEvent(eventId: string): Promise<void>;
}

export class GoogleCalendarGateway implements CalendarGateway {
  async createEvent(): Promise<CalendarEventLink> {
    throw new Error("Google Calendar integration is planned for T4.");
  }

  async updateEvent(): Promise<CalendarEventLink> {
    throw new Error("Google Calendar integration is planned for T4.");
  }

  async deleteEvent(): Promise<void> {
    throw new Error("Google Calendar integration is planned for T4.");
  }
}
