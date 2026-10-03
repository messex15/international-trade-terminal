// CN API connection, for signed-in portal members (staff).
// GET  /api/freight/cn        { configured }: whether CN_API_KEY and CN_API_SECRET are set
// POST /api/freight/cn/test   asks CN for an access token: { ok, checkedAt }, or an error
// The key, secret and token never leave the server (see netlify/lib/cn.mjs).
import { assertSameOrigin, HttpError, json, requireMember, route } from "../lib/http.mjs";
import { cnConfig, cnToken } from "../lib/cn.mjs";

export default route(async (req, context) => {
  await requireMember(req, "Only signed-in portal members can use the CN connection.");
  const action = context.params?.action;

  if (req.method === "GET" && !action) return json({ configured: cnConfig().configured });

  if (req.method === "POST" && action === "test") {
    assertSameOrigin(req);
    await cnToken({ fresh: true });
    return json({ ok: true, checkedAt: new Date().toISOString() });
  }

  throw new HttpError(404, "Not found.");
});

export const config = {
  path: ["/api/freight/cn", "/api/freight/cn/:action"],
  method: ["GET", "POST"],
};
