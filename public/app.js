// T3 Pocket Loupe: the phone app. Read-only: it shows, it never acts.
//
// Screens (hash routes, so the in-app Back and history agree):
//   #/                       every thread: Needs you, Working, Done
//   #/thread/<env>/<id>      one thread's live detail
//   #/machine/<env>          one machine's health and usage windows
//
// Data: GET /api/state on start, then the /api/events stream; polling when the stream
// keeps failing. Reachability comes from /ping only. Every fetch has a timeout.
// All text goes in with textContent; nothing is parsed as HTML.
import * as Format from './vendor/format.js';
import * as Icons from './vendor/icons.js';
import * as Palette from './vendor/palette.js';
import * as Store from './vendor/store.js';

const VERSION = 'pl-0.1.1'; // must equal VERSION in sw.js (a test checks)
const STALE_AFTER_MS = 90_000;
const STATE_TIMEOUT_MS = 5000;
const PING_TIMEOUT_MS = 3000;
const DETAIL_TIMEOUT_MS = 6000;
const DETAIL_REFRESH_MS = 20_000;
const POLL_MS = 15_000;
const TICK_MS = 5000;
const SVG_NS = 'http://www.w3.org/2000/svg';

const $ = (id) => document.getElementById(id);

const model = {
  state: null,        // last /api/state body
  fromCache: false,   // that body came from the service worker's cache
  loadError: null,    // why the last state fetch failed, when there's no state at all
  reachable: true,    // the last /ping answered
  detail: null,       // { key, body, error, loading }
  attention: null,    // last announced "needs you" count
};
const ui = { expanded: Object.create(null), idleOpen: Object.create(null), depth: 0 };
const timers = { poll: 0, detail: 0, tick: 0, starting: 0 };
let stream = null;
let streamErrors = [];
let registration = null;

// ---------------------------------------------------------------- helpers

/** createElement with text, classes and safe attributes. Children may be nodes, strings or null. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'on') for (const [ev, fn] of Object.entries(value)) el.addEventListener(ev, fn);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** A Lucide icon from T3 Loupe's set, drawn as 2px round strokes. Decorative. */
function icon(name, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `icon ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of Icons.get(name)) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** fetch with a wall-clock timeout (AbortController + timer; NW-OFF-011). */
async function getJson(path, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, { signal: controller.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    return { ok: res.ok, status: res.status, body, fromCache: res.headers.get('X-From-Cache') !== null };
  } finally {
    clearTimeout(timer);
  }
}

/** Reachability: only /ping says whether the host answers (NW-OFF-010). */
async function ping() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const res = await fetch('/ping', { cache: 'no-store', signal: controller.signal });
    model.reachable = res.ok;
  } catch {
    model.reachable = false;
  } finally {
    clearTimeout(timer);
  }
  return model.reachable;
}

function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hrs = Math.round(m / 60);
  return hrs < 48 ? `${hrs} h ago` : `${Math.round(hrs / 24)} days ago`;
}

function envLabel(envId) {
  const env = model.state?.environments?.find((e) => e.id === envId);
  return env ? env.label : envId;
}

function roleClass(state) {
  const role = Store.stateRole(state);
  return role === 'attention' ? 'role-attention' : role === 'accent' ? 'role-accent' : role === 'success' ? 'role-success' : 'role-dim';
}

function healthClass(state) {
  if (Store.environmentOk(state)) return 'ok';
  if (state === 'connecting' || state === 'offline' || state === 'tunnel_missing') return 'warn';
  return 'bad';
}

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map((p) => { try { return decodeURIComponent(p); } catch { return ''; } });
  if (parts[0] === 'thread' && parts[1] && parts[2]) return { view: 'thread', envId: parts[1], threadId: parts[2] };
  if (parts[0] === 'machine' && parts[1]) return { view: 'machine', envId: parts[1] };
  return { view: 'main' };
}

function go(hash) {
  ui.depth++;
  location.hash = hash;
}

function back() {
  if (ui.depth > 0) {
    ui.depth--;
    history.back();
  } else {
    location.replace('#/');
  }
}

// ---------------------------------------------------------------- theme

function applyTheme(colors) {
  if (!colors || typeof colors !== 'object') return;
  const p = Palette.derive({
    background: colors.background, foreground: colors.foreground, accent: colors.accent,
    urgent: colors.urgent || colors.red, muted: colors.muted, colors,
  });
  const map = {
    bg: p.background, surface: p.surface, raised: p.surfaceRaised, selected: p.surfaceSelected, line: p.line, track: p.track,
    text: p.text, dim: p.textDim, faint: p.textFaint, accent: p.accent, 'accent-ink': p.accentInk,
    attention: p.attention, 'attention-ink': p.attentionInk, success: p.success, 'success-ink': p.successInk,
    warning: p.warning, 'warning-ink': p.warningInk, info: p.info, subagent: p.subagent, focus: p.accentInk,
  };
  const style = document.documentElement.style;
  for (const [key, value] of Object.entries(map)) style.setProperty(`--${key}`, value);
  style.setProperty('color-scheme', p.light ? 'light' : 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.background);
}

async function loadTheme() {
  try {
    const r = await getJson('/api/theme', STATE_TIMEOUT_MS);
    if (r.ok && r.body) applyTheme(r.body.colors);
  } catch {
    // The built-in palette stays.
  }
}

// ---------------------------------------------------------------- state

function setState(body, fromCache) {
  if (!body || body.v !== 1) return;
  model.state = body;
  model.fromCache = fromCache;
  model.loadError = null;
  announceAttention();
  render();
}

async function loadState() {
  try {
    const r = await getJson('/api/state', STATE_TIMEOUT_MS);
    if (r.ok && r.body) {
      setState(r.body, r.fromCache);
      if (r.fromCache) await ping();
      else model.reachable = true;
      // The collector hasn't reported yet (the host just started): ask again soon.
      if (!r.fromCache && r.body.at === null && document.visibilityState === 'visible') {
        clearTimeout(timers.starting);
        timers.starting = setTimeout(() => { void loadState(); }, 2000);
      }
    } else {
      model.loadError = `The host answered ${r.status}.`;
      await ping();
    }
  } catch {
    model.loadError = 'No answer from the host.';
    await ping();
  }
  render();
}

function announceAttention() {
  const n = model.state?.counts?.attention ?? 0;
  if (model.attention !== null && n !== model.attention) {
    $('announce').textContent = n === 0 ? 'Nothing needs you now.' : `${plural(n, 'thread needs', 'threads need')} you.`;
  }
  model.attention = n;
}

// Live updates: server-sent events, then polling when the stream keeps failing.
function openStream() {
  closeStream();
  if (!('EventSource' in window) || streamErrors.length >= 2) {
    startPolling();
    return;
  }
  clearInterval(timers.poll); // the stream replaces polling
  stream = new EventSource('/api/events');
  stream.addEventListener('state', (event) => {
    try {
      setState(JSON.parse(event.data), false);
      model.reachable = true;
    } catch {
      // A malformed event is ignored; the next one replaces it.
    }
  });
  stream.addEventListener('error', () => {
    const now = Date.now();
    streamErrors = streamErrors.filter((t) => now - t < 30_000).concat(now);
    // Two errors in 30 s, or a stream the browser gave up on: fall back to polling.
    if (streamErrors.length >= 2 || stream?.readyState === EventSource.CLOSED) {
      closeStream();
      startPolling();
    }
    void ping().then(render);
  });
}

function closeStream() {
  if (stream) stream.close();
  stream = null;
}

function startPolling() {
  clearInterval(timers.poll);
  timers.poll = setInterval(() => { void loadState(); }, POLL_MS);
}

// ---------------------------------------------------------------- header, chips, banner

/** Root rows per list section, exactly as T3 Loupe's "active" view groups them. */
function sectionCounts(rows) {
  const out = { needs: 0, working: 0, done: 0 };
  for (const item of Store.visibleRows(rows, 'active', '', {}, {})) {
    if (item.kind === 'section') out[item.key.slice(4)] = item.count;
  }
  return out;
}

function renderChrome(r) {
  const s = model.state;
  $('back').hidden = r.view === 'main';
  $('title').textContent = r.view === 'thread' ? 'Thread' : r.view === 'machine' ? 'Machine' : 'Pocket Loupe';

  // The summary counts what the list's sections show (T3 Loupe's Working includes usage-limited threads).
  const summary = $('summary');
  let summaryKey = model.loadError ? 'error' : 'loading';
  let needs = 0, working = 0;
  if (s && s.at !== null) {
    const counts = sectionCounts(s.rows);
    needs = counts.needs;
    working = counts.working;
    summaryKey = `${needs}/${working}/${s.environments.length}`;
  }
  if (summary.dataset.key !== summaryKey) {
    summary.dataset.key = summaryKey;
    summary.replaceChildren();
    if (summaryKey === 'error') summary.textContent = 'Not connected';
    else if (summaryKey === 'loading') summary.textContent = 'Loading…';
    else summary.append(
      h('span', { class: needs ? 'needs' : '', text: `${needs} need${needs === 1 ? 's' : ''} you` }),
      ` · ${working} working · ${plural(s.environments.length, 'machine', 'machines')}`,
    );
  }

  // Machine chips: rebuilt only when something they show changes, so a tap or VoiceOver
  // focus isn't lost to the 5 s tick. While the host is unreachable their health is unknown.
  const chips = $('machines');
  const unknown = !model.reachable || model.fromCache;
  const envs = r.view === 'main' && s ? s.environments : [];
  const chipsKey = JSON.stringify([unknown, envs.map((e) => [e.id, e.label, e.state])]);
  if (chips.dataset.key !== chipsKey) {
    chips.dataset.key = chipsKey;
    chips.replaceChildren(...envs.map((env) => {
      const health = unknown ? 'status unknown, host unreachable' : Store.environmentLabel(env.state);
      return h('button', {
        type: 'button', class: 'chip', 'data-key': `chip:${env.id}`, 'aria-label': `${env.label}: ${health}. Show machine details`,
        on: { click: () => go(`#/machine/${encodeURIComponent(env.id)}`) },
      }, h('span', { class: `dot ${unknown ? 'unknown' : healthClass(env.state)}`, 'aria-hidden': 'true' }), env.label);
    }));
  }

  // The stale banner: old data on screen, said honestly, with the age and a Retry.
  const banner = $('stale-banner');
  const text = $('stale-text');
  const retry = $('stale-retry');
  let message = '';
  if (s && s.at !== null) {
    const age = ago(s.receivedAt);
    if (!model.reachable || model.fromCache) message = `Last updated ${age} · host unreachable`;
    else if (s.receivedAt && Date.now() - s.receivedAt > STALE_AFTER_MS) message = `Last updated ${age} · T3 Loupe isn't reporting`;
  }
  if (text.textContent !== message) text.textContent = message;
  banner.classList.toggle('on', message !== '');
  retry.hidden = message === '';

  $('updated').textContent = s?.receivedAt ? `Updated ${ago(s.receivedAt)}` : 'Not updated yet';
}

// ---------------------------------------------------------------- main screen

function message(iconName, title, text, action) {
  return h('div', { class: 'message' },
    icon(iconName),
    h('h2', { text: title }),
    text ? h('p', { text }) : null,
    action ? h('button', { type: 'button', class: 'retry', on: { click: action.run } }, action.label) : null);
}

function unreachableMessage(detail, retry) {
  const why = detail || model.loadError || 'No answer from the host.';
  return message('server', 'Can\'t reach Pocket Loupe on the host', `${why} Check that Tailscale is connected on this phone and the host is awake.`, { label: 'Retry', run: retry });
}

function collectorNotice(s) {
  const c = s.collector || {};
  const code = c.error ? ` (${c.error})` : '';
  if (c.status === 'missing') return ['T3 Loupe isn\'t installed on the host', 'Pocket Loupe reads T3 Loupe\'s collector, and it wasn\'t found. Install the T3 Loupe plugin on the host.'];
  if (c.status === 'protocol_mismatch') return ['T3 Loupe speaks a newer protocol', 'The T3 Loupe plugin on the host is newer than this Pocket Loupe. Update Pocket Loupe.'];
  if (c.status === 'failed') return ['T3 Loupe\'s collector keeps failing', `It exits before reporting${code}. Run T3 Loupe's doctor on the host.`];
  if (s.configError) return ['T3 Loupe can\'t read its connections', `Check T3 Loupe's pairings on the host (${s.configError}).`];
  return null;
}

function waitingFor(row) {
  if (row.state === 'input') return Store.pendingInfo(row.pendingKind).label;
  if (row.state === 'plan') return 'Plan ready';
  if (row.state === 'failed') return row.error ? `Failed: ${row.error}` : 'Failed';
  if (row.state === 'limited') return 'Usage limit';
  return Store.stateLabel(row);
}

function rowItem(row, isChild) {
  const busy = Store.BUSY[row.state] === true;
  const needs = Store.ATTENTION[row.state] === true;
  const now = Date.now();
  const time = Format.elapsed(row, now, busy);
  const where = [row.project, envLabel(row.envId)].filter(Boolean).join(' · ');

  let what = null;
  if (needs || row.state === 'limited') {
    what = h('span', { class: `what-text ${Store.isAlarm(row.state) ? 'alarm' : ''}`, text: waitingFor(row) });
  } else if (busy) {
    const act = Store.currentActivity(row);
    what = act
      ? [icon(act.icon || 'circle-dot', 'role-dim'), h('span', { class: 'what-text', text: act.label })]
      : h('span', { class: 'what-text', text: Store.stateLabel(row) });
  } else if (row.state === 'review' && row.unread) {
    what = h('span', { class: 'what-text unseen', text: 'Done · not seen yet' });
  } else {
    what = h('span', { class: 'what-text', text: Store.stateLabel(row) });
  }

  const label = `${row.title || 'Untitled thread'}. ${waitingFor(row)}. ${where}${time ? `. ${time}` : ''}`;
  const main = h('button', {
    type: 'button', class: 'row-main', 'data-key': row.key, 'aria-label': label,
    on: { click: () => go(`#/thread/${encodeURIComponent(row.envId)}/${encodeURIComponent(row.id)}`) },
  },
  icon(Store.stateIcon(row), roleClass(row.state)),
  h('span', { class: 'row-title', text: row.title || 'Untitled thread' }),
  h('span', { class: 'row-time', text: time }),
  h('span', { class: 'row-meta', text: where }),
  h('span', { class: 'row-what' }, what));

  const li = h('li', { class: isChild ? 'child' : '' }, main);
  const kids = isChild ? 0 : (row.activeChildren || 0);
  if (kids > 0) {
    const open = ui.expanded[row.key] === true;
    li.append(h('button', {
      type: 'button', class: 'agents', 'aria-expanded': open ? 'true' : 'false', 'data-key': `agents:${row.key}`,
      'aria-label': `${open ? 'Hide' : 'Show'} ${plural(kids, 'running agent', 'running agents')}`,
      on: { click: () => { ui.expanded[row.key] = !open; render(); } },
    }, icon('bot'), `+${kids}`));
  }
  return li;
}

function renderMain(main) {
  const s = model.state;
  if (!s || s.at === null) {
    if (s && collectorNotice(s)) {
      const [title, text] = collectorNotice(s);
      main.append(message('circle-alert', title, text, { label: 'Retry', run: retryNow }));
    } else if (model.loadError) {
      main.append(unreachableMessage(null, retryNow));
    } else {
      main.append(h('div', { class: 'skeleton', 'aria-hidden': 'true' }, h('div'), h('div'), h('div')));
    }
    return;
  }

  const notice = collectorNotice(s);
  if (notice) main.append(h('div', { class: 'notice', role: 'note' }, h('strong', { text: notice[0] }), notice[1]));
  if (!s.environments.length) {
    main.append(message('plug-zap', 'No machines paired', 'Pair a machine with T3 Loupe on the host, and it shows up here.'));
    return;
  }

  // The panel's own grouping and order (T3 Loupe lib/Store.js, "active" filter).
  const items = Store.visibleRows(s.rows, 'active', '', ui.expanded, ui.idleOpen);
  const visible = items.filter((item) => {
    if (item.kind || !item.parentId) return true;
    const parentKey = `${item.envId}:${item.parentId}`;
    return ui.expanded[parentKey] === true || Store.ATTENTION[item.state] === true;
  });
  if (!visible.length) {
    main.append(message('circle-check', 'Nothing running', 'No T3 threads are active on your machines.'));
    return;
  }

  let section = null;
  let list = null;
  const open = (title, count) => {
    section = h('section', { 'aria-label': title });
    if (title) section.append(h('h2', {}, title, count !== undefined ? h('span', { class: 'count', text: String(count) }) : null));
    list = h('ul', { class: 'rows' });
    section.append(list);
    main.append(section);
  };
  for (const item of visible) {
    if (item.kind === 'section') {
      open(item.label, item.count);
    } else if (item.kind === 'idle-line') {
      if (!list) open('');
      const isOpen = item.open;
      list.append(h('li', {}, h('button', {
        type: 'button', class: 'fold', 'aria-expanded': isOpen ? 'true' : 'false', 'data-key': item.key,
        on: { click: () => { ui.idleOpen[item.key] = !isOpen; render(); } },
      }, `${isOpen ? 'Hide' : 'Show'} idle and stopped (${item.count})`)));
    } else {
      if (!list) open('');
      list.append(rowItem(item, !!item.parentId));
    }
  }
}

// ---------------------------------------------------------------- thread detail

function detailKey(r) { return `${r.envId}/${r.threadId}`; }

async function loadDetail(r) {
  const key = detailKey(r);
  if (!model.detail || model.detail.key !== key) model.detail = { key, body: null, error: null, loading: true };
  try {
    const res = await getJson(`/api/thread/${encodeURIComponent(r.envId)}/${encodeURIComponent(r.threadId)}`, DETAIL_TIMEOUT_MS);
    if (model.detail?.key !== key) return;
    if (res.ok && res.body) model.detail = { key, body: res.body, error: null, loading: false };
    else model.detail = { ...model.detail, loading: false, error: res.status === 404 ? 'gone' : res.status === 504 ? 'timeout' : 'error' };
  } catch {
    if (model.detail?.key !== key) return;
    model.detail = { ...model.detail, loading: false, error: 'unreachable' };
    await ping();
  }
  if (route().view === 'thread') render();
}

function card(title, ...children) {
  return h('section', { class: 'card', 'aria-label': title }, h('h2', { text: title }), ...children);
}

function t3Link() {
  // T3's own web UI on this host, at the default HTTPS port.
  const url = new URL('/', location.href);
  url.port = '';
  return url.href;
}

function copyButton(text, what, label = 'Copy link') {
  if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return null;
  return h('button', {
    type: 'button', class: 'action',
    on: { click: () => navigator.clipboard.writeText(text).then(() => { $('announce').textContent = `${what} copied.`; }, () => { $('announce').textContent = 'Copy failed.'; }) },
  }, label);
}

function pendingCard(p) {
  const body = [];
  if (p.kind === 'user_input' || p.questions.length) {
    for (const q of p.questions) {
      if (q.header) body.push(h('p', { class: 'facts', text: q.header }));
      body.push(h('p', { class: 'question', text: q.question }));
      if (q.options.length) body.push(h('ol', { class: 'options' }, q.options.map((o) => h('li', { text: o }))));
    }
  }
  if (p.prompt) {
    body.push(h('p', { class: 'facts', text: p.kind === 'command' ? 'Wants to run:' : 'Asks:' }));
    body.push(h('pre', { class: 'command' }, h('code', { text: p.prompt })));
  }
  if (p.options.length) body.push(h('p', { class: 'facts', text: `Options in T3: ${p.options.join(' · ')}` }));
  const since = p.since ? ` · waiting ${Format.duration(Date.now() - p.since)}` : '';
  const link = t3Link();
  return h('section', { class: 'card pending', 'aria-label': 'Waiting for you' },
    h('h2', { text: `${Store.pendingInfo(p.kind).label}${since}` }),
    ...body,
    h('div', { class: 'links' },
      h('a', { class: 'action', href: link, target: '_blank', rel: 'noopener noreferrer' }, 'Answer this in T3'),
      copyButton(link, 'T3 link')));
}

function runsChart(runs) {
  const list = runs.slice(-24);
  const longest = Math.max(1, ...list.map((r) => r.durationMs || 0));
  const width = 100;
  const step = width / Math.max(list.length, 8);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'runs');
  svg.setAttribute('viewBox', `0 0 ${width} 40`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  const failed = list.filter((r) => r.status === 'failed').length;
  svg.setAttribute('aria-label', `${plural(list.length, 'run', 'runs')}${failed ? `, ${failed} failed` : ''}. Longest ${Format.duration(longest)}.`);
  list.forEach((r, i) => {
    const running = r.status === 'running';
    const value = running ? longest : Math.max(r.durationMs || 0, longest * 0.04);
    const height = Math.max(2, (value / longest) * 38);
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(i * step + step * 0.15));
    rect.setAttribute('width', String(step * 0.7));
    rect.setAttribute('y', String(40 - height));
    rect.setAttribute('height', String(height));
    rect.setAttribute('rx', '1');
    rect.setAttribute('class', running ? 'bar-running' : r.status === 'failed' ? 'bar-failed' : 'bar-ok');
    svg.append(rect);
  });
  return svg;
}

function meter(label, value, max, right) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  // An SVG bar, so the width is an attribute rather than an inline style.
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `meter ${pct >= 90 ? 'hot' : ''}`.trim());
  svg.setAttribute('role', 'progressbar');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('aria-valuemin', '0');
  svg.setAttribute('aria-valuemax', '100');
  svg.setAttribute('aria-valuenow', String(Math.round(pct)));
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('viewBox', '0 0 100 1');
  for (const [cls, width] of [['meter-track', 100], ['meter-fill', pct]]) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('class', cls);
    rect.setAttribute('width', String(width));
    rect.setAttribute('height', '1');
    svg.append(rect);
  }
  return h('div', {},
    h('div', { class: 'meter-label' }, h('strong', { text: label }), h('span', { text: right })),
    svg);
}

function renderThread(main, r) {
  const row = model.state?.rows?.find((x) => x.envId === r.envId && x.id === r.threadId);
  const d = model.detail?.key === detailKey(r) ? model.detail : null;

  if (!row && !d?.body) {
    if (d?.error === 'unreachable' || d?.error === 'timeout' || (!model.state && model.loadError)) {
      main.append(unreachableMessage(d?.error === 'timeout' ? 'T3 didn\'t send this thread\'s detail in time.' : null, () => { retryNow(); }));
    } else if (!model.state || d?.loading !== false) {
      main.append(h('div', { class: 'skeleton', 'aria-hidden': 'true' }, h('div'), h('div')));
    } else {
      main.append(message('circle-dot', 'This thread isn\'t active any more', 'It may have been archived, or its machine went offline.', { label: 'Back to all threads', run: back }));
    }
    return;
  }

  if (row) {
    const facts = [row.project, row.branch, envLabel(row.envId)].filter(Boolean).join(' · ');
    const who = [row.provider, Format.model(row.model), row.mode].filter(Boolean).join(' · ');
    const busy = Store.BUSY[row.state] === true;
    main.append(
      h('h2', { class: 'detail-title', id: 'detail-title', tabindex: '-1', text: row.title || 'Untitled thread' }),
      h('p', { class: 'facts', text: facts }),
      who ? h('p', { class: 'facts', text: who }) : null,
      h('p', { class: 'state-line' }, icon(Store.stateIcon(row), roleClass(row.state)),
        h('span', { class: Store.isAlarm(row.state) ? 'alarm' : '', text: waitingFor(row) }),
        h('span', { class: 'facts', text: Format.elapsed(row, Date.now(), busy) })),
    );
    if (row.state === 'failed' && row.error) main.append(card('Error', h('p', { text: row.error })));
  }

  if (!d || (d.loading && !d.body)) {
    main.append(h('div', { class: 'skeleton', 'aria-hidden': 'true' }, h('div'), h('div')));
    return;
  }
  if (d.error && !d.body) {
    const text = d.error === 'timeout' ? 'T3 didn\'t send this thread\'s detail in time.'
      : d.error === 'gone' ? 'This thread or its machine isn\'t known any more.'
        : 'Pocket Loupe on the host didn\'t answer.';
    main.append(message('circle-alert', 'Couldn\'t load the detail', text, { label: 'Retry', run: () => { void loadDetail(r); } }));
    return;
  }

  const detail = d.body.detail;
  for (const p of detail.pending) main.append(pendingCard(p));

  if (detail.todo && detail.todo.total) {
    main.append(card('Plan',
      meter(`${detail.todo.done} of ${detail.todo.total} steps`, detail.todo.done, detail.todo.total, `${Math.round((detail.todo.done / detail.todo.total) * 100)}%`),
      detail.todo.current ? h('p', { class: 'facts', text: `Now: ${detail.todo.current}` }) : null));
  }

  if (detail.activity.length) {
    main.append(card('Recent activity', h('ul', { class: 'events' }, [...detail.activity].sort((x, y) => (y.at || 0) - (x.at || 0)).slice(0, 8).map((a) =>
      h('li', {}, icon(a.icon || 'circle-dot', a.status === 'running' || a.status === 'pending' ? 'role-accent' : a.status === 'failed' ? 'role-attention' : 'role-dim'),
        h('span', { class: 'ev-label', text: a.label }),
        h('span', { class: 'ev-time', text: a.at ? Format.ago(a.at, Date.now()) : '' }))))));
  }

  if (detail.runs.length) {
    const last = detail.runs[detail.runs.length - 1];
    main.append(card('Runs', runsChart(detail.runs),
      h('p', { class: 'facts', text: `Latest run: ${last.status}${last.durationMs ? `, ${Format.duration(last.durationMs)}` : ''}` })));
  }

  if (detail.context && detail.context.max) {
    const cost = Format.money(detail.context.cost, detail.context.currency);
    main.append(card('Context',
      meter(`${Format.tokens(detail.context.used)} of ${Format.tokens(detail.context.max)} tokens`, detail.context.used, detail.context.max, cost ? `${cost} so far` : '')));
  }

  if (row?.pr) {
    const pr = row.pr;
    const bits = [pr.draft ? 'draft' : pr.state, pr.checks ? `checks ${pr.checks}` : '', pr.review ? pr.review.toLowerCase().replace(/_/g, ' ') : '', `+${pr.additions} −${pr.deletions}`].filter(Boolean);
    main.append(card(`Pull request #${pr.number}`,
      h('p', { text: pr.title }),
      h('p', { class: 'facts', text: bits.join(' · ') }),
      /^https:\/\//.test(pr.url) ? h('div', { class: 'links' },
        h('a', { class: 'action', href: pr.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open pull request'),
        copyButton(pr.url, 'PR link')) : null));
  }

  if (detail.subagents.length) {
    main.append(card('Subagents', h('ul', { class: 'events' }, detail.subagents.map((sub) =>
      h('li', {}, icon(sub.status === 'running' ? 'loader-circle' : sub.status === 'failed' ? 'circle-x' : 'circle-check', sub.status === 'running' ? 'role-accent' : sub.status === 'failed' ? 'role-attention' : 'role-dim'),
        h('span', { class: 'ev-label', text: [sub.title, sub.progress, Format.model(sub.model)].filter(Boolean).join(' · ') }),
        h('span', { class: 'ev-time', text: sub.status }))))));
  }

  if (!detail.pending.length && !detail.activity.length && !detail.runs.length && !detail.subagents.length && !detail.todo && !detail.context) {
    main.append(message('circle-dot', 'No detail yet', 'T3 hasn\'t reported activity for this thread.'));
  }
  if (d.error) main.append(h('p', { class: 'facts', text: 'Showing the last detail received; the latest refresh failed.' }));
}

// ---------------------------------------------------------------- machine sheet

function renderMachine(main, r) {
  const env = model.state?.environments?.find((e) => e.id === r.envId);
  if (!env) {
    if (!model.state && model.loadError) main.append(unreachableMessage(null, retryNow));
    else if (!model.state) main.append(h('div', { class: 'skeleton', 'aria-hidden': 'true' }, h('div')));
    else main.append(message('circle-dot', 'Machine not found', 'T3 Loupe no longer lists this machine.', { label: 'Back to all threads', run: back }));
    return;
  }
  const now = Date.now();
  const lines = [];
  if (Store.environmentOk(env.state)) lines.push('Connected now');
  else if (env.lastLiveAt) lines.push(`Last connected ${Format.ago(env.lastLiveAt, now)}`);
  if (env.retryAt && !Store.environmentOk(env.state)) lines.push(`Next retry ${Format.until(env.retryAt, now)}`);
  if (env.sessionExpiresAt) lines.push(`Pairing expires ${Format.until(env.sessionExpiresAt, now)}`);
  if (env.serverVersion) lines.push(`T3 ${env.serverVersion}`);

  main.append(
    h('h2', { class: 'detail-title', id: 'detail-title', tabindex: '-1', text: env.label }),
    h('p', { class: 'state-line' }, h('span', { class: `dot ${healthClass(env.state)}`, 'aria-hidden': 'true' }), Store.environmentLabel(env.state)),
    h('p', { class: 'facts', text: lines.join(' · ') }),
    h('p', { class: 'facts', text: `${env.counts.attention} need you · ${env.counts.busy} working · ${env.counts.active} active` }),
  );

  const providers = env.providers.filter((p) => p.windows.length || p.status !== 'ready');
  if (!env.providers.length) {
    main.append(card('Usage', h('p', { class: 'facts', text: 'No provider usage reported.' })));
    return;
  }
  main.append(card('Usage', ...(providers.length ? providers : env.providers).map((p) => h('div', { class: 'provider' },
    h('p', { class: 'provider-name', text: `${p.name}${p.status && p.status !== 'ready' ? ` · ${p.status}` : ''}` }),
    p.windows.length
      ? p.windows.map((w) => meter(w.label, w.usedPercent, 100, `${Math.round(w.usedPercent)}%${w.resetsAt ? ` · resets ${Format.until(w.resetsAt, now)}` : ''}`))
      : h('p', { class: 'facts', text: 'No usage windows reported.' })))));
}

// ---------------------------------------------------------------- render

let lastView = '';

function render() {
  const r = route();
  const viewKey = r.view === 'thread' ? `t:${detailKey(r)}` : r.view === 'machine' ? `m:${r.envId}` : 'main';
  const main = $('main');
  const changedView = viewKey !== lastView;
  const scroll = changedView ? 0 : main.scrollTop;
  const focusKey = document.activeElement?.getAttribute?.('data-key');

  renderChrome(r);
  const fresh = document.createDocumentFragment();
  const holder = h('div');
  if (r.view === 'thread') renderThread(holder, r);
  else if (r.view === 'machine') renderMachine(holder, r);
  else renderMain(holder);
  fresh.append(...holder.childNodes);
  main.replaceChildren(fresh);
  main.setAttribute('aria-busy', model.state ? 'false' : 'true');
  main.scrollTop = scroll;

  if (focusKey) main.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  if (changedView) {
    lastView = viewKey;
    if (r.view !== 'main') ($('detail-title') || $('title')).focus({ preventScroll: true });
  }
}

function onRoute() {
  const r = route();
  clearInterval(timers.detail);
  if (r.view === 'thread') {
    model.detail = null;
    void loadDetail(r);
    // Re-asking every 20 s keeps the collector's watch on this thread pinned.
    timers.detail = setInterval(() => { if (document.visibilityState === 'visible') void loadDetail(route()); }, DETAIL_REFRESH_MS);
  }
  render();
}

function retryNow() {
  streamErrors = [];
  void (async () => {
    await ping();
    await loadState();
    if (model.reachable) openStream();
    const r = route();
    if (r.view === 'thread') void loadDetail(r);
  })();
}

// ---------------------------------------------------------------- lifecycle

function pause() {
  closeStream();
  clearInterval(timers.poll);
  clearInterval(timers.tick);
}

function resume() {
  streamErrors = [];
  void loadState().then(() => openStream());
  const r = route();
  if (r.view === 'thread') void loadDetail(r);
  clearInterval(timers.tick);
  timers.tick = setInterval(() => renderChrome(route()), TICK_MS);
}

function showCrash(text) {
  $('crash-text').textContent = text || 'Pocket Loupe hit an error it couldn\'t recover from.';
  $('crash').hidden = false;
}

window.addEventListener('error', (event) => showCrash(`Error: ${event.message || 'unknown'}`));
window.addEventListener('unhandledrejection', (event) => showCrash(`Error: ${event.reason?.message || String(event.reason || 'unknown')}`));

// iOS freezes an installed app in the background and may restore it from the
// back-forward cache without running any script: stop on hide, re-check on show.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    pause();
  } else {
    resume();
    if (registration) registration.update().catch(() => {});
  }
});
window.addEventListener('pagehide', pause);
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    resume();
    if (registration) registration.update().catch(() => {});
  }
});
window.addEventListener('hashchange', onRoute);

function serviceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Reload only after the person tapped "Update ready": the first install also changes the
  // controller (clients.claim), and that must not reload the page.
  let accepted = false;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!accepted || reloading) return;
    reloading = true;
    location.reload();
  });
  const offer = (worker) => {
    const button = $('update');
    button.hidden = false;
    button.onclick = () => {
      button.disabled = true;
      button.textContent = 'Updating…';
      accepted = true;
      worker.postMessage('SKIP_WAITING');
    };
  };
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    registration = reg;
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
      });
    });
  }).catch(() => {
    // No offline shell (for example over plain HTTP); the app still works online.
  });
}

function start() {
  $('version').textContent = VERSION;
  $('back').addEventListener('click', back);
  $('stale-retry').addEventListener('click', retryNow);
  $('crash-reload').addEventListener('click', () => location.reload());
  if (!location.hash) history.replaceState(null, '', '#/');
  serviceWorker();
  void loadTheme();
  onRoute();
  resume();
}

start();
