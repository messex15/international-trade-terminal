import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, Bell, BriefcaseBusiness, Building2, CalendarDays, CheckSquare2, ChevronRight, CircleHelp, ContactRound, FileText, Filter, FolderOpen, Globe2, Handshake, LayoutDashboard, LineChart, MapPin, Menu, Network, PackageSearch, Plus, Search, Settings, Target, Truck, UserCircle2, Users, Wheat, X, LogOut } from 'lucide-react';
import { pageDefinitions, businessUnits } from './data/demoData.js';
import { logout } from '@netlify/identity';
const navGroups = [
    ['Command Centre', [
            ['Dashboard', LayoutDashboard], ['Opportunities', Target], ['Projects', BriefcaseBusiness]
        ]],
    ['Trade Network', [
            ['Companies', Building2], ['Buyers', Users], ['Suppliers', Truck], ['Contacts', ContactRound]
        ]],
    ['Products & Markets', [
            ['Commodities', Wheat], ['Trade Leads', Network], ['Market Intelligence', LineChart]
        ]],
    ['Operations', [
            ['Tasks & Follow-ups', CheckSquare2], ['Meetings', CalendarDays], ['Documents', FolderOpen], ['Reports', BarChart3]
        ]],
    ['Administration', [
            ['Partners & Referrals', Handshake], ['Settings', Settings], ['Profile', UserCircle2], ['Help & Support', CircleHelp]
        ]]
];
const pageIcon = Object.fromEntries(navGroups.flatMap(([, items]) => items));
function valueText(record) {
    return Object.entries(record)
        .filter(([key]) => !['id'].includes(key))
        .map(([, value]) => String(value ?? ''))
        .join(' ')
        .toLowerCase();
}
function badgeClass(value = '') {
    const v = String(value).toLowerCase();
    if (/(won|active|qualified|configured|completed)/.test(v))
        return 'badge good';
    if (/(on hold|overdue|archived|not connected)/.test(v))
        return 'badge bad';
    if (/(waiting|research|planning|discussion|contacted|proposal|review|progress|new)/.test(v))
        return 'badge warn';
    return 'badge';
}
function getDisplayName(record) {
    return record.name || record.company || record.task || record.title || record.lead || record.commodity || record.report || record.setting || record.resource || record.field || 'Record';
}
function initialPageFromHash() {
    if (!location.hash || location.hash === '#') return 'Dashboard';
    try {
        const decoded = decodeURIComponent(location.hash.slice(1));
        return decoded === 'Dashboard' || pageDefinitions[decoded] ? decoded : 'Dashboard';
    } catch {
        return 'Dashboard';
    }
}
function App() {
    const [active, setActive] = useState(initialPageFromHash);
    const [business, setBusiness] = useState('All Businesses');
    const [records, setRecords] = useState(() => {
        const saved = localStorage.getItem('ainu-demo-records-v2');
        if (saved) {
            try {
                return JSON.parse(saved);
            }
            catch { /* fall through */ }
        }
        return Object.fromEntries(Object.entries(pageDefinitions).map(([name, def]) => [name, def.records]));
    });
    const [globalQuery, setGlobalQuery] = useState('');
    const [pageQuery, setPageQuery] = useState('');
    const [filterValue, setFilterValue] = useState('All');
    const [detail, setDetail] = useState(null);
    const [createSection, setCreateSection] = useState(null);
    const [mobileNav, setMobileNav] = useState(false);
    const [toast, setToast] = useState('');
    useEffect(() => {
        localStorage.setItem('ainu-demo-records-v2', JSON.stringify(records));
    }, [records]);
    useEffect(() => {
        location.hash = encodeURIComponent(active);
        setPageQuery('');
        setFilterValue('All');
        setMobileNav(false);
    }, [active]);
    useEffect(() => {
        const onHash = () => {
            try {
                const next = decodeURIComponent(location.hash.slice(1));
                if (next && (next === 'Dashboard' || pageDefinitions[next])) setActive(next);
            } catch {
                setActive('Dashboard');
            }
        };
        window.addEventListener('hashchange', onHash);
        return () => window.removeEventListener('hashchange', onHash);
    }, []);
    useEffect(() => {
        if (!toast)
            return;
        const t = setTimeout(() => setToast(''), 2200);
        return () => clearTimeout(t);
    }, [toast]);
    const globalResults = useMemo(() => {
        const q = globalQuery.trim().toLowerCase();
        if (q.length < 2)
            return [];
        const out = [];
        Object.entries(records).forEach(([section, items]) => {
            items.forEach(item => {
                if (valueText(item).includes(q))
                    out.push({ section, item });
            });
        });
        return out.slice(0, 10);
    }, [globalQuery, records]);
    const changePage = (name) => setActive(name);
    const addRecord = (section, record) => {
        setRecords(prev => ({
            ...prev,
            [section]: [{ ...record, id: `${section.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}` }, ...(prev[section] || [])]
        }));
        setCreateSection(null);
        setToast(`Added to ${section}`);
    };
    return (React.createElement("div", { className: "appShell" },
        React.createElement(Sidebar, { active: active, onChange: changePage, business: business, setBusiness: setBusiness, open: mobileNav, onClose: () => setMobileNav(false), onQuickAdd: () => setCreateSection(active === 'Dashboard' ? 'Opportunities' : active) }),
        React.createElement("main", { className: "mainArea" },
            React.createElement(Topbar, { business: business, setBusiness: setBusiness, globalQuery: globalQuery, setGlobalQuery: setGlobalQuery, results: globalResults, onSelectResult: ({ section, item }) => { setActive(section); setDetail({ section, item }); setGlobalQuery(''); }, onMenu: () => setMobileNav(true), onToast: setToast }),
            React.createElement("div", { className: "demoStrip" },
                React.createElement("strong", null, "DEMO PROTOTYPE"),
                React.createElement("span", null, "Sample/internal historical data only. No confidential records or live database.")),
            React.createElement("div", { className: "contentArea" }, active === 'Dashboard' ? (React.createElement(Dashboard, { records: records, business: business, onOpen: (section, item) => setDetail({ section, item }), onGo: setActive, onQuickAdd: () => setCreateSection('Opportunities') })) : (React.createElement(DataPage, { name: active, definition: pageDefinitions[active], items: records[active] || [], business: business, query: pageQuery, setQuery: setPageQuery, filterValue: filterValue, setFilterValue: setFilterValue, onOpen: item => setDetail({ section: active, item }), onCreate: () => setCreateSection(active) })))),
        detail && React.createElement(DetailDrawer, { section: detail.section, item: detail.item, onClose: () => setDetail(null) }),
        createSection && pageDefinitions[createSection] && (React.createElement(CreateModal, { section: createSection, definition: pageDefinitions[createSection], business: business, onClose: () => setCreateSection(null), onSave: addRecord })),
        toast && React.createElement("div", { className: "toast" }, toast)));
}
function Sidebar({ active, onChange, business, setBusiness, open, onClose, onQuickAdd }) {
    return React.createElement(React.Fragment, null,
        open && React.createElement("button", { className: "scrim", "aria-label": "Close menu", onClick: onClose }),
        React.createElement("aside", { className: `sidebar ${open ? 'open' : ''}` },
            React.createElement("div", { className: "brandRow" },
                React.createElement("div", { className: "brandMark" },
                    React.createElement(Globe2, { size: 25 })),
                React.createElement("div", { className: "brandWords" },
                    React.createElement("b", null, "AINU"),
                    React.createElement("small", null, "BUSINESS COMMAND CENTRE")),
                React.createElement("button", { className: "closeNav", onClick: onClose, "aria-label": "Close navigation" },
                    React.createElement(X, { size: 19 }))),
            React.createElement("label", { className: "sideSelectLabel" }, "Business unit"),
            React.createElement("select", { className: "sideSelect", value: business, onChange: e => setBusiness(e.target.value) }, businessUnits.map(x => React.createElement("option", { key: x }, x))),
            React.createElement("nav", null, navGroups.map(([group, items]) => React.createElement("div", { className: "navGroup", key: group },
                React.createElement("small", { className: "navGroupLabel" }, group),
                items.map(([name, Icon]) => React.createElement("button", { className: active === name ? 'active' : '', key: name, onClick: () => onChange(name) },
                    React.createElement(Icon, { className: "navIcon", size: 17 }),
                    React.createElement("span", { className: "navLabel" }, name),
                    name === 'Tasks & Follow-ups' && React.createElement("span", { className: "navCount" }, "7")))))),
            React.createElement("div", { className: "sideFooter" },
                React.createElement("button", { className: "quickAdd", onClick: onQuickAdd },
                    React.createElement(Plus, { size: 16 }),
                    React.createElement("span", null, "Quick Add")),
                React.createElement("small", null, "Internal prototype \u00B7 2026"))));
}
function Topbar({ business, setBusiness, globalQuery, setGlobalQuery, results, onSelectResult, onMenu, onToast }) {
    const signOut = async () => {
        try {
            await logout();
        }
        finally {
            window.location.assign('/login.html');
        }
    };
    return React.createElement("header", { className: "topbar" },
        React.createElement("button", { className: "menuButton", onClick: onMenu, "aria-label": "Open navigation" },
            React.createElement(Menu, { size: 20 })),
        React.createElement("div", { className: "location" },
            React.createElement(MapPin, { size: 15 }),
            React.createElement("span", null, "Edmonton, Canada")),
        React.createElement("select", { className: "mobileBusiness", value: business, onChange: e => setBusiness(e.target.value), "aria-label": "Business unit" }, businessUnits.map(x => React.createElement("option", { key: x }, x))),
        React.createElement("div", { className: "globalSearch" },
            React.createElement(Search, { size: 17 }),
            React.createElement("input", { "aria-label": "Global search", placeholder: "Search anything...", value: globalQuery, onChange: e => setGlobalQuery(e.target.value) }),
            globalQuery.trim().length >= 2 && React.createElement("div", { className: "searchResults" }, results.length ? results.map(({ section, item }) => React.createElement("button", { key: `${section}-${item.id}`, onClick: () => onSelectResult({ section, item }) },
                React.createElement("span", { className: "resultIcon" }, React.createElement(pageIcon[section] || FileText, { size: 15 })),
                React.createElement("span", null,
                    React.createElement("b", null, getDisplayName(item)),
                    React.createElement("small", null,
                        section,
                        " \u00B7 ",
                        item.business || 'General')),
                React.createElement(ChevronRight, { size: 14 }))) : React.createElement("div", { className: "emptySearch" }, "No matching records"))),
        React.createElement("button", { className: "iconButton", "aria-label": "Notifications", onClick: () => onToast('Notifications are demo-only in this prototype') },
            React.createElement(Bell, { size: 18 })),
        React.createElement("button", { className: "iconButton logoutButton", "aria-label": "Log out", title: "Log out", onClick: signOut },
            React.createElement(LogOut, { size: 18 })),
        React.createElement("div", { className: "userBlock" },
            React.createElement("div", { className: "avatar" }, "AA"),
            React.createElement("div", null,
                React.createElement("b", null, "Ainu A."),
                React.createElement("small", null, "Business Development"))));
}
function HeaderBlock({ title, subtitle, actionLabel = 'New Record', onAction, extra }) {
    return React.createElement("div", { className: "pageHead" },
        React.createElement("div", null,
            React.createElement("h1", null, title),
            React.createElement("p", null, subtitle)),
        React.createElement("div", { className: "headActions" },
            extra,
            React.createElement("button", { className: "primary", onClick: onAction },
                React.createElement(Plus, { size: 16 }),
                actionLabel)));
}
function Dashboard({ records, business, onOpen, onGo, onQuickAdd }) {
    const filterBiz = items => items.filter(x => business === 'All Businesses' || !x.business || x.business === business);
    const opportunities = filterBiz(records.Opportunities || []);
    const projects = filterBiz(records.Projects || []);
    const tasks = filterBiz(records['Tasks & Follow-ups'] || []);
    const meetings = filterBiz(records.Meetings || []);
    const contacts = filterBiz(records.Contacts || []);
    const needsAinu = tasks.filter(t => t.status === 'Ainu Review');
    const stats = [
        ['Active Opportunities', opportunities.filter(x => !['On Hold', 'Closed / Lost'].includes(x.stage)).length, 'Commercial pipeline', Target],
        ['Active Projects', projects.filter(x => x.status !== 'On Hold').length, 'Across business units', BriefcaseBusiness],
        ['Open Follow-ups', tasks.filter(x => x.status !== 'Completed').length, `${tasks.filter(x => x.status === 'Waiting for Response').length} waiting`, CheckSquare2],
        ['Needs Ainu', needsAinu.length, 'Decisions / approvals', Bell],
        ['Contacts', contacts.length, 'Current demo records', ContactRound]
    ];
    const pipeline = [['Research', opportunities.filter(x => x.stage === 'Research').length], ['Contacted', opportunities.filter(x => x.stage === 'Contacted').length], ['In Discussion', opportunities.filter(x => x.stage === 'In Discussion').length], ['Proposal Sent', opportunities.filter(x => x.stage === 'Proposal Sent').length], ['Negotiation', opportunities.filter(x => x.stage === 'Negotiation').length]];
    return React.createElement(React.Fragment, null,
        React.createElement(HeaderBlock, { title: "Good afternoon, Ainu", subtitle: `Business command centre overview${business !== 'All Businesses' ? ` for ${business}` : ''}.`, actionLabel: "Quick Add", onAction: onQuickAdd }),
        React.createElement("div", { className: "statGrid" }, stats.map(([label, num, meta, Icon], i) => React.createElement("button", { className: "statCard", key: label, onClick: () => label === 'Needs Ainu' ? onGo('Tasks & Follow-ups') : null },
            React.createElement("span", { className: `statGlyph s${i}` },
                React.createElement(Icon, { size: 19 })),
            React.createElement("span", null,
                React.createElement("small", null, label),
                React.createElement("strong", null, num),
                React.createElement("em", null, meta))))),
        React.createElement("div", { className: "dashboardGrid two" },
            React.createElement("section", { className: "card" },
                React.createElement(CardTitle, { title: "Pipeline Overview", action: "Open opportunities", onAction: () => onGo('Opportunities') }),
                React.createElement("div", { className: "funnel" }, pipeline.map(([label, count], i) => React.createElement("div", { key: label, style: { width: `${100 - i * 11}%` } },
                    React.createElement("span", null, label),
                    React.createElement("b", null, count))))),
            React.createElement("section", { className: "card" },
                React.createElement(CardTitle, { title: "Top Active Opportunities", action: "View all", onAction: () => onGo('Opportunities') }),
                React.createElement("div", { className: "stackList" }, opportunities.slice(0, 5).map(item => React.createElement("button", { className: "listRow", key: item.id, onClick: () => onOpen('Opportunities', item) },
                    React.createElement("span", null,
                        React.createElement("b", null, item.name),
                        React.createElement("small", null,
                            item.commodity,
                            " \u00B7 ",
                            item.contact)),
                    React.createElement("span", { className: badgeClass(item.stage) }, item.stage),
                    React.createElement("strong", null, item.value)))))),
        React.createElement("div", { className: "dashboardGrid three" },
            React.createElement("section", { className: "card" },
                React.createElement(CardTitle, { title: "Needs Ainu", action: "All tasks", onAction: () => onGo('Tasks & Follow-ups') }),
                React.createElement("div", { className: "stackList" }, needsAinu.length ? needsAinu.map(item => React.createElement("button", { className: "listRow compact", key: item.id, onClick: () => onOpen('Tasks & Follow-ups', item) },
                    React.createElement(Bell, { size: 15 }),
                    React.createElement("span", null,
                        React.createElement("b", null, item.task),
                        React.createElement("small", null,
                            item.related,
                            " \u00B7 ",
                            item.due)))) : React.createElement(Empty, { label: "Nothing awaiting Ainu" }))),
            React.createElement("section", { className: "card" },
                React.createElement(CardTitle, { title: "Upcoming Meetings", action: "Calendar", onAction: () => onGo('Meetings') }),
                React.createElement("div", { className: "stackList" }, meetings.slice(0, 4).map(item => React.createElement("button", { className: "listRow compact", key: item.id, onClick: () => onOpen('Meetings', item) },
                    React.createElement(CalendarDays, { size: 15 }),
                    React.createElement("span", null,
                        React.createElement("b", null, item.title),
                        React.createElement("small", null,
                            item.date,
                            " \u00B7 ",
                            item.location)))))),
            React.createElement("section", { className: "card" },
                React.createElement(CardTitle, { title: "Current Workflow", action: "Projects", onAction: () => onGo('Projects') }),
                React.createElement("div", { className: "workflow" },
                    React.createElement("div", null,
                        React.createElement("span", null, "Research / sourcing"),
                        React.createElement("b", null, opportunities.filter(x => ['Research', 'Contacted'].includes(x.stage)).length)),
                    React.createElement("div", null,
                        React.createElement("span", null, "Commercial discussion"),
                        React.createElement("b", null, opportunities.filter(x => ['In Discussion', 'Proposal Sent', 'Negotiation'].includes(x.stage)).length)),
                    React.createElement("div", null,
                        React.createElement("span", null, "Waiting for response"),
                        React.createElement("b", null, tasks.filter(x => x.status === 'Waiting for Response').length)),
                    React.createElement("div", null,
                        React.createElement("span", null, "Ainu review"),
                        React.createElement("b", null, needsAinu.length))))));
}
function CardTitle({ title, action, onAction }) { return React.createElement("div", { className: "cardTitle" },
    React.createElement("h3", null, title),
    React.createElement("button", { onClick: onAction },
        action,
        React.createElement(ChevronRight, { size: 14 }))); }
function DataPage({ name, definition, items, business, query, setQuery, filterValue, setFilterValue, onOpen, onCreate }) {
    const businessFiltered = useMemo(() => items.filter(x => business === 'All Businesses' || !x.business || x.business === business), [items, business]);
    const filterOptions = useMemo(() => definition.filterKey ? ['All', ...Array.from(new Set(businessFiltered.map(x => String(x[definition.filterKey] || '')).filter(Boolean)))] : ['All'], [businessFiltered, definition.filterKey]);
    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        return businessFiltered.filter(item => (!q || valueText(item).includes(q)) && (filterValue === 'All' || !definition.filterKey || String(item[definition.filterKey]) === filterValue));
    }, [businessFiltered, query, filterValue, definition.filterKey]);
    const special = ['Settings', 'Profile', 'Help & Support'].includes(name);
    return React.createElement(React.Fragment, null,
        React.createElement(HeaderBlock, { title: name, subtitle: definition.subtitle, actionLabel: special ? 'Manage' : 'New Record', onAction: onCreate }),
        React.createElement("section", { className: "card dataCard" },
            React.createElement("div", { className: "toolbar" },
                React.createElement("div", { className: "pageSearch" },
                    React.createElement(Search, { size: 15 }),
                    React.createElement("input", { "aria-label": `Search ${name}`, placeholder: `Search ${name.toLowerCase()}...`, value: query, onChange: e => setQuery(e.target.value) })),
                definition.filterKey && React.createElement("label", { className: "filterSelect" },
                    React.createElement(Filter, { size: 15 }),
                    React.createElement("select", { value: filterValue, onChange: e => setFilterValue(e.target.value), "aria-label": `Filter ${name}` }, filterOptions.map(x => React.createElement("option", { key: x }, x)))),
                React.createElement("span", { className: "recordCount" },
                    visible.length,
                    " record",
                    visible.length === 1 ? '' : 's')),
            React.createElement(ResponsiveTable, { definition: definition, items: visible, onOpen: onOpen })));
}
function ResponsiveTable({ definition, items, onOpen }) {
    if (!items.length)
        return React.createElement(Empty, { label: "No records match the current view" });
    return React.createElement("div", { className: "tableWrap" },
        React.createElement("table", null,
            React.createElement("thead", null,
                React.createElement("tr", null, definition.columns.map(([, label]) => React.createElement("th", { key: label }, label)))),
            React.createElement("tbody", null, items.map(item => React.createElement("tr", { key: item.id, onClick: () => onOpen(item), tabIndex: "0", onKeyDown: e => { if (e.key === 'Enter')
                    onOpen(item); } }, definition.columns.map(([key]) => React.createElement("td", { key: key }, ['stage', 'status', 'category', 'type', 'basis'].includes(key) ? React.createElement("span", { className: badgeClass(item[key]) }, item[key]) : item[key])))))));
}
function DetailDrawer({ section, item, onClose }) {
    const definition = pageDefinitions[section];
    return React.createElement("div", { className: "overlay", onMouseDown: e => { if (e.target === e.currentTarget)
            onClose(); } },
        React.createElement("aside", { className: "drawer" },
            React.createElement("div", { className: "drawerHead" },
                React.createElement("div", null,
                    React.createElement("small", null, section),
                    React.createElement("h2", null, getDisplayName(item))),
                React.createElement("button", { className: "iconButton", onClick: onClose, "aria-label": "Close details" },
                    React.createElement(X, { size: 19 }))),
            React.createElement("div", { className: "drawerBody" },
                item.business && React.createElement("div", { className: "businessTag" }, item.business),
                React.createElement("div", { className: "detailGrid" }, definition.columns.map(([key, label]) => React.createElement("div", { key: key },
                    React.createElement("small", null, label),
                    React.createElement("strong", null, item[key] || '—')))),
                'owner' in item && React.createElement("div", { className: "detailBlock" },
                    React.createElement("small", null, "Owner"),
                    React.createElement("p", null, item.owner)),
                'notes' in item && item.notes && React.createElement("div", { className: "detailBlock" },
                    React.createElement("small", null, "Internal notes"),
                    React.createElement("p", null, item.notes)),
                section === 'Opportunities' && React.createElement("div", { className: "detailBlock" },
                    React.createElement("small", null, "Workflow"),
                    React.createElement("div", { className: "timeline" },
                        React.createElement("span", { className: "done" }, "Lead identified"),
                        React.createElement("span", { className: "done" }, "Requirements / sourcing"),
                        React.createElement("span", { className: "done" }, "Contacted"),
                        React.createElement("span", { className: "current" }, item.stage),
                        React.createElement("span", null,
                            "Next: ",
                            item.nextAction))),
                section === 'Documents' && React.createElement("div", { className: "notice" },
                    React.createElement(FileText, { size: 18 }),
                    React.createElement("span", null, "This prototype indexes document metadata only. File access should be added after authentication and secure storage.")))));
}
function CreateModal({ section, definition, business, onClose, onSave }) {
    const [form, setForm] = useState(() => Object.fromEntries(definition.columns.map(([key]) => [key, ''])));
    const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
    const submit = e => {
        e.preventDefault();
        const firstKey = definition.columns[0][0];
        if (!String(form[firstKey] || '').trim())
            return;
        onSave(section, { ...form, business: business === 'All Businesses' ? 'AgriCan' : business });
    };
    return React.createElement("div", { className: "overlay centered", onMouseDown: e => { if (e.target === e.currentTarget)
            onClose(); } },
        React.createElement("form", { className: "modal", onSubmit: submit },
            React.createElement("div", { className: "drawerHead" },
                React.createElement("div", null,
                    React.createElement("small", null, "LOCAL DEMO RECORD"),
                    React.createElement("h2", null,
                        "Add to ",
                        section)),
                React.createElement("button", { type: "button", className: "iconButton", onClick: onClose, "aria-label": "Close form" },
                    React.createElement(X, { size: 19 }))),
            React.createElement("div", { className: "formGrid" }, definition.columns.map(([key, label], i) => React.createElement("label", { key: key },
                label,
                React.createElement("input", { autoFocus: i === 0, value: form[key], onChange: e => set(key, e.target.value), placeholder: label })))),
            React.createElement("div", { className: "modalNote" }, "Saved only in this browser using local storage. It is not shared with other staff."),
            React.createElement("div", { className: "modalActions" },
                React.createElement("button", { type: "button", className: "secondary", onClick: onClose }, "Cancel"),
                React.createElement("button", { className: "primary", type: "submit" }, "Save demo record"))));
}
function Empty({ label }) { return React.createElement("div", { className: "emptyState" },
    React.createElement(PackageSearch, { size: 22 }),
    React.createElement("span", null, label)); }
export default App;
