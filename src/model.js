/** @returns {string} A unique id, preferring `crypto.randomUUID` when available. */
const uuid = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `id_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;

/**
 * @param {object} [overrides] Field overrides merged on top of the defaults.
 * @returns {object} A liability row.
 */
export const newLiability = (overrides = {}) => ({
  id: `lia_${uuid()}`,
  label: "",
  currentBalance: 0,
  interestRate: 0,
  repayment: {
    mode: "FIXED",
    amount: 0,
    originalAmount: 0,
    originalTerm: 0,
    freq: "MONTHLY",
    payDayOffset: 1,
  },
  ...overrides,
});

/**
 * @param {object} [overrides] Field overrides merged on top of the defaults.
 * @returns {object} An asset row.
 */
export const newAsset = (overrides = {}) => ({
  id: `ass_${uuid()}`,
  label: "",
  currentBalance: 0,
  interestRate: 0,
  taxOnInterest: 0,
  netShare: 0,
  offset: { against: null, fallback: null },
  ...overrides,
});

/**
 * @param {object} [overrides] Field overrides merged on top of the defaults.
 * @returns {object} An income row.
 */
export const newIncome = (overrides = {}) => ({
  id: `inc_${uuid()}`,
  label: "",
  amount: 0,
  freq: "MONTHLY",
  payDayOffset: 1,
  ...overrides,
});

/**
 * @param {object} [overrides] Field overrides merged on top of the defaults.
 * @returns {object} An expense row.
 */
export const newExpense = (overrides = {}) => ({
  id: `exp_${uuid()}`,
  label: "",
  amount: 0,
  freq: "MONTHLY",
  ...overrides,
});

/**
 * @param {object} [overrides] Field overrides merged on top of the defaults.
 * @returns {object} An event row.
 */
export const newEvent = (overrides = {}) => ({
  id: `evt_${uuid()}`,
  label: "",
  type: "FROM_DATE",
  startDate: "",
  endDate: null,
  path: "",
  comparePath: null,
  delta: false,
  value: 0,
  threshold: null,
  ...overrides,
});

/** @returns {string} Today's date as `YYYY-MM-DD`. */
const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * @param {object} [overrides] Field overrides merged on top of the defaults.
 * @returns {object} A scenario.
 */
export const newScenario = (overrides = {}) => ({
  name: "",
  startDate: todayISO(),
  liabilities: [],
  assets: [],
  incomes: [],
  expenses: [],
  events: [],
  ...overrides,
});
