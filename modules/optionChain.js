const axios = require('axios');
const moment = require('moment-timezone');
const { calculateDelta } = require('../utils/helpers');
const logger = require('../utils/logger');
require('dotenv').config();

const BASE_URL = 'https://apiconnect.angelone.in';

/**
 * Fetch live Nifty 50 spot price.
 * @param {string} jwtToken 
 * @returns {Promise<number>}
 */
async function getNiftySpotPrice(jwtToken) {
  try {
    const payload = {
      exchange: 'NSE',
      tradingsymbol: 'Nifty 50',
      symboltoken: '99926000'
    };

    const headers = {
      'Authorization': `Bearer ${jwtToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-PrivateKey': process.env.ANGEL_API_KEY
    };

    const response = await axios.post(`${BASE_URL}/rest/secure/angelbroking/order/v1/getLtpData`, payload, { headers });
    
    if (response.data.status === true) {
      return response.data.data.ltp;
    } else {
      throw new Error(`Failed to fetch Nifty spot price: ${response.data.message}`);
    }
  } catch (error) {
    logger.error('Error fetching Nifty spot price:', error.message);
    throw error;
  }
}

/**
 * Get dynamic expiry date (DDMMMYYYY format for SmartAPI).
 * @returns {string}
 */
async function getExpiryDate() {
  const today = moment().tz('Asia/Kolkata');
  const dayOfWeek = today.day();
  let expiryDate;

  if (dayOfWeek === 2) {
    expiryDate = today;
  } else if (dayOfWeek === 1) {
    expiryDate = today.clone().add(1, 'day');
  } else {
    // If it's not Monday or Tuesday, this shouldn't be running on expiry day
    // But for robustness, let's find the *next* Tuesday
    expiryDate = today.clone().add((2 - dayOfWeek + 7) % 7, 'days');
  }

  return expiryDate.format('DDMMMYYYY').toUpperCase();
}

/**
 * Fetch live Nifty 50 option chain with Greeks.
 * @param {string} jwtToken 
 * @returns {Promise<Array>}
 */
async function getOptionChain(jwtToken) {
  try {
    const spotPrice = await getNiftySpotPrice(jwtToken);
    const expiry = await getExpiryDate();

    const payload = {
      name: 'NIFTY',
      expirydate: expiry
    };

    const headers = {
      'Authorization': `Bearer ${jwtToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-PrivateKey': process.env.ANGEL_API_KEY
    };

    const response = await axios.post(`${BASE_URL}/rest/secure/angelbroking/marketData/v1/optionChain`, payload, { headers });

    if (response.data.status === true) {
      const chain = response.data.data;
      const formattedChain = [];

      // Time to expiry in years (assuming 15:30 as market close)
      const now = moment().tz('Asia/Kolkata');
      const expiryTime = moment().tz('Asia/Kolkata').set({
        hour: 15, minute: 30, second: 0, millisecond: 0
      });
      const T = Math.max(0.0001, expiryTime.diff(now, 'years', true));
      const r = 0.065; // 6.5% risk-free rate

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
      throw new Error(`Failed to fetch option chain: ${response.data.message}`);
    }
  } catch (error) {
    logger.error('Error fetching option chain:', error.message);
    throw error;
  }
}

module.exports = {
  getNiftySpotPrice,
  getExpiryDate,
  getOptionChain
};
