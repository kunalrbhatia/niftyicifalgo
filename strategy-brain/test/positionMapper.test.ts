import { describe, it, expect } from 'vitest';
import { PositionMapper, ScripRecord } from '../src/positionMapper.js';
import { BrokerPosition } from '../src/broker.js';

describe('PositionMapper', () => {
  it('should parse NIFTY, RELIANCE, and ABB option trading symbols accurately', () => {
    const nifty = PositionMapper.parseTradingSymbol('NIFTY25AUG2624800CE');
    expect(nifty).not.toBeNull();
    expect(nifty?.underlying).toBe('NIFTY');
    expect(nifty?.strike).toBe(24800);
    expect(nifty?.optionType).toBe('CE');
    expect(nifty?.expiryDateStr).toBe('2026-08-25');

    const reliance = PositionMapper.parseTradingSymbol('RELIANCE29SEP261400CE');
    expect(reliance).not.toBeNull();
    expect(reliance?.underlying).toBe('RELIANCE');
    expect(reliance?.strike).toBe(1400);
    expect(reliance?.optionType).toBe('CE');
    expect(reliance?.expiryDateStr).toBe('2026-09-29');

    const abb = PositionMapper.parseTradingSymbol('ABB25AUG267500PE');
    expect(abb).not.toBeNull();
    expect(abb?.underlying).toBe('ABB');
    expect(abb?.strike).toBe(7500);
    expect(abb?.optionType).toBe('PE');
    expect(abb?.expiryDateStr).toBe('2026-08-25');
  });

  it('should map broker positions to LegPosition records with correct side and qty', () => {
    const brokerPositions: BrokerPosition[] = [
      {
        symbol: 'NIFTY25AUG2624800CE',
        token: '12345',
        netQty: -65,
        ltp: 45.5,
        cfSellAvgPrice: 50.0,
        cfBuyAvgPrice: 0,
        realised: 0,
        unrealised: 292.5,
        pnl: 292.5,
        exchange: 'NFO'
      },
      {
        symbol: 'NIFTY25AUG2624000PE',
        token: '12346',
        netQty: 130,
        ltp: 20.0,
        cfSellAvgPrice: 0,
        cfBuyAvgPrice: 18.0,
        realised: 0,
        unrealised: 260.0,
        pnl: 260.0,
        exchange: 'NFO'
      }
    ];

    const scripMaster: ScripRecord[] = [
      { token: '12345', symbol: 'NIFTY25AUG2624800CE', name: 'NIFTY', expiry: '25AUG2026', strike: '24800', lotsize: '65' },
      { token: '12346', symbol: 'NIFTY25AUG2624000PE', name: 'NIFTY', expiry: '25AUG2026', strike: '24000', lotsize: '65' }
    ];

    const legs = PositionMapper.mapBrokerPositionsToLegs(brokerPositions, scripMaster);
    expect(legs.length).toBe(2);

    expect(legs[0].side).toBe('SELL');
    expect(legs[0].qty).toBe(65);
    expect(legs[0].strike).toBe(24800);
    expect(legs[0].optionType).toBe('CE');
    expect(legs[0].status).toBe('OPEN');

    expect(legs[1].side).toBe('BUY');
    expect(legs[1].qty).toBe(130);
    expect(legs[1].strike).toBe(24000);
    expect(legs[1].optionType).toBe('PE');
  });

  it('should derive strategy name descriptors correctly', () => {
    const calendarLegs = PositionMapper.mapBrokerPositionsToLegs([
      { symbol: 'NIFTY25AUG2624800CE', token: '1', netQty: -65, ltp: 10, cfSellAvgPrice: 10, cfBuyAvgPrice: 0, realised: 0, unrealised: 0, pnl: 0, exchange: 'NFO' },
      { symbol: 'NIFTY01SEP2624800CE', token: '2', netQty: 65, ltp: 20, cfSellAvgPrice: 0, cfBuyAvgPrice: 20, realised: 0, unrealised: 0, pnl: 0, exchange: 'NFO' }
    ]);
    expect(PositionMapper.deriveStrategyName(calendarLegs)).toBe('NIFTY-CALENDAR-RATIO-STRANGLE');

    const ironCondorLegs = PositionMapper.mapBrokerPositionsToLegs([
      { symbol: 'NIFTY25AUG2625000CE', token: '1', netQty: -65, ltp: 10, cfSellAvgPrice: 10, cfBuyAvgPrice: 0, realised: 0, unrealised: 0, pnl: 0, exchange: 'NFO' },
      { symbol: 'NIFTY25AUG2625200CE', token: '2', netQty: 65, ltp: 5, cfSellAvgPrice: 0, cfBuyAvgPrice: 5, realised: 0, unrealised: 0, pnl: 0, exchange: 'NFO' },
      { symbol: 'NIFTY25AUG2624000PE', token: '3', netQty: -65, ltp: 10, cfSellAvgPrice: 10, cfBuyAvgPrice: 0, realised: 0, unrealised: 0, pnl: 0, exchange: 'NFO' },
      { symbol: 'NIFTY25AUG2623800PE', token: '4', netQty: 65, ltp: 5, cfSellAvgPrice: 0, cfBuyAvgPrice: 5, realised: 0, unrealised: 0, pnl: 0, exchange: 'NFO' }
    ]);
    expect(PositionMapper.deriveStrategyName(ironCondorLegs)).toBe('NIFTY-IRON-CONDOR');

    expect(PositionMapper.deriveStrategyName([])).toBe('NO_STRATEGY');
  });

  it('should compute exit threshold as 2% of margin with fallback', () => {
    expect(PositionMapper.computeExitThreshold('NIFTY-IC', 500000)).toBe(10000);
    expect(PositionMapper.computeExitThreshold('NIFTY-IC', 0)).toBe(10000);
  });
});
