// The "new version" card shown in the Mac app. Driven by messages from the
// app's updater: available → progress → installing → restarting, or manual / error.

import { esc, formatBytes } from './util.js';

let card = null;
let offer = null;
let install = null;

export function showUpdate(info, installFn) {
  if (installFn) install = installFn;
  if (info.type === 'available') offer = info;
  if (!card) {
    card = document.createElement('aside');
    card.className = 'update-card';
    card.setAttribute('role', 'status');
    document.body.append(card);
  }
  card.innerHTML = content(info);
  card.querySelector('[data-update]')?.addEventListener('click', start);
  card.querySelector('[data-later]')?.addEventListener('click', hide);
}

function start() {
  showUpdate({ type: 'progress', percent: 0 });
  install?.();
}

function hide() {
  card?.remove();
  card = null;
}

function content(info) {
  const v = offer?.version ? `Version ${esc(offer.version)}` : 'A new version';
  const head = (title) => `<span class="eyebrow">Signal9 Print Studio</span><h4>${title}</h4>`;
  switch (info.type) {
    case 'available':
      return `${head(`${v} is ready`)}
        ${info.notes ? `<p>${esc(info.notes)}</p>` : ''}
        <p class="meta">${formatBytes(info.size)} download · your library isn’t touched</p>
        <div class="actions"><button class="btn ghost" data-later type="button">Later</button>
        <button class="btn primary" data-update type="button">Update &amp; restart</button></div>`;
    case 'progress':
      return `${head(`Downloading ${v.toLowerCase()}`)}
        <div class="bar"><i style="width:${info.percent}%"></i></div><p class="meta">${info.percent}%</p>`;
    case 'installing':
      return `${head('Installing…')}<div class="bar busy"><i></i></div><p class="meta">Checking and preparing the new version</p>`;
    case 'restarting':
      return `${head('Restarting')}<p>Signal9 Print Studio will close and reopen in a moment.</p>`;
    case 'manual':
      return `${head(`${v} downloaded`)}
        <p>This copy can’t be replaced automatically, so the installer has opened. Drag Signal9 Print Studio into Applications to finish.</p>
        <div class="actions"><button class="btn ghost" data-later type="button">Close</button></div>`;
    case 'error':
      return `${head('The update didn’t finish')}<p>${esc(info.message)}</p>
        <div class="actions"><button class="btn ghost" data-later type="button">Later</button>
        <button class="btn primary" data-update type="button">Try again</button></div>`;
    default:
      return '';
  }
}
