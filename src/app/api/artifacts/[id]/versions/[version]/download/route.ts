import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { getArtifactVersion } from "@/modules/artifacts/service";
import { ARTIFACT_CSP, artifactFileName, buildStandaloneDocument } from "@/modules/artifacts/protocol";
import { handleApiError } from "@/shared/api-handler";
import { ConflictError } from "@/shared/errors";

/**
 * 下载离线 HTML：样式、数据与交互均内联；附带断网 CSP。
 * 以附件返回，并对直接打开的情况加 CSP sandbox（无同源），因此即使在本站域名下打开也拿不到 cookie。
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; version: string }> }) {
  try {
    const session = await getServerSession(req);
    const { id, version } = await params;
    const item = await getArtifactVersion(session, id, Number(version));
    if (item.status !== "READY") throw new ConflictError("这个版本生成失败，没有可下载的完整成果");
    const html = buildStandaloneDocument(item.html, { artifactId: item.artifactId, title: item.title, version: item.version, createdAt: item.createdAt });
    const name = artifactFileName(item.title, item.version);
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="kern-artifact-v${item.version}.html"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Content-Security-Policy": `sandbox allow-scripts; ${ARTIFACT_CSP}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}
