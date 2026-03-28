import type { PrismaClient, Token } from "../../generated/prisma/client";

export interface TokenInfo {
  projectId: string;
  nodeId: string;
  createdAt: string;
}

export class TokenRepository {
  constructor(private prisma: PrismaClient) {}

  async create(projectId: string, nodeId: string): Promise<Token> {
    return this.prisma.token.create({ data: { projectId, nodeId } });
  }

  async validate(secret: string): Promise<{ projectId: string; nodeId: string } | null> {
    const token = await this.prisma.token.findUnique({
      where: { secret },
      select: { projectId: true, nodeId: true },
    });
    return token;
  }

  async revoke(secret: string): Promise<void> {
    await this.prisma.token.deleteMany({ where: { secret } });
  }

  async revokeByNode(projectId: string, nodeId: string): Promise<number> {
    const result = await this.prisma.token.deleteMany({ where: { projectId, nodeId } });
    return result.count;
  }

  async revokeByProject(projectId: string): Promise<number> {
    const result = await this.prisma.token.deleteMany({ where: { projectId } });
    return result.count;
  }

  async nodeExists(projectId: string, nodeId: string): Promise<boolean> {
    const count = await this.prisma.token.count({ where: { projectId, nodeId } });
    return count > 0;
  }

  async listAll(): Promise<TokenInfo[]> {
    const tokens = await this.prisma.token.findMany({
      select: { projectId: true, nodeId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    return tokens.map((t) => ({
      projectId: t.projectId,
      nodeId: t.nodeId,
      createdAt: t.createdAt.toISOString(),
    }));
  }

  async listByProject(projectId: string): Promise<TokenInfo[]> {
    const tokens = await this.prisma.token.findMany({
      where: { projectId },
      select: { projectId: true, nodeId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    return tokens.map((t) => ({
      projectId: t.projectId,
      nodeId: t.nodeId,
      createdAt: t.createdAt.toISOString(),
    }));
  }
}
