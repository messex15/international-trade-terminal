// GET    /api/freight/session  -> who is using the desk (portal member or client link)
// DELETE /api/freight/session  -> sign a client-link browser out
import { assertSameOrigin, json, requireSession, route } from "../lib/http.mjs";
import { clearedSessionCookie } from "../lib/session.mjs";

export default route(async (req) => {
  if (req.method === "DELETE") {
    assertSameOrigin(req);
    return json({ ok: true }, 200, { "set-cookie": clearedSessionCookie() });
  }
  const session = await requireSession(req, { preferMember: true });
  return json({
    kind: session.kind,
    label: session.label,
    canManageAccess: session.kind === "member",
    sessionExpiresAt: session.exp ? new Date(session.exp * 1000).toISOString() : null,
  });
});

export const config = { path: "/api/freight/session", method: ["GET", "DELETE"] };
