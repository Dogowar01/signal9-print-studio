// Parses printer capabilities from a CUPS PPD file or `lpoptions -l` output.
// The PPD is preferred because it carries human-readable labels and exact
// paper dimensions; lpoptions is the fallback when the PPD can't be read.

const BORDERLESS_RE = /borderless|full\s*bleed|fullbleed|\.fb\b|\.bl\b|_bl\b|\bno\s*margins?\b/i;

// Point sizes (1/72 inch) for common paper names, used when no PPD is available.
const KNOWN_SIZES = {
  a4: [595, 842], letter: [612, 792], legal: [612, 1008], a5: [420, 595], a6: [298, 420],
  b5: [516, 729], '4x6': [288, 432], '10x15cm': [283, 425], '5x7': [360, 504], '13x18cm': [369, 510],
  '8x10': [576, 720], '3.5x5': [252, 360], '89x127mm': [252, 360], '5x8': [360, 576],
  '16x9': [289, 513], 'hivision': [289, 513], 'executive': [522, 756], 'statement': [396, 612],
  '8.5x13': [612, 936], 'env10': [297, 684], 'envdl': [312, 624], 'envc6': [323, 459],
};

function unquote(s) {
  s = s.trim();
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  return s;
}

// Split `keyword/Label: "value"` at the colon before the value. Labels may
// themselves contain colons (e.g. "16:9 Wide"), so prefer the one before a quote.
function splitEntry(rest) {
  let ci = rest.search(/:\s*"/);
  if (ci === -1) ci = rest.indexOf(':');
  return ci === -1 ? null : [rest.slice(0, ci), rest.slice(ci + 1)];
}

// Split "keyword/Label" into its parts. PPD labels may be hex-escaped (<E9>), which we decode.
function splitKeyLabel(s) {
  const i = s.indexOf('/');
  const key = (i === -1 ? s : s.slice(0, i)).trim();
  let label = (i === -1 ? key : s.slice(i + 1)).trim();
  label = label.replace(/<([0-9A-Fa-f\s]+)>/g, (_, hex) => {
    const bytes = hex.replace(/\s+/g, '').match(/../g) || [];
    return Buffer.from(bytes.map((b) => parseInt(b, 16))).toString('latin1');
  });
  return { key, label: label || key };
}

export function parsePPD(text) {
  const lines = text.split(/\r?\n/);
  const options = [];
  const dims = {};
  const imageable = {};
  let current = null;
  let group = 'General';

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (!line.startsWith('*') || line.startsWith('*%')) continue;

    // Quoted values can span several lines; gather until the quote closes.
    const firstQuote = line.indexOf('"');
    if (firstQuote !== -1 && line.indexOf('"', firstQuote + 1) === -1) {
      while (i + 1 < lines.length) {
        line += '\n' + lines[++i];
        if (lines[i].includes('"')) break;
      }
    }

    let m;
    if ((m = line.match(/^\*OpenGroup:\s*(.+)$/))) {
      group = splitKeyLabel(m[1]).label;
      continue;
    }
    if ((m = line.match(/^\*(?:JCL)?OpenUI\s+\*([^:]+):\s*(\w+)/))) {
      const { key, label } = splitKeyLabel(m[1]);
      current = { key, label, type: m[2], group, choices: [], default: null };
      options.push(current);
      continue;
    }
    if (/^\*(?:JCL)?CloseUI:/.test(line)) {
      current = null;
      continue;
    }
    if (line.startsWith('*PaperDimension ') || line.startsWith('*ImageableArea ')) {
      const sp = line.indexOf(' ');
      const parts = splitEntry(line.slice(sp + 1));
      if (!parts) continue;
      const { key } = splitKeyLabel(parts[0]);
      const nums = unquote(parts[1]).split(/\s+/).map(Number);
      if (line.startsWith('*PaperDimension')) dims[key] = nums;
      else imageable[key] = nums;
      continue;
    }
    if ((m = line.match(/^\*Default(\w+):\s*(\S+)/))) {
      const opt = options.find((o) => o.key === m[1]);
      if (opt) opt.default = m[2];
      continue;
    }
    if (current && line.startsWith(`*${current.key} `)) {
      const parts = splitEntry(line.slice(current.key.length + 2));
      if (!parts) continue;
      const { key, label } = splitKeyLabel(parts[0]);
      if (key !== 'Custom' && !current.choices.some((c) => c.value === key)) {
        current.choices.push({ value: key, label });
      }
    }
  }

  // A few drivers declare *DefaultX before the matching OpenUI block.
  for (const opt of options) {
    if (!opt.default) {
      const dm = text.match(new RegExp(`^\\*Default${escapeRe(opt.key)}:\\s*(\\S+)`, 'm'));
      if (dm) opt.default = dm[1];
    }
  }

  return finalize(options.filter((o) => o.choices.length > 0), dims, imageable);
}

export function parseLpoptions(text) {
  const options = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([^/:]+)\/([^:]*):\s*(.*)$/);
    if (!m) continue;
    const opt = { key: m[1].trim(), label: m[2].trim() || m[1].trim(), type: 'PickOne', group: 'General', choices: [], default: null };
    for (const tok of m[3].trim().split(/\s+/)) {
      if (!tok) continue;
      const isDefault = tok.startsWith('*');
      const value = isDefault ? tok.slice(1) : tok;
      if (value === 'Custom' || value.startsWith('Custom.')) continue;
      opt.choices.push({ value, label: prettifyChoice(value) });
      if (isDefault) opt.default = value;
    }
    if (opt.choices.length) options.push(opt);
  }
  return finalize(options, {}, {});
}

// Pull the user's saved defaults (`*value` markers) from lpoptions -l and apply them.
export function applyLpDefaults(caps, lpText) {
  const lp = parseLpoptions(lpText);
  for (const o of lp.options) {
    const target = caps.options.find((c) => c.key === o.key);
    if (target && o.default && target.choices.some((c) => c.value === o.default)) target.default = o.default;
  }
  return caps;
}

function finalize(options, dims, imageable) {
  const pageOpt = options.find((o) => o.key === 'PageSize');
  const pageSizes = [];
  if (pageOpt) {
    for (const choice of pageOpt.choices) {
      const size = dims[choice.value] || guessSize(choice.value);
      if (!size) continue;
      const [w, h] = size;
      let area = imageable[choice.value];
      const borderless = BORDERLESS_RE.test(choice.value) || BORDERLESS_RE.test(choice.label) ||
        Boolean(area && area[0] <= 0.5 && area[1] <= 0.5 && area[2] >= w - 0.5 && area[3] >= h - 0.5);
      if (!area) area = borderless ? [0, 0, w, h] : [8.5, 8.5, w - 8.5, h - 8.5];
      pageSizes.push({
        name: choice.value,
        label: choice.label,
        base: baseName(choice.value),
        width: w,
        height: h,
        imageable: { left: area[0], bottom: area[1], right: area[2], top: area[3] },
        borderless,
      });
    }
  }
  return { options, pageSizes };
}

function baseName(name) {
  return name.replace(/[._-]?(borderless|full\s*bleed|fullbleed|fb|bl)$/i, '');
}

function guessSize(name) {
  const custom = name.match(/^w(\d+(?:\.\d+)?)h(\d+(?:\.\d+)?)/i);
  if (custom) return [Number(custom[1]), Number(custom[2])];
  // PWG self-describing names, e.g. na_index-4x6_4x6in or iso_a4_210x297mm
  const pwg = name.match(/_(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(in|mm)/i);
  if (pwg) {
    const f = pwg[3].toLowerCase() === 'in' ? 72 : 72 / 25.4;
    return [Number(pwg[1]) * f, Number(pwg[2]) * f];
  }
  const base = baseName(name).toLowerCase().replace(/^(na|iso|jis|oe|om)_/, '').replace(/_.*$/, '');
  if (KNOWN_SIZES[base]) return KNOWN_SIZES[base];
  const inch = base.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(in)?$/);
  if (inch) return [Number(inch[1]) * 72, Number(inch[2]) * 72];
  const mm = base.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)mm$/);
  if (mm) return [(Number(mm[1]) / 25.4) * 72, (Number(mm[2]) / 25.4) * 72];
  return null;
}

function prettifyChoice(value) {
  return value
    .replace(/^(com|jp)\.[a-z]+[-.]/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
