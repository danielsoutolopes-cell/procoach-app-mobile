type EnvMap = Record<string, string>;

function parseEnv(content: string): EnvMap {
  const result: EnvMap = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    if (!key) continue;
    let value = line.slice(eqIndex + 1).trim();
    value = value.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    result[key] = value;
  }
  return result;
}

async function loadEnvFiles(filePaths: string[]) {
  const fs = await import("node:fs");
  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) continue;
    const env = parseEnv(fs.readFileSync(filePath, "utf8"));
    for (const [key, value] of Object.entries(env)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

const path = await import("node:path");
const url = await import("node:url");
const currentFilePath = url.fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);

await loadEnvFiles([
  path.resolve(currentDir, "../.env"),
  path.resolve(currentDir, "../../.env"),
]);

const { default: app } = await import("./app");
const { logger } = await import("./lib/logger");

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
