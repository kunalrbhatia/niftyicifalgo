import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import {
  resolveSpotTokenFromScripMaster,
  resolveSpotTokenWithFallback,
  downloadFullScripMaster
} from '../src/scripMasterResolver.js';
import { ScripRecord } from '../src/positionMapper.js';

vi.mock('axios');

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

  it('should resolve NIFTY via resolveSpotTokenWithFallback without network or disk fetch', async () => {
    const res = await resolveSpotTokenWithFallback('NIFTY');
    expect(res).toEqual({
      exchange: 'NSE',
      symboltoken: '99926000',
      tradingsymbol: 'Nifty 50'
    });
    expect(axios.get).not.toHaveBeenCalled();
  });

  describe('downloadFullScripMaster & fallback resolution', () => {
    const testCachePath = './test-scratch/test-full-scrip-master.json';

    beforeEach(async () => {
      vi.clearAllMocks();
      const testDir = path.resolve(process.cwd(), './test-scratch');
      if (fs.existsSync(testDir)) {
        await fs.promises.rm(testDir, { recursive: true, force: true });
      }
    });

    afterEach(async () => {
      const testDir = path.resolve(process.cwd(), './test-scratch');
      if (fs.existsSync(testDir)) {
        await fs.promises.rm(testDir, { recursive: true, force: true });
      }
    });

    it('should download full master if cache does not exist and save to disk', async () => {
      const mockFullData = [
        { token: '13', symbol: 'ABB-EQ', name: 'ABB', exch_seg: 'NSE', instrumenttype: '' },
        { token: '2885', symbol: 'RELIANCE-EQ', name: 'RELIANCE', exch_seg: 'NSE', instrumenttype: 'EQ' }
      ];
      (axios.get as any).mockResolvedValueOnce({ data: mockFullData });

      const records = await downloadFullScripMaster(testCachePath, 24);
      expect(records.length).toBe(2);
      expect(axios.get).toHaveBeenCalledTimes(1);

      // Verify file written to disk
      expect(fs.existsSync(path.resolve(process.cwd(), testCachePath))).toBe(true);
    });

    it('should use existing cache within TTL without re-downloading', async () => {
      const mockFullData = [
        { token: '13', symbol: 'ABB-EQ', name: 'ABB', exch_seg: 'NSE', instrumenttype: '' }
      ];
      const resolvedPath = path.resolve(process.cwd(), testCachePath);
      await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
      await fs.promises.writeFile(resolvedPath, JSON.stringify(mockFullData), 'utf8');

      const records = await downloadFullScripMaster(testCachePath, 24);
      expect(records.length).toBe(1);
      expect(records[0].token).toBe('13');
      expect(axios.get).not.toHaveBeenCalled();
    });

    it('should re-download when cache is older than TTL', async () => {
      const staleData = [{ token: '99', symbol: 'OLD-EQ', name: 'OLD', exch_seg: 'NSE' }];
      const freshData = [{ token: '13', symbol: 'ABB-EQ', name: 'ABB', exch_seg: 'NSE' }];
      
      const resolvedPath = path.resolve(process.cwd(), testCachePath);
      await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
      await fs.promises.writeFile(resolvedPath, JSON.stringify(staleData), 'utf8');

      // Set file mtime to 30 hours ago
      const pastTime = (Date.now() - 30 * 60 * 60 * 1000) / 1000;
      await fs.promises.utimes(resolvedPath, pastTime, pastTime);

      (axios.get as any).mockResolvedValueOnce({ data: freshData });

      const records = await downloadFullScripMaster(testCachePath, 24);
      expect(records[0].token).toBe('13');
      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('should resolve ABB token via resolveSpotTokenWithFallback using full master when local is NFO-only', async () => {
      const mockFullMaster = [
        { token: '13', symbol: 'ABB-EQ', name: 'ABB', exch_seg: 'NSE', instrumenttype: '' }
      ];
      (axios.get as any).mockResolvedValueOnce({ data: mockFullMaster });

      const res = await resolveSpotTokenWithFallback('ABB');
      expect(res).not.toBeNull();
      expect(res?.symboltoken).toBe('13');
      expect(res?.tradingsymbol).toBe('ABB-EQ');
      expect(res?.exchange).toBe('NSE');
    });

    it('should return null for non-existent stock in full master', async () => {
      (axios.get as any).mockResolvedValueOnce({ data: [] });
      const res = await resolveSpotTokenWithFallback('NONEXISTENT_XYZ');
      expect(res).toBeNull();
    });
  });
});

