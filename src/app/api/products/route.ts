import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { createProduct, listOrganizationProducts } from "@/modules/products/service";
import { handleApiError } from "@/shared/api-handler";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await req.json();
    const product = await createProduct(session, body);
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
