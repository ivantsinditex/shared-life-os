export const participants = ["vania", "nastia", "both"] as const;
export type Participant = (typeof participants)[number];

export const activityCategories = [
  "sport",
  "work",
  "learning",
  "reading",
  "dogs",
  "horse",
  "care",
  "together",
  "other",
] as const;
export type ActivityCategory = (typeof activityCategories)[number];

export const privacyLevels = ["private", "busy_only", "shared_details"] as const;
export type PrivacyLevel = (typeof privacyLevels)[number];

export const calendarSyncStatuses = [
  "pending",
  "synced",
  "sync_failed",
  "externally_changed",
  "deleted",
] as const;
export type CalendarSyncStatus = (typeof calendarSyncStatuses)[number];

export type PlannedActivity = {
  id: string;
  title: string;
  participant: Participant;
  category: ActivityCategory;
  startsAt: string;
  endsAt: string;
  timezone: string;
  privacy: PrivacyLevel;
  isSharedActivity: boolean;
  recurrenceGroupId?: string;
  googleCalendarEventId?: string;
  syncStatus: CalendarSyncStatus;
  createdAt: string;
  updatedAt: string;
};

export type NewPlannedActivity = Omit<
  PlannedActivity,
  "id" | "createdAt" | "updatedAt" | "syncStatus"
> & {
  syncStatus?: CalendarSyncStatus;
};

export interface PlannedActivityRepository {
  init(): Promise<void>;
  create(activity: NewPlannedActivity): Promise<PlannedActivity>;
  listBetween(params: {
    startsAt: string;
    endsAt: string;
    participant?: Participant;
  }): Promise<PlannedActivity[]>;
  getById(id: string): Promise<PlannedActivity | undefined>;
  update(activity: PlannedActivity): Promise<PlannedActivity>;
}
