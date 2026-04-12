const logger = require('../utils/logger');

/**
 * From the option chain, identify the correct strikes for 25Δ and 17Δ.
 * @param {Array} optionChain 
 * @returns {Object}
 */
function findStrikes(optionChain) {
  try {
    const putOptions = optionChain.filter(o => o.optionType === 'PE');
    const callOptions = optionChain.filter(o => o.optionType === 'CE');

    // SELL PUT: Closest to -0.25 delta
    const sellPut = putOptions.reduce((prev, curr) => 
      Math.abs(curr.delta + 0.25) < Math.abs(prev.delta + 0.25) ? curr : prev
    );

    // BUY PUT: Closest to -0.17 delta (must be below SELL PUT strike)
    const buyPutCandidates = putOptions.filter(o => o.strikePrice < sellPut.strikePrice);
    const buyPut = buyPutCandidates.reduce((prev, curr) => 
      Math.abs(curr.delta + 0.17) < Math.abs(prev.delta + 0.17) ? curr : prev
    );

    // SELL CALL: Closest to +0.25 delta
    const sellCall = callOptions.reduce((prev, curr) => 
      Math.abs(curr.delta - 0.25) < Math.abs(prev.delta - 0.25) ? curr : prev
    );

    // BUY CALL: Closest to +0.17 delta (must be above SELL CALL strike)
    const buyCallCandidates = callOptions.filter(o => o.strikePrice > sellCall.strikePrice);
    const buyCall = buyCallCandidates.reduce((prev, curr) => 
      Math.abs(curr.delta - 0.17) < Math.abs(prev.delta - 0.17) ? curr : prev
    );

    return {
      sellPut:  { strike: sellPut.strikePrice, tradingSymbol: sellPut.tradingSymbol, token: sellPut.symbolToken, delta: sellPut.delta, ltp: sellPut.ltp },
      buyPut:   { strike: buyPut.strikePrice, tradingSymbol: buyPut.tradingSymbol, token: buyPut.symbolToken, delta: buyPut.delta, ltp: buyPut.ltp },
      sellCall: { strike: sellCall.strikePrice, tradingSymbol: sellCall.tradingSymbol, token: sellCall.symbolToken, delta: sellCall.delta, ltp: sellCall.ltp },
      buyCall:  { strike: buyCall.strikePrice, tradingSymbol: buyCall.tradingSymbol, token: buyCall.symbolToken, delta: buyCall.delta, ltp: buyCall.ltp }
    };
  } catch (error) {
    logger.error('Error finding strikes:', error.message);
    throw error;
  }
}

module.exports = {
  findStrikes
};
