const axios = require('axios');
const moment = require('moment-timezone');
const { calculateDelta, getPublicIP } = require('../utils/helpers');
const logger = require('../utils/logger');
require('dotenv').config();

const BASE_URL = 'https://apiconnect.angelone.in';

const commonHeaders = (jwtToken, publicIP) => ({
  'Authorization': `Bearer ${jwtToken}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'X-UserType': 'USER',
  'X-SourceID': 'WEB',
  'X-ClientLocalIP': '127.0.0.1',
  'X-ClientPublicIP': publicIP,
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

      const publicIP = await getPublicIP();
      const response = await axios.post(`${BASE_URL}/rest/secure/angelbroking/order/v1/getLtpData`, payload, { headers: commonHeaders(jwtToken, publicIP) });
      
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

  getExpiryDate: async function(offsetMonths = 0) {
    const today = moment().tz('Asia/Kolkata');
    const referenceDate = today.clone().add(offsetMonths, 'months');
    const todayStr = today.format('YYYY-MM-DD');
    
    const nseHolidays2026 = [
      '2026-01-26', '2026-03-03', '2026-03-26', '2026-03-31', '2026-04-03', 
      '2026-04-14', '2026-05-01', '2026-05-28', '2026-06-26', '2026-10-02', 
      '2026-10-20', '2026-12-25',
    ];

    const checkIsTradingDay = (dateStr) => {
      if (nseHolidays2026.includes(dateStr)) return false;
      const day = moment(dateStr).day();
      return !(day === 0 || day === 6);
    };

    let lastDayOfMonth = referenceDate.clone().endOf('month');
    let lastTuesday = lastDayOfMonth.clone();
    
    // Find the last Tuesday (2 = Tuesday)
    while (lastTuesday.day() !== 2) {
      lastTuesday.subtract(1, 'day');
    }

    // Check if last Tuesday is a holiday, if so, move to preceding trading day
    while (!checkIsTradingDay(lastTuesday.format('YYYY-MM-DD'))) {
      lastTuesday.subtract(1, 'day');
    }
    
    // If offsetMonths is 0 and today is past that expiryDate, find next month's expiry
    if (offsetMonths === 0 && today.isAfter(lastTuesday, 'day')) {
        let nextMonth = today.clone().add(1, 'month').endOf('month');
        lastTuesday = nextMonth.clone();
        while (lastTuesday.day() !== 2) {
            lastTuesday.subtract(1, 'day');
        }
        while (!checkIsTradingDay(lastTuesday.format('YYYY-MM-DD'))) {
            lastTuesday.subtract(1, 'day');
        }
    }

    return lastTuesday.format('DDMMMYYYY').toUpperCase();
  },

  getOptionChain: async function(jwtToken, targetExpiry = null) {
    try {
      const spotPrice = await exportsObj.getNiftySpotPrice(jwtToken);
      const expiry = targetExpiry || await exportsObj.getExpiryDate();

      const payload = {
        name: 'NIFTY',
        expirydate: expiry
      };

      const publicIP = await getPublicIP();
      const response = await axios.post(`${BASE_URL}/rest/secure/angelbroking/marketData/v1/optionGreek`, payload, { headers: commonHeaders(jwtToken, publicIP) });

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
      logger.error(`Error fetching option chain: ${error.message}`, error);
      throw error;
    }
  },

  enrichStrikes: async function(jwtToken, strikes, targetExpiry = null) {
    const fs = require('fs');
    const path = require('path');
    const masterPath = path.join(__dirname, '../scrip_master.json');
    
    if (!fs.existsSync(masterPath)) {
      throw new Error('Scrip master file not found. Please run filter_scrips.js first.');
    }

    const master = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
    const expiryDate = targetExpiry || await exportsObj.getExpiryDate();
    logger.info(`Enriching strikes for expiry: ${expiryDate}`);

    const keys = ['sellPut', 'buyPut', 'sellCall', 'buyCall'];
    const enriched = {};

    for (const key of keys) {
      const leg = strikes[key];
      const strike = leg.strike;
      const type = key.includes('Put') ? 'PE' : 'CE';
      
      // Filter master for this strike, type, and the CORRECT monthly expiry
      const match = master.find(s => 
        (parseFloat(s.strike) / 100 === strike || parseFloat(s.strike) === strike) && 
        s.symbol.endsWith(type) &&
        s.expiry === expiryDate
      );

      if (match) {
        enriched[key] = {
          strike: strike,
          tradingSymbol: match.symbol,
          token: match.token,
          delta: leg.delta,
          ltp: 0, // Will fill later
          expiry: expiryDate
        };
      } else {
        throw new Error(`Failed to find security info for ${strike} ${type} on ${expiryDate} in master file.`);
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

    const publicIP = await getPublicIP();
    const marketDataResponse = await axios.post(`${BASE_URL}/rest/secure/angelbroking/market/v1/quote/`, marketDataPayload, { headers: commonHeaders(jwtToken, publicIP) });

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
  },

  resolveStrikeSecurity: async function(jwtToken, strike, optionType, targetExpiry = null) {
    const fs = require('fs');
    const path = require('path');
    const masterPath = path.join(__dirname, '../scrip_master.json');

    if (!fs.existsSync(masterPath)) {
      throw new Error('Scrip master file not found. Please run filter_scrips.js first.');
    }

    const master = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
    const expiryDate = targetExpiry || await exportsObj.getExpiryDate();
    const type = optionType.toUpperCase();

    const match = master.find(s =>
      (parseFloat(s.strike) / 100 === strike || parseFloat(s.strike) === strike) &&
      s.symbol.endsWith(type) &&
      s.expiry === expiryDate
    );

    if (match) {
      return {
        strike: strike,
        tradingSymbol: match.symbol,
        token: match.token,
        expiry: expiryDate
      };
    } else {
      throw new Error(`Failed to find security info for ${strike} ${type} on ${expiryDate} in master file.`);
    }
  }
};

module.exports = exportsObj;
