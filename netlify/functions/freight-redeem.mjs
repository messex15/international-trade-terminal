// POST /api/freight/redeem  { token }
// Exchanges a single-use access link for a signed session cookie.
// The access page only calls this after the person clicks a button, so
// email link scanners that pre-open URLs cannot burn the link.
import { accessStore, assertSameOrigin, HttpError, json, readJson, readVersionedWithRetry, route, sessionSecret } from "../lib/http.mjs";
import { SESSION_TTL_SECONDS, sessionCookie, sha256Hex, signSession } from "../lib/session.mjs";

const GONE = {
  invalid: "This access link is not valid. Ask for a new one.",
  used: "This access link has already been used. Each link opens the desk once; ask for a new one.",
  expired: "This access link has expired. Ask for a new one.",
  revoked: "This access link was cancelled. Ask for a new one.",
};

export default route(async (req) => {
  assertSameOrigin(req);
  const secret = sessionSecret();
  const { token } = await readJson(req, 2_000);
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{40,64}$/.test(token)) {
    throw new HttpError(410, GONE.invalid);
  }

  const hash = await sha256Hex(token);
  const store = accessStore();
  const key = `link/${hash}`;
  const entry = await readVersionedWithRetry(store, key);
  if (!entry) throw new HttpError(410, GONE.invalid);

  const link = entry.data;
  const now = new Date();
  if (link.revokedAt) throw new HttpError(410, GONE.revoked);
  if (link.usedAt) throw new HttpError(410, GONE.used);
  if (Date.parse(link.expiresAt) <= now.getTime()) throw new HttpError(410, GONE.expired);

  const updated = {
    ...link,
    usedAt: now.toISOString(),
    usedFrom: (req.headers.get("user-agent") || "").slice(0, 160),
  };

  // Only succeeds if nobody redeemed the link between our read and this write.
  const { modified } = await store.setJSON(key, updated, { onlyIfMatch: entry.etag });
  if (!modified) throw new HttpError(410, GONE.used);

  const cookie = await signSession(secret, {
    sid: hash,
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(now.getTime() / 1000) + SESSION_TTL_SECONDS,
  });

  return json(
    { ok: true, label: link.label, next: "/freight/" },
    200,
    { "set-cookie": sessionCookie(cookie, SESSION_TTL_SECONDS) },
  );
});

export const config = { path: "/api/freight/redeem", method: "POST" };
