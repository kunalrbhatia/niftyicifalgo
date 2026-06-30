const optionChain = require('./optionChain');
const orderManager = require('./orderManager');
const { markAdjusted, getPosition } = require('./positionTracker');
const logger = require('../utils/logger');
require('dotenv').config();

/**
 * Roll the CALL side to ATM.
 * Called when PUT wall is hit (Nifty went down).
 * Action: Buy back existing BUY CALL (wing), sell new ATM CALL.
 * @param {string} jwtToken 
 */
async function adjustCallSide(jwtToken) {
  try {
    const state = getPosition();
    if (state.adjusted) return;

    logger.info('PUT wall hit. Adjusting CALL side to ATM...');
    
    const spotPrice = await optionChain.getNiftySpotPrice(jwtToken);
    const chain = await optionChain.getOptionChain(jwtToken, state.expiryDate);
    
    // Find ATM CALL strike (strictly 100-point intervals)
    const atmCall = chain
      .filter(o => o.optionType === 'CE' && o.strikePrice % 100 === 0)
      .reduce((prev, curr) => 
        Math.abs(curr.strikePrice - spotPrice) < Math.abs(prev.strikePrice - spotPrice) ? curr : prev
      );

    const config = require('../config');
    const quantity = config.lots * config.lotSize;

    // 1. Buy back existing BUY CALL wing
    await orderManager.placeOrder(jwtToken, { 
      tradingSymbol: state.legs.buyCall.tradingSymbol, 
      token: state.legs.buyCall.token, 
      transactionType: 'BUY', 
      quantity 
    });

    // 2. Sell new ATM CALL
    const orderId = await orderManager.placeOrder(jwtToken, { 
      tradingSymbol: atmCall.tradingSymbol, 
      token: atmCall.symbolToken, 
      transactionType: 'SELL', 
      quantity 
    });

    markAdjusted('CALL', { 
      strike: atmCall.strikePrice, 
      tradingSymbol: atmCall.tradingSymbol, 
      token: atmCall.symbolToken, 
      orderId 
    });

    logger.info(`CALL side adjusted to ATM strike ${atmCall.strikePrice}`);
  } catch (error) {
    logger.error(`Error during CALL side adjustment: ${error.message}`, error);
  }
}

/**
 * Roll the PUT side to ATM.
 * Called when CALL wall is hit (Nifty went up).
 * Action: Buy back existing BUY PUT (wing), sell new ATM PUT.
 * @param {string} jwtToken 
 */
async function adjustPutSide(jwtToken) {
  try {
    const state = getPosition();
    if (state.adjusted) return;

    logger.info('CALL wall hit. Adjusting PUT side to ATM...');

    const spotPrice = await optionChain.getNiftySpotPrice(jwtToken);
    const chain = await optionChain.getOptionChain(jwtToken, state.expiryDate);

    // Find ATM PUT strike (strictly 100-point intervals)
    const atmPut = chain
      .filter(o => o.optionType === 'PE' && o.strikePrice % 100 === 0)
      .reduce((prev, curr) => 
        Math.abs(curr.strikePrice - spotPrice) < Math.abs(prev.strikePrice - spotPrice) ? curr : prev
      );

    const config = require('../config');
    const quantity = config.lots * config.lotSize;

    // 1. Buy back existing BUY PUT wing
    await orderManager.placeOrder(jwtToken, { 
      tradingSymbol: state.legs.buyPut.tradingSymbol, 
      token: state.legs.buyPut.token, 
      transactionType: 'BUY', 
      quantity 
    });

    // 2. Sell new ATM PUT
    const orderId = await orderManager.placeOrder(jwtToken, { 
      tradingSymbol: atmPut.tradingSymbol, 
      token: atmPut.symbolToken, 
      transactionType: 'SELL', 
      quantity 
    });

    markAdjusted('PUT', { 
      strike: atmPut.strikePrice, 
      tradingSymbol: atmPut.tradingSymbol, 
      token: atmPut.symbolToken, 
      orderId 
    });

    logger.info(`PUT side adjusted to ATM strike ${atmPut.strikePrice}`);
  } catch (error) {
    logger.error(`Error during PUT side adjustment: ${error.message}`, error);
  }
}

module.exports = {
  adjustCallSide,
  adjustPutSide
};
