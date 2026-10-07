import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { createProduct, listOrganizationProducts } from "@/modules/products/service";
import { handleApiError } from "@/shared/api-handler";
import { readJsonObjectBody } from "@/shared/request-body";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await readJsonObjectBody(req);
    const product = await createProduct(session, {
      name: body.name,
      identityCode: body.identityCode,
      targetAudience: body.targetAudience,
      marketPath: body.marketPath,
      devMode: body.devMode,
    });
    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const products = await listOrganizationProducts(session);
    return NextResponse.json(products);
  } catch (error) {
    return handleApiError(error, req);
  }
}
