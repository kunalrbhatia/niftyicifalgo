import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { SmartAPIBrokerClient } from '../src/broker.js';
import { SitrepCollector } from '../src/sitrep.js';

vi.mock('axios');

describe('SmartAPIBrokerClient & Broker-driven SITREP', () => {
  let broker: SmartAPIBrokerClient;

  beforeEach(() => {
    vi.clearAllMocks();
    broker = new SmartAPIBrokerClient();
    (broker as any).cachedPublicIP = '103.160.108.203';
  });

  it('should login and return jwtToken successfully', async () => {
    (axios.post as any).mockResolvedValueOnce({
      data: {
        status: true,
        data: { jwtToken: 'mock_jwt_token_123' }
      }
    });

    const res = await broker.login();
    expect(res.jwtToken).toBe('mock_jwt_token_123');
  });

  it('should fetch positions and filter netqty !== 0', async () => {
    (axios.get as any).mockResolvedValueOnce({
      data: {
        status: true,
        data: [
          { tradingsymbol: 'NIFTY25AUG2624500CE', symboltoken: '999', netqty: '-65', ltp: '40', cfSellAvgPrice: '50', exchange: 'NFO' },
          { tradingsymbol: 'NIFTY25AUG2624000PE', symboltoken: '998', netqty: '0', ltp: '10', exchange: 'NFO' }
        ]
      }
    });

    const positions = await broker.fetchPositions('mock_jwt');
    expect(positions.length).toBe(1);
    expect(positions[0].symbol).toBe('NIFTY25AUG2624500CE');
    expect(positions[0].netQty).toBe(-65);
    expect(positions[0].ltp).toBe(40);
  });

  it('should fetch RMS margin utiliseddebits', async () => {
    (axios.get as any).mockResolvedValueOnce({
      data: {
        status: true,
        data: { utiliseddebits: '450000.50' }
      }
    });

    const margin = await broker.fetchRMSMargin('mock_jwt');
    expect(margin).toBe(450000.50);
  });

  it('should fetch Spot price for Nifty 50 by default', async () => {
    (axios.post as any).mockResolvedValueOnce({
      data: {
        status: true,
        data: { ltp: 24550.25 }
      }
    });

    const spot = await broker.fetchSpot('mock_jwt');
    expect(spot).toBe(24550.25);
  });

  it('should fetch Spot price with pre-resolved spotToken directly', async () => {
    let capturedPayload: any = null;
    (axios.post as any).mockImplementation((url: string, payload: any) => {
      if (url.includes('getLtpData')) {
        capturedPayload = payload;
        return Promise.resolve({
          data: {
            status: true,
            data: { ltp: 7210.00 }
          }
        });
      }
      return Promise.resolve({ data: {} });
    });

    const spot = await broker.fetchSpot('mock_jwt', 'ABB', {
      exchange: 'NSE',
      symboltoken: '13',
      tradingsymbol: 'ABB-EQ'
    });
    expect(spot).toBe(7210.00);
    expect(capturedPayload).toEqual({
      exchange: 'NSE',
      symboltoken: '13',
      tradingsymbol: 'ABB-EQ'
    });
  });

  it('should produce a full SituationReport via SitrepCollector.buildFromBroker', async () => {
    const mockBroker = {
      login: vi.fn().mockResolvedValue({ jwtToken: 'mock_jwt' }),
      fetchPositions: vi.fn().mockResolvedValue([
        { symbol: 'NIFTY25AUG2624500CE', token: '999', netQty: -65, ltp: 40, cfSellAvgPrice: 50, cfBuyAvgPrice: 0, realised: 0, unrealised: 100, pnl: 100, exchange: 'NFO' }
      ]),
      fetchRMSMargin: vi.fn().mockResolvedValue(500000),
      fetchSpot: vi.fn().mockResolvedValue(24480)
    };

    const sitrep = await SitrepCollector.buildFromBroker(undefined, mockBroker);
    expect(sitrep.status).toBe('FULL_ENTRY');
    expect(sitrep.spot).toBe(24480);
    expect(sitrep.marginUtilized).toBe(500000);
    expect(sitrep.combinedPosition.legs.length).toBe(1);
    expect(sitrep.combinedPosition.legs[0].strike).toBe(24500);
  });

  it('should call fetchSpot with underlying ABB when filtered positions are ABB options', async () => {
    const mockBroker = {
      login: vi.fn().mockResolvedValue({ jwtToken: 'mock_jwt' }),
      fetchPositions: vi.fn().mockResolvedValue([
        { symbol: 'ABB25AUG267500CE', token: '5678', netQty: -125, ltp: 80, cfSellAvgPrice: 90, cfBuyAvgPrice: 0, realised: 0, unrealised: 1250, pnl: 1250, exchange: 'NFO' }
      ]),
      fetchRMSMargin: vi.fn().mockResolvedValue(300000),
      fetchSpot: vi.fn().mockResolvedValue(7180)
    };

    const sitrep = await SitrepCollector.buildFromBroker('ABB', mockBroker);
    expect(sitrep.status).toBe('FULL_ENTRY');
    expect(sitrep.spot).toBe(7180);
    expect(sitrep.marketContext.spotUnderlying).toBe('ABB');
    expect(mockBroker.fetchSpot).toHaveBeenCalledWith(
      'mock_jwt',
      'ABB',
      expect.objectContaining({ symboltoken: '13', tradingsymbol: 'ABB-EQ' })
    );
  });

  it('should return NO_POSITION when broker has no open positions', async () => {
    const mockBroker = {
      login: vi.fn().mockResolvedValue({ jwtToken: 'mock_jwt' }),
      fetchPositions: vi.fn().mockResolvedValue([]),
      fetchRMSMargin: vi.fn().mockResolvedValue(0),
      fetchSpot: vi.fn().mockResolvedValue(24500)
    };

    const sitrep = await SitrepCollector.buildFromBroker(undefined, mockBroker);
    expect(sitrep.status).toBe('NO_POSITION');
    expect(sitrep.combinedPosition.legs.length).toBe(0);
  });
});
