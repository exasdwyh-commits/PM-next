/**
 * 过程脚本（不提交）：给开发库既有测试账号设置统一口令。
 * 用途：seed 的默认口令是随机生成且未记录的，本地手动测试无法登录时使用。
 * 用法：tsx scripts/_set-dev-password.ts <newPassword>
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/modules/identity/session";

const prisma = new PrismaClient();

async function main() {
  const pw = process.argv[2];
  if (!pw || pw.length < 8) {
    console.error("需要参数：新口令（至少 8 位）");
    process.exit(1);
  }
  const hash = hashPassword(pw);
  const res = await prisma.user.updateMany({ data: { passwordHash: hash } });
  console.log("updated users:", res.count);
}

main()
  .catch((e) => {
    console.error("ERR", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
