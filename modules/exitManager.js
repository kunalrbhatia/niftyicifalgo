const { getNiftySpotPrice } = require('./optionChain');
const { getPosition } = require('./positionTracker');
const { exitLeg } = require('./orderManager');
const logger = require('../utils/logger');
require('dotenv').config();

/**
 * At 3:25 PM, check each open leg. Exit ITM legs only. Leave OTM legs to expire.
 * @param {string} jwtToken 
 */
async function runFinalExitCheck(jwtToken) {
  try {
    const spotPrice = await getNiftySpotPrice(jwtToken);
    const state = getPosition();
    const quantity = (parseInt(process.env.LOTS) || 2) * 25;

    logger.info(`Final Exit Check: Nifty Spot = ${spotPrice}`);

    const legsToProcess = [];

    // Add standard legs
    for (const [name, leg] of Object.entries(state.legs)) {
      if (leg && leg.status === 'OPEN') {
        legsToProcess.push({ name, ...leg });
      }
    }

    // Add adjusted legs if any
    if (state.legs.newAtmCall && state.legs.newAtmCall.status === 'OPEN') {
      legsToProcess.push({ name: 'newAtmCall', ...state.legs.newAtmCall });
    }
    if (state.legs.newAtmPut && state.legs.newAtmPut.status === 'OPEN') {
      legsToProcess.push({ name: 'newAtmPut', ...state.legs.newAtmPut });
    }

    for (const leg of legsToProcess) {
      let isITM = false;
      const isCall = leg.tradingSymbol.includes('CE') || leg.name.toLowerCase().includes('call');
      const isPut = leg.tradingSymbol.includes('PE') || leg.name.toLowerCase().includes('put');

      if (isCall && spotPrice > leg.strike) isITM = true;
      if (isPut && spotPrice < leg.strike) isITM = true;

      if (isITM) {
        logger.info(`Exiting ITM Leg: ${leg.tradingSymbol} (Strike: ${leg.strike})`);
        await exitLeg(jwtToken, { 
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
