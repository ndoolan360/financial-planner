import { must } from "./utils.js";
import { newLiability, newAsset, newIncome, newExpense, newEvent, newScenario } from "./model.js";

/** @param {?HTMLInputElement} el Form input. @returns {number} Parsed number, or 0. */
const numField = (el) => parseFloat(el?.value) || 0;
/** @param {?HTMLInputElement} el Form input. @returns {string} Trimmed-of-undefined string value. */
const strField = (el) => el?.value ?? "";

/** @param {?number} v Decimal rate. @returns {number} Same value as a percentage (e.g. 0.0575 → 5.75). */
const pct = (v) => parseFloat(((v ?? 0) * 100).toPrecision(10));

/**
 * @param {ParentNode} root Root to query within.
 * @param {string} sel CSS selector for the target input/select.
 * @param {*} val Value to assign (null/undefined writes empty string).
 */
const setVal = (root, sel, val) => {
  const el = root.querySelector(sel);
  if (el) el.value = val ?? "";
};

/** @param {HTMLElement} row Liability row. @returns {object} Liability model. */
const readLiability = (row) => {
  const isMinimum = row.querySelector(".liability-is-minimum")?.checked ?? false;
  return newLiability({
    id: row.dataset.id || undefined,
    label: strField(row.querySelector(".liability-label")),
    currentBalance: numField(row.querySelector(".liability-balance")),
    interestRate: numField(row.querySelector(".liability-rate")) / 100,
    repayment: {
      mode: isMinimum ? "MINIMUM" : "FIXED",
      amount: numField(row.querySelector(".liability-repayment-amount")),
      originalAmount: numField(row.querySelector(".liability-original-amount")),
      originalTerm: numField(row.querySelector(".liability-original-term")),
      freq: strField(row.querySelector(".liability-repayment-freq")) || "MONTHLY",
      payDayOffset: numField(row.querySelector(".liability-repayment-pay-day")),
    },
  });
};

/** @param {HTMLElement} row Asset row. @returns {object} Asset model. */
const readAsset = (row) => {
  const isOffset = row.querySelector(".asset-is-offset")?.checked ?? false;
  return newAsset({
    id: row.dataset.id || undefined,
    label: strField(row.querySelector(".asset-label")),
    currentBalance: numField(row.querySelector(".asset-balance")),
    interestRate: isOffset ? 0 : numField(row.querySelector(".asset-rate")) / 100,
    taxOnInterest: isOffset ? 0 : numField(row.querySelector(".asset-tax")) / 100,
    netShare: numField(row.querySelector(".asset-share")),
    offset: isOffset
      ? {
          against: row.querySelector(".asset-offset-against")?.value || null,
          fallback: row.querySelector(".asset-fallback-to")?.value || null,
        }
      : { against: null, fallback: null },
  });
};

/** @param {HTMLElement} row Income row. @returns {object} Income model. */
const readIncome = (row) =>
  newIncome({
    id: row.dataset.id || undefined,
    label: strField(row.querySelector(".income-label")),
    amount: numField(row.querySelector(".income-amount")),
    freq: strField(row.querySelector(".income-freq")) || "MONTHLY",
    payDayOffset: numField(row.querySelector(".income-pay-day")),
  });

/** @param {HTMLElement} row Expense row. @returns {object} Expense model. */
const readExpense = (row) =>
  newExpense({
    id: row.dataset.id || undefined,
    label: strField(row.querySelector(".expense-label")),
    amount: -Math.abs(numField(row.querySelector(".expense-amount"))),
    freq: strField(row.querySelector(".expense-freq")) || "MONTHLY",
  });

/** @param {HTMLElement} row Event row. @returns {object} Event model. */
const readEvent = (row) => {
  // In transfer mode the row uses the dedicated number input; otherwise the
  // generic value text input. data-event-mode is maintained by
  // rebuildEventPathOptions.
  const isTransfer = row.dataset.eventMode === "transfer";
  const valueEl = isTransfer
    ? row.querySelector(".event-transfer-amount")
    : row.querySelector(".event-value");
  const raw = strField(valueEl);
  const parsed = Number(raw);
  const valueOut = isTransfer
    ? raw === "" || isNaN(parsed)
      ? 0
      : parsed
    : raw === "" || isNaN(parsed)
      ? raw
      : parsed;

  const thresholdRaw = strField(row.querySelector(".event-threshold"));
  const thresholdParsed = Number(thresholdRaw);
  return newEvent({
    id: row.dataset.id || undefined,
    label: strField(row.querySelector(".event-label")),
    type: strField(row.querySelector(".event-type")) || "FROM_DATE",
    startDate: strField(row.querySelector(".event-start")),
    endDate: row.querySelector(".event-end")?.value || null,
    comparePath: row.querySelector(".event-compare-path")?.value || null,
    threshold: thresholdRaw === "" || isNaN(thresholdParsed) ? null : thresholdParsed,
    path: strField(row.querySelector(".event-path")),
    value: valueOut,
    delta: row.querySelector(".event-delta")?.checked ?? false,
  });
};

/**
 * @param {HTMLFormElement} form Scenario form.
 * @returns {object} Scenario model populated from form fields.
 */
export function readScenario(form) {
  return newScenario({
    name: form.querySelector("h2")?.textContent.replace("Scenario ", "") ?? "",
    startDate: strField(form.querySelector(".scenario-start-date")),
    liabilities: [...form.querySelectorAll(".liabilities-row")].map(readLiability),
    assets: [...form.querySelectorAll(".assets-row")].map(readAsset),
    incomes: [...form.querySelectorAll(".incomes-row")].map(readIncome),
    expenses: [...form.querySelectorAll(".expenses-row")].map(readExpense),
    events: [...form.querySelectorAll(".event-row")].map(readEvent),
  });
}

/**
 * @param {HTMLFormElement} form Scenario form.
 * @param {string} listSel Selector for the target `<ol>`.
 * @param {string} templateSel Selector for the row `<template>`.
 * @param {(row:HTMLElement)=>void} fill Populates the cloned row.
 * @returns {HTMLElement} The appended row element.
 */
function appendRow(form, listSel, templateSel, fill) {
  const list = form.querySelector(listSel);
  const tpl = form.querySelector(templateSel);
  const clone = tpl.content.cloneNode(true);
  const li = clone.firstElementChild;
  fill(li);
  list.appendChild(clone);
  return li;
}

/** @param {HTMLElement} row Target row. @param {object} L Liability model. */
const writeLiability = (row, L) => {
  row.dataset.id = L.id;
  setVal(row, ".liability-label", L.label);
  setVal(row, ".liability-balance", L.currentBalance);
  setVal(row, ".liability-rate", pct(L.interestRate));
  const isMinimum = L.repayment?.mode === "MINIMUM";
  const cb = row.querySelector(".liability-is-minimum");
  if (cb) cb.checked = isMinimum;
  setVal(row, ".liability-repayment-amount", L.repayment?.amount);
  setVal(row, ".liability-original-amount", L.repayment?.originalAmount);
  setVal(row, ".liability-original-term", L.repayment?.originalTerm);
  setVal(row, ".liability-repayment-freq", L.repayment?.freq);
  setVal(row, ".liability-repayment-pay-day", L.repayment?.payDayOffset);
};

/** @param {HTMLElement} row Target row. @param {object} A Asset model. */
const writeAsset = (row, A) => {
  row.dataset.id = A.id;
  setVal(row, ".asset-label", A.label);
  setVal(row, ".asset-balance", A.currentBalance);
  setVal(row, ".asset-rate", pct(A.interestRate));
  setVal(row, ".asset-tax", pct(A.taxOnInterest));
  setVal(row, ".asset-share", A.netShare);
  const isOffset = !!A.offset?.against;
  const cb = row.querySelector(".asset-is-offset");
  if (cb) cb.checked = isOffset;
  // Stash intended select values for rebuildAssetTargetSelects to consume.
  row.dataset.offsetAgainst = A.offset?.against ?? "";
  row.dataset.fallbackTo = A.offset?.fallback ?? "";
};

/** @param {HTMLElement} row Target row. @param {object} inc Income model. */
const writeIncome = (row, inc) => {
  row.dataset.id = inc.id;
  setVal(row, ".income-label", inc.label);
  setVal(row, ".income-amount", inc.amount);
  setVal(row, ".income-freq", inc.freq);
  setVal(row, ".income-pay-day", inc.payDayOffset);
};

/** @param {HTMLElement} row Target row. @param {object} ex Expense model. */
const writeExpense = (row, ex) => {
  row.dataset.id = ex.id;
  setVal(row, ".expense-label", ex.label);
  // Stored as a negative; CSS prefix conveys the sign so display the magnitude.
  setVal(row, ".expense-amount", Math.abs(ex.amount ?? 0));
  setVal(row, ".expense-freq", ex.freq);
};

/** @param {HTMLElement} row Target row. @param {object} evt Event model. */
const writeEvent = (row, evt) => {
  row.dataset.id = evt.id;
  setVal(row, ".event-label", evt.label);
  setVal(row, ".event-type", evt.type || "FROM_DATE");
  setVal(row, ".event-start", evt.startDate);
  setVal(row, ".event-end", evt.endDate);
  // Stash desired select values for rebuildEventPathOptions to consume.
  row.dataset.comparePath = evt.comparePath ?? "";
  row.dataset.path = evt.path ?? "";
  setVal(row, ".event-threshold", evt.threshold ?? "");
  // Populate both inputs so the visible one is correct regardless of mode.
  setVal(row, ".event-value", evt.value);
  setVal(row, ".event-transfer-amount", evt.value);
  const deltaCb = row.querySelector(".event-delta");
  if (deltaCb) deltaCb.checked = !!evt.delta;
};

/**
 * @param {HTMLFormElement} form Scenario form.
 * @param {object} [L] Liability model.
 * @returns {HTMLElement} The new row.
 */
export function appendLiabilityRow(form, L = newLiability()) {
  return appendRow(form, ".liabilities-list", ".liability-template", (row) =>
    writeLiability(row, L),
  );
}
/**
 * @param {HTMLFormElement} form Scenario form.
 * @param {object} [A] Asset model.
 * @returns {HTMLElement} The new row.
 */
export function appendAssetRow(form, A = newAsset()) {
  return appendRow(form, ".assets-list", ".asset-template", (row) => writeAsset(row, A));
}
/**
 * @param {HTMLFormElement} form Scenario form.
 * @param {object} [inc] Income model.
 * @returns {HTMLElement} The new row.
 */
export function appendIncomeRow(form, inc = newIncome()) {
  return appendRow(form, ".incomes-list", ".income-template", (row) => writeIncome(row, inc));
}
/**
 * @param {HTMLFormElement} form Scenario form.
 * @param {object} [ex] Expense model.
 * @returns {HTMLElement} The new row.
 */
export function appendExpenseRow(form, ex = newExpense()) {
  return appendRow(form, ".expenses-list", ".expense-template", (row) => writeExpense(row, ex));
}
/**
 * @param {HTMLFormElement} form Scenario form.
 * @param {object} [evt] Event model.
 * @returns {HTMLElement} The new row.
 */
export function appendEventRow(form, evt = newEvent()) {
  return appendRow(form, ".events-list", ".event-template", (row) => writeEvent(row, evt));
}

/**
 * @param {HTMLFormElement} form Scenario form.
 * @param {object} scenario Scenario model to populate the form with.
 */
export function writeScenario(form, scenario) {
  setVal(form, ".scenario-start-date", scenario.startDate);

  (scenario.liabilities ?? []).forEach((L) => appendLiabilityRow(form, L));
  (scenario.assets ?? []).forEach((A) => appendAssetRow(form, A));
  (scenario.incomes ?? []).forEach((inc) => appendIncomeRow(form, inc));
  (scenario.expenses ?? []).forEach((ex) => appendExpenseRow(form, ex));
  (scenario.events ?? []).forEach((evt) => appendEventRow(form, evt));
}

/** @returns {Array<object>} Every scenario, read fresh from the DOM. */
const readAllScenarios = () => [...document.querySelectorAll("#scenarios form")].map(readScenario);

/**
 * @param {(state:{scenarios:Array<object>}) => void} onInput Called on every form change.
 */
export function initInputs(onInput) {
  const scenariosEl = must("#scenarios");
  const fire = () => onInput({ scenarios: readAllScenarios() });

  fire();
  scenariosEl.addEventListener("input", (e) => {
    if (e.target.closest("form")) fire();
  });
  scenariosEl.addEventListener("scenarios-changed", fire);
}
