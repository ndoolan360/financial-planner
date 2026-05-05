/**
 * @param {Function} fn Function to debounce.
 * @param {number} ms Quiet period before `fn` runs.
 * @returns {Function} Debounced wrapper.
 */
export const debounce = (fn, ms) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

/**
 * @param {string} selector CSS selector to look up.
 * @param {ParentNode} [root=document] Root to query within.
 * @returns {Element} The matched element; throws if missing.
 */
export const must = (selector, root = document) => {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`Missing ${selector}`);
  return el;
};

/**
 * @param {Date} date Date whose year is checked.
 * @returns {number} 365 or 366.
 */
export function daysInYear(date) {
  const y = date.getFullYear();
  return new Date(y, 1, 29).getMonth() === 1 ? 366 : 365;
}

/**
 * @param {{amount:number, freq:string}} item Recurring item.
 * @param {Date} date Reference date for leap-year sensitivity.
 * @returns {number} Average daily amount.
 */
export function perDayAmount({ amount, freq }, date) {
  const diy = daysInYear(date);
  switch (freq) {
    case 'DAILY': return amount;
    case 'WEEKLY': return amount / 7;
    case 'FORTNIGHTLY': return amount / 14;
    case 'MONTHLY': return amount * 12 / diy;
    case 'QUARTERLY': return amount * 4 / diy;
    case 'YEARLY': return amount / diy;
    default: return 0;
  }
}

/**
 * @param {Date} from Start date.
 * @param {Date} to End date.
 * @returns {number} Whole-day difference (`to - from`).
 */
function daysBetween(from, to) {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.floor((b - a) / 86400000);
}

/**
 * @param {Date} date Any date in the target month.
 * @returns {number} Day-of-month for the last day of that month.
 */
function lastDayOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/**
 * @param {{amount:number, freq:string, payDayOffset?:number}} item Recurring item.
 * @param {Date} date Day to test.
 * @param {Date} startDate Anchor for fortnightly/quarterly/yearly cadences.
 * @returns {number} `amount` if the item lands on `date`, else 0.
 */
export function amountOnDay({ amount, freq, payDayOffset = 0 }, date, startDate) {
  if (!amount) return 0;
  switch (freq) {
    case 'DAILY':
      return amount;
    case 'WEEKLY': {
      const target = ((payDayOffset % 7) + 7) % 7;
      return date.getDay() === target ? amount : 0;
    }
    case 'FORTNIGHTLY': {
      const off = ((payDayOffset % 14) + 14) % 14;
      const targetDow = off % 7;
      const targetWeek = Math.floor(off / 7);
      const startSunday = new Date(startDate);
      startSunday.setDate(startSunday.getDate() - startSunday.getDay());
      const weekIdx = Math.floor(daysBetween(startSunday, date) / 7);
      const weekParity = ((weekIdx % 2) + 2) % 2;
      return (date.getDay() === targetDow && weekParity === targetWeek) ? amount : 0;
    }
    case 'MONTHLY': {
      const target = Math.min(Math.max(1, payDayOffset || 1), lastDayOfMonth(date));
      return date.getDate() === target ? amount : 0;
    }
    case 'QUARTERLY': {
      const monthsSince =
        (date.getFullYear() - startDate.getFullYear()) * 12 +
        (date.getMonth() - startDate.getMonth());
      if (monthsSince < 0 || monthsSince % 3 !== 0) return 0;
      const target = Math.min(Math.max(1, payDayOffset || 1), lastDayOfMonth(date));
      return date.getDate() === target ? amount : 0;
    }
    case 'YEARLY': {
      if (date.getMonth() !== startDate.getMonth()) return 0;
      const target = Math.min(startDate.getDate(), lastDayOfMonth(date));
      return date.getDate() === target ? amount : 0;
    }
    default:
      return 0;
  }
}

/**
 * @param {string} s `YYYY-MM-DD`.
 * @returns {Date} Local-time date.
 */
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * @param {Date} date Base date.
 * @param {number} n Days to add (may be negative).
 * @returns {Date} New date `n` days after `date`.
 */
export function addDays(date, n) {
  const out = new Date(date);
  out.setDate(out.getDate() + n);
  return out;
}

/**
 * @param {Date} d Date to format.
 * @returns {string} `YYYY-MM-DD` in local time.
 */
export function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
