import { spawn } from "node:child_process";
import prisma from "../src/shared/db";
import { LOCAL_TEST_EMAIL, LOCAL_TEST_ORG } from "../src/modules/identity/local-test-policy";
import { ensureWorkspaceSetup } from "../src/modules/workspace/setup";

async function main() {
  await prisma.$transaction(async tx => {
    const org = await tx.organization.upsert({
      where: { code: LOCAL_TEST_ORG }, update: {},
      create: { code: LOCAL_TEST_ORG, name: "Kern 本地测试" },
    });
    const existing = await tx.user.findUnique({ where: { email: LOCAL_TEST_EMAIL } });
    if (existing) {
      if (existing.organizationId !== org.id || existing.isSystem || !existing.isActive) {
        throw new Error("保留的测试账号不符合配置，拒绝覆盖。");
      }
    } else {
      await tx.user.create({ data: {
        email: LOCAL_TEST_EMAIL, name: "本地测试", organizationId: org.id,
        orgMemberships: { create: { organizationId: org.id, role: "ORG_ADMIN" } },
      } });
    }
  });
  const user = await prisma.user.findUniqueOrThrow({ where: { email: LOCAL_TEST_EMAIL } });
  await ensureWorkspaceSetup({ userId: user.id, organizationId: user.organizationId, userEmail: user.email, userName: user.name });
  await prisma.$disconnect();
  console.log("本地测试入口：http://127.0.0.1:3100/login（独立测试工作区）");
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development", DEV_MOCK_AUTH: "false", KERN_LOCAL_TEST_LOGIN: "true", NEXT_DIST_DIR: ".next-local-test" };
  const children = [
    spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", "3100"], { stdio: "inherit", env }),
    spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/pm-worker.ts", `--organization-id=${user.organizationId}`, "--quiet"], {
      stdio: "inherit", env: { ...env, NODE_ENV: "production", PM_WORKER_LOCK_DIR: ".pm-worker-local-test" },
    }),
  ];
  let stopping = false;
  const stop = (signal: "SIGINT" | "SIGTERM" = "SIGTERM") => {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill(signal);
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => stop(signal));
  for (const child of children) {
    child.on("error", error => { console.error(error.message); process.exitCode = 1; stop(); });
    child.on("exit", code => { if (!stopping) { process.exitCode = code ?? 1; stop(); } });
  }
}

main().catch(async error => {
  console.error(error.message);
  await prisma.$disconnect();
  process.exitCode = 1;
});
