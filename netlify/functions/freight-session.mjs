// GET    /api/freight/session  -> who is using the desk (portal member or client link)
//                                and, for clients, renews their sign-in
//        ?view=client          -> asked by the client page (/freight/): a client link
//                                wins over a portal sign-in, and access management is
//                                never offered there
// DELETE /api/freight/session  -> sign a client-link browser out
import { assertSameOrigin, json, requireSession, route, sessionSecret } from "../lib/http.mjs";
import { SESSION_TTL_SECONDS, clearedSessionCookie, sessionCookie, signSession } from "../lib/session.mjs";

export default route(async (req) => {
  if (req.method === "DELETE") {
    assertSameOrigin(req);
    return json({ ok: true }, 200, { "set-cookie": clearedSessionCookie() });
  }
  const clientView = new URL(req.url).searchParams.get("view") === "client";
  const session = await requireSession(req, { preferMember: !clientView });
  const headers = {};
  if (session.kind === "link") {
    // Sliding renewal: every visit restarts the cookie lifetime, so a client
    // stays signed in until their link is revoked.
    const now = Math.floor(Date.now() / 1000);
    const token = await signSession(sessionSecret(), { sid: session.sid, iat: now, exp: now + SESSION_TTL_SECONDS });
    headers["set-cookie"] = sessionCookie(token, SESSION_TTL_SECONDS);
  }
  return json({
    kind: session.kind,
    label: session.label,
    company: session.kind === "link" ? session.company : "",
    canManageAccess: session.kind === "member" && !clientView,
  }, 200, headers);
});

export const config = { path: "/api/freight/session", method: ["GET", "DELETE"] };
