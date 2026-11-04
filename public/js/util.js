// Small shared helpers: API calls, DOM building, toasts, local preferences.

export async function api(path, { method = 'GET', json, body, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (json !== undefined) {
    init.body = JSON.stringify(json);
    init.headers['Content-Type'] = 'application/json';
  } else if (body !== undefined) {
    init.body = body;
  }
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toast(message, kind = '', ms = 4200) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
  return el;
}

/**
 * Signal9-styled replacement for alert/confirm/prompt (the Mac app has no built-in prompt()).
 * With `input` set, resolves to the entered text or null; otherwise to true/false.
 */
export function ask({ title, message = '', input = null, ok = 'OK', cancel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <form class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <h3>${esc(title)}</h3>
        ${message ? `<p>${esc(message)}</p>` : ''}
        ${input !== null ? `<input type="text" value="${esc(input)}" autocomplete="off">` : ''}
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-cancel>${esc(cancel)}</button>
          <button type="submit" class="btn primary ${danger ? 'danger-fill' : ''}">${esc(ok)}</button>
        </div>
      </form>`;
    const form = backdrop.querySelector('form');
    const field = form.querySelector('input');
    const finish = (value) => {
      backdrop.remove();
      resolve(value);
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      finish(field ? field.value : true);
    };
    form.querySelector('[data-cancel]').onclick = () => finish(field ? null : false);
    backdrop.onclick = (e) => e.target === backdrop && finish(field ? null : false);
    // Keep Escape and shortcuts from reaching the screens underneath.
    form.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') finish(field ? null : false);
    });
    document.body.append(backdrop);
    (field || form.querySelector('[type=submit]')).focus();
    field?.select();
  });
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This image could not be opened.'));
    img.src = url;
  });
}

// Preferences that only matter on this computer (last paper, panel layout).
export const prefs = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`signal9.${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`signal9.${key}`, JSON.stringify(value));
    } catch { /* private mode: preferences just won't persist */ }
  },
};

export const icons = {
  star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg>',
  printer: '<svg viewBox="0 0 24 24"><path d="M7 9V4h10v5"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v6H7z"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  pencil: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>',
  dashed: '<svg viewBox="0 0 24 24"><path d="M5 12h14" stroke-dasharray="2 3"/></svg>',
};

export function stars(n) {
  return `<span class="stars">${[1, 2, 3, 4, 5].map((i) => icons.star.replace('<svg', `<svg class="${i <= n ? 'on' : ''}"`)).join('')}</span>`;
}

export function formatBytes(n) {
  if (!n) return '–';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function timeAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}
