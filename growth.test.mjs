import assert from 'node:assert/strict';
import test from 'node:test';
import { projectGrowth } from './dist/growth.mjs';
import { EMPTY } from './dist/tax.mjs';

const scenario = () => structuredClone(EMPTY);
const dollars = amount => Math.round(amount * 100) / 100;

test('one-time withdrawals remove future compounding from each affected account', () => {
  const input = scenario();
  input.brokerageBalance = 100000;
  input.brokeragePrincipal = 9000;
  input.brokerageIncomeDraw = 1000;
  input.savingsBalance = 1000000;
  input.savingsDraw = 2000;
  const result = projectGrowth(input, { rate: 10, years: 2, repeat: false });
  const end = result.points.at(-1);
  assert.equal(end.year, 2028);
  assert.equal(dollars(end.baseline.total), 121000);
  assert.equal(dollars(end.planned.total), 110000);
  assert.equal(dollars(end.baseline.total - end.planned.total - result.withdrawn.total), 1000);
  assert.equal(result.withdrawn.brokerage, 10000);
});

test('a joint projection clips recurring withdrawals at each account balance', () => {
  const input = scenario();
  input.status = 'joint';
  Object.assign(input.owners[1], { planBalance: 11000, planRmd: 3000, planExtra: 1000 });
  const result = projectGrowth(input, { rate: 0, years: 3, repeat: true });
  assert.equal(result.points.at(-1).planned.plan1, 0);
  assert.equal(result.points.at(-1).baseline.plan1, 11000);
  assert.equal(result.withdrawn.plan1, 11000);
  assert.equal(result.unmet.plan1, 1000);
});

test('a Roth conversion reallocates the same funded amount in both paths after IRA cash comes out', () => {
  const input = scenario();
  Object.assign(input.owners[0], { iraBalance: 20000, iraRmd: 6000, conversion: 15000, rothCash: 3000 });
  const result = projectGrowth(input, { rate: 0, years: 2, repeat: false });
  const end = result.points.at(-1);
  assert.equal(end.baseline.ira0, 6000);
  assert.equal(end.baseline.roth0, 14000);
  assert.equal(end.planned.ira0, 0);
  assert.equal(end.planned.roth0, 11000);
  assert.equal(result.unconverted, 1000);
  assert.equal(end.baseline.total - end.planned.total, result.withdrawn.total);
});

test('negative annual returns still allow a deterministic comparison', () => {
  const input = scenario();
  input.brokerageBalance = 100000;
  input.brokeragePrincipal = 5000;
  const result = projectGrowth(input, { rate: -10, years: 2, repeat: false });
  const { baseline, planned } = result.points.at(-1);
  assert.equal(dollars(baseline.total - planned.total), 4500);
});
