const optionChain = require('./optionChain');
const orderManager = require('./orderManager');
const positionTracker = require('./positionTracker');
const logger = require('../utils/logger');
require('dotenv').config();

/**
 * Roll the CALL side to ATM.
 * Called when PUT wall is hit (Nifty went down).
 * Action: Sell new ATM CALL, close existing long BUY CALL wing (SELL).
 * @param {string} jwtToken 
 * @returns {Promise<{success: boolean, orderIds?: string[], error?: string}>}
 */
async function adjustCallSide(jwtToken) {
  try {
    const state = positionTracker.getPosition();
    if (state.adjusted) {
      logger.info('Position already adjusted. Skipping CALL side adjustment.');
      return { success: false, error: 'ALREADY_ADJUSTED' };
    }

    logger.info('PUT wall hit. Adjusting CALL side to ATM...');
    
    const spotPrice = await optionChain.getNiftySpotPrice(jwtToken);
    const chain = await optionChain.getOptionChain(jwtToken, state.expiryDate);
    
    // Find ATM CALL strike (strictly 100-point intervals)
    const atmCallStrikeObj = chain
      .filter(o => o.optionType === 'CE' && o.strikePrice % 100 === 0)
      .reduce((prev, curr) => 
        Math.abs(curr.strikePrice - spotPrice) < Math.abs(prev.strikePrice - spotPrice) ? curr : prev
      );

    const atmCallSecurity = await optionChain.resolveStrikeSecurity(
      jwtToken,
      atmCallStrikeObj.strikePrice,
      'CE',
      state.expiryDate
    );

    const config = require('../config');
    const quantity = (state.legs.buyCall && state.legs.buyCall.quantity) || (config.lots * config.lotSize);

    // Validate payloads first before placing any orders
    const closeWingPayload = {
      tradingSymbol: state.legs.buyCall && state.legs.buyCall.tradingSymbol,
      token: state.legs.buyCall && state.legs.buyCall.token,
      transactionType: 'SELL', // Closing a long wing requires a SELL order
      quantity
    };

    const openAtmPayload = {
      tradingSymbol: atmCallSecurity && atmCallSecurity.tradingSymbol,
      token: atmCallSecurity && atmCallSecurity.token,
      transactionType: 'SELL',
      quantity
    };

    if (!closeWingPayload.tradingSymbol || !closeWingPayload.token) {
      throw new Error(`Invalid close wing payload: missing symbol or token for buyCall leg (${JSON.stringify(closeWingPayload)})`);
    }

    if (!openAtmPayload.tradingSymbol || !openAtmPayload.token) {
      throw new Error(`Invalid open ATM payload: missing symbol or token for ATM CE strike ${atmCallStrikeObj.strikePrice} (${JSON.stringify(openAtmPayload)})`);
    }

    // Execution sequence: Sell new ATM call first, then close long wing
    // 1. Sell new ATM CALL
    const openOrderId = await orderManager.placeOrder(jwtToken, openAtmPayload);

    // 2. Close existing BUY CALL wing (SELL)
    const closeOrderId = await orderManager.placeOrder(jwtToken, closeWingPayload);

    positionTracker.markAdjusted('CALL', { 
      strike: atmCallSecurity.strike, 
      tradingSymbol: atmCallSecurity.tradingSymbol, 
      token: atmCallSecurity.token, 
      orderId: openOrderId 
    });

    logger.info(`CALL side adjusted to ATM strike ${atmCallSecurity.strike}`);
    return {
      success: true,
      orderIds: [openOrderId, closeOrderId]
    };
  } catch (error) {
    logger.error(`Error during CALL side adjustment: ${error.message}`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Roll the PUT side to ATM.
 * Called when CALL wall is hit (Nifty went up).
 * Action: Sell new ATM PUT, close existing long BUY PUT wing (SELL).
 * @param {string} jwtToken 
 * @returns {Promise<{success: boolean, orderIds?: string[], error?: string}>}
 */
async function adjustPutSide(jwtToken) {
  try {
    const state = positionTracker.getPosition();
    if (state.adjusted) {
      logger.info('Position already adjusted. Skipping PUT side adjustment.');
      return { success: false, error: 'ALREADY_ADJUSTED' };
    }

    logger.info('CALL wall hit. Adjusting PUT side to ATM...');

    const spotPrice = await optionChain.getNiftySpotPrice(jwtToken);
    const chain = await optionChain.getOptionChain(jwtToken, state.expiryDate);

    // Find ATM PUT strike (strictly 100-point intervals)
    const atmPutStrikeObj = chain
      .filter(o => o.optionType === 'PE' && o.strikePrice % 100 === 0)
      .reduce((prev, curr) => 
        Math.abs(curr.strikePrice - spotPrice) < Math.abs(prev.strikePrice - spotPrice) ? curr : prev
      );

    const atmPutSecurity = await optionChain.resolveStrikeSecurity(
      jwtToken,
      atmPutStrikeObj.strikePrice,
      'PE',
      state.expiryDate
    );

    const config = require('../config');
    const quantity = (state.legs.buyPut && state.legs.buyPut.quantity) || (config.lots * config.lotSize);

    // Validate payloads first before placing any orders
    const closeWingPayload = {
      tradingSymbol: state.legs.buyPut && state.legs.buyPut.tradingSymbol,
      token: state.legs.buyPut && state.legs.buyPut.token,
      transactionType: 'SELL', // Closing a long wing requires a SELL order
      quantity
    };

    const openAtmPayload = {
      tradingSymbol: atmPutSecurity && atmPutSecurity.tradingSymbol,
      token: atmPutSecurity && atmPutSecurity.token,
      transactionType: 'SELL',
      quantity
    };

    if (!closeWingPayload.tradingSymbol || !closeWingPayload.token) {
      throw new Error(`Invalid close wing payload: missing symbol or token for buyPut leg (${JSON.stringify(closeWingPayload)})`);
    }

    if (!openAtmPayload.tradingSymbol || !openAtmPayload.token) {
      throw new Error(`Invalid open ATM payload: missing symbol or token for ATM PE strike ${atmPutStrikeObj.strikePrice} (${JSON.stringify(openAtmPayload)})`);
    }

    // Execution sequence: Sell new ATM put first, then close long wing
    // 1. Sell new ATM PUT
    const openOrderId = await orderManager.placeOrder(jwtToken, openAtmPayload);

    // 2. Close existing BUY PUT wing (SELL)
    const closeOrderId = await orderManager.placeOrder(jwtToken, closeWingPayload);

    positionTracker.markAdjusted('PUT', { 
      strike: atmPutSecurity.strike, 
      tradingSymbol: atmPutSecurity.tradingSymbol, 
      token: atmPutSecurity.token, 
      orderId: openOrderId 
    });

    logger.info(`PUT side adjusted to ATM strike ${atmPutSecurity.strike}`);
    return {
      success: true,
      orderIds: [openOrderId, closeOrderId]
    };
  } catch (error) {
    logger.error(`Error during PUT side adjustment: ${error.message}`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  adjustCallSide,
  adjustPutSide
};
