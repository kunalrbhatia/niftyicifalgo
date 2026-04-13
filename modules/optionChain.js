const axios = require('axios');
const moment = require('moment-timezone');
const { calculateDelta } = require('../utils/helpers');
const logger = require('../utils/logger');
require('dotenv').config();

const BASE_URL = 'https://apiconnect.angelone.in';

const commonHeaders = (jwtToken) => ({
  'Authorization': `Bearer ${jwtToken}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'X-UserType': 'USER',
  'X-SourceID': 'WEB',
  'X-ClientLocalIP': '127.0.0.1',
  'X-ClientPublicIP': process.env.ANGEL_PUBLIC_IP || '103.160.108.203',
  'X-MACAddress': '02:00:00:00:00:00',
  'X-PrivateKey': process.env.ANGEL_API_KEY,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
});

const exportsObj = {
  getNiftySpotPrice: async function(jwtToken) {
    try {
      const payload = {
        exchange: 'NSE',
        symboltoken: '99926000',
        tradingsymbol: 'Nifty 50'
      };

      const response = await axios.post(`${BASE_URL}/rest/secure/angelbroking/order/v1/getLtpData`, payload, { headers: commonHeaders(jwtToken) });
      
      if (response.data.status === true) {
        return response.data.data.ltp;
      } else {
        logger.error('Full SmartAPI LTP Error Response: ' + JSON.stringify(response.data));
        throw new Error(`Failed to fetch Nifty spot price: ${response.data.message}`);
      }
    } catch (error) {
      logger.error(`Error fetching Nifty spot price: ${error.message}`);
      throw error;
    }
  },

  getExpiryDate: async function() {
    const today = moment().tz('Asia/Kolkata');
    const todayStr = today.format('YYYY-MM-DD');
    
    const nseHolidays2026 = [
      '2026-01-26', '2026-03-03', '2026-03-26', '2026-03-31', '2026-04-03', 
      '2026-04-14', '2026-05-01', '2026-05-28', '2026-06-26', '2026-10-02', 
      '2026-10-20', '2026-12-25',
    ];

    const isHoliday = (dateStr) => nseHolidays2026.includes(dateStr);

    let expiryDate = today.clone().tz('Asia/Kolkata');
    const dayOfWeek = expiryDate.day();

    // Find next Tuesday
    let daysToTuesday = (2 - dayOfWeek + 7) % 7;
    expiryDate.add(daysToTuesday, 'days');

    // If that Tuesday is a holiday, move to Monday
    if (isHoliday(expiryDate.format('YYYY-MM-DD'))) {
      expiryDate.subtract(1, 'days');
    }
    
    // If today is past that expiryDate, we should find the NEXT weekly expiry
    // But since the algo only runs on expiry day, we can assume we want THIS week's expiry.
    // However, for robustness:
    if (today.isAfter(expiryDate, 'day')) {
        // This shouldn't happen if called on expiry day, but let's be safe
        expiryDate.add(7, 'days');
        // Re-check holiday for next week's Tuesday
        if (isHoliday(expiryDate.format('YYYY-MM-DD'))) {
            expiryDate.subtract(1, 'days');
        }
    }

    return expiryDate.format('DDMMMYYYY').toUpperCase();
  },

  getOptionChain: async function(jwtToken) {
    try {
      const spotPrice = await exportsObj.getNiftySpotPrice(jwtToken);
      const expiry = await exportsObj.getExpiryDate();

      const payload = {
        name: 'NIFTY',
        expirydate: expiry
      };

      const response = await axios.post(`${BASE_URL}/rest/secure/angelbroking/marketData/v1/optionGreek`, payload, { headers: commonHeaders(jwtToken) });

      if (response.data.status === true) {
        const chain = response.data.data;
        const formattedChain = [];

        chain.forEach(item => {
          formattedChain.push({
            strikePrice: parseFloat(item.strikePrice),
            optionType: item.optionType, // 'CE' or 'PE'
            delta: parseFloat(item.delta),
            iv: parseFloat(item.impliedVolatility) || 0.15,
            expiry: item.expiry
          });
        });

        return formattedChain;
      } else {
        logger.error('Full SmartAPI Option Chain Error Response: ' + JSON.stringify(response.data));
        throw new Error(`Failed to fetch option chain: ${response.data.message}`);
      }
    } catch (error) {
      logger.error('Error fetching option chain:', error.message);
      throw error;
    }
  },

  enrichStrikes: async function(jwtToken, strikes) {
    const fs = require('fs');
    const path = require('path');
    const masterPath = path.join(__dirname, '../nifty_expiry_master.json');
    
    if (!fs.existsSync(masterPath)) {
      throw new Error('Nifty expiry master file not found. Please run filter_scrips.js first.');
    }

    const master = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
    const keys = ['sellPut', 'buyPut', 'sellCall', 'buyCall'];
    const enriched = {};

    for (const key of keys) {
      const leg = strikes[key];
      const strike = leg.strike;
      const type = key.includes('Put') ? 'PE' : 'CE';
      
      // Filter master for this strike and type
      // Match strike and ensure symbol ends with the type
      const match = master.find(s => 
        (parseFloat(s.strike) / 100 === strike || parseFloat(s.strike) === strike) && 
        s.symbol.endsWith(type)
      );

      if (match) {
        enriched[key] = {
          strike: strike,
          tradingSymbol: match.symbol,
          token: match.token,
          delta: leg.delta,
          ltp: 0 // Will fill later
        };
      } else {
        throw new Error(`Failed to find security info for ${strike} ${type} in master file.`);
      }
    }

    // Batch LTP Fetching
    const tokens = Object.values(enriched).map(e => e.token);
    logger.info(`Fetching LTP for tokens: ${tokens.join(', ')}`);
    
    // Using marketData V1 with mode: LTP
    const marketDataPayload = {
      mode: 'LTP',
      exchangeTokens: {
        'NFO': tokens
      }
    };

    const marketDataResponse = await axios.post(`${BASE_URL}/rest/secure/angelbroking/market/v1/quote/`, marketDataPayload, { headers: commonHeaders(jwtToken) });

    if (marketDataResponse.data.status === true && marketDataResponse.data.data.fetched) {
      marketDataResponse.data.data.fetched.forEach(item => {
        const key = Object.keys(enriched).find(k => enriched[k].token === item.symbolToken);
        if (key) {
          enriched[key].ltp = item.ltp;
        }
      });
    } else {
      logger.error('Market data fetch failed, using LTP 0. Response: ' + JSON.stringify(marketDataResponse.data));
    }

    return enriched;
  }
};

module.exports = exportsObj;
