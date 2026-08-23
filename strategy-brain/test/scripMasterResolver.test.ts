import { describe, it, expect } from 'vitest';
import { resolveSpotTokenFromScripMaster } from '../src/scripMasterResolver.js';
import { ScripRecord } from '../src/positionMapper.js';

describe('scripMasterResolver', () => {
  const mockScripMaster: ScripRecord[] = [
    {
      token: '1234',
      symbol: 'ABB-EQ',
      name: 'ABB',
      expiry: '',
      strike: '-1',
      lotsize: '125',
      instrumenttype: '',
      exch_seg: 'NSE'
    },
    {
      token: '5678',
      symbol: 'ABB25AUG267500CE',
      name: 'ABB',
      expiry: '25AUG2026',
      strike: '750000',
      lotsize: '125',
      instrumenttype: 'OPTSTK',
      exch_seg: 'NFO'
    },
    {
      token: '9999',
      symbol: 'RELIANCE-EQ',
      name: 'RELIANCE',
      expiry: '',
      strike: '-1',
      lotsize: '250',
      instrumenttype: 'EQ',
      exch_seg: 'NSE'
    },
    {
      token: '35263',
      symbol: 'NIFTY29JUN2730000PE',
      name: 'NIFTY',
      expiry: '29JUN2027',
      strike: '3000000',
      lotsize: '65',
      instrumenttype: 'OPTIDX',
      exch_seg: 'NFO'
    }
  ];

  it('should resolve NIFTY to special 99926000 NSE token', () => {
    const res1 = resolveSpotTokenFromScripMaster(mockScripMaster, 'NIFTY');
    expect(res1).toEqual({
      exchange: 'NSE',
      symboltoken: '99926000',
      tradingsymbol: 'Nifty 50'
    });

    const res2 = resolveSpotTokenFromScripMaster(mockScripMaster, 'NIFTY 50');
    expect(res2?.symboltoken).toBe('99926000');

    const res3 = resolveSpotTokenFromScripMaster(mockScripMaster, 'nifty');
    expect(res3?.symboltoken).toBe('99926000');
  });

  it('should resolve ABB NSE equity spot token and ignore derivatives', () => {
    const res = resolveSpotTokenFromScripMaster(mockScripMaster, 'ABB');
    expect(res).not.toBeNull();
    expect(res?.symboltoken).toBe('1234');
    expect(res?.exchange).toBe('NSE');
    expect(res?.tradingsymbol).toBe('ABB-EQ');
  });

  it('should resolve RELIANCE NSE equity spot token case-insensitively', () => {
    const res = resolveSpotTokenFromScripMaster(mockScripMaster, 'reliance');
    expect(res).not.toBeNull();
    expect(res?.symboltoken).toBe('9999');
    expect(res?.exchange).toBe('NSE');
    expect(res?.tradingsymbol).toBe('RELIANCE-EQ');
  });

  it('should return null for unknown underlying', () => {
    const res = resolveSpotTokenFromScripMaster(mockScripMaster, 'UNKNOWN_CO');
    expect(res).toBeNull();
  });

  it('should return null for empty underlying', () => {
    const res = resolveSpotTokenFromScripMaster(mockScripMaster, '');
    expect(res).toBeNull();
  });
});
