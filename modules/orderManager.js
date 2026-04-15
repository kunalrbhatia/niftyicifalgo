const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config');
require('dotenv').config();

const BASE_URL = 'https://apiconnect.angelone.in';

/**
 * Place a single leg order via SmartAPI.
 * @param {string} jwtToken 
 * @param {object} orderParams 
 * @returns {Promise<string>} - orderId
 */
async function placeOrder(jwtToken, { tradingSymbol, token, transactionType, quantity }) {
  try {
    const payload = {
      variety: 'NORMAL',
      tradingsymbol: tradingSymbol,
      symboltoken: token,
      transactiontype: transactionType,
      exchange: config.exchange || 'NFO',
      ordertype: config.orderType || 'MARKET',
      producttype: config.productType || 'CARRYFORWARD',
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
      'X-ClientLocalIP': '127.0.0.1',
      'X-ClientPublicIP': process.env.ANGEL_PUBLIC_IP || '103.160.108.203',
      'X-MACAddress': '02:00:00:00:00:00',
      'X-PrivateKey': process.env.ANGEL_API_KEY,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    };

    const response = await axios.post(`${BASE_URL}/rest/secure/angelbroking/order/v1/placeOrder`, payload, { headers });

    if (response.data.status === true) {
      return response.data.data.scriptorderid || response.data.data.orderid;
    } else {
      throw new Error(`Order placement failed: ${response.data.message}`);
    }
  } catch (error) {
    logger.error(`Error placing ${transactionType} order for ${tradingSymbol}:`, error.message);
    throw error;
  }
}

/**
 * Place all 4 legs of Iron Condor entry.
 * @param {string} jwtToken 
 * @param {object} strikes 
 * @returns {Promise<object>}
 */
async function placeIronCondorEntry(jwtToken, strikes) {
  const { lotSize, lots } = config;
  const quantity = lots * lotSize;

  logger.info(`Placing Iron Condor entry orders for ${quantity} quantity...`);

  // To provide margin benefit, we must place BUY orders (hedges) before SELL orders
  // The sequence is: Buy Put, Buy Call, then Sell Put, Sell Call
  const orderIds = {
    buyPut: await placeOrder(jwtToken, { ...strikes.buyPut, transactionType: 'BUY', quantity }),
    buyCall: await placeOrder(jwtToken, { ...strikes.buyCall, transactionType: 'BUY', quantity }),
    sellPut: await placeOrder(jwtToken, { ...strikes.sellPut, transactionType: 'SELL', quantity }),
    sellCall: await placeOrder(jwtToken, { ...strikes.sellCall, transactionType: 'SELL', quantity }),
  };

  return orderIds;
}

/**
 * Exit a specific leg (used at 3:25 PM for ITM legs).
 * @param {string} jwtToken 
 * @param {object} legInfo 
 * @returns {Promise<string>}
 */
async function exitLeg(jwtToken, { tradingSymbol, token, transactionType, quantity }) {
  // Exit action is opposite of original transaction
  const exitAction = transactionType === 'BUY' ? 'SELL' : 'BUY';
  logger.info(`Exiting leg ${tradingSymbol}: ${exitAction} ${quantity} quantity...`);
  return placeOrder(jwtToken, { tradingSymbol, token, transactionType: exitAction, quantity });
}

/**
 * Get order status.
 * @param {string} jwtToken 
 * @param {string} orderId 
 * @returns {Promise<string>}
 */
async function getOrderStatus(jwtToken, orderId) {
  try {
    const headers = {
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
    };

    const response = await axios.get(`${BASE_URL}/rest/secure/angelbroking/order/v1/details/${orderId}`, { headers });

    if (response.data.status === true) {
      return response.data.data.orderstatus;
    } else {
      throw new Error(`Failed to get order status: ${response.data.message}`);
    }
  } catch (error) {
    logger.error(`Error getting status for order ${orderId}:`, error.message);
    throw error;
  }
}

module.exports = {
  placeOrder,
  placeIronCondorEntry,
  exitLeg,
  getOrderStatus
};
