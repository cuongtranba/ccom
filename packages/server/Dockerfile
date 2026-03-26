FROM oven/bun:1

WORKDIR /app

# Copy workspace root config
COPY package.json bun.lock bunfig.toml tsconfig.json ./

# Copy only the packages the server needs (shared + server)
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/

# Install dependencies
RUN bun install

EXPOSE 4400

CMD ["bun", "run", "packages/server/src/index.ts", "start", "--port", "4400", "--redis", "redis://redis:6379"]
