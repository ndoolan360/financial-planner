import { must } from "./utils.js";

const summaryEl = must("#summary");

/** @param {?number} v Money amount. @returns {string} Rounded `$` string, or em-dash if null. */
const fmtMoney = (v) => {
  if (v == null) return "—";
  const r = Math.round(v);
  return `${r < 0 ? "-" : ""}$${Math.abs(r).toLocaleString()}`;
};

/** @param {?string} v Date string. @returns {string} `v` or em-dash if null. */
const fmtDate = (v) => v ?? "—";

const ROWS = [
  { key: "finalAssetsTotal", format: fmtMoney },
  { key: "totalLiabilityInterest", format: fmtMoney },
  { key: "totalAssetInterest", format: fmtMoney },
  { key: "totalTax", format: fmtMoney },
  { key: "payoffDate", format: fmtDate },
];

/** @param {number} days Day count. @returns {string} Human-friendly duration. */
const fmtDuration = (days) => {
  const years = days / 365.25;
  if (years >= 1) return `${years.toFixed(1)} years`;
  const months = days / (365.25 / 12);
  if (months >= 1) return `${months.toFixed(1)} months`;
  return `${days} day${days === 1 ? "" : "s"}`;
};

/**
 * @param {Array<{name:string, summary:object}>} results Named simulation results.
 * @param {number} simDuration Longest scenario length in days.
 */
export function renderSummary(results, simDuration) {
  const thead = summaryEl.querySelector("thead tr");
  const tbody = summaryEl.querySelector("tbody");
  const rows = tbody.querySelectorAll("tr");

  thead.firstElementChild.textContent =
    simDuration > 0 ? `Simulation ran for ${fmtDuration(simDuration)}` : "";

  while (thead.children.length > 1) thead.lastElementChild.remove();
  results.forEach(({ name, summary }) => {
    const th = document.createElement("th");
    th.scope = "col";
    const overdrawn = !!summary.negativeAssetDate;
    const outstanding = !!summary.cappedOut;
    const tags = [];
    if (overdrawn) tags.push("overdrawn");
    if (outstanding) tags.push("outstanding debt");
    th.textContent = tags.length ? `${name || "?"} (${tags.join(", ")})` : name || "?";
    if (overdrawn) {
      th.classList.add("overdrawn");
      th.title = `An asset went negative on ${summary.negativeAssetDate}`;
    }
    if (outstanding) {
      th.classList.add("outstanding");
      const existing = th.title ? th.title + "\n" : "";
      th.title = `${existing}Liabilities still owe $${Math.round(summary.finalLiabilitiesTotal).toLocaleString()} after ${summary.days} days`;
    }
    thead.appendChild(th);
  });

  rows.forEach((tr, i) => {
    while (tr.children.length > 1) tr.lastElementChild.remove();
    const { key, format } = ROWS[i];
    results.forEach(({ summary }) => {
      const td = document.createElement("td");
      td.textContent = format(summary[key]);
      if (summary.negativeAssetDate) td.classList.add("overdrawn");
      if (summary.cappedOut) td.classList.add("outstanding");
      tr.appendChild(td);
    });
  });
}
