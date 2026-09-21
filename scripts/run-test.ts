import { spawn } from "node:child_process";
import { loadEnvFiles } from "../src/shared/env";

loadEnvFiles();
const target = process.argv[2];
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!target || !databaseUrl) throw new Error("Test script and TEST_DATABASE_URL are required");
if (!new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("Test database required");

// Select the test database before any application module is imported.
const child = spawn(process.execPath, ["--import", "tsx", target, ...process.argv.slice(3)], {
  env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "test" },
  stdio: "inherit",
});
child.on("error", () => { process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
