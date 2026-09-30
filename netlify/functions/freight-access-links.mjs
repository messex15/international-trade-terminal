// Client access links, managed by signed-in portal members.
//
// GET    /api/freight/access-links        list links
// POST   /api/freight/access-links        create a single-use link
//        { label, expiresHours? }   once opened, access lasts until revoked
// DELETE /api/freight/access-links/:id    revoke a link (also ends its session)
import {
  accessStore,
  assertSameOrigin,
  cleanNumber,
  cleanText,
  HttpError,
  json,
  readJson,
  requireMember,
  route,
  sessionSecret,
} from "../lib/http.mjs";
import { env, randomToken, sha256Hex } from "../lib/session.mjs";

function status(link, now = Date.now()) {
  if (link.revokedAt) return "Revoked";
  if (link.usedAt) return "In use";
  if (Date.parse(link.expiresAt) <= now) return "Expired";
  return "Not opened yet";
}

function publicView(id, link) {
  return {
    id,
    label: link.label,
    createdAt: link.createdAt,
    createdBy: link.createdBy || "",
    expiresAt: link.expiresAt,
    usedAt: link.usedAt || null,
    revokedAt: link.revokedAt || null,
    status: status(link),
  };
}

export default route(async (req, context) => {
  const member = await requireMember(req);
  const store = accessStore();
  const id = context.params?.id;

  if (req.method === "GET") {
    const { blobs } = await store.list({ prefix: "link/" });
    const links = await Promise.all(
      blobs.map(async ({ key }) => {
        const link = await store.get(key, { type: "json" });
        return link ? publicView(key.slice(5), link) : null;
      }),
    );
    links.sort((a, b) => (b?.createdAt || "").localeCompare(a?.createdAt || ""));
    return json({ links: links.filter(Boolean) });
  }

  assertSameOrigin(req);

  if (req.method === "POST" && !id) {
    sessionSecret(); // links are useless without it, so fail early and clearly
    const body = await readJson(req, 5_000);
    const label = cleanText(body.label, 80);
    if (!label) throw new HttpError(400, "Say who the link is for, such as the person's name and company.");
    const expiresHours = cleanNumber(body.expiresHours ?? 72, "Link lifetime", { min: 1, max: 720 });

    const token = randomToken(32);
    const hash = await sha256Hex(token);
    const now = new Date();
    const link = {
      label,
      createdAt: now.toISOString(),
      createdBy: member.name,
      expiresAt: new Date(now.getTime() + expiresHours * 3_600_000).toISOString(),
      usedAt: null,
      revokedAt: null,
    };
    // Only the hash is stored, so the blob store never holds a usable link.
    await store.setJSON(`link/${hash}`, link, { onlyIfNew: true });

    const base = (env("PUBLIC_BASE_URL") || new URL(req.url).origin).replace(/\/$/, "");
    return json({ url: `${base}/freight/access/#${token}`, link: publicView(hash, link) }, 201);
  }

  if (req.method === "DELETE" && id) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new HttpError(404, "No link with that id.");
    const key = `link/${id}`;
    const link = await store.get(key, { type: "json" });
    if (!link) throw new HttpError(404, "No link with that id.");
    const updated = { ...link, revokedAt: link.revokedAt || new Date().toISOString(), revokedBy: member.name };
    await store.setJSON(key, updated);
    return json({ link: publicView(id, updated) });
  }

  throw new HttpError(405, "Method not allowed.");
});

export const config = {
  path: ["/api/freight/access-links", "/api/freight/access-links/:id"],
  method: ["GET", "POST", "DELETE"],
};
