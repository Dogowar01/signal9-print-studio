// Print studio: paper, size, layout, smart corrections and every driver setting,
// with a live preview of the exact page that will be printed.

import { api, $, $$, esc, toast, loadImage, prefs, icons } from './util.js';
import { PAPERS, paperById, driverSettings } from './papers.js';
import { analyzeImage, recommend, ANALYSIS_VERSION } from './analyze.js';
import { computeLayout, renderPreview, renderForPrint, mm } from './render.js';

const SLIDERS = [
  { key: 'brightness', label: 'Brightness', min: -0.2, max: 0.25, step: 0.01, hint: 'Prints look darker than a backlit screen.' },
  { key: 'shadowLift', label: 'Shadow detail', min: 0, max: 0.25, step: 0.01, hint: 'Opens up dark areas without greying pure black.' },
  { key: 'contrast', label: 'Contrast', min: -0.2, max: 0.25, step: 0.01 },
  { key: 'saturation', label: 'Saturation', min: -0.4, max: 0.4, step: 0.01, hint: 'Boosts muted colours more than vivid ones.' },
  { key: 'sharpen', label: 'Sharpening', min: 0, max: 1, step: 0.02, hint: 'Compensates for ink spreading into the paper.' },
];

let S = null; // studio state, rebuilt each time the studio opens

export async function openStudio(artworks, ctx) {
  const saved = prefs.get('studio', {});
  S = {
    ctx,
    items: artworks.map((art) => ({ art, img: null, analysis: art.analysis, adj: null, status: null })),
    index: 0,
    printer: ctx.printer?.name || null,
    caps: null,
    capsError: null,
    paperId: artworks[0].paperId || saved.paperId || 'premium-glossy',
    sizeBase: saved.sizeBase || 'A4',
    borderless: saved.borderless ?? false,
    layout: { fit: 'fit', marginMm: 0, customWidthMm: 150, autoRotate: true, ...saved.layout },
    copies: 1,
    overrides: {},
    mode: 'adjusted',
    corrections: true,
    printing: false,
    previewToken: 0,
  };
  $('#studio').hidden = false;
  document.body.style.overflow = 'hidden';
  renderFilmstrip();
  renderPanel();
  await loadCaps();
  await selectItem(0);
}

function closeStudio() {
  if (S?.printing && !confirm('Printing is still in progress. Close anyway? Jobs already sent will still print.')) return;
  $('#studio').hidden = true;
  S = null;
}

function savePrefs() {
  prefs.set('studio', { paperId: S.paperId, sizeBase: S.sizeBase, borderless: S.borderless, layout: S.layout });
}

async function loadCaps() {
  S.caps = null;
  S.capsError = null;
  if (!S.printer) {
    S.capsError = 'No printer found. Add your ET-8500 in System Settings → Printers & Scanners, then reopen the studio.';
    renderPanel();
    return;
  }
  try {
    S.caps = await api(`/api/printers/${encodeURIComponent(S.printer)}/capabilities`);
    if (!S.caps.pageSizes.some((p) => p.base === S.sizeBase)) {
      S.sizeBase = (S.caps.pageSizes.find((p) => /^a4$/i.test(p.base)) || S.caps.pageSizes[0])?.base;
    }
  } catch (err) {
    S.capsError = err.message;
  }
  renderPanel();
}

async function selectItem(i) {
  S.index = i;
  const item = S.items[i];
  renderFilmstrip();
  if (!item.img) {
    $('#stageInfo').textContent = 'Loading artwork…';
    try {
      item.img = await loadImage(`/files/display/${item.art.display}`);
    } catch (err) {
      $('#stageInfo').textContent = err.message;
      return;
    }
    if (item.analysis?.v !== ANALYSIS_VERSION) {
      item.analysis = analyzeImage(item.img, item.img.naturalWidth, item.img.naturalHeight);
      S.ctx.onAnalysis?.(item.art.id, item.analysis);
    }
  }
  if (S?.index === i) {
    renderPanel();
    schedulePreview();
  }
}

// ---------- Derived settings ----------

function pageSizeFor() {
  if (!S.caps) return null;
  const sizes = S.caps.pageSizes;
  const borderless = S.borderless && paperById(S.paperId).borderless;
  return sizes.find((p) => p.base === S.sizeBase && p.borderless === borderless) ||
    sizes.find((p) => p.base === S.sizeBase) || sizes[0] || null;
}

function borderlessAvailable() {
  return Boolean(S.caps?.pageSizes.some((p) => p.base === S.sizeBase && p.borderless));
}

// Everything needed to preview or print one artwork with the current settings.
function plan(item) {
  const paper = paperById(S.paperId);
  const pageSize = pageSizeFor();
  if (!item.img || !item.analysis || !pageSize) return null;
  const layout = computeLayout(pageSize, S.layout, item.img.naturalWidth, item.img.naturalHeight);
  const rec = recommend(item.analysis, paper, { ppi: layout.ppi, borderless: pageSize.borderless });
  const adj = item.adj || rec.adjustments;
  const driver = driverSettings(S.caps, { paper, quality: rec.quality, monochrome: rec.monochrome, pageSize });
  const options = { ...driver.values, ...S.overrides, PageSize: pageSize.name };
  if (!S.caps.options.some((o) => o.key === 'PageSize')) delete options.PageSize;
  return { paper, pageSize, layout, rec, adj, driver, options };
}

// ---------- Rendering: filmstrip, stage ----------

function renderFilmstrip() {
  const strip = $('#filmstrip');
  strip.hidden = S.items.length < 2;
  strip.innerHTML = S.items.map((it, i) => `
    <button type="button" class="${i === S.index ? 'on' : ''}" data-i="${i}" title="${esc(it.art.title)}">
      <img src="/files/thumbs/${it.art.thumb}" alt="">
      ${it.status ? `<span class="state ${it.status}">${it.status === 'done' ? '✓' : it.status === 'fail' ? '!' : ''}</span>` : ''}
    </button>`).join('');
}

let previewTimer = null;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(drawPreview, 90);
}

async function drawPreview() {
  if (!S) return;
  const item = S.items[S.index];
  const p = plan(item);
  const sheet = $('#sheet');
  if (!p) return;
  const token = ++S.previewToken;

  // Size the sheet to fit the stage while keeping the paper's proportions.
  const wrap = $('#sheetWrap').getBoundingClientRect();
  const { view, rect, area } = p.layout;
  const k = Math.min((wrap.width - 60) / view.width, (wrap.height - 20) / view.height);
  sheet.style.width = `${view.width * k}px`;
  sheet.style.height = `${view.height * k}px`;
  sheet.style.background = S.mode === 'paper' ? `rgb(${p.paper.sim.white.join(',')})` : '#fbfbfd';

  const adj = S.corrections ? p.adj : { brightness: 0, shadowLift: 0, contrast: 0, saturation: 0, sharpen: 0 };
  const canvas = await renderPreview(item.img, p.layout, adj, { mode: S.mode, sim: p.paper.sim, maxEdge: Math.round(Math.max(rect.width, rect.height) * k * devicePixelRatio) });
  if (!S || token !== S.previewToken) return;

  const target = $('#sheetCanvas');
  target.width = canvas.width;
  target.height = canvas.height;
  target.getContext('2d').drawImage(canvas, 0, 0);
  Object.assign(target.style, {
    left: `${(rect.x / view.width) * 100}%`, top: `${(rect.y / view.height) * 100}%`,
    width: `${(rect.width / view.width) * 100}%`, height: `${(rect.height / view.height) * 100}%`,
  });
  $$('.area', sheet).forEach((e) => e.remove());
  if (!p.pageSize.borderless) {
    const a = document.createElement('div');
    a.className = 'area';
    Object.assign(a.style, {
      left: `${(area.x / view.width) * 100}%`, top: `${(area.y / view.height) * 100}%`,
      width: `${(area.width / view.width) * 100}%`, height: `${(area.height / view.height) * 100}%`,
    });
    sheet.append(a);
  }

  const cm = (pt) => (mm(pt) / 10).toFixed(1);
  const inch = (pt) => (pt / 72).toFixed(1);
  $('#stageInfo').innerHTML = `<span class="art-title">${esc(item.art.title)}</span> &nbsp;·&nbsp; ${esc(p.pageSize.label)} ·
    image ${cm(rect.width)} × ${cm(rect.height)} cm (${inch(rect.width)} × ${inch(rect.height)} in) ·
    <b>${Math.round(p.layout.ppi)} ppi</b>${p.layout.rotate ? ' · rotated to fit' : ''}${S.mode === 'paper' ? ' · simulating ' + esc(p.paper.short) : ''}`;
}

// ---------- Rendering: settings panel ----------

function renderPanel() {
  if (!S) return;
  const panel = $('#panel');
  const item = S.items[S.index];
  const paper = paperById(S.paperId);
  const p = S.caps ? plan(item) : null;
  const printers = S.ctx.printers;
  const sizes = S.caps ? uniqueBases(S.caps.pageSizes) : [];
  const n = S.items.length;

  panel.innerHTML = `
    <section>
      <h3>${icons.printer} Printer ${S.ctx.mock ? '<span class="badge">simulated</span>' : ''}</h3>
      <select id="pPrinter">${printers.map((x) => `<option value="${esc(x.name)}" ${x.name === S.printer ? 'selected' : ''}>${esc(x.info)}</option>`).join('') || '<option>No printers found</option>'}</select>
      ${S.capsError ? `<div class="note-warn">${esc(S.capsError)}</div>` : ''}
      ${S.caps?.source === 'lpoptions' ? '<div class="hint">Reading settings from the print system (the driver file was not readable), so some names may be shorter.</div>' : ''}
    </section>

    <section>
      <h3>Paper</h3>
      <select id="pPaper">${PAPERS.map((x) => `<option value="${x.id}" ${x.id === S.paperId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <div class="tip">${esc(paper.tip)}</div>
      <div class="grid2">
        <div class="field"><label for="pSize">Paper size</label>
          <select id="pSize">${sizes.map((s) => `<option value="${esc(s.base)}" ${s.base === S.sizeBase ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></div>
        <div class="field"><label for="pCopies">Copies</label>
          <input id="pCopies" type="number" min="1" max="99" value="${S.copies}"></div>
      </div>
      <label class="inline"><input type="checkbox" id="pBorderless" ${S.borderless && paper.borderless && borderlessAvailable() ? 'checked' : ''} ${paper.borderless && borderlessAvailable() ? '' : 'disabled'}>
        Borderless ${!paper.borderless ? `<span class="hint">(not supported on ${esc(paper.short)})</span>` : !borderlessAvailable() ? '<span class="hint">(not available at this size)</span>' : ''}</label>
    </section>

    <section>
      <h3>Layout</h3>
      <div class="segmented" id="pFit">
        ${[['fit', 'Fit'], ['fill', 'Fill & crop'], ['custom', 'Custom size']].map(([v, l]) => `<button type="button" data-fit="${v}" class="${S.layout.fit === v ? 'on' : ''}">${l}</button>`).join('')}
      </div>
      ${S.layout.fit === 'custom' ? `<div class="unit-input"><label for="pWidth">Image width</label><input id="pWidth" type="number" min="10" max="400" step="1" value="${S.layout.customWidthMm}"> mm</div>` : ''}
      <div class="grid2">
        <div class="unit-input"><label for="pMargin">Extra margin</label><input id="pMargin" type="number" min="0" max="60" step="1" value="${S.layout.marginMm}"> mm</div>
        <label class="inline"><input type="checkbox" id="pRotate" ${S.layout.autoRotate ? 'checked' : ''}> Auto-rotate</label>
      </div>
    </section>

    ${p ? analysisSection(p) : `<section><h3>${icons.sparkle} Smart analysis</h3><div class="hint">${item.img ? 'Waiting for printer settings…' : 'Analysing artwork…'}</div></section>`}
    ${p ? adjustSection(p, item) : ''}
    ${p ? driverSection(p) : ''}

    <div class="print-bar">
      <button class="btn primary big" id="pPrint" type="button" ${p && !S.printing ? '' : 'disabled'}>
        ${icons.printer} ${S.printing ? 'Printing…' : n > 1 ? `Print all ${n} artworks` : 'Print'}
      </button>
      ${n > 1 ? `<button class="btn ghost" id="pPrintOne" type="button" ${p && !S.printing ? '' : 'disabled'}>Print only this one</button>` : ''}
      <div class="status" id="pStatus"></div>
    </div>`;

  bindPanel();
}

function analysisSection(p) {
  const { rec } = p;
  return `
    <section>
      <h3>${icons.sparkle} Smart analysis <span class="badge auto">${esc(p.paper.short)}</span></h3>
      <ul class="notes">${rec.notes.map((n) => `<li class="${n.level}">${esc(n.text)}</li>`).join('')}</ul>
      <div class="hint">Chosen for you: <b>${esc(cap(rec.quality))}</b> quality, <b>${rec.monochrome ? 'grayscale' : 'colour'}</b>, and the tone/colour corrections below.</div>
    </section>`;
}

function adjustSection(p, item) {
  const auto = p.rec.adjustments;
  const adj = p.adj;
  return `
    <section>
      <h3>Colour &amp; tone ${item.adj ? '<span class="badge manual">edited</span>' : '<span class="badge auto">auto</span>'}</h3>
      <label class="inline"><input type="checkbox" id="pCorrections" ${S.corrections ? 'checked' : ''}> Apply print corrections</label>
      <div id="sliders" style="display:flex;flex-direction:column;gap:9px;${S.corrections ? '' : 'opacity:.45;pointer-events:none'}">
        ${SLIDERS.map((s) => `
          <div class="slider ${Math.abs(adj[s.key] - auto[s.key]) > 0.001 ? 'changed' : ''}" title="${esc(s.hint || '')}">
            <label for="s_${s.key}">${s.label}</label>
            <input id="s_${s.key}" type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${adj[s.key]}" data-key="${s.key}">
            <output>${fmtAdj(adj[s.key])}</output>
          </div>`).join('')}
      </div>
      <div class="row">
        <button class="btn ghost" id="pAuto" type="button" ${item.adj ? '' : 'disabled'}>Reset to recommended</button>
        ${S.items.length > 1 ? '<button class="btn ghost" id="pCopyAdj" type="button">Use for all artworks</button>' : ''}
      </div>
    </section>`;
}

function driverSection(p) {
  const shown = S.caps.options.filter((o) => o.key !== 'PageSize');
  let group = null;
  const rows = shown.map((o) => {
    const value = p.options[o.key] ?? o.default;
    const manual = o.key in S.overrides;
    const autoSet = !manual && o.key in p.driver.values;
    const head = o.group !== group ? `<div class="opt-group">${esc((group = o.group))}</div>` : '';
    return `${head}
      <div class="opt">
        <div class="name"><span>${esc(o.label)} ${manual ? '<span class="badge manual">manual</span>' : autoSet ? '<span class="badge auto">auto</span>' : ''}</span>
          ${autoSet && p.driver.reasons[o.key] ? `<span class="why">${esc(p.driver.reasons[o.key])}</span>` : ''}</div>
        <select data-opt="${esc(o.key)}">${o.choices.map((c) => `<option value="${esc(c.value)}" ${c.value === value ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select>
      </div>`;
  }).join('');
  return `
    <section>
      <details class="all-settings" ${prefs.get('allSettingsOpen', false) ? 'open' : ''}>
        <summary><h3>All printer settings</h3></summary>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">
          <div class="hint">Every option your printer driver offers. Items marked <span class="badge auto">auto</span> were set from the paper and image. Change any of them and your choice is kept for this print session.</div>
          ${rows}
          ${Object.keys(S.overrides).length ? '<button class="btn ghost" id="pClearOverrides" type="button">Return all to automatic</button>' : ''}
        </div>
      </details>
    </section>`;
}

function bindPanel() {
  const panel = $('#panel');
  const on = (sel, ev, fn) => {
    const el = $(sel, panel);
    if (el) el.addEventListener(ev, fn);
  };
  const changed = (structural = true) => {
    savePrefs();
    if (structural) renderPanel();
    schedulePreview();
  };

  on('#pPrinter', 'change', async (e) => {
    S.printer = e.target.value;
    S.overrides = {};
    S.ctx.setPrinter?.(S.printer);
    await loadCaps();
    schedulePreview();
  });
  on('#pPaper', 'change', (e) => {
    S.paperId = e.target.value;
    S.overrides = {}; // paper change re-derives media/quality/source settings
    for (const it of S.items) it.adj = null;
    changed();
  });
  on('#pSize', 'change', (e) => {
    S.sizeBase = e.target.value;
    changed();
  });
  on('#pBorderless', 'change', (e) => {
    S.borderless = e.target.checked;
    changed();
  });
  on('#pCopies', 'change', (e) => {
    S.copies = Math.min(99, Math.max(1, Math.round(Number(e.target.value) || 1)));
  });
  $$('[data-fit]', panel).forEach((b) => b.addEventListener('click', () => {
    S.layout.fit = b.dataset.fit;
    changed();
  }));
  on('#pWidth', 'change', (e) => {
    S.layout.customWidthMm = Math.max(10, Number(e.target.value) || 150);
    changed();
  });
  on('#pMargin', 'change', (e) => {
    S.layout.marginMm = Math.max(0, Number(e.target.value) || 0);
    changed();
  });
  on('#pRotate', 'change', (e) => {
    S.layout.autoRotate = e.target.checked;
    changed();
  });
  on('#pCorrections', 'change', (e) => {
    S.corrections = e.target.checked;
    changed();
  });

  $$('#sliders input', panel).forEach((input) => {
    input.addEventListener('input', () => {
      const item = S.items[S.index];
      const p = plan(item);
      item.adj = { ...p.adj, [input.dataset.key]: Number(input.value) };
      input.nextElementSibling.textContent = fmtAdj(Number(input.value));
      input.parentElement.classList.toggle('changed', Math.abs(Number(input.value) - p.rec.adjustments[input.dataset.key]) > 0.001);
      $('#pAuto', panel).disabled = false;
      schedulePreview();
    });
    input.addEventListener('change', () => renderPanel());
  });
  on('#pAuto', 'click', () => {
    S.items[S.index].adj = null;
    changed();
  });
  on('#pCopyAdj', 'click', () => {
    const adj = plan(S.items[S.index]).adj;
    for (const it of S.items) it.adj = { ...adj };
    toast('These corrections now apply to every artwork in this print.', 'good');
    changed();
  });

  $$('[data-opt]', panel).forEach((sel) => sel.addEventListener('change', () => {
    S.overrides[sel.dataset.opt] = sel.value;
    changed();
  }));
  on('#pClearOverrides', 'click', () => {
    S.overrides = {};
    changed();
  });
  const details = $('details.all-settings', panel);
  if (details) details.addEventListener('toggle', () => prefs.set('allSettingsOpen', details.open));

  on('#pPrint', 'click', () => printItems(S.items.map((_, i) => i)));
  on('#pPrintOne', 'click', () => printItems([S.index]));
}

// ---------- Printing ----------

async function printItems(indexes) {
  if (S.printing) return;
  S.printing = true;
  renderPanel();
  const status = () => $('#pStatus');
  let ok = 0;
  const results = [];
  for (const i of indexes) {
    const item = S.items[i];
    item.status = 'busy';
    renderFilmstrip();
    try {
      if (!item.img) item.img = await loadImage(`/files/display/${item.art.display}`);
      if (item.analysis?.v !== ANALYSIS_VERSION) item.analysis = analyzeImage(item.img, item.img.naturalWidth, item.img.naturalHeight);
      const p = plan(item);
      if (!p) throw new Error('Printer settings are not ready.');
      if (status()) status().textContent = `Preparing “${item.art.title}” at print resolution…`;
      const out = await renderForPrint(item.img, p.layout, p.adj, S.corrections);
      if (status()) status().textContent = `Sending “${item.art.title}” to the printer…`;
      const job = {
        printer: S.printer,
        artworkId: item.art.id,
        title: item.art.title,
        copies: S.copies,
        options: p.options,
        page: out.page,
        rect: out.rect,
        pixelWidth: out.pixelWidth,
        pixelHeight: out.pixelHeight,
        paperId: p.paper.id,
        paperName: p.paper.name,
        adjustments: S.corrections ? p.adj : null,
      };
      const res = await api('/api/print', {
        method: 'POST',
        body: out.blob,
        headers: { 'Content-Type': 'image/jpeg', 'X-Print-Job': encodeURIComponent(JSON.stringify(job)) },
      });
      results.push(res);
      item.status = 'done';
      ok++;
    } catch (err) {
      item.status = 'fail';
      toast(`${item.art.title}: ${err.message}`, 'bad', 9000);
    }
    renderFilmstrip();
  }
  if (!S) return;
  S.printing = false;
  renderPanel();
  if (ok) {
    const simulated = results.some((r) => r.simulated);
    const msg = simulated
      ? `Simulated: ${ok} print${ok > 1 ? 's' : ''} saved as PDF in your library’s “simulated-prints” folder.`
      : `Sent ${ok} print${ok > 1 ? 's' : ''} to the printer.`;
    toast(msg, 'good', 7000);
    if ($('#pStatus')) $('#pStatus').textContent = msg;
    S.ctx.onPrinted?.();
  }
}

// ---------- Helpers ----------

function uniqueBases(pageSizes) {
  const seen = new Map();
  for (const p of pageSizes) {
    if (!seen.has(p.base)) seen.set(p.base, { base: p.base, label: p.label.replace(/\s*\((borderless|full\s*bleed)\)\s*/i, '').trim() });
  }
  return [...seen.values()];
}

const fmtAdj = (v) => (v > 0 ? '+' : '') + Math.round(v * 100);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- Static events ----------

$('#studioClose').onclick = closeStudio;
$('#filmstrip').addEventListener('click', (e) => {
  const b = e.target.closest('[data-i]');
  if (b && S) selectItem(Number(b.dataset.i));
});
$('#previewMode').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b || !S) return;
  S.mode = b.dataset.mode;
  $$('#previewMode button').forEach((x) => x.classList.toggle('on', x === b));
  schedulePreview();
});
window.addEventListener('resize', () => S && schedulePreview());
document.addEventListener('keydown', (e) => {
  if (!S) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (e.key === 'Escape') closeStudio();
  if (!typing && e.key === 'ArrowRight' && S.index < S.items.length - 1) selectItem(S.index + 1);
  if (!typing && e.key === 'ArrowLeft' && S.index > 0) selectItem(S.index - 1);
});
