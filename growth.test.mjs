import assert from 'node:assert/strict';
import test from 'node:test';
import { projectGrowth } from './dist/growth.mjs';
import { EMPTY } from './dist/tax.mjs';

const scenario = () => structuredClone(EMPTY);
const dollars = amount => Math.round(amount * 100) / 100;

test('one-time withdrawals remove future compounding from each affected account', () => {
  const input = scenario();
  input.brokerageBalance = 100000;
  input.brokerageWithdrawal = 10000;
  input.brokerageLongTermGain = 3000;
  input.brokerageShortTermGain = 2000;
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
  assert.deepEqual(result.depletedAt, { plan1: 2029 });
});

test('records the first year a scheduled withdrawal leaves each account empty', () => {
  const input = scenario();
  Object.assign(input, {
    savingsBalance: 10000, savingsDraw: 10000,
    brokerageBalance: 90000, brokerageWithdrawal: 30000,
  });
  input.owners[0].hsaWithdrawal = 500;
  const result = projectGrowth(input, { rate: 0, years: 5, repeat: true });
  assert.deepEqual(result.depletedAt, { savings: 2027, brokerage: 2029, hsa0: 2027 });
  const firstYearOnly = projectGrowth(input, { rate: 0, years: 5, repeat: false });
  assert.deepEqual(firstYearOnly.depletedAt, { savings: 2027, hsa0: 2027 });
  assert.equal(firstYearOnly.unmet.savings, 0);
});

test('a Roth conversion starts in both paths and reserves planned IRA cash', () => {
  const input = scenario();
  Object.assign(input.owners[0], { iraBalance: 20000, iraRmd: 6000, conversion: 15000, rothCash: 3000 });
  const result = projectGrowth(input, { rate: 0, years: 2, repeat: false });
  const end = result.points.at(-1);
  assert.equal(result.points[0].planned.ira0, 6000);
  assert.equal(result.points[0].planned.roth0, 14000);
  assert.equal(result.points[0].baseline.roth0, 14000);
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
  input.brokerageWithdrawal = 5000;
  const result = projectGrowth(input, { rate: -10, years: 2, repeat: false });
  const { baseline, planned } = result.points.at(-1);
  assert.equal(dollars(baseline.total - planned.total), 4500);
});

test('cash savings and both Roth account types have independent paths', () => {
  const input = scenario();
  Object.assign(input, { savingsBalance: 10000, savingsDraw: 2000 });
  Object.assign(input.owners[0], { rothBalance: 50000, rothCash: 5000, rothPlanBalance: 20000, rothPlanCash: 2000 });
  const result = projectGrowth(input, { rate: 10, years: 1, repeat: false });
  const end = result.points.at(-1);
  assert.equal(end.planned.savings, 8000);
  assert.equal(end.baseline.savings, 10000);
  assert.equal(dollars(end.planned.roth0), 50000);
  assert.equal(dollars(end.planned.rothPlan0), 20000);
  assert.equal(dollars(end.planned.total), 70000);
});

test('opening Roth conversion earns the full first year return', () => {
  const input = scenario();
  Object.assign(input.owners[0], { iraBalance: 200000, rothBalance: 100000, conversion: 30000 });
  const [opening, closing] = projectGrowth(input, { rate: 5, years: 1, repeat: false }).points;
  assert.equal(opening.isOpening, true);
  assert.equal(opening.planned.roth0, 130000);
  assert.equal(opening.planned.ira0, 170000);
  assert.equal(opening.planned.total, 300000);
  assert.equal(dollars(closing.planned.roth0), 136500);
  assert.equal(dollars(closing.planned.ira0), 178500);
});

test('growth tracks HSA withdrawals and reserves IRA gifts before the Roth conversion', () => {
  const input = scenario();
  Object.assign(input.owners[0], {
    age: 75, iraBalance: 20000, iraRmd: 2000, iraCharity: 4000, conversion: 15000,
    hsaBalance: 10000, hsaWithdrawal: 2000, hsaMedical: 1500,
  });
  const result = projectGrowth(input, { rate: 5, years: 1, repeat: false });
  const [opening, closing] = result.points;
  assert.equal(result.unconverted, 1000);
  assert.equal(opening.planned.ira0, 6000);
  assert.equal(opening.planned.roth0, 14000);
  assert.equal(result.withdrawn.ira0, 6000);
  assert.equal(result.withdrawn.hsa0, 2000);
  assert.equal(result.withdrawn.total, 8000);
  assert.equal(closing.planned.hsa0, 8500);
  assert.equal(closing.baseline.hsa0, 10500);
});
