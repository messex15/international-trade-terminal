// Freight Desk: rate memory and landed cost calculator.
//
// Rendered inside the trade terminal (src/App.js) for portal members, and on
// its own at /freight/ for clients who open a single-use access link. It uses
// the portal's own classes from styles.css (pageHead, card, toolbar,
// tableWrap, badge, formGrid, overlay, drawer, modal, toast); freight.css adds
// only the pieces the portal has no equivalent for.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive, ArchiveRestore, Calculator, Check, Copy, Download, Filter, History, KeyRound,
  Link2, PackageSearch, PencilLine, Plus, Printer, RefreshCw, Search, Ship, Trash2, TriangleAlert, Users, X,
} from 'lucide-react';
import {
  BASES, RATE_TYPES, chargeLabel, compareRatesNewestFirst, computeQuote, daysBetween, formatDate,
  groupLanes, isUnusedLine, isoToday, laneKey, percentChange,
} from './calc.js';

const h = React.createElement;

// Load freight.css once, next to this module, wherever the desk is mounted.
(function ensureStyles() {
  if (typeof document === 'undefined' || document.querySelector('link[data-freight-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./freight.css', import.meta.url).href;
  link.dataset.freightCss = '';
  document.head.appendChild(link);
})();

// ------------------------------------------------------------------ formatting

const moneyFormats = {};
function money(value, currency = 'CAD', digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  const key = currency + digits;
  moneyFormats[key] ??= new Intl.NumberFormat('en-CA', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
  return moneyFormats[key].format(value);
}
const tonnes = (v) => (Number.isFinite(v) ? `${new Intl.NumberFormat('en-CA', { maximumFractionDigits: 3 }).format(v)} MT` : '');
const pct = (v) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : '');
const pctSetting = (v) => (Number.isFinite(v) ? `${Number.isInteger(v) ? v : v.toFixed(1)}%` : '');

function basisText(r) {
  if (r.basis === 'percent_of_value') return 'of goods value';
  if (r.basis === 'percent_of_sale') return 'of sale price';
  const basis = BASES[r.basis];
  const cap = basis?.needsCapacity && r.capacity_t ? `, ${tonnes(Number(r.capacity_t))}` : '';
  return `${basis?.label || ''}${cap}`;
}
function amountText(r) {
  return BASES[r.basis]?.percent ? `${Number(r.amount)}%` : money(Number(r.amount), r.currency);
}
const rateText = (r) => `${amountText(r)} ${basisText(r)}`;
/** Charge label inside a sentence: types in lower case, a user's own charge name as typed. */
const labelInSentence = (r) => (r.type === 'other' && String(r.chargeName || '').trim() ? chargeLabel(r) : chargeLabel(r).toLowerCase());
function routeText(r) {
  if (r.origin && r.destination) return `${r.origin} to ${r.destination}`;
  return r.origin || r.destination || '';
}
function validity(validUntil, today = isoToday()) {
  if (!validUntil) return { cls: 'badge', text: 'No end date' };
  const days = daysBetween(today, validUntil);
  if (days < 0) return { cls: 'badge bad', text: `Expired ${formatDate(validUntil)}` };
  if (days <= 7) return { cls: 'badge warn', text: days === 0 ? 'Ends today' : `Ends in ${days} day${days === 1 ? '' : 's'}` };
  return { cls: 'badge good', text: formatDate(validUntil) };
}
function Validity({ validUntil }) {
  const v = validity(validUntil);
  return h('span', { className: v.cls }, v.text);
}
function Change({ value }) {
  if (value === null || value === undefined) return null;
  if (Math.abs(value) < 0.05) return h('small', null, 'No change');
  return h('span', { className: value > 0 ? 'fdUp' : 'fdDown' }, `${value > 0 ? '+' : ''}${value.toFixed(1)}%`);
}

// ------------------------------------------------------------------ data helpers

const DRAFT_KEY = 'ainu-freight-draft-v1';
const DEFAULT_BASIS = {
  rail: 'per_car', truck: 'per_truckload', loading: 'per_tonne', transload: 'per_tonne', labour: 'per_tonne', port: 'per_tonne',
  ocean: 'per_container', inspection: 'per_shipment', insurance: 'percent_of_value', commission: 'percent_of_sale', other: 'per_tonne',
};
// Every quote has these rows ready to fill in. Left blank, a row is not part of
// the quote (no cost, not printed). Adding a rate of the same type from rate
// memory takes over the blank row.
const STANDARD_LINES = [
  { type: 'transload', currency: 'CAD' },
  { type: 'labour', currency: 'CAD' },
  { type: 'ocean', currency: 'USD' },
  { type: 'insurance', currency: 'CAD' },
  { type: 'commission', currency: 'CAD' },
];
function standardLine({ type, currency }) {
  return { rateId: null, standard: true, type, provider: '', description: '', basis: DEFAULT_BASIS[type], amount: '', currency, capacity_t: '' };
}
/** Adds a blank standard row for each standard charge the quote does not have yet. */
// A missing row goes in its standard place: before the next standard charge the
// quote already has (so Labour charges lands after Transloading on older quotes).
function withStandardLines(lines = []) {
  const out = [...lines];
  STANDARD_LINES.forEach((s, k) => {
    if (out.some((l) => l.type === s.type)) return;
    const later = STANDARD_LINES.slice(k + 1).map((x) => x.type);
    const at = out.findIndex((l) => later.includes(l.type));
    out.splice(at < 0 ? out.length : at, 0, standardLine(s));
  });
  return out;
}
const COMMODITIES = ['Yellow peas', 'Green peas', 'Red lentils', 'Green lentils', 'Fava beans', 'Chickpeas', 'Canola', 'Flax seed', 'Mustard seed', 'Durum', 'Oats'];

// Printed at the top of the PDF. Each person can change it; new quotes keep
// the last name used in that browser, and saved quotes keep their own.
const DEFAULT_COMPANY = 'International Trade Terminal';

function blankQuote() {
  return {
    companyName: DEFAULT_COMPANY, reference: '', buyer: '', commodity: '', grade: '', destination: '', quantity_t: '', quoteDate: isoToday(),
    purchasePrice: '', purchaseCurrency: 'CAD', usdcad: '', usdcadDate: '',
    targetMarginPct: 8, minMarginPct: 4, salePrice: '', saleCurrency: 'USD', lines: withStandardLines(),
  };
}
function loadDraft() {
  try {
    const draft = { ...blankQuote(), ...(JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') || {}) };
    return { ...draft, lines: withStandardLines(Array.isArray(draft.lines) ? draft.lines : []) };
  } catch {
    return blankQuote();
  }
}
function saveDraft(quote) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(quote));
  } catch { /* storage blocked: the draft is simply not kept */ }
}
function lineFromRate(r) {
  return {
    rateId: r.id, type: r.type, chargeName: r.chargeName || '', provider: r.provider, description: '', origin: r.origin, destination: r.destination,
    commodity: r.commodity, basis: r.basis, amount: r.amount, currency: r.currency, capacity_t: r.capacity_t,
    effectiveFrom: r.effectiveFrom, validUntil: r.validUntil, source: r.source,
  };
}
function oneOffLine() {
  return { rateId: null, type: 'other', chargeName: '', provider: '', description: '', basis: 'per_tonne', amount: '', currency: 'CAD', capacity_t: '' };
}
const normName = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
const sortCustomers = (list) => [...list].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

/** Final price and estimated earnings from a saved quote summary (older summaries included). */
function finalOf(q) {
  const entered = q.salePerTonneCAD !== null && q.salePerTonneCAD !== undefined;
  const perTonne = entered ? q.salePerTonneCAD : q.targetPricePerTonneCAD;
  if (!(perTonne > 0) || q.landedPerTonneCAD === null || q.landedPerTonneCAD === undefined) return null;
  const earningsPerTonne = perTonne - q.landedPerTonneCAD;
  return { entered, perTonne, marginPct: (earningsPerTonne / perTonne) * 100, earnings: q.quantity_t > 0 ? earningsPerTonne * q.quantity_t : null };
}

function newerRateFor(line, rates) {
  if (!line.rateId) return null;
  const key = laneKey(line);
  const latest = rates.filter((r) => !r.archivedAt && laneKey(r) === key).sort(compareRatesNewestFirst)[0];
  if (!latest || latest.id === line.rateId) return null;
  return compareRatesNewestFirst(latest, line) < 0 ? latest : null;
}
/** computeQuote plus a check of every line against the newest rate on file. */
function assess(quote, rates) {
  const result = computeQuote(quote);
  result.lines.forEach((line, i) => {
    const newer = newerRateFor(quote.lines[i], rates);
    if (!newer) return;
    const change = percentChange(line, newer);
    line.flags.push({
      level: 'warning', code: 'newer', newerId: newer.id,
      message: `A newer rate is on file: ${rateText(newer)}, effective ${formatDate(newer.effectiveFrom)}${change !== null ? ` (${change > 0 ? '+' : ''}${change.toFixed(1)}%)` : ''}.`,
    });
    result.issues.push({ level: 'warning', code: 'newer', message: `${chargeLabel(line)} (${line.provider}): a newer rate is on file.` });
  });
  return result;
}

function useApi(variant, identity) {
  return useCallback(async function api(path, { method = 'GET', body } = {}, retried = false) {
    const res = await fetch(`/api/freight/${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      if (variant === 'portal' && identity?.refreshSession && !retried) {
        try { await identity.refreshSession(); } catch { /* fall through to the error */ }
        return api(path, { method, body }, true);
      }
      if (variant === 'standalone') location.href = '/freight/access/?reason=expired';
      throw new Error(variant === 'portal'
        ? 'Your portal sign-in has expired. Reload the page to sign in again.'
        : 'Your session has ended.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
    return data;
  }, [variant, identity]);
}

function useEscape(onClose) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

// ------------------------------------------------------------------ small parts

function Empty({ label }) {
  return h('div', { className: 'emptyState' }, h(PackageSearch, { size: 22 }), h('span', null, label));
}
function Field({ label, hint, className, children }) {
  return h('label', { className }, label, children, hint && h('span', { className: 'fdHint' }, hint));
}
function Button({ kind = 'secondary', icon, children, ...rest }) {
  return h('button', { type: 'button', className: kind, ...rest }, icon && h(icon, { size: 15 }), children);
}
function Overlay({ centered, onClose, children }) {
  useEscape(onClose);
  return h('div', { className: `overlay${centered ? ' centered' : ''}`, onMouseDown: (e) => { if (e.target === e.currentTarget) onClose(); } }, children);
}
function PanelHead({ kicker, title, onClose }) {
  return h('div', { className: 'drawerHead' },
    h('div', null, h('small', null, kicker), h('h2', null, title)),
    h('button', { type: 'button', className: 'iconButton', onClick: onClose, 'aria-label': 'Close' }, h(X, { size: 19 })));
}

// ------------------------------------------------------------------ main component

const TABS = [
  ['quote', 'Landed cost', Calculator],
  ['rates', 'Rate memory', Ship],
  ['quotes', 'Saved quotes', History],
  ['customers', 'Customers', Users],
  ['access', 'Client access', KeyRound],
];
const SUBTITLES = {
  quote: 'Price a shipment from real freight costs. Flags expired, old or replaced rates before a quote goes out.',
  rates: 'Every rail tariff, loading charge and carrier offer, captured as it arrives and kept with its history.',
  quotes: 'Each saved quote keeps a copy of the rates it was built on, so later changes are easy to spot.',
  customers: 'Your customers and their usual delivery terms, ready to pick on a quote. Shared with everyone who uses the Freight Desk.',
  access: 'Give a client single-use access to the Freight Desk without a portal account.',
};

export default function FreightDesk({ variant = 'portal', identity = null, onSession }) {
  const api = useApi(variant, identity);
  const [tab, setTab] = useState('quote');
  const [state, setState] = useState({ status: 'loading', error: '' });
  const [session, setSession] = useState(null);
  const [rates, setRates] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [quote, setQuote] = useState(loadDraft);
  const [toast, setToast] = useState(null);
  const [rateEditor, setRateEditor] = useState(null);
  const [openLane, setOpenLane] = useState(null);
  const [picker, setPicker] = useState(false);
  const [openQuote, setOpenQuote] = useState(null);
  const [saving, setSaving] = useState(false);
  const [printJob, setPrintJob] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [customerEditor, setCustomerEditor] = useState(null);

  const notify = useCallback((text, bad = false) => setToast({ text, bad, at: Date.now() }), []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.bad ? 6500 : 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => { saveDraft(quote); }, [quote]);
  // In the portal, getUser() keeps the Identity token refreshed while the desk is open.
  useEffect(() => { identity?.getUser?.().catch?.(() => {}); }, [identity]);

  const load = useCallback(async () => {
    try {
      // The client page (/freight/) asks for the client's view of the session, so
      // a client link always wins there, even in a browser also signed in to the portal.
      const [s, r, q, c] = await Promise.all([
        api(variant === 'standalone' ? 'session?view=client' : 'session'), api('rates'), api('quotes'),
        // The desk still works if the customer list cannot load; it is just empty.
        api('customers').catch(() => ({ customers: [] })),
      ]);
      setSession(s);
      onSession?.(s);
      setRates(r.rates);
      setQuotes(q.quotes);
      setCustomers(c.customers || []);
      setState({ status: 'ready', error: '' });
    } catch (err) {
      setState({ status: 'error', error: err.message });
    }
  }, [api, onSession, variant]);
  useEffect(() => { load(); }, [load]);

  const lanes = useMemo(() => groupLanes(rates, { includeArchived: true }), [rates]);
  const activeLanes = useMemo(() => lanes.filter((l) => !l.latest.archivedAt), [lanes]);
  const result = useMemo(() => assess(quote, rates), [quote, rates]);
  // Client access only ever appears inside the portal, for a portal member. The
  // client page never offers it, whoever is signed in.
  const canManageAccess = variant === 'portal' && session?.kind === 'member' && Boolean(session?.canManageAccess);
  const view = tab === 'access' && !canManageAccess ? 'quote' : tab;

  const replaceRate = (rate) => setRates((all) => all.map((r) => (r.id === rate.id ? rate : r)));
  const addLine = (line) => setQuote((q) => {
    const blank = q.lines.findIndex((l) => l.type === line.type && isUnusedLine(l));
    return { ...q, lines: blank >= 0 ? q.lines.map((l, j) => (j === blank ? line : l)) : [...q.lines, line] };
  });

  async function saveQuote() {
    setSaving(true);
    try {
      const { quote: saved } = await api('quotes', { method: 'POST', body: quote });
      notify(saved.result.sale?.belowFloor
        ? 'Quote saved. It is marked below your margin floor.'
        : `Quote saved${saved.inputs.reference ? ` as ${saved.inputs.reference}` : ''}.`);
      setQuotes((await api('quotes')).quotes);
    } catch (err) {
      notify(err.message, true);
    } finally {
      setSaving(false);
    }
  }

  async function addCustomer(fields) {
    try {
      const { customer } = await api('customers', { method: 'POST', body: fields });
      setCustomers((all) => sortCustomers([...all, customer]));
      notify(`${customer.name} added to your customers. Add their details under Customers.`);
    } catch (err) {
      notify(err.message, true);
    }
  }

  function newQuote() {
    if (quote.lines.some((l) => !isUnusedLine(l)) && !confirm('Start a new quote? The current one is cleared unless you saved it.')) return;
    setQuote((q) => ({ ...blankQuote(), companyName: q.companyName, targetMarginPct: q.targetMarginPct, minMarginPct: q.minMarginPct, usdcad: q.usdcad, usdcadDate: q.usdcadDate }));
  }

  function printQuote() {
    const company = String(quote.companyName || '').trim();
    const ref = String(quote.reference || '').trim();
    // Chrome and Edge suggest the page title as the PDF file name.
    const title = [company, ref ? `Quote ${ref}` : 'Quote'].filter(Boolean).join(' - ');
    setPrintJob({ at: new Date().toISOString(), title });
  }

  // Runs after the print header has rendered with the company name and time.
  useEffect(() => {
    if (!printJob) return undefined;
    // Zero page margins leave the browser no room for its own header and footer
    // (page title, date, web address, page numbers); the quote's padding stands
    // in for the margins. Added only while a quote prints, so printing any other
    // portal page keeps normal margins.
    const pageRule = document.createElement('style');
    pageRule.textContent = '@page { margin: 0; }';
    document.head.appendChild(pageRule);
    const savedTitle = document.title;
    document.title = printJob.title;
    document.body.classList.add('fdPrinting');
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener('afterprint', done);
      pageRule.remove();
      document.title = savedTitle;
      document.body.classList.remove('fdPrinting');
      setPrintJob(null);
    };
    window.addEventListener('afterprint', done);
    window.print();
    return done;
  }, [printJob]);

  function exportCsv() {
    const cols = ['id', 'type', 'chargeName', 'provider', 'origin', 'destination', 'commodity', 'basis', 'amount', 'currency', 'capacity_t', 'effectiveFrom', 'validUntil', 'source', 'notes', 'createdAt', 'createdBy', 'archivedAt'];
    const cell = (v) => {
      const s = String(v ?? '');
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; // stop spreadsheet formula injection
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const csv = [cols.join(','), ...rates.map((r) => cols.map((c) => cell(c === 'type' ? RATE_TYPES[r.type] : r[c])).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), { href: url, download: `freight-rates-${isoToday()}.csv` }).click();
    URL.revokeObjectURL(url);
  }

  async function openSavedQuote(id) {
    try {
      const { quote: saved } = await api(`quotes/${id}`);
      const loaded = { ...blankQuote(), companyName: quote.companyName, ...saved.inputs };
      const next = { ...loaded, lines: withStandardLines(loaded.lines) };
      setQuote(next);
      setOpenQuote(null);
      setTab('quote');
      const changed = assess(next, rates).lines.some((l) => l.flags.some((f) => f.code === 'newer'));
      notify(changed
        ? 'Quote opened. Some rates changed since it was saved; they are flagged on each line.'
        : 'Quote opened. Its rates are still the newest on file.');
    } catch (err) {
      notify(err.message, true);
    }
  }

  async function deleteSavedQuote(summary) {
    if (!confirm(`Delete ${summary.reference || 'this quote'}? This cannot be undone.`)) return;
    try {
      await api(`quotes/${summary.id}`, { method: 'DELETE' });
      setQuotes((await api('quotes')).quotes);
      setOpenQuote(null);
      notify('Quote deleted.');
    } catch (err) {
      notify(err.message, true);
    }
  }

  async function setArchived(rate, archived) {
    try {
      const { rate: updated } = await api(`rates/${rate.id}`, { method: 'PATCH', body: { archived } });
      replaceRate(updated);
      notify(archived ? 'Rate archived. It no longer appears in new quotes.' : 'Rate restored.');
    } catch (err) {
      notify(err.message, true);
    }
  }

  const headActions = {
    quote: [
      h(Button, { key: 'print', icon: Printer, onClick: printQuote }, 'Print'),
      h(Button, { key: 'new', kind: 'primary', icon: Plus, onClick: newQuote }, 'New quote'),
    ],
    rates: [
      h(Button, { key: 'csv', icon: Download, onClick: exportCsv, disabled: !rates.length }, 'Export CSV'),
      h(Button, { key: 'cap', kind: 'primary', icon: Plus, onClick: () => setRateEditor({}) }, 'Capture rate'),
    ],
    quotes: [h(Button, { key: 'ref', icon: RefreshCw, onClick: () => api('quotes').then((d) => setQuotes(d.quotes)).catch((e) => notify(e.message, true)) }, 'Refresh')],
    customers: [h(Button, { key: 'add', kind: 'primary', icon: Plus, onClick: () => setCustomerEditor({}) }, 'Add customer')],
    access: [],
  }[view];

  const counts = { rates: activeLanes.length, quotes: quotes.length, customers: customers.length };
  const tabs = TABS.filter(([id]) => id !== 'access' || canManageAccess);

  let body;
  if (state.status === 'loading') body = h(Empty, { label: 'Loading the Freight Desk…' });
  else if (state.status === 'error') {
    body = h('div', { className: 'notice' }, h(TriangleAlert, { size: 18 }),
      h('span', null, state.error, ' ', h('button', { type: 'button', className: 'fdLinkButton', onClick: () => { setState({ status: 'loading', error: '' }); load(); } }, 'Try again')));
  } else if (view === 'quote') {
    body = h(QuoteView, { quote, setQuote, result, onPick: () => setPicker(true), onSave: saveQuote, saving, api, notify, rates, customers, onAddCustomer: addCustomer });
  } else if (view === 'rates') {
    body = h(RatesView, { lanes, onOpen: setOpenLane, onCapture: () => setRateEditor({}) });
  } else if (view === 'quotes') {
    body = h(QuotesView, { quotes, onOpen: setOpenQuote });
  } else if (view === 'customers') {
    body = h(CustomersView, { customers, quotes, onOpen: (c) => setCustomerEditor({ customer: c }), onAdd: () => setCustomerEditor({}) });
  } else if (view === 'access' && canManageAccess) {
    body = h(AccessView, { api, notify });
  }

  const lane = openLane ? lanes.find((l) => l.key === openLane) : null;

  return h('div', { className: 'fd', 'data-variant': variant },
    view === 'quote' && h('div', { className: 'fdPrintHead' },
      h('b', null, quote.companyName),
      printJob && h('span', null, `Printed ${when(printJob.at)}`)),
    h('div', { className: 'pageHead' },
      h('div', null, h('h1', null, 'Freight Desk'), h('p', null, SUBTITLES[view])),
      state.status === 'ready' && headActions.length > 0 && h('div', { className: 'headActions' }, ...headActions)),
    h('div', { className: 'fdTabs', role: 'tablist', 'aria-label': 'Freight Desk sections' },
      tabs.map(([id, label, Icon]) => h('button', {
        key: id, type: 'button', role: 'tab', 'aria-selected': view === id, className: view === id ? 'active' : '', onClick: () => setTab(id),
      }, h(Icon, { size: 15 }), h('span', null, label), counts[id] ? h('span', { className: 'fdCount' }, counts[id]) : null))),
    body,
    rateEditor && h(RateEditor, {
      initial: rateEditor.rate, api, onClose: () => setRateEditor(null),
      onSaved: (saved, message, isNew) => {
        setRates((all) => (isNew ? [...all, saved] : all.map((r) => (r.id === saved.id ? saved : r))));
        notify(message);
      },
      providers: rates.map((r) => r.provider), places: rates.flatMap((r) => [r.origin, r.destination]),
    }),
    lane && h(LaneDrawer, {
      lane, onClose: () => setOpenLane(null),
      onAdd: (r) => { addLine(lineFromRate(r)); setOpenLane(null); setTab('quote'); notify(`Added ${labelInSentence(r)} from ${r.provider} to the quote.`); },
      onEdit: (r) => { setOpenLane(null); setRateEditor({ rate: r }); },
      onArchive: setArchived,
    }),
    picker && h(RatePicker, { lanes: activeLanes, quote, onAdd: (r) => addLine(lineFromRate(r)), onClose: () => setPicker(false) }),
    customerEditor && h(CustomerEditor, {
      initial: customerEditor.customer, api, onClose: () => setCustomerEditor(null),
      onSaved: (saved, isNew) => {
        setCustomers((all) => sortCustomers(isNew ? [...all, saved] : all.map((c) => (c.id === saved.id ? saved : c))));
        notify(isNew ? `${saved.name} added to your customers.` : `${saved.name} updated.`);
      },
      onDeleted: (gone) => {
        setCustomers((all) => all.filter((c) => c.id !== gone.id));
        notify(`${gone.name} removed from your customers. Saved quotes keep the name.`);
      },
    }),
    h('datalist', { id: 'fd-customers' }, customers.map((c) => h('option', { key: c.id, value: c.name }, [c.country, c.deliveryTerms].filter(Boolean).join(' · ')))),
    openQuote && h(QuoteDrawer, { summary: openQuote, onClose: () => setOpenQuote(null), onLoad: () => openSavedQuote(openQuote.id), onDelete: () => deleteSavedQuote(openQuote) }),
    h('datalist', { id: 'fd-charge-names' }, [...new Set(rates.filter((r) => r.type === 'other').map((r) => String(r.chargeName || '').trim()).filter(Boolean))].sort().map((n) => h('option', { key: n, value: n }))),
    h('datalist', { id: 'fd-commodities' }, [...new Set([...COMMODITIES, ...rates.map((r) => r.commodity).filter(Boolean)])].map((c) => h('option', { key: c, value: c }))),
    toast && h('div', { className: `toast${toast.bad ? ' fdToastBad' : ''}`, role: 'status', key: toast.at }, toast.text));
}

// ------------------------------------------------------------------ landed cost

function QuoteView({ quote, setQuote, result, onPick, onSave, saving, api, notify, rates, customers = [], onAddCustomer }) {
  const set = (key) => (e) => setQuote((q) => ({ ...q, [key]: e.target.value, ...(key === 'usdcad' ? { usdcadDate: '' } : {}) }));
  const setLine = (i, key) => (e) => setQuote((q) => ({ ...q, lines: q.lines.map((l, j) => (j === i ? { ...l, [key]: e.target.value } : l)) }));
  const removeLine = (i) => setQuote((q) => ({ ...q, lines: q.lines.filter((_, j) => j !== i) }));
  const useNewer = (i, rate) => setQuote((q) => ({ ...q, lines: q.lines.map((l, j) => (j === i ? lineFromRate(rate) : l)) }));
  const [fxBusy, setFxBusy] = useState(false);

  async function fetchFx() {
    setFxBusy(true);
    try {
      const fx = await api('fx');
      setQuote((q) => ({ ...q, usdcad: fx.usdcad, usdcadDate: fx.date }));
    } catch (err) {
      notify(err.message, true);
    } finally {
      setFxBusy(false);
    }
  }

  const input = (key, props = {}) => h('input', { value: quote[key] ?? '', onChange: set(key), ...props });
  const num = (key, props = {}) => input(key, { type: 'number', inputMode: 'decimal', min: 0, step: 'any', ...props });
  const currency = (key, label) => h('select', { value: quote[key], onChange: set(key), 'aria-label': label }, h('option', null, 'CAD'), h('option', null, 'USD'));

  // Picking a customer from the list also fills their usual delivery terms when
  // the quote has none, or still has the terms of the customer picked before
  // (terms typed by hand are never replaced).
  const known = customers.find((c) => normName(c.name) === normName(quote.buyer));
  const pickCustomer = (e) => {
    const value = e.target.value;
    setQuote((q) => {
      const match = customers.find((c) => normName(c.name) === normName(value));
      const previous = customers.find((c) => normName(c.name) === normName(q.buyer));
      const terms = String(q.destination || '').trim();
      const replaceTerms = match?.deliveryTerms && (!terms || (previous?.deliveryTerms && normName(terms) === normName(previous.deliveryTerms)));
      return { ...q, buyer: value, ...(replaceTerms ? { destination: match.deliveryTerms } : {}) };
    });
  };
  let customerHint = customers.length ? 'Pick from your customer list or type a name.' : 'Add customers under the Customers tab to pick them here.';
  if (known) customerHint = `From your customer list${known.country ? `, ${known.country}` : ''}.`;
  else if (String(quote.buyer || '').trim()) {
    customerHint = h(React.Fragment, null, 'Not on your customer list. ',
      h('button', { type: 'button', className: 'fdLinkButton', onClick: () => onAddCustomer?.({ name: quote.buyer }) }, 'Add it'));
  }

  return h('div', { className: 'fdCalc' },
    h('div', { className: 'fdCalcMain' },
      h('section', { className: 'card' },
        h('div', { className: 'cardTitle' }, h('h3', null, 'Deal')),
        h('div', { className: 'formGrid fdGrid3' },
          h(Field, { label: 'Your company name', hint: 'Printed at the top of the PDF.', className: 'fdNoPrint' },
            input('companyName', { maxLength: 100, placeholder: DEFAULT_COMPANY })),
          h(Field, { label: 'Quote reference' }, input('reference', { maxLength: 60, placeholder: 'Q-2026-041' })),
          h(Field, { label: 'Customer', hint: h('span', { className: 'fdNoPrint' }, customerHint) },
            input('buyer', { maxLength: 100, list: 'fd-customers', onChange: pickCustomer, autoComplete: 'off' })),
          h(Field, { label: 'Commodity' }, input('commodity', { maxLength: 60, list: 'fd-commodities' })),
          h(Field, { label: 'Grade' }, input('grade', { maxLength: 60, placeholder: 'No. 2 or better' })),
          h(Field, { label: 'Quantity (MT)' }, num('quantity_t')),
          h(Field, { label: 'Delivery terms' }, input('destination', { maxLength: 80, placeholder: 'CFR Manila' })),
          h(Field, { label: 'Quote date' }, input('quoteDate', { type: 'date' })))),
      h('section', { className: 'card' },
        h('div', { className: 'cardTitle' }, h('h3', null, 'Price and margin')),
        h('div', { className: 'formGrid fdGrid3' },
          h(Field, { label: 'Purchase price per MT', hint: 'What you pay the grower or supplier.' },
            h('span', { className: 'fdCombo' }, num('purchasePrice'), currency('purchaseCurrency', 'Purchase currency'))),
          h(Field, { label: 'USD to CAD rate', hint: quote.usdcadDate ? `Bank of Canada rate for ${formatDate(quote.usdcadDate)}.` : 'CAD for one US dollar.' },
            h('span', { className: 'fdCombo' }, num('usdcad', { placeholder: '1.3850' }),
              h('button', { type: 'button', className: 'secondary', onClick: fetchFx, disabled: fxBusy, title: 'Use the latest Bank of Canada daily rate' }, fxBusy ? '…' : 'BoC rate'))),
          h(Field, { label: 'Final price per MT', hint: 'Optional. Leave blank to use the lowest price at your target margin.' },
            h('span', { className: 'fdCombo' }, num('salePrice', { placeholder: 'Optional' }), currency('saleCurrency', 'Final price currency'))),
          h(Field, { label: 'Target margin (%)' }, num('targetMarginPct', { max: 99.9 })),
          h(Field, { label: 'Margin floor (%)', hint: 'Never quote below this.' }, num('minMarginPct', { max: 99.9 })))),
      h('section', { className: 'card dataCard fdChargesCard' },
        h('div', { className: 'cardTitle' }, h('h3', null, 'Freight and charges')),
        result.lines.length
          ? h('div', { className: 'tableWrap' },
            h('table', { className: 'fdStatic' },
              h('thead', null, h('tr', null, h('th', null, 'Charge'), h('th', null, 'Rate'), h('th', { className: 'fdNum' }, 'Per MT (CAD)'), h('th', { className: 'fdNum' }, 'Shipment (CAD)'), h('th', null, h('span', { className: 'fdSr' }, 'Remove')))),
              h('tbody', null, result.lines.map((line, i) => h(LineRow, { key: i, line, i, rates, setLine, removeLine, useNewer })))))
          : h(Empty, { label: 'No charges yet. Add rail, loading, port and ocean charges from rate memory.' }),
        h('div', { className: 'fdCardFoot' },
          h(Button, { kind: 'primary', icon: Plus, onClick: onPick }, 'Add from rate memory'),
          h(Button, { icon: PencilLine, onClick: () => setQuote((q) => ({ ...q, lines: [...q.lines, oneOffLine()] })) }, 'Add a one-off charge')))),
    h('aside', { className: 'fdCalcSide' }, h(QuoteSummary, { quote, result, onSave, saving })));
}

function LineRow({ line, i, rates, setLine, removeLine, useNewer }) {
  const flags = line.flags.filter((f) => f.code !== 'manual');
  const flagList = flags.length > 0 && h('ul', { className: 'fdFlags' }, flags.map((f, k) => h('li', { key: k, className: f.level },
    f.message, f.newerId && h('button', {
      type: 'button', className: 'fdLinkButton',
      onClick: () => { const rate = rates.find((r) => r.id === f.newerId); if (rate) useNewer(i, rate); },
    }, 'Use newer rate'))));
  const units = line.units ? h('small', null, `${line.units} ${line.unitLabel} for this quantity`) : null;
  const remove = h('td', { className: 'fdNum' }, h('button', { type: 'button', className: 'iconButton', onClick: () => removeLine(i), 'aria-label': 'Remove this charge' }, h(Trash2, { size: 15 })));
  const computed = [
    h('td', { key: 'pt', className: 'fdNum' }, h('b', null, money(line.perTonneCAD)),
      line.atPrice && h('small', null, line.atPrice === 'offered' ? 'at the offered price' : 'at the target price')),
    h('td', { key: 'tot', className: 'fdNum' }, money(line.totalCAD, 'CAD', 0)),
  ];

  if (line.rateId) {
    return h('tr', null,
      h('td', { className: 'fdWrap' }, h('b', null, line.provider), h('small', null, `${chargeLabel(line)}${routeText(line) ? `, ${routeText(line)}` : ''}`),
        h('small', null, `From rate memory, effective ${formatDate(line.effectiveFrom)}${line.source ? `. ${line.source}` : ''}`), flagList),
      h('td', null, h('b', null, amountText(line)), h('small', null, basisText(line)), units),
      ...computed, remove);
  }
  const needsCap = BASES[line.basis]?.needsCapacity;
  const isPercent = Boolean(BASES[line.basis]?.percent);
  const field = (key, props) => h('input', { value: line[key] ?? '', onChange: setLine(i, key), ...props });
  const typeName = RATE_TYPES[line.type];
  const label = chargeLabel(line); // an Other charge shows the name typed for it
  const isOther = line.type === 'other' && !line.standard;
  let note = 'One-off charge, not saved to rate memory.';
  if (line.unused) note = 'Not included. Enter an amount to add it to this quote.';
  else if (line.standard) note = 'Typed in for this quote, not saved to rate memory.';
  // A blank standard row is not part of the quote, so it is not printed.
  return h('tr', { className: line.unused ? 'fdNoPrint fdUnused' : undefined },
    h('td', { colSpan: 2, className: 'fdWrap' },
      // On paper the edit boxes would cut text off, so print the charge as text.
      h('div', { className: 'fdPrintOnly' },
        h('b', null, line.description || label),
        line.standard
          ? line.description && h('small', null, label)
          : h('small', null, line.description ? `${label}, one-off charge` : 'One-off charge'),
        line.amount !== '' && line.amount !== null && h('small', null, rateText(line))),
      h('div', { className: 'fdLineEdit fdNoPrint' },
        line.standard
          ? h('span', { className: 'fdLineType' }, typeName)
          : h('select', { value: line.type, onChange: setLine(i, 'type'), 'aria-label': 'Charge type' }, Object.entries(RATE_TYPES).map(([k, v]) => h('option', { key: k, value: k }, v))),
        isOther && field('chargeName', { placeholder: 'Name of charge', maxLength: 60, list: 'fd-charge-names', title: 'What the charge is, such as Fumigation or Bagging', 'aria-label': 'Name of other charge' }),
        field('description', { placeholder: line.standard ? 'Charged by (optional)' : isOther ? 'Charged by' : 'Charged by or what it is', maxLength: 120, 'aria-label': `${typeName} description` }),
        field('amount', { type: 'number', inputMode: 'decimal', min: 0, step: 'any', placeholder: isPercent ? '%' : 'Amount', 'aria-label': `${typeName} amount` }),
        h('select', { value: isPercent ? 'CAD' : line.currency, onChange: setLine(i, 'currency'), disabled: isPercent, 'aria-label': `${typeName} currency` }, h('option', null, 'CAD'), h('option', null, 'USD')),
        h('select', { value: line.basis, onChange: setLine(i, 'basis'), 'aria-label': `${typeName} billed` }, Object.entries(BASES).map(([k, v]) => h('option', { key: k, value: k }, v.label))),
        needsCap && field('capacity_t', { type: 'number', inputMode: 'decimal', min: 0, step: 'any', placeholder: `MT ${BASES[line.basis].short}`, title: `Metric tonnes (MT) per ${BASES[line.basis].unit}`, 'aria-label': `${typeName} MT per unit` })),
      h('small', { className: 'fdNoPrint' }, note), units, flagList),
    ...computed, remove);
}

function Row({ label, value, total }) {
  return h('div', { className: `fdRow${total ? ' total' : ''}` }, h('span', null, label), h('b', null, value));
}

/** The price going to the customer and what the deal is expected to earn. */
function FinalBlock({ quote, result: r }) {
  const f = r.final;
  const inUSD = quote.saleCurrency === 'USD';
  let perTonne = money(f.perTonneCAD);
  if (f.source === 'entered') perTonne = `${money(Number(quote.salePrice), quote.saleCurrency)}${inUSD ? ` (${money(f.perTonneCAD)})` : ''}`;
  else if (inUSD && f.perTonneUSD !== null) perTonne = `${money(f.perTonneUSD, 'USD')} (${money(f.perTonneCAD)})`;
  const whole = inUSD && f.totalUSD !== null ? `${money(f.totalUSD, 'USD', 0)} (${money(f.totalCAD, 'CAD', 0)})` : money(f.totalCAD, 'CAD', 0);
  return h('div', { className: 'fdFinal' },
    h('div', { className: 'fdRows' },
      h(Row, { label: 'Final price per MT', value: perTonne }),
      h(Row, { label: 'Final price, whole shipment', value: whole }),
      h(Row, { label: 'Margin', value: pct(f.marginPct) }),
      h(Row, { label: 'Estimated earnings per MT', value: money(f.earningsPerTonneCAD) }),
      h(Row, { label: 'Estimated earnings', value: money(f.earningsTotalCAD, 'CAD', 0), total: true })),
    f.source === 'target' && h('p', { className: 'fdHolds' },
      `No final price entered, so this uses the lowest price at your ${pctSetting(r.targetMarginPct)} target margin.`));
}

function QuoteSummary({ quote, result: r, onSave, saving }) {
  const ready = r.landedPerTonneCAD !== null && r.quantity_t > 0;
  const issues = r.issues.filter((i) => i.code !== 'margin');
  let verdict = null;
  if (ready && r.sale) {
    const s = r.sale;
    if (s.profitPerTonneCAD < 0) verdict = ['bad', `Loses ${money(-s.profitPerTonneCAD)} per metric tonne. Do not send this price.`];
    else if (s.belowFloor) verdict = ['bad', `Below your ${pctSetting(r.minMarginPct)} floor. Raise the price to at least ${money(quote.saleCurrency === 'USD' ? r.floorPricePerTonneUSD : r.floorPricePerTonneCAD, quote.saleCurrency)}.`];
    else if (s.belowTarget) verdict = ['warn', `Clears the floor but misses the ${pctSetting(r.targetMarginPct)} target.`];
    else verdict = ['good', `Meets the ${pctSetting(r.targetMarginPct)} target.`];
  }
  return h('section', { className: 'card fdSummary' },
    h('div', { className: 'cardTitle' }, h('h3', null, 'Quote summary'), h('span', { className: 'badge' }, quote.reference || 'Draft')),
    !ready
      ? h('p', { className: 'fdSummaryEmpty' }, 'Enter a quantity and purchase price, then add charges. The landed cost and the lowest safe price appear here.')
      : h(React.Fragment, null,
        h('div', { className: 'fdRows' },
          h(Row, { label: 'Quantity', value: tonnes(r.quantity_t) }),
          h(Row, { label: 'Goods per MT', value: money(r.goodsPerTonneCAD) }),
          h(Row, { label: 'Freight and charges per MT', value: money(r.chargesPerTonneCAD) }),
          h(Row, { label: 'Landed cost per MT', value: money(r.landedPerTonneCAD), total: true }),
          h(Row, { label: 'Landed cost, whole shipment', value: money(r.landedTotalCAD, 'CAD', 0) })),
        r.saleBasedAt && h('p', { className: 'fdHolds' },
          `Includes ${pctSetting(r.saleBasedPct)} of the sale price (commission), worked out at the ${r.saleBasedAt} price. The target and floor prices cover it.`),
        h('div', { className: 'fdFigure' },
          h('small', null, `Lowest price at ${pctSetting(r.targetMarginPct)} margin`),
          h('strong', null, money(r.targetPricePerTonneCAD), h('span', null, ' /MT')),
          r.targetPricePerTonneUSD !== null && h('em', null, `${money(r.targetPricePerTonneUSD, 'USD')} per MT at ${r.usdcad}`)),
        h('div', { className: 'fdRows' },
          h(Row, { label: `Floor at ${pctSetting(r.minMarginPct)} margin`, value: `${money(r.floorPricePerTonneCAD)}${r.floorPricePerTonneUSD !== null ? ` (${money(r.floorPricePerTonneUSD, 'USD')})` : ''}` })),
        r.final && h(FinalBlock, { quote, result: r }),
        verdict && h('div', { className: `fdVerdict ${verdict[0]}` }, verdict[1]),
        h('p', { className: 'fdHolds' }, r.validUntil
          ? h(React.Fragment, null, 'Holds until ', h('b', null, formatDate(r.validUntil)), ', when the first rate used expires.')
          : quote.lines.some((l) => l.rateId) ? 'None of the rates used state an end date. Confirm them before sending.' : null)),
    issues.length > 0 && h('ul', { className: 'fdIssues' }, issues.map((i, k) => h('li', { key: k, className: i.level }, i.message))),
    h('div', { className: 'fdSummaryActions' },
      h(Button, { kind: 'primary', icon: Check, onClick: onSave, disabled: saving || r.hasInputErrors }, saving ? 'Saving…' : 'Save quote')),
    h('p', { className: 'fdFine' }, 'Margin is gross margin on the sale price. Railcar, container and truckload charges count whole units, so a part-filled car costs a full car.'));
}

// ------------------------------------------------------------------ rate memory

function RatesView({ lanes, onOpen, onCapture }) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('All');
  const [show, setShow] = useState('Current');
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lanes
      .filter(({ latest }) => (show === 'Archived' ? latest.archivedAt : !latest.archivedAt))
      .filter(({ latest }) => type === 'All' || latest.type === type)
      .filter(({ latest }) => !q || [chargeLabel(latest), RATE_TYPES[latest.type], latest.provider, latest.origin, latest.destination, latest.commodity, latest.source, latest.notes].join(' ').toLowerCase().includes(q))
      .sort((a, b) => compareRatesNewestFirst(a.latest, b.latest));
  }, [lanes, query, type, show]);

  return h('section', { className: 'card dataCard' },
    h('div', { className: 'toolbar' },
      h('div', { className: 'pageSearch' }, h(Search, { size: 15 }),
        h('input', { 'aria-label': 'Search rates', placeholder: 'Search carrier, place, commodity or source...', value: query, onChange: (e) => setQuery(e.target.value) })),
      h('label', { className: 'filterSelect' }, h(Filter, { size: 15 }),
        h('select', { value: type, onChange: (e) => setType(e.target.value), 'aria-label': 'Charge type' },
          h('option', { value: 'All' }, 'All charge types'), Object.entries(RATE_TYPES).map(([k, v]) => h('option', { key: k, value: k }, v)))),
      h('label', { className: 'filterSelect' }, h(Archive, { size: 15 }),
        h('select', { value: show, onChange: (e) => setShow(e.target.value), 'aria-label': 'Current or archived' },
          h('option', { value: 'Current' }, 'Current rates'), h('option', { value: 'Archived' }, 'Archived rates'))),
      h('span', { className: 'recordCount' }, `${visible.length} rate${visible.length === 1 ? '' : 's'}`)),
    visible.length
      ? h('div', { className: 'tableWrap' },
        h('table', null,
          h('thead', null, h('tr', null, ['Charged by', 'Route', 'Commodity', 'Rate', 'Change', 'Effective', 'Valid until', 'Source'].map((c) => h('th', { key: c, className: c === 'Rate' || c === 'Change' ? 'fdNum' : undefined }, c)))),
          h('tbody', null, visible.map((lane) => {
            const r = lane.latest;
            const earlier = lane.history.length - 1;
            return h('tr', { key: lane.key, tabIndex: 0, onClick: () => onOpen(lane.key), onKeyDown: (e) => { if (e.key === 'Enter') onOpen(lane.key); } },
              h('td', null, h('b', null, r.provider), h('small', null, `${chargeLabel(r)}${earlier ? `, ${earlier} earlier` : ''}`)),
              h('td', null, routeText(r)),
              h('td', null, r.commodity || 'Any'),
              h('td', { className: 'fdNum' }, h('b', null, amountText(r)), h('small', null, basisText(r))),
              h('td', { className: 'fdNum' }, h(Change, { value: percentChange(lane.previous, r) })),
              h('td', null, formatDate(r.effectiveFrom)),
              h('td', null, r.archivedAt ? h('span', { className: 'badge' }, 'Archived') : h(Validity, { validUntil: r.validUntil })),
              h('td', { className: 'fdWrap fdSource' }, r.source, r.notes && h('small', null, r.notes)));
          }))))
      : h('div', { className: 'emptyState' }, h(PackageSearch, { size: 22 }),
        h('span', null, lanes.length ? 'No rates match the current view.' : 'No rates captured yet. Capture the first one; every quote after that can use it.'),
        !lanes.length && h(Button, { kind: 'primary', icon: Plus, onClick: onCapture }, 'Capture rate')));
}

function LaneDrawer({ lane, onClose, onAdd, onEdit, onArchive }) {
  const r = lane.latest;
  return h(Overlay, { onClose },
    h('aside', { className: 'drawer' },
      h(PanelHead, { kicker: chargeLabel(r), title: r.provider, onClose }),
      h('div', { className: 'drawerBody' },
        r.commodity && h('div', { className: 'businessTag' }, r.commodity),
        h('div', { className: 'detailGrid' },
          [['Route', routeText(r) || 'Not set'], ['Rate', rateText(r)], ['Effective', formatDate(r.effectiveFrom)],
            ['Valid until', r.validUntil ? formatDate(r.validUntil) : 'No end date'], ['Source', r.source || 'Not recorded'],
            ['Captured by', `${r.createdBy}, ${formatDate(r.createdAt.slice(0, 10))}`]]
            .map(([k, v]) => h('div', { key: k }, h('small', null, k), h('strong', null, v)))),
        r.notes && h('div', { className: 'detailBlock' }, h('small', null, 'Notes'), h('p', null, r.notes)),
        h('div', { className: 'fdDrawerActions' },
          !r.archivedAt && h(Button, { kind: 'primary', icon: Plus, onClick: () => onAdd(r) }, 'Add to quote'),
          h(Button, { icon: PencilLine, onClick: () => onEdit(r) }, 'Correct'),
          h(Button, { icon: r.archivedAt ? ArchiveRestore : Archive, onClick: () => onArchive(r, !r.archivedAt) }, r.archivedAt ? 'Restore' : 'Archive')),
        h('div', { className: 'detailBlock' },
          h('small', null, `History on this lane (${lane.history.length})`),
          h('div', { className: 'fdHistory' }, lane.history.map((v, i) => {
            const before = lane.history.slice(i + 1).find((x) => !x.archivedAt);
            return h('div', { key: v.id, className: v.id === r.id ? 'current' : '' },
              h('span', null, h('b', null, rateText(v)), h('small', null, `Effective ${formatDate(v.effectiveFrom)}${v.source ? `. ${v.source}` : ''}${v.archivedAt ? '. Archived' : ''}`)),
              h('span', { className: 'fdHistoryEnd' }, h(Change, { value: v.archivedAt ? null : percentChange(before, v) }),
                v.id !== r.id && h('button', { type: 'button', className: 'fdLinkButton', onClick: () => onArchive(v, !v.archivedAt) }, v.archivedAt ? 'Restore' : 'Archive')));
          }))),
        r.revisions?.length > 0 && h('div', { className: 'notice' }, h(History, { size: 18 }),
          h('span', null, `Corrected ${r.revisions.length} time${r.revisions.length === 1 ? '' : 's'}. Previous values are kept in the rate's record.`)))));
}

const RATE_FIELDS = ['type', 'chargeName', 'provider', 'commodity', 'origin', 'destination', 'amount', 'currency', 'basis', 'capacity_t', 'effectiveFrom', 'validUntil', 'source', 'notes'];

function RateEditor({ initial, api, onClose, onSaved, providers, places }) {
  const editing = Boolean(initial?.id);
  const [form, setForm] = useState(() => (editing
    ? Object.fromEntries(RATE_FIELDS.map((k) => [k, initial[k] ?? '']))
    : { type: 'rail', chargeName: '', provider: '', commodity: '', origin: '', destination: '', amount: '', currency: 'CAD', basis: 'per_car', capacity_t: '', effectiveFrom: isoToday(), validUntil: '', source: '', notes: '' }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [key]: value, ...(key === 'type' && !editing ? { basis: DEFAULT_BASIS[value] || 'per_tonne' } : {}) }));
  };
  const basis = BASES[form.basis];
  const uniq = (list) => [...new Set(list.map((x) => (x || '').trim()).filter(Boolean))].sort();

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = { ...form, chargeName: form.type === 'other' ? form.chargeName : '', currency: BASES[form.basis]?.percent ? 'CAD' : form.currency };
    try {
      if (editing) {
        const { rate } = await api(`rates/${initial.id}`, { method: 'PUT', body });
        onSaved(rate, "Correction saved. The old values are kept in the rate's record.", false);
      } else {
        const { rate, previous, changePct } = await api('rates', { method: 'POST', body });
        let message = 'Rate saved. It is the first on this lane.';
        if (previous && changePct !== null) {
          message = Math.abs(changePct) < 0.05
            ? `Rate saved. Same as the previous ${previous.provider} rate on this lane.`
            : `Rate saved. ${changePct > 0 ? 'Up' : 'Down'} ${Math.abs(changePct).toFixed(1)}% from the previous ${previous.provider} rate on this lane.`;
        } else if (previous) {
          message = 'Rate saved. It replaces the previous rate on this lane.';
        }
        onSaved(rate, message, true);
      }
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const input = (key, props = {}) => h('input', { value: form[key] ?? '', onChange: set(key), ...props });
  return h(Overlay, { centered: true, onClose },
    h('form', { className: 'modal fd', onSubmit: submit, noValidate: true },
      h(PanelHead, { kicker: 'Rate memory', title: editing ? `Correct ${initial.provider} ${labelInSentence(initial)}` : 'Capture a rate', onClose }),
      h('div', { className: 'formGrid' },
        h(Field, { label: 'Charge type' }, h('select', { value: form.type, onChange: set('type'), autoFocus: true }, Object.entries(RATE_TYPES).map(([k, v]) => h('option', { key: k, value: k }, v)))),
        form.type === 'other' && h(Field, { label: 'Name of charge', hint: 'What it is, so it is easy to find and reuse.' },
          input('chargeName', { list: 'fd-charge-names', maxLength: 60, required: true, placeholder: 'Fumigation, bagging, demurrage' })),
        h(Field, { label: 'Charged by' }, input('provider', { list: 'fd-providers', maxLength: 80, placeholder: 'CN, Viterra, COSCO', required: true })),
        h(Field, { label: 'From' }, input('origin', { list: 'fd-places', maxLength: 80, placeholder: 'Shaunavon, SK' })),
        h(Field, { label: 'To' }, input('destination', { list: 'fd-places', maxLength: 80, placeholder: 'Vancouver, BC' })),
        h(Field, { label: 'Commodity', hint: 'Blank if it applies to any commodity.' }, input('commodity', { list: 'fd-commodities', maxLength: 60 })),
        h(Field, { label: 'Billed' }, h('select', { value: form.basis, onChange: set('basis') }, Object.entries(BASES).map(([k, v]) => h('option', { key: k, value: k }, v.label)))),
        h(Field, { label: 'Amount' }, h('span', { className: 'fdCombo' },
          input('amount', { type: 'number', inputMode: 'decimal', min: 0, step: 'any', required: true }),
          h('select', { value: form.currency, onChange: set('currency'), disabled: Boolean(BASES[form.basis]?.percent), 'aria-label': 'Currency' }, h('option', null, 'CAD'), h('option', null, 'USD')))),
        basis?.needsCapacity && h(Field, { label: `MT per ${basis.unit}`, hint: 'Metric tonnes it holds. Turns the rate into a cost per MT.' }, input('capacity_t', { type: 'number', inputMode: 'decimal', min: 0, step: 'any' })),
        // Keeps the dates on a row of their own in the two-column form.
        (7 + (form.type === 'other' ? 1 : 0) + (basis?.needsCapacity ? 1 : 0)) % 2 === 1 && h('span', { 'aria-hidden': true }),
        h(Field, { label: 'Effective from' }, input('effectiveFrom', { type: 'date', required: true })),
        h(Field, { label: 'Valid until', hint: 'Offer or tariff expiry, if stated.' }, input('validUntil', { type: 'date' })),
        h(Field, { label: 'Source', className: 'fdSpan2' }, input('source', { maxLength: 200, placeholder: 'Email from CN rates desk, Sep 29' })),
        h(Field, { label: 'Notes', className: 'fdSpan2' }, h('textarea', { value: form.notes, onChange: set('notes'), maxLength: 500, rows: 3, placeholder: 'Fuel surcharge included, minimum 80 MT per car, and similar conditions' }))),
      h('div', { className: `modalNote${error ? ' fdError' : ''}`, role: error ? 'alert' : undefined },
        error || (editing ? 'For typos only. A new tariff should be captured as a new rate so the change is tracked.' : 'Saved to shared rate memory. Everyone with Freight Desk access sees it.')),
      h('div', { className: 'modalActions' },
        h('button', { type: 'button', className: 'secondary', onClick: onClose }, 'Cancel'),
        h('button', { type: 'submit', className: 'primary', disabled: busy }, h(Check, { size: 15 }), busy ? 'Saving…' : editing ? 'Save correction' : 'Save rate')),
      h('datalist', { id: 'fd-providers' }, uniq(providers).map((v) => h('option', { key: v, value: v }))),
      h('datalist', { id: 'fd-places' }, uniq(places).map((v) => h('option', { key: v, value: v })))));
}

function RatePicker({ lanes, quote, onAdd, onClose }) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('match');
  const commodity = (quote.commodity || '').trim().toLowerCase();
  const inQuote = new Set(quote.lines.map((l) => l.rateId).filter(Boolean));
  const rows = lanes.map((l) => l.latest)
    .filter((r) => scope === 'all' || !commodity || !r.commodity || r.commodity.toLowerCase() === commodity)
    .filter((r) => !query.trim() || [chargeLabel(r), RATE_TYPES[r.type], r.provider, r.origin, r.destination, r.commodity].join(' ').toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.type.localeCompare(b.type) || a.provider.localeCompare(b.provider));

  let empty = 'Rate memory is empty. Capture rates under Rate memory first.';
  if (lanes.length) empty = commodity && scope !== 'all' ? `No rates for ${quote.commodity}. Show all commodities, or capture one under Rate memory.` : 'No rates match that search.';

  return h(Overlay, { centered: true, onClose },
    h('div', { className: 'modal fd fdWideModal', role: 'dialog', 'aria-label': 'Add from rate memory' },
      h(PanelHead, { kicker: 'Rate memory', title: 'Add charges to the quote', onClose }),
      h('div', { className: 'toolbar' },
        h('div', { className: 'pageSearch' }, h(Search, { size: 15 }),
          h('input', { autoFocus: true, 'aria-label': 'Search rates', placeholder: 'Search carrier, place or charge type...', value: query, onChange: (e) => setQuery(e.target.value) })),
        commodity && h('label', { className: 'filterSelect' }, h(Filter, { size: 15 }),
          h('select', { value: scope, onChange: (e) => setScope(e.target.value), 'aria-label': 'Commodity filter' },
            h('option', { value: 'match' }, `${quote.commodity} and any`), h('option', { value: 'all' }, 'All commodities')))),
      rows.length
        ? h('div', { className: 'tableWrap' },
          h('table', { className: 'fdStatic' },
            h('thead', null, h('tr', null, ['Charged by', 'Route', 'Commodity', 'Rate', 'Valid until', ''].map((c, k) => h('th', { key: k, className: c === 'Rate' ? 'fdNum' : undefined }, c)))),
            h('tbody', null, rows.map((r) => h('tr', { key: r.id },
              h('td', null, h('b', null, r.provider), h('small', null, chargeLabel(r))),
              h('td', null, routeText(r)),
              h('td', null, r.commodity || 'Any'),
              h('td', { className: 'fdNum' }, h('b', null, amountText(r)), h('small', null, basisText(r))),
              h('td', null, h(Validity, { validUntil: r.validUntil })),
              h('td', { className: 'fdNum' }, inQuote.has(r.id)
                ? h('span', { className: 'badge good' }, 'In quote')
                : h(Button, { kind: 'primary', icon: Plus, onClick: () => onAdd(r) }, 'Add')))))))
        : h(Empty, { label: empty }),
      h('div', { className: 'modalActions' }, h('button', { type: 'button', className: 'primary', onClick: onClose }, 'Done'))));
}

// ------------------------------------------------------------------ saved quotes

function marginBadge(q, f = finalOf(q)) {
  if (!f) return null;
  if (!f.entered) return h('span', { className: 'badge' }, `${pct(f.marginPct)} target`);
  const bad = q.belowFloor || f.marginPct < 0;
  return h('span', { className: bad ? 'badge bad' : 'badge good' }, `${pct(f.marginPct)}${q.belowFloor ? ', below floor' : ''}`);
}

function QuotesView({ quotes, onOpen }) {
  const [query, setQuery] = useState('');
  const visible = quotes.filter((q) => !query.trim() || [q.reference, q.buyer, q.commodity, q.grade, q.createdBy].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  return h('section', { className: 'card dataCard' },
    h('div', { className: 'toolbar' },
      h('div', { className: 'pageSearch' }, h(Search, { size: 15 }),
        h('input', { 'aria-label': 'Search saved quotes', placeholder: 'Search reference, customer or commodity...', value: query, onChange: (e) => setQuery(e.target.value) })),
      h('span', { className: 'recordCount' }, `${visible.length} quote${visible.length === 1 ? '' : 's'}`)),
    visible.length
      ? h('div', { className: 'tableWrap' },
        h('table', null,
          h('thead', null, h('tr', null, ['Quote date', 'Reference', 'Customer', 'Commodity', 'Quantity', 'Landed /MT', 'Final /MT', 'Margin', 'Est. earnings', 'Holds until'].map((c) => h('th', { key: c, className: ['Quantity', 'Landed /MT', 'Final /MT', 'Est. earnings'].includes(c) ? 'fdNum' : undefined }, c)))),
          h('tbody', null, visible.map((q) => { const f = finalOf(q); return h('tr', { key: q.id, tabIndex: 0, onClick: () => onOpen(q), onKeyDown: (e) => { if (e.key === 'Enter') onOpen(q); } },
            h('td', null, formatDate(q.quoteDate), h('small', null, `by ${q.createdBy}`)),
            h('td', null, h('b', null, q.reference || 'No reference')),
            h('td', null, q.buyer),
            h('td', null, q.commodity, q.grade && h('small', null, q.grade)),
            h('td', { className: 'fdNum' }, tonnes(q.quantity_t)),
            h('td', { className: 'fdNum' }, money(q.landedPerTonneCAD)),
            h('td', { className: 'fdNum' }, f && money(f.perTonne), f && !f.entered && h('small', null, 'at target')),
            h('td', null, marginBadge(q, f)),
            h('td', { className: 'fdNum' }, f && money(f.earnings, 'CAD', 0)),
            h('td', null, q.validUntil && h(Validity, { validUntil: q.validUntil }))); }))))
      : h(Empty, { label: quotes.length ? 'No saved quotes match that search.' : 'No saved quotes yet. Build one under Landed cost and press Save quote.' }));
}

function QuoteDrawer({ summary: q, onClose, onLoad, onDelete }) {
  const f = finalOf(q);
  return h(Overlay, { onClose },
    h('aside', { className: 'drawer' },
      h(PanelHead, { kicker: 'Saved quote', title: q.reference || 'No reference', onClose }),
      h('div', { className: 'drawerBody' },
        q.commodity && h('div', { className: 'businessTag' }, [q.commodity, q.grade].filter(Boolean).join(', ')),
        h('div', { className: 'detailGrid' },
          [['Customer', q.buyer || 'Not set'], ['Quote date', formatDate(q.quoteDate)], ['Quantity', tonnes(q.quantity_t)],
            ['Landed cost per MT', money(q.landedPerTonneCAD)], ['Lowest price at target', money(q.targetPricePerTonneCAD)],
            ['Final price per MT', f ? `${money(f.perTonne)}${f.entered ? '' : ' (at target)'}` : 'Not set'],
            ['Margin', f ? `${pct(f.marginPct)}${f.entered && q.belowFloor ? ', below floor' : ''}` : 'Not set'],
            ['Estimated earnings', f ? money(f.earnings, 'CAD', 0) : 'Not set'],
            ['Holds until', q.validUntil ? formatDate(q.validUntil) : 'No end date'], ['Saved by', q.createdBy]]
            .map(([k, v]) => h('div', { key: k }, h('small', null, k), h('strong', null, v)))),
        h('div', { className: 'notice' }, h(History, { size: 18 }),
          h('span', null, 'Opening the quote loads it into Landed cost and checks each charge against the newest rate on file.')),
        h('div', { className: 'fdDrawerActions' },
          h(Button, { kind: 'primary', icon: Calculator, onClick: onLoad }, 'Open in Landed cost'),
          h(Button, { icon: Trash2, className: 'secondary fdDanger', onClick: onDelete }, 'Delete')))));
}

// ------------------------------------------------------------------ customers

function CustomersView({ customers, quotes, onOpen, onAdd }) {
  const [query, setQuery] = useState('');
  const quoteCounts = useMemo(() => {
    const counts = new Map();
    for (const q of quotes) if (normName(q.buyer)) counts.set(normName(q.buyer), (counts.get(normName(q.buyer)) || 0) + 1);
    return counts;
  }, [quotes]);
  const needle = query.trim().toLowerCase();
  const visible = customers.filter((c) => !needle || [c.name, c.contact, c.email, c.phone, c.country, c.deliveryTerms].join(' ').toLowerCase().includes(needle));
  return h('section', { className: 'card dataCard' },
    h('div', { className: 'toolbar' },
      h('div', { className: 'pageSearch' }, h(Search, { size: 15 }),
        h('input', { 'aria-label': 'Search customers', placeholder: 'Search name, contact, country...', value: query, onChange: (e) => setQuery(e.target.value) })),
      h('span', { className: 'recordCount' }, `${visible.length} customer${visible.length === 1 ? '' : 's'}`)),
    visible.length
      ? h('div', { className: 'tableWrap' },
        h('table', null,
          h('thead', null, h('tr', null, ['Customer', 'Country', 'Usual delivery terms', 'Email and phone', 'Saved quotes'].map((c) => h('th', { key: c, className: c === 'Saved quotes' ? 'fdNum' : undefined }, c)))),
          h('tbody', null, visible.map((c) => h('tr', { key: c.id, tabIndex: 0, onClick: () => onOpen(c), onKeyDown: (e) => { if (e.key === 'Enter') onOpen(c); } },
            h('td', null, h('b', null, c.name), c.contact && h('small', null, c.contact)),
            h('td', null, c.country),
            h('td', null, c.deliveryTerms),
            h('td', null, c.email, c.phone && h('small', null, c.phone)),
            h('td', { className: 'fdNum' }, quoteCounts.get(normName(c.name)) || ''))))))
      : customers.length
        ? h(Empty, { label: 'No customers match that search.' })
        : h('div', { className: 'emptyState' }, h(Users, { size: 22 }), h('span', null, 'No customers yet. Add the companies you quote to, then pick them on a quote.'),
          h(Button, { kind: 'primary', icon: Plus, onClick: onAdd }, 'Add customer')));
}

const CUSTOMER_FIELDS = ['name', 'contact', 'email', 'phone', 'country', 'deliveryTerms', 'notes'];

function CustomerEditor({ initial, api, onClose, onSaved, onDeleted }) {
  const editing = Boolean(initial?.id);
  const [form, setForm] = useState(() => Object.fromEntries(CUSTOMER_FIELDS.map((k) => [k, initial?.[k] ?? ''])));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) return setError("Enter the customer's name.");
    setBusy(true);
    setError('');
    try {
      const { customer } = editing
        ? await api(`customers/${initial.id}`, { method: 'PUT', body: form })
        : await api('customers', { method: 'POST', body: form });
      onSaved(customer, !editing);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove ${initial.name} from your customers? Saved quotes keep the name.`)) return;
    setBusy(true);
    try {
      await api(`customers/${initial.id}`, { method: 'DELETE' });
      onDeleted(initial);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const input = (key, props = {}) => h('input', { value: form[key] ?? '', onChange: set(key), ...props });
  return h(Overlay, { centered: true, onClose },
    h('form', { className: 'modal fd', onSubmit: submit, noValidate: true },
      h(PanelHead, { kicker: 'Customers', title: editing ? initial.name : 'Add a customer', onClose }),
      h('div', { className: 'formGrid' },
        h(Field, { label: 'Customer name' }, input('name', { maxLength: 100, required: true, autoFocus: true, placeholder: 'PT Sinar Pangan' })),
        h(Field, { label: 'Contact person' }, input('contact', { maxLength: 100, placeholder: 'Budi Santoso' })),
        h(Field, { label: 'Email' }, input('email', { type: 'email', maxLength: 120 })),
        h(Field, { label: 'Phone' }, input('phone', { type: 'tel', maxLength: 40 })),
        h(Field, { label: 'Country' }, input('country', { maxLength: 60, placeholder: 'Indonesia' })),
        h(Field, { label: 'Usual delivery terms', hint: 'Filled in on a quote when you pick this customer.' }, input('deliveryTerms', { maxLength: 80, placeholder: 'CFR Jakarta' })),
        h(Field, { label: 'Notes', className: 'fdSpan2' }, h('textarea', { value: form.notes, onChange: set('notes'), maxLength: 1000, rows: 3, placeholder: 'Preferred grades, payment terms, documents they need' }))),
      h('div', { className: `modalNote${error ? ' fdError' : ''}`, role: error ? 'alert' : undefined },
        error || 'Saved to the shared customer list. Everyone with Freight Desk access sees it.'),
      h('div', { className: 'modalActions' },
        editing && h(Button, { icon: Trash2, className: 'secondary fdDanger fdPushLeft', onClick: remove, disabled: busy }, 'Remove'),
        h('button', { type: 'button', className: 'secondary', onClick: onClose }, 'Cancel'),
        h('button', { type: 'submit', className: 'primary', disabled: busy }, h(Check, { size: 15 }), busy ? 'Saving…' : editing ? 'Save changes' : 'Add customer'))));
}

// ------------------------------------------------------------------ client access

const LINK_STATUS = { 'In use': 'badge good', 'Not opened yet': 'badge', Expired: 'badge warn', Revoked: 'badge bad' };
const isFinishedLink = (l) => l.status === 'Revoked' || l.status === 'Expired';
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '');

function AccessView({ api, notify }) {
  const [links, setLinks] = useState(null);
  const [form, setForm] = useState({ label: '', expiresHours: '72' });
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(() => api('access-links').then((d) => setLinks(d.links)).catch((e) => notify(e.message, true)), [api, notify]);
  useEffect(() => { load(); }, [load]);

  async function create(e) {
    e.preventDefault();
    if (!form.label.trim()) return notify('Say who the link is for first.', true);
    setBusy(true);
    try {
      const res = await api('access-links', { method: 'POST', body: { label: form.label, expiresHours: Number(form.expiresHours) } });
      setCreated(res);
      setCopied(false);
      setForm((f) => ({ ...f, label: '' }));
      await load();
    } catch (err) {
      notify(err.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(created.url);
    } catch {
      const el = document.getElementById('fd-new-link');
      el?.select();
      document.execCommand('copy');
    }
    setCopied(true);
  }

  async function revoke(link) {
    if (!confirm(`Revoke access for ${link.label}? They are signed out and the link stops working.`)) return;
    try {
      await api(`access-links/${link.id}`, { method: 'DELETE' });
      notify(`Access for ${link.label} revoked.`);
      await load();
    } catch (err) {
      notify(err.message, true);
    }
  }

  async function clearHistory() {
    const n = (links || []).filter(isFinishedLink).length;
    if (!confirm(`Clear ${n} revoked or expired link${n === 1 ? '' : 's'} from the history? This cannot be undone. Links that are in use or not opened yet are kept.`)) return;
    setClearing(true);
    try {
      const { removed } = await api('access-links?clear=finished', { method: 'DELETE' });
      notify(removed ? `Cleared ${removed} finished link${removed === 1 ? '' : 's'} from the history.` : 'There was nothing to clear.');
      await load();
    } catch (err) {
      notify(err.message, true);
    } finally {
      setClearing(false);
    }
  }

  const finishedCount = (links || []).filter(isFinishedLink).length;
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return h(React.Fragment, null,
    h('section', { className: 'card fdAccessCard' },
      h('div', { className: 'cardTitle' }, h('h3', null, 'Create a client link')),
      h('form', { onSubmit: create },
        h('div', { className: 'formGrid' },
          h(Field, { label: 'Who it is for' }, h('input', { value: form.label, onChange: set('label'), maxLength: 80, placeholder: 'Jane Smith, Prairie Pulse Traders' })),
          h(Field, { label: 'Link stops working after', hint: 'If nobody opens it by then. Once opened, access lasts until you revoke it.' },
            h('select', { value: form.expiresHours, onChange: set('expiresHours') }, [['24', '1 day'], ['72', '3 days'], ['168', '7 days'], ['720', '30 days']].map(([v, l]) => h('option', { key: v, value: v }, l))))),
        h('div', { className: 'modalActions' }, h('button', { type: 'submit', className: 'primary', disabled: busy }, h(Link2, { size: 15 }), busy ? 'Creating…' : 'Create link'))),
      created && h('div', { className: 'fdNewLink' },
        h('div', { className: 'fdCombo' },
          h('input', { id: 'fd-new-link', readOnly: true, value: created.url, onFocus: (e) => e.target.select(), 'aria-label': 'New client link' }),
          h('button', { type: 'button', className: 'secondary', onClick: copy }, h(copied ? Check : Copy, { size: 15 }), copied ? 'Copied' : 'Copy link')),
        h('p', null, `Send this to ${created.link.label} only. It works once, for one browser, and keeps them signed in until you revoke it. If it is not opened by ${when(created.link.expiresAt)}, it stops working. It is shown only now; if it gets lost, create a new one.`))),
    h('section', { className: 'card dataCard' },
      h('div', { className: 'toolbar' },
        h('span', { className: 'fdToolbarTitle' }, 'All client links'),
        h('span', { className: 'recordCount' }, links ? `${links.length} link${links.length === 1 ? '' : 's'}` : ''),
        finishedCount > 0 && h(Button, {
          icon: Trash2, className: 'secondary fdDanger', onClick: clearHistory, disabled: clearing,
          title: 'Delete revoked and expired links. Links in use or not opened yet are kept.',
        }, clearing ? 'Clearing…' : `Clear history (${finishedCount})`)),
      links === null ? h(Empty, { label: 'Loading links…' })
        : links.length === 0 ? h(Empty, { label: 'No client links yet. Create one above to give someone access.' })
          : h('div', { className: 'tableWrap' },
            h('table', { className: 'fdStatic' },
              h('thead', null, h('tr', null, ['For', 'Status', 'Created', 'Opened', 'Access', ''].map((c, k) => h('th', { key: k }, c)))),
              h('tbody', null, links.map((l) => h('tr', { key: l.id },
                h('td', null, h('b', null, l.label), l.createdBy && h('small', null, `Created by ${l.createdBy}`)),
                h('td', null, h('span', { className: LINK_STATUS[l.status] || 'badge' }, l.status)),
                h('td', null, when(l.createdAt)),
                h('td', null, when(l.usedAt)),
                h('td', null, l.revokedAt ? `Revoked ${when(l.revokedAt)}` : l.usedAt ? 'Until revoked' : `Link expires ${when(l.expiresAt)}`),
                h('td', { className: 'fdNum' }, !l.revokedAt && l.status !== 'Expired'
                  && h('button', { type: 'button', className: 'secondary fdDanger', onClick: () => revoke(l) }, 'Revoke')))))))));
}

export { FreightDesk };
