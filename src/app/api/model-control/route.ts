import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import {
  bindAgentModelPolicy,
  getModelControlOverview,
  installRecommendedModelControlPresets,
  saveModelPolicy,
  saveModelProfile,
} from "@/modules/model-control/service";
import { UnprocessableEntityError } from "@/shared/errors";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    return NextResponse.json(await getModelControlOverview(session));
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await readJsonObjectBody(req);
    const action = String(body.action || "");
    if (action === "INSTALL_PRESETS") {
      return NextResponse.json(
        await installRecommendedModelControlPresets(session),
        { status: 201 }
      );
    }
    if (action === "SAVE_PROFILE") {
      return NextResponse.json(
        await saveModelProfile(session, body as Record<string, unknown>)
      );
    }
    if (action === "SAVE_POLICY") {
      return NextResponse.json(
        await saveModelPolicy(session, body as Record<string, unknown>)
      );
    }
    if (action === "BIND_AGENT") {
      return NextResponse.json(
        await bindAgentModelPolicy(session, body as Record<string, unknown>)
      );
    }

    throw new UnprocessableEntityError("未知 Model Control action");
  } catch (error) {
    return handleApiError(error, req);
  }
}
