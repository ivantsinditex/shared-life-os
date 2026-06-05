import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  normalizeProjectName,
  type NewWorkProject,
  type WorkProject,
  type WorkProjectRepository,
  type WorkProjectStatus,
} from "../domain/work-project.js";

export class FileWorkProjectRepository implements WorkProjectRepository {
  private readonly filePath: string;
  private projects: WorkProject[] = [];

  constructor(private readonly dataDir: string) {
    this.filePath = join(dataDir, "work-projects.json");
  }

  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });

    try {
      const raw = await readFile(this.filePath, "utf8");
      this.projects = JSON.parse(raw) as WorkProject[];
    } catch (error) {
      if (isMissingFile(error)) {
        this.projects = [];
        await this.persist();
        return;
      }

      throw error;
    }
  }

  async create(project: NewWorkProject): Promise<WorkProject> {
    const existing = await this.findByName(project.name);

    if (existing && existing.status === "active") {
      return existing;
    }

    const now = new Date().toISOString();
    const created: WorkProject = {
      id: randomUUID(),
      name: project.name.trim().replace(/\s+/g, " "),
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    this.projects.push(created);
    await this.persist();
    return created;
  }

  async list(params: { status?: WorkProjectStatus } = {}): Promise<WorkProject[]> {
    return this.projects
      .filter((project) => !params.status || project.status === params.status)
      .sort((left, right) => left.name.localeCompare(right.name, "uk"));
  }

  async findByName(name: string): Promise<WorkProject | undefined> {
    const normalized = normalizeProjectName(name);

    return this.projects.find((project) => normalizeProjectName(project.name) === normalized);
  }

  async update(project: WorkProject): Promise<WorkProject> {
    const index = this.projects.findIndex((candidate) => candidate.id === project.id);

    if (index === -1) {
      throw new Error(`Work project not found: ${project.id}`);
    }

    const updated = {
      ...project,
      name: project.name.trim().replace(/\s+/g, " "),
      updatedAt: new Date().toISOString(),
    };

    this.projects[index] = updated;
    await this.persist();
    return updated;
  }

  private async persist(): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(this.projects, null, 2));
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
