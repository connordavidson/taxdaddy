import { EMPTY, EMPTY_OWNER, EXAMPLE } from './tax.mjs';
import { rulesFor, SUPPORTED_TAX_YEARS } from './tax-rules/catalog.mjs';

const STORAGE_KEY = 'taxdaddy.planner.v1';

function restoreFields(defaults, saved) {
  const fields = { ...defaults };
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = saved?.[key];
    if (fallback === null || typeof fallback === 'number') {
      if (Number.isFinite(value) && value >= 0) fields[key] = value;
    } else if (typeof fallback === 'boolean' && typeof value === 'boolean') {
      fields[key] = value;
    }
  }
  return fields;
}

export function loadPlanner() {
  const fallback = { scenario: structuredClone(EXAMPLE), growth: {}, available: true };
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return { ...fallback, available: false };
  }
  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    return fallback;
  }
  const previous = saved?.scenario;
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) return fallback;

  const scenario = restoreFields(EMPTY, previous);
  if (!SUPPORTED_TAX_YEARS.includes(scenario.taxYear)) scenario.taxYear = EMPTY.taxYear;
  if (typeof previous.status === 'string' && Object.hasOwn(rulesFor(scenario.taxYear).statuses, previous.status)) {
    scenario.status = previous.status;
  }
  scenario.owners = EMPTY.owners.map((_, index) => restoreFields(EMPTY_OWNER, previous.owners?.[index]));
  return { scenario, growth: saved.growth ?? {}, available: true };
}

export function savePlanner(scenario, growth) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ scenario, growth }));
    return true;
  } catch {
    return false;
  }
}
