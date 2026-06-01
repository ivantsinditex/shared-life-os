import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  NewWorkTask,
  TaskBasket,
  TaskStatus,
  WorkTask,
  WorkTaskRepository,
} from "../domain/task.js";

export class FileWorkTaskRepository implements WorkTaskRepository {
  private readonly filePath: string;
  private tasks: WorkTask[] = [];

  constructor(private readonly dataDir: string) {
    this.filePath = join(dataDir, "work-tasks.json");
  }

  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });

    try {
      const raw = await readFile(this.filePath, "utf8");
      this.tasks = JSON.parse(raw) as WorkTask[];
    } catch (error) {
      if (isMissingFile(error)) {
        this.tasks = [];
        await this.persist();
        return;
      }

      throw error;
    }
  }

  async create(task: NewWorkTask): Promise<WorkTask> {
    const now = new Date().toISOString();
    const created: WorkTask = {
      ...task,
      id: randomUUID(),
      status: task.status ?? "open",
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.push(created);
    await this.persist();
    return created;
  }

  async list(params: { basket?: TaskBasket; status?: TaskStatus } = {}): Promise<WorkTask[]> {
    return this.tasks
      .filter((task) => {
        const basketMatches = !params.basket || task.basket === params.basket;
        const statusMatches = !params.status || task.status === params.status;

        return basketMatches && statusMatches;
      })
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  }

  async getById(id: string): Promise<WorkTask | undefined> {
    return this.tasks.find((task) => task.id === id);
  }

  async update(task: WorkTask): Promise<WorkTask> {
    const index = this.tasks.findIndex((candidate) => candidate.id === task.id);

    if (index === -1) {
      throw new Error(`Work task not found: ${task.id}`);
    }

    const updated = {
      ...task,
      updatedAt: new Date().toISOString(),
    };

    this.tasks[index] = updated;
    await this.persist();
    return updated;
  }

  async findByShortId(shortId: string): Promise<WorkTask | undefined> {
    const matches = this.tasks.filter((task) => task.id.startsWith(shortId));

    return matches.length === 1 ? matches[0] : undefined;
  }

  private async persist(): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(this.tasks, null, 2));
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
