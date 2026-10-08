import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { describeSourceFetcher, assertSourceFetcherAvailable } from "@/modules/research/source-fetch";
import { AppError } from "@/shared/errors";

export async function POST(req: NextRequest) {
  try {
    await getServerSession(req);
    const { url } = await req.json();
    if (!url) throw new AppError("缺少 url", "MISSING_URL", 400, { url: ["url 为必填"] });
    assertSourceFetcherAvailable();
    return NextResponse.json(describeSourceFetcher(), { status: 503 });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function GET(req: NextRequest) {
  try {
    await getServerSession(req);
    return NextResponse.json(describeSourceFetcher());
  } catch (error) {
    return handleApiError(error, req);
  }
}
