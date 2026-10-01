// Where single-use links land. The token sits after "#", which browsers never
// send to a server, and it is only redeemed when a person presses the button,
// so email security scanners that pre-open links cannot use it up.
const token = location.hash.replace(/^#/, '').trim();
if (token) history.replaceState(null, '', location.pathname + location.search);

const $ = (id) => document.getElementById(id);
const message = $('message');
const reason = new URLSearchParams(location.search).get('reason');

function show(id) {
  for (const el of ['invite', 'signedIn', 'noLink']) $(el).classList.toggle('hidden', el !== id);
}
function say(text, type = 'error') {
  message.textContent = text;
  message.className = `msg show ${type}`;
}

async function hasSession() {
  try {
    const res = await fetch('/api/freight/session', { credentials: 'same-origin' });
    return res.ok;
  } catch {
    return false;
  }
}

async function start() {
  if (token) {
    show('invite');
    $('open').focus();
    return;
  }
  if (await hasSession()) {
    show('signedIn');
    return;
  }
  if (reason === 'expired') {
    $('noLinkText').textContent = 'Your Freight Desk session on this browser has ended. Ask your contact for a new access link.';
  }
  show('noLink');
}

$('open').addEventListener('click', async () => {
  const button = $('open');
  button.disabled = true;
  button.textContent = 'Checking your link…';
  message.className = 'msg';
  try {
    const res = await fetch('/api/freight/redeem', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'That link could not be opened.');
    say('Signed in. Opening the Freight Desk…', 'ok');
    location.replace(data.next || '/freight/');
  } catch (err) {
    say(err.message);
    button.classList.add('hidden');
  }
});

start();
