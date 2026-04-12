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
  'X-ClientPublicIP': '152.59.7.153',
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
      logger.error('Error fetching Nifty spot price:', error.message);
      throw error;
    }
  },

  getExpiryDate: async function() {
    const today = moment().tz('Asia/Kolkata');
    const dayOfWeek = today.day();
    let expiryDate;

    if (dayOfWeek === 2) {
      expiryDate = today;
    } else if (dayOfWeek === 1) {
      expiryDate = today.clone().add(1, 'day');
    } else {
      expiryDate = today.clone().add((2 - dayOfWeek + 7) % 7, 'days');
    }

    return expiryDate.format('DDMMMYYYY').toUpperCase();
  },

  getOptionChain: async function(jwtToken) {
    try {
      const spotPrice = await this.getNiftySpotPrice(jwtToken);
      const expiry = await this.getExpiryDate();

      const payload = {
        name: 'NIFTY',
        expirydate: expiry
      };

      const response = await axios.post(`${BASE_URL}/rest/secure/angelbroking/marketData/v1/optionChain`, payload, { headers: commonHeaders(jwtToken) });

      if (response.data.status === true) {
        const chain = response.data.data;
        const formattedChain = [];

        const now = moment().tz('Asia/Kolkata');
        const expiryTime = moment().tz('Asia/Kolkata').set({
          hour: 15, minute: 30, second: 0, millisecond: 0
        });
        const T = Math.max(0.0001, expiryTime.diff(now, 'years', true));
        const r = 0.065;

        chain.forEach(item => {
          const ce = item.callOptions;
          const pe = item.putOptions;

          if (ce) {
            formattedChain.push({
              strikePrice: parseFloat(item.strikePrice),
              optionType: 'CE',
              tradingSymbol: ce.tradingSymbol,
              symbolToken: ce.symbolToken,
              ltp: parseFloat(ce.ltp),
              iv: parseFloat(ce.impliedVolatility) || 0.15,
              delta: parseFloat(ce.delta) || calculateDelta('CE', spotPrice, parseFloat(item.strikePrice), T, r, parseFloat(ce.impliedVolatility) || 0.15)
            });
          }

          if (pe) {
            formattedChain.push({
              strikePrice: parseFloat(item.strikePrice),
              optionType: 'PE',
              tradingSymbol: pe.tradingSymbol,
              symbolToken: pe.symbolToken,
              ltp: parseFloat(pe.ltp),
              iv: parseFloat(pe.impliedVolatility) || 0.15,
              delta: parseFloat(pe.delta) || calculateDelta('PE', spotPrice, parseFloat(item.strikePrice), T, r, parseFloat(pe.impliedVolatility) || 0.15)
            });
          }
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
  }
};

module.exports = exportsObj;
