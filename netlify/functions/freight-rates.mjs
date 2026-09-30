// Rate memory.
// GET   /api/freight/rates          all captured rates (archived included)
// POST  /api/freight/rates          capture a new rate
// PUT   /api/freight/rates/:id      correct a rate (the old values are kept as a revision)
// PATCH /api/freight/rates/:id      { archived: true | false }
//
// Rates live in one JSON document written with optimistic locking. A
// trading desk captures hundreds of rates a year, not millions, so one
// document keeps reads fast and history easy to scan.
import { BASES, CURRENCIES, RATE_TYPES, compareRatesNewestFirst, laneKey, percentChange } from "../../freight/calc.js";
import {
  assertSameOrigin,
  cleanDate,
  cleanNumber,
  cleanText,
  HttpError,
  json,
  newId,
  rateStore,
  readJson,
  requireSession,
  route,
  updateJsonDoc,
} from "../lib/http.mjs";

const DOC_KEY = "rates.json";
const EMPTY = { version: 1, rates: [] };
const EDITABLE = [
  "type", "provider", "origin", "destination", "commodity", "basis",
  "amount", "currency", "capacity_t", "effectiveFrom", "validUntil", "source", "notes",
];

function validateRate(body) {
  if (!RATE_TYPES[body.type]) throw new HttpError(400, "Choose a charge type.");
  if (!BASES[body.basis]) throw new HttpError(400, "Choose how the charge is billed.");
  const provider = cleanText(body.provider, 80);
  if (!provider) throw new HttpError(400, "Enter who is charging this (carrier, elevator, terminal).");

  const isPercent = body.basis === "percent_of_value";
  const amount = cleanNumber(body.amount, "Amount", { min: 0, max: isPercent ? 100 : 10_000_000, required: true });
  const currency = isPercent ? "CAD" : body.currency;
  if (!CURRENCIES.includes(currency)) throw new HttpError(400, "Currency must be CAD or USD.");

  let capacity = null;
  if (BASES[body.basis].needsCapacity) {
    capacity = cleanNumber(body.capacity_t, `Tonnes per ${BASES[body.basis].unit}`, { min: 0.1, max: 100_000, required: true });
  }

  const effectiveFrom = cleanDate(body.effectiveFrom, "Effective date", { required: true });
  const validUntil = cleanDate(body.validUntil, "Valid-until date");
  if (validUntil && validUntil < effectiveFrom) throw new HttpError(400, "Valid-until date is before the effective date.");

  return {
    type: body.type,
    provider,
    origin: cleanText(body.origin, 80),
    destination: cleanText(body.destination, 80),
    commodity: cleanText(body.commodity, 60),
    basis: body.basis,
    amount,
    currency,
    capacity_t: capacity,
    effectiveFrom,
    validUntil,
    source: cleanText(body.source, 200),
    notes: cleanText(body.notes, 500),
  };
}

function latestOnLane(rates, key, excludeId) {
  return rates
    .filter((r) => !r.archivedAt && r.id !== excludeId && laneKey(r) === key)
    .sort(compareRatesNewestFirst)[0] || null;
}

export default route(async (req, context) => {
  const session = await requireSession(req);
  const store = rateStore();
  const id = context.params?.id;

  if (req.method === "GET") {
    const doc = (await store.get(DOC_KEY, { type: "json" })) || EMPTY;
    return json({ rates: doc.rates });
  }

  assertSameOrigin(req);
  const body = await readJson(req, 20_000);
  const now = new Date().toISOString();

  if (req.method === "POST" && !id) {
    const fields = validateRate(body);
    const result = await updateJsonDoc(store, DOC_KEY, EMPTY, (doc) => {
      const rate = { id: newId(), ...fields, createdAt: now, createdBy: session.label, archivedAt: null, revisions: [] };
      const previous = latestOnLane(doc.rates, laneKey(rate), rate.id);
      doc.rates.push(rate);
      return { doc, value: { rate, previous, changePct: percentChange(previous, rate) } };
    });
    return json(result, 201);
  }

  if (!id) throw new HttpError(405, "Method not allowed.");

  if (req.method === "PUT") {
    const fields = validateRate(body);
    const rate = await updateJsonDoc(store, DOC_KEY, EMPTY, (doc) => {
      const existing = doc.rates.find((r) => r.id === id);
      if (!existing) throw new HttpError(404, "That rate no longer exists.");
      const before = Object.fromEntries(EDITABLE.map((k) => [k, existing[k]]));
      const revisions = [{ ...before, replacedAt: now, replacedBy: session.label }, ...(existing.revisions || [])].slice(0, 20);
      Object.assign(existing, fields, { updatedAt: now, updatedBy: session.label, revisions });
      return { doc, value: existing };
    });
    return json({ rate });
  }

  if (req.method === "PATCH") {
    if (typeof body.archived !== "boolean") throw new HttpError(400, "Send { archived: true } or { archived: false }.");
    const rate = await updateJsonDoc(store, DOC_KEY, EMPTY, (doc) => {
      const existing = doc.rates.find((r) => r.id === id);
      if (!existing) throw new HttpError(404, "That rate no longer exists.");
      existing.archivedAt = body.archived ? now : null;
      existing.archivedBy = body.archived ? session.label : null;
      return { doc, value: existing };
    });
    return json({ rate });
  }

  throw new HttpError(405, "Method not allowed.");
});

export const config = {
  path: ["/api/freight/rates", "/api/freight/rates/:id"],
  method: ["GET", "POST", "PUT", "PATCH"],
};
