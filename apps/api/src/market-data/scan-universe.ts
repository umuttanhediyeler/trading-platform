import { UNIVERSE } from './universe';

/**
 * Additional liquid US-listed equities that extend the curated realtime
 * `UNIVERSE` (~109 symbols) into the full scanner universe (500+ symbols).
 *
 * Composition: roughly the S&P 500 constituency plus a handful of liquid
 * non-index names, grouped by sector for reviewability. Symbols already in
 * `UNIVERSE` are de-duplicated when `SCAN_UNIVERSE` is assembled, so entries
 * here may safely overlap with it.
 *
 * Unlike `UNIVERSE`, this list is only consumed by bulk/batched paths
 * (scan runs, nightly daily-bar backfill) that are rate-limit aware — never
 * by per-symbol realtime subscriptions.
 */
const SCAN_UNIVERSE_EXTENSION: readonly string[] = [
  // Technology — software, semis, hardware, IT services
  'ACN', 'ADI', 'ADSK', 'AKAM', 'APH', 'APP', 'AFRM', 'ARM', 'BILL', 'CDNS',
  'CDW', 'CFLT', 'CTSH', 'DDOG', 'DELL', 'DOCU', 'EPAM', 'ESTC', 'FICO',
  'FSLR', 'FTNT', 'GDDY', 'GEN', 'GLW', 'GTLB', 'HPE', 'HPQ', 'HUBS', 'IT',
  'JNPR', 'KEYS', 'KLAC', 'MCHP', 'MDB', 'MPWR', 'MSI', 'MSTR', 'NET',
  'NTAP', 'NTNX', 'NXPI', 'OKTA', 'ON', 'PATH', 'PAYC', 'PCTY', 'PSTG',
  'PTC', 'QRVO', 'ROP', 'RBLX', 'S', 'SNPS', 'STX', 'SWKS', 'TDY', 'TEAM',
  'TEL', 'TER', 'TRMB', 'TTD', 'TWLO', 'TYL', 'U', 'VRSN', 'WDAY', 'WDC',
  'ZBRA', 'ZM', 'ZS', 'DUOL', 'ENPH', 'ADP', 'PAYX',
  // Communication services & media
  'GOOG', 'CHTR', 'CMCSA', 'EA', 'FOX', 'FOXA', 'IPG', 'LYV', 'MTCH', 'NWS',
  'NWSA', 'OMC', 'PARA', 'PINS', 'RDDT', 'ROKU', 'SIRI', 'SNAP', 'SPOT',
  'TTWO', 'WBD',
  // Financials
  'AFL', 'AIG', 'AJG', 'ALL', 'ALLY', 'AMP', 'AON', 'APO', 'ARES', 'BEN',
  'BK', 'BRK.B', 'BRO', 'CB', 'CBOE', 'CFG', 'CINF', 'CME', 'COF', 'ERIE',
  'FDS', 'FI', 'FIS', 'FITB', 'GL', 'GPN', 'HBAN', 'HIG', 'HOOD', 'IBKR',
  'ICE', 'IVZ', 'JKHY', 'KEY', 'L', 'LPLA', 'MCO', 'MET', 'MKL', 'MKTX',
  'MMC', 'MSCI', 'MTB', 'NDAQ', 'NTRS', 'OWL', 'PFG', 'PGR', 'PNC', 'PRU',
  'RF', 'RJF', 'SOFI', 'SPGI', 'STT', 'SYF', 'TFC', 'TROW', 'TRV', 'USB',
  'WRB', 'WTW', 'ACGL', 'AIZ', 'EG',
  // Healthcare
  'A', 'ALGN', 'ALNY', 'BAX', 'BDX', 'BIIB', 'BMRN', 'BSX', 'CAH', 'CI',
  'CNC', 'COO', 'COR', 'CRL', 'DGX', 'DHR', 'DVA', 'DXCM', 'ELV', 'EW',
  'EXAS', 'GEHC', 'HCA', 'HOLX', 'HSIC', 'HUM', 'IDXX', 'ILMN', 'INCY',
  'IQV', 'JAZZ', 'LH', 'MCK', 'MOH', 'MRNA', 'MTD', 'NBIX', 'PODD', 'REGN',
  'RMD', 'RVTY', 'SOLV', 'SRPT', 'STE', 'SYK', 'TECH', 'TFX', 'UHS', 'UTHR',
  'VEEV', 'VRTX', 'VTRS', 'WAT', 'WST', 'ZBH', 'ZTS',
  // Industrials
  'AME', 'AOS', 'AXON', 'BLDR', 'CARR', 'CHRW', 'CMI', 'CPRT', 'CSX',
  'CTAS', 'DAY', 'DOV', 'EFX', 'EMR', 'ETN', 'EXPD', 'FAST', 'FTV', 'GD',
  'GEV', 'GGG', 'GNRC', 'GWW', 'HII', 'HUBB', 'HWM', 'IEX', 'IR', 'ITW',
  'J', 'JBHT', 'JCI', 'LDOS', 'LHX', 'LUV', 'MAS', 'MMM', 'NDSN', 'NOC',
  'NSC', 'ODFL', 'OTIS', 'PCAR', 'PH', 'PNR', 'PWR', 'ROK', 'ROL', 'RSG',
  'SNA', 'SWK', 'TDG', 'TT', 'TXT', 'URI', 'VLTO', 'VRSK', 'VRT', 'WAB',
  'WM', 'XYL', 'ALK',
  // Consumer discretionary
  'APTV', 'AZO', 'BBY', 'BURL', 'BWA', 'CCL', 'CHWY', 'CMG', 'CVNA', 'CZR',
  'DASH', 'DECK', 'DHI', 'DKNG', 'DPZ', 'DRI', 'EBAY', 'ETSY', 'EXPE',
  'GRMN', 'GPC', 'HAS', 'HLT', 'KMX', 'LEN', 'LKQ', 'LVS', 'LYFT', 'MGM',
  'MHK', 'NCLH', 'NVR', 'ORLY', 'PHM', 'POOL', 'RCL', 'RL', 'ROST', 'TJX',
  'TPR', 'TSCO', 'ULTA', 'VFC', 'W', 'WSM', 'WYNN', 'YUM',
  // Consumer staples
  'ADM', 'BF.B', 'BG', 'CAG', 'CELH', 'CHD', 'CL', 'CLX', 'CPB', 'DG',
  'DLTR', 'EL', 'ELF', 'GIS', 'HRL', 'HSY', 'K', 'KDP', 'KHC', 'KMB', 'KR',
  'KVUE', 'MKC', 'MNST', 'MO', 'SJM', 'STZ', 'SYY', 'TAP', 'TSN', 'WBA',
  // Energy
  'APA', 'BKR', 'CTRA', 'DVN', 'EOG', 'EQT', 'FANG', 'HAL', 'KMI', 'LNG',
  'MPC', 'OKE', 'PSX', 'TRGP', 'VLO', 'WMB',
  // Materials
  'ALB', 'AMCR', 'AVY', 'CE', 'CF', 'CTVA', 'DD', 'DOW', 'ECL', 'EMN',
  'IFF', 'IP', 'LYB', 'MLM', 'MOS', 'NUE', 'PKG', 'PPG', 'SHW', 'STLD',
  'SW', 'VMC', 'WY',
  // Utilities
  'AEE', 'AEP', 'AES', 'ATO', 'AWK', 'CEG', 'CMS', 'CNP', 'D', 'DTE', 'ED',
  'EIX', 'ES', 'ETR', 'EVRG', 'EXC', 'FE', 'LNT', 'NI', 'NRG', 'PCG',
  'PEG', 'PNW', 'PPL', 'SO', 'SRE', 'VST', 'WEC', 'XEL',
  // Real estate
  'ARE', 'AVB', 'BXP', 'CBRE', 'CCI', 'CPT', 'CSGP', 'DLR', 'DOC', 'EQIX',
  'EQR', 'ESS', 'EXR', 'FRT', 'HST', 'INVH', 'IRM', 'KIM', 'MAA', 'O',
  'PSA', 'REG', 'SBAC', 'SPG', 'UDR', 'VICI', 'VTR', 'WELL',
];

function dedupe(symbols: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of symbols) {
    const symbol = raw.trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    result.push(symbol);
  }
  return result;
}

/**
 * Full scanner universe (500+ liquid US symbols). Ordering keeps the curated
 * high-liquidity `UNIVERSE` first so top-N slices remain meaningful.
 */
export const SCAN_UNIVERSE: readonly string[] = dedupe([
  ...UNIVERSE,
  ...SCAN_UNIVERSE_EXTENSION,
]);
