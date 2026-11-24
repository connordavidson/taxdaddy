import { GROWTH_DEFAULTS, projectGrowth } from './growth.mjs';

const HORIZONS = [5, 10, 20, 30, 40];
const MIN_RATE = -25;
const MAX_RATE = 20;
const clampRate = value => Math.max(MIN_RATE, Math.min(MAX_RATE, value));

export function initGrowthView({ scenario, money, saved, onChange }) {
  const get = id => document.getElementById(id);
  const settings = {
    rate: Number.isFinite(saved.rate) ? clampRate(saved.rate) : GROWTH_DEFAULTS.rate,
    years: HORIZONS.includes(saved.years) ? saved.years : GROWTH_DEFAULTS.years,
    repeat: typeof saved.repeat === 'boolean' ? saved.repeat : GROWTH_DEFAULTS.repeat,
    account: typeof saved.account === 'string' ? saved.account : 'total',
  };
  const canvas = get('growth-chart');
  const hover = get('growth-hover');
  const readout = get('growth-readout');
  const readoutDate = get('growth-readout-date');
  const withValue = get('growth-readout-with');
  const withoutValue = get('growth-readout-without');
  const guide = get('growth-guide');
  const withDot = get('growth-with-dot');
  const withoutDot = get('growth-without-dot');
  const keyboardReadout = get('growth-keyboard-readout');
  let chartData;
  let plot;
  let focusedYear = 0;
  get('growth-controls').innerHTML = `
    <label class="field" for="growth-rate"><span>Annual return (%)</span>
      <input id="growth-rate" type="number" inputmode="decimal" min="${MIN_RATE}" max="${MAX_RATE}" step=".1" value="${settings.rate}">
    </label>
    <label class="field" for="growth-years"><span>Years to project</span>
      <select id="growth-years">${HORIZONS.map(year => `<option ${year === settings.years ? 'selected' : ''}>${year}</option>`).join('')}</select>
    </label>
    <label class="field" for="growth-account"><span>Account view</span><select id="growth-account"></select></label>
    <input id="growth-rate-slider" type="range" min="${MIN_RATE}" max="${MAX_RATE}" step=".1" value="${settings.rate}" aria-label="Annual return slider">
    <label class="check"><input id="growth-repeat" type="checkbox" ${settings.repeat ? 'checked' : ''}>Repeat withdrawals each year</label>`;

  const account = get('growth-account');
  const numericRate = get('growth-rate');
  const rangeRate = get('growth-rate-slider');
  function update() {
    render();
    onChange();
  }
  function updateRate(input, other) {
    settings.rate = clampRate(Number(input.value) || 0);
    other.value = settings.rate;
    update();
  }
  numericRate.addEventListener('input', () => updateRate(numericRate, rangeRate));
  numericRate.addEventListener('change', () => numericRate.value = settings.rate);
  rangeRate.addEventListener('input', () => updateRate(rangeRate, numericRate));
  get('growth-years').addEventListener('change', event => {
    settings.years = Number(event.target.value);
    update();
  });
  get('growth-repeat').addEventListener('change', event => {
    settings.repeat = event.target.checked;
    update();
  });
  account.addEventListener('change', () => {
    settings.account = account.value;
    update();
  });

  const compact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
  const exactAxis = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 });

  function balanceAxis(points, id) {
    const balances = points.flatMap(point => [point.planned[id], point.baseline[id]]);
    let lower = Math.min(...balances);
    let upper = Math.max(...balances);
    if (upper === lower) {
      const padding = Math.max(1, upper * .05);
      lower = Math.max(0, lower - padding);
      upper += padding;
    }
    const rawStep = Math.max(.01, (upper - lower) / 4);
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const step = [1, 2, 2.5, 5, 10].map(unit => unit * magnitude).find(value => value >= rawStep);
    const first = Math.floor(lower / step);
    const last = Math.ceil(upper / step);
    const values = Array.from({ length: last - first + 1 }, (_, i) => (first + i) * step);
    const shortened = values.map(value => compact.format(value));
    const labels = new Set(shortened).size === values.length ? shortened : values.map(value => exactAxis.format(value));
    return { lower: values[0], upper: values.at(-1), ticks: values.map((value, i) => ({ value, label: labels[i] })) };
  }

  function draw() {
    if (!chartData || !canvas.clientWidth) return;
    const { points } = chartData;
    const id = account.value;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const axis = balanceAxis(points, id);
    ctx.font = '12px system-ui';
    const labelWidth = Math.max(...axis.ticks.map(tick => ctx.measureText(tick.label).width));
    const left = Math.min(width * .28, labelWidth + 13);
    const right = width - 12;
    const top = 15;
    const bottom = height - 30;
    const y = value => bottom - (bottom - top) * (value - axis.lower) / (axis.upper - axis.lower);
    const x = i => left + (right - left) * i / (points.length - 1);
    plot = { width, height, left, right, top, bottom, x, y };
    ctx.fillStyle = '#516171';
    ctx.strokeStyle = '#dce5e7';
    ctx.lineWidth = 1;
    for (const { value, label } of axis.ticks) {
      const lineY = y(value);
      ctx.beginPath();
      ctx.moveTo(left, lineY);
      ctx.lineTo(right, lineY);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(label, left - 6, lineY + 4, left - 7);
    }

    const last = points.length - 1;
    const years = width < 420 ? [0, Math.round(last / 2), last] : [0, Math.round(last / 4), Math.round(last / 2), Math.round(last * .75), last];
    for (const index of years) {
      ctx.textAlign = index === 0 ? 'left' : index === last ? 'right' : 'center';
      ctx.fillText(index === 0 ? `Start of ${points[index].year}` : points[index].year, x(index), bottom + 20);
    }

    function drawLine(key, color, dash) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash(dash);
      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(x(index), y(point[key][id]));
        else ctx.lineTo(x(index), y(point[key][id]));
      });
      ctx.stroke();
    }
    drawLine('planned', '#087366', []);
    drawLine('baseline', '#45628a', [5, 5]);
  }

  function showReadout(index, announce = false) {
    const { points } = chartData;
    const lower = points[Math.floor(index)];
    const upper = points[Math.ceil(index)];
    const fraction = index - Math.floor(index);
    const id = account.value;
    const planned = lower.planned[id] + (upper.planned[id] - lower.planned[id]) * fraction;
    const baseline = lower.baseline[id] + (upper.baseline[id] - lower.baseline[id]) * fraction;
    let date = lower.isOpening ? `Start of ${lower.year}` : `Dec. 31, ${lower.year}`;
    if (lower !== upper) date = lower.isOpening ? `${upper.year} (interpolated)` : `${lower.year}–${upper.year} (interpolated)`;
    const x = plot.x(index);
    const plannedY = plot.y(planned);
    const baselineY = plot.y(baseline);

    readoutDate.textContent = date;
    withValue.textContent = money(planned);
    withoutValue.textContent = money(baseline);
    hover.hidden = false;
    guide.style.left = `${x}px`;
    guide.style.top = `${plot.top}px`;
    guide.style.height = `${plot.bottom - plot.top}px`;
    withDot.style.left = withoutDot.style.left = `${x}px`;
    withDot.style.top = `${plannedY}px`;
    withoutDot.style.top = `${baselineY}px`;
    const side = x + readout.offsetWidth + 16 <= plot.width ? x + 12 : x - readout.offsetWidth - 12;
    const top = Math.max(4, Math.min(plot.height - readout.offsetHeight - 4, Math.min(plannedY, baselineY) - 12));
    readout.style.left = `${Math.max(4, side)}px`;
    readout.style.top = `${top}px`;

    if (announce) keyboardReadout.textContent = `${date}. With withdrawals ${money(planned)}. Without withdrawals ${money(baseline)}.`;
  }

  function trackPointer(event) {
    if (!plot || !chartData) return;
    const bounds = canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    if (x < plot.left || x > plot.right || y < plot.top || y > plot.bottom) {
      hover.hidden = true;
      return;
    }
    const index = (x - plot.left) * (chartData.points.length - 1) / (plot.right - plot.left);
    const year = Math.round(index);
    showReadout(Math.abs(x - plot.x(year)) <= 1 ? year : index);
  }

  canvas.addEventListener('pointermove', trackPointer);
  canvas.addEventListener('pointerdown', trackPointer);
  canvas.addEventListener('pointerleave', () => { hover.hidden = true; });
  canvas.addEventListener('blur', () => { hover.hidden = true; });
  canvas.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      hover.hidden = true;
      return;
    }
    if (!plot || !chartData || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const last = chartData.points.length - 1;
    if (event.key === 'Home') focusedYear = 0;
    else if (event.key === 'End') focusedYear = last;
    else focusedYear = Math.min(last, Math.max(0, focusedYear + (event.key === 'ArrowRight' ? 1 : -1)));
    showReadout(focusedYear, true);
  });

  function render() {
    hover.hidden = true;
    focusedYear = 0;
    const state = scenario();
    chartData = projectGrowth(state, settings);
    const { accounts, points, withdrawn, unmet, depletedAt, unconverted } = chartData;
    const final = points.at(-1);
    const choices = [{ id: 'total', name: 'All investment accounts' }, ...accounts];
    const current = choices.find(option => option.id === settings.account) ?? choices[0];
    if (account.options.length !== choices.length) {
      account.replaceChildren(...choices.map(({ id, name }) => new Option(name, id)));
    }
    const id = settings.account = account.value = current.id;
    const gap = final.baseline[id] - final.planned[id];
    const growthEffect = gap - withdrawn[id];
    get('growth-effect').textContent = growthEffect < -.005
      ? `The withdrawn dollars avoided ${money(-growthEffect)} of modeled investment losses by ${final.year}.`
      : `Withdrawals reduced compounded growth by ${money(growthEffect)} through ${final.year}.`;
    const numbers = [
      ['With withdrawals', final.planned[id]],
      ['Without withdrawals', final.baseline[id]],
      ['Difference in ending balance', gap],
      ['Total withdrawn', withdrawn[id]],
    ];
    get('growth-metrics').innerHTML = numbers.map(([label, value]) => `<div><span>${label}</span><strong>${money(value)}</strong></div>`).join('');
    canvas.setAttribute('aria-label', `${current.name} through ${final.year}. ${numbers.map(([label, value]) => `${label} ${money(value)}`).join('. ')}.`);
    const message = accounts.filter(({ id }) => depletedAt[id] !== undefined)
      .map(({ id, name }) => `${name} ran out of funds in ${depletedAt[id]}.`);
    const unfunded = unmet.total + unmet.savings;
    if (unfunded > 0.005) message.push(`The chart leaves ${money(unfunded)} of requested cash withdrawals unfunded.`);
    if (unconverted > 0.005) message.push(`After reserving the entered IRA withdrawals, the starting IRA balance could not fund ${money(unconverted)} of the conversion. Both paths use the funded amount.`);
    const warning = get('growth-warning');
    warning.textContent = message.join(' ');
    warning.hidden = !message.length;
    const rows = choices.map(({ id, name }) => `<tr><th scope="row">${name}</th><td>${money(points[0].planned[id])}</td><td>${money(final.planned[id])}</td><td>${money(final.baseline[id])}</td></tr>`).join('');
    get('growth-table').innerHTML = `<table><caption>Balances at the start and end of the projection</caption><thead>
      <tr><th scope="col">Account</th><th scope="col">Starting</th><th scope="col">With withdrawals</th><th scope="col">Without withdrawals</th></tr>
      </thead><tbody>${rows}</tbody></table>`;
    draw();
  }

  new ResizeObserver(() => {
    hover.hidden = true;
    draw();
  }).observe(canvas);
  return { render, settings };
}
