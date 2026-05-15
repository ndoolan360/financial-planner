/**
 * @param {object} obj Target; cloned along the path so it isn't mutated.
 * @param {string} path Dotted path (e.g. `incomes.0.amount`).
 * @param {*} value Value to write at the leaf.
 */
export function setPath(obj, path, value) {
  const keys = path.split(".");
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = /^\d+$/.test(keys[i]) ? parseInt(keys[i]) : keys[i];
    current[key] = Array.isArray(current[key]) ? [...current[key]] : { ...current[key] };
    current = current[key];
  }

  const last = keys[keys.length - 1];
  const lastKey = /^\d+$/.test(last) ? parseInt(last) : last;
  current[lastKey] = value;
}

/**
 * @param {object} obj Source object.
 * @param {string} path Dotted path.
 * @returns {*} Value at `path`, or undefined if any segment is missing.
 */
export function getPath(obj, path) {
  if (!path) return undefined;
  const keys = path.split(".");
  let cur = obj;
  for (const k of keys) {
    if (cur == null) return undefined;
    const key = /^\d+$/.test(k) ? parseInt(k) : k;
    cur = cur[key];
  }
  return cur;
}

// VALUE_EQ tolerance — strict equality basically never fires on a
// daily-compounding balance.
const EQ_EPSILON = 1e-9;

const BALANCE_PATH_RE = /^(liabilities|assets)\.\d+\.balance$/;

/** True if `path` targets a runtime balance. */
export const isBalancePath = (path) => typeof path === "string" && BALANCE_PATH_RE.test(path);

/**
 * @param {{liabilities:Array, assets:Array}} runtime Live runtime arrays.
 * @param {string} path Balance path.
 * @returns {?{balance:number}} The runtime item, or null.
 */
function runtimeItem(runtime, path) {
  if (!isBalancePath(path)) return null;
  const [collection, idx] = path.split(".");
  const arr = collection === "liabilities" ? runtime?.liabilities : runtime?.assets;
  return arr?.[parseInt(idx)] ?? null;
}

/**
 * @param {object} scenario Event-resolved scenario clone.
 * @param {{liabilities:Array, assets:Array}} runtime Live runtime arrays.
 * @param {string} path Path to read.
 * @returns {*} Scalar value, or undefined.
 */
function resolveScalar(scenario, runtime, path) {
  if (!path) return undefined;
  if (isBalancePath(path)) return runtimeItem(runtime, path)?.balance;
  return getPath(scenario, path);
}

/**
 * @param {object} event Event row.
 * @param {string} dateStr Today as `YYYY-MM-DD`.
 * @param {object} scenario Resolved scenario for trigger reads.
 * @param {{liabilities:Array, assets:Array}} runtime Live runtime arrays.
 * @returns {boolean} True when the event's trigger fires today.
 */
function isActive(event, dateStr, scenario, runtime) {
  switch (event.type) {
    case "BETWEEN_DATES":
      if (!event.startDate || !event.endDate) return false;
      return dateStr >= event.startDate && dateStr <= event.endDate;
    case "VALUE_GT":
    case "VALUE_GTE":
    case "VALUE_EQ":
    case "VALUE_LTE":
    case "VALUE_LT": {
      const lhs = resolveScalar(scenario, runtime, event.comparePath);
      const rhs = Number(event.threshold);
      if (typeof lhs !== "number" || !Number.isFinite(lhs) || !Number.isFinite(rhs)) return false;
      switch (event.type) {
        case "VALUE_GT":
          return lhs > rhs;
        case "VALUE_GTE":
          return lhs >= rhs;
        case "VALUE_EQ":
          return Math.abs(lhs - rhs) < EQ_EPSILON;
        case "VALUE_LTE":
          return lhs <= rhs;
        case "VALUE_LT":
          return lhs < rhs;
      }
      return false;
    }
    case "FROM_DATE":
    default:
      if (!event.startDate) return false;
      return dateStr >= event.startDate;
  }
}

/**
 * Apply an event's effect.
 *   - Transfer (path & comparePath both balance paths): move `value` from
 *     src to dst, signed per item kind. Clamps so an asset source can't go
 *     below 0 and a liability destination can't be overpaid past 0; mutates
 *     `runtime` directly.
 *   - Override (default): write `value` to `path` on the clone.
 *   - Delta: read current numeric value at `path`, write current + value.
 *
 * @param {object} clone Scenario clone to write overrides/deltas into.
 * @param {{liabilities:Array, assets:Array}} runtime Live runtime arrays (for transfers).
 * @param {object} event Event row.
 */
function applyEffect(clone, runtime, event) {
  const writeIsBalance = isBalancePath(event.path);
  const compareIsBalance = isBalancePath(event.comparePath);

  if (writeIsBalance && compareIsBalance) {
    const requested = Number(event.value);
    if (!Number.isFinite(requested) || requested <= 0) return;
    const src = runtimeItem(runtime, event.comparePath);
    const dst = runtimeItem(runtime, event.path);
    if (!src || !dst || src === dst) return;

    const srcIsLiability = event.comparePath.startsWith("liabilities.");
    const dstIsLiability = event.path.startsWith("liabilities.");

    let amount = requested;
    if (!srcIsLiability) amount = Math.min(amount, Math.max(0, src.balance));
    if (dstIsLiability) amount = Math.min(amount, Math.max(0, dst.balance));
    if (amount <= 0) return;

    src.balance += srcIsLiability ? amount : -amount;
    dst.balance += dstIsLiability ? -amount : amount;
    return;
  }

  // Direct balance writes without a balance comparePath aren't exposed in
  // the UI; ignore so a malformed event can't silently corrupt state.
  if (writeIsBalance) return;

  if (!event.delta) {
    setPath(clone, event.path, event.value);
    return;
  }
  const current = getPath(clone, event.path);
  const add = Number(event.value);
  if (typeof current !== "number" || !Number.isFinite(current) || !Number.isFinite(add)) return;
  setPath(clone, event.path, current + add);
}

/**
 * Walk every event in array order and apply each active one to a scenario
 * clone for `dateStr`. Last-write-wins on conflicting paths; deltas stack.
 *
 * @param {object} scenario Scenario whose events to apply.
 * @param {string} dateStr Today as `YYYY-MM-DD`.
 * @param {{liabilities:Array, assets:Array}} [runtime] Live balances for VALUE_* triggers.
 * @returns {object} Resolved scenario clone, or the original if nothing fires.
 */
export function applyEvents(scenario, dateStr, runtime = null) {
  const events = scenario.events;
  if (!events || events.length === 0) return scenario;

  let clone = null;

  for (const event of events) {
    if (!event.path) continue;
    // Active-check reads from `clone ?? scenario` so later events see the
    // effects of earlier ones in the same day.
    if (!isActive(event, dateStr, clone ?? scenario, runtime)) continue;

    if (!clone) clone = { ...scenario };
    applyEffect(clone, runtime, event);
  }

  return clone ?? scenario;
}

/**
 * @param {HTMLFormElement} form Scenario form.
 * @param {string} rowSel Row selector.
 * @param {string} labelSel Label-input selector within each row.
 * @param {string} fallback Fallback label prefix when the input is empty.
 * @returns {Array<{id:string, label:string}>} One entry per row.
 */
function collectRowLabels(form, rowSel, labelSel, fallback) {
  return [...form.querySelectorAll(rowSel)].map((row, i) => ({
    id: row.dataset.id || "",
    label: row.querySelector(labelSel)?.value?.trim() || `${fallback} ${i + 1}`,
  }));
}

/**
 * @param {HTMLFormElement} form Scenario form.
 * @param {{includeBalances?:boolean}} [opts] Whether to include `*.balance` paths.
 * @returns {Array<{label:string, options:Array<{value:string, text:string}>}>} Optgroup tree.
 */
function buildPathOptions(form, { includeBalances = false } = {}) {
  const liabilities = collectRowLabels(form, ".liabilities-row", ".liability-label", "Liability");
  const assets = collectRowLabels(form, ".assets-row", ".asset-label", "Asset");
  const incomes = collectRowLabels(form, ".incomes-row", ".income-label", "Income");
  const expenses = collectRowLabels(form, ".expenses-row", ".expense-label", "Expense");

  const groups = [];

  liabilities.forEach((L, i) => {
    const options = [];
    if (includeBalances) options.push({ value: `liabilities.${i}.balance`, text: "Balance" });
    options.push(
      { value: `liabilities.${i}.interestRate`, text: "Interest rate" },
      { value: `liabilities.${i}.repayment.amount`, text: "Repayment amount" },
      { value: `liabilities.${i}.repayment.freq`, text: "Repayment frequency" },
      { value: `liabilities.${i}.repayment.payDayOffset`, text: "Repayment pay day" },
    );
    groups.push({ label: L.label, options });
  });

  assets.forEach((A, i) => {
    const options = [];
    if (includeBalances) options.push({ value: `assets.${i}.balance`, text: "Balance" });
    options.push(
      { value: `assets.${i}.interestRate`, text: "Interest rate" },
      { value: `assets.${i}.taxOnInterest`, text: "Tax on interest" },
      { value: `assets.${i}.netShare`, text: "Net share" },
      { value: `assets.${i}.offset.against`, text: "Offset against" },
      { value: `assets.${i}.offset.fallback`, text: "Fallback to" },
    );
    groups.push({ label: A.label, options });
  });

  incomes.forEach((inc, i) => {
    groups.push({
      label: inc.label,
      options: [
        { value: `incomes.${i}.amount`, text: "Amount" },
        { value: `incomes.${i}.freq`, text: "Frequency" },
        { value: `incomes.${i}.payDayOffset`, text: "Pay day" },
      ],
    });
  });

  expenses.forEach((ex, i) => {
    groups.push({
      label: ex.label,
      options: [
        { value: `expenses.${i}.amount`, text: "Amount" },
        { value: `expenses.${i}.freq`, text: "Frequency" },
      ],
    });
  });

  return groups;
}

/**
 * @param {HTMLSelectElement} select Target select.
 * @param {Array<{label:string, options:Array<{value:string, text:string}>}>} groups Optgroup tree.
 * @param {string} [currentValue] Value to keep selected if still present.
 */
function populateEventPathSelect(select, groups, currentValue) {
  select.innerHTML = groups
    .map(
      (g) =>
        `<optgroup label="${g.label}">${g.options
          .map((o) => `<option value="${o.value}">${o.text}</option>`)
          .join("")}</optgroup>`,
    )
    .join("");
  if (currentValue) select.value = currentValue;
}

/**
 * Rebuild path option lists in every event row of `form`. The compare path
 * select always offers `*.balance` paths; the effect path select includes
 * them only when the row's compare path is itself a balance path — that's
 * how a row enters "transfer" mode rather than acting as a config override.
 * Sets `data-event-mode="transfer"` on rows in transfer mode.
 *
 * @param {HTMLFormElement} form Scenario form.
 */
export function rebuildEventPathOptions(form) {
  const writeGroupsConfig = buildPathOptions(form, { includeBalances: false });
  const writeGroupsTransfer = buildPathOptions(form, { includeBalances: true });
  const compareGroups = buildPathOptions(form, { includeBalances: true });

  form.querySelectorAll(".event-row").forEach((row) => {
    const cmp = row.querySelector(".event-compare-path");
    let cmpDesired;
    if (cmp) {
      cmpDesired = row.dataset.comparePath ?? cmp.value;
      populateEventPathSelect(cmp, compareGroups, cmpDesired);
      delete row.dataset.comparePath;
      // The select may have rejected the desired value (e.g. a renamed item);
      // resync to whatever it actually settled on.
      cmpDesired = cmp.value;
    }

    const path = row.querySelector(".event-path");
    if (path) {
      const isTransferRow = isBalancePath(cmpDesired);
      const groups = isTransferRow ? writeGroupsTransfer : writeGroupsConfig;
      const desired = row.dataset.path ?? path.value;
      populateEventPathSelect(path, groups, desired);
      delete row.dataset.path;
      row.dataset.eventMode = isTransferRow && isBalancePath(path.value) ? "transfer" : "";
    }
  });
}

/**
 * @param {HTMLSelectElement} select Target select.
 * @param {Array<{value:string, text:string}>} options New option list.
 * @param {string} [desiredValue] Value to keep selected if still present.
 */
function populateSelect(select, options, desiredValue) {
  const current = desiredValue ?? select.value;
  select.innerHTML = options.map((o) => `<option value="${o.value}">${o.text}</option>`).join("");
  const has = options.some((o) => o.value === current);
  select.value = has ? current : "";
}

/**
 * Rebuild the `Offset against` and `Fallback to` selects on every asset row.
 * Honours staged `data-offset-against` / `data-fallback-to` values on first
 * pass, then tracks user-driven changes.
 *
 * @param {HTMLFormElement} form Scenario form.
 */
export function rebuildAssetTargetSelects(form) {
  const liabilityRows = [...form.querySelectorAll(".liabilities-row")];
  const liabilityOpts = [
    { value: "", text: "None" },
    ...liabilityRows.map((row, i) => ({
      value: row.dataset.id || "",
      text: row.querySelector(".liability-label")?.value?.trim() || `Liability ${i + 1}`,
    })),
  ];

  const assetRows = [...form.querySelectorAll(".assets-row")];

  assetRows.forEach((row, i) => {
    const againstSel = row.querySelector(".asset-offset-against");
    if (againstSel) {
      const desired = row.dataset.offsetAgainst ?? undefined;
      populateSelect(againstSel, liabilityOpts, desired);
      delete row.dataset.offsetAgainst;
    }

    const fallbackSel = row.querySelector(".asset-fallback-to");
    if (fallbackSel) {
      const fallbackOpts = [
        { value: "", text: "None" },
        ...assetRows
          .filter((r, j) => j !== i)
          .map((r, j) => ({
            value: r.dataset.id || "",
            text: r.querySelector(".asset-label")?.value?.trim() || `Asset ${j + 1}`,
          })),
      ];
      const desired = row.dataset.fallbackTo ?? undefined;
      populateSelect(fallbackSel, fallbackOpts, desired);
      delete row.dataset.fallbackTo;
    }
  });
}
