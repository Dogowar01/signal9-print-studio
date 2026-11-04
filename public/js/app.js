// Library screen: importing, organising and selecting artworks.

import { api, $, $$, esc, toast, ask, loadImage, prefs, icons, stars, formatBytes, timeAgo } from './util.js';
import { analyzeImage, describe, ANALYSIS_VERSION } from './analyze.js';
import { openStudio } from './studio.js';
import { showUpdate } from './update-ui.js';

const state = {
  artworks: [],
  collections: [],
  view: { type: 'all' },
  search: '',
  sort: prefs.get('sort', 'new'),
  selected: new Set(),
  drawerId: null,
  printers: [],
  printer: null,
  status: null,
  app: null,
  processing: new Set(),
  seen: new Set(), // cards already revealed, so re-renders don't replay the entrance
  selecting: false, // Select mode: clicking a work selects it instead of opening it
};

// ---------- Startup ----------

async function init() {
  $('#sort').value = state.sort;
  $('#zoom').value = prefs.get('rowHeight', 240);
  applyZoom();

  try {
    [state.app] = await Promise.all([api('/api/status'), reloadLibrary()]);
  } catch (err) {
    toast(`Could not reach the Signal9 server. Is it still running? (${err.message})`, 'bad', 10000);
    return;
  }
  $('#simBanner').hidden = !state.app.mock;
  render();
  backfill();
  await loadPrinters();
  setInterval(() => document.visibilityState === 'visible' && refreshPrinterStatus(), 10000);
}

async function reloadLibrary() {
  const lib = await api('/api/library');
  state.artworks = lib.artworks;
  state.collections = lib.collections;
}

async function loadPrinters() {
  try {
    state.printers = await api('/api/printers');
  } catch {
    state.printers = [];
  }
  const saved = prefs.get('printer', null);
  state.printer =
    state.printers.find((p) => p.name === saved) ||
    state.printers.find((p) => /8500/.test(p.name + p.info)) ||
    state.printers.find((p) => p.isDefault) ||
    state.printers[0] || null;
  await refreshPrinterStatus();
}

async function refreshPrinterStatus() {
  const chip = $('#printerChip');
  if (!state.printer) {
    chip.querySelector('.name').textContent = 'No printer found';
    chip.querySelector('.dot').className = 'dot stopped';
    $('#chipInks').innerHTML = '';
    return;
  }
  try {
    state.status = await api(`/api/printers/${encodeURIComponent(state.printer.name)}/status`);
  } catch {
    state.status = null;
  }
  const st = state.status?.state || state.printer.state;
  chip.querySelector('.name').textContent = state.printer.info;
  chip.querySelector('.dot').className = `dot ${st}`;
  chip.title = state.status?.message || st;
  renderInk();
  if (!$('#printerPopover').hidden) renderPrinterPopover();
}

export function getPrinterContext() {
  return { printers: state.printers, printer: state.printer, mock: state.app?.mock };
}

export function setPrinter(name) {
  state.printer = state.printers.find((p) => p.name === name) || state.printer;
  prefs.set('printer', state.printer?.name);
  refreshPrinterStatus();
}

// ---------- Filtering ----------

function visibleArtworks() {
  const q = state.search.trim().toLowerCase();
  let list = state.artworks.filter((a) => {
    const v = state.view;
    if (v.type === 'favorites' && !a.favorite) return false;
    if (v.type === 'printed' && !a.lastPrintedAt) return false;
    if (v.type === 'unprinted' && a.lastPrintedAt) return false;
    if (v.type === 'collection' && !a.collections.includes(v.id)) return false;
    if (v.type === 'tag' && !a.tags.includes(v.tag)) return false;
    if (q && !`${a.title} ${a.tags.join(' ')} ${a.notes} ${a.originalName}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const by = {
    new: (a, b) => b.addedAt.localeCompare(a.addedAt),
    old: (a, b) => a.addedAt.localeCompare(b.addedAt),
    title: (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }),
    rating: (a, b) => b.rating - a.rating || b.addedAt.localeCompare(a.addedAt),
    printed: (a, b) => (b.lastPrintedAt || '').localeCompare(a.lastPrintedAt || ''),
  }[state.sort];
  return list.sort(by);
}

// Heading for the current view, set like the website: an upright word, then italics.
function viewHeading() {
  const v = state.view;
  const col = v.type === 'collection' ? state.collections.find((c) => c.id === v.id) : null;
  if (col) {
    const [first, ...rest] = col.name.split(' ');
    const num = String(state.collections.indexOf(col) + 1).padStart(2, '0');
    return { eyebrow: `Collection ${num}`, up: first, em: rest.join(' '), lede: col.description, collection: col };
  }
  return {
    all: { eyebrow: 'Signal9 Studio', up: 'All', em: 'Works' },
    favorites: { eyebrow: 'Signal9 Studio', up: 'Favourite', em: 'Works' },
    printed: { eyebrow: 'In print', up: 'Printed', em: 'Works' },
    unprinted: { eyebrow: 'Awaiting paper', up: 'Not yet', em: 'Printed' },
    tag: { eyebrow: 'Tagged', up: `#${v.tag}`, em: '' },
  }[v.type];
}

// ---------- Rendering ----------

function render() {
  renderFilters();
  renderGrid();
  renderSelection();
  if (state.drawerId) renderDrawer();
}

function renderFilters() {
  const v = state.view;
  const link = (attrs, label, on, n) =>
    `<button class="filter ${on ? 'on' : ''}" ${attrs} type="button">${esc(label)}${n ? `<sup>${n}</sup>` : ''}</button>`;
  const favs = state.artworks.filter((a) => a.favorite).length;
  $('#filters').innerHTML = `
    <span class="filter-label">View →</span>
    ${link('data-view="all"', 'All', v.type === 'all')}
    ${link('data-view="favorites"', 'Favourites', v.type === 'favorites', favs)}
    ${link('data-view="printed"', 'Printed', v.type === 'printed')}
    ${link('data-view="unprinted"', 'Not yet printed', v.type === 'unprinted')}
    <span class="filter-label gap">Collections →</span>
    ${state.collections.map((c) => link(`data-collection="${c.id}"`, c.name, v.type === 'collection' && v.id === c.id)).join('')}
    <button class="filter add" id="newCollection" type="button" title="New collection">+ New</button>`;

  const tagCounts = new Map();
  for (const a of state.artworks) for (const t of a.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  $('#tagRow').hidden = !tags.length;
  $('#tagRow').innerHTML = '<span class="filter-label">Tags →</span>' +
    tags.map(([t]) => `<button class="tag ${v.type === 'tag' && v.tag === t ? 'on' : ''}" data-tag="${esc(t)}" type="button">#${esc(t)}</button>`).join('');

  const sel = $('#addToCollection');
  sel.innerHTML = '<option value="">Add to collection…</option>' +
    state.collections.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('') +
    '<option value="__new">New collection…</option>';
}

// Catalogue plate numbers, in the order works entered the library.
let plates = { key: '', map: new Map() };
function plateOf(a) {
  const key = state.artworks.map((x) => x.id).join();
  if (plates.key !== key) {
    const order = [...state.artworks].sort((x, y) => x.addedAt.localeCompare(y.addedAt));
    plates = { key, map: new Map(order.map((x, i) => [x.id, `No. ${String(i + 1).padStart(2, '0')}`])) };
  }
  return plates.map.get(a.id) || '';
}

function renderGrid() {
  const list = visibleArtworks();
  const h = viewHeading();
  $('#viewEyebrow').textContent = h.eyebrow;
  $('#viewTitle').innerHTML = `<span class="up">${esc(h.up)}</span>${h.em ? ` <em>${esc(h.em)}</em>` : ''}`;
  $('#viewLede').hidden = !h.lede;
  $('#viewLede').textContent = h.lede || '';
  $('#heroActions').innerHTML = h.collection
    ? `<button class="link-btn" data-edit-collection="${h.collection.id}" type="button">Edit collection</button>`
    : '';
  $('#viewCount').textContent = String(list.length).padStart(2, '0');
  $('#viewCountLabel').textContent = list.length === 1 ? 'Work' : 'Works';
  $('#empty').hidden = state.artworks.length > 0;

  const grid = $('#grid');
  grid.classList.toggle('selecting', isSelecting());
  let order = 0;
  const rows = (arts) => `<div class="rows">${arts.map((a) => cardHtml(a, order++)).join('')}</div>`;
  const works = (n) => `${n} ${n === 1 ? 'work' : 'works'}`;

  // The full library reads like the website's All Works page: one chapter per collection.
  if (state.view.type === 'all' && !state.search.trim() && state.collections.length) {
    const sections = state.collections
      .map((c, i) => ({ c, i, arts: list.filter((a) => a.collections.includes(c.id)) }))
      .filter((x) => x.arts.length);
    const loose = list.filter((a) => !a.collections.length);
    grid.innerHTML = sections.map(({ c, i, arts }) => `
      <section class="chapter" data-num="${String(i + 1).padStart(2, '0')}">
        <header class="chapter-head">
          <div><h2><button class="chapter-link" data-collection="${c.id}" type="button">${esc(c.name)}</button></h2>
            ${c.description ? `<p>${esc(c.description)}</p>` : ''}</div>
          <span class="chapter-count">${works(arts.length)}</span>
        </header>
        ${rows(arts)}
      </section>`).join('') +
      (loose.length ? `
      <section class="chapter loose">
        <header class="chapter-head"><div><h2>Unsorted</h2><p>Works not yet placed in a collection.</p></div>
          <span class="chapter-count">${works(loose.length)}</span></header>
        ${rows(loose)}
      </section>` : '');
  } else {
    grid.innerHTML = list.length ? rows(list) : (state.artworks.length ? '<p class="quiet-note">Nothing in this view yet.</p>' : '');
  }
  for (const a of list) if (a.thumb) state.seen.add(a.id);
}

function cardHtml(a, index) {
  const ar = a.width && a.height ? Math.min(2.4, Math.max(0.42, a.width / a.height)) : 1;
  const fresh = !state.seen.has(a.id) && a.thumb;
  const img = a.thumb
    ? `<img src="/files/thumbs/${a.thumb}" alt="" loading="lazy" draggable="false">`
    : `<div class="placeholder">${a.display ? 'Preparing…' : esc(a.note || 'No preview')}</div>`;
  return `
    <article class="card ${state.selected.has(a.id) ? 'selected' : ''} ${fresh ? 'fresh' : ''}" data-id="${a.id}" draggable="true"
      style="--ar:${ar.toFixed(3)};--d:${Math.min(index, 14) * 70}ms">
      <div class="frame">
        ${img}
        <div class="veil"></div>
        <div class="caption">
          <span class="plate">${plateOf(a)}</span>
          <span class="title">${esc(a.title)}</span>
          <span class="meta">${stars(a.rating)}${a.width ? `<span>${a.width} × ${a.height}</span>` : ''}${a.printCount ? `<span>Printed ${a.printCount}×</span>` : ''}</span>
        </div>
        <div class="check" data-select title="Select">${icons.check}</div>
        <button class="fav ${a.favorite ? 'on' : ''}" data-fav title="Favourite" type="button">${icons.heart}</button>
        ${state.processing.has(a.id) ? '<div class="progress"></div>' : ''}
      </div>
    </article>`;
}

const isSelecting = () => state.selecting || state.selected.size > 0;

function renderSelection() {
  const n = state.selected.size;
  $('#selectionBar').hidden = !isSelecting();
  $('#selectionCount').textContent = n ? `${n} selected` : 'Choose works';
  $('#printSelected').textContent = n === 1 ? 'Print 1 work' : `Print ${n || ''} works`.replace('  ', ' ');
  $('#printSelected').disabled = n === 0;
  $('#removeSelected').disabled = n === 0;
  $('#addToCollection').disabled = n === 0;
  $('#selectMode').textContent = isSelecting() ? 'Done' : 'Select';
}

function exitSelecting() {
  state.selecting = false;
  state.selected.clear();
  renderGrid();
  renderSelection();
}

// Removes works from the library. Originals go to the library's trash folder.
async function removeArtworks(ids) {
  const arts = ids.map((id) => state.artworks.find((a) => a.id === id)).filter(Boolean);
  if (!arts.length) return;
  const one = arts.length === 1;
  const ok = await ask({
    title: one ? `Remove “${arts[0].title}”?` : `Remove ${arts.length} works?`,
    message: `${one ? 'The original file is' : 'The original files are'} moved to the trash folder inside your Signal9 Library, not permanently deleted.`,
    ok: one ? 'Remove' : `Remove ${arts.length}`,
    danger: true,
  });
  if (!ok) return;
  let removed = 0;
  for (const a of arts) {
    try {
      await api(`/api/artworks/${a.id}`, { method: 'DELETE' });
      state.artworks = state.artworks.filter((x) => x.id !== a.id);
      state.selected.delete(a.id);
      removed++;
    } catch (err) {
      toast(`${a.title}: ${err.message}`, 'bad');
    }
  }
  if (state.drawerId && !state.artworks.some((a) => a.id === state.drawerId)) closeDrawer();
  if (!state.selected.size) state.selecting = false;
  render();
  if (removed) toast(`Moved ${removed === 1 ? '1 work' : `${removed} works`} to the library trash folder.`);
}

// ⌘⌫ / Delete: remove the selection, or the work whose details are open.
function removeShortcut() {
  const ids = state.selected.size ? [...state.selected] : state.drawerId ? [state.drawerId] : [];
  if (ids.length) removeArtworks(ids);
  else toast('Select works first: choose Select, then click the works to remove.');
}

// Ink levels: tiny bars in the printer chip, full bars in the printer popover.
function renderInk() {
  const ink = state.status?.ink || [];
  $('#chipInks').innerHTML = ink.map((m) =>
    `<i title="${esc(m.name)}: ${m.level}%" style="--lvl:${Math.max(4, m.level)}%;--ink:${esc(m.color)}"></i>`).join('');
}

function inkHtml() {
  const ink = state.status?.ink;
  if (!ink?.length) return '';
  return `<h4>Ink levels</h4><div class="inks">${ink.map((m) => `
    <div class="ink ${m.level <= 15 ? 'low' : ''}" title="${esc(m.name)}: ${m.level}%">
      <div class="tank"><div class="fill" style="height:${Math.max(2, m.level)}%;background:${esc(m.color)}"></div></div>
      <span class="lbl">${esc(shortInk(m.name))}</span>
    </div>`).join('')}</div>`;
}

function shortInk(name) {
  const n = name.toLowerCase();
  if (n.includes('photo')) return 'PB';
  if (n.includes('black')) return 'K';
  if (n.includes('gr')) return 'GY';
  if (n.includes('cyan')) return 'C';
  if (n.includes('magenta')) return 'M';
  if (n.includes('yellow')) return 'Y';
  return name.slice(0, 2);
}

function renderPrinterPopover() {
  const pop = $('#printerPopover');
  const st = state.status;
  const jobs = [...(st?.jobs || []), ...(st?.completed || [])];
  pop.innerHTML = `
    <h4>Printer</h4>
    <select id="popPrinter">${state.printers.map((p) => `<option value="${esc(p.name)}" ${p.name === state.printer?.name ? 'selected' : ''}>${esc(p.info)}</option>`).join('') || '<option>No printers found</option>'}</select>
    ${state.printers.length ? '' : '<p class="msg" style="margin:0">Add your ET-8500 in <b>System Settings → Printers &amp; Scanners</b>, then reload this page.</p>'}
    ${st?.message ? `<div class="msg">${esc(st.message)}</div>` : ''}
    ${inkHtml()}
    <h4>Print jobs</h4>
    <div>${jobs.length ? jobs.map((j) => `
      <div class="job"><span class="t" title="${esc(j.title || j.id)}">${esc(j.title || j.id)}</span><span class="s">${esc(j.state)}</span>
      ${j.state === 'pending' ? `<button class="btn ghost danger" data-cancel="${esc(j.id)}" type="button">Cancel</button>` : ''}</div>`).join('')
      : '<div class="empty-note">No recent jobs.</div>'}</div>`;
  $('#popPrinter', pop).onchange = (e) => setPrinter(e.target.value);
}

// ---------- Drawer ----------

function openDrawer(id) {
  state.drawerId = id;
  renderDrawer();
}

function closeDrawer() {
  state.drawerId = null;
  $('#drawer').hidden = true;
}

function renderDrawer() {
  const a = state.artworks.find((x) => x.id === state.drawerId);
  const d = $('#drawer');
  if (!a) return closeDrawer();
  d.hidden = false;
  const src = a.display ? `/files/display/${a.display}` : a.thumb ? `/files/thumbs/${a.thumb}` : '';
  const traits = describe(a.analysis);
  d.innerHTML = `
    <div class="art">${src ? `<img src="${src}" alt="">` : '<span style="color:var(--faint)">No preview</span>'}
      <button class="icon-btn" data-remove title="Remove from library (⌘⌫)" type="button">${icons.trash}</button>
      <button class="icon-btn" data-close title="Close" type="button">${icons.close}</button></div>
    <div class="body">
      <div class="plate-line">Signal9 Studio · ${plateOf(a)}</div>
      <input class="title-input" id="dTitle" type="text" value="${esc(a.title)}" aria-label="Title">
      ${a.note ? `<div class="note-warn">${esc(a.note)}</div>` : ''}
      <div class="row">
        <div class="rating-input" id="dRating">${[1, 2, 3, 4, 5].map((i) => `<button type="button" data-r="${i}" class="${i <= a.rating ? 'on' : ''}" title="${i} star${i > 1 ? 's' : ''}">${icons.star}</button>`).join('')}</div>
        <div class="spacer"></div>
        <button class="btn ghost fav-toggle ${a.favorite ? 'on' : ''}" id="dFav" type="button">${icons.heart} ${a.favorite ? 'Favourite' : 'Add to favourites'}</button>
      </div>
      <button class="btn primary big" id="dPrint" type="button" ${a.display ? '' : 'disabled'}>${icons.printer} Print this artwork</button>
      ${traits.length ? `<div class="field"><span class="label">Image character</span><div class="badges">${traits.map((t) => `<span class="badge">${esc(t)}</span>`).join('')}</div></div>` : ''}
      <div class="field"><label for="dTagInput">Tags</label>
        <div class="tags-input">${a.tags.map((t) => `<span class="chip">#${esc(t)}<button type="button" data-untag="${esc(t)}" title="Remove">×</button></span>`).join('')}
          <input id="dTagInput" type="text" placeholder="Add tag, press Enter"></div></div>
      <div class="field"><span class="label">Collections</span>
        <div class="check-list">${state.collections.map((c) => `<label><input type="checkbox" data-col="${c.id}" ${a.collections.includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('') || '<span class="quiet-note">No collections yet. Use <b>+ New</b> in the collection links.</span>'}</div></div>
      <div class="field"><label for="dNotes">Notes</label><textarea id="dNotes" placeholder="Edition, medium, where it’s shown…">${esc(a.notes)}</textarea></div>
      <div class="field"><span class="label">Details</span>
        <dl class="facts">
          <dt>File</dt><dd>${esc(a.originalName)}</dd>
          <dt>Pixels</dt><dd>${a.width ? `${a.width} × ${a.height}` : '–'}</dd>
          <dt>Best size</dt><dd>${a.width ? bestSize(a) : '–'}</dd>
          <dt>File size</dt><dd>${formatBytes(a.size)}</dd>
          <dt>Added</dt><dd>${new Date(a.addedAt).toLocaleString()}</dd>
          <dt>Printed</dt><dd>${a.printCount ? `${a.printCount}×, last ${timeAgo(a.lastPrintedAt)}` : 'Not yet'}</dd>
        </dl></div>
      <button class="btn ghost danger" id="dDelete" type="button">${icons.trash} Remove from library</button>
    </div>`;

  const patch = (p) => updateArtwork(a.id, p);
  $('[data-close]', d).onclick = closeDrawer;
  $('[data-remove]', d).onclick = () => removeArtworks([a.id]);
  $('#dTitle', d).onchange = (e) => patch({ title: e.target.value });
  $$('#dRating button', d).forEach((b) => (b.onclick = () => patch({ rating: Number(b.dataset.r) === a.rating ? 0 : Number(b.dataset.r) })));
  $('#dFav', d).onclick = () => patch({ favorite: !a.favorite });
  $('#dPrint', d).onclick = () => startPrint([a.id]);
  $('#dNotes', d).onchange = (e) => patch({ notes: e.target.value });
  $('#dTagInput', d).onkeydown = (e) => {
    if ((e.key === 'Enter' || e.key === ',') && e.target.value.trim()) {
      e.preventDefault();
      const added = e.target.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
      patch({ tags: [...a.tags, ...added] }).then(() => $('#dTagInput')?.focus());
    }
  };
  $$('[data-untag]', d).forEach((b) => (b.onclick = () => patch({ tags: a.tags.filter((t) => t !== b.dataset.untag) })));
  $$('[data-col]', d).forEach((c) => (c.onchange = () => patch({
    collections: c.checked ? [...a.collections, c.dataset.col] : a.collections.filter((x) => x !== c.dataset.col),
  })));
  $('#dDelete', d).onclick = () => removeArtworks([a.id]);
}

// Largest size this artwork prints sharply at (240 ppi), and which standard paper that covers.
function bestSize(a) {
  const longIn = Math.max(a.width, a.height) / 240;
  const shortIn = Math.min(a.width, a.height) / 240;
  const sizes = [['A4 / Letter', 11.0, 8.0], ['8 × 10 in', 10, 8], ['A5 / 5 × 7 in', 7, 5], ['10 × 15 cm', 6, 4]];
  const fit = sizes.find(([, l, s]) => longIn >= l && shortIn >= s);
  const cm = (i) => (i * 2.54).toFixed(0);
  return `${cm(shortIn)} × ${cm(longIn)} cm at 240 ppi${fit ? ` (sharp up to ${fit[0]})` : ' (best for small prints)'}`;
}

async function updateArtwork(id, patch) {
  const updated = await api(`/api/artworks/${id}`, { method: 'PATCH', json: patch });
  const i = state.artworks.findIndex((a) => a.id === id);
  if (i !== -1) state.artworks[i] = updated;
  render();
  return updated;
}

// ---------- Import ----------

async function importFiles(files) {
  files = [...files].filter((f) => f.type.startsWith('image/') || /\.(tiff?|heic|heif|psd|dng)$/i.test(f.name));
  if (!files.length) return;
  const note = toast(`Importing ${files.length} artwork${files.length > 1 ? 's' : ''}…`, '', 600000);
  let done = 0, failed = 0;
  const queue = [...files];
  const worker = async () => {
    while (queue.length) {
      const file = queue.shift();
      try {
        const art = await api('/api/artworks', {
          method: 'POST',
          body: file,
          headers: { 'X-Filename': encodeURIComponent(file.name), 'Content-Type': file.type || 'application/octet-stream' },
        });
        state.artworks.unshift(art);
        render();
        await processArtwork(art);
      } catch (err) {
        failed++;
        toast(`${file.name}: ${err.message}`, 'bad');
      }
      done++;
      note.textContent = `Importing… ${done} of ${files.length}`;
    }
  };
  await Promise.all([worker(), worker()]);
  note.remove();
  toast(`Imported ${done - failed} artwork${done - failed === 1 ? '' : 's'}.`, failed ? 'bad' : 'good');
}

// Builds the thumbnail and the colour/tone analysis for an artwork.
async function processArtwork(art) {
  if (!art.display || state.processing.has(art.id)) return;
  state.processing.add(art.id);
  renderGrid();
  try {
    const img = await loadImage(`/files/display/${art.display}`);
    const w = img.naturalWidth, h = img.naturalHeight;
    const k = Math.min(1, 512 / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86));
    await api(`/api/artworks/${art.id}/thumb`, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
    const analysis = analyzeImage(img, w, h);
    const updated = await api(`/api/artworks/${art.id}`, { method: 'PATCH', json: { width: w, height: h, analysis } });
    const i = state.artworks.findIndex((a) => a.id === art.id);
    if (i !== -1) state.artworks[i] = updated;
  } catch (err) {
    toast(`${art.title}: ${err.message}`, 'bad');
  } finally {
    state.processing.delete(art.id);
    render();
  }
}

// Fills in thumbnails/analysis for anything imported before they finished.
async function backfill() {
  for (const a of state.artworks) {
    if (a.display && (!a.thumb || !a.analysis || a.analysis.v !== ANALYSIS_VERSION)) await processArtwork(a);
  }
}

// ---------- Collections ----------

async function newCollection(addIds = []) {
  const values = await ask({
    title: 'New collection',
    fields: [
      { key: 'name', label: 'Name', placeholder: 'Fractures' },
      { key: 'description', label: 'Description (optional)', placeholder: 'Portraits dissolved into fragments of memory…', multiline: true },
    ],
    ok: 'Create',
  });
  if (!values?.name.trim()) return null;
  const col = await api('/api/collections', { method: 'POST', json: values });
  state.collections.push(col);
  if (addIds.length) await addToCollection(col.id, addIds);
  render();
  return col;
}

async function addToCollection(colId, ids) {
  for (const id of ids) {
    const a = state.artworks.find((x) => x.id === id);
    if (a && !a.collections.includes(colId)) await updateArtwork(id, { collections: [...a.collections, colId] });
  }
  const name = state.collections.find((c) => c.id === colId)?.name;
  toast(`Added ${ids.length} to “${name}”.`, 'good');
}

async function editCollection(id) {
  const col = state.collections.find((c) => c.id === id);
  const values = await ask({
    title: 'Edit collection',
    message: 'Leave the name empty to delete the collection. Its works stay in your library.',
    fields: [
      { key: 'name', label: 'Name', value: col.name },
      { key: 'description', label: 'Description', value: col.description || '', multiline: true },
    ],
    ok: 'Save',
  });
  if (!values) return;
  if (!values.name.trim()) {
    if (!(await ask({ title: `Delete “${col.name}”?`, message: 'The artworks stay in your library.', ok: 'Delete', danger: true }))) return;
    await api(`/api/collections/${id}`, { method: 'DELETE' });
    state.collections = state.collections.filter((c) => c.id !== id);
    for (const a of state.artworks) a.collections = a.collections.filter((c) => c !== id);
    if (state.view.id === id) state.view = { type: 'all' };
  } else {
    Object.assign(col, await api(`/api/collections/${id}`, { method: 'PATCH', json: values }));
  }
  render();
}

// ---------- Printing ----------

function startPrint(ids) {
  const arts = ids.map((id) => state.artworks.find((a) => a.id === id)).filter((a) => a?.display);
  if (!arts.length) return toast('Those artworks can’t be printed until they have a preview.', 'bad');
  closeDrawer();
  openStudio(arts, {
    ...getPrinterContext(),
    setPrinter,
    onPrinted: async () => {
      await reloadLibrary();
      render();
      refreshPrinterStatus();
    },
    onAnalysis: (id, analysis) => updateArtwork(id, { analysis }),
  });
}

// ---------- Events ----------

function applyZoom() {
  $('#grid').style.setProperty('--row', `${$('#zoom').value}px`);
}

let lastClicked = null;
function toggleSelect(id, range) {
  if (range && lastClicked) {
    const list = visibleArtworks().map((a) => a.id);
    const [a, b] = [list.indexOf(lastClicked), list.indexOf(id)].sort((x, y) => x - y);
    if (a !== -1 && b !== -1) list.slice(a, b + 1).forEach((x) => state.selected.add(x));
  } else if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  lastClicked = id;
  renderGrid();
  renderSelection();
}

$('#grid').addEventListener('click', (e) => {
  const chapterLink = e.target.closest('.chapter-link');
  if (chapterLink) return showView({ type: 'collection', id: chapterLink.dataset.collection });
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  if (e.target.closest('[data-fav]')) {
    const a = state.artworks.find((x) => x.id === id);
    return updateArtwork(id, { favorite: !a.favorite });
  }
  if (e.target.closest('[data-select]') || e.metaKey || e.ctrlKey || e.shiftKey || isSelecting()) {
    return toggleSelect(id, e.shiftKey);
  }
  openDrawer(id);
});

$('#grid').addEventListener('dblclick', (e) => {
  const card = e.target.closest('.card');
  if (card) startPrint([card.dataset.id]);
});

// Drag cards onto a collection link to add them to it.
$('#grid').addEventListener('dragstart', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const ids = state.selected.has(card.dataset.id) ? [...state.selected] : [card.dataset.id];
  e.dataTransfer.setData('application/x-signal9', JSON.stringify(ids));
  e.dataTransfer.effectAllowed = 'copy';
});
$('#filters').addEventListener('dragover', (e) => {
  const item = e.target.closest('[data-collection]');
  if (item && e.dataTransfer.types.includes('application/x-signal9')) {
    e.preventDefault();
    $$('.drop-target').forEach((x) => x.classList.remove('drop-target'));
    item.classList.add('drop-target');
  }
});
$('#filters').addEventListener('dragleave', (e) => e.target.closest?.('[data-collection]')?.classList.remove('drop-target'));
$('#filters').addEventListener('drop', (e) => {
  const item = e.target.closest('[data-collection]');
  const raw = e.dataTransfer.getData('application/x-signal9');
  $$('.drop-target').forEach((x) => x.classList.remove('drop-target'));
  if (item && raw) {
    e.preventDefault();
    e.stopPropagation();
    addToCollection(item.dataset.collection, JSON.parse(raw));
  }
});

function showView(view) {
  state.view = view;
  render();
  $('#main').scrollTo({ top: 0, behavior: 'smooth' });
}

$('#filters').addEventListener('click', (e) => {
  if (e.target.closest('#newCollection')) return newCollection();
  const viewBtn = e.target.closest('[data-view]');
  if (viewBtn) return showView({ type: viewBtn.dataset.view });
  const colBtn = e.target.closest('[data-collection]');
  if (colBtn) showView({ type: 'collection', id: colBtn.dataset.collection });
});
$('#heroActions').addEventListener('click', (e) => {
  const b = e.target.closest('[data-edit-collection]');
  if (b) editCollection(b.dataset.editCollection);
});
$('#tagRow').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-tag]');
  if (!chip) return;
  showView(state.view.type === 'tag' && state.view.tag === chip.dataset.tag ? { type: 'all' } : { type: 'tag', tag: chip.dataset.tag });
});

$('#importBtn').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = (e) => {
  importFiles(e.target.files);
  e.target.value = '';
};
$('#search').oninput = (e) => {
  state.search = e.target.value;
  renderGrid();
};
$('#sort').onchange = (e) => {
  state.sort = e.target.value;
  prefs.set('sort', state.sort);
  renderGrid();
};
$('#zoom').oninput = () => {
  applyZoom();
  prefs.set('rowHeight', Number($('#zoom').value));
};
$('#selectAll').onclick = () => {
  visibleArtworks().forEach((a) => state.selected.add(a.id));
  renderGrid();
  renderSelection();
};
$('#clearSelection').onclick = exitSelecting;
$('#selectMode').onclick = () => {
  if (isSelecting()) return exitSelecting();
  state.selecting = true;
  closeDrawer();
  renderGrid();
  renderSelection();
};
$('#removeSelected').onclick = () => removeArtworks([...state.selected]);
$('#printSelected').onclick = () => startPrint([...state.selected]);
$('#addToCollection').onchange = async (e) => {
  const v = e.target.value;
  e.target.value = '';
  if (v === '__new') await newCollection([...state.selected]);
  else if (v) await addToCollection(v, [...state.selected]);
};

$('#printerChip').onclick = (e) => {
  e.stopPropagation();
  const pop = $('#printerPopover');
  pop.hidden = !pop.hidden;
  if (!pop.hidden) {
    renderPrinterPopover();
    refreshPrinterStatus();
  }
};
$('#printerPopover').addEventListener('click', async (e) => {
  e.stopPropagation();
  const b = e.target.closest('[data-cancel]');
  if (!b) return;
  try {
    await api(`/api/jobs/${encodeURIComponent(b.dataset.cancel)}/cancel`, { method: 'POST' });
    toast('Print job cancelled.');
    refreshPrinterStatus();
  } catch (err) {
    toast(err.message, 'bad');
  }
});
document.addEventListener('click', () => ($('#printerPopover').hidden = true));

// Drag files from Finder anywhere onto the window.
let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer?.types.includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e) || !$('#studio').hidden) return;
  dragDepth++;
  $('#dropOverlay').hidden = false;
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) {
    dragDepth = 0;
    $('#dropOverlay').hidden = true;
  }
});
window.addEventListener('dragover', (e) => hasFiles(e) && e.preventDefault());
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('#dropOverlay').hidden = true;
  if ($('#studio').hidden) importFiles(e.dataTransfer.files);
});

document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (e.key === 'Escape' && $('#studio').hidden) {
    if (state.drawerId) closeDrawer();
    else if (isSelecting()) exitSelecting();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'a' && !typing && $('#studio').hidden) {
    e.preventDefault();
    selectAllWorks();
  }
  if ((e.key === 'Delete' || (e.key === 'Backspace' && (e.metaKey || e.ctrlKey))) && !typing && $('#studio').hidden) {
    e.preventDefault();
    removeShortcut();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'p' && $('#studio').hidden) {
    e.preventDefault();
    printShortcut();
  }
});

function selectAllWorks() {
  state.selecting = true;
  $('#selectAll').click();
}

// ⌘P: print the selection, or the artwork whose details are open.
function printShortcut() {
  const ids = state.selected.size ? [...state.selected] : state.drawerId ? [state.drawerId] : [];
  if (ids.length) startPrint(ids);
  else toast('Select one or more artworks to print.');
}

// ---------- Running inside the Mac app ----------

if (window.signal9App) {
  document.documentElement.classList.add('is-app', `on-${window.signal9App.platform}`);
  window.signal9App.onUpdate((info) => showUpdate(info, () => window.signal9App.installUpdate()));
  window.signal9App.onMenu(async (command) => {
    const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName);
    if (command === 'print' && $('#studio').hidden) printShortcut();
    if (command === 'remove' && $('#studio').hidden && !typing) removeShortcut();
    // ⌘A selects text while typing, otherwise every work in view.
    if (command === 'selectAll') {
      if (typing || !$('#studio').hidden) document.execCommand('selectAll');
      else selectAllWorks();
    }
    if (command === 'refresh') {
      await reloadLibrary();
      render();
      toast('Artworks imported.', 'good');
      backfill();
    }
  });
}

init();
