import moment from 'moment-timezone';
import { BrokerPosition } from './broker.js';
import { LegPosition } from './sitrep.js';

export interface ScripRecord {
  token: string;
  symbol: string;
  name: string;
  expiry: string;
  strike: string | number;
  lotsize: string | number;
  instrumenttype?: string;
  exch_seg?: string;
}

export class PositionMapper {
  /**
   * Parse Angel One trading symbol:
   * e.g., NIFTY25AUG2624800CE, RELIANCE29SEP261400CE, ABB25AUG267500PE
   */
  public static parseTradingSymbol(symbol: string): {
    underlying: string;
    expiryDateStr: string;
    strike: number;
    optionType: 'CE' | 'PE';
  } | null {
    // Regex matching: (ROOT_NAME)(2-digit day + 3-char month + 2-digit year)(STRIKE)(CE|PE)
    // or (ROOT_NAME)(2-digit day + 3-char month + 4-digit year)(STRIKE)(CE|PE)
    // Note: \d{2}[A-Z]{3}\d{2} strictly matches 7 chars like 25AUG26
    const regex = /^([A-Z]+)(\d{2}[A-Z]{3}\d{2}|\d{2}[A-Z]{3}\d{4})?(\d{4,6})(CE|PE)$/;
    const match = symbol.match(regex);

    if (!match) {
      return null;
    }

    const underlying = match[1];
    const rawExpiry = match[2];
    const strike = parseFloat(match[3]);
    const optionType = match[4] as 'CE' | 'PE';

    // Convert raw expiry token (e.g. 25AUG26 or 27AUG2026) to YYYY-MM-DD
    let expiryDateStr = '';
    if (rawExpiry) {
      const parsedMoment = moment(rawExpiry, ['DDMMMYY', 'DDMMMYYYY']);
      if (parsedMoment.isValid()) {
        expiryDateStr = parsedMoment.format('YYYY-MM-DD');
      }
    }

    return {
      underlying,
      expiryDateStr,
      strike,
      optionType
    };
  }

  /**
   * Maps live broker positions into Strategy Brain LegPosition records
   */
  public static mapBrokerPositionsToLegs(
    positions: BrokerPosition[],
    scripMaster: ScripRecord[] = []
  ): LegPosition[] {
    const legs: LegPosition[] = [];

    for (const pos of positions) {
      const parsed = this.parseTradingSymbol(pos.symbol);
      const side = pos.netQty > 0 ? 'BUY' : 'SELL';
      const qty = Math.abs(pos.netQty);

      let strike = parsed?.strike ?? 0;
      let optionType: 'CE' | 'PE' = parsed?.optionType ?? (pos.symbol.endsWith('PE') ? 'PE' : 'CE');
      let expiry = parsed?.expiryDateStr ?? '';

      // Match against scrip master if available
      const scripMatch = scripMaster.find(s => s.symbol === pos.symbol || s.token === pos.token);
      if (scripMatch) {
        if (!strike) {
          strike = parseFloat(String(scripMatch.strike)) || 0;
          if (strike > 100000) strike = strike / 100; // handle strike in paise
        }
        if (!expiry && scripMatch.expiry) {
          const parsedExp = moment(scripMatch.expiry, ['DDMMMYYYY', 'DDMMMYY', 'YYYY-MM-DD']);
          if (parsedExp.isValid()) {
            expiry = parsedExp.format('YYYY-MM-DD');
          }
        }
      }

      legs.push({
        symbol: pos.symbol,
        side,
        strike,
        optionType,
        expiry: expiry || moment().tz('Asia/Kolkata').format('YYYY-MM-DD'),
        qty,
        entryPrice: side === 'BUY' ? pos.cfBuyAvgPrice : pos.cfSellAvgPrice,
        ltp: pos.ltp,
        pnl: pos.pnl,
        status: 'OPEN'
      });
    }

    return legs;
  }

  /**
   * Derives a strategy name descriptor from portfolio legs
   */
  public static deriveStrategyName(legs: LegPosition[]): string {
    if (legs.length === 0) return 'NO_STRATEGY';

    const underlyings = new Set(legs.map(l => {
      const parsed = this.parseTradingSymbol(l.symbol);
      return parsed?.underlying || 'NIFTY';
    }));

    const root = underlyings.size === 1 ? Array.from(underlyings)[0] : 'PORTFOLIO';

    // Structure detection
    const expiries = new Set(legs.map(l => l.expiry));
    const strikes = new Set(legs.map(l => l.strike));

    if (expiries.size >= 2) {
      return `${root}-CALENDAR-RATIO-STRANGLE`;
    }

    if (legs.length === 4) {
      return `${root}-IRON-CONDOR`;
    }

    if (legs.length === 2 && strikes.size === 1) {
      return `${root}-STRADDLE`;
    }

    if (legs.length === 2 && strikes.size === 2) {
      return `${root}-STRANGLE`;
    }

    return `${root}-OPTIONS-BOOK`;
  }

  /**
   * Computes the exit threshold (default 2% of margin)
   */
  public static computeExitThreshold(strategy: string, marginUtilized: number): number {
    if (marginUtilized <= 0) {
      return 10000; // Fallback baseline INR 10k
    }
    return Math.round(marginUtilized * 0.02);
  }
}
