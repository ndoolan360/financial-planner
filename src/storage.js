const KEY = "financial-planner.state";

/** @returns {{scenarios:Array}} Empty default state. */
const defaultState = () => ({ scenarios: [] });

/** @returns {{scenarios:Array}} Persisted state, or a fresh default. */
export const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? defaultState();
  } catch {
    return defaultState();
  }
};

/**
 * @param {{scenarios:Array}} state State to persist.
 */
export const save = (state) => {
  localStorage.setItem(KEY, JSON.stringify(state));
};
