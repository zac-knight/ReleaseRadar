// Calendar view: a compact month picker (left) beside a release agenda (right).
// The picker shows where releases fall; the agenda lists them day by day, so nothing is squished
// regardless of screen size. Pure DOM; the app supplies entries and callbacks.
import { calendarWeeks } from './model.js';
import { el, posterSrc } from './ui.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function renderCalendar({ entries, year, month, today, expanded, onPick, onNav, onExpand, serviceColor }) {
  const byDate = new Map();
  for (const e of entries) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
  const days = [...byDate.keys()].filter((d) => d.startsWith(monthKey)).sort();
  const inMonth = days.reduce((n, d) => n + byDate.get(d).length, 0);
  const selected = expanded && byDate.has(expanded) ? expanded : null;

  // ---- left: month picker ----
  const nav = (label, delta, text) => {
    const b = el('button', { class: 'cal-btn', 'aria-label': label, text });
    b.addEventListener('click', () => onNav(delta));
    return b;
  };
  const todayBtn = el('button', { class: 'cal-btn wide', text: 'Today' });
  todayBtn.addEventListener('click', () => onNav(0));

  const mini = el('div', { class: 'mini', role: 'grid' }, ...DOW.map((d) => el('span', { class: 'mini-dow', text: d })));
  for (const week of calendarWeeks(year, month)) {
    for (const day of week) {
      const n = (byDate.get(day) || []).length;
      const cls = ['mini-day'];
      if (day.slice(0, 7) !== monthKey) cls.push('out');
      if (day === today) cls.push('today');
      if (day === selected) cls.push('sel');
      if (n) cls.push('has', `h${Math.min(n, 4)}`);
      const b = el('button', { class: cls.join(' '), 'aria-label': `${day}, ${n} releases`, disabled: n ? null : '' },
        String(Number(day.slice(8))), n ? el('i', { text: String(n) }) : null);
      if (n) b.addEventListener('click', () => onExpand(day === selected ? null : day));
      mini.append(b);
    }
  }

  const side = el('aside', { class: 'cal-side' },
    el('div', { class: 'cal-nav' }, nav('Previous month', -1, '‹'), el('h2', { text: `${MONTHS[month]} ${year}` }), nav('Next month', 1, '›')),
    mini,
    el('div', { class: 'cal-sum' },
      el('strong', { text: String(inMonth) }), ` ${inMonth === 1 ? 'release' : 'releases'} on `,
      el('strong', { text: String(days.length) }), ` ${days.length === 1 ? 'day' : 'days'}`),
    todayBtn);

  // ---- right: agenda ----
  const agenda = el('div', { class: 'agenda' });
  for (const day of days) {
    const [y, m, d] = day.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const items = byDate.get(day);
    const cls = `ag-day${day === today ? ' today' : ''}${day === selected ? ' sel' : ''}`;
    const row = el('section', { class: cls, 'data-day': day },
      el('header', { class: 'ag-date' },
        el('b', { text: String(d) }), el('span', { text: DAY_NAMES[dt.getDay()].slice(0, 3) }),
        day === today ? el('em', { text: 'Today' }) : null),
      el('div', { class: 'ag-items' }, ...items.map((e) => {
        const color = serviceColor(e);
        const b = el('button', { class: 'ag-card', title: e.title, style: color ? `--c:${color}` : '' },
          e.poster ? el('img', { src: posterSrc(e.poster, 'w185'), alt: '', loading: 'lazy', decoding: 'async' }) : el('i'),
          el('span', { text: e.title }));
        b.addEventListener('click', () => onPick(e));
        return b;
      })));
    agenda.append(row);
  }
  if (!days.length) agenda.append(el('p', { class: 'ag-empty', text: `Nothing scheduled in ${MONTHS[month]} with the current filters.` }));

  // bring the selected (or today's / next upcoming) day into view once attached
  const focus = selected || days.find((d) => d >= today);
  if (focus) requestAnimationFrame(() => {
    const t = agenda.querySelector(`[data-day="${focus}"]`);
    if (t) agenda.scrollTop = Math.max(0, t.offsetTop - agenda.offsetTop - 4);
  });

  return el('section', { class: 'calendar' }, side, agenda);
}
