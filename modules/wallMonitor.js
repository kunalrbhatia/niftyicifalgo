const { getNiftySpotPrice } = require('./optionChain');
const { getPosition } = require('./positionTracker');
const { adjustCallSide, adjustPutSide } = require('./adjustEngine');
const logger = require('../utils/logger');

/**
 * Checks if Nifty spot has hit either wall and triggers adjustment if yes.
 * This is a single-shot check for positional strategy.
 * @param {string} jwtToken 
 */
async function performSingleWallCheck(jwtToken) {
  try {
    const state = getPosition();
    
    // If already adjusted, we don't do further adjustments in this version
    if (state.adjusted) {
      logger.info('Position already adjusted. Skipping wall check.');
      return { adjusted: false, reason: 'ALREADY_ADJUSTED' };
    }

    // Ensure we have the legs to check
    if (!state.legs.sellPut || !state.legs.sellCall) {
      logger.error('Cannot perform wall check: Legs missing in state.');
      return { adjusted: false, reason: 'MISSING_LEGS' };
    }

    const spotPrice = await getNiftySpotPrice(jwtToken);
    logger.info(`Positional Wall Check: Nifty Spot = ${spotPrice}`);

    // SELL PUT strike is the PUT WALL
    if (spotPrice <= state.legs.sellPut.strike) {
      logger.info(`PUT Wall Hit! Spot ${spotPrice} <= Strike ${state.legs.sellPut.strike}`);
      await adjustCallSide(jwtToken);
      return { adjusted: true, side: 'PUT' };
    } 
    // SELL CALL strike is the CALL WALL
    else if (spotPrice >= state.legs.sellCall.strike) {
      logger.info(`CALL Wall Hit! Spot ${spotPrice} >= Strike ${state.legs.sellCall.strike}`);
      await adjustPutSide(jwtToken);
      return { adjusted: true, side: 'CALL' };
    } else {
      logger.info('No wall breach detected. Position remains as is.');
      return { adjusted: false, reason: 'NO_BREACH' };
    }
  } catch (error) {
    logger.error(`Error in performSingleWallCheck: ${error.message}`);
    return { adjusted: false, error: error.message };
  }
}

module.exports = {
  performSingleWallCheck
};
