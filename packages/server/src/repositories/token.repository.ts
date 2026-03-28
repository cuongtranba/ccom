import type { PrismaClient, Token } from "../../generated/prisma/client";

export interface TokenInfo {
  id: string;
  nodeId: string;
  name: string;
  vertical: string;
  owner: string;
  projects: string[];
  createdAt: string;
}

export interface TokenValidation {
  tokenId: string;
  nodeId: string;
  name: string;
  vertical: string;
  owner: string;
  projects: { id: string; name: string }[];
}

export class TokenRepository {
  constructor(private prisma: PrismaClient) {}

  async create(input: {
    nodeId: string;
    name: string;
    vertical: string;
    owner: string;
  }): Promise<Token> {
    return this.prisma.token.create({
      data: {
        nodeId: input.nodeId,
        name: input.name,
        vertical: input.vertical,
        owner: input.owner,
      },
    });
  }

  async validate(secret: string): Promise<TokenValidation | null> {
    const token = await this.prisma.token.findUnique({
      where: { secret },
      include: { projects: { include: { project: true } } },
    });
    if (!token) return null;
    return {
      tokenId: token.id,
      nodeId: token.nodeId,
      name: token.name,
      vertical: token.vertical,
      owner: token.owner,
      projects: token.projects.map((tp) => ({
        id: tp.projectId,
        name: tp.project.name,
      })),
    };
  }

  async assignProject(tokenId: string, projectId: string): Promise<void> {
    await this.prisma.tokenProject.create({
      data: { tokenId, projectId },
    });
  }

  async unassignProject(tokenId: string, projectId: string): Promise<void> {
    await this.prisma.tokenProject.delete({
      where: { tokenId_projectId: { tokenId, projectId } },
    });
  }

  async revoke(secret: string): Promise<void> {
    await this.prisma.token.deleteMany({ where: { secret } });
  }

  async revokeById(id: string): Promise<void> {
    await this.prisma.token.delete({ where: { id } });
  }

  async revokeByNode(nodeId: string): Promise<number> {
    const result = await this.prisma.token.deleteMany({ where: { nodeId } });
    return result.count;
  }

  async revokeByProject(projectId: string): Promise<number> {
    const assignments = await this.prisma.tokenProject.findMany({
      where: { projectId },
    });
    await this.prisma.tokenProject.deleteMany({ where: { projectId } });
    return assignments.length;
  }

  async nodeExists(nodeId: string): Promise<boolean> {
    const count = await this.prisma.token.count({ where: { nodeId } });
    return count > 0;
  }

  async findByNodeId(nodeId: string): Promise<Token | null> {
    return this.prisma.token.findUnique({ where: { nodeId } });
  }

  async listAll(): Promise<TokenInfo[]> {
    const tokens = await this.prisma.token.findMany({
      include: { projects: { include: { project: true } } },
      orderBy: { createdAt: "asc" },
    });
    return tokens.map((t) => ({
      id: t.id,
      nodeId: t.nodeId,
      name: t.name,
      vertical: t.vertical,
      owner: t.owner,
      projects: t.projects.map((tp) => tp.project.name),
      createdAt: t.createdAt.toISOString(),
    }));
  }

  async listByProject(projectId: string): Promise<TokenInfo[]> {
    const tokens = await this.prisma.token.findMany({
      where: { projects: { some: { projectId } } },
      include: { projects: { include: { project: true } } },
      orderBy: { createdAt: "asc" },
    });
    return tokens.map((t) => ({
      id: t.id,
      nodeId: t.nodeId,
      name: t.name,
      vertical: t.vertical,
      owner: t.owner,
      projects: t.projects.map((tp) => tp.project.name),
      createdAt: t.createdAt.toISOString(),
    }));
  }
}
