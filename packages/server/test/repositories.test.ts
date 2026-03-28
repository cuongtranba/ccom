import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { ProjectRepository } from "../src/repositories/project.repository";
import { TokenRepository } from "../src/repositories/token.repository";

let prisma: PrismaClient;
let dbAvailable = false;

beforeAll(async () => {
  try {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL not set");
    const adapter = new PrismaPg(connectionString);
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();
    dbAvailable = true;
  } catch {
    console.warn("Postgres not available — skipping repository tests");
  }
});

afterAll(async () => {
  if (dbAvailable && prisma) {
    await prisma.$disconnect();
  }
});

beforeEach(async () => {
  if (!dbAvailable) return;
  await prisma.token.deleteMany();
  await prisma.project.deleteMany();
});

// ─── ProjectRepository ─────────────────────────────────────────────

describe("ProjectRepository", () => {
  let repo: ProjectRepository;

  beforeEach(() => {
    if (!dbAvailable) return;
    repo = new ProjectRepository(prisma);
  });

  test("create returns a project with id and name", async () => {
    if (!dbAvailable) return;

    const project = await repo.create("alpha");
    expect(project.id).toBeString();
    expect(project.name).toBe("alpha");
    expect(project.createdAt).toBeInstanceOf(Date);
  });

  test("exists returns true for existing project, false otherwise", async () => {
    if (!dbAvailable) return;

    expect(await repo.exists("alpha")).toBe(false);
    await repo.create("alpha");
    expect(await repo.exists("alpha")).toBe(true);
  });

  test("list returns projects sorted by name", async () => {
    if (!dbAvailable) return;

    await repo.create("charlie");
    await repo.create("alpha");
    await repo.create("bravo");

    const projects = await repo.list();
    expect(projects).toHaveLength(3);
    expect(projects.map((p) => p.name)).toEqual(["alpha", "bravo", "charlie"]);
  });

  test("create duplicate name throws", async () => {
    if (!dbAvailable) return;

    await repo.create("alpha");
    await expect(repo.create("alpha")).rejects.toThrow();
  });

  test("remove deletes a project", async () => {
    if (!dbAvailable) return;

    const project = await repo.create("alpha");
    await repo.remove(project.id);
    expect(await repo.exists("alpha")).toBe(false);
  });
});

// ─── TokenRepository ───────────────────────────────────────────────

describe("TokenRepository", () => {
  let projects: ProjectRepository;
  let tokens: TokenRepository;

  beforeEach(() => {
    if (!dbAvailable) return;
    projects = new ProjectRepository(prisma);
    tokens = new TokenRepository(prisma);
  });

  test("create + validate round-trip", async () => {
    if (!dbAvailable) return;

    const project = await projects.create("proj-1");
    const token = await tokens.create(project.id, "node-a");

    expect(token.secret).toBeString();
    expect(token.projectId).toBe(project.id);
    expect(token.nodeId).toBe("node-a");

    const result = await tokens.validate(token.secret);
    expect(result).toEqual({ projectId: project.id, nodeId: "node-a" });
  });

  test("validate returns null for invalid secret", async () => {
    if (!dbAvailable) return;

    const result = await tokens.validate("nonexistent-secret");
    expect(result).toBeNull();
  });

  test("duplicate projectId + nodeId throws", async () => {
    if (!dbAvailable) return;

    const project = await projects.create("proj-1");
    await tokens.create(project.id, "node-a");
    await expect(tokens.create(project.id, "node-a")).rejects.toThrow();
  });

  test("nodeExists returns correct boolean", async () => {
    if (!dbAvailable) return;

    const project = await projects.create("proj-1");
    expect(await tokens.nodeExists(project.id, "node-a")).toBe(false);

    await tokens.create(project.id, "node-a");
    expect(await tokens.nodeExists(project.id, "node-a")).toBe(true);
  });

  test("revokeByNode removes token and returns count", async () => {
    if (!dbAvailable) return;

    const project = await projects.create("proj-1");
    const token = await tokens.create(project.id, "node-a");

    const count = await tokens.revokeByNode(project.id, "node-a");
    expect(count).toBe(1);

    const result = await tokens.validate(token.secret);
    expect(result).toBeNull();
  });

  test("revokeByProject removes all tokens for a project", async () => {
    if (!dbAvailable) return;

    const project = await projects.create("proj-1");
    await tokens.create(project.id, "node-a");
    await tokens.create(project.id, "node-b");

    const count = await tokens.revokeByProject(project.id);
    expect(count).toBe(2);

    expect(await tokens.nodeExists(project.id, "node-a")).toBe(false);
    expect(await tokens.nodeExists(project.id, "node-b")).toBe(false);
  });

  test("listAll returns tokens across projects", async () => {
    if (!dbAvailable) return;

    const p1 = await projects.create("proj-1");
    const p2 = await projects.create("proj-2");
    await tokens.create(p1.id, "node-a");
    await tokens.create(p2.id, "node-b");

    const all = await tokens.listAll();
    expect(all).toHaveLength(2);

    for (const info of all) {
      expect(info.projectId).toBeString();
      expect(info.nodeId).toBeString();
      expect(info.createdAt).toBeString();
      // Verify ISO date format
      expect(new Date(info.createdAt).toISOString()).toBe(info.createdAt);
    }
  });

  test("listByProject filters tokens by project", async () => {
    if (!dbAvailable) return;

    const p1 = await projects.create("proj-1");
    const p2 = await projects.create("proj-2");
    await tokens.create(p1.id, "node-a");
    await tokens.create(p1.id, "node-b");
    await tokens.create(p2.id, "node-c");

    const p1Tokens = await tokens.listByProject(p1.id);
    expect(p1Tokens).toHaveLength(2);
    expect(p1Tokens.every((t) => t.projectId === p1.id)).toBe(true);

    const p2Tokens = await tokens.listByProject(p2.id);
    expect(p2Tokens).toHaveLength(1);
    expect(p2Tokens[0].nodeId).toBe("node-c");
  });

  test("revoke deletes a single token by secret", async () => {
    if (!dbAvailable) return;

    const project = await projects.create("proj-1");
    const token = await tokens.create(project.id, "node-a");

    await tokens.revoke(token.secret);
    const result = await tokens.validate(token.secret);
    expect(result).toBeNull();
  });

  test("cascade delete removes tokens when project is removed", async () => {
    if (!dbAvailable) return;

    const project = await projects.create("proj-1");
    const token = await tokens.create(project.id, "node-a");

    await projects.remove(project.id);

    const result = await tokens.validate(token.secret);
    expect(result).toBeNull();
  });
});
