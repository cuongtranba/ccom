import type { PrismaClient, Project } from "../../generated/prisma/client";

export class ProjectRepository {
  constructor(private prisma: PrismaClient) {}

  async create(name: string): Promise<Project> {
    return this.prisma.project.create({ data: { name } });
  }

  async exists(name: string): Promise<boolean> {
    const count = await this.prisma.project.count({ where: { name } });
    return count > 0;
  }

  async list(): Promise<Project[]> {
    return this.prisma.project.findMany({ orderBy: { name: "asc" } });
  }

  async remove(id: string): Promise<void> {
    await this.prisma.project.delete({ where: { id } });
  }
}
