/**
 * B01-01 管理员建号脚本（无公共注册的唯一开号入口）
 *
 * 用法：
 *   npx tsx scripts/create-user.ts --email a@b.test --name "张三" --password '...' [--org-code HERMES_FOOD_DEV | --org-name "新组织名"] [--org-role ORG_ADMIN|MEMBER]
 *
 * --org-role（默认 MEMBER）：写入 OrganizationMember，决定**公司级**能力
 *   （知识源配置 / 公司事实录入）。与项目角色（ProjectMember）无关。
 *   注意：授予 ORG_ADMIN 等于交出服务器知识库根路径等配置的读取权，请按需最小授予。
 *
 * 约束：
 * - 不写死任何口令；密码必须显式提供（参数或 NEW_USER_PASSWORD 环境变量）且不少于 8 位；
 * - 输出只包含用户 ID / 邮箱 / 组织 / 组织角色，不回显口令；
 * - 组织不存在且未提供 --org-name 时失败，不静默建组织。
 */

import { OrgRole, PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/modules/identity/session";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email");
  const name = arg("name");
  const password = arg("password") ?? process.env.NEW_USER_PASSWORD;
  let orgCode = arg("org-code");
  const orgName = arg("org-name");
  /**
   * 公司级角色（OrganizationMember.role）：ORG_ADMIN | MEMBER，默认 MEMBER。
   * 2026-09-16 起这不再是「仅记录的说明字段」——它决定知识源配置 / 公司事实录入能力。
   * 项目内角色仍由 ProjectMember 管理，两者互不推断。
   */
  const orgRoleArg = (arg("org-role") ?? "MEMBER").toUpperCase();

  if (!email || !name || !password) {
    console.error("缺少必填参数：--email、--name、--password（或 NEW_USER_PASSWORD 环境变量）");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("口令强度不足：至少 8 位。拒绝创建。");
    process.exit(1);
  }
  if (orgRoleArg !== "ORG_ADMIN" && orgRoleArg !== "MEMBER") {
    console.error(`--org-role 只能是 ORG_ADMIN 或 MEMBER（收到：${orgRoleArg}）`);
    process.exit(1);
  }

  if (!orgCode && !orgName) {
    console.error("必须指定 --org-code（既有组织）或同时提供 --org-name（新建组织）");
    process.exit(1);
  }

  if (orgName && !orgCode) {
    orgCode = `ORG_${Date.now().toString(36).toUpperCase()}`;
  }

  const org = await prisma.organization.upsert({
    where: { code: orgCode! },
    update: {},
    create: { code: orgCode!, name: orgName || orgCode! },
  });

  const exists = await prisma.user.findUnique({ where: { email: email! } });
  if (exists) {
    console.error(`邮箱已存在：${email}（不覆盖既有账号）`);
    process.exit(1);
  }

  const user = await prisma.user.create({
    data: {
      email: email!,
      name,
      organizationId: org.id,
      passwordHash: hashPassword(password!),
      // 建号即建立组织成员关系：不变量是「每个用户在所属组织内有且仅有一条成员记录」。
      // 缺失记录 = 非管理员，因此这里必须显式落一条，不留空。
      orgMemberships: {
        create: { organizationId: org.id, role: orgRoleArg as OrgRole },
      },
    },
  });

  console.log(
    JSON.stringify(
      {
        created: true,
        userId: user.id,
        email: user.email,
        organization: { id: org.id, code: org.code },
        orgRole: orgRoleArg,
        note: "口令已按 scrypt 哈希落库，本次输出不含口令；组织级角色已写入 OrganizationMember",
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
