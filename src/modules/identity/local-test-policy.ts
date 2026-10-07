// The launch script also binds the server to 127.0.0.1; hostname checks alone
// cannot establish that a request came from the local machine.
export const LOCAL_TEST_EMAIL = "local-test@kern.invalid";
export const LOCAL_TEST_ORG = "KERN_LOCAL_TEST";
export const LOCAL_TEST_SESSION_DAYS = 30;

export function localTestLoginEnabled(host: string | null): boolean {
  if (process.env.NODE_ENV !== "development" || process.env.KERN_LOCAL_TEST_LOGIN !== "true" || !host) return false;
  try {
    const url = new URL(`http://${host}`);
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.host === host;
  } catch {
    return false;
  }
}

export function localTestRequestAllowed(headers: { get(name: string): string | null }): boolean {
  const host = headers.get("host");
  if (!localTestLoginEnabled(host) || headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = headers.get("origin");
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && url.host === host && url.origin === origin;
  } catch {
    return false;
  }
}
