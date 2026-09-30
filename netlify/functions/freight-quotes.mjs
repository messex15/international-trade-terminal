// Saved quotes. The server recomputes every quote from its inputs with the
// same math the browser uses, so a saved quote cannot carry tampered totals.
// GET    /api/freight/quotes        summaries, newest first
// GET    /api/freight/quotes/:id    one full quote with its rate snapshot
// POST   /api/freight/quotes        save a quote
// DELETE /api/freight/quotes/:id    delete a quote
import { BASES, CURRENCIES, RATE_TYPES, computeQuote } from "../../freight/calc.js";
import {
  assertSameOrigin,
  cleanDate,
  cleanNumber,
  cleanText,
  HttpError,
  json,
  newId,
  quoteStore,
  readJson,
  requireSession,
  route,
  updateJsonDoc,
} from "../lib/http.mjs";

const INDEX_KEY = "index.json";
const EMPTY_INDEX = { version: 1, quotes: [] };

function cleanCurrency(value) {
  return CURRENCIES.includes(value) ? value : "CAD";
}

function cleanLine(line, i) {
  const at = `Cost line ${i + 1}`;
  if (!RATE_TYPES[line.type]) throw new HttpError(400, `${at}: choose a charge type.`);
  if (!BASES[line.basis]) throw new HttpError(400, `${at}: choose how it is billed.`);
  return {
    rateId: cleanText(line.rateId, 40) || null,
    type: line.type,
    provider: cleanText(line.provider, 80),
    description: cleanText(line.description, 120),
    origin: cleanText(line.origin, 80),
    destination: cleanText(line.destination, 80),
    commodity: cleanText(line.commodity, 60),
    basis: line.basis,
    amount: cleanNumber(line.amount, `${at} amount`, { min: 0, max: 10_000_000 }),
    currency: cleanCurrency(line.currency),
    capacity_t: cleanNumber(line.capacity_t, `${at} capacity`, { min: 0, max: 100_000 }),
    effectiveFrom: cleanDate(line.effectiveFrom, `${at} effective date`),
    validUntil: cleanDate(line.validUntil, `${at} valid-until date`),
    source: cleanText(line.source, 200),
  };
}

function cleanInputs(body) {
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (lines.length > 40) throw new HttpError(400, "A quote can have at most 40 cost lines.");
  return {
    reference: cleanText(body.reference, 60),
    buyer: cleanText(body.buyer, 100),
    commodity: cleanText(body.commodity, 60),
    destination: cleanText(body.destination, 80),
    incoterm: cleanText(body.incoterm, 20),
    quantity_t: cleanNumber(body.quantity_t, "Quantity", { min: 0, max: 10_000_000 }),
    quoteDate: cleanDate(body.quoteDate, "Quote date", { required: true }),
    purchasePrice: cleanNumber(body.purchasePrice, "Purchase price", { min: 0, max: 1_000_000 }),
    purchaseCurrency: cleanCurrency(body.purchaseCurrency),
    usdcad: cleanNumber(body.usdcad, "Exchange rate", { min: 0, max: 10 }),
    usdcadDate: cleanDate(body.usdcadDate, "Exchange rate date"),
    targetMarginPct: cleanNumber(body.targetMarginPct, "Target margin", { min: 0, max: 99.9 }),
    minMarginPct: cleanNumber(body.minMarginPct, "Margin floor", { min: 0, max: 99.9 }),
    salePrice: cleanNumber(body.salePrice, "Offered price", { min: 0, max: 1_000_000 }),
    saleCurrency: cleanCurrency(body.saleCurrency),
    notes: cleanText(body.notes, 1000),
    lines: lines.map(cleanLine),
  };
}

function summary(quote) {
  const r = quote.result;
  return {
    id: quote.id,
    reference: quote.inputs.reference,
    buyer: quote.inputs.buyer,
    commodity: quote.inputs.commodity,
    quantity_t: quote.inputs.quantity_t,
    quoteDate: quote.inputs.quoteDate,
    landedPerTonneCAD: r.landedPerTonneCAD,
    targetPricePerTonneCAD: r.targetPricePerTonneCAD,
    salePerTonneCAD: r.sale?.perTonneCAD ?? null,
    marginPct: r.sale?.marginPct ?? null,
    belowFloor: r.sale?.belowFloor ?? false,
    validUntil: r.validUntil,
    createdAt: quote.createdAt,
    createdBy: quote.createdBy,
  };
}

export default route(async (req, context) => {
  const session = await requireSession(req);
  const store = quoteStore();
  const id = context.params?.id;
  if (id && !/^[a-z0-9]{9}-[a-z0-9]{6}$/.test(id)) throw new HttpError(404, "No quote with that id.");

  if (req.method === "GET") {
    if (id) {
      const quote = await store.get(`quote/${id}`, { type: "json" });
      if (!quote) throw new HttpError(404, "No quote with that id.");
      return json({ quote });
    }
    const index = (await store.get(INDEX_KEY, { type: "json" })) || EMPTY_INDEX;
    return json({ quotes: index.quotes.slice(0, 300) });
  }

  assertSameOrigin(req);

  if (req.method === "POST" && !id) {
    const inputs = cleanInputs(await readJson(req, 100_000));
    const result = computeQuote(inputs, { today: inputs.quoteDate });
    if (result.hasInputErrors) {
      const first = result.issues.find((i) => i.level === "error" && i.code !== "margin");
      throw new HttpError(400, `Fix this before saving: ${first.message}`);
    }
    const quote = {
      id: newId(),
      inputs,
      result,
      createdAt: new Date().toISOString(),
      createdBy: session.label,
    };
    await store.setJSON(`quote/${quote.id}`, quote);
    await updateJsonDoc(store, INDEX_KEY, EMPTY_INDEX, (index) => {
      index.quotes = [summary(quote), ...index.quotes.filter((q) => q.id !== quote.id)];
      return { doc: index, value: null };
    });
    return json({ quote }, 201);
  }

  if (req.method === "DELETE" && id) {
    await updateJsonDoc(store, INDEX_KEY, EMPTY_INDEX, (index) => {
      index.quotes = index.quotes.filter((q) => q.id !== id);
      return { doc: index, value: null };
    });
    await store.delete(`quote/${id}`);
    return json({ ok: true });
  }

  throw new HttpError(405, "Method not allowed.");
});

export const config = {
  path: ["/api/freight/quotes", "/api/freight/quotes/:id"],
  method: ["GET", "POST", "DELETE"],
};
