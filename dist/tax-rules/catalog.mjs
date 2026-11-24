import { TAX_RULES_2027 } from './2027.mjs';

export const DEFAULT_TAX_YEAR = 2027;

const publishedRules = new Map([
  [TAX_RULES_2027.year, TAX_RULES_2027],
]);

export const SUPPORTED_TAX_YEARS = Object.freeze([...publishedRules.keys()].sort((a, b) => b - a));

export function rulesFor(year) {
  const rules = publishedRules.get(year);
  if (!rules) throw new RangeError(`No published rules configured for tax year ${year}`);
  return rules;
}
