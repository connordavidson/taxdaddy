const STATUSES = {
  single: { name: 'Single', bracket: [12800, 52025, 109125, 208325, 264550, 661375], standard: 16600, aged: 2100, gains: [51050, 563200], ss: [25000, 34000], niit: 200000, senior: 75000 },
  joint: { name: 'Married filing jointly', bracket: [25600, 104050, 218250, 416650, 529100, 793650], standard: 33200, aged: 1700, gains: [102100, 633600], ss: [32000, 44000], niit: 250000, senior: 150000 },
  separate: { name: 'Married filing separately', bracket: [12800, 52025, 109125, 208325, 264550, 396825], standard: 16600, aged: 1700, gains: [51050, 316800], ss: [25000, 34000], niit: 125000, senior: null },
  head: { name: 'Head of household', bracket: [18250, 69650, 109100, 208300, 264550, 661350], standard: 24925, aged: 2100, gains: [68350, 598400], ss: [25000, 34000], niit: 200000, senior: 75000 },
  surviving: { name: 'Qualifying surviving spouse', bracket: [25600, 104050, 218250, 416650, 529100, 793650], standard: 33200, aged: 1700, gains: [102100, 633600], ss: [25000, 34000], niit: 250000, senior: 75000 },
};

// IRS Publication 590-B, Table III, ages 72 through 120 and over.
const FACTORS = [
  27.4, 26.5, 25.5, 24.6, 23.7, 22.9, 22, 21.1, 20.2, 19.4, 18.5, 17.7, 16.8,
  16, 15.2, 14.4, 13.7, 12.9, 12.2, 11.5, 10.8, 10.1, 9.5, 8.9, 8.4,
  7.8, 7.3, 6.8, 6.4, 6, 5.6, 5.2, 4.9, 4.6, 4.3, 4.1, 3.9, 3.7,
  3.5, 3.4, 3.3, 3.1, 3, 2.9, 2.8, 2.7, 2.5, 2.3, 2,
];

export const TAX_RULES_2027 = {
  year: 2027,
  sources: {
    annual: {
      name: 'IRS Rev. Proc. 2026-35, sections 3.01, 3.03 and 3.15',
      url: 'https://www.irs.gov/irb/2026-48_IRB',
    },
  },
  statuses: STATUSES,
  ordinaryRates: [.10, .12, .22, .24, .32, .35, .37],
  preferentialRates: [0, .15, .20],
  socialSecurity: { provisionalShare: .5, firstRate: .5, topRate: .85 },
  deductions: {
    age: 65,
    enhancedSenior: { firstYear: 2025, lastYear: 2028, amount: 6000, phaseout: .06 },
  },
  niitRate: .038,
  earlyDistribution: { rate: .10, minAge: 59.5 },
  rmd: {
    // The final rules reserve 1959. The proposed age is 73; either reading
    // leaves this cohort below RMD age in 2027. Review before modeling 2032.
    cohorts: [
      { bornFrom: 1960, age: 75 },
      { bornFrom: 1959, age: null, reviewFromAge: 73, latestAge: 75 },
      { bornFrom: 1951, age: 73 },
      { bornFrom: 0, alreadyRequired: true }, // Already beyond their start age in 2027 and later.
    ],
    table: { firstAge: 72, factors: FACTORS },
    qcd: { minAge: 70.5, annualLimit: 114000 },
    excise: { rate: .25, correctionRate: .10 },
  },
};
