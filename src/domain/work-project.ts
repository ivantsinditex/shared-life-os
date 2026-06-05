export const workProjectStatuses = ["active", "archived"] as const;
export type WorkProjectStatus = (typeof workProjectStatuses)[number];

export type WorkProject = {
  id: string;
  name: string;
  status: WorkProjectStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};

export type NewWorkProject = Pick<WorkProject, "name">;

export interface WorkProjectRepository {
  init(): Promise<void>;
  create(project: NewWorkProject): Promise<WorkProject>;
  list(params?: { status?: WorkProjectStatus }): Promise<WorkProject[]>;
  findByName(name: string): Promise<WorkProject | undefined>;
  update(project: WorkProject): Promise<WorkProject>;
}

export function normalizeProjectName(name: string | undefined): string {
  return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}
