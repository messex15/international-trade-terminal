import assert from "node:assert/strict";
import { test } from "node:test";
import { computeQuote, groupLanes, laneKey, lineCost, percentChange } from "../freight/calc.js";

const near = (actual, expected, eps = 1e-6) => assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

test("per-railcar charges bill whole cars", () => {
  // 200 t in 90 t cars = 3 cars, not 2.22
  const r = lineCost({ basis: "per_car", amount: 4500, currency: "CAD", capacity_t: 90 }, { usdcad: 1.4, quantity_t: 200, goodsPerTonneCAD: 500 });
  assert.equal(r.units, 3);
  near(r.perTonne, (3 * 4500) / 200);
});

test("exact multiples do not round up an extra car", () => {
  const r = lineCost({ basis: "per_car", amount: 4500, currency: "CAD", capacity_t: 90 }, { usdcad: 1.4, quantity_t: 270, goodsPerTonneCAD: 500 });
  assert.equal(r.units, 3);
});

test("USD charges convert at the entered rate", () => {
  const r = lineCost({ basis: "per_container", amount: 2000, currency: "USD", capacity_t: 25 }, { usdcad: 1.4, quantity_t: 100, goodsPerTonneCAD: 500 });
  assert.equal(r.units, 4);
  near(r.perTonne, (4 * 2000 * 1.4) / 100);
});

test("percent of value applies to goods cost", () => {
  const r = lineCost({ basis: "percent_of_value", amount: 0.5, currency: "USD" }, { usdcad: null, quantity_t: 100, goodsPerTonneCAD: 600 });
  near(r.perTonne, 3);
});

test("missing capacity is an input error", () => {
  const r = lineCost({ basis: "per_car", amount: 4500, currency: "CAD", capacity_t: "" }, { usdcad: 1.4, quantity_t: 100, goodsPerTonneCAD: 500 });
  assert.match(r.error, /metric tonnes \(MT\) per railcar/);
});

test("full quote: landed cost, target price and margin check", () => {
  const q = computeQuote(
    {
      quantity_t: 180,
      quoteDate: "2026-09-30",
      purchasePrice: 400,
      purchaseCurrency: "CAD",
      usdcad: 1.4,
      targetMarginPct: 10,
      minMarginPct: 5,
      salePrice: 330,
      saleCurrency: "USD",
      lines: [
        { rateId: "a", type: "rail", provider: "CN", basis: "per_car", amount: 4500, currency: "CAD", capacity_t: 90, effectiveFrom: "2026-09-20", validUntil: "2026-10-31" },
        { rateId: "b", type: "loading", provider: "Elevator", basis: "per_tonne", amount: 12, currency: "CAD", effectiveFrom: "2026-09-01", validUntil: "2026-10-15" },
      ],
    },
    { today: "2026-09-30" },
  );
  // goods 400 + rail 2 cars * 4500 / 180 = 50 + loading 12 = 462
  near(q.landedPerTonneCAD, 462);
  near(q.landedTotalCAD, 462 * 180);
  near(q.targetPricePerTonneCAD, 462 / 0.9);
  // offered 330 USD = 462 CAD => zero margin => below 5% floor
  near(q.sale.perTonneCAD, 462);
  near(q.sale.marginPct, 0);
  assert.equal(q.sale.belowFloor, true);
  assert.equal(q.validUntil, "2026-10-15");
  assert.equal(q.hasInputErrors, false);
  assert.ok(q.issues.some((i) => i.code === "margin"));
});

test("expired and stale rates are flagged", () => {
  const q = computeQuote(
    {
      quantity_t: 100, purchasePrice: 400, purchaseCurrency: "CAD", targetMarginPct: 8, minMarginPct: 4, quoteDate: "2026-09-30",
      lines: [
        { rateId: "x", type: "rail", provider: "CPKC", basis: "per_tonne", amount: 30, currency: "CAD", effectiveFrom: "2026-06-01", validUntil: "2026-09-15" },
      ],
    },
    { today: "2026-09-30" },
  );
  const codes = q.lines[0].flags.map((f) => f.code);
  assert.ok(codes.includes("expired"));
  assert.ok(codes.includes("stale"));
});

test("missing inputs block saving", () => {
  const q = computeQuote({ quantity_t: "", purchasePrice: "", lines: [] }, { today: "2026-09-30" });
  assert.equal(q.hasInputErrors, true);
});

test("USD in use without an exchange rate is an input error", () => {
  const q = computeQuote(
    { quantity_t: 100, purchasePrice: 400, purchaseCurrency: "CAD", usdcad: "", lines: [{ type: "ocean", basis: "per_tonne", amount: 40, currency: "USD" }] },
    { today: "2026-09-30" },
  );
  assert.equal(q.hasInputErrors, true);
});

test("lanes keep history and pick the newest active rate", () => {
  const base = { type: "rail", provider: "CN", origin: "Shaunavon", destination: "Vancouver", commodity: "Yellow peas", basis: "per_car", currency: "CAD" };
  const rates = [
    { ...base, id: "1", amount: 4000, effectiveFrom: "2026-07-01", createdAt: "2026-07-01T00:00:00Z" },
    { ...base, id: "2", amount: 4200, effectiveFrom: "2026-09-01", createdAt: "2026-09-01T00:00:00Z" },
    { ...base, id: "3", amount: 4600, effectiveFrom: "2026-09-20", createdAt: "2026-09-20T00:00:00Z", archivedAt: "2026-09-21" },
  ];
  const [lane] = groupLanes(rates);
  assert.equal(lane.latest.id, "2");
  assert.equal(lane.previous.id, "1");
  near(percentChange(lane.previous, lane.latest), 5);
  assert.equal(laneKey({ ...base, provider: "  cn " }), laneKey(base));
});

// ---------------------------------------------------------------- standard rows and commission

const deal = (lines, extra = {}) => ({
  quantity_t: 100, quoteDate: "2026-10-02", purchasePrice: 500, purchaseCurrency: "CAD", targetMarginPct: 8, minMarginPct: 4, lines, ...extra,
});
const loading = { rateId: null, type: "loading", basis: "per_tonne", amount: 20, currency: "CAD" };
const commissionPct = (amount) => ({ rateId: null, standard: true, type: "commission", basis: "percent_of_sale", amount, currency: "CAD" });

test("commission on the sale price is covered by the target and floor prices", () => {
  const q = computeQuote(deal([loading, commissionPct(2)]));
  // 520 of cost before commission: price = 520 / (1 - 8% - 2%)
  near(q.targetPricePerTonneCAD, 520 / 0.9);
  near(q.floorPricePerTonneCAD, 520 / 0.94);
  const p = q.targetPricePerTonneCAD;
  near((p - (520 + 0.02 * p)) / p, 0.08); // exactly the target margin after paying commission
  assert.equal(q.saleBasedAt, "target");
  assert.equal(q.saleBasedPct, 2);
  near(q.lines[1].perTonneCAD, 0.02 * p);
  assert.equal(q.lines[1].atPrice, "target");
  near(q.landedPerTonneCAD, 520 + 0.02 * p);
  assert.equal(q.hasInputErrors, false);
});

test("with an offered price, commission is charged on that price", () => {
  const q = computeQuote(deal([loading, commissionPct(2)], { salePrice: 600, saleCurrency: "CAD" }));
  near(q.lines[1].perTonneCAD, 12);
  near(q.landedPerTonneCAD, 532);
  near(q.sale.marginPct, ((600 - 532) / 600) * 100);
  assert.equal(q.saleBasedAt, "offered");
});

test("commission can also be an amount per MT", () => {
  const q = computeQuote(deal([loading, { ...commissionPct(3), basis: "per_tonne" }]));
  near(q.landedPerTonneCAD, 523);
  near(q.targetPricePerTonneCAD, 523 / 0.92);
  assert.equal(q.saleBasedPct, 0);
  assert.equal(q.saleBasedAt, null);
});

test("blank standard rows are left out, even a USD ocean row with no exchange rate", () => {
  const blank = (type, basis, currency = "CAD") => ({ rateId: null, standard: true, type, basis, amount: "", currency, capacity_t: "" });
  const q = computeQuote(deal([
    blank("transload", "per_tonne"), blank("ocean", "per_container", "USD"), blank("insurance", "percent_of_value"), blank("commission", "percent_of_sale"),
  ]));
  assert.equal(q.hasInputErrors, false);
  assert.deepEqual(q.issues, []);
  near(q.landedPerTonneCAD, 500);
  near(q.targetPricePerTonneCAD, 500 / 0.92);
  assert.ok(q.lines.every((l) => l.unused && l.flags.length === 0 && l.perTonneCAD === null));
});

test("a filled-in standard row counts, and a USD one needs the exchange rate", () => {
  const ocean = { rateId: null, standard: true, type: "ocean", basis: "per_container", amount: 2000, currency: "USD", capacity_t: 25 };
  assert.equal(computeQuote(deal([ocean])).hasInputErrors, true);
  const q = computeQuote(deal([ocean], { usdcad: 1.4 }));
  near(q.landedPerTonneCAD, 500 + (4 * 2000 * 1.4) / 100);
});

test("a blank charge that is not a standard row is still an error", () => {
  const q = computeQuote(deal([{ rateId: null, type: "other", basis: "per_tonne", amount: "", currency: "CAD" }]));
  assert.equal(q.hasInputErrors, true);
});

test("target margin plus commission of 100% or more is an input error", () => {
  const q = computeQuote(deal([commissionPct(40)], { targetMarginPct: 60 }));
  assert.equal(q.hasInputErrors, true);
  assert.equal(q.targetPricePerTonneCAD, null);
});

// ---------------------------------------------------------------- final price and estimated earnings

test("final price is the entered price, and earnings are what is left after landed cost", () => {
  const q = computeQuote(deal([loading, commissionPct(2)], { salePrice: 600, saleCurrency: "CAD" }));
  assert.equal(q.final.source, "entered");
  near(q.final.perTonneCAD, 600);
  near(q.final.totalCAD, 60_000);
  near(q.final.earningsPerTonneCAD, 600 - 532); // 532 = 500 goods + 20 loading + 2% of 600
  near(q.final.earningsTotalCAD, 6_800);
  near(q.final.marginPct, (68 / 600) * 100);
});

test("with no price entered, the final price is the lowest price at the target margin", () => {
  const q = computeQuote(deal([loading, commissionPct(2)]));
  assert.equal(q.final.source, "target");
  near(q.final.perTonneCAD, 520 / 0.9);
  near(q.final.marginPct, 8);
  near(q.final.earningsTotalCAD, (520 / 0.9) * 0.08 * 100);
});

test("a USD final price also reports its USD value", () => {
  const q = computeQuote(deal([loading], { salePrice: 420, saleCurrency: "USD", usdcad: 1.4 }));
  near(q.final.perTonneCAD, 588);
  near(q.final.perTonneUSD, 420);
  near(q.final.totalUSD, 42_000);
  near(q.final.earningsTotalCAD, (588 - 520) * 100);
});

test("a losing price shows negative earnings", () => {
  const q = computeQuote(deal([loading], { salePrice: 500, saleCurrency: "CAD" }));
  near(q.final.earningsTotalCAD, -2_000);
  assert.ok(q.final.marginPct < 0);
});

test("no final price until there is a cost to price from", () => {
  assert.equal(computeQuote(deal([loading], { purchasePrice: "" })).final, null);
});
