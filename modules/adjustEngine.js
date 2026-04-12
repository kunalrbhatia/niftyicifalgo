const { getOptionChain, getNiftySpotPrice } = require('./optionChain');
const { placeOrder } = require('./orderManager');
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
    
    const spotPrice = await getNiftySpotPrice(jwtToken);
    const chain = await getOptionChain(jwtToken);
    
    // Find ATM CALL strike
    const atmCall = chain
      .filter(o => o.optionType === 'CE')
      .reduce((prev, curr) => 
        Math.abs(curr.strikePrice - spotPrice) < Math.abs(prev.strikePrice - spotPrice) ? curr : prev
      );

    const quantity = (parseInt(process.env.LOTS) || 2) * 25;

    // 1. Buy back existing BUY CALL wing
    await placeOrder(jwtToken, { 
      tradingSymbol: state.legs.buyCall.tradingSymbol, 
      token: state.legs.buyCall.token, 
      transactionType: 'BUY', 
      quantity 
    });

    // 2. Sell new ATM CALL
    const orderId = await placeOrder(jwtToken, { 
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
    logger.error('Error during CALL side adjustment:', error.message);
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

    const spotPrice = await getNiftySpotPrice(jwtToken);
    const chain = await getOptionChain(jwtToken);

    // Find ATM PUT strike
    const atmPut = chain
      .filter(o => o.optionType === 'PE')
      .reduce((prev, curr) => 
        Math.abs(curr.strikePrice - spotPrice) < Math.abs(prev.strikePrice - spotPrice) ? curr : prev
      );

    const quantity = (parseInt(process.env.LOTS) || 2) * 25;

    // 1. Buy back existing BUY PUT wing
    await placeOrder(jwtToken, { 
      tradingSymbol: state.legs.buyPut.tradingSymbol, 
      token: state.legs.buyPut.token, 
      transactionType: 'BUY', 
      quantity 
    });

    // 2. Sell new ATM PUT
    const orderId = await placeOrder(jwtToken, { 
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
    logger.error('Error during PUT side adjustment:', error.message);
  }
}

module.exports = {
  adjustCallSide,
  adjustPutSide
};
