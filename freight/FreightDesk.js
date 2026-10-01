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
  Link2, PackageSearch, PencilLine, Plus, Printer, RefreshCw, Search, Ship, Trash2, TriangleAlert, X,
} from 'lucide-react';
import {
  BASES, RATE_TYPES, compareRatesNewestFirst, computeQuote, daysBetween, formatDate,
  groupLanes, isoToday, laneKey, percentChange,
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
const tonnes = (v) => (Number.isFinite(v) ? `${new Intl.NumberFormat('en-CA', { maximumFractionDigits: 3 }).format(v)} t` : '');
const pct = (v) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : '');
const pctSetting = (v) => (Number.isFinite(v) ? `${Number.isInteger(v) ? v : v.toFixed(1)}%` : '');

function basisText(r) {
  if (r.basis === 'percent_of_value') return 'of goods value';
  const basis = BASES[r.basis];
  const cap = basis?.needsCapacity && r.capacity_t ? `, ${tonnes(Number(r.capacity_t))}` : '';
  return `${basis?.label || ''}${cap}`;
}
function amountText(r) {
  return r.basis === 'percent_of_value' ? `${Number(r.amount)}%` : money(Number(r.amount), r.currency);
}
const rateText = (r) => `${amountText(r)} ${basisText(r)}`;
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
  rail: 'per_car', truck: 'per_truckload', loading: 'per_tonne', port: 'per_tonne',
  ocean: 'per_container', inspection: 'per_shipment', insurance: 'percent_of_value', other: 'per_tonne',
};
const COMMODITIES = ['Yellow peas', 'Green peas', 'Red lentils', 'Green lentils', 'Fava beans', 'Chickpeas', 'Canola', 'Flax seed', 'Mustard seed', 'Durum', 'Oats'];

function blankQuote() {
  return {
    reference: '', buyer: '', commodity: '', destination: '', quantity_t: '', quoteDate: isoToday(),
    purchasePrice: '', purchaseCurrency: 'CAD', usdcad: '', usdcadDate: '',
    targetMarginPct: 8, minMarginPct: 4, salePrice: '', saleCurrency: 'USD', lines: [],
  };
}
function loadDraft() {
  try {
    return { ...blankQuote(), ...(JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') || {}) };
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
    rateId: r.id, type: r.type, provider: r.provider, description: '', origin: r.origin, destination: r.destination,
    commodity: r.commodity, basis: r.basis, amount: r.amount, currency: r.currency, capacity_t: r.capacity_t,
    effectiveFrom: r.effectiveFrom, validUntil: r.validUntil, source: r.source,
  };
}
function oneOffLine() {
  return { rateId: null, type: 'other', provider: '', description: '', basis: 'per_tonne', amount: '', currency: 'CAD', capacity_t: '' };
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
    result.issues.push({ level: 'warning', code: 'newer', message: `${RATE_TYPES[line.type]} (${line.provider}): a newer rate is on file.` });
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
  ['access', 'Client access', KeyRound],
];
const SUBTITLES = {
  quote: 'Price a shipment from real freight costs. Flags expired, old or replaced rates before a quote goes out.',
  rates: 'Every rail tariff, loading charge and carrier offer, captured as it arrives and kept with its history.',
  quotes: 'Each saved quote keeps a copy of the rates it was built on, so later changes are easy to spot.',
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
      const [s, r, q] = await Promise.all([api('session'), api('rates'), api('quotes')]);
      setSession(s);
      onSession?.(s);
      setRates(r.rates);
      setQuotes(q.quotes);
      setState({ status: 'ready', error: '' });
    } catch (err) {
      setState({ status: 'error', error: err.message });
    }
  }, [api, onSession]);
  useEffect(() => { load(); }, [load]);

  const lanes = useMemo(() => groupLanes(rates, { includeArchived: true }), [rates]);
  const activeLanes = useMemo(() => lanes.filter((l) => !l.latest.archivedAt), [lanes]);
  const result = useMemo(() => assess(quote, rates), [quote, rates]);
  const canManageAccess = Boolean(session?.canManageAccess);

  const replaceRate = (rate) => setRates((all) => all.map((r) => (r.id === rate.id ? rate : r)));
  const addLine = (line) => setQuote((q) => ({ ...q, lines: [...q.lines, line] }));

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

  function newQuote() {
    if (quote.lines.length && !confirm('Start a new quote? The current one is cleared unless you saved it.')) return;
    setQuote((q) => ({ ...blankQuote(), targetMarginPct: q.targetMarginPct, minMarginPct: q.minMarginPct, usdcad: q.usdcad, usdcadDate: q.usdcadDate }));
  }

  function printQuote() {
    document.body.classList.add('fdPrinting');
    const done = () => { document.body.classList.remove('fdPrinting'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  }

  function exportCsv() {
    const cols = ['id', 'type', 'provider', 'origin', 'destination', 'commodity', 'basis', 'amount', 'currency', 'capacity_t', 'effectiveFrom', 'validUntil', 'source', 'notes', 'createdAt', 'createdBy', 'archivedAt'];
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
      const next = { ...blankQuote(), ...saved.inputs };
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
    access: [],
  }[tab];

  const counts = { rates: activeLanes.length, quotes: quotes.length };
  const tabs = TABS.filter(([id]) => id !== 'access' || canManageAccess);

  let body;
  if (state.status === 'loading') body = h(Empty, { label: 'Loading the Freight Desk…' });
  else if (state.status === 'error') {
    body = h('div', { className: 'notice' }, h(TriangleAlert, { size: 18 }),
      h('span', null, state.error, ' ', h('button', { type: 'button', className: 'fdLinkButton', onClick: () => { setState({ status: 'loading', error: '' }); load(); } }, 'Try again')));
  } else if (tab === 'quote') {
    body = h(QuoteView, { quote, setQuote, result, onPick: () => setPicker(true), onSave: saveQuote, saving, api, notify, rates });
  } else if (tab === 'rates') {
    body = h(RatesView, { lanes, onOpen: setOpenLane, onCapture: () => setRateEditor({}) });
  } else if (tab === 'quotes') {
    body = h(QuotesView, { quotes, onOpen: setOpenQuote });
  } else {
    body = h(AccessView, { api, notify });
  }

  const lane = openLane ? lanes.find((l) => l.key === openLane) : null;

  return h('div', { className: 'fd', 'data-variant': variant },
    h('div', { className: 'pageHead' },
      h('div', null, h('h1', null, 'Freight Desk'), h('p', null, SUBTITLES[tab])),
      state.status === 'ready' && headActions.length > 0 && h('div', { className: 'headActions' }, ...headActions)),
    h('div', { className: 'fdTabs', role: 'tablist', 'aria-label': 'Freight Desk sections' },
      tabs.map(([id, label, Icon]) => h('button', {
        key: id, type: 'button', role: 'tab', 'aria-selected': tab === id, className: tab === id ? 'active' : '', onClick: () => setTab(id),
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
      onAdd: (r) => { addLine(lineFromRate(r)); setOpenLane(null); setTab('quote'); notify(`Added ${RATE_TYPES[r.type].toLowerCase()} from ${r.provider} to the quote.`); },
      onEdit: (r) => { setOpenLane(null); setRateEditor({ rate: r }); },
      onArchive: setArchived,
    }),
    picker && h(RatePicker, { lanes: activeLanes, quote, onAdd: (r) => addLine(lineFromRate(r)), onClose: () => setPicker(false) }),
    openQuote && h(QuoteDrawer, { summary: openQuote, onClose: () => setOpenQuote(null), onLoad: () => openSavedQuote(openQuote.id), onDelete: () => deleteSavedQuote(openQuote) }),
    h('datalist', { id: 'fd-commodities' }, [...new Set([...COMMODITIES, ...rates.map((r) => r.commodity).filter(Boolean)])].map((c) => h('option', { key: c, value: c }))),
    toast && h('div', { className: `toast${toast.bad ? ' fdToastBad' : ''}`, role: 'status', key: toast.at }, toast.text));
}

// ------------------------------------------------------------------ landed cost

function QuoteView({ quote, setQuote, result, onPick, onSave, saving, api, notify, rates }) {
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

  return h('div', { className: 'fdCalc' },
    h('div', { className: 'fdCalcMain' },
      h('section', { className: 'card' },
        h('div', { className: 'cardTitle' }, h('h3', null, 'Deal')),
        h('div', { className: 'formGrid fdGrid3' },
          h(Field, { label: 'Quote reference' }, input('reference', { maxLength: 60, placeholder: 'Q-2026-041' })),
          h(Field, { label: 'Buyer' }, input('buyer', { maxLength: 100 })),
          h(Field, { label: 'Commodity' }, input('commodity', { maxLength: 60, list: 'fd-commodities' })),
          h(Field, { label: 'Quantity (tonnes)' }, num('quantity_t')),
          h(Field, { label: 'Delivery terms' }, input('destination', { maxLength: 80, placeholder: 'CFR Manila' })),
          h(Field, { label: 'Quote date' }, input('quoteDate', { type: 'date' })))),
      h('section', { className: 'card' },
        h('div', { className: 'cardTitle' }, h('h3', null, 'Price and margin')),
        h('div', { className: 'formGrid fdGrid3' },
          h(Field, { label: 'Purchase price per tonne', hint: 'What you pay the grower or supplier.' },
            h('span', { className: 'fdCombo' }, num('purchasePrice'), currency('purchaseCurrency', 'Purchase currency'))),
          h(Field, { label: 'USD to CAD rate', hint: quote.usdcadDate ? `Bank of Canada rate for ${formatDate(quote.usdcadDate)}.` : 'CAD for one US dollar.' },
            h('span', { className: 'fdCombo' }, num('usdcad', { placeholder: '1.3850' }),
              h('button', { type: 'button', className: 'secondary', onClick: fetchFx, disabled: fxBusy, title: 'Use the latest Bank of Canada daily rate' }, fxBusy ? '…' : 'BoC rate'))),
          h(Field, { label: 'Price you plan to offer', hint: 'Per tonne. Optional; checked against your margins.' },
            h('span', { className: 'fdCombo' }, num('salePrice', { placeholder: 'Optional' }), currency('saleCurrency', 'Offer currency'))),
          h(Field, { label: 'Target margin (%)' }, num('targetMarginPct', { max: 99.9 })),
          h(Field, { label: 'Margin floor (%)', hint: 'Never quote below this.' }, num('minMarginPct', { max: 99.9 })))),
      h('section', { className: 'card dataCard' },
        h('div', { className: 'cardTitle' }, h('h3', null, 'Freight and charges')),
        result.lines.length
          ? h('div', { className: 'tableWrap' },
            h('table', { className: 'fdStatic' },
              h('thead', null, h('tr', null, h('th', null, 'Charge'), h('th', null, 'Rate'), h('th', { className: 'fdNum' }, 'Per tonne (CAD)'), h('th', { className: 'fdNum' }, 'Shipment (CAD)'), h('th', null, h('span', { className: 'fdSr' }, 'Remove')))),
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
    h('td', { key: 'pt', className: 'fdNum' }, h('b', null, money(line.perTonneCAD))),
    h('td', { key: 'tot', className: 'fdNum' }, money(line.totalCAD, 'CAD', 0)),
  ];

  if (line.rateId) {
    return h('tr', null,
      h('td', { className: 'fdWrap' }, h('b', null, line.provider), h('small', null, `${RATE_TYPES[line.type]}${routeText(line) ? `, ${routeText(line)}` : ''}`),
        h('small', null, `From rate memory, effective ${formatDate(line.effectiveFrom)}${line.source ? `. ${line.source}` : ''}`), flagList),
      h('td', null, h('b', null, amountText(line)), h('small', null, basisText(line)), units),
      ...computed, remove);
  }
  const needsCap = BASES[line.basis]?.needsCapacity;
  const field = (key, props) => h('input', { value: line[key] ?? '', onChange: setLine(i, key), ...props });
  return h('tr', null,
    h('td', { colSpan: 2, className: 'fdWrap' },
      h('div', { className: 'fdLineEdit' },
        h('select', { value: line.type, onChange: setLine(i, 'type'), 'aria-label': 'Charge type' }, Object.entries(RATE_TYPES).map(([k, v]) => h('option', { key: k, value: k }, v))),
        field('description', { placeholder: 'Charged by or what it is', maxLength: 120, 'aria-label': 'Description' }),
        field('amount', { type: 'number', inputMode: 'decimal', min: 0, step: 'any', placeholder: 'Amount', 'aria-label': 'Amount' }),
        h('select', { value: line.currency, onChange: setLine(i, 'currency'), 'aria-label': 'Currency' }, h('option', null, 'CAD'), h('option', null, 'USD')),
        h('select', { value: line.basis, onChange: setLine(i, 'basis'), 'aria-label': 'Billed' }, Object.entries(BASES).map(([k, v]) => h('option', { key: k, value: k }, v.label))),
        needsCap && field('capacity_t', { type: 'number', inputMode: 'decimal', min: 0, step: 'any', placeholder: `Tonnes per ${BASES[line.basis].unit}`, 'aria-label': 'Tonnes per unit' })),
      h('small', null, 'One-off charge, not saved to rate memory.'), units, flagList),
    ...computed, remove);
}

function Row({ label, value, total }) {
  return h('div', { className: `fdRow${total ? ' total' : ''}` }, h('span', null, label), h('b', null, value));
}

function QuoteSummary({ quote, result: r, onSave, saving }) {
  const ready = r.landedPerTonneCAD !== null && r.quantity_t > 0;
  const issues = r.issues.filter((i) => i.code !== 'margin');
  let verdict = null;
  if (ready && r.sale) {
    const s = r.sale;
    if (s.profitPerTonneCAD < 0) verdict = ['bad', `Loses ${money(-s.profitPerTonneCAD)} per tonne. Do not send this price.`];
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
          h(Row, { label: 'Goods per tonne', value: money(r.goodsPerTonneCAD) }),
          h(Row, { label: 'Freight and charges per tonne', value: money(r.chargesPerTonneCAD) }),
          h(Row, { label: 'Landed cost per tonne', value: money(r.landedPerTonneCAD), total: true }),
          h(Row, { label: 'Landed cost, whole shipment', value: money(r.landedTotalCAD, 'CAD', 0) })),
        h('div', { className: 'fdFigure' },
          h('small', null, `Lowest price at ${pctSetting(r.targetMarginPct)} margin`),
          h('strong', null, money(r.targetPricePerTonneCAD), h('span', null, ' /t')),
          r.targetPricePerTonneUSD !== null && h('em', null, `${money(r.targetPricePerTonneUSD, 'USD')} per tonne at ${r.usdcad}`)),
        h('div', { className: 'fdRows' },
          h(Row, { label: `Floor at ${pctSetting(r.minMarginPct)} margin`, value: `${money(r.floorPricePerTonneCAD)}${r.floorPricePerTonneUSD !== null ? ` (${money(r.floorPricePerTonneUSD, 'USD')})` : ''}` }),
          r.sale && h(React.Fragment, null,
            h(Row, { label: 'Offered price', value: `${money(Number(quote.salePrice), quote.saleCurrency)}${quote.saleCurrency === 'USD' ? ` (${money(r.sale.perTonneCAD)})` : ''}` }),
            h(Row, { label: 'Margin', value: pct(r.sale.marginPct) }),
            h(Row, { label: 'Profit per tonne', value: money(r.sale.profitPerTonneCAD) }),
            h(Row, { label: 'Profit on shipment', value: money(r.sale.profitTotalCAD, 'CAD', 0), total: true }))),
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
      .filter(({ latest }) => !q || [RATE_TYPES[latest.type], latest.provider, latest.origin, latest.destination, latest.commodity, latest.source, latest.notes].join(' ').toLowerCase().includes(q))
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
              h('td', null, h('b', null, r.provider), h('small', null, `${RATE_TYPES[r.type]}${earlier ? `, ${earlier} earlier` : ''}`)),
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
      h(PanelHead, { kicker: RATE_TYPES[r.type], title: r.provider, onClose }),
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

const RATE_FIELDS = ['type', 'provider', 'commodity', 'origin', 'destination', 'amount', 'currency', 'basis', 'capacity_t', 'effectiveFrom', 'validUntil', 'source', 'notes'];

function RateEditor({ initial, api, onClose, onSaved, providers, places }) {
  const editing = Boolean(initial?.id);
  const [form, setForm] = useState(() => (editing
    ? Object.fromEntries(RATE_FIELDS.map((k) => [k, initial[k] ?? '']))
    : { type: 'rail', provider: '', commodity: '', origin: '', destination: '', amount: '', currency: 'CAD', basis: 'per_car', capacity_t: '', effectiveFrom: isoToday(), validUntil: '', source: '', notes: '' }));
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
    const body = { ...form, currency: form.basis === 'percent_of_value' ? 'CAD' : form.currency };
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
      h(PanelHead, { kicker: 'Rate memory', title: editing ? `Correct ${initial.provider} ${RATE_TYPES[initial.type].toLowerCase()}` : 'Capture a rate', onClose }),
      h('div', { className: 'formGrid' },
        h(Field, { label: 'Charge type' }, h('select', { value: form.type, onChange: set('type'), autoFocus: true }, Object.entries(RATE_TYPES).map(([k, v]) => h('option', { key: k, value: k }, v)))),
        h(Field, { label: 'Charged by' }, input('provider', { list: 'fd-providers', maxLength: 80, placeholder: 'CN, Viterra, COSCO', required: true })),
        h(Field, { label: 'From' }, input('origin', { list: 'fd-places', maxLength: 80, placeholder: 'Shaunavon, SK' })),
        h(Field, { label: 'To' }, input('destination', { list: 'fd-places', maxLength: 80, placeholder: 'Vancouver, BC' })),
        h(Field, { label: 'Commodity', hint: 'Blank if it applies to any commodity.' }, input('commodity', { list: 'fd-commodities', maxLength: 60 })),
        h(Field, { label: 'Billed' }, h('select', { value: form.basis, onChange: set('basis') }, Object.entries(BASES).map(([k, v]) => h('option', { key: k, value: k }, v.label)))),
        h(Field, { label: 'Amount' }, h('span', { className: 'fdCombo' },
          input('amount', { type: 'number', inputMode: 'decimal', min: 0, step: 'any', required: true }),
          h('select', { value: form.currency, onChange: set('currency'), disabled: form.basis === 'percent_of_value', 'aria-label': 'Currency' }, h('option', null, 'CAD'), h('option', null, 'USD')))),
        basis?.needsCapacity
          ? h(Field, { label: `Tonnes per ${basis.unit}`, hint: 'Turns the rate into a cost per tonne.' }, input('capacity_t', { type: 'number', inputMode: 'decimal', min: 0, step: 'any' }))
          : h('span', { 'aria-hidden': true }),
        h(Field, { label: 'Effective from' }, input('effectiveFrom', { type: 'date', required: true })),
        h(Field, { label: 'Valid until', hint: 'Offer or tariff expiry, if stated.' }, input('validUntil', { type: 'date' })),
        h(Field, { label: 'Source', className: 'fdSpan2' }, input('source', { maxLength: 200, placeholder: 'Email from CN rates desk, Sep 29' })),
        h(Field, { label: 'Notes', className: 'fdSpan2' }, h('textarea', { value: form.notes, onChange: set('notes'), maxLength: 500, rows: 3, placeholder: 'Fuel surcharge included, minimum 80 t per car, and similar conditions' }))),
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
    .filter((r) => !query.trim() || [RATE_TYPES[r.type], r.provider, r.origin, r.destination, r.commodity].join(' ').toLowerCase().includes(query.trim().toLowerCase()))
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
              h('td', null, h('b', null, r.provider), h('small', null, RATE_TYPES[r.type])),
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

function marginBadge(q) {
  if (q.marginPct === null || q.marginPct === undefined) return null;
  return h('span', { className: q.belowFloor ? 'badge bad' : 'badge good' }, `${pct(q.marginPct)}${q.belowFloor ? ', below floor' : ''}`);
}

function QuotesView({ quotes, onOpen }) {
  const [query, setQuery] = useState('');
  const visible = quotes.filter((q) => !query.trim() || [q.reference, q.buyer, q.commodity, q.createdBy].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  return h('section', { className: 'card dataCard' },
    h('div', { className: 'toolbar' },
      h('div', { className: 'pageSearch' }, h(Search, { size: 15 }),
        h('input', { 'aria-label': 'Search saved quotes', placeholder: 'Search reference, buyer or commodity...', value: query, onChange: (e) => setQuery(e.target.value) })),
      h('span', { className: 'recordCount' }, `${visible.length} quote${visible.length === 1 ? '' : 's'}`)),
    visible.length
      ? h('div', { className: 'tableWrap' },
        h('table', null,
          h('thead', null, h('tr', null, ['Quote date', 'Reference', 'Buyer', 'Commodity', 'Tonnes', 'Landed /t', 'Offered /t', 'Margin', 'Holds until'].map((c) => h('th', { key: c, className: ['Tonnes', 'Landed /t', 'Offered /t'].includes(c) ? 'fdNum' : undefined }, c)))),
          h('tbody', null, visible.map((q) => h('tr', { key: q.id, tabIndex: 0, onClick: () => onOpen(q), onKeyDown: (e) => { if (e.key === 'Enter') onOpen(q); } },
            h('td', null, formatDate(q.quoteDate), h('small', null, `by ${q.createdBy}`)),
            h('td', null, h('b', null, q.reference || 'No reference')),
            h('td', null, q.buyer),
            h('td', null, q.commodity),
            h('td', { className: 'fdNum' }, tonnes(q.quantity_t)),
            h('td', { className: 'fdNum' }, money(q.landedPerTonneCAD)),
            h('td', { className: 'fdNum' }, money(q.salePerTonneCAD)),
            h('td', null, marginBadge(q)),
            h('td', null, q.validUntil && h(Validity, { validUntil: q.validUntil })))))))
      : h(Empty, { label: quotes.length ? 'No saved quotes match that search.' : 'No saved quotes yet. Build one under Landed cost and press Save quote.' }));
}

function QuoteDrawer({ summary: q, onClose, onLoad, onDelete }) {
  return h(Overlay, { onClose },
    h('aside', { className: 'drawer' },
      h(PanelHead, { kicker: 'Saved quote', title: q.reference || 'No reference', onClose }),
      h('div', { className: 'drawerBody' },
        q.commodity && h('div', { className: 'businessTag' }, q.commodity),
        h('div', { className: 'detailGrid' },
          [['Buyer', q.buyer || 'Not set'], ['Quote date', formatDate(q.quoteDate)], ['Quantity', tonnes(q.quantity_t)],
            ['Landed cost per tonne', money(q.landedPerTonneCAD)], ['Lowest price at target', money(q.targetPricePerTonneCAD)],
            ['Offered per tonne', q.salePerTonneCAD === null ? 'Not set' : money(q.salePerTonneCAD)],
            ['Margin', q.marginPct === null ? 'No offer entered' : `${pct(q.marginPct)}${q.belowFloor ? ', below floor' : ''}`],
            ['Holds until', q.validUntil ? formatDate(q.validUntil) : 'No end date'], ['Saved by', q.createdBy]]
            .map(([k, v]) => h('div', { key: k }, h('small', null, k), h('strong', null, v)))),
        h('div', { className: 'notice' }, h(History, { size: 18 }),
          h('span', null, 'Opening the quote loads it into Landed cost and checks each charge against the newest rate on file.')),
        h('div', { className: 'fdDrawerActions' },
          h(Button, { kind: 'primary', icon: Calculator, onClick: onLoad }, 'Open in Landed cost'),
          h(Button, { icon: Trash2, className: 'secondary fdDanger', onClick: onDelete }, 'Delete')))));
}

// ------------------------------------------------------------------ client access

const LINK_STATUS = { 'In use': 'badge good', 'Not opened yet': 'badge', Expired: 'badge warn', Revoked: 'badge bad' };
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '');

function AccessView({ api, notify }) {
  const [links, setLinks] = useState(null);
  const [form, setForm] = useState({ label: '', expiresHours: '72' });
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

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
        h('span', { className: 'recordCount' }, links ? `${links.length} link${links.length === 1 ? '' : 's'}` : '')),
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
