const axios = require('axios');
const logger = require('../utils/logger');
require('dotenv').config();

const BASE_URL = 'https://apiconnect.angelone.in';

/**
 * Place a single leg order.
 * @param {string} jwtToken 
 * @param {Object} orderDetails 
 * @returns {Promise<string>} orderId
 */
async function placeOrder(jwtToken, { tradingSymbol, token, transactionType, quantity }) {
  try {
    const payload = {
      variety: 'NORMAL',
      tradingsymbol: tradingSymbol,
      symboltoken: token,
      transactiontype: transactionType,
      exchange: 'NFO',
      ordertype: 'MARKET',
      producttype: 'INTRADAY',
      duration: 'DAY',
      price: '0',
      quantity: quantity.toString()
    };

    const headers = {
      'Authorization': `Bearer ${jwtToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-PrivateKey': process.env.ANGEL_API_KEY
    };

    const response = await axios.post(`${BASE_URL}/rest/secure/angelbroking/order/v1/placeOrder`, payload, { headers });

    if (response.data.status === true) {
      return response.data.data.orderid;
    } else {
      throw new Error(`Order placement failed: ${response.data.message}`);
    }
  } catch (error) {
    logger.error(`Error placing order for ${tradingSymbol}:`, error.message);
    throw error;
  }
}

/**
 * Place all 4 legs of Iron Condor entry.
 * @param {string} jwtToken 
 * @param {Object} strikes 
 * @returns {Promise<Object>} orderIds
 */
async function placeIronCondorEntry(jwtToken, strikes) {
  const quantity = (parseInt(process.env.LOTS) || 2) * 25; // Nifty lot size is 25 as per blueprint warning

  const orderIds = {
    sellPut:  await placeOrder(jwtToken, { ...strikes.sellPut, transactionType: 'SELL', quantity }),
    buyPut:   await placeOrder(jwtToken, { ...strikes.buyPut, transactionType: 'BUY', quantity }),
    sellCall: await placeOrder(jwtToken, { ...strikes.sellCall, transactionType: 'SELL', quantity }),
    buyCall:  await placeOrder(jwtToken, { ...strikes.buyCall, transactionType: 'BUY', quantity })
  };

  return orderIds;
}

/**
 * Exit a specific leg (used at 3:25 PM for ITM legs).
 * @param {string} jwtToken 
 * @param {Object} legDetails 
 * @returns {Promise<string>} orderId
 */
async function exitLeg(jwtToken, { tradingSymbol, token, transactionType, quantity }) {
  // Exit transactionType should be opposite of original
  const exitType = transactionType === 'BUY' ? 'SELL' : 'BUY';
  return await placeOrder(jwtToken, { tradingSymbol, token, transactionType: exitType, quantity });
}

/**
 * Get order status.
 * @param {string} jwtToken 
 * @param {string} orderId 
 * @returns {Promise<string>} orderStatus
 */
async function getOrderStatus(jwtToken, orderId) {
  try {
    const headers = {
      'Authorization': `Bearer ${jwtToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-PrivateKey': process.env.ANGEL_API_KEY
    };

    const response = await axios.get(`${BASE_URL}/rest/secure/angelbroking/order/v1/details/${orderId}`, { headers });

    if (response.data.status === true) {
      return response.data.data.status;
    } else {
      throw new Error(`Failed to get order status: ${response.data.message}`);
    }
  } catch (error) {
    logger.error(`Error getting order status for ${orderId}:`, error.message);
    throw error;
  }
}

module.exports = {
  placeOrder,
  placeIronCondorEntry,
  exitLeg,
  getOrderStatus
};
