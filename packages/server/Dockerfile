## Stage 1: Build admin UI with Node/pnpm
FROM node:22-alpine AS admin-build

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY packages/admin/package.json packages/admin/
RUN cd packages/admin && pnpm install --frozen-lockfile || pnpm install
COPY packages/admin/ packages/admin/
RUN cd packages/admin && pnpm build

## Stage 2: Server runtime with Bun
FROM oven/bun:1

WORKDIR /app

# Copy workspace root config
COPY package.json bun.lock bunfig.toml tsconfig.json ./

# Copy only the packages the server needs (shared + server)
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/

# Copy built admin UI from stage 1
COPY --from=admin-build /app/packages/admin/dist/ packages/admin/dist/

# Install dependencies
RUN bun install

# Generate Prisma client (dummy URL — generate only needs the provider, not a real connection)
RUN cd packages/server && DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" bunx prisma generate

EXPOSE 4400

# Run migrations then start server
CMD ["sh", "-c", "cd packages/server && bunx prisma migrate deploy && cd /app && bun run packages/server/src/index.ts start --port 4400 --redis ${REDIS_URL:-redis://redis:6379}"]
