// Helpers shared by the serverless functions (Node only).
import { getStore } from "@netlify/blobs";
import { COOKIE_NAME, IDENTITY_COOKIE, decodeCookieValue, env, verifyMember, verifySession } from "./session.mjs";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

/** Wraps a handler so thrown HttpErrors become JSON responses. */
export function route(fn) {
  return async (req, context) => {
    try {
      return await fn(req, context);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: "The server hit an unexpected error. Try again in a moment." }, 500);
    }
  };
}

export const accessStore = () => getStore({ name: "freight-access", consistency: "strong" });
export const rateStore = () => getStore({ name: "freight-rates", consistency: "strong" });
export const quoteStore = () => getStore({ name: "freight-quotes", consistency: "strong" });
export const customerStore = () => getStore({ name: "freight-customers", consistency: "strong" });

export function getCookie(req, name) {
  const header = req.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function sessionSecret({ required = true } = {}) {
  const secret = env("SESSION_SECRET");
  if (!secret || secret.length < 32) {
    if (!required) return null;
    throw new HttpError(503, "The site is missing its SESSION_SECRET setting (32+ characters).");
  }
  return secret;
}

/** Blocks cross-site writes. Cookies are SameSite=Lax; this adds a second check. */
export function assertSameOrigin(req) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) {
    throw new HttpError(403, "Requests from other sites are not allowed.");
  }
  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    const type = req.headers.get("content-type") || "";
    if (!type.includes("application/json")) throw new HttpError(415, "Send the request body as JSON.");
  }
}

/** The signed-in portal member (Netlify Identity, member role), or null. */
export async function currentMember(req) {
  const token = getCookie(req, IDENTITY_COOKIE);
  return token ? verifyMember(req.url, decodeCookieValue(token)) : null;
}

/** A visitor holding a live single-use-link session, or null. */
async function currentLinkSession(req) {
  const secret = sessionSecret({ required: false });
  const raw = getCookie(req, COOKIE_NAME);
  if (!secret || !raw) return null;
  const session = await verifySession(secret, raw);
  if (!session) return null;
  const link = await accessStore().get(`link/${session.sid}`, { type: "json" });
  if (!link || link.revokedAt) return null;
  return { kind: "link", sid: session.sid, exp: session.exp, label: link.label, company: link.company || "" };
}

/**
 * Anyone allowed to use the freight desk: a portal member, or a client who
 * opened a single-use link. Throws 401 otherwise.
 */
export async function requireSession(req, { preferMember = false } = {}) {
  if (!preferMember) {
    const link = await currentLinkSession(req);
    if (link) return link;
  }
  const member = await currentMember(req);
  if (member) return { kind: "member", label: member.name, email: member.email, userId: member.id };
  if (preferMember) {
    const link = await currentLinkSession(req);
    if (link) return link;
  }
  throw new HttpError(401, "Your session has ended. Sign in again or open a new access link.");
}

/** Only portal members manage client links. */
export async function requireMember(req) {
  const member = await currentMember(req);
  if (!member) throw new HttpError(403, "Only signed-in portal members can manage client access.");
  return member;
}

export async function readJson(req, maxBytes = 200_000) {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "That request is too large.");
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new HttpError(400, "The request body is not valid JSON.");
  }
}

/** Time-sortable id: newer ids sort after older ones. */
export function newId() {
  const rand = new Uint8Array(4);
  crypto.getRandomValues(rand);
  const suffix = [...rand].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 6);
  return `${Date.now().toString(36).padStart(9, "0")}-${suffix}`;
}

/**
 * Reads a JSON blob together with its version tag (ETag), or returns null.
 * Production returns the ETag on reads. Some local sandboxes omit it there
 * but include it in list(); in that case the tag is read BEFORE the data, so
 * any write in between makes the later conditional write fail safely.
 */
export async function readVersioned(store, key) {
  const entry = await store.getWithMetadata(key, { type: "json" });
  if (!entry) return null;
  if (entry.etag) return { data: entry.data, etag: entry.etag };
  const { blobs } = await store.list({ prefix: key });
  const etag = blobs.find((b) => b.key === key)?.etag;
  // Caught mid-write by someone else: report a conflict so the caller retries.
  if (!etag) throw new VersionConflict(key);
  const data = await store.get(key, { type: "json" });
  return data === null ? null : { data, etag };
}

export class VersionConflict extends Error {
  constructor(key) {
    super(`No stable version of ${key} yet; retry.`);
  }
}

/** readVersioned, retried briefly while another write is in flight. */
export async function readVersionedWithRetry(store, key, attempts = 6) {
  for (let i = 0; ; i++) {
    try {
      return await readVersioned(store, key);
    } catch (err) {
      if (!(err instanceof VersionConflict) || i >= attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 30 * (i + 1) + Math.random() * 40));
    }
  }
}

/**
 * Read-modify-write on one JSON blob with optimistic locking, so two people
 * saving at the same moment never overwrite each other.
 * `change(doc)` returns { doc, value }; `value` is what this returns.
 */
export async function updateJsonDoc(store, key, initial, change) {
  for (let attempt = 0; attempt < 8; attempt++) {
    let current;
    try {
      current = await readVersioned(store, key);
    } catch (err) {
      if (!(err instanceof VersionConflict)) throw err;
      await new Promise((r) => setTimeout(r, 40 * (attempt + 1) + Math.random() * 60));
      continue;
    }
    const base = current ? current.data : structuredClone(initial);
    const { doc, value } = await change(base);
    const options = current ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
    const { modified } = await store.setJSON(key, doc, options);
    if (modified) return value;
    await new Promise((r) => setTimeout(r, 40 * (attempt + 1) + Math.random() * 60));
  }
  throw new HttpError(409, "Several saves happened at once. Try again.");
}

export function cleanText(value, max = 200) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

export function cleanDate(value, field, { required = false } = {}) {
  if (!value) {
    if (required) throw new HttpError(400, `${field} is required.`);
    return "";
  }
  const s = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new HttpError(400, `${field} must be a date like 2026-09-30.`);
  }
  return s;
}

export function cleanNumber(value, field, { min = 0, max = 1e9, required = false } = {}) {
  if (value === "" || value === null || value === undefined) {
    if (required) throw new HttpError(400, `${field} is required.`);
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new HttpError(400, `${field} must be a number between ${min} and ${max}.`);
  }
  return n;
}
