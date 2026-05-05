import {
  readScenario, writeScenario,
  appendLiabilityRow, appendAssetRow, appendIncomeRow, appendExpenseRow, appendEventRow,
} from './inputs.js';
import { rebuildEventPathOptions, rebuildAssetTargetSelects, getPath } from './events.js';
import { minimumRepayment } from './simulation.js';
import { must } from './utils.js';

const scenariosEl = must('#scenarios');
const scenarioTemplate = must('#scenario-template');

const APPENDERS = {
  '.liability-template': appendLiabilityRow,
  '.asset-template': appendAssetRow,
  '.income-template': appendIncomeRow,
  '.expense-template': appendExpenseRow,
  '.event-template': appendEventRow,
};

let scenarioCount = 0;

/**
 * @param {number} n 0-based index.
 * @returns {string} Spreadsheet-style label (A, B, ..., Z, AA, ...).
 */
function toLabel(n) {
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let label = '';
  for (n++; n > 0; n = Math.floor((n - 1) / 26)) {
    label = ALPHA[(n - 1) % 26] + label;
  }
  return label;
}

/** Disable the remove button on the last remaining scenario form. */
function updateRemoveButtons() {
  const forms = scenariosEl.querySelectorAll('form');
  const disabled = forms.length <= 1;
  forms.forEach(f => { f.querySelector('.remove-scenario').disabled = disabled; });
}

/** Dispatch a `scenarios-changed` custom event for listeners. */
function notifyChange() {
  scenariosEl.dispatchEvent(new CustomEvent('scenarios-changed', { bubbles: true }));
}

/**
 * @param {HTMLFormElement} form Scenario form.
 */
function refreshDynamicSelects(form) {
  rebuildAssetTargetSelects(form);
  rebuildEventPathOptions(form);
  refreshAssetShareHints(form);
  refreshLiabilityRepayments(form);
  refreshEventDeltaHints(form);
}

/**
 * @param {HTMLFormElement} form Scenario form.
 */
function refreshLiabilityRepayments(form) {
  form.querySelectorAll('.liabilities-row').forEach(refreshLiabilityRepayment);
}

/**
 * @param {HTMLElement} row Liability row.
 */
function refreshLiabilityRepayment(row) {
  const cb = row.querySelector('.liability-is-minimum');
  const amountInput = row.querySelector('.liability-repayment-amount');
  if (!cb || !amountInput) return;
  const isMinimum = cb.checked;
  amountInput.disabled = isMinimum;
  if (!isMinimum) return;

  const originalAmount = parseFloat(row.querySelector('.liability-original-amount')?.value) || 0;
  const ratePct = parseFloat(row.querySelector('.liability-rate')?.value) || 0;
  const term = parseFloat(row.querySelector('.liability-original-term')?.value) || 0;
  const freq = row.querySelector('.liability-repayment-freq')?.value || 'MONTHLY';
  const pmt = minimumRepayment(originalAmount, ratePct / 100, term, freq);
  // Round to cents so the input doesn't fight the user with 8-digit floats.
  amountInput.value = pmt > 0 ? pmt.toFixed(2) : '0';
}

/**
 * @param {HTMLFormElement} form Scenario form.
 */
function refreshAssetShareHints(form) {
  const rows = [...form.querySelectorAll('.assets-row')];
  const shares = rows.map(r => parseFloat(r.querySelector('.asset-share')?.value) || 0);
  const total = shares.reduce((s, x) => s + x, 0);
  rows.forEach((row, i) => {
    const hint = row.querySelector('.asset-share-hint');
    if (!hint) return;
    if (total > 0 && shares[i] > 0) {
      const pct = (shares[i] / total) * 100;
      hint.textContent = `(${pct.toFixed(0)}%)`;
    } else {
      hint.textContent = '';
    }
  });
}

/**
 * @param {*} v Value to format.
 * @returns {string} Short numeric string, or `String(v)` for non-numbers.
 */
function formatHintValue(v) {
  if (v == null) return '—';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return String(v);
    return Math.abs(v) >= 1
      ? v.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  return String(v);
}

/**
 * @param {HTMLFormElement} form Scenario form.
 */
function refreshEventDeltaHints(form) {
  const rows = [...form.querySelectorAll('.event-row')];
  if (rows.length === 0) return;
  const scenario = readScenario(form);
  rows.forEach(row => {
    const hint = row.querySelector('.event-delta-hint');
    if (!hint) return;
    const isDelta = row.querySelector('.event-delta')?.checked;
    if (!isDelta) { hint.textContent = ''; return; }
    const path = row.querySelector('.event-path')?.value || '';
    const raw = row.querySelector('.event-value')?.value ?? '';
    const delta = Number(raw);
    const current = getPath(scenario, path);
    if (typeof current !== 'number' || !Number.isFinite(current) || raw === '' || !Number.isFinite(delta)) {
      hint.textContent = '';
      return;
    }
    hint.textContent = `(${formatHintValue(current)} → ${formatHintValue(current + delta)})`;
  });
}

/**
 * @param {HTMLFormElement} form New scenario form.
 */
function insertForm(form) {
  form.querySelector('h2').textContent = `Scenario ${toLabel(scenarioCount)}`;
  form.dataset.scenarioIndex = scenarioCount++;
  scenariosEl.insertBefore(form, scenarioTemplate);
  updateRemoveButtons();
}

/** @returns {HTMLFormElement} A blank scenario form cloned from the template. */
function newForm() {
  return scenarioTemplate.content.cloneNode(true).querySelector('form');
}

function addScenario() {
  const form = newForm();
  insertForm(form);
  refreshDynamicSelects(form);
}

/**
 * @param {HTMLFormElement} sourceForm Form to copy data from.
 */
function duplicateScenario(sourceForm) {
  const form = newForm();
  insertForm(form);
  writeScenario(form, readScenario(sourceForm));
  refreshDynamicSelects(form);
}

/**
 * @param {Array<object>} scenarios Persisted scenarios to seed the UI with.
 */
export function initScenarios(scenarios) {
  if (scenarios.length === 0) {
    addScenario();
  } else {
    scenarios.forEach(scenario => {
      const form = newForm();
      insertForm(form);
      writeScenario(form, scenario);
      refreshDynamicSelects(form);
    });
  }

  scenariosEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const form = btn.closest('form');
    let dynamicSelectsDirty = false;

    if (btn.id === 'add-scenario') {
      addScenario();
    } else if (btn.classList.contains('duplicate-scenario')) {
      duplicateScenario(form);
    } else if (btn.classList.contains('remove-scenario')) {
      form.remove();
      updateRemoveButtons();
    } else if (btn.classList.contains('add-row')) {
      const appender = APPENDERS[btn.dataset.template];
      if (!appender) return;
      appender(form);
      dynamicSelectsDirty = true;
    } else if (btn.classList.contains('remove-row')) {
      btn.closest('li').remove();
      dynamicSelectsDirty = true;
    } else {
      return;
    }

    if (dynamicSelectsDirty && form) refreshDynamicSelects(form);
    notifyChange();
  });

  // Live-refresh the dependent selects + hints whenever a label or related
  // input changes.
  scenariosEl.addEventListener('input', (e) => {
    const target = e.target;
    if (!target) return;
    const form = target.closest('form');
    if (!form) return;

    if (target.matches('.liability-label, .asset-label, .income-label, .expense-label')) {
      rebuildAssetTargetSelects(form);
      rebuildEventPathOptions(form);
      refreshEventDeltaHints(form);
    } else if (target.matches('.asset-share')) {
      refreshAssetShareHints(form);
    } else if (target.matches('.liability-is-minimum, .liability-rate, .liability-original-amount, .liability-original-term, .liability-repayment-freq')) {
      const row = target.closest('.liabilities-row');
      if (row) refreshLiabilityRepayment(row);
      refreshEventDeltaHints(form);
    } else if (target.matches('.event-compare-path, .event-path')) {
      // Mode may have flipped (transfer ↔ config); rebuild updates both
      // selects and recomputes data-event-mode for CSS to react to.
      rebuildEventPathOptions(form);
      refreshEventDeltaHints(form);
    } else if (target.matches('.event-value, .event-transfer-amount')) {
      // Mirror the two value-bearing inputs so switching modes doesn't drop
      // the number the user just typed.
      const row = target.closest('.event-row');
      if (row) {
        const v = target.value;
        const other = target.matches('.event-value')
          ? row.querySelector('.event-transfer-amount')
          : row.querySelector('.event-value');
        if (other && other.value !== v) other.value = v;
      }
      refreshEventDeltaHints(form);
    } else if (target.matches('.event-delta')) {
      refreshEventDeltaHints(form);
    } else if (target.closest('.liabilities-row, .assets-row, .incomes-row, .expenses-row')) {
      // Any other source-row edit could shift a delta hint's `current`.
      refreshEventDeltaHints(form);
    }
  });
}
