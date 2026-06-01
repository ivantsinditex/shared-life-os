import type { Participant } from "./planned-activity.js";
import type { TaskBasket } from "./task.js";

export type TimeEntry = {
  id: string;
  basket: TaskBasket;
  title: string;
  participant?: Participant;
  taskId?: string;
  startedAt: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type NewTimeEntry = Omit<TimeEntry, "id" | "createdAt" | "updatedAt">;

export interface TimeEntryRepository {
  init(): Promise<void>;
  create(entry: NewTimeEntry): Promise<TimeEntry>;
  listAll(): Promise<TimeEntry[]>;
  listBetween(params: { startsAt: string; endsAt: string; participant?: Participant }): Promise<TimeEntry[]>;
  getActive(params?: { participant?: Participant }): Promise<TimeEntry | undefined>;
  update(entry: TimeEntry): Promise<TimeEntry>;
}
