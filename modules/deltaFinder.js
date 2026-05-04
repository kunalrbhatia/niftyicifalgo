const logger = require('../utils/logger');

/**
 * From the option chain, identify the correct strikes for 25Δ and 17Δ.
 * Force 100-point intervals (e.g., 23300, 25400).
 * If closest is a 50-multiple, push further OTM.
 * @param {Array} optionChain 
 * @returns {Object}
 */
function findStrikes(optionChain) {
  try {
    const putOptions = optionChain.filter(o => o.optionType === 'PE');
    const callOptions = optionChain.filter(o => o.optionType === 'CE');

    // --- PUT SIDE ---
    // 1. Find absolute closest to -0.25 delta
    let sellPut = putOptions.reduce((prev, curr) => 
      Math.abs(curr.delta + 0.25) < Math.abs(prev.delta + 0.25) ? curr : prev
    );
    // 2. Force 100-multiple (Round DOWN for Puts)
    if (sellPut.strikePrice % 100 !== 0) {
      const target = Math.floor(sellPut.strikePrice / 100) * 100;
      sellPut = putOptions.find(o => o.strikePrice === target) || sellPut;
    }

    // 3. Find absolute closest to -0.17 delta
    const buyPutCandidates = putOptions.filter(o => o.strikePrice < sellPut.strikePrice);
    let buyPut = buyPutCandidates.reduce((prev, curr) => 
      Math.abs(curr.delta + 0.17) < Math.abs(prev.delta + 0.17) ? curr : prev
    );
    // 4. Force 100-multiple (Round DOWN for Puts)
    if (buyPut.strikePrice % 100 !== 0) {
      const target = Math.floor(buyPut.strikePrice / 100) * 100;
      buyPut = putOptions.find(o => o.strikePrice === target) || buyPut;
    }
    // Safety: ensure gap
    if (buyPut.strikePrice >= sellPut.strikePrice) {
      buyPut = putOptions.find(o => o.strikePrice === sellPut.strikePrice - 100) || buyPut;
    }

    // --- CALL SIDE ---
    // 1. Find absolute closest to +0.25 delta
    let sellCall = callOptions.reduce((prev, curr) => 
      Math.abs(curr.delta - 0.25) < Math.abs(prev.delta - 0.25) ? curr : prev
    );
    // 2. Force 100-multiple (Round UP for Calls)
    if (sellCall.strikePrice % 100 !== 0) {
      const target = Math.ceil(sellCall.strikePrice / 100) * 100;
      sellCall = callOptions.find(o => o.strikePrice === target) || sellCall;
    }

    // 3. Find absolute closest to +0.17 delta
    const buyCallCandidates = callOptions.filter(o => o.strikePrice > sellCall.strikePrice);
    let buyCall = buyCallCandidates.reduce((prev, curr) => 
      Math.abs(curr.delta - 0.17) < Math.abs(prev.delta - 0.17) ? curr : prev
    );
    // 4. Force 100-multiple (Round UP for Calls)
    if (buyCall.strikePrice % 100 !== 0) {
      const target = Math.ceil(buyCall.strikePrice / 100) * 100;
      buyCall = callOptions.find(o => o.strikePrice === target) || buyCall;
    }
    // Safety: ensure gap
    if (buyCall.strikePrice <= sellCall.strikePrice) {
      buyCall = callOptions.find(o => o.strikePrice === sellCall.strikePrice + 100) || buyCall;
    }

    logger.info(`Strikes Selected (100-pt intervals): PE Sell:${sellPut.strikePrice}/Buy:${buyPut.strikePrice} | CE Sell:${sellCall.strikePrice}/Buy:${buyCall.strikePrice}`);

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
