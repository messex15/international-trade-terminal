// Client access links, managed by signed-in portal members.
//
// GET    /api/freight/access-links        list links
// POST   /api/freight/access-links        create a single-use link
//        { label, company, expiresHours? }   once opened, access lasts until revoked.
//        The company names the client's own customer list (links for the same
//        company share it) and is the default company name on their quotes.
// DELETE /api/freight/access-links/:id    revoke a link (also ends its session)
// DELETE /api/freight/access-links?clear=finished
//        clear history: deletes revoked and expired links. Links in use or
//        not opened yet are kept, so nobody loses access.
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

/** Revoked, or expired before anyone opened it: it can never grant access again. */
const isFinished = (link, now = Date.now()) => ["Revoked", "Expired"].includes(status(link, now));

function publicView(id, link) {
  return {
    id,
    label: link.label,
    company: link.company || "",
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
    if (!label) throw new HttpError(400, "Say who the link is for, such as the person's name.");
    const company = cleanText(body.company, 100);
    if (!company) throw new HttpError(400, "Enter the company this person is with. It names their customer list and their quotes.");
    const expiresHours = cleanNumber(body.expiresHours ?? 72, "Link lifetime", { min: 1, max: 720 });

    const token = randomToken(32);
    const hash = await sha256Hex(token);
    const now = new Date();
    const link = {
      label,
      company,
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

  if (req.method === "DELETE" && !id) {
    if (new URL(req.url).searchParams.get("clear") !== "finished") {
      throw new HttpError(400, "Only finished links can be cleared. Revoke a link first to end its access.");
    }
    const now = Date.now();
    const { blobs } = await store.list({ prefix: "link/" });
    const removed = await Promise.all(
      blobs.map(async ({ key }) => {
        const link = await store.get(key, { type: "json" });
        if (!link || !isFinished(link, now)) return 0;
        await store.delete(key);
        return 1;
      }),
    );
    return json({ removed: removed.reduce((a, b) => a + b, 0) });
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
