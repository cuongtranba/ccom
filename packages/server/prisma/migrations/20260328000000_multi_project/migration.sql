-- Step 1: Add new columns to tokens
ALTER TABLE "tokens" ADD COLUMN "name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "tokens" ADD COLUMN "vertical" TEXT NOT NULL DEFAULT '';
ALTER TABLE "tokens" ADD COLUMN "owner" TEXT NOT NULL DEFAULT '';

-- Step 2: Create join table
CREATE TABLE "token_projects" (
    "token_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    CONSTRAINT "token_projects_pkey" PRIMARY KEY ("token_id","project_id")
);

-- Step 3: Migrate existing data (each token's projectId → token_projects row)
INSERT INTO "token_projects" ("token_id", "project_id")
SELECT "id", "project_id" FROM "tokens" WHERE "project_id" IS NOT NULL;

-- Step 4: Drop old foreign key and column
ALTER TABLE "tokens" DROP CONSTRAINT IF EXISTS "tokens_project_id_fkey";
ALTER TABLE "tokens" DROP COLUMN "project_id";

-- Step 5: Drop old unique constraint and add new one
ALTER TABLE "tokens" DROP CONSTRAINT IF EXISTS "tokens_project_id_node_id_key";
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_node_id_key" UNIQUE ("node_id");

-- Step 6: Add foreign keys to join table
ALTER TABLE "token_projects" ADD CONSTRAINT "token_projects_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "token_projects" ADD CONSTRAINT "token_projects_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
