import type { Participant } from "./planned-activity.js";

export const taskBaskets = [
  "911",
  "operational",
  "deep_work",
  "random",
  "personal_brand",
  "other",
] as const;
export type TaskBasket = (typeof taskBaskets)[number];

export const taskStatuses = ["open", "blocked", "closed"] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export const taskPriorities = ["P1", "P2", "P3", "P4"] as const;
export type TaskPriority = (typeof taskPriorities)[number];

export type WorkTask = {
  id: string;
  title: string;
  basket: TaskBasket;
  project?: string;
  priority?: TaskPriority;
  deadline?: string;
  participant?: Participant;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
};

export type NewWorkTask = Omit<WorkTask, "id" | "status" | "createdAt" | "updatedAt" | "closedAt"> & {
  status?: TaskStatus;
};

export interface WorkTaskRepository {
  init(): Promise<void>;
  create(task: NewWorkTask): Promise<WorkTask>;
  list(params?: { basket?: TaskBasket; project?: string; status?: TaskStatus }): Promise<WorkTask[]>;
  getById(id: string): Promise<WorkTask | undefined>;
  update(task: WorkTask): Promise<WorkTask>;
  findByShortId(shortId: string): Promise<WorkTask | undefined>;
}
