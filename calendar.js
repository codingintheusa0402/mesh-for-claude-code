// Today's Google Calendar events for the header ribbon (read-only).
// One-time connect: OAuth for installed apps with a loopback redirect — the user approves in their browser, the
// refresh token is kept in <userData>/calendar_token.json (never in git). The OAuth client is an installed-app client
// you provide (~/.config/gws_shim/token.json: client_id/client_secret), asking only for calendar.readonly.
// Events come from the Calendar API with singleEvents=true, so recurring meetings arrive already expanded.
// Staying connected: the saved refresh token doesn't expire, so a failed check almost never means "sign in again".
// Only Google saying the grant itself is gone (invalid_grant …) asks you to reconnect, and the reason goes to
// <userData>/calendar.log. Offline, asleep, a timeout, a Google hiccup: today's events stay up and it retries by itself.
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const APP_NAME = require('./mesh-name').name;           // the app's name — one setting (mesh-name.js)

const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const CLIENT_FILE = path.join(os.homedir(), '.config', 'gws_shim', 'token.json');
const REFRESH_MS = 5 * 60e3, RETRY_MS = 30e3, TIMEOUT_MS = 20e3;
const DEAD_GRANT = /^(invalid_grant|invalid_client|unauthorized_client|deleted_client)$/;   // Google's own "this token is finished"

module.exports = function createCalendar({ userData, openExternal, onChange }) {
  const TOKEN_FILE = path.join(userData, 'calendar_token.json');
  const saved = () => { try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch { return null; } };
  let state = { status: saved() ? 'loading' : 'idle', events: [], error: null, at: 0 };
  let access = null, accessExp = 0, timer = null, retry = null, retryMs = RETRY_MS, running = false, again = false, lastClient = null;

  // (the client file is shared with other jobs that rewrite it: a read caught mid-write uses the last good copy)
  const client = () => { try { const j = JSON.parse(fs.readFileSync(CLIENT_FILE, 'utf8')); if (j.client_id && j.client_secret) lastClient = { id: j.client_id, secret: j.client_secret }; } catch { } return lastClient; };
  const save = t => { const tmp = TOKEN_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(t), { mode: 0o600 }); fs.renameSync(tmp, TOKEN_FILE); };   // never a half-written token
  const log = m => { try { fs.appendFileSync(path.join(userData, 'calendar.log'), `${new Date().toISOString()} ${m}\n`); } catch { } };
  const set = patch => { state = { ...state, ...patch }; onChange && onChange(state); };

  async function post(url, form) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form), signal: AbortSignal.timeout(TIMEOUT_MS) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error_description || j.error || 'HTTP ' + r.status), { oauth: j.error }); return j;
  }

  async function token() {
    if (access && Date.now() < accessExp - 60e3) return access;
    const t = saved(), c = client(); if (!t || !t.refresh_token || !c) return null;
    const j = await post('https://oauth2.googleapis.com/token', { client_id: c.id, client_secret: c.secret, refresh_token: t.refresh_token, grant_type: 'refresh_token' });
    if (j.refresh_token && j.refresh_token !== t.refresh_token) save({ ...t, refresh_token: j.refresh_token, at: Date.now() });   // if Google ever rotates it
    access = j.access_token; accessExp = Date.now() + (j.expires_in || 3600) * 1000; return access;
  }

  // not a sign-in problem: keep what's on screen and try again soon (30 s, doubling up to the normal 5 min)
  function later(e) {
    if (state.status !== 'ok') set({ status: 'offline', error: e.message });
    clearTimeout(retry); retry = setTimeout(refresh, retryMs); retryMs = Math.min(REFRESH_MS, retryMs * 2);
  }

  // the events of today (local time) on your own (primary) calendar
  async function refresh() {
    if (running) { again = true; return; }
    running = true; clearTimeout(retry);
    try { await check(); } finally { running = false; if (again) { again = false; refresh(); } }
  }
  async function check() {
    let tk;
    try { tk = await token(); } catch (e) {
      if (!DEAD_GRANT.test(e.oauth || '')) return later(e);
      log(`refused by Google: ${e.oauth} (${e.message})`);
      return set({ status: 'error', error: 'Google ended this calendar connection (' + e.message + ') — reconnect' });
    }
    if (!tk) return set({ status: saved() ? 'error' : 'disconnected', error: client() ? null : 'No Google OAuth client found (~/.config/gws_shim/token.json)' });
    const d0 = new Date(); d0.setHours(0, 0, 0, 0); const d1 = new Date(d0); d1.setDate(d1.getDate() + 1);
    try {
      const H = { Authorization: 'Bearer ' + tk };
      const cl = await (await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader', { headers: H, signal: AbortSignal.timeout(TIMEOUT_MS) })).json();
      if (cl.error) throw Object.assign(new Error(cl.error.message), { api: cl.error });
      // only your own calendar (the blue one) — colleagues' / shared calendars you have ticked are not your agenda
      const cals = (cl.items || []).filter(c => c.primary);
      const all = [];
      for (const c of cals) {
        const q = new URLSearchParams({ timeMin: d0.toISOString(), timeMax: d1.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '50' });
        const j = await (await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.id)}/events?${q}`, { headers: H, signal: AbortSignal.timeout(TIMEOUT_MS) })).json();
        if (j.error) throw Object.assign(new Error(j.error.message), { api: j.error });    // (an error isn't an empty day)
        for (const e of j.items || []) {
          if (e.status === 'cancelled') continue;
          if (!e.summary && !c.primary) continue;                        // untitled block on someone else's calendar
          const me = (e.attendees || []).find(a => a.self); if (me && me.responseStatus === 'declined') continue;   // declined → not on your day
          all.push({
            id: (e.iCalUID || e.id) + '@' + ((e.start && (e.start.dateTime || e.start.date)) || ''), title: e.summary || '(no title)', allDay: !!(e.start && e.start.date),
            start: e.start && (e.start.dateTime ? Date.parse(e.start.dateTime) : Date.parse(e.start.date + 'T00:00:00')),
            end: e.end && (e.end.dateTime ? Date.parse(e.end.dateTime) : Date.parse(e.end.date + 'T00:00:00')),
            link: e.htmlLink || '', meet: e.hangoutLink || ((e.conferenceData || {}).entryPoints || []).find(p => p.entryPointType === 'video')?.uri || '',
            color: c.backgroundColor || '', primary: !!c.primary,
          });
        }
      }
      // the same meeting on two calendars (yours + a shared one) → once, preferring your primary calendar's copy
      all.sort((a, b) => (b.primary - a.primary));
      const seen = new Set(); const events = all.filter(e => !seen.has(e.id) && seen.add(e.id)).sort((a, b) => a.start - b.start);
      retryMs = RETRY_MS;
      set({ status: 'ok', events, error: null, at: Date.now() });
    } catch (e) {
      const api = e.api || {}, why = (api.errors && api.errors[0] && api.errors[0].reason) || '';
      if (api.code === 401) { access = null; accessExp = 0; }                    // a stale access token: the next check gets a fresh one
      if (!e.api || api.code === 401 || api.code === 429 || api.code >= 500 || /rateLimit/i.test(why)) return later(e);
      log(`calendar API: ${api.code} ${why} (${e.message})`);
      set({ status: 'error', error: why === 'accessNotConfigured' || /has not been used|is disabled/i.test(e.message) ? 'Calendar API is off for this Google project — enable it, then wait a minute' : e.message,
            enableUrl: /https:\/\/console\.developers\.google\.com\S+/.exec(e.message || '')?.[0] || null });
    }
  }

  // one-time consent: loopback server on a free port, PKCE, browser opens Google's page
  function connect() {
    const c = client(); if (!c) { set({ status: 'error', error: 'No Google OAuth client found (~/.config/gws_shim/token.json)' }); return; }
    const verifier = crypto.randomBytes(32).toString('base64url'), challenge = crypto.createHash('sha256').update(verifier).digest('base64url'), st = crypto.randomBytes(12).toString('hex');
    const srv = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1'); if (u.pathname !== '/cb') { res.writeHead(404); return res.end(); }
      const ok = u.searchParams.get('state') === st && u.searchParams.get('code');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<body style="font:15px -apple-system;background:#000;color:#eee;padding:40px">${ok ? APP_NAME + ' can now show today\'s calendar. You can close this tab.' : 'Calendar connection was cancelled.'}</body>`);
      srv.close();
      if (!ok) return set({ status: 'disconnected', error: u.searchParams.get('error') || null });
      try {
        const j = await post('https://oauth2.googleapis.com/token', { client_id: c.id, client_secret: c.secret, code: u.searchParams.get('code'), code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: `http://127.0.0.1:${srv.port}/cb` });
        const rt = j.refresh_token || (saved() || {}).refresh_token;              // Google can omit it: never overwrite a good one with nothing
        if (!rt) throw new Error('Google sent no refresh token');
        save({ refresh_token: rt, scope: j.scope, at: Date.now() });
        access = j.access_token; accessExp = Date.now() + (j.expires_in || 3600) * 1000;
        refresh();
      } catch (e) { set({ status: 'error', error: 'Calendar connection failed: ' + e.message }); }
    });
    srv.listen(0, '127.0.0.1', () => {
      srv.port = srv.address().port;
      const q = new URLSearchParams({ client_id: c.id, redirect_uri: `http://127.0.0.1:${srv.port}/cb`, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', state: st, code_challenge: challenge, code_challenge_method: 'S256', ...(require('./mesh-name').calendarAccount ? { login_hint: require('./mesh-name').calendarAccount } : {}) });   // optional: mesh.local.json calendarAccount
      set({ status: 'connecting', error: null });
      openExternal('https://accounts.google.com/o/oauth2/v2/auth?' + q);
    });
    setTimeout(() => { try { srv.close(); } catch { } if (state.status === 'connecting') set({ status: 'disconnected' }); }, 5 * 60e3);
  }

  function disconnect() { try { fs.unlinkSync(TOKEN_FILE); } catch { } access = null; set({ status: 'disconnected', events: [] }); }
  function start() { refresh(); clearInterval(timer); timer = setInterval(refresh, REFRESH_MS); }
  // back from sleep: give the network a moment, then look again
  function wake() { clearTimeout(retry); retryMs = RETRY_MS; retry = setTimeout(refresh, 8000); }

  return { start, refresh, wake, connect, disconnect, get: () => state };
};
