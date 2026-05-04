const axios = require('axios');
const logger = require('../utils/logger');
const { getPublicIP } = require('../utils/helpers');
require('dotenv').config();

const BASE_URL = 'https://apiconnect.angelone.in';

let state = {
  entryTime: null,
  expiryDate: null,
  adjusted: false,          // has wall been hit and adjustment done?
  wallHitSide: null,        // 'PUT' or 'CALL' or null
  legs: {
    sellPut:  null,
    buyPut:   null,
    sellCall: null,
    buyCall:  null,
  },
  netPremiumCollected: 0,
};

/**
 * Initialize the position state.
 * @param {Object} strikes 
 * @param {Object} orderIds 
 */
function initPosition(strikes, orderIds) {
  state.entryTime = new Date();
  state.legs.sellPut = { ...strikes.sellPut, transactionType: 'SELL', orderId: orderIds.sellPut, status: 'OPEN' };
  state.legs.buyPut = { ...strikes.buyPut, transactionType: 'BUY', orderId: orderIds.buyPut, status: 'OPEN' };
  state.legs.sellCall = { ...strikes.sellCall, transactionType: 'SELL', orderId: orderIds.sellCall, status: 'OPEN' };
  state.legs.buyCall = { ...strikes.buyCall, transactionType: 'BUY', orderId: orderIds.buyCall, status: 'OPEN' };
}

/**
 * Fetch open positions from SmartAPI and check if any Nifty options for today's expiry are open.
 * @param {string} jwtToken 
 * @returns {Promise<boolean>} - true if an Iron Condor or any relevant position exists.
 */
async function hasOpenPositions(jwtToken) {
  try {
    const publicIP = await getPublicIP();
    const headers = {
      'Authorization': `Bearer ${jwtToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-ClientLocalIP': '127.0.0.1',
      'X-ClientPublicIP': publicIP,
      'X-MACAddress': '02:00:00:00:00:00',
      'X-PrivateKey': process.env.ANGEL_API_KEY,
      'User-Agent': 'Mozilla/5.0'
    };

    const response = await axios.get(`${BASE_URL}/rest/secure/angelbroking/order/v1/getPosition`, { headers });

    if (response.data.status === true) {
      const positions = response.data.data;
      if (!positions) return false;

      const moment = require('moment-timezone');
      const { getExpiryDate } = require('./optionChain');
      const expiryStr = await getExpiryDate(); // e.g. 28APR2026
      const expiryTag = moment(expiryStr, 'DDMMMYYYY').format('DDMMMYY').toUpperCase(); // e.g. 28APR26

      // Accurate check: Any NIFTY position with the current monthly expiry tag in trading symbol
      const relevantPositions = positions.filter(p => 
        p.tradingsymbol.startsWith('NIFTY') && 
        p.tradingsymbol.includes(expiryTag) && 
        parseInt(p.netqty) !== 0
      );

      return relevantPositions.length > 0;
    }
    return false;
  } catch (error) {
    logger.error('Error checking open positions:', error.message);
    return false; // Safest to assume false and let entry logic handle it, or maybe true to avoid double entry?
    // Actually, if API fails, we probably shouldn't place new orders.
  }
}

/**
 * Reconstruct the internal state from live positions.
 * @param {string} jwtToken 
 * @returns {Promise<boolean>} - true if state was reconstructed
 */
async function reconstructState(jwtToken) {
  try {
    const publicIP = await getPublicIP();
    const headers = {
      'Authorization': `Bearer ${jwtToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-ClientLocalIP': '127.0.0.1',
      'X-ClientPublicIP': publicIP,
      'X-MACAddress': '02:00:00:00:00:00',
      'X-PrivateKey': process.env.ANGEL_API_KEY,
      'User-Agent': 'Mozilla/5.0'
    };

    const response = await axios.get(`${BASE_URL}/rest/secure/angelbroking/order/v1/getPosition`, { headers });

    if (response.data.status === true && response.data.data) {
      const positions = response.data.data;
      const moment = require('moment-timezone');
      const optionChain = require('./optionChain');
      const expiryStr = await optionChain.getExpiryDate();
      const expiryTag = moment(expiryStr, 'DDMMMYYYY').format('DDMMMYY').toUpperCase();

      const relevant = positions.filter(p => 
        p.tradingsymbol.startsWith('NIFTY') && 
        p.tradingsymbol.includes(expiryTag) && 
        parseInt(p.netqty) !== 0
      );

      if (relevant.length === 0) {
        logger.warn(`No relevant positions found for expiry ${expiryTag}`);
        return false;
      }

      logger.info(`Reconstructing state from ${relevant.length} live positions for ${expiryTag}...`);
      
      // Reset state legs
      state.legs = {
        sellPut:  null,
        buyPut:   null,
        sellCall: null,
        buyCall:  null,
      };

      relevant.forEach(p => {
        const qty = parseInt(p.netqty);
        const symbol = p.tradingsymbol;
        const isCall = symbol.endsWith('CE');
        const isPut = symbol.endsWith('PE');
        
        // Accurate strike extraction: NIFTY28APR2623600PE -> 23600
        // We look for exactly 5 digits followed by CE/PE. 
        // Note: Nifty strikes are usually 5 digits (e.g., 23600).
        const strikeMatch = symbol.match(/(\d{5})(CE|PE)$/);
        const extractedStrike = strikeMatch ? parseInt(strikeMatch[1]) : 0;
        
        logger.debug(`Extracted strike ${extractedStrike} from ${symbol}`);

        const legData = {
          tradingSymbol: symbol,
          token: p.symboltoken,
          strike: extractedStrike,
          quantity: Math.abs(qty),
          transactionType: qty > 0 ? 'BUY' : 'SELL',
          status: 'OPEN'
        };

        if (isPut) {
          if (qty < 0) {
            // If we have two sell puts, the one further away might be the original wall
            // But usually we'd only have one unless adjusted.
            if (!state.legs.sellPut) state.legs.sellPut = legData;
            else state.legs.newAtmPut = legData; // if already adjusted
          } else {
            state.legs.buyPut = legData;
          }
        } else if (isCall) {
          if (qty < 0) {
            if (!state.legs.sellCall) state.legs.sellCall = legData;
            else state.legs.newAtmCall = legData;
          } else {
            state.legs.buyCall = legData;
          }
        }
      });

      // Detect if adjusted
      if (state.legs.newAtmCall) {
        state.adjusted = true;
        state.wallHitSide = 'PUT'; // PUT wall was hit, CALL side adjusted
      } else if (state.legs.newAtmPut) {
        state.adjusted = true;
        state.wallHitSide = 'CALL'; // CALL wall was hit, PUT side adjusted
      }

      state.entryTime = new Date(); // Approximate
      logger.info('State reconstructed successfully:', JSON.stringify(state.legs, null, 2));
      return true;
    }
    return false;
  } catch (error) {
    logger.error('Error during state reconstruction: %O', error);
    return false;
  }
}

/**
 * Mark the position as adjusted.
 * @param {string} side - 'PUT' or 'CALL' (the side that was rolled)
 * @param {Object} newLeg - The new ATM leg information
 */
function markAdjusted(side, newLeg) {
  state.adjusted = true;
  state.wallHitSide = side === 'PUT' ? 'CALL' : 'PUT'; // If PUT wall was hit, CALL side was adjusted

  if (side === 'CALL') {
    // Old wing closed, new ATM leg added
    state.legs.buyCall.status = 'CLOSED';
    state.legs.newAtmCall = { ...newLeg, transactionType: 'SELL', status: 'OPEN' };
  } else {
    state.legs.buyPut.status = 'CLOSED';
    state.legs.newAtmPut = { ...newLeg, transactionType: 'SELL', status: 'OPEN' };
  }
}

/**
 * Get current position state.
 * @returns {Object}
 */
function getPosition() {
  return state;
}

/**
 * Update the status of a leg.
 * @param {string} legName 
 * @param {string} status 
 */
function updateLegStatus(legName, status) {
  if (state.legs[legName]) {
    state.legs[legName].status = status;
  }
}

module.exports = {
  initPosition,
  markAdjusted,
  getPosition,
  updateLegStatus,
  hasOpenPositions,
  reconstructState
};
