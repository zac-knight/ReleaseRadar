// Month-grid calendar view. Pure DOM; the app supplies entries and callbacks.
import { calendarWeeks } from './model.js';
import { el, posterSrc } from './ui.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_PER_DAY = 3;

export function renderCalendar({ entries, year, month, today, expanded, onPick, onNav, onExpand, serviceColor }) {
  const byDate = new Map();
  for (const e of entries) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
  const inMonth = entries.filter((e) => e.date.startsWith(monthKey)).length;

  const nav = (label, delta, text) => {
    const b = el('button', { class: 'cal-btn', 'aria-label': label, text });
    b.addEventListener('click', () => onNav(delta));
    return b;
  };
  const todayBtn = el('button', { class: 'cal-btn wide', text: 'Today' });
  todayBtn.addEventListener('click', () => onNav(0));

  const head = el('div', { class: 'cal-head' },
    nav('Previous month', -1, '‹'), nav('Next month', 1, '›'),
    el('h2', { text: `${MONTHS[month]} ${year}` }),
    el('span', { class: 'cal-count', text: `${inMonth} ${inMonth === 1 ? 'release' : 'releases'}` }),
    el('span', { class: 'grow' }), todayBtn);

  const grid = el('div', { class: 'cal-grid', role: 'grid' }, ...DOW.map((d) => el('div', { class: 'cal-dow', text: d })));
  for (const week of calendarWeeks(year, month)) {
    for (const day of week) {
      const items = byDate.get(day) || [];
      const open = expanded === day;
      const shown = open ? items : items.slice(0, MAX_PER_DAY);
      const cell = el('div', {
        class: `cal-cell${day.slice(0, 7) !== monthKey ? ' out' : ''}${day === today ? ' today' : ''}${items.length ? ' has' : ''}${open ? ' open' : ''}`,
        role: 'gridcell', 'aria-label': `${day}, ${items.length} releases`,
      }, el('span', { class: 'cal-day', text: String(Number(day.slice(8))) }));
      for (const e of shown) {
        const color = serviceColor(e);
        const b = el('button', { class: 'cal-item', title: e.title, style: color ? `--c:${color}` : '' },
          e.poster ? el('img', { src: posterSrc(e.poster), alt: '', loading: 'lazy', decoding: 'async' }) : el('i'),
          el('span', { text: e.title }));
        b.addEventListener('click', () => onPick(e));
        cell.append(b);
      }
      if (items.length > MAX_PER_DAY) {
        const more = el('button', { class: 'cal-more', text: open ? 'Show less' : `+${items.length - MAX_PER_DAY} more` });
        more.addEventListener('click', () => onExpand(open ? null : day));
        cell.append(more);
      }
      grid.append(cell);
    }
  }
  return el('section', { class: 'calendar' }, head, grid);
}
