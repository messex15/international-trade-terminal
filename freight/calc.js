// Landed cost math, shared by the browser app and the server functions.
// Pure functions only: no DOM, no network, no Node APIs.
// Money is carried in CAD internally; USD amounts convert at `usdcad`
// (how many CAD one USD buys, e.g. 1.3850).

export const RATE_TYPES = {
  rail: "Rail freight",
  truck: "Truck or drayage",
  loading: "Loading and elevation",
  port: "Port and terminal",
  ocean: "Ocean freight",
  inspection: "Inspection and documents",
  insurance: "Insurance",
  other: "Other charge",
};

export const BASES = {
  per_tonne: { label: "per tonne", short: "/t", needsCapacity: false },
  per_car: { label: "per railcar", short: "/car", needsCapacity: true, unit: "railcar", plural: "railcars" },
  per_container: { label: "per container", short: "/cntr", needsCapacity: true, unit: "container", plural: "containers" },
  per_truckload: { label: "per truckload", short: "/load", needsCapacity: true, unit: "truckload", plural: "truckloads" },
  per_shipment: { label: "per shipment (flat)", short: "/shipment", needsCapacity: false },
  percent_of_value: { label: "% of goods value", short: "% of value", needsCapacity: false },
};

export const CURRENCIES = ["CAD", "USD"];

const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-04" -> "Oct 4, 2026", independent of the viewer's time zone. */
export function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return String(iso);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function isoToday(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Whole days from ISO date `a` to ISO date `b` (negative when b is earlier). */
export function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
}

/** Rates on the same lane replace each other over time. */
export function laneKey(rate) {
  return [rate.type, rate.provider, rate.origin, rate.destination, rate.commodity, rate.basis]
    .map((part) => String(part ?? "").trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
}

/** Newest first: later effective date wins, then later capture time. */
export function compareRatesNewestFirst(a, b) {
  if ((a.effectiveFrom || "") !== (b.effectiveFrom || "")) {
    return (b.effectiveFrom || "").localeCompare(a.effectiveFrom || "");
  }
  return (b.createdAt || "").localeCompare(a.createdAt || "");
}

/**
 * Groups rates by lane. Each lane has `latest` (newest active rate) and
 * `history` (all rates on the lane, newest first, archived included).
 */
export function groupLanes(rates, { includeArchived = false } = {}) {
  const lanes = new Map();
  for (const rate of rates) {
    const key = laneKey(rate);
    if (!lanes.has(key)) lanes.set(key, { key, history: [] });
    lanes.get(key).history.push(rate);
  }
  const result = [];
  for (const lane of lanes.values()) {
    lane.history.sort(compareRatesNewestFirst);
    const active = lane.history.filter((r) => !r.archivedAt);
    lane.latest = active[0] || null;
    lane.previous = active[1] || null;
    if (!lane.latest && !includeArchived) continue;
    if (!lane.latest) lane.latest = lane.history[0];
    result.push(lane);
  }
  return result;
}

/** Percent change from `previous` to `current` amount on the same basis and currency. */
export function percentChange(previous, current) {
  if (!previous || !current) return null;
  if (previous.currency !== current.currency || previous.basis !== current.basis) return null;
  const a = Number(previous.amount);
  const b = Number(current.amount);
  if (!(a > 0) || !Number.isFinite(b)) return null;
  return ((b - a) / a) * 100;
}

export function toCAD(amount, currency, usdcad) {
  if (currency === "USD") return usdcad > 0 ? amount * usdcad : null;
  return amount;
}

/**
 * Cost of one line per tonne of cargo, in CAD.
 * Per-unit charges (railcar, container, truckload) are billed per whole unit,
 * so a partial car costs a full car: units = ceil(quantity / capacity).
 */
export function lineCost(line, { usdcad, quantity_t, goodsPerTonneCAD }) {
  const basis = BASES[line.basis];
  if (!basis) return { error: "Choose how this charge is billed." };
  const amount = Number(line.amount);
  if (line.amount === "" || line.amount === null || !Number.isFinite(amount) || amount < 0) {
    return { error: "Enter an amount." };
  }

  if (line.basis === "percent_of_value") {
    if (goodsPerTonneCAD === null) return { error: "Needs a purchase price first." };
    return { perTonne: (goodsPerTonneCAD * amount) / 100 };
  }

  const cad = toCAD(amount, line.currency, usdcad);
  if (cad === null) return { error: "Needs a USD to CAD exchange rate." };

  if (basis.needsCapacity) {
    const capacity = Number(line.capacity_t);
    if (!(capacity > 0)) return { error: `Needs tonnes per ${basis.unit}.` };
    if (quantity_t > 0) {
      const units = Math.ceil(quantity_t / capacity - 1e-9);
      return { perTonne: (units * cad) / quantity_t, units, unitLabel: units === 1 ? basis.unit : basis.plural };
    }
    return { perTonne: cad / capacity };
  }

  if (line.basis === "per_shipment") {
    if (!(quantity_t > 0)) return { error: "Needs the quantity to spread a flat charge." };
    return { perTonne: cad / quantity_t };
  }

  return { perTonne: cad };
}

/** Flags a rate from memory that should not be trusted as-is on `quoteDate`. */
export function rateFlags(line, quoteDate, staleDays) {
  const flags = [];
  if (!line.rateId) {
    flags.push({ level: "info", code: "manual", message: "Typed in, not from rate memory." });
    return flags;
  }
  if (line.validUntil && line.validUntil < quoteDate) {
    flags.push({ level: "warning", code: "expired", message: `Expired on ${formatDate(line.validUntil)}.` });
  } else if (line.validUntil && daysBetween(quoteDate, line.validUntil) <= 7) {
    flags.push({ level: "info", code: "expiring", message: `Expires on ${formatDate(line.validUntil)}.` });
  }
  if (line.effectiveFrom && line.effectiveFrom > quoteDate) {
    flags.push({ level: "warning", code: "future", message: `Not in effect until ${formatDate(line.effectiveFrom)}.` });
  } else if (line.effectiveFrom && daysBetween(line.effectiveFrom, quoteDate) > staleDays) {
    const age = daysBetween(line.effectiveFrom, quoteDate);
    flags.push({ level: "warning", code: "stale", message: `Rate is ${age} days old. Confirm it still stands.` });
  }
  return flags;
}

function num(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Computes a full landed cost quote.
 * Margin is gross margin on the sale price: (sale - landed) / sale.
 */
export function computeQuote(q, { today = isoToday(), staleDays = 30 } = {}) {
  const issues = [];
  const quoteDate = q.quoteDate || today;
  const usdcad = num(q.usdcad);
  const quantity = num(q.quantity_t);
  const purchase = num(q.purchasePrice);
  const targetMargin = num(q.targetMarginPct) ?? 0;
  const floorMargin = num(q.minMarginPct) ?? 0;
  const usesUSD =
    q.purchaseCurrency === "USD" ||
    q.saleCurrency === "USD" ||
    (q.lines || []).some((l) => l.currency === "USD" && l.basis !== "percent_of_value");

  if (!(quantity > 0)) issues.push({ level: "error", code: "input", message: "Enter the quantity in tonnes." });
  if (purchase === null || purchase < 0) issues.push({ level: "error", code: "input", message: "Enter the purchase price per tonne." });
  if (usesUSD && !(usdcad > 0)) issues.push({ level: "error", code: "input", message: "Enter a USD to CAD exchange rate." });
  if (targetMargin < 0 || targetMargin >= 100) issues.push({ level: "error", code: "input", message: "Target margin must be between 0 and 99.9%." });
  if (floorMargin < 0 || floorMargin >= 100) issues.push({ level: "error", code: "input", message: "Margin floor must be between 0 and 99.9%." });

  const goodsPerTonne = purchase === null || purchase < 0 ? null : toCAD(purchase, q.purchaseCurrency, usdcad);

  const lines = (q.lines || []).map((line) => {
    const cost = lineCost(line, { usdcad, quantity_t: quantity, goodsPerTonneCAD: goodsPerTonne });
    const flags = rateFlags(line, quoteDate, staleDays);
    if (cost.error) flags.push({ level: "error", code: "input", message: cost.error });
    const perTonne = cost.perTonne ?? null;
    return {
      ...line,
      perTonneCAD: perTonne,
      totalCAD: perTonne !== null && quantity > 0 ? perTonne * quantity : null,
      units: cost.units ?? null,
      unitLabel: cost.unitLabel ?? null,
      flags,
    };
  });

  const chargesPerTonne = lines.reduce((sum, l) => sum + (l.perTonneCAD ?? 0), 0);
  const landedPerTonne = goodsPerTonne === null ? null : goodsPerTonne + chargesPerTonne;
  const landedTotal = landedPerTonne !== null && quantity > 0 ? landedPerTonne * quantity : null;

  const priceAt = (margin) =>
    landedPerTonne === null || margin < 0 || margin >= 100 ? null : landedPerTonne / (1 - margin / 100);
  const targetPricePerTonne = priceAt(targetMargin);
  const floorPricePerTonne = priceAt(floorMargin);

  let sale = null;
  const offered = num(q.salePrice);
  if (offered !== null && offered > 0 && landedPerTonne !== null) {
    const salePerTonne = toCAD(offered, q.saleCurrency, usdcad);
    if (salePerTonne !== null) {
      const profitPerTonne = salePerTonne - landedPerTonne;
      const marginPct = (profitPerTonne / salePerTonne) * 100;
      sale = {
        perTonneCAD: salePerTonne,
        profitPerTonneCAD: profitPerTonne,
        profitTotalCAD: quantity > 0 ? profitPerTonne * quantity : null,
        revenueTotalCAD: quantity > 0 ? salePerTonne * quantity : null,
        marginPct,
        belowFloor: marginPct < floorMargin,
        belowTarget: marginPct < targetMargin,
      };
      if (profitPerTonne < 0) {
        issues.push({ level: "error", code: "margin", message: "The offered price is below landed cost. This deal loses money." });
      } else if (sale.belowFloor) {
        issues.push({
          level: "error",
          code: "margin",
          message: `The offered price leaves a ${marginPct.toFixed(1)}% margin, below the ${floorMargin}% floor.`,
        });
      }
    }
  }

  for (const line of lines) {
    for (const flag of line.flags) {
      if (flag.level === "warning" || flag.level === "error") {
        issues.push({ level: flag.level, code: flag.code, message: `${lineName(line)}: ${flag.message}` });
      }
    }
  }

  const expiries = lines.filter((l) => l.rateId && l.validUntil).map((l) => l.validUntil).sort();
  const validUntil = expiries[0] || null;

  const usd = (cad) => (cad === null || !(usdcad > 0) ? null : cad / usdcad);

  return {
    quoteDate,
    quantity_t: quantity,
    usdcad,
    goodsPerTonneCAD: goodsPerTonne,
    chargesPerTonneCAD: chargesPerTonne,
    landedPerTonneCAD: landedPerTonne,
    landedPerTonneUSD: usd(landedPerTonne),
    landedTotalCAD: landedTotal,
    targetMarginPct: targetMargin,
    minMarginPct: floorMargin,
    targetPricePerTonneCAD: targetPricePerTonne,
    targetPricePerTonneUSD: usd(targetPricePerTonne),
    floorPricePerTonneCAD: floorPricePerTonne,
    floorPricePerTonneUSD: usd(floorPricePerTonne),
    sale,
    lines,
    validUntil,
    issues,
    hasErrors: issues.some((i) => i.level === "error"),
    // Missing or invalid inputs: the quote cannot be trusted or saved.
    hasInputErrors: issues.some((i) => i.level === "error" && i.code !== "margin"),
  };
}

export function lineName(line) {
  const type = RATE_TYPES[line.type] || "Charge";
  const who = line.provider || line.description;
  return who ? `${type} (${who})` : type;
}
