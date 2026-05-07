import { defineConfig } from "drizzle-kit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const valueRaw = trimmed.slice(eqIndex + 1).trim();
    if (!key) continue;
    if (process.env[key] !== undefined) continue;
    const value = valueRaw.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    process.env[key] = value;
  }
}

loadEnvFile(path.resolve(currentDir, "../../artifacts/api-server/.env"));
loadEnvFile(path.resolve(currentDir, "../../artifacts/.env"));

const connectionString =
  process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "NEON_DATABASE_URL must be set. Did you forget to configure the Neon database?",
  );
}

export default defineConfig({
  schema: "./src/schema/drizzle-kit-schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
