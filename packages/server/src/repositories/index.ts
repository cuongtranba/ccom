import type { PrismaClient } from "../../generated/prisma/client";
import { ProjectRepository } from "./project.repository";
import { TokenRepository } from "./token.repository";

export { ProjectRepository } from "./project.repository";
export { TokenRepository } from "./token.repository";
export type { TokenInfo, TokenValidation } from "./token.repository";

export interface Repositories {
  projects: ProjectRepository;
  tokens: TokenRepository;
}

export function createRepositories(prisma: PrismaClient): Repositories {
  return {
    projects: new ProjectRepository(prisma),
    tokens: new TokenRepository(prisma),
  };
}
