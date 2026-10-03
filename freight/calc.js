// Landed cost math, shared by the browser app and the server functions.
// Pure functions only: no DOM, no network, no Node APIs.
// Money is carried in CAD internally; USD amounts convert at `usdcad`
// (how many CAD one USD buys, e.g. 1.3850).

export const RATE_TYPES = {
  rail: "Rail freight",
  truck: "Truck or drayage",
  loading: "Loading and elevation",
  transload: "Transloading",
  labour: "Labour charges",
  port: "Port and terminal",
  ocean: "Ocean freight",
  inspection: "Inspection and documents",
  insurance: "Insurance",
  commission: "Commission",
  other: "Other charge",
};

export const BASES = {
  per_tonne: { label: "per MT", short: "/MT", needsCapacity: false },
  per_car: { label: "per railcar", short: "/car", needsCapacity: true, unit: "railcar", plural: "railcars" },
  per_container: { label: "per container", short: "/cntr", needsCapacity: true, unit: "container", plural: "containers" },
  per_truckload: { label: "per truckload", short: "/load", needsCapacity: true, unit: "truckload", plural: "truckloads" },
  per_shipment: { label: "per shipment (flat)", short: "/shipment", needsCapacity: false },
  percent_of_value: { label: "% of goods value", short: "% of value", needsCapacity: false, percent: true },
  // Charged on the final price (typically commission). The target and floor
  // prices are solved so the charge is covered: price = cost / (1 - margin - %).
  // The key keeps its old name so saved rates and quotes still match.
  percent_of_sale: { label: "% of final price", short: "% of final", needsCapacity: false, percent: true },
};

const isBlank = (value) => value === "" || value === null || value === undefined;

/**
 * Every quote starts with a few standard rows (transloading, ocean freight,
 * insurance, commission). A standard row left without an amount is not part
 * of the quote: no cost, no warnings, not printed.
 */
export function isUnusedLine(line) {
  return Boolean(line?.standard) && isBlank(line.amount);
}

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

/** What a charge is called: its type, or for "Other charge" the name the user gave it. */
export function chargeLabel(item) {
  const name = item?.type === "other" ? String(item.chargeName ?? "").trim() : "";
  return name || RATE_TYPES[item?.type] || "Charge";
}

/**
 * Rates on the same lane replace each other over time. "Other charge" rates
 * also need the same name, so a terminal's fumigation and bagging rates stay
 * separate.
 */
export function laneKey(rate) {
  return [rate.type, rate.provider, rate.origin, rate.destination, rate.commodity, rate.basis, rate.type === "other" ? rate.chargeName : ""]
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

/** A CAD amount in `currency` (CAD or USD), at the quote's USD to CAD rate. */
export function fromCAD(cad, currency, usdcad) {
  if (cad === null || cad === undefined || !Number.isFinite(cad)) return null;
  if (currency === "USD") return usdcad > 0 ? cad / usdcad : null;
  return cad;
}

/**
 * The currency a charge is billed in. A % charge (of goods value or of the
 * final price) can be billed in either: the percentage is the same, and its
 * amount is shown in that currency at the quote's exchange rate.
 */
export function chargeCurrency(line) {
  return line.currency === "USD" ? "USD" : "CAD";
}

/**
 * Cost of one line per tonne of cargo, in CAD.
 * Per-unit charges (railcar, container, truckload) are billed per whole unit,
 * so a partial car costs a full car: units = ceil(quantity / capacity).
 */
export function lineCost(line, { usdcad, quantity_t, goodsPerTonneCAD, salePerTonneCAD = null }) {
  const basis = BASES[line.basis];
  if (!basis) return { error: "Choose how this charge is billed." };
  const amount = Number(line.amount);
  if (isBlank(line.amount) || !Number.isFinite(amount) || amount < 0) {
    return { error: "Enter an amount." };
  }

  if (line.basis === "percent_of_sale") {
    // Depends on the final price, which computeQuote works out first.
    if (salePerTonneCAD === null) return { salePct: amount };
    return { salePct: amount, perTonne: (salePerTonneCAD * amount) / 100 };
  }

  if (line.basis === "percent_of_value") {
    if (goodsPerTonneCAD === null) return { error: "Needs a purchase price first." };
    return { perTonne: (goodsPerTonneCAD * amount) / 100 };
  }

  const cad = toCAD(amount, line.currency, usdcad);
  if (cad === null) return { error: "Needs a USD to CAD exchange rate." };

  if (basis.needsCapacity) {
    const capacity = Number(line.capacity_t);
    if (!(capacity > 0)) return { error: `Needs metric tonnes (MT) per ${basis.unit}.` };
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
 * Margin is gross margin on the final price: (final - landed) / final.
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
    // The final price's currency only matters once a price is entered.
    (q.saleCurrency === "USD" && num(q.salePrice) > 0) ||
    q.summaryCurrency === "USD" ||
    (q.lines || []).some((l) => chargeCurrency(l) === "USD" && !isUnusedLine(l));

  if (!(quantity > 0)) issues.push({ level: "error", code: "input", message: "Enter the quantity in metric tonnes (MT)." });
  if (purchase === null || purchase < 0) issues.push({ level: "error", code: "input", message: "Enter the purchase price per metric tonne." });
  if (usesUSD && !(usdcad > 0)) issues.push({ level: "error", code: "input", message: "Enter a USD to CAD exchange rate." });
  if (targetMargin < 0 || targetMargin >= 100) issues.push({ level: "error", code: "input", message: "Target margin must be between 0 and 99.9%." });
  if (floorMargin < 0 || floorMargin >= 100) issues.push({ level: "error", code: "input", message: "Margin floor must be between 0 and 99.9%." });

  const goodsPerTonne = purchase === null || purchase < 0 ? null : toCAD(purchase, q.purchaseCurrency, usdcad);

  // Pass 1: every charge that does not depend on the final price.
  const costs = (q.lines || []).map((line) =>
    isUnusedLine(line) ? { unused: true } : lineCost(line, { usdcad, quantity_t: quantity, goodsPerTonneCAD: goodsPerTonne }));
  const fixedPerTonne = costs.reduce((sum, c) => sum + (c.salePct === undefined ? c.perTonne ?? 0 : 0), 0);
  const salePct = costs.reduce((sum, c) => sum + (c.salePct ?? 0), 0);
  const baseLanded = goodsPerTonne === null ? null : goodsPerTonne + fixedPerTonne;

  // Price for a gross margin m with s% of the sale price going to commission:
  // price - (cost + s * price) = m * price, so price = cost / (1 - m - s).
  if (salePct > 0 && targetMargin + salePct >= 100) {
    issues.push({ level: "error", code: "input", message: targetMargin > 0
      ? "Target margin plus commission must be under 100% of the final price."
      : "Commission must be under 100% of the final price." });
  }
  const priceAt = (margin) =>
    baseLanded === null || margin < 0 || margin + salePct >= 100 ? null : baseLanded / (1 - (margin + salePct) / 100);
  const targetPricePerTonne = priceAt(targetMargin);
  const floorPricePerTonne = priceAt(floorMargin);

  const offered = num(q.salePrice);
  const offeredPerTonne = offered !== null && offered > 0 ? toCAD(offered, q.saleCurrency, usdcad) : null;
  // Charges on the final price (commission) are worked out on the final price
  // entered on the quote, or on the target price when none is entered.
  const saleBasedAt = offeredPerTonne !== null ? "offered" : targetPricePerTonne !== null ? "target" : null;
  const referencePrice = offeredPerTonne ?? targetPricePerTonne;

  const lines = (q.lines || []).map((line, i) => {
    let cost = costs[i];
    if (cost.unused) {
      return { ...line, unused: true, perTonneCAD: null, totalCAD: null, perTonneUSD: null, totalUSD: null, units: null, unitLabel: null, flags: [] };
    }
    if (cost.salePct !== undefined) {
      cost = referencePrice === null
        ? { error: "Needs a purchase price first." }
        : { perTonne: (referencePrice * cost.salePct) / 100, atPrice: saleBasedAt };
    }
    const flags = rateFlags(line, quoteDate, staleDays);
    if (cost.error) flags.push({ level: "error", code: "input", message: cost.error });
    const perTonne = cost.perTonne ?? null;
    // A USD charge is also given in USD, at the quote's exchange rate.
    const perTonneUSD = perTonne !== null && chargeCurrency(line) === "USD" && usdcad > 0 ? perTonne / usdcad : null;
    return {
      ...line,
      perTonneCAD: perTonne,
      totalCAD: perTonne !== null && quantity > 0 ? perTonne * quantity : null,
      perTonneUSD,
      totalUSD: perTonneUSD !== null && quantity > 0 ? perTonneUSD * quantity : null,
      units: cost.units ?? null,
      unitLabel: cost.unitLabel ?? null,
      atPrice: cost.atPrice ?? null,
      flags,
    };
  });

  const chargesPerTonne = lines.reduce((sum, l) => sum + (l.perTonneCAD ?? 0), 0);
  const landedPerTonne = goodsPerTonne === null ? null : goodsPerTonne + chargesPerTonne;
  const landedTotal = landedPerTonne !== null && quantity > 0 ? landedPerTonne * quantity : null;

  let sale = null;
  if (offeredPerTonne !== null && landedPerTonne !== null) {
    const salePerTonne = offeredPerTonne;
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
      issues.push({ level: "error", code: "margin", message: "The final price is below landed cost. This deal loses money." });
    } else if (sale.belowFloor) {
      issues.push({
        level: "error",
        code: "margin",
        message: `The final price leaves a ${marginPct.toFixed(1)}% margin, below the ${floorMargin}% floor.`,
      });
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

  // Final price: the price for the customer. The price entered on the quote,
  // or the lowest price at the target margin when none is entered.
  // Estimated earnings: final price minus the full landed cost (commission on
  // the final price included, worked out at that same price).
  let final = null;
  const finalPerTonne = offeredPerTonne ?? targetPricePerTonne;
  if (finalPerTonne !== null && finalPerTonne > 0 && landedPerTonne !== null) {
    const earningsPerTonne = finalPerTonne - landedPerTonne;
    final = {
      source: offeredPerTonne !== null ? "entered" : "target",
      perTonneCAD: finalPerTonne,
      perTonneUSD: usd(finalPerTonne),
      totalCAD: quantity > 0 ? finalPerTonne * quantity : null,
      totalUSD: quantity > 0 ? usd(finalPerTonne * quantity) : null,
      earningsPerTonneCAD: earningsPerTonne,
      earningsTotalCAD: quantity > 0 ? earningsPerTonne * quantity : null,
      marginPct: (earningsPerTonne / finalPerTonne) * 100,
    };
  }

  return {
    quoteDate,
    quantity_t: quantity,
    usdcad,
    goodsPerTonneCAD: goodsPerTonne,
    chargesPerTonneCAD: chargesPerTonne,
    landedPerTonneCAD: landedPerTonne,
    landedPerTonneUSD: usd(landedPerTonne),
    landedTotalCAD: landedTotal,
    saleBasedPct: salePct,
    saleBasedAt: salePct > 0 ? saleBasedAt : null,
    targetMarginPct: targetMargin,
    minMarginPct: floorMargin,
    targetPricePerTonneCAD: targetPricePerTonne,
    targetPricePerTonneUSD: usd(targetPricePerTonne),
    floorPricePerTonneCAD: floorPricePerTonne,
    floorPricePerTonneUSD: usd(floorPricePerTonne),
    sale,
    final,
    lines,
    validUntil,
    issues,
    hasErrors: issues.some((i) => i.level === "error"),
    // Missing or invalid inputs: the quote cannot be trusted or saved.
    hasInputErrors: issues.some((i) => i.level === "error" && i.code !== "margin"),
  };
}

export function lineName(line) {
  const type = chargeLabel(line);
  const who = line.provider || line.description;
  return who ? `${type} (${who})` : type;
}
