// Pure helpers for the updater (no Electron imports, so they can be unit-tested).

/** True when version `a` (e.g. "1.2.0" or "v1.2.0") is newer than `b`. */
export function isNewer(a, b) {
  const parse = (v) => String(v).replace(/^v/i, '').split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

/**
 * Reads a GitHub "latest release" response. Returns the update on offer for this
 * Mac (version, short notes, the matching .dmg asset) or null when there's nothing newer.
 */
export function pickUpdate(release, currentVersion, arch) {
  if (!release || release.draft || release.prerelease || !release.tag_name) return null;
  const version = release.tag_name.replace(/^v/i, '');
  if (!isNewer(version, currentVersion)) return null;
  const asset = (release.assets || []).find((a) => a.name.endsWith(`-${arch}.dmg`));
  if (!asset) return null;
  return { version, notes: summarizeNotes(release.body), asset };
}

/** First paragraph of the release notes, trimmed to a sentence or two for the update card. */
export function summarizeNotes(body) {
  const text = String(body || '')
    .replace(/\r/g, '')
    .split(/\n\s*\n/)[0]
    .replace(/^#+\s*/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 220 ? `${text.slice(0, 217).replace(/\s+\S*$/, '')}…` : text;
}

/**
 * Shell script that swaps in the new app once this one has quit, keeping the old
 * copy until the new one is in place, then reopens the app.
 * Arguments: $1 our pid, $2 installed app path, $3 staged new app, $4 temp dir.
 */
export const SWAP_SCRIPT = [
  'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done',
  'if mv "$2" "$2.old"; then',
  '  if mv "$3" "$2"; then rm -rf "$2.old"; else mv "$2.old" "$2"; fi',
  'fi',
  'open "$2"',
  'rm -rf "$4"',
].join('\n');
