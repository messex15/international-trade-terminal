// The Freight Desk on its own page, for clients who open a single-use access
// link. Portal members use the same desk inside the trade terminal instead.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Globe2, LayoutDashboard, LogOut } from 'lucide-react';
import FreightDesk from './FreightDesk.js';

const h = React.createElement;

function Shell() {
  const [session, setSession] = useState(null);

  async function signOut() {
    if (!confirm('Sign out of this browser? You will need a new access link to come back.')) return;
    await fetch('/api/freight/session', { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
    location.href = '/freight/access/';
  }

  return h(React.Fragment, null,
    h('header', { className: 'fdBar' },
      h('div', { className: 'fdBrand' },
        h('div', { className: 'brandMark' }, h(Globe2, { size: 23 })),
        h('div', { className: 'brandWords' }, h('b', null, 'INTERNATIONAL'), h('small', null, 'TRADE TERMINAL'))),
      h('span', { className: 'fdBarTitle' }, 'Freight Desk'),
      session && h('div', { className: 'fdWho' },
        h('span', null, `Signed in as ${session.label}${session.company ? `, ${session.company}` : ''}`),
        session.kind === 'member'
          ? h('a', { href: '/app/#Freight%20Desk' }, h(LayoutDashboard, { size: 15 }), 'Trade terminal')
          : h('button', { type: 'button', onClick: signOut }, h(LogOut, { size: 15 }), 'Sign out'))),
    h('main', { className: 'contentArea' }, h(FreightDesk, { variant: 'standalone', onSession: setSession })));
}

createRoot(document.getElementById('root')).render(h(React.StrictMode, null, h(Shell)));
