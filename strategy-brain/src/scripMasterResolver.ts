import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { ScripRecord } from './positionMapper.js';

export interface SpotInstrumentToken {
  exchange: string;
  symboltoken: string;
  tradingsymbol: string;
}

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
 * Resolves equity or index spot instrument token from scrip master.
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
    return symMatch && isNSE && isNotDerivative;
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
    const hasNoStrike = !s.strike || s.strike === '-1' || s.strike === '0';
    const hasNoExpiry = !s.expiry;
    return nameMatch && isNSE && hasNoStrike && hasNoExpiry;
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
