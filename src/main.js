import { initScenarios } from './scenarios.js';
import { initInputs } from './inputs.js';
import { load, save } from './storage.js';
import { simulateAll } from './simulation.js';
import { renderSummary } from './summary.js';
import { renderChart } from './chart.js';
import { renderSchedule } from './schedule.js';
import { debounce } from './utils.js';

/**
 * @param {{scenarios:Array<object>}} state Latest UI state.
 */
const runAndRender = ({ scenarios }) => {
  const { results, simDuration } = simulateAll(scenarios);
  const named = results.map((r, i) => ({ ...r, name: scenarios[i].name }));
  renderSummary(named, simDuration);
  renderChart(named, simDuration);
  renderSchedule(
    named.map((r, i) => ({ name: r.name, scenario: scenarios[i], ledger: r.ledger }))
  );
};

const debouncedRunAndRender = debounce(runAndRender, 250);

/**
 * @param {{scenarios:Array<object>}} state Latest UI state.
 */
const onInput = (state) => {
  save(state);
  debouncedRunAndRender(state);
};

const scenarios = load()?.scenarios ?? [];
initScenarios(scenarios);
initInputs(onInput);
