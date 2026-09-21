import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  // A) 复现：inputRevision 显式 undefined 时，Prisma 的错误长什么样
  try {
    await prisma.runReceipt.create({
      data: {
        workItemId: "00000000-0000-0000-0000-000000000000",
        inputRevision: undefined as unknown as number,
        runMode: undefined as any,
        status: "SUCCESS" as any,
        errorMessage: undefined,
        endedAt: new Date("2026-09-15T16:22:13.572Z"),
      },
    });
  } catch (e: any) {
    console.log("=== A) inputRevision: undefined → Prisma 报错正文 ===");
    console.log(String(e.message));
  }

  // B) 复现：整个键都不传
  try {
    await prisma.runReceipt.create({
      data: {
        workItemId: "00000000-0000-0000-0000-000000000000",
        runMode: undefined as any,
        status: "SUCCESS" as any,
        errorMessage: undefined,
        endedAt: new Date("2026-09-15T16:22:13.572Z"),
      } as any,
    });
  } catch (e: any) {
    console.log("\n=== B) 键完全缺失 → Prisma 报错正文 ===");
    console.log(String(e.message));
  }
  await prisma.$disconnect();
}
main();
