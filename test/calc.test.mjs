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
  assert.match(r.error, /tonnes per railcar/);
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
