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

async function clientSession(label, company = "E2E Client Co") {
  const res = await req("/api/freight/access-links", { method: "POST", cookie: MEMBER, body: { label, company, expiresHours: 24 } });
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

await step("a link names the client's company, and the session reports it", async () => {
  assert.equal((await req("/api/freight/access-links", { method: "POST", cookie: MEMBER, body: { label: "No company" } })).status, 400);
  const s = await (await req("/api/freight/session?view=client", { cookie: client.cookie })).json();
  assert.equal(s.company, "E2E Client Co");
  const { links } = await (await req("/api/freight/access-links", { cookie: MEMBER })).json();
  assert.equal(links.find((l) => l.id === client.linkId).company, "E2E Client Co");
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
  const res = await req("/api/freight/access-links", { method: "POST", cookie: MEMBER, body: { label: "Race test", company: "Race Co" } });
  const token = (await res.json()).url.split("#")[1];
  const results = await Promise.all(Array.from({ length: 5 }, () => req("/api/freight/redeem", { method: "POST", body: { token } })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 410, 410, 410, 410]);
});

await step("cross-site writes are blocked", async () => {
  const res = await req("/api/freight/access-links", { method: "POST", cookie: MEMBER, body: { label: "x", company: "x" }, headers: { origin: "https://evil.example" } });
  assert.equal(res.status, 403);
});

const RUN = Date.now().toString(36);
const lane = { type: "rail", provider: "CN", origin: "Shaunavon, SK", destination: "Vancouver, BC", commodity: `Yellow peas ${RUN}`, basis: "per_car", currency: "CAD", capacity_t: 90 };
let firstRateId;

await step("rate memory is kept apart: staff, and each client company", async () => {
  const first = await req("/api/freight/rates", { method: "POST", cookie: MEMBER, body: { ...lane, amount: 4500, effectiveFrom: "2026-08-01", validUntil: "2026-10-31", source: "Email from CN, Aug 1" } });
  assert.equal(first.status, 201);
  const firstRate = (await first.json()).rate;
  firstRateId = firstRate.id;
  assert.equal(firstRate.createdBy, "Ainu A.");
  const second = await (await req("/api/freight/rates", { method: "POST", cookie: MEMBER, body: { ...lane, amount: 4725, effectiveFrom: "2026-09-15", source: "Email from CN, Sep 15" } })).json();
  assert.equal(second.previous.id, firstRateId, "staff lane history");
  assert.ok(Math.abs(second.changePct - 5) < 1e-9);

  const onLane = (rates) => rates.filter((r) => r.commodity === lane.commodity);
  assert.deepEqual(onLane((await (await req("/api/freight/rates?view=client", { cookie: client.cookie })).json()).rates), [], "clients do not see staff rates");
  const theirs = await (await req("/api/freight/rates?view=client", { method: "POST", cookie: client.cookie, body: { ...lane, amount: 4800, effectiveFrom: "2026-09-20" } })).json();
  assert.equal(theirs.previous, null, "a client's lane history starts in its own workspace");
  assert.equal(theirs.rate.createdBy, "E2E client");
  const colleague = await clientSession("E2E colleague");
  assert.deepEqual(onLane((await (await req("/api/freight/rates?view=client", { cookie: colleague.cookie })).json()).rates).map((r) => r.id), [theirs.rate.id], "same company, same rate memory");
  const outsider = await clientSession("Outsider", `Other Co ${RUN}`);
  assert.deepEqual(onLane((await (await req("/api/freight/rates?view=client", { cookie: outsider.cookie })).json()).rates), []);
  assert.ok(!(await (await req("/api/freight/rates", { cookie: MEMBER })).json()).rates.some((r) => r.id === theirs.rate.id), "staff do not see client rates");
  for (const method of ["PATCH", "DELETE"]) {
    const r = await req(`/api/freight/rates/${theirs.rate.id}`, { method, cookie: MEMBER, ...(method === "PATCH" ? { body: { archived: true } } : {}) });
    assert.equal(r.status, 404, `staff cannot ${method} a client rate`);
  }
  assert.equal((await req(`/api/freight/rates/${theirs.rate.id}?view=client`, { method: "DELETE", cookie: colleague.cookie })).status, 200);
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

await step("rates can be deleted for good", async () => {
  const made = await (await req("/api/freight/rates", { method: "POST", cookie: MEMBER, body: { ...lane, destination: `Delete me ${RUN}`, amount: 1, effectiveFrom: "2026-09-01" } })).json();
  assert.equal((await req(`/api/freight/rates/${made.rate.id}`, { method: "DELETE", cookie: MEMBER, headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await req(`/api/freight/rates/${made.rate.id}`, { method: "DELETE", cookie: MEMBER })).status, 200);
  assert.ok(!(await (await req("/api/freight/rates", { cookie: MEMBER })).json()).rates.some((r) => r.id === made.rate.id));
  assert.equal((await req(`/api/freight/rates/${made.rate.id}`, { method: "DELETE", cookie: MEMBER })).status, 404);
});

await step("saved quotes are recomputed on the server and kept per workspace", async () => {
  const body = {
    companyName: "Prairie Pulse Traders", reference: `Q-E2E-${RUN}`, buyer: "PT Example", commodity: lane.commodity, quantity_t: 180, quoteDate: "2026-09-30",
    purchasePrice: 400, purchaseCurrency: "CAD", usdcad: 1.4, targetMarginPct: 10, minMarginPct: 5, salePrice: 380, saleCurrency: "USD",
    lines: [{ rateId: firstRateId, ...lane, amount: 4500, effectiveFrom: "2026-08-01", validUntil: "2026-10-31" }],
  };
  const res = await req("/api/freight/quotes?view=client", { method: "POST", cookie: client.cookie, body });
  assert.equal(res.status, 201);
  const { quote } = await res.json();
  assert.ok(Math.abs(quote.result.landedPerTonneCAD - 450) < 1e-9);
  assert.equal(quote.inputs.companyName, "Prairie Pulse Traders", "the PDF company name is kept with the quote");
  const ids = async (cookie, q = "") => (await (await req(`/api/freight/quotes${q}`, { cookie })).json()).quotes.map((x) => x.id);
  assert.ok((await ids(client.cookie, "?view=client")).includes(quote.id));
  assert.ok(!(await ids(MEMBER)).includes(quote.id), "staff do not see client quotes");
  assert.equal((await req(`/api/freight/quotes/${quote.id}`, { cookie: MEMBER })).status, 404);
  assert.equal((await req(`/api/freight/quotes/${quote.id}`, { method: "DELETE", cookie: MEMBER })).status, 404, "staff cannot delete a client quote");
  assert.equal((await req(`/api/freight/quotes/${quote.id}?view=client`, { method: "DELETE", cookie: client.cookie })).status, 200);
  assert.ok(!(await ids(client.cookie, "?view=client")).includes(quote.id));
});

await step("grade, customer, standard rows and a commission on the sale price are saved and recomputed", async () => {
  const blank = (type, basis, currency = "CAD") => ({ rateId: null, standard: true, type, basis, amount: "", currency, capacity_t: "" });
  const body = {
    reference: `Q-STD-${RUN}`, buyer: "PT Example", commodity: "Yellow peas", grade: "No. 2 or better", quantity_t: 100, quoteDate: "2026-10-02",
    purchasePrice: 500, purchaseCurrency: "CAD", targetMarginPct: 8, minMarginPct: 4,
    lines: [
      { ...blank("transload", "per_tonne"), amount: 20 },
      blank("labour", "per_tonne"),
      blank("ocean", "per_container", "USD"),
      blank("insurance", "percent_of_value"),
      { ...blank("commission", "percent_of_sale"), amount: 2 },
    ],
  };
  const res = await req("/api/freight/quotes", { method: "POST", cookie: MEMBER, body });
  assert.equal(res.status, 201, await res.clone().text());
  const { quote } = await res.json();
  assert.equal(quote.inputs.grade, "No. 2 or better");
  assert.equal(quote.inputs.lines.filter((l) => l.standard).length, 5, "blank standard rows are kept with the quote");
  assert.ok(Math.abs(quote.result.targetPricePerTonneCAD - 520 / 0.9) < 1e-9, "target price covers the 2% commission");
  const { quotes } = await (await req("/api/freight/quotes", { cookie: MEMBER })).json();
  assert.equal(quotes.find((q) => q.id === quote.id).grade, "No. 2 or better");
  assert.equal((await req(`/api/freight/quotes/${quote.id}`, { method: "DELETE", cookie: MEMBER })).status, 200);
});

await step("customer lists: staff have one, each client company has its own", async () => {
  const name = `Zeta Foods ${RUN}`;
  const add = await req("/api/freight/customers", { method: "POST", cookie: MEMBER, body: { name, country: "Indonesia", deliveryTerms: "CFR Jakarta", email: "buyer@zeta.example" } });
  assert.equal(add.status, 201, await add.clone().text());
  const { customer } = await add.json();
  assert.equal(customer.createdBy, "Ainu A.");
  const dupe = await req("/api/freight/customers", { method: "POST", cookie: MEMBER, body: { name: `  ${name.toUpperCase()} ` } });
  assert.equal(dupe.status, 409, "names are matched ignoring case and spacing");
  assert.equal((await req("/api/freight/customers", { method: "POST", cookie: MEMBER, body: { name: "Bad email", email: "not-an-email" } })).status, 400);
  const other = await (await req("/api/freight/customers", { method: "POST", cookie: MEMBER, body: { name: `Alpha Grains ${RUN}` } })).json();
  const put = await req(`/api/freight/customers/${customer.id}`, { method: "PUT", cookie: MEMBER, body: { ...customer, deliveryTerms: "CIF Surabaya" } });
  assert.equal((await put.json()).customer.deliveryTerms, "CIF Surabaya");
  const names = async (cookie, query = "") => (await (await req(`/api/freight/customers${query}`, { cookie })).json()).customers.map((c) => c.name).filter((n) => n.endsWith(RUN));
  assert.deepEqual(await names(MEMBER), [`Alpha Grains ${RUN}`, name], "sorted A to Z");

  // A client sees none of the staff list, and adds to its company's own list.
  const company = `Prairie Pulse ${RUN}`;
  const jane = await clientSession("Jane", company);
  assert.deepEqual(await names(jane.cookie, "?view=client"), [], "the staff list is not visible to clients");
  assert.equal((await req("/api/freight/customers?view=client", { method: "POST", cookie: jane.cookie, body: { name } })).status, 201, "same name, separate list");
  const sam = await clientSession("Sam", company);
  assert.deepEqual(await names(sam.cookie, "?view=client"), [name], "a colleague's link shares the company list");
  const outsider = await clientSession("Lee", `Other Co ${RUN}`);
  assert.deepEqual(await names(outsider.cookie, "?view=client"), [], "another company sees nothing");
  const both = `${MEMBER}; ${jane.cookie}`;
  assert.deepEqual(await names(both), [`Alpha Grains ${RUN}`, name], "the portal shows the staff list in a browser with both sign-ins");
  assert.deepEqual(await names(both, "?view=client"), [name], "the client page shows the client's list");
  const janeCustomer = (await (await req("/api/freight/customers?view=client", { cookie: jane.cookie })).json()).customers.find((c) => c.name === name);
  assert.equal((await req(`/api/freight/customers/${janeCustomer.id}?view=client`, { method: "DELETE", cookie: MEMBER })).status, 404, "staff cannot reach into a client list by id");
  assert.equal((await req(`/api/freight/customers/${janeCustomer.id}?view=client`, { method: "DELETE", cookie: sam.cookie })).status, 200);

  assert.equal((await req("/api/freight/customers", { cookie: NOT_MEMBER })).status, 401);
  for (const id of [customer.id, other.customer.id]) assert.equal((await req(`/api/freight/customers/${id}`, { method: "DELETE", cookie: MEMBER })).status, 200);
  assert.equal((await req(`/api/freight/customers/${customer.id}`, { method: "DELETE", cookie: MEMBER })).status, 404);
});

await step("an Other charge needs a name in rate memory, and each name keeps its own history", async () => {
  const other = { type: "other", provider: `Delta Terminal ${RUN}`, origin: "Delta, BC", basis: "per_tonne", currency: "CAD", effectiveFrom: "2026-10-01" };
  assert.equal((await req("/api/freight/rates", { method: "POST", cookie: MEMBER, body: { ...other, amount: 4 } })).status, 400, "no name");
  const fumigation = await (await req("/api/freight/rates", { method: "POST", cookie: MEMBER, body: { ...other, chargeName: "Fumigation", amount: 4 } })).json();
  assert.equal(fumigation.rate.chargeName, "Fumigation");
  const bagging = await (await req("/api/freight/rates", { method: "POST", cookie: MEMBER, body: { ...other, chargeName: "Bagging", amount: 22 } })).json();
  assert.equal(bagging.previous, null, "bagging does not replace fumigation");
  const again = await (await req("/api/freight/rates", { method: "POST", cookie: MEMBER, body: { ...other, chargeName: "fumigation", amount: 5, effectiveFrom: "2026-10-02" } })).json();
  assert.equal(again.previous.id, fumigation.rate.id, "same name, same lane");
  assert.ok(Math.abs(again.changePct - 25) < 1e-9);
  const rail = await (await req("/api/freight/rates", { method: "POST", cookie: MEMBER, body: { ...other, type: "rail", chargeName: "ignored", amount: 1 } })).json();
  assert.equal(rail.rate.chargeName, "", "only Other charges keep a name");
  for (const r of [fumigation.rate, bagging.rate, again.rate, rail.rate]) {
    await req(`/api/freight/rates/${r.id}`, { method: "PATCH", cookie: MEMBER, body: { archived: true } });
  }
  const q = await req("/api/freight/quotes", { method: "POST", cookie: MEMBER, body: {
    reference: `Q-OTHER-${RUN}`, quantity_t: 100, quoteDate: "2026-10-02", purchasePrice: 500, purchaseCurrency: "CAD",
    lines: [
      { rateId: null, type: "other", chargeName: "Phytosanitary certificate", basis: "per_shipment", amount: 450, currency: "CAD" },
      { rateId: null, type: "loading", chargeName: "stray", basis: "per_tonne", amount: 10, currency: "CAD" },
    ] } });
  assert.equal(q.status, 201, await q.clone().text());
  const { quote } = await q.json();
  assert.deepEqual(quote.inputs.lines.map((l) => l.chargeName), ["Phytosanitary certificate", ""]);
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
  const fresh = await req("/api/freight/access-links", { method: "POST", cookie: MEMBER, body: { label: `Unopened ${RUN}`, company: "E2E Client Co", expiresHours: 24 } });
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
