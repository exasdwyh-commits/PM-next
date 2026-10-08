import { NextRequest, NextResponse } from "next/server";

const LEGACY_REDIRECTS: Record<string, string> = {
  "/advisor": "/muse",
  "/consultation": "/muse",
  "/war-room": "/muse",
  "/dashboard": "/muse",
  "/advisor/knowledge": "/settings?tab=knowledge",
  "/products/board": "/products",
  "/products/overview": "/products",
};

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (LEGACY_REDIRECTS[pathname]) {
    const url = req.nextUrl.clone();
    url.pathname = LEGACY_REDIRECTS[pathname].split("?")[0];
    const query = LEGACY_REDIRECTS[pathname].split("?")[1];
    if (query) {
      const params = new URLSearchParams(query);
      params.forEach((value, key) => url.searchParams.set(key, value));
    }
    url.searchParams.set("redirected_from", pathname);
    return NextResponse.redirect(url, 308);
  }
  for (const [oldPrefix, newPath] of Object.entries(LEGACY_REDIRECTS)) {
    if (pathname.startsWith(oldPrefix + "/") && oldPrefix !== "/advisor/knowledge") {
      const url = req.nextUrl.clone();
      url.pathname = pathname.replace(oldPrefix, newPath.split("?")[0]);
      url.searchParams.set("redirected_from", pathname);
      return NextResponse.redirect(url, 308);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/advisor/:path*", "/consultation/:path*", "/war-room/:path*", "/dashboard/:path*", "/products/board", "/products/overview"],
};
