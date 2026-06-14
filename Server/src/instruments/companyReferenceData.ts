export type CompanyFinancialYear = {
  label: string
  revenueCr: number
  profitCr: number
  eps: number
  operatingMarginPct: number
}

export type CompanyReferenceProfile = {
  dataSource: 'reference_seed'
  asOf: string
  sector: string
  industry: string
  description: string
  marketCapCr: number
  peRatio: number
  dividendYield: number
  faceValue: number
  bookValue: number
  financials: CompanyFinancialYear[]
}

export const COMPANY_REFERENCE_DATA: Record<string, CompanyReferenceProfile> = {
  RELIANCE: {
    dataSource: 'reference_seed',
    asOf: 'FY2025 reference snapshot',
    sector: 'Energy',
    industry: 'Oil, Gas, Telecom & Retail',
    description: 'Integrated energy major with large telecom and organized retail businesses.',
    marketCapCr: 2015000,
    peRatio: 24.8,
    dividendYield: 0.36,
    faceValue: 10,
    bookValue: 1452.4,
    financials: [
      { label: 'FY2025', revenueCr: 930529, profitCr: 79302, eps: 117.1, operatingMarginPct: 18.5 },
      { label: 'FY2024', revenueCr: 899041, profitCr: 79271, eps: 116.2, operatingMarginPct: 17.9 },
      { label: 'FY2023', revenueCr: 892302, profitCr: 73670, eps: 108.7, operatingMarginPct: 16.8 },
    ],
  },
  TCS: {
    dataSource: 'reference_seed',
    asOf: 'FY2025 reference snapshot',
    sector: 'Technology',
    industry: 'IT Services & Consulting',
    description: 'Global IT services exporter focused on enterprise transformation and outsourcing.',
    marketCapCr: 1410000,
    peRatio: 30.6,
    dividendYield: 1.3,
    faceValue: 1,
    bookValue: 275.8,
    financials: [
      { label: 'FY2025', revenueCr: 245315, profitCr: 46685, eps: 128.4, operatingMarginPct: 24.3 },
      { label: 'FY2024', revenueCr: 240893, profitCr: 45908, eps: 125.1, operatingMarginPct: 24.6 },
      { label: 'FY2023', revenueCr: 225458, profitCr: 42103, eps: 114.5, operatingMarginPct: 24.1 },
    ],
  },
  HDFCBANK: {
    dataSource: 'reference_seed',
    asOf: 'FY2025 reference snapshot',
    sector: 'Financial Services',
    industry: 'Private Sector Bank',
    description: 'Large private-sector bank with strength across retail, payments, and commercial banking.',
    marketCapCr: 1185000,
    peRatio: 18.9,
    dividendYield: 1.1,
    faceValue: 1,
    bookValue: 619.7,
    financials: [
      { label: 'FY2025', revenueCr: 316852, profitCr: 65580, eps: 86.3, operatingMarginPct: 31.8 },
      { label: 'FY2024', revenueCr: 283649, profitCr: 60512, eps: 82.1, operatingMarginPct: 30.2 },
      { label: 'FY2023', revenueCr: 233215, profitCr: 44339, eps: 60.7, operatingMarginPct: 27.9 },
    ],
  },
  INFY: {
    dataSource: 'reference_seed',
    asOf: 'FY2025 reference snapshot',
    sector: 'Technology',
    industry: 'IT Services & Digital Engineering',
    description: 'Technology services company focused on consulting, cloud, and digital engineering.',
    marketCapCr: 648000,
    peRatio: 27.4,
    dividendYield: 2.2,
    faceValue: 5,
    bookValue: 221.5,
    financials: [
      { label: 'FY2025', revenueCr: 159227, profitCr: 26788, eps: 64.3, operatingMarginPct: 21.1 },
      { label: 'FY2024', revenueCr: 153670, profitCr: 26348, eps: 63.1, operatingMarginPct: 20.8 },
      { label: 'FY2023', revenueCr: 146767, profitCr: 24095, eps: 57.4, operatingMarginPct: 20.3 },
    ],
  },
  ICICIBANK: {
    dataSource: 'reference_seed',
    asOf: 'FY2025 reference snapshot',
    sector: 'Financial Services',
    industry: 'Private Sector Bank',
    description: 'Universal bank with strong retail liability franchise and improving asset quality.',
    marketCapCr: 955000,
    peRatio: 17.4,
    dividendYield: 0.8,
    faceValue: 2,
    bookValue: 414.9,
    financials: [
      { label: 'FY2025', revenueCr: 229904, profitCr: 47056, eps: 67.4, operatingMarginPct: 30.5 },
      { label: 'FY2024', revenueCr: 199933, profitCr: 40588, eps: 58.2, operatingMarginPct: 29.3 },
      { label: 'FY2023', revenueCr: 171871, profitCr: 31196, eps: 44.8, operatingMarginPct: 27.1 },
    ],
  },
  SBIN: {
    dataSource: 'reference_seed',
    asOf: 'FY2025 reference snapshot',
    sector: 'Financial Services',
    industry: 'Public Sector Bank',
    description: 'India’s largest public-sector bank with diversified corporate and retail lending.',
    marketCapCr: 710000,
    peRatio: 10.9,
    dividendYield: 1.6,
    faceValue: 1,
    bookValue: 429.6,
    financials: [
      { label: 'FY2025', revenueCr: 499863, profitCr: 70450, eps: 79.2, operatingMarginPct: 24.7 },
      { label: 'FY2024', revenueCr: 467727, profitCr: 61077, eps: 69.1, operatingMarginPct: 23.9 },
      { label: 'FY2023', revenueCr: 430040, profitCr: 50032, eps: 56.7, operatingMarginPct: 22.4 },
    ],
  },
  LT: {
    dataSource: 'reference_seed',
    asOf: 'FY2025 reference snapshot',
    sector: 'Industrials',
    industry: 'Engineering & Construction',
    description: 'Engineering, procurement, and construction leader with infra and services exposure.',
    marketCapCr: 515000,
    peRatio: 34.7,
    dividendYield: 0.9,
    faceValue: 2,
    bookValue: 676.1,
    financials: [
      { label: 'FY2025', revenueCr: 223118, profitCr: 17104, eps: 121.7, operatingMarginPct: 10.7 },
      { label: 'FY2024', revenueCr: 212048, profitCr: 15278, eps: 108.4, operatingMarginPct: 10.1 },
      { label: 'FY2023', revenueCr: 183341, profitCr: 12089, eps: 86.1, operatingMarginPct: 9.4 },
    ],
  },
  ITC: {
    dataSource: 'reference_seed',
    asOf: 'FY2025 reference snapshot',
    sector: 'Consumer Goods',
    industry: 'FMCG, Hotels & Agribusiness',
    description: 'Diversified consumer business spanning cigarettes, FMCG, hotels, paper, and agri.',
    marketCapCr: 542000,
    peRatio: 26.2,
    dividendYield: 3.5,
    faceValue: 1,
    bookValue: 58.4,
    financials: [
      { label: 'FY2025', revenueCr: 74120, profitCr: 20648, eps: 16.6, operatingMarginPct: 36.9 },
      { label: 'FY2024', revenueCr: 70641, profitCr: 19562, eps: 15.8, operatingMarginPct: 36.1 },
      { label: 'FY2023', revenueCr: 69481, profitCr: 19032, eps: 15.3, operatingMarginPct: 35.4 },
    ],
  },
}
