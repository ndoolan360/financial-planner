import { applyEvents } from "./events.js";
import { parseDate, addDays, formatDate, daysInYear, amountOnDay } from "./utils.js";

// Maximum number of days to simulate (50 years).
const CAP_DAYS = Math.floor(50 * 365.25);

const FREQ_PER_YEAR = {
  DAILY: 365,
  WEEKLY: 52,
  FORTNIGHTLY: 26,
  MONTHLY: 12,
  QUARTERLY: 4,
  YEARLY: 1,
};

const EMPTY_RESULT = {
  series: [],
  ledger: {},
  summary: {
    finalAssetsTotal: 0,
    finalLiabilitiesTotal: 0,
    totalLiabilityInterest: 0,
    totalAssetInterest: 0,
    totalTax: 0,
    totalRepayment: 0,
    payoffDate: null,
    negativeAssetDate: null,
    cappedOut: false,
    days: 0,
  },
};

/**
 * @param {number} originalAmount Loan principal at origination.
 * @param {number} annualRate Annual interest rate (decimal, e.g. 0.0575).
 * @param {number} originalTerm Original term in years.
 * @param {string} freq Repayment frequency key (DAILY/WEEKLY/...).
 * @returns {number} Amortised payment per period.
 */
export function minimumRepayment(originalAmount, annualRate, originalTerm, freq) {
  const principal = Number(originalAmount) || 0;
  const perYear = FREQ_PER_YEAR[freq] ?? 12;
  const periods = (Number(originalTerm) || 0) * perYear;
  const periodicRate = (Number(annualRate) || 0) / perYear;

  if (!(principal > 0) || !(periods > 0)) return 0;
  if (!(periodicRate > 0)) return principal / periods;
  const factor = Math.pow(1 + periodicRate, periods);
  return (principal * (periodicRate * factor)) / (factor - 1);
}

// Paid-off liabilities are dropped from snapshots so the chart treats them
// as removed once they hit zero.
/**
 * @param {Array<{id:string, balance:number}>} liabilities Runtime liabilities.
 * @param {Array<{id:string, balance:number}>} assets Runtime assets.
 * @returns {{liabilities:Array, assets:Array}} A serialisable snapshot for the chart.
 */
const snapshot = (liabilities, assets) => ({
  liabilities: liabilities
    .filter((L) => L.balance > 0)
    .map((L) => ({ id: L.id, balance: L.balance })),
  assets: assets.map((A) => ({ id: A.id, balance: A.balance })),
});

/**
 * @param {number} cash Net cash available today (may be negative).
 * @param {Array<{netShare:number, balance:number}>} assets Runtime assets.
 */
function distributeCashflow(cash, assets) {
  if (!cash || assets.length === 0) return;
  const shares = assets.map((a) => Math.max(0, Number(a.netShare) || 0));
  const total = shares.reduce((s, x) => s + x, 0);
  if (total > 0) {
    assets.forEach((a, i) => {
      a.balance += cash * (shares[i] / total);
    });
  } else {
    const slice = cash / assets.length;
    for (const a of assets) a.balance += slice;
  }
}

/**
 * @param {Array<{id:string, balance:number}>} liabilities Runtime liabilities.
 * @param {Array<{id:string, balance:number, offset:object}>} assets Runtime assets.
 */
function rebalanceOffsets(liabilities, assets) {
  for (const a of assets) {
    const againstId = a.offset?.against;
    const fallbackId = a.offset?.fallback;
    if (!againstId || !fallbackId) continue;
    const lia = liabilities.find((L) => L.id === againstId);
    if (!lia) continue;
    const cap = Math.max(0, lia.balance);
    const excess = a.balance - cap;
    if (excess <= 0) continue;
    const fb = assets.find((x) => x.id === fallbackId);
    if (!fb || fb === a) continue;
    a.balance -= excess;
    fb.balance += excess;
  }
}

/**
 * @param {Array<{id:string, balance:number, offset:object}>} assets Runtime assets.
 */
function redrawFromFallback(assets) {
  for (const a of assets) {
    if (a.balance >= 0) continue;
    const fallbackId = a.offset?.fallback;
    if (!fallbackId) continue;
    const fb = assets.find((x) => x.id === fallbackId);
    if (!fb || fb === a) continue;
    const draw = Math.min(-a.balance, Math.max(0, fb.balance));
    if (draw <= 0) continue;
    a.balance += draw;
    fb.balance -= draw;
  }
}

/**
 * @param {object} scenario Scenario to simulate.
 * @param {number} [minDays=0] Keep looping past payoff up to this many days.
 * @returns {{series:Array, summary:object}} Per-day series plus aggregates.
 */
function simulateOne(scenario, minDays = 0) {
  if (!scenario || !scenario.startDate) return EMPTY_RESULT;

  const startDate = parseDate(scenario.startDate);
  const liabilities = (scenario.liabilities || []).map((L) => ({
    id: L.id,
    balance: Number(L.currentBalance) || 0,
  }));
  const assets = (scenario.assets || []).map((A) => ({
    id: A.id,
    balance: Number(A.currentBalance) || 0,
    // Mirror the offset linkage so rebalanceOffsets can walk it without
    // needing the (event-mutable) scenario config.
    offset: {
      against: A.offset?.against ?? null,
      fallback: A.offset?.fallback ?? null,
    },
    netShare: Number(A.netShare) || 0,
  }));

  // Empty-liabilities scenarios still run for `minDays` so their assets stay
  // comparable with longer scenarios.
  const hadLiabilities = liabilities.length > 0;
  let liabilitiesCleared = !hadLiabilities;

  const series = [snapshot(liabilities, assets)];
  // Per-liability daily ledger keyed by id. Each entry corresponds to one
  // simulated day: opening balance, interest accrued that day, repayment
  // paid that day, and closing balance. Indexes line up with `series[i+1]`.
  const ledger = Object.fromEntries(liabilities.map((L) => [L.id, []]));
  let totalLiabilityInterest = 0;
  let totalAssetInterest = 0;
  let totalTax = 0;
  let totalRepayment = 0;
  let payoffDate = null;
  let negativeAssetDate = null;
  let cappedOut = false;

  const targetDays = Math.min(CAP_DAYS, Math.max(0, minDays | 0));

  let day = 0;
  for (; day < CAP_DAYS; day++) {
    // Stop once paid off AND we've reached the requested minimum length.
    if (liabilitiesCleared && day >= targetDays) break;
    const date = addDays(startDate, day);
    const dateStr = formatDate(date);

    const runtime = { liabilities, assets };
    const eff = applyEvents(scenario, dateStr, runtime);
    const effLiabs = eff.liabilities || [];
    const effAssets = eff.assets || [];
    const effIncomes = eff.incomes || [];
    const effExpenses = eff.expenses || [];

    const diy = daysInYear(date);

    // Capture opening balances before any same-day mutation so the ledger
    // reflects the pre-interest, pre-repayment state.
    const openingBalances = liabilities.map((L) => L.balance);
    const dailyInterest = Array.from({ length: liabilities.length }).fill(0);
    const dailyRepayment = Array.from({ length: liabilities.length }).fill(0);

    // 1. Sum offset asset balances per liability id.
    const offsetSum = new Map();
    for (const a of assets) {
      const id = a.offset.against;
      if (!id) continue;
      offsetSum.set(id, (offsetSum.get(id) || 0) + Math.max(0, a.balance));
    }

    // 2. Accrue liability interest on the offset-reduced base.
    liabilities.forEach((L, i) => {
      if (L.balance <= 0) return;
      const rate = Number(effLiabs[i]?.interestRate) || 0;
      if (rate <= 0) return;
      const base = Math.max(0, L.balance - (offsetSum.get(L.id) || 0));
      const interest = (base * rate) / diy;
      L.balance += interest;
      totalLiabilityInterest += interest;
      dailyInterest[i] = interest;
    });

    // 3. Accrue asset interest (offsets earn 0%) and deduct tax.
    assets.forEach((A, i) => {
      if (A.offset.against) return;
      const cfg = effAssets[i];
      const rate = Number(cfg?.interestRate) || 0;
      if (!rate) return;
      const interest = (A.balance * rate) / diy;
      const taxRate = Number(cfg?.taxOnInterest) || 0;
      const tax = interest > 0 ? interest * taxRate : 0;
      A.balance += interest - tax;
      totalAssetInterest += interest;
      totalTax += tax;
    });

    // 4. Net cashflow. Expenses are stored as negative amounts.
    let cashPool = 0;
    for (const inc of effIncomes) cashPool += amountOnDay(inc, date, startDate);
    for (const ex of effExpenses) cashPool += amountOnDay(ex, date, startDate);

    // 5. Repayments due today.
    liabilities.forEach((L, i) => {
      if (L.balance <= 0) return;
      const cfg = effLiabs[i];
      const rep = cfg?.repayment;
      if (!rep) return;
      const amount =
        rep.mode === "MINIMUM"
          ? minimumRepayment(rep.originalAmount, cfg.interestRate, rep.originalTerm, rep.freq)
          : Number(rep.amount) || 0;
      const due = amountOnDay(
        { amount, freq: rep.freq, payDayOffset: rep.payDayOffset },
        date,
        startDate,
      );
      if (due <= 0) return;
      const pay = Math.min(due, L.balance);
      L.balance -= pay;
      cashPool -= pay;
      totalRepayment += pay;
      dailyRepayment[i] = pay;
    });

    // 6. Distribute net cash, push offset overflow to fallback, redraw if
    //    the offset has gone negative.
    distributeCashflow(cashPool, assets);
    rebalanceOffsets(liabilities, assets);
    redrawFromFallback(assets);

    // 7. Record the first day any individual asset goes negative.
    if (!negativeAssetDate) {
      for (const A of assets) {
        if (A.balance < 0) {
          negativeAssetDate = dateStr;
          break;
        }
      }
    }

    series.push(snapshot(liabilities, assets));

    // Append today's per-liability ledger row.
    liabilities.forEach((L, i) => {
      ledger[L.id].push({
        date: dateStr,
        open: openingBalances[i],
        interest: dailyInterest[i],
        repayment: dailyRepayment[i],
        close: Math.max(0, L.balance),
      });
    });

    // 8. Record payoffDate the first day everything is cleared; keep looping
    //    until `targetDays` so assets continue to grow.
    if (!liabilitiesCleared) {
      const remaining = liabilities.reduce((s, L) => s + Math.max(0, L.balance), 0);
      if (remaining <= 0) {
        liabilitiesCleared = true;
        payoffDate = dateStr;
      }
    }
  }

  if (hadLiabilities && !payoffDate && day >= CAP_DAYS) cappedOut = true;

  const finalLiabilitiesTotal = liabilities.reduce((s, L) => s + Math.max(0, L.balance), 0);
  const finalAssetsTotal = assets.reduce((s, A) => s + A.balance, 0);

  return {
    series,
    ledger,
    summary: {
      finalAssetsTotal,
      finalLiabilitiesTotal,
      totalLiabilityInterest,
      totalAssetInterest,
      totalTax,
      totalRepayment,
      payoffDate,
      negativeAssetDate,
      cappedOut,
      days: series.length - 1,
    },
  };
}

/**
 * @param {Array<object>} scenarios Scenarios to simulate.
 * @returns {{results:Array<{series:Array, summary:object}>, simDuration:number}}
 *   Per-scenario results plus the longest day count for chart-axis alignment.
 */
export function simulateAll(scenarios) {
  const list = scenarios || [];

  const firstPass = list.map((s) => simulateOne(s, 0));
  const target = Math.max(0, ...firstPass.map((r) => r.summary.days));

  const results = list.map((s, i) =>
    firstPass[i].summary.days >= target ? firstPass[i] : simulateOne(s, target),
  );

  return { results, simDuration: target };
}
