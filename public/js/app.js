// Library screen: importing, organising and selecting artworks.

import { api, $, $$, esc, toast, ask, loadImage, prefs, icons, stars, formatBytes, timeAgo } from './util.js';
import { analyzeImage, describe, ANALYSIS_VERSION } from './analyze.js';
import { openStudio } from './studio.js';

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
};

// ---------- Startup ----------

async function init() {
  $('#sort').value = state.sort;
  $('#zoom').value = prefs.get('zoom', 220);
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
    $('#inkPanel').hidden = true;
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

function viewTitle() {
  const v = state.view;
  if (v.type === 'favorites') return 'Favourites';
  if (v.type === 'printed') return 'Printed';
  if (v.type === 'unprinted') return 'Not yet printed';
  if (v.type === 'collection') return state.collections.find((c) => c.id === v.id)?.name || 'Collection';
  if (v.type === 'tag') return `#${v.tag}`;
  return 'All artworks';
}

// ---------- Rendering ----------

function render() {
  renderNav();
  renderGrid();
  renderSelection();
  if (state.drawerId) renderDrawer();
}

function renderNav() {
  const count = (fn) => state.artworks.filter(fn).length;
  const items = [
    { type: 'all', label: 'All artworks', icon: icons.grid, n: state.artworks.length },
    { type: 'favorites', label: 'Favourites', icon: icons.heart, n: count((a) => a.favorite) },
    { type: 'printed', label: 'Printed', icon: icons.printer, n: count((a) => a.lastPrintedAt) },
    { type: 'unprinted', label: 'Not yet printed', icon: icons.clock, n: count((a) => !a.lastPrintedAt) },
  ];
  $('#nav').innerHTML = items.map((i) => `
    <button class="nav-item ${state.view.type === i.type ? 'on' : ''}" data-view="${i.type}" type="button">
      ${i.icon}<span>${i.label}</span><span class="n">${i.n}</span>
    </button>`).join('');

  $('#collections').innerHTML = state.collections.map((c) => `
    <div class="nav-item ${state.view.type === 'collection' && state.view.id === c.id ? 'on' : ''}" data-collection="${c.id}" role="button" tabindex="0">
      ${icons.folder}<span>${esc(c.name)}</span>
      <span class="n">${count((a) => a.collections.includes(c.id))}</span>
      <button class="icon-btn rename" data-rename="${c.id}" title="Rename or delete" type="button">${icons.pencil}</button>
    </div>`).join('') || '<div class="nav-empty">Group works into series, shows or themes.</div>';

  const tagCounts = new Map();
  for (const a of state.artworks) for (const t of a.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  $('#tagCloud').innerHTML = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)
    .map(([t]) => `<span class="chip ${state.view.type === 'tag' && state.view.tag === t ? 'on' : ''}" data-tag="${esc(t)}">#${esc(t)}</span>`).join('');

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
  $('#viewTitle').textContent = viewTitle();
  $('#viewCount').textContent = `${list.length} ${list.length === 1 ? 'artwork' : 'artworks'}`;
  $('#empty').hidden = state.artworks.length > 0;
  $('#grid').classList.toggle('selecting', state.selected.size > 0);
  $('#grid').innerHTML = list.map(cardHtml).join('') ||
    (state.artworks.length ? '<p class="nav-empty" style="grid-column:1/-1">Nothing in this view yet.</p>' : '');
  for (const a of list) if (a.thumb) state.seen.add(a.id);
}

function cardHtml(a) {
  const thumb = a.thumb
    ? `<img src="/files/thumbs/${a.thumb}" alt="" loading="lazy" draggable="false">`
    : `<div class="placeholder">${a.display ? 'Preparing preview…' : esc(a.note || 'No preview')}</div>`;
  return `
    <article class="card ${state.selected.has(a.id) ? 'selected' : ''} ${state.seen.has(a.id) ? '' : 'fresh'}" data-id="${a.id}" draggable="true">
      <div class="thumb">${thumb}</div>
      <div class="check" data-select title="Select">${icons.check}</div>
      <button class="fav ${a.favorite ? 'on' : ''}" data-fav title="Favourite" type="button">${icons.heart}</button>
      <div class="meta">
        <div class="title-row"><div class="title" title="${esc(a.title)}">${esc(a.title)}</div><span class="plate">${plateOf(a)}</span></div>
        <div class="sub">${stars(a.rating)}${a.width ? `<span>${a.width}×${a.height}</span>` : ''}
          ${a.printCount ? `<span class="printed" title="Last printed ${timeAgo(a.lastPrintedAt)}">${icons.printer.replace('<svg', '<svg style="width:12px;height:12px"')} ${a.printCount}</span>` : ''}</div>
      </div>
      ${state.processing.has(a.id) ? '<div class="progress"></div>' : ''}
    </article>`;
}

function renderSelection() {
  const n = state.selected.size;
  $('#selectionBar').hidden = n === 0;
  $('#selectionCount').textContent = `${n} selected`;
  $('#printSelected').textContent = n === 1 ? 'Print 1 artwork' : `Print ${n} artworks`;
}

function renderInk() {
  const ink = state.status?.ink;
  const panel = $('#inkPanel');
  if (!ink?.length) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  panel.innerHTML = `<h4>Ink levels</h4><div class="inks">${ink.map((m) => `
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
    <div class="hero">${src ? `<img src="${src}" alt="">` : '<span style="color:var(--faint)">No preview</span>'}
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
        <div class="check-list">${state.collections.map((c) => `<label><input type="checkbox" data-col="${c.id}" ${a.collections.includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('') || '<span class="nav-empty" style="padding:0">No collections yet. Create one in the sidebar.</span>'}</div></div>
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
  $('#dDelete', d).onclick = async () => {
    if (!(await ask({ title: `Remove “${a.title}”?`, message: 'The original file is moved to the library’s trash folder, not permanently deleted.', ok: 'Remove', danger: true }))) return;
    await api(`/api/artworks/${a.id}`, { method: 'DELETE' });
    state.artworks = state.artworks.filter((x) => x.id !== a.id);
    state.selected.delete(a.id);
    closeDrawer();
    render();
    toast('Moved to the library trash folder.');
  };
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
  const name = await ask({ title: 'New collection', message: 'A series, a show, a theme…', input: '', ok: 'Create' });
  if (!name?.trim()) return null;
  const col = await api('/api/collections', { method: 'POST', json: { name } });
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
  const name = await ask({ title: 'Rename collection', message: 'Leave the name empty to delete the collection.', input: col.name, ok: 'Save' });
  if (name === null) return;
  if (!name.trim()) {
    if (!(await ask({ title: `Delete “${col.name}”?`, message: 'The artworks stay in your library.', ok: 'Delete', danger: true }))) return;
    await api(`/api/collections/${id}`, { method: 'DELETE' });
    state.collections = state.collections.filter((c) => c.id !== id);
    for (const a of state.artworks) a.collections = a.collections.filter((c) => c !== id);
    if (state.view.id === id) state.view = { type: 'all' };
  } else {
    Object.assign(col, await api(`/api/collections/${id}`, { method: 'PATCH', json: { name } }));
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
  $('#grid').style.setProperty('--tile', `${$('#zoom').value}px`);
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
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  if (e.target.closest('[data-fav]')) {
    const a = state.artworks.find((x) => x.id === id);
    return updateArtwork(id, { favorite: !a.favorite });
  }
  if (e.target.closest('[data-select]') || e.metaKey || e.ctrlKey || e.shiftKey || state.selected.size) {
    return toggleSelect(id, e.shiftKey);
  }
  openDrawer(id);
});

$('#grid').addEventListener('dblclick', (e) => {
  const card = e.target.closest('.card');
  if (card) startPrint([card.dataset.id]);
});

// Drag cards onto a collection in the sidebar.
$('#grid').addEventListener('dragstart', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const ids = state.selected.has(card.dataset.id) ? [...state.selected] : [card.dataset.id];
  e.dataTransfer.setData('application/x-signal9', JSON.stringify(ids));
  e.dataTransfer.effectAllowed = 'copy';
});
$('#collections').addEventListener('dragover', (e) => {
  const item = e.target.closest('[data-collection]');
  if (item && e.dataTransfer.types.includes('application/x-signal9')) {
    e.preventDefault();
    $$('.drop-target').forEach((x) => x.classList.remove('drop-target'));
    item.classList.add('drop-target');
  }
});
$('#collections').addEventListener('dragleave', (e) => e.target.closest?.('[data-collection]')?.classList.remove('drop-target'));
$('#collections').addEventListener('drop', (e) => {
  const item = e.target.closest('[data-collection]');
  const raw = e.dataTransfer.getData('application/x-signal9');
  $$('.drop-target').forEach((x) => x.classList.remove('drop-target'));
  if (item && raw) {
    e.preventDefault();
    e.stopPropagation();
    addToCollection(item.dataset.collection, JSON.parse(raw));
  }
});

$('#nav').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  state.view = { type: b.dataset.view };
  render();
});
$('#collections').addEventListener('click', (e) => {
  const rename = e.target.closest('[data-rename]');
  if (rename) return editCollection(rename.dataset.rename);
  const item = e.target.closest('[data-collection]');
  if (item) {
    state.view = { type: 'collection', id: item.dataset.collection };
    render();
  }
});
$('#tagCloud').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-tag]');
  if (!chip) return;
  state.view = state.view.type === 'tag' && state.view.tag === chip.dataset.tag ? { type: 'all' } : { type: 'tag', tag: chip.dataset.tag };
  render();
});

$('#newCollection').onclick = () => newCollection();
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
  prefs.set('zoom', Number($('#zoom').value));
};
$('#selectAll').onclick = () => {
  visibleArtworks().forEach((a) => state.selected.add(a.id));
  renderGrid();
  renderSelection();
};
$('#clearSelection').onclick = () => {
  state.selected.clear();
  renderGrid();
  renderSelection();
};
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
    else if (state.selected.size) $('#clearSelection').click();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'a' && !typing && $('#studio').hidden) {
    e.preventDefault();
    $('#selectAll').click();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'p' && $('#studio').hidden) {
    e.preventDefault();
    printShortcut();
  }
});

// ⌘P: print the selection, or the artwork whose details are open.
function printShortcut() {
  const ids = state.selected.size ? [...state.selected] : state.drawerId ? [state.drawerId] : [];
  if (ids.length) startPrint(ids);
  else toast('Select one or more artworks to print.');
}

// ---------- Running inside the Mac app ----------

if (window.signal9App) {
  document.documentElement.classList.add('is-app', `on-${window.signal9App.platform}`);
  window.signal9App.onMenu(async (command) => {
    if (command === 'print' && $('#studio').hidden) printShortcut();
    if (command === 'refresh') {
      await reloadLibrary();
      render();
      toast('Artworks imported.', 'good');
      backfill();
    }
  });
}

init();
