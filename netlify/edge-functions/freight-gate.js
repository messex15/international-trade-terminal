// Guards every file under /freight/ (the desk page, its script and styles).
// Let through: portal members signed in with Netlify Identity, and clients
// holding a session from a single-use access link. Everyone else goes to the
// access page. Revoked links are also refused by every data request, since
// those check the link record on each call.
import {
  COOKIE_NAME,
  IDENTITY_COOKIE,
  decodeCookieValue,
  env,
  verifyMember,
  verifySession,
} from "../lib/session.mjs";

export default async (request, context) => {
  const secret = env("SESSION_SECRET");
  const linkCookie = context.cookies.get(COOKIE_NAME);
  if (linkCookie && secret && secret.length >= 32 && (await verifySession(secret, linkCookie))) return;

  const identity = context.cookies.get(IDENTITY_COOKIE);
  if (identity && (await verifyMember(request.url, decodeCookieValue(identity)))) return;

  const url = new URL("/freight/access/", request.url);
  url.searchParams.set("reason", linkCookie ? "expired" : "signin");
  return new Response(null, {
    status: 302,
    headers: { location: url.toString(), "cache-control": "no-store" },
  });
};

export const config = {
  path: ["/freight", "/freight/*"],
  excludedPath: ["/freight/access", "/freight/access/", "/freight/access/*"],
};
