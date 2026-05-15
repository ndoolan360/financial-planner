import { must } from "./utils.js";

const tableEl = must("#schedule-table");

const fmtMoney = (v) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const r = Math.round(v);
  return `${r < 0 ? "-" : ""}$${Math.abs(r).toLocaleString()}`;
};

/** @param {string} ymd `YYYY-MM-DD`. @returns {string} `YYYY-MM`. */
const monthKey = (ymd) => ymd.slice(0, 7);

/** @param {string} ym `YYYY-MM`. @returns {string} Display label, e.g. "Jan 2026". */
const fmtMonth = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "short", year: "numeric" });
};

/**
 * @param {Array<{date:string, open:number, interest:number, repayment:number, close:number}>} ledger
 *   Daily ledger for one liability.
 * @returns {Map<string, {open:number, interest:number, repayment:number, close:number, quiet:boolean}>}
 *   Month-keyed bucket: opening = first day's open, closing = last day's close,
 *   interest/repayment summed; `quiet` flags a month with zero activity.
 */
function bucketByMonth(ledger) {
  const out = new Map();
  for (const row of ledger) {
    const key = monthKey(row.date);
    let bucket = out.get(key);
    if (!bucket) {
      bucket = { open: row.open, interest: 0, repayment: 0, close: row.close, quiet: true };
      out.set(key, bucket);
    }
    bucket.interest += row.interest;
    bucket.repayment += row.repayment;
    bucket.close = row.close;
    if (row.interest > 0 || row.repayment > 0) bucket.quiet = false;
  }
  return out;
}

/**
 * @param {Array<{name:string, scenario:object, ledger:object}>} cols Per-scenario inputs.
 * @returns {Array<{scenarioName:string, liabilityLabel:string, id:string, buckets:Map}>}
 *   Flat list of (scenario × liability) columns in display order.
 */
function buildColumns(cols) {
  const out = [];
  cols.forEach(({ name, scenario, ledger }) => {
    (scenario.liabilities || []).forEach((L, i) => {
      const rows = ledger?.[L.id] || [];
      if (rows.length === 0) return;
      out.push({
        scenarioName: name || "?",
        liabilityLabel: L.label?.trim() || `Liability ${i + 1}`,
        id: `${name || "?"}::${L.id}`,
        buckets: bucketByMonth(rows),
      });
    });
  });
  return out;
}

/**
 * @param {Map<string, *>} buckets Month-keyed bucket map.
 * @returns {Array<string>} All month keys across every column, sorted.
 */
function collectMonths(columns) {
  const set = new Set();
  for (const c of columns) for (const k of c.buckets.keys()) set.add(k);
  return [...set].sort();
}

/** @returns {string} Empty-state HTML when there are no liabilities to show. */
const emptyState = () => `
  <thead><tr><th>Schedule</th></tr></thead>
  <tbody><tr><td class="empty">No liabilities to schedule.</td></tr></tbody>
`;

const SUBCOLS = [
  { key: "open", label: "Open" },
  { key: "interest", label: "Interest" },
  { key: "repayment", label: "Repayment" },
  { key: "close", label: "Close" },
];

/**
 * @param {Array<{name:string, scenario:object, ledger:object}>} cols Per-scenario inputs.
 */
export function renderSchedule(cols) {
  const columns = buildColumns(cols);
  if (columns.length === 0) {
    tableEl.innerHTML = emptyState();
    return;
  }
  const months = collectMonths(columns);

  // Two-row header: scenario+liability title spanning 4 sub-columns each,
  // then the per-column sub-headers.
  const titleRow = ['<th rowspan="2" scope="col">Month</th>']
    .concat(
      columns.map(
        (c) =>
          `<th colspan="${SUBCOLS.length}" scope="colgroup">${c.scenarioName} \u2014 ${c.liabilityLabel}</th>`,
      ),
    )
    .join("");
  const subRow = columns
    .flatMap(() => SUBCOLS.map((s) => `<th scope="col">${s.label}</th>`))
    .join("");

  const body = months
    .map((ym) => {
      const cells = columns
        .map((c) => {
          const b = c.buckets.get(ym);
          if (!b) {
            // Liability hadn't started or was already paid off this month.
            return SUBCOLS.map(() => '<td class="quiet">\u2014</td>').join("");
          }
          const cls = b.quiet ? ' class="quiet"' : "";
          return SUBCOLS.map((s) => `<td${cls}>${fmtMoney(b[s.key])}</td>`).join("");
        })
        .join("");
      return `<tr><th scope="row">${fmtMonth(ym)}</th>${cells}</tr>`;
    })
    .join("");

  tableEl.innerHTML = `<thead><tr>${titleRow}</tr><tr>${subRow}</tr></thead><tbody>${body}</tbody>`;
}
