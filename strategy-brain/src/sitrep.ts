import fs from 'fs';
import path from 'path';
import { config } from './config.js';

export interface LegPosition {
  symbol: string;
  side: 'BUY' | 'SELL';
  strike: number;
  optionType: 'CE' | 'PE';
  expiry: string;
  qty: number;
  entryPrice?: number;
  ltp: number;
  pnl?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  status: 'OPEN' | 'CLOSED';
}

export interface CombinedPosition {
  strategy: string;
  status: 'FULL_ENTRY' | 'ADJUSTED' | 'EXITED' | 'NO_POSITION';
  legs: LegPosition[];
  netDelta: number;
  netGamma: number;
  netTheta: number;
  netVega: number;
  combinedMtm: number;
  realizedPnl: number;
  daysToT0: number;
  daysToT1?: number;
}

export interface SituationReport {
  timestamp: string;
  strategy: string;
  status: 'FULL_ENTRY' | 'ADJUSTED' | 'EXITED' | 'NO_POSITION';
  combinedPosition: CombinedPosition;
  marginUtilized: number;
  exitThreshold: number;
  dangerThreshold: number;
  spot: number;
  shortStrikeProximity: {
    closestShort: number;
    optionType: 'CE' | 'PE' | null;
    distance: number;
    distancePct: number;
    isBreachingWall: boolean;
  };
  marketContext: {
    niftySpot: number;
    spotUnderlying?: string;
    approximateSpot?: boolean;
    nifty5dReturnPct?: number;
    nifty20dVol?: number;
    vix?: number;
    isExpiryDay: boolean;
    daysToMonthlyExpiry: number;
  };
  openOrders: any[];
  triggerFired?: 'SCHEDULED' | 'MTM_DANGER' | 'WALL_PROXIMITY' | 'STRUCTURE_EVENT' | 'NONE';
}

export class SitrepCollector {
  /**
   * Approximates Black-Scholes Delta for a leg if not precomputed.
   */
  public static calculateApproxDelta(spot: number, strike: number, optionType: 'CE' | 'PE', daysToExpiry: number, iv = 0.15): number {
    if (daysToExpiry <= 0) {
      if (optionType === 'CE') return spot >= strike ? 1.0 : 0.0;
      return spot <= strike ? -1.0 : 0.0;
    }

    const t = daysToExpiry / 365;
    const d1 = (Math.log(spot / strike) + (0.06 + 0.5 * iv * iv) * t) / (iv * Math.sqrt(t));
    
    // Normal CDF approximation
    const cdf = (x: number) => {
      const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
      const sign = x < 0 ? -1 : 1;
      const absX = Math.abs(x) / Math.sqrt(2);
      const tVal = 1.0 / (1.0 + p * absX);
      const erf = 1.0 - (((((a5 * tVal + a4) * tVal) + a3) * tVal + a2) * tVal + a1) * tVal * Math.exp(-absX * absX);
      return 0.5 * (1.0 + sign * erf);
    };

    if (optionType === 'CE') {
      return cdf(d1);
    } else {
      return cdf(d1) - 1.0;
    }
  }

  /**
   * Summarizes all open legs to calculate combined position, MTM, and Greeks.
   */
  public static aggregateCombinedPosition(
    strategy: string,
    legs: LegPosition[],
    spot: number,
    daysToT0: number
  ): CombinedPosition {
    let combinedMtm = 0;
    let netDelta = 0;
    let netGamma = 0;
    let netTheta = 0;
    let netVega = 0;
    let realizedPnl = 0;

    const openLegs = legs.filter(l => l.status === 'OPEN');

    for (const leg of openLegs) {
      const legDelta = leg.delta ?? this.calculateApproxDelta(spot, leg.strike, leg.optionType, daysToT0);
      const qtyMultiplier = leg.side === 'BUY' ? leg.qty : -leg.qty;
      const positionDelta = (legDelta * qtyMultiplier) / (leg.qty || 1);

      netDelta += positionDelta;
      combinedMtm += leg.pnl ?? 0;
      netGamma += (leg.gamma ?? 0) * (leg.side === 'BUY' ? 1 : -1);
      netTheta += (leg.theta ?? 0) * (leg.side === 'BUY' ? 1 : -1);
      netVega += (leg.vega ?? 0) * (leg.side === 'BUY' ? 1 : -1);
    }

    const closedLegs = legs.filter(l => l.status === 'CLOSED');
    for (const leg of closedLegs) {
      realizedPnl += leg.pnl ?? 0;
    }

    return {
      strategy,
      status: openLegs.length > 0 ? 'FULL_ENTRY' : 'NO_POSITION',
      legs: openLegs,
      netDelta: parseFloat(netDelta.toFixed(4)),
      netGamma: parseFloat(netGamma.toFixed(4)),
      netTheta: parseFloat(netTheta.toFixed(2)),
      netVega: parseFloat(netVega.toFixed(2)),
      combinedMtm: parseFloat(combinedMtm.toFixed(2)),
      realizedPnl: parseFloat(realizedPnl.toFixed(2)),
      daysToT0
    };
  }

  /**
   * Evaluates proximity of current spot to nearest short strike wall.
   */
  public static evaluateShortStrikeProximity(
    legs: LegPosition[],
    spot: number,
    wallDistance = config.WALL_DISTANCE_POINTS
  ) {
    const openShorts = legs.filter(l => l.status === 'OPEN' && l.side === 'SELL');
    if (openShorts.length === 0) {
      return {
        closestShort: 0,
        optionType: null,
        distance: 999999,
        distancePct: 100,
        isBreachingWall: false
      };
    }

    let minDistance = Infinity;
    let closestShort = openShorts[0].strike;
    let closestType: 'CE' | 'PE' | null = openShorts[0].optionType;

    for (const short of openShorts) {
      const dist = Math.abs(spot - short.strike);
      if (dist < minDistance) {
        minDistance = dist;
        closestShort = short.strike;
        closestType = short.optionType;
      }
    }

    const distancePct = parseFloat(((minDistance / spot) * 100).toFixed(2));
    const isBreachingWall = minDistance <= wallDistance;

    return {
      closestShort,
      optionType: closestType,
      distance: parseFloat(minDistance.toFixed(2)),
      distancePct,
      isBreachingWall
    };
  }

  /**
   * Builds the complete SITREP object.
   */
  public static buildSitrep(params: {
    strategy: string;
    legs: LegPosition[];
    spot: number;
    daysToT0: number;
    marginUtilized: number;
    exitThreshold: number;
    marketContext?: Partial<SituationReport['marketContext']>;
  }): SituationReport {
    const combinedPosition = this.aggregateCombinedPosition(
      params.strategy,
      params.legs,
      params.spot,
      params.daysToT0
    );

    const dangerThreshold = params.exitThreshold * config.DANGER_THRESHOLD_FACTOR;
    const proximity = this.evaluateShortStrikeProximity(params.legs, params.spot);

    let triggerFired: SituationReport['triggerFired'] = 'NONE';
    if (Math.abs(combinedPosition.combinedMtm) >= dangerThreshold && combinedPosition.combinedMtm < 0) {
      triggerFired = 'MTM_DANGER';
    } else if (proximity.isBreachingWall) {
      triggerFired = 'WALL_PROXIMITY';
    } else if (params.daysToT0 <= 1) {
      triggerFired = 'STRUCTURE_EVENT';
    }

    return {
      timestamp: new Date().toISOString(),
      strategy: params.strategy,
      status: combinedPosition.status,
      combinedPosition,
      marginUtilized: params.marginUtilized,
      exitThreshold: params.exitThreshold,
      dangerThreshold,
      spot: params.spot,
      shortStrikeProximity: proximity,
      marketContext: {
        niftySpot: params.spot,
        isExpiryDay: false,
        daysToMonthlyExpiry: params.daysToT0,
        ...params.marketContext
      },
      openOrders: [],
      triggerFired
    };
  }

  /**
   * Loads scrip master records if available on disk.
   */
  public static async loadScripMaster(filePath = config.SCRIP_MASTER_PATH): Promise<any[]> {
    const { loadScripMaster } = await import('./scripMasterResolver.js');
    return loadScripMaster(filePath);
  }

  /**
   * Fetches real live broker data from SmartAPI and creates a SituationReport.
   */
  public static async buildFromBroker(
    strategyFilter?: string,
    brokerClient?: any
  ): Promise<SituationReport> {
    const { SmartAPIBrokerClient } = await import('./broker.js');
    const { PositionMapper } = await import('./positionMapper.js');
    const moment = (await import('moment-timezone')).default;

    const client = brokerClient || new SmartAPIBrokerClient();

    try {
      const auth = await client.login();
      const rawPositions = await client.fetchPositions(auth.jwtToken);
      const marginUtilized = await client.fetchRMSMargin(auth.jwtToken).catch(() => 0);
      const scripMaster = await this.loadScripMaster();

      // Filter to NFO / relevant strategy if requested
      const prefix = strategyFilter || config.STRATEGY_PREFIX;
      const filteredPositions = rawPositions.filter((p: any) => {
        if (p.exchange && p.exchange !== 'NFO' && p.exchange !== 'BFO') {
          return false;
        }
        if (prefix) {
          return p.symbol.startsWith(prefix);
        }
        return true;
      });

      const legs = PositionMapper.mapBrokerPositionsToLegs(filteredPositions, scripMaster);
      const derivedStrategy = prefix || PositionMapper.deriveStrategyName(legs);

      // Determine underlying root
      let underlying = 'NIFTY';
      if (prefix) {
        underlying = prefix.replace(/[^A-Za-z]/g, '').toUpperCase();
      } else if (legs.length > 0) {
        const underlyings = new Set(
          legs.map(l => PositionMapper.parseTradingSymbol(l.symbol)?.underlying || 'NIFTY')
        );
        if (underlyings.size === 1) {
          underlying = Array.from(underlyings)[0];
        } else if (underlyings.size > 1) {
          console.warn(`[SitrepCollector] Positions span multiple underlyings (${Array.from(underlyings).join(', ')}). Using NIFTY primary spot.`);
          underlying = 'NIFTY';
        }
      }

      let approximateSpot = false;
      let spot = 24500;
      try {
        spot = await client.fetchSpot(auth.jwtToken, underlying);
      } catch (spotErr: any) {
        console.warn(`[SitrepCollector] Spot fetch failed for ${underlying} (${spotErr.message}). Using fallback 24500.`);
        approximateSpot = true;
        spot = 24500;
      }

      if (legs.length === 0) {
        const emptySitrep = this.buildSitrep({
          strategy: derivedStrategy,
          legs: [],
          spot,
          daysToT0: 0,
          marginUtilized,
          exitThreshold: PositionMapper.computeExitThreshold(derivedStrategy, marginUtilized),
          marketContext: {
            niftySpot: spot,
            spotUnderlying: underlying,
            approximateSpot
          }
        });
        emptySitrep.status = 'NO_POSITION';
        return emptySitrep;
      }

      // Calculate days to T0 (nearest expiry)
      const now = moment().tz('Asia/Kolkata');
      let minDaysToT0 = 999;
      for (const leg of legs) {
        const legExpiry = moment.tz(leg.expiry, 'Asia/Kolkata');
        const diffDays = Math.max(0, legExpiry.diff(now, 'days'));
        if (diffDays < minDaysToT0) {
          minDaysToT0 = diffDays;
        }
      }

      const exitThreshold = PositionMapper.computeExitThreshold(derivedStrategy, marginUtilized);

      return this.buildSitrep({
        strategy: derivedStrategy,
        legs,
        spot,
        daysToT0: minDaysToT0 === 999 ? 0 : minDaysToT0,
        marginUtilized,
        exitThreshold,
        marketContext: {
          niftySpot: spot,
          spotUnderlying: underlying,
          approximateSpot,
          isExpiryDay: minDaysToT0 === 0,
          daysToMonthlyExpiry: minDaysToT0
        }
      });
    } catch (err: any) {
      console.error(`[SitrepCollector] Failed to fetch live data from broker: ${err.message}`);
      const fallbackSitrep = this.buildSitrep({
        strategy: strategyFilter || 'LIVE-BROKER-ERROR',
        legs: [],
        spot: 24500,
        daysToT0: 0,
        marginUtilized: 0,
        exitThreshold: 10000,
        marketContext: {
          niftySpot: 24500,
          spotUnderlying: strategyFilter ? strategyFilter.replace(/[^A-Za-z]/g, '').toUpperCase() : 'NIFTY',
          approximateSpot: true
        }
      });
      fallbackSitrep.status = 'NO_POSITION';
      return fallbackSitrep;
    }
  }
}
