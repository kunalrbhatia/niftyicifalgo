import axios from 'axios';
import { generateSync, createGuardrails } from 'otplib';
import { config } from './config.js';

export interface BrokerPosition {
  symbol: string;
  token: string;
  netQty: number;
  ltp: number;
  cfSellAvgPrice: number;
  cfBuyAvgPrice: number;
  realised: number;
  unrealised: number;
  pnl: number;
  exchange: string;
}

export class SmartAPIBrokerClient {
  private jwtToken: string | null = null;
  private tokenExpiryTime = 0;
  private cachedPublicIP: string | null = config.ANGEL_PUBLIC_IP || '103.160.108.203';

  /**
   * Fetch public IP with fallback
   */
  public async getPublicIP(): Promise<string> {
    if (this.cachedPublicIP) {
      return this.cachedPublicIP;
    }

    try {
      const response = await axios.get('https://api.ipify.org?format=json', { timeout: 4000 });
      if (response?.data?.ip) {
        this.cachedPublicIP = response.data.ip;
        return this.cachedPublicIP || '103.160.108.203';
      }
      return '103.160.108.203';
    } catch {
      return '103.160.108.203';
    }
  }

  /**
   * Builds SmartAPI common request headers
   */
  private async getCommonHeaders(jwt?: string): Promise<Record<string, string>> {
    const ip = this.cachedPublicIP || (await this.getPublicIP());
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-ClientLocalIP': '127.0.0.1',
      'X-ClientPublicIP': ip,
      'X-MACAddress': '02:00:00:00:00:00',
      'X-PrivateKey': config.ANGEL_API_KEY,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };

    if (jwt) {
      headers['Authorization'] = `Bearer ${jwt}`;
    }

    return headers;
  }

  /**
   * SmartAPI authentication using TOTP
   */
  public async login(force = false): Promise<{ jwtToken: string }> {
    const now = Date.now();
    if (!force && this.jwtToken && now < this.tokenExpiryTime) {
      return { jwtToken: this.jwtToken };
    }

    const secret = config.ANGEL_TOTP_SECRET;
    if (!secret || !config.ANGEL_CLIENT_ID || !config.ANGEL_PASSWORD || !config.ANGEL_API_KEY) {
      throw new Error('SmartAPI credentials incomplete in configuration');
    }

    const token = generateSync({
      secret,
      guardrails: createGuardrails({
        MIN_SECRET_BYTES: Math.min(10, secret.length)
      })
    });

    const payload = {
      clientcode: config.ANGEL_CLIENT_ID,
      password: config.ANGEL_PASSWORD,
      totp: token
    };

    const headers = await this.getCommonHeaders();
    const response = await axios.post(
      'https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword',
      payload,
      { headers, timeout: 8000 }
    );

    if (response.data?.status === true && response.data.data?.jwtToken) {
      const jwt = response.data.data.jwtToken as string;
      this.jwtToken = jwt;
      // Expire cache in ~20 hours
      this.tokenExpiryTime = now + 20 * 60 * 60 * 1000;
      return { jwtToken: jwt };
    } else {
      throw new Error(`Login failed: ${response.data?.message || 'Unknown error'}`);
    }
  }

  /**
   * Fetch open positions from SmartAPI (READ-ONLY)
   */
  public async fetchPositions(jwt?: string): Promise<BrokerPosition[]> {
    let token = jwt || (await this.login()).jwtToken;

    const executeRequest = async (authJwt: string) => {
      const headers = await this.getCommonHeaders(authJwt);
      return axios.get(
        'https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/getPosition',
        { headers, timeout: 8000 }
      );
    };

    let response;
    try {
      response = await executeRequest(token);
    } catch (err: any) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        // Retry with refreshed login
        const refreshed = await this.login(true);
        token = refreshed.jwtToken;
        response = await executeRequest(token);
      } else {
        throw err;
      }
    }

    if (response?.data?.status === true) {
      const rawPositions: any[] = Array.isArray(response.data.data) ? response.data.data : [];
      const openPositions: BrokerPosition[] = [];

      for (const p of rawPositions) {
        const netQty = parseFloat(p.netqty || '0');
        if (netQty !== 0) {
          openPositions.push({
            symbol: p.tradingsymbol,
            token: p.symboltoken,
            netQty,
            ltp: parseFloat(p.ltp || '0'),
            cfSellAvgPrice: parseFloat(p.cfSellAvgPrice || '0'),
            cfBuyAvgPrice: parseFloat(p.cfBuyAvgPrice || '0'),
            realised: parseFloat(p.realised || '0'),
            unrealised: parseFloat(p.unrealised || '0'),
            pnl: parseFloat(p.pnl || '0'),
            exchange: p.exchange
          });
        }
      }

      return openPositions;
    } else {
      throw new Error(`Failed to fetch positions: ${response?.data?.message || JSON.stringify(response?.data) || 'Unknown error'}`);
    }
  }

  /**
   * Fetch RMS Margin utiliseddebits (READ-ONLY)
   */
  public async fetchRMSMargin(jwt?: string): Promise<number> {
    let token = jwt || (await this.login()).jwtToken;

    const executeRequest = async (authJwt: string) => {
      const headers = await this.getCommonHeaders(authJwt);
      return axios.get(
        'https://apiconnect.angelone.in/rest/secure/angelbroking/user/v1/getRMS',
        { headers, timeout: 8000 }
      );
    };

    let response;
    try {
      response = await executeRequest(token);
    } catch (err: any) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        const refreshed = await this.login(true);
        token = refreshed.jwtToken;
        response = await executeRequest(token);
      } else {
        throw err;
      }
    }

    if (response.data?.status === true && response.data.data) {
      return parseFloat(response.data.data.utiliseddebits || '0');
    } else {
      throw new Error(`Failed to fetch RMS margin: ${response.data?.message || 'Unknown error'}`);
    }
  }

  /**
   * Fetch Spot price for Nifty 50 (READ-ONLY)
   */
  public async fetchSpot(jwt?: string): Promise<number> {
    let token = jwt || (await this.login()).jwtToken;

    const executeRequest = async (authJwt: string) => {
      const headers = await this.getCommonHeaders(authJwt);
      const payload = {
        exchange: 'NSE',
        symboltoken: '99926000',
        tradingsymbol: 'Nifty 50'
      };
      return axios.post(
        'https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/getLtpData',
        payload,
        { headers, timeout: 8000 }
      );
    };

    let response;
    try {
      response = await executeRequest(token);
    } catch (err: any) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        const refreshed = await this.login(true);
        token = refreshed.jwtToken;
        response = await executeRequest(token);
      } else {
        throw err;
      }
    }

    if (response.data?.status === true && response.data.data) {
      return parseFloat(response.data.data.ltp || '0');
    } else {
      throw new Error(`Failed to fetch spot price: ${response.data?.message || 'Unknown error'}`);
    }
  }
}
