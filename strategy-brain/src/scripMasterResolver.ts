import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { config } from './config.js';
import { ScripRecord } from './positionMapper.js';

export interface SpotInstrumentToken {
  exchange: string;
  symboltoken: string;
  tradingsymbol: string;
}

const FULL_MASTER_URL = 'https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json';

/**
 * Loads scrip master records if available on disk.
 */
export async function loadScripMaster(filePath = config.SCRIP_MASTER_PATH): Promise<ScripRecord[]> {
  const candidates = [
    path.resolve(filePath),
    path.resolve(process.cwd(), '../scrip_master.json'),
    path.resolve(process.cwd(), './scrip_master.json')
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const content = await fs.promises.readFile(p, 'utf8');
        return JSON.parse(content);
      } catch {
        // ignore error and check next candidate
      }
    }
  }

  return [];
}

/**
 * Downloads full Angel One Scrip Master with 24h disk caching.
 */
export async function downloadFullScripMaster(
  cachePath = config.FULL_SCRIP_MASTER_PATH,
  ttlHours = config.FULL_SCRIP_MASTER_TTL_HOURS
): Promise<ScripRecord[]> {
  const resolvedCachePath = path.resolve(process.cwd(), cachePath);

  // Check existing cache and TTL
  if (fs.existsSync(resolvedCachePath)) {
    try {
      const stats = await fs.promises.stat(resolvedCachePath);
      const ageHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);

      if (ageHours < ttlHours) {
        const content = await fs.promises.readFile(resolvedCachePath, 'utf8');
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed) && parsed.length > 0) {
          console.log(`[scripMasterResolver] Using cached full scrip master (${parsed.length} records, age ${ageHours.toFixed(1)}h)`);
          return parsed;
        }
      }
    } catch (err: any) {
      console.warn(`[scripMasterResolver] Error reading cached full scrip master: ${err.message}. Re-downloading.`);
    }
  }

  // Download fresh master
  console.log(`[scripMasterResolver] Downloading full scrip master from ${FULL_MASTER_URL}...`);
  const response = await axios.get(FULL_MASTER_URL, { timeout: 90000 });
  if (!Array.isArray(response.data)) {
    throw new Error('Invalid response format from Angel One Full Scrip Master');
  }

  const records: ScripRecord[] = response.data;
  console.log(`[scripMasterResolver] Downloaded full scrip master (${records.length} records)`);

  // Ensure parent directory exists
  const dir = path.dirname(resolvedCachePath);
  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  await fs.promises.writeFile(resolvedCachePath, JSON.stringify(records), 'utf8');
  return records;
}

/**
 * Resolves equity or index spot instrument token from an in-memory scrip master array.
 *
 * @param scripMaster Scrip master array of records
 * @param underlying Symbol name (e.g. 'ABB', 'RELIANCE', 'NIFTY', 'NIFTY 50')
 * @returns SpotInstrumentToken or null if not found
 */
export function resolveSpotTokenFromScripMaster(
  scripMaster: ScripRecord[],
  underlying: string
): SpotInstrumentToken | null {
  if (!underlying) {
    return null;
  }

  const clean = underlying.trim().toUpperCase();

  // Special index case for NIFTY
  if (clean === 'NIFTY' || clean === 'NIFTY 50' || clean === 'NIFTY50') {
    return {
      exchange: 'NSE',
      symboltoken: '99926000',
      tradingsymbol: 'Nifty 50'
    };
  }

  // Look for equity cash market row on NSE
  // Non-derivative rows typically have exch_seg === 'NSE' and instrumenttype like 'EQ', 'AMXEQ', '' or not derivative
  const derivativeTypes = ['OPTSTK', 'OPTIDX', 'FUTSTK', 'FUTIDX', 'OPTIRC', 'FUTIRC'];

  const matches = scripMaster.filter(s => {
    const symMatch = s.symbol?.toUpperCase() === clean || s.symbol?.toUpperCase() === `${clean}-EQ` || s.name?.toUpperCase() === clean;
    const isNSE = s.exch_seg === 'NSE';
    const isNotDerivative = !s.instrumenttype || !derivativeTypes.includes(s.instrumenttype.toUpperCase());
    const isNotOptionSym = !s.symbol?.toUpperCase().endsWith('CE') && !s.symbol?.toUpperCase().endsWith('PE');
    const hasNoExpiry = !s.expiry || s.expiry === '';
    return symMatch && isNSE && isNotDerivative && isNotOptionSym && hasNoExpiry;
  });

  if (matches.length > 0) {
    // Prefer row with symbol === clean-EQ or symbol === clean
    const preferred = matches.find(m => m.symbol?.toUpperCase() === `${clean}-EQ` || m.symbol?.toUpperCase() === clean) || matches[0];
    return {
      exchange: preferred.exch_seg || 'NSE',
      symboltoken: preferred.token,
      tradingsymbol: preferred.symbol
    };
  }

  // Fallback: match any NSE row with name === clean and strike/expiry empty
  const fallback = scripMaster.find(s => {
    const nameMatch = s.name?.toUpperCase() === clean;
    const isNSE = s.exch_seg === 'NSE';
    const isNotDerivative = !s.instrumenttype || !derivativeTypes.includes(s.instrumenttype.toUpperCase());
    const isNotOptionSym = !s.symbol?.toUpperCase().endsWith('CE') && !s.symbol?.toUpperCase().endsWith('PE');
    const hasNoStrike = !s.strike || s.strike === '-1' || s.strike === '0';
    const hasNoExpiry = !s.expiry || s.expiry === '';
    return nameMatch && isNSE && isNotDerivative && isNotOptionSym && hasNoStrike && hasNoExpiry;
  });

  if (fallback) {
    return {
      exchange: fallback.exch_seg || 'NSE',
      symboltoken: fallback.token,
      tradingsymbol: fallback.symbol
    };
  }

  return null;
}

/**
 * Resolves spot instrument token with automatic fallback to the full scrip master.
 *
 * @param underlying Symbol name (e.g. 'ABB', 'RELIANCE', 'NIFTY')
 * @returns SpotInstrumentToken or null
 */
export async function resolveSpotTokenWithFallback(
  underlying: string
): Promise<SpotInstrumentToken | null> {
  if (!underlying) {
    return null;
  }

  const clean = underlying.trim().toUpperCase();

  // 1. NIFTY immediate hardcoded mapping
  if (clean === 'NIFTY' || clean === 'NIFTY 50' || clean === 'NIFTY50') {
    return {
      exchange: 'NSE',
      symboltoken: '99926000',
      tradingsymbol: 'Nifty 50'
    };
  }

  // 2. Try the primary (NFO / local) scrip master first (fast, in-memory)
  const localMaster = await loadScripMaster();
  const localMatch = resolveSpotTokenFromScripMaster(localMaster, clean);
  if (localMatch) {
    return localMatch;
  }

  // 3. Fallback to the full Angel One master (cached on disk with 24h TTL)
  try {
    const fullMaster = await downloadFullScripMaster();
    const fullMatch = resolveSpotTokenFromScripMaster(fullMaster, clean);
    if (fullMatch) {
      console.log(`[scripMasterResolver] Resolved spot token for ${clean} via full scrip master: token ${fullMatch.symboltoken} (${fullMatch.tradingsymbol})`);
      return fullMatch;
    }
  } catch (err: any) {
    console.warn(`[scripMasterResolver] Full scrip master resolution failed for ${clean}: ${err.message}`);
  }

  return null;
}

