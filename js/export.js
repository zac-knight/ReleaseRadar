// Pure exporters: .ics calendar files and CSV. No DOM, so they're unit-tested.

const icsDate = (d) => d.replaceAll('-', '');
const icsEscape = (s = '') => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

function nextDay(date) {
  const [y, m, d] = date.split('-').map(Number);
  const n = new Date(Date.UTC(y, m - 1, d + 1));
  return `${n.getUTCFullYear()}${String(n.getUTCMonth() + 1).padStart(2, '0')}${String(n.getUTCDate()).padStart(2, '0')}`;
}

// RFC 5545 asks for lines <= 75 octets; fold longer ones.
function fold(line) {
  const out = [];
  let rest = line;
  while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = ` ${rest.slice(74)}`; }
  out.push(rest);
  return out.join('\r\n');
}

/** All-day events, one per title. `label(e)` supplies the category text (e.g. "In cinemas"). */
export function buildICS(entries, { label = () => '', stamp = new Date() } = {}) {
  const dtstamp = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Release Radar//EN', 'CALSCALE:GREGORIAN'];
  for (const e of entries) {
    if (!e.date || e.date.endsWith('-01-01') && e.status === 'rumoured') continue; // no real day to put on a calendar
    const tag = label(e);
    const desc = [tag, (e.genres || []).join(', '), (e.providers || []).join(', '), e.overview].filter(Boolean).join('\n');
    lines.push('BEGIN:VEVENT', `UID:${e.key.replace(':', '-')}-${icsDate(e.date)}@release-radar`,
      `DTSTAMP:${dtstamp}`, `DTSTART;VALUE=DATE:${icsDate(e.date)}`, `DTEND;VALUE=DATE:${nextDay(e.date)}`,
      `SUMMARY:${icsEscape(tag ? `${e.title} (${tag})` : e.title)}`, `DESCRIPTION:${icsEscape(desc)}`,
      'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(entries) {
  const head = ['Title', 'Type', 'Date', 'Status', 'Genres', 'Platforms', 'Certification', 'Runtime (min)', 'Language'];
  const rows = entries.map((e) => [e.title, e.type === 'movie' ? 'Movie' : 'TV', e.date, e.status,
    (e.genres || []).join('; '), (e.providers || []).join('; '), e.cert, e.runtime, e.lang]);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
