// Finds artworks that are in the library more than once and keeps a single copy.
//
// Two kinds of match:
//  - identical files: the server fingerprints every original (SHA-256);
//  - the same picture saved again (re-exported, resized, another format): the
//    thumbnails are compared with a difference hash plus their colours, and
//    only near-perfect matches count.

import { api, esc, toast, loadImage, formatBytes } from './util.js';

const HASH_W = 9, HASH_H = 8; // difference hash: 8×8 = 64 bits
const MAX_BITS = 4;           // at most this many of the 64 bits may differ
const MAX_COLOUR = 9;         // mean colour difference (0–255) across an 8×8 grid
const MAX_ASPECT = 0.03;      // aspect ratios within 3%

const canvas = document.createElement('canvas');

async function fingerprint(art) {
  const img = await loadImage(art.thumb ? `/files/thumbs/${art.thumb}` : `/files/display/${art.display}`);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  canvas.width = HASH_W;
  canvas.height = HASH_H;
  ctx.drawImage(img, 0, 0, HASH_W, HASH_H);
  const px = ctx.getImageData(0, 0, HASH_W, HASH_H).data;
  const grey = (x, y) => {
    const k = (y * HASH_W + x) * 4;
    return px[k] * 0.299 + px[k + 1] * 0.587 + px[k + 2] * 0.114;
  };
  const bits = [];
  for (let y = 0; y < HASH_H; y++) for (let x = 0; x < HASH_W - 1; x++) bits.push(grey(x, y) > grey(x + 1, y) ? 1 : 0);

  canvas.width = 8;
  canvas.height = 8;
  ctx.drawImage(img, 0, 0, 8, 8);
  const colour = [...ctx.getImageData(0, 0, 8, 8).data].filter((_, i) => i % 4 !== 3);
  const w = art.width || img.naturalWidth, h = art.height || img.naturalHeight;
  return { bits, colour, aspect: w / h };
}

function looksSame(a, b) {
  if (Math.abs(a.aspect - b.aspect) / Math.max(a.aspect, b.aspect) > MAX_ASPECT) return false;
  let diff = 0;
  for (let i = 0; i < a.bits.length; i++) if (a.bits[i] !== b.bits[i] && ++diff > MAX_BITS) return false;
  let colour = 0;
  for (let i = 0; i < a.colour.length; i++) colour += Math.abs(a.colour[i] - b.colour[i]);
  return colour / a.colour.length <= MAX_COLOUR;
}

// The copy to keep: the largest image, then the largest file, then one whose
// name doesn't look like a copy, then the first imported. (Tags, ratings and so
// on are merged onto whichever is kept, so they don't decide it.)
const COPY_NAME = /\bcopy\b|\(\d+\)$|[ _-]\d+$/i;
const looksLikeCopy = (a) => [a.originalName?.replace(/\.\w+$/, ''), a.title].some((n) => n && COPY_NAME.test(n.trim())) ? 1 : 0;
function best(arts) {
  return [...arts].sort((a, b) =>
    (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0)
    || (b.size || 0) - (a.size || 0)
    || looksLikeCopy(a) - looksLikeCopy(b)
    || a.addedAt.localeCompare(b.addedAt))[0];
}

/** Groups the library's artworks into sets of duplicates. */
export async function findDuplicates(artworks, onProgress = () => {}) {
  const hashes = await api('/api/duplicates/hashes');
  const parent = new Map(artworks.map((a) => [a.id, a.id]));
  const root = (id) => {
    while (parent.get(id) !== id) id = parent.get(id);
    return id;
  };
  const join = (a, b) => parent.set(root(a), root(b));

  const byHash = new Map();
  for (const a of artworks) {
    const h = hashes[a.id];
    if (!h) continue;
    if (byHash.has(h)) join(a.id, byHash.get(h));
    else byHash.set(h, a.id);
  }

  const prints = [];
  let done = 0;
  for (const a of artworks) {
    if (a.thumb || a.display) {
      try {
        prints.push([a.id, await fingerprint(a)]);
      } catch { /* thumbnail missing: only identical files can match it */ }
    }
    onProgress(++done, artworks.length);
  }
  for (let i = 0; i < prints.length; i++) {
    for (let j = i + 1; j < prints.length; j++) {
      if (root(prints[i][0]) !== root(prints[j][0]) && looksSame(prints[i][1], prints[j][1])) join(prints[i][0], prints[j][0]);
    }
  }

  const groups = new Map();
  for (const a of artworks) {
    const r = root(a.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(a);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((copies) => ({
      copies,
      keep: best(copies).id,
      identical: copies.every((c) => hashes[c.id] && hashes[c.id] === hashes[copies[0].id]),
      on: true,
    }));
}

const dims = (a) => (a.width && a.height ? `${a.width} × ${a.height}` : 'Size unknown');

function copyHtml(a, keep) {
  return `<button type="button" class="dupe-copy ${a.id === keep ? 'keep' : ''}" data-id="${a.id}" title="${a.id === keep ? 'Keeping this copy' : 'Keep this copy instead'}">
    <span class="dupe-img">${a.thumb ? `<img src="/files/thumbs/${a.thumb}" alt="" draggable="false">` : ''}<b>${a.id === keep ? 'Keep' : 'Remove'}</b></span>
    <span class="dupe-meta">${esc(dims(a))} · ${formatBytes(a.size || 0)}<br><i>${esc(a.originalName || a.title)}</i></span>
  </button>`;
}

function groupHtml(g, i) {
  const keep = g.copies.find((c) => c.id === g.keep);
  return `<section class="dupe-group ${g.on ? '' : 'off'}" data-g="${i}">
    <label class="dupe-head"><input type="checkbox" ${g.on ? 'checked' : ''}>
      <span class="dupe-title">${esc(keep.title)}</span>
      <span class="dupe-kind">${g.identical ? 'Identical files' : 'Same picture, saved differently'} · ${g.copies.length} copies</span></label>
    <div class="dupe-copies">${g.copies.map((c) => copyHtml(c, g.keep)).join('')}</div>
  </section>`;
}

/**
 * Opens the duplicates dialog. `onChanged` is called after copies are removed
 * so the library can reload.
 */
export function openDuplicates(artworks, onChanged) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal dupes" role="dialog" aria-modal="true" aria-label="Duplicates">
      <h3>Duplicates</h3>
      <p class="dupes-sum">Looking through ${artworks.length} works…</p>
      <div class="dupes-list"></div>
      <p class="dupes-note" hidden>Tags, collections, ratings, notes and print history from the removed copies are kept on the copy that stays. Removed files go to the trash folder inside your Signal9 Library.</p>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-cancel>Cancel</button>
        <button type="button" class="btn outline danger" data-ok disabled>Remove copies</button>
      </div>
    </div>`;
  document.body.append(backdrop);
  const dlg = backdrop.querySelector('.modal');
  const sum = dlg.querySelector('.dupes-sum');
  const list = dlg.querySelector('.dupes-list');
  const okBtn = dlg.querySelector('[data-ok]');
  let groups = [];
  let busy = false;
  let closed = false;

  const close = () => {
    if (busy) return;
    closed = true;
    backdrop.remove();
  };
  dlg.querySelector('[data-cancel]').onclick = close;
  backdrop.onclick = (e) => e.target === backdrop && close();
  dlg.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
  });
  dlg.querySelector('[data-cancel]').focus();

  const extra = () => groups.filter((g) => g.on).reduce((n, g) => n + g.copies.length - 1, 0);
  const update = () => {
    const n = extra();
    okBtn.disabled = n === 0;
    okBtn.textContent = n === 1 ? 'Remove 1 copy' : `Remove ${n} copies`;
  };

  list.addEventListener('click', (e) => {
    const copy = e.target.closest('.dupe-copy');
    if (!copy || busy) return;
    const section = copy.closest('.dupe-group');
    const g = groups[section.dataset.g];
    g.keep = copy.dataset.id;
    section.outerHTML = groupHtml(g, section.dataset.g);
  });
  list.addEventListener('change', (e) => {
    const section = e.target.closest('.dupe-group');
    if (!section) return;
    groups[section.dataset.g].on = e.target.checked;
    section.classList.toggle('off', !e.target.checked);
    update();
  });

  okBtn.onclick = async () => {
    busy = true;
    okBtn.disabled = true;
    dlg.querySelector('[data-cancel]').disabled = true;
    let removed = 0, failed = 0;
    for (const g of groups.filter((x) => x.on)) {
      okBtn.textContent = `Removing… ${removed}`;
      const remove = g.copies.map((c) => c.id).filter((id) => id !== g.keep);
      try {
        await api('/api/duplicates/merge', { method: 'POST', json: { keep: g.keep, remove } });
        removed += remove.length;
      } catch (err) {
        failed++;
        toast(`${g.copies[0].title}: ${err.message}`, 'bad');
      }
    }
    busy = false;
    close();
    await onChanged();
    if (removed) toast(`Removed ${removed === 1 ? '1 duplicate copy' : `${removed} duplicate copies`}. One of each work is left.`, failed ? 'bad' : 'good');
  };

  findDuplicates(artworks, (done, total) => {
    if (!closed && done % 10 === 0) sum.textContent = `Looking through ${total} works… ${done}`;
  }).then((found) => {
    if (closed) return;
    groups = found;
    if (!groups.length) {
      sum.textContent = `No duplicates. Each of your ${artworks.length} works is in the library once.`;
      okBtn.hidden = true;
      dlg.querySelector('[data-cancel]').textContent = 'Close';
      return;
    }
    const extraCopies = extra();
    sum.textContent = `${groups.length === 1 ? '1 work is' : `${groups.length} works are`} in the library more than once. The copy marked Keep stays; click another copy to keep that one instead.`;
    list.innerHTML = groups.map(groupHtml).join('');
    dlg.querySelector('.dupes-note').hidden = false;
    update();
    okBtn.textContent = extraCopies === 1 ? 'Remove 1 copy' : `Remove ${extraCopies} copies`;
  }).catch((err) => {
    if (!closed) sum.textContent = `Couldn’t check for duplicates: ${err.message}`;
  });
}
