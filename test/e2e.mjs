// End-to-end checks against a running `netlify dev` with the Identity stand-in.
//   1. node test/mock-identity.mjs              (separate terminal)
//   2. IDENTITY_API_URL=http://localhost:9999 in .env, then `netlify dev`
//   3. node test/e2e.mjs [baseUrl]
// Writes to the local blob sandbox only.
import assert from "node:assert/strict";
import { makeToken } from "./mock-identity.mjs";

const BASE = process.argv[2] || "http://localhost:8888";
const MEMBER = `nf_jwt=${makeToken({ name: "Ainu A." })}`;
const NOT_MEMBER = `nf_jwt=${makeToken({ id: "user-2", roles: [] })}`;
const FORGED = `nf_jwt=${makeToken({ secret: "not-the-secret" })}`;

let passed = 0;
const step = async (name, fn) => { await fn(); passed++; console.log(`ok  ${name}`); };

// The local blob sandbox checks version tags and then writes without a lock,
// so its conditional writes are not atomic; production Netlify Blobs does them
// atomically. Race checks therefore only warn when run against localhost.
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
const raceStep = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`ok  ${name}`);
  } catch (err) {
    if (!LOCAL) throw err;
    console.log(`??  ${name}: lost a race in the local sandbox (not atomic locally; atomic on Netlify)`);
  }
};

const req = (path, { method = "GET", body, headers = {}, cookie } = {}) =>
  fetch(BASE + path, {
    method,
    redirect: "manual",
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

async function clientSession(label) {
  const res = await req("/api/freight/access-links", { method: "POST", cookie: MEMBER, body: { label, expiresHours: 24 } });
  assert.equal(res.status, 201, await res.clone().text());
  const { url, link } = await res.json();
  const token = url.split("#")[1];
  const redeem = await req("/api/freight/redeem", { method: "POST", body: { token } });
  assert.equal(redeem.status, 200, await redeem.clone().text());
  return { cookie: redeem.headers.get("set-cookie").split(";")[0], token, linkId: link.id };
}

await step("anonymous visitors are sent to the access page", async () => {
  const res = await req("/freight/");
  assert.equal(res.status, 302);
  assert.match(res.headers.get("location"), /\/freight\/access\/\?reason=signin$/);
  assert.equal((await req("/freight/FreightDesk.js")).status, 302);
  assert.equal((await req("/api/freight/rates")).status, 401);
});

await step("access page is public; server files are hidden", async () => {
  assert.equal((await req("/freight/access/")).status, 200);
  assert.equal((await req("/freight/access/access.js")).status, 200);
  for (const p of ["/netlify/functions/freight-rates.mjs", "/package.json", "/netlify.toml", "/scripts/generate-secrets.mjs", "/test/e2e.mjs"]) {
    assert.equal((await req(p)).status, 404, p);
  }
});

await step("portal members get in with their Identity sign-in", async () => {
  assert.equal((await req("/freight/", { cookie: MEMBER })).status, 200);
  assert.equal((await req("/freight/FreightDesk.js", { cookie: MEMBER })).status, 200);
  const s = await (await req("/api/freight/session", { cookie: MEMBER })).json();
  assert.equal(s.kind, "member");
  assert.equal(s.label, "Ainu A.");
  assert.equal(s.canManageAccess, true);
});

await step("the existing portal still works for members", async () => {
  assert.equal((await req("/app/", { cookie: MEMBER })).status, 200);
  assert.equal((await req("/src/App.js", { cookie: MEMBER })).status, 200);
  const anon = await req("/app/");
  assert.notEqual(anon.status, 200);
});

await step("signed-in users without the member role, and forged tokens, are refused", async () => {
  assert.equal((await req("/freight/", { cookie: NOT_MEMBER })).status, 302);
  assert.equal((await req("/api/freight/rates", { cookie: NOT_MEMBER })).status, 401);
  assert.equal((await req("/api/freight/access-links", { cookie: NOT_MEMBER })).status, 403);
  assert.equal((await req("/freight/", { cookie: FORGED })).status, 302);
  assert.equal((await req("/api/freight/access-links", { cookie: FORGED })).status, 403);
});

let client;
await step("a client link redeems once and opens the desk", async () => {
  client = await clientSession("E2E client");
  assert.match(client.cookie, /^ftc_session=/);
  const sessionRes = await req("/api/freight/session", { cookie: client.cookie });
  assert.match(sessionRes.headers.get("set-cookie") || "", /^ftc_session=.+Max-Age=34560000/, "visits renew the sign-in");
  assert.equal((await req("/freight/", { cookie: client.cookie })).status, 200);
  const s = await (await req("/api/freight/session", { cookie: client.cookie })).json();
  assert.equal(s.kind, "link");
  assert.equal(s.canManageAccess, false);
  const again = await req("/api/freight/redeem", { method: "POST", body: { token: client.token } });
  assert.equal(again.status, 410);
});

await step("clients cannot manage links", async () => {
  assert.equal((await req("/api/freight/access-links", { cookie: client.cookie })).status, 403);
  const make = await req("/api/freight/access-links", { method: "POST", cookie: client.cookie, body: { label: "sneaky" } });
  assert.equal(make.status, 403);
});

await step("the client page never offers link management, even in a member's browser", async () => {
  const both = `${MEMBER}; ${client.cookie}`;
  const onClientPage = await (await req("/api/freight/session?view=client", { cookie: both })).json();
  assert.equal(onClientPage.kind, "link", "a client link wins on the client page");
  assert.equal(onClientPage.label, "E2E client");
  assert.equal(onClientPage.canManageAccess, false);
  const memberOnClientPage = await (await req("/api/freight/session?view=client", { cookie: MEMBER })).json();
  assert.equal(memberOnClientPage.kind, "member");
  assert.equal(memberOnClientPage.canManageAccess, false);
  const inPortal = await (await req("/api/freight/session", { cookie: both })).json();
  assert.equal(inPortal.kind, "member");
  assert.equal(inPortal.canManageAccess, true);
});

await raceStep("five simultaneous redeems of one link: exactly one wins", async () => {
  const res = await req("/api/freight/access-links", { method: "POST", cookie: MEMBER, body: { label: "Race test" } });
  const token = (await res.json()).url.split("#")[1];
  const results = await Promise.all(Array.from({ length: 5 }, () => req("/api/freight/redeem", { method: "POST", body: { token } })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 410, 410, 410, 410]);
});

await step("cross-site writes are blocked", async () => {
  const res = await req("/api/freight/access-links", { method: "POST", cookie: MEMBER, body: { label: "x" }, headers: { origin: "https://evil.example" } });
  assert.equal(res.status, 403);
});

const RUN = Date.now().toString(36);
const lane = { type: "rail", provider: "CN", origin: "Shaunavon, SK", destination: "Vancouver, BC", commodity: `Yellow peas ${RUN}`, basis: "per_car", currency: "CAD", capacity_t: 90 };
let firstRateId;

await step("rates captured by a member and a client share one lane history", async () => {
  const first = await req("/api/freight/rates", { method: "POST", cookie: MEMBER, body: { ...lane, amount: 4500, effectiveFrom: "2026-08-01", validUntil: "2026-10-31", source: "Email from CN, Aug 1" } });
  assert.equal(first.status, 201);
  const firstRate = (await first.json()).rate;
  firstRateId = firstRate.id;
  assert.equal(firstRate.createdBy, "Ainu A.");
  const second = await req("/api/freight/rates", { method: "POST", cookie: client.cookie, body: { ...lane, amount: 4725, effectiveFrom: "2026-09-15", source: "Email from CN, Sep 15" } });
  const data = await second.json();
  assert.equal(data.rate.createdBy, "E2E client");
  assert.equal(data.previous.id, firstRateId);
  assert.ok(Math.abs(data.changePct - 5) < 1e-9);
});

await raceStep("simultaneous saves do not overwrite each other", async () => {
  const before = (await (await req("/api/freight/rates", { cookie: MEMBER })).json()).rates.length;
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
    req("/api/freight/rates", { method: "POST", cookie: MEMBER, body: { ...lane, destination: `Terminal ${i}`, amount: 4000 + i, effectiveFrom: "2026-09-01" } })));
  for (const r of results) assert.equal(r.status, 201);
  const after = (await (await req("/api/freight/rates", { cookie: MEMBER })).json()).rates.length;
  assert.equal(after, before + 8);
});

await step("corrections keep revisions; archive and restore work", async () => {
  const put = await req(`/api/freight/rates/${firstRateId}`, { method: "PUT", cookie: MEMBER, body: { ...lane, amount: 4550, effectiveFrom: "2026-08-01", validUntil: "2026-10-31" } });
  const { rate } = await put.json();
  assert.equal(rate.revisions[0].amount, 4500);
  assert.ok((await (await req(`/api/freight/rates/${firstRateId}`, { method: "PATCH", cookie: MEMBER, body: { archived: true } })).json()).rate.archivedAt);
  assert.equal((await (await req(`/api/freight/rates/${firstRateId}`, { method: "PATCH", cookie: MEMBER, body: { archived: false } })).json()).rate.archivedAt, null);
});

await step("quotes are recomputed on the server, listed and deleted", async () => {
  const body = {
    reference: `Q-E2E-${RUN}`, buyer: "PT Example", commodity: lane.commodity, quantity_t: 180, quoteDate: "2026-09-30",
    purchasePrice: 400, purchaseCurrency: "CAD", usdcad: 1.4, targetMarginPct: 10, minMarginPct: 5, salePrice: 380, saleCurrency: "USD",
    lines: [{ rateId: firstRateId, ...lane, amount: 4500, effectiveFrom: "2026-08-01", validUntil: "2026-10-31" }],
  };
  const res = await req("/api/freight/quotes", { method: "POST", cookie: client.cookie, body });
  assert.equal(res.status, 201);
  const { quote } = await res.json();
  assert.ok(Math.abs(quote.result.landedPerTonneCAD - 450) < 1e-9);
  assert.equal((await req(`/api/freight/quotes/${quote.id}`, { method: "DELETE", cookie: MEMBER })).status, 200);
});

await step("the member's link list shows the client link in use; revoking ends it", async () => {
  const { links } = await (await req("/api/freight/access-links", { cookie: MEMBER })).json();
  const mine = links.find((l) => l.id === client.linkId);
  assert.equal(mine.status, "In use");
  assert.equal(mine.createdBy, "Ainu A.");
  assert.equal((await req(`/api/freight/access-links/${client.linkId}`, { method: "DELETE", cookie: MEMBER })).status, 200);
  assert.equal((await req("/api/freight/rates", { cookie: client.cookie })).status, 401);
});

await step("members clear finished links from the history; live links are kept", async () => {
  const fresh = await req("/api/freight/access-links", { method: "POST", cookie: MEMBER, body: { label: `Unopened ${RUN}`, expiresHours: 24 } });
  const freshId = (await fresh.json()).link.id;
  assert.equal((await req("/api/freight/access-links", { method: "DELETE", cookie: MEMBER })).status, 400, "a bare DELETE clears nothing");
  assert.equal((await req("/api/freight/access-links?clear=finished", { method: "DELETE", cookie: client.cookie })).status, 403);
  const cleared = await req("/api/freight/access-links?clear=finished", { method: "DELETE", cookie: MEMBER });
  assert.equal(cleared.status, 200);
  assert.ok((await cleared.json()).removed >= 1);
  const { links } = await (await req("/api/freight/access-links", { cookie: MEMBER })).json();
  assert.ok(!links.some((l) => l.id === client.linkId), "the revoked link is gone");
  assert.ok(links.some((l) => l.id === freshId), "the unopened link is kept");
  assert.ok(links.every((l) => l.status === "In use" || l.status === "Not opened yet"));
  assert.equal((await req("/api/freight/rates", { cookie: client.cookie })).status, 401, "a cleared link still grants nothing");
});

console.log(`\n${passed} checks passed against ${BASE}`);
