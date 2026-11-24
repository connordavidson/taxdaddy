import { calculate, enhancedSeniorPolicy, householdOwners, rmdFor, withdrawalTaxBands, EMPTY, EXAMPLE } from './tax.mjs';
import { rulesFor, SUPPORTED_TAX_YEARS } from './tax-rules/catalog.mjs';
import { initGrowthView } from './growth-view.mjs';

const $ = id => document.getElementById(id);
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const preciseDollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const percent = new Intl.NumberFormat('en-US', { style: 'percent' });
const money = value => dollars.format(Math.abs(value) < .5 ? 0 : value);
const exact = value => Number.isInteger(value) ? money(value) : preciseDollars.format(value);
const change = value => Math.abs(value) < .5 ? money(0) : (value > 0 ? '+' : '−') + money(Math.abs(value));
const activeOwners = () => householdOwners(state);
const taxRules = () => rulesFor(state.taxYear);
const ownerName = i => i ? 'Spouse' : state.status === 'joint' ? 'You' : 'Account owner';
let state = structuredClone(EXAMPLE);

function numberInput(id, title, value, options = {}) {
  const { unit = '$', max = 1000000000, step = '.01', hint = '' } = options;
  return `<label class="field" for="${id}"><span>${title}</span>
    <span class="input-shell ${unit === '$' ? 'money' : ''}">${unit === '$' ? '<span class="affix" aria-hidden="true">$</span>' : ''}
    <input id="${id}" data-key="${id}" type="number" inputmode="${step === 1 ? 'numeric' : 'decimal'}" min="0" max="${max}" step="${step}" value="${value}" ${hint ? `aria-describedby="${id}-hint"` : ''}></span>
    ${hint ? `<span class="assist" id="${id}-hint">${hint}</span>` : ''}</label>`;
}

function slider(id, title, value, limits, hint = '') {
  const [maximum, step] = limits;
  return `<div class="control">
    <label for="${id}">${title}</label>
    <span class="input-shell money"><span class="affix" aria-hidden="true">$</span>
      <input id="${id}" data-key="${id}" type="number" inputmode="decimal" min="0" max="1000000000" step=".01" value="${value}" ${hint ? `aria-describedby="${id}-hint"` : ''}>
    </span>
    <input id="${id}-slider" data-key="${id}" data-base-max="${maximum}" type="range" min="0" max="${Math.max(maximum, Math.ceil(value / step) * step)}" step="${step}" value="${value}" aria-label="${title} slider" ${hint ? `aria-describedby="${id}-hint"` : ''}>
    ${hint ? `<span class="assist" id="${id}-hint">${hint}</span>` : ''}
  </div>`;
}

function check(id, title, selected) {
  return `<label class="check"><input id="${id}" data-key="${id}" type="checkbox" ${selected ? 'checked' : ''}><span>${title}</span></label>`;
}

function household() {
  const statusOptions = Object.entries(taxRules().statuses).map(([id, status]) => `<option value="${id}" ${id === state.status ? 'selected' : ''}>${status.name}</option>`).join('');
  return `<div class="field-grid">
    <label class="field" for="status"><span>Filing status</span><select id="status" data-key="status">${statusOptions}</select></label>
    ${numberInput('savingsBalance', 'Cash savings balance', state.savingsBalance)}
    ${numberInput('brokerageBalance', 'Taxable brokerage balance', state.brokerageBalance)}
  </div>
  <div id="separate-controls" ${state.status !== 'separate' ? 'hidden' : ''}>${check('livedTogether', `I lived with my spouse at some point in ${state.taxYear}`, state.livedTogether)}</div>
  <div id="owner-balances">${balances()}</div>
  <details class="advanced"><summary>Deductions</summary>
  ${check('useItemized', 'Use itemized deductions', state.useItemized)}
  <div id="itemized-control" ${state.useItemized ? '' : 'hidden'}>
    ${numberInput('itemized', 'Allowed itemized deductions', state.itemized, { hint: 'Enter your total after applicable limits. If married filing separately and your spouse itemizes, select this and enter your amount, even if it is $0.' })}
  </div>
  ${activeOwners().map((owner, i) => `<div class="owner-section"><h3 class="subheading first">${ownerName(i)}</h3>
    ${check(`${i}.blind`, 'Qualifies as blind for the additional standard deduction', owner.blind)}
    ${check(`${i}.seniorSSN`, 'Has a valid Social Security number for the senior deduction', owner.seniorSSN)}</div>`).join('')}
  </details>`;
}

function balances() {
  return activeOwners().map((owner, i) => {
    const fields = (key, label, options) => numberInput(`${i}.${key}`, label, owner[key], options);
    return `<h3 class="subheading">${ownerName(i)}</h3><div class="field-grid">
      ${fields('age', `Age attained in ${state.taxYear}`, { unit: '', max: 130, step: 1 })}
      ${fields('iraBalance', 'Traditional / SEP / SIMPLE IRA')}
      ${fields('planBalance', 'Non-Roth 401(k) balance')}
      ${fields('rothBalance', 'Roth IRA / Roth 401(k) balance')}
      </div>`;
  }).join('');
}

function income() {
  return `${slider('pension', 'Pension income', state.pension, [100000, 500])}
    ${slider('social', 'Social Security benefits', state.social, [100000, 500])}
    ${slider('qualified', 'Qualified dividends', state.qualified, [40000, 250])}
    ${slider('dividends', 'Nonqualified dividends', state.dividends, [40000, 250], 'Form 1099-DIV box 1a minus box 1b.')}
    ${slider('savingsDraw', 'Cash savings spent', state.savingsDraw, [100000, 500])}
    ${slider('brokeragePrincipal', 'Taxable brokerage principal withdrawn', state.brokeragePrincipal, [100000, 500], 'Exclude gains and dividends already entered elsewhere.')}
    <details class="advanced"><summary>Other income and taxable amounts</summary><div class="field-grid">
      ${numberInput('pensionTaxable', 'Taxable pension (%)', state.pensionTaxable, { unit: '%', max: 100, hint: 'Use the taxable share from your plan or Form 1099-R.' })}
      ${numberInput('wages', 'Taxable wages', state.wages)}
      ${numberInput('interest', 'Taxable interest', state.interest)}
      ${numberInput('exempt', 'Tax-exempt interest', state.exempt)}
      ${numberInput('gains', 'Net long-term gains at preferential rates', state.gains)}
      ${numberInput('reinvested', 'Investment income kept invested', state.reinvested, { hint: 'Included in taxes and excluded from spending cash.' })}
    </div></details>`;
}

function withdrawals() {
  return activeOwners().map((owner, i) => {
    const amount = (key, label, max = 100000, step = 500, hint) => slider(`${i}.${key}`, label, owner[key], [max, step], hint);
    const field = (key, label, options) => numberInput(`${i}.${key}`, label, owner[key], options);
    const flag = (key, label) => check(`${i}.${key}`, label, owner[key]);
    const inner = `<div class="rmd-note"><span id="rmd-${i}"></span><button type="button" class="button" data-rmd="${i}">Use minimums</button></div>
      ${amount('iraRmd', 'Traditional IRA RMD paid')}
      ${amount('planRmd', '401(k) RMD paid')}
      ${amount('iraExtra', 'Additional traditional IRA cash withdrawal')}
      ${amount('planExtra', 'Additional non-Roth 401(k) cash withdrawal')}
      ${amount('rothCash', 'Roth cash withdrawal', 100000, 500, 'Assumed tax-free unless you enter taxable earnings below.')}
      ${amount('conversion', 'Traditional IRA to Roth IRA conversion', 150000, 500)}
      <p class="assist" id="conversion-warning-${i}" hidden></p>
      <details class="advanced"><summary>Account tax details and RMD timing</summary>
        <div class="field-grid">
          ${field('iraBasis', 'Available nondeductible IRA basis', { hint: 'Per owner, using Form 8606.' })}
          ${field('iraBeforeFlows', 'Projected IRA value before withdrawals', { hint: `Enter all Dec. 31, ${state.taxYear} traditional, SEP and SIMPLE IRA values plus the IRA withdrawals and conversion you are modeling.` })}
          ${field('planTaxable', 'Taxable non-Roth 401(k) cash (%)', { unit: '%', max: 100 })}
          ${field('rothEarnings', 'Taxable Roth earnings withdrawn')}
          ${field('earlyBase', `Amount subject to ${percent.format(taxRules().earlyDistribution.rate)} early-distribution tax`, { hint: 'Enter only amounts still subject to the tax after any exceptions or Roth recapture rules.' })}
          ${field('priorIra', `${state.taxYear - 1} IRA RMD still due in ${state.taxYear}`)}
          ${field('priorPlan', `${state.taxYear - 1} 401(k) RMD still due in ${state.taxYear}`)}
        </div>
        ${flag('planExempt', 'Current-employer plan allows a still-working RMD delay and I satisfy the ownership rule')}
        ${flag('deferIra', `Delay first IRA RMD to April 1, ${state.taxYear + 1} (if first due this year)`)}
        ${flag('deferPlan', `Delay first eligible 401(k) RMD to April 1, ${state.taxYear + 1} (including a first year after retirement)`)}
      </details>`;
    if (i) return `<details class="advanced owner-section"><summary>Spouse’s withdrawals &amp; conversions</summary>${inner}</details>`;
    return `<div class="owner-section">${state.status === 'joint' ? '<h3 class="subheading first">Your accounts</h3>' : ''}${inner}</div>`;
  }).join('');
}

function row(label, value, options = {}) {
  return `<div${options.total ? ' class="total"' : ''}><dt>${options.color !== undefined ? `<span class="key key-${options.color}" aria-hidden="true"></span>` : ''}${label}</dt><dd>${value}</dd></div>`;
}

function cashChart(calc) {
  const cash = [
    ['Pension & Social Security', state.pension + state.social],
    ['Retirement withdrawals', calc.traditionalCash + calc.roth],
    ['Investment income received', calc.investments - Math.min(state.reinvested, calc.investments) + state.exempt],
    ['Wages & principal withdrawals', state.wages + state.savingsDraw + state.brokeragePrincipal],
  ];
  const bar = $('income-bar');
  bar.setAttribute('aria-label', 'Cash by source. ' + cash.map(([name, amount]) => `${name} ${money(amount)}`).join('. '));
  bar.replaceChildren(...cash.map(([, amount]) => {
    const part = document.createElement('span');
    part.className = 'bar-part';
    part.style.flexBasis = calc.cash ? (100 * amount / calc.cash) + '%' : '0%';
    return part;
  }));
  $('breakdown').innerHTML = cash.map(([label, amount], color) => row(label, money(amount), { color })).join('')
    + row('Adjusted gross income (AGI)', money(calc.agi), { total: true })
    + row('Taxable income after deductions', money(calc.taxable));
}

function issueList(calc) {
  const issues = [];
  calc.owners.forEach((owner, i) => {
    const { rmd, iraCash, planCash, shortfall, conversionShortfall } = calc.retirement[i];
    const label = ownerName(i);
    const minimum = [`IRA ${exact(rmd.ira)}`, `401(k) ${exact(rmd.plan)}`].join(' · ');
    $(`rmd-${i}`).textContent = rmd.needsReview ? 'RMD eligibility needs confirmation for this birth cohort' : `Calculated ${state.taxYear} minimums · ` + minimum;
    const button = document.querySelector(`[data-rmd="${i}"]`);
    button.disabled = !(rmd.ira + rmd.plan + owner.priorIra + owner.priorPlan);
    if (shortfall > .005) issues.push(`${label}: ${exact(shortfall)} in estimated RMDs due in ${state.taxYear} is still unpaid in this scenario. Any excise tax is separate.`);
    const warning = $(`conversion-warning-${i}`);
    warning.hidden = !conversionShortfall;
    warning.textContent = conversionShortfall ? `Take ${exact(conversionShortfall)} more in IRA cash RMDs before converting.` : '';
    if (conversionShortfall) issues.push(`${label}: the conversion is modeled as entered, but at least ${exact(conversionShortfall)} more in IRA cash must come out first to satisfy the RMD.`);
    if (iraCash + owner.conversion > owner.iraBalance && owner.iraBalance > 0) issues.push(`${label}: IRA withdrawals and conversion exceed the starting IRA balance. Verify projected funds.`);
    if (planCash > owner.planBalance && owner.planBalance > 0) issues.push(`${label}: 401(k) withdrawals exceed the starting balance. Verify projected funds.`);
    if (owner.rothCash > owner.rothBalance && owner.rothBalance > 0) issues.push(`${label}: Roth withdrawals exceed the starting Roth balance. Verify projected funds.`);
    if (owner.rothEarnings > owner.rothCash) issues.push(`${label}: taxable Roth earnings were capped at the Roth cash withdrawn.`);
    if (owner.age < Math.ceil(taxRules().earlyDistribution.minAge) && !owner.earlyBase && (iraCash || planCash || owner.rothEarnings)) issues.push(`${label}: verify age at withdrawal and any early-distribution exception. The tax estimate uses the penalty base you enter.`);
    if (owner.iraBasis && owner.iraBeforeFlows < iraCash + owner.conversion) issues.push(`${label}: check the projected IRA value used for the pro rata calculation. It should include both the modeled distributions and any balance remaining at year-end.`);
    if (rmd.needsReview && (owner.iraBalance || owner.planBalance)) issues.push(`${label}: confirm the RMD start age before using this estimate. The current-year minimum was skipped where eligibility is unresolved.`);
    if (owner.deferIra && !rmd.canDeferIra) issues.push(`${label}: the IRA first-year delay applies only in the first required distribution year. The model included any known current minimum.`);
  });
  if (state.savingsBalance && state.savingsDraw > state.savingsBalance) issues.push('The savings draw exceeds the starting savings balance. Verify projected funds.');
  if (calc.agi > 100000 && state.useItemized) issues.push('This estimate uses the itemized amount you entered. Confirm applicable limits and whether alternative minimum tax applies.');
  $('review').hidden = !issues.length;
  $('issues').replaceChildren(...issues.map(issue => {
    const li = document.createElement('li');
    li.textContent = issue;
    return li;
  }));
}

function project() {
  const calc = calculate(state);
  const baseline = calculate(state, { omitConversion: true });
  $('net').textContent = money(calc.net);
  $('cash').textContent = money(calc.cash);
  $('tax').textContent = money(calc.tax);
  $('summary-warning').hidden = !calc.retirement.some((owner, index) => owner.conversionShortfall > 0 || (owner.rmd.needsReview && calc.owners[index].conversion > 0));
  $('mobile-net').textContent = money(calc.net);
  $('mobile-tax').textContent = money(calc.tax);
  cashChart(calc);
  $('tax-detail').innerHTML = [
    row('Taxable Social Security', money(calc.taxableSS)),
    row(state.useItemized ? 'Itemized deductions' : 'Standard deduction with any age or blind add-ons', money(calc.baseDeduction)),
    row('Enhanced senior deduction', money(calc.senior)),
    row('Ordinary federal bracket', percent.format(calc.marginal)),
    row('Regular income tax', money(calc.regular)),
    row('Net investment income tax', money(calc.niit)),
    row('Early-distribution additional tax', money(calc.early)),
  ].join('');
  $('comparison').innerHTML = [
    row('Taxable Roth conversion', money(calc.conversion)),
    row('Federal tax with $0 conversion', money(baseline.tax)),
    row('Change in federal tax', change(calc.tax - baseline.tax), { total: true }),
    row('Change in after-tax cash', change(calc.net - baseline.net)),
  ].join('');
  issueList(calc);
  renderWithdrawalBands(calc);
  bracketTable(state.status);
  if (!$('growth').hidden) growthView.render();
}

function bracketTable(selected) {
  const wrapper = $('bracket-rules');
  const key = `${state.taxYear}-${selected}`;
  if (wrapper.dataset.status === key) return;
  wrapper.dataset.status = key;
  const rules = taxRules();
  const status = rules.statuses[selected];
  const rows = rules.ordinaryRates.map((rate, i) => {
    const range = i === 0 ? `Up to ${money(status.bracket[0])}`
      : i === 6 ? `Over ${money(status.bracket[5])}`
      : `Over ${money(status.bracket[i - 1])} through ${money(status.bracket[i])}`;
    return `<tr><td>${percent.format(rate)}</td><td>${range}</td></tr>`;
  }).join('');
  wrapper.innerHTML = `<table><caption>Current scenario · ${status.name}</caption>
    <thead><tr><th scope="col">Ordinary rate</th><th scope="col">Taxable ordinary income</th></tr></thead><tbody>${rows}</tbody></table>
    <dl class="breakdown">${row('Base standard deduction', money(status.standard))}
      ${status.gains.map((limit, index) => row(`Qualified dividends & eligible gains · ${percent.format(rules.preferentialRates[index])} ceiling`, money(limit))).join('')}
    </dl>`;
}

function renderInputs() {
  $('household').innerHTML = household();
  $('income').innerHTML = income();
  $('withdrawals').innerHTML = withdrawals();
}

function updateSlider(id, value) {
  const range = $(id + '-slider');
  if (!range) return;
  range.max = Math.max(Number(range.dataset.baseMax), Math.ceil(value / Number(range.step)) * Number(range.step));
  range.value = value;
}

document.addEventListener('input', (event) => {
  const input = event.target;
  const id = input.dataset.key;
  if (!id) return;
  const [owner, key] = id.split('.');
  const target = key ? state.owners[Number(owner)] : state;
  const field = key || id;
  if (input.type === 'checkbox') target[field] = input.checked;
  else if (input.tagName === 'SELECT') target[field] = id === 'taxYear' ? Number(input.value) : input.value;
  else {
    const amount = Math.max(0, Math.min(Number(input.max), Number(input.value) || 0));
    target[field] = input.step === '1' ? Math.trunc(amount) : amount;
    if (input.type === 'range') $(id).value = amount;
    else updateSlider(id, amount);
  }
  if (id === 'status' || id === 'taxYear') {
    renderInputs();
    syncTaxYear();
    $(id).focus();
  }
  if (id === 'useItemized') $('itemized-control').hidden = !state.useItemized;
  project();
});

document.addEventListener('change', (event) => {
  const input = event.target;
  if (input.type !== 'number' || !input.dataset.key) return;
  const [owner, key] = input.dataset.key.split('.');
  input.value = key ? state.owners[Number(owner)][key] : state[owner];
});

$('withdrawals').addEventListener('click', (event) => {
  const button = event.target.closest('[data-rmd]');
  if (!button) return;
  const i = Number(button.dataset.rmd);
  const owner = state.owners[i];
  const minimum = rmdFor(owner, taxRules());
  const round = value => Math.round(Math.max(0, value) * 100) / 100;
  const iraMinimum = owner.deferIra && minimum.canDeferIra && !owner.conversion ? 0 : minimum.ira;
  owner.iraRmd = round(iraMinimum + owner.priorIra - owner.iraExtra);
  owner.planRmd = round((owner.deferPlan ? 0 : minimum.plan) + owner.priorPlan - owner.planExtra);
  for (const field of ['iraRmd', 'planRmd']) {
    const id = `${i}.${field}`;
    $(id).value = owner[field];
    updateSlider(id, owner[field]);
  }
  project();
});

for (const [id, example] of [['empty', EMPTY], ['example', EXAMPLE]]) {
  $(id).addEventListener('click', () => {
    state = { ...structuredClone(example), taxYear: state.taxYear };
    if (id === 'example') {
      state.owners.forEach(owner => {
        const minimum = rmdFor(owner, taxRules());
        owner.iraRmd = minimum.ira;
        owner.planRmd = minimum.plan;
      });
    }
    renderInputs();
    growthView.syncControls();
    project();
  });
}

const SCREENS = ['scenario', 'growth', 'rules'];

function syncTaxYear() {
  const rules = taxRules();
  document.querySelectorAll('[data-year]').forEach(element => {
    element.textContent = state.taxYear + Number(element.dataset.year);
  });
  $('year-badge').textContent = `Tax year ${state.taxYear}`;
  $('taxYear').value = state.taxYear;
  $('annual-source').textContent = rules.sources.annual.name;
  $('annual-source').href = rules.sources.annual.url;
  $('social-top').textContent = percent.format(rules.socialSecurity.topRate);
  $('niit-rate').textContent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 }).format(rules.niitRate);
  $('rmd-excise').textContent = percent.format(rules.rmd.excise.rate);
  $('rmd-correction').textContent = percent.format(rules.rmd.excise.correctionRate);
  $('qcd-age').textContent = rules.rmd.qcd.minAge;
  $('qcd-limit').textContent = money(rules.rmd.qcd.annualLimit);
  const status = rules.statuses[state.status];
  const senior = enhancedSeniorPolicy(rules);
  const basic = `The selected filing status adds ${money(status.aged)} to the standard deduction per qualifying age or blindness condition. The age threshold is ${rules.deductions.age}.`;
  const additional = senior && status.senior !== null
    ? ` The enhanced senior deduction starts at ${money(senior.amount)} per eligible person with a valid Social Security number. Each person’s amount falls by ${percent.format(senior.phaseout)} of modified AGI above ${money(status.senior)}. The model uses AGI as modified AGI.`
    : ' The enhanced senior deduction is unavailable for this selection.';
  $('deduction-rules').textContent = basic + additional;
}

function renderWithdrawalBands(calc) {
  const data = withdrawalTaxBands(state, calc);
  const rows = data.filter(source => source.gross > 0);
  const rates = [0, ...taxRules().ordinaryRates];
  const highest = Math.max(0, ...rows.map(row => row.gross));
  const colorIndex = index => index === 0 ? 0 : Math.max(1, Math.round(index * 7 / (rates.length - 1)));
  $('band-legend').innerHTML = rates.map((rate, index) => `<span><i class="rate-chip rate-${colorIndex(index)}" aria-hidden="true"></i>${percent.format(rate)}</span>`).join('');
  $('withdrawal-bands').innerHTML = rows.length ? '' : '<p class="muted">Enter a cash withdrawal, savings draw, or conversion to show its tax bands.</p>';
  for (const { name, gross, bands } of rows) {
    const bar = document.createElement('div');
    bar.className = 'withdrawal-bar';
    const populated = bands.map((band, index) => ({ ...band, index })).filter(band => band.amount >= .005);
    const details = populated.map(({ rate, amount }) => `${money(amount)} at ${percent.format(rate)}`).join(' · ');
    bar.innerHTML = `<div class="bar-heading"><strong>${name}</strong><span>${money(gross)}</span></div>
      <div class="band-track" aria-hidden="true"></div><p class="assist">${details}</p>`;
    const track = bar.querySelector('.band-track');
    for (const { index, rate, amount } of populated) {
      const segment = document.createElement('span');
      segment.className = `rate-${colorIndex(index)}`;
      segment.style.flexBasis = `${100 * amount / highest}%`;
      segment.title = `${money(amount)} at ${percent.format(rate)}`;
      track.append(segment);
    }
    $('withdrawal-bands').append(bar);
  }
}

function navigate() {
  const requested = location.hash.slice(1);
  const active = SCREENS.includes(requested) ? requested : 'scenario';
  for (const screen of SCREENS) {
    $(screen).hidden = screen !== active;
    const link = $(screen + '-nav');
    if (screen === active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  $('mobile-projection').hidden = active !== 'scenario';
  if (active === 'growth') growthView.render();
  if (requested === 'withdrawal-tax-brackets') $('withdrawal-tax-brackets').scrollIntoView();
  else window.scrollTo(0, 0);
}

$('taxYear').innerHTML = SUPPORTED_TAX_YEARS.map(year => `<option value="${year}">${year}</option>`).join('');
$('year-select').hidden = SUPPORTED_TAX_YEARS.length <= 1;
$('year-badge').hidden = !$('year-select').hidden;
const growthView = initGrowthView({ scenario: () => state, money });
renderInputs();
syncTaxYear();
navigate();
project();
window.addEventListener('hashchange', navigate);
