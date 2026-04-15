const optionChain = require('./optionChain');
const { getPosition } = require('./positionTracker');
const orderManager = require('./orderManager');
const logger = require('../utils/logger');
require('dotenv').config();

/**
 * At 3:25 PM, check each open leg. Exit ITM legs only. Leave OTM legs to expire.
 * @param {string} jwtToken 
 */
async function runFinalExitCheck(jwtToken) {
  try {
    const spotPrice = await optionChain.getNiftySpotPrice(jwtToken);
    const state = getPosition();
    const config = require('../config');
    const quantity = config.lots * config.lotSize;

    logger.info(`Final Exit Check: Nifty Spot = ${spotPrice}`);

    const legsToProcess = [];

    // Standard legs + adjusted legs are all in state.legs
    for (const [name, leg] of Object.entries(state.legs)) {
      if (leg && leg.status === 'OPEN') {
        legsToProcess.push({ name, ...leg });
      }
    }

    for (const leg of legsToProcess) {
      let isITM = false;
      const isCall = leg.tradingSymbol.includes('CE') || leg.name.toLowerCase().includes('call');
      const isPut = leg.tradingSymbol.includes('PE') || leg.name.toLowerCase().includes('put');

      if (isCall && spotPrice > leg.strike) isITM = true;
      if (isPut && spotPrice < leg.strike) isITM = true;

      if (isITM) {
        logger.info(`Exiting ITM Leg: ${leg.tradingSymbol} (Strike: ${leg.strike})`);
        await orderManager.exitLeg(jwtToken, { 
          tradingSymbol: leg.tradingSymbol, 
          token: leg.token, 
          transactionType: leg.transactionType, 
          quantity 
        });
        logger.info(`Exited ITM Leg: ${leg.tradingSymbol}`);
      } else {
        logger.info(`Leg ${leg.tradingSymbol} is OTM. Leaving to expire.`);
      }
    }

    logger.info('Final ITM exit check completed.');
  } catch (error) {
    logger.error('Error during final exit check:', error.message);
  }
}

module.exports = {
  runFinalExitCheck
};
