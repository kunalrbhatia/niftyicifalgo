const { getNiftySpotPrice } = require('./optionChain');
const { getPosition } = require('./positionTracker');
const { adjustCallSide, adjustPutSide } = require('./adjustEngine');
const logger = require('../utils/logger');

let monitorInterval = null;

/**
 * Every 1 minute, check if Nifty spot has hit either wall.
 * Trigger adjustment if yes.
 * @param {string} jwtToken 
 */
function startMonitoring(jwtToken) {
  if (monitorInterval) return;

  monitorInterval = setInterval(async () => {
    try {
      const state = getPosition();
      if (state.adjusted) {
        stopMonitoring();
        return;
      }

      const spotPrice = await getNiftySpotPrice(jwtToken);
      logger.debug(`Monitoring Wall: Nifty Spot = ${spotPrice}`);

      // SELL PUT strike is the PUT WALL
      if (spotPrice <= state.legs.sellPut.strike) {
        logger.info(`PUT Wall Hit! Spot ${spotPrice} <= Strike ${state.legs.sellPut.strike}`);
        await adjustCallSide(jwtToken);
        stopMonitoring();
      } 
      // SELL CALL strike is the CALL WALL
      else if (spotPrice >= state.legs.sellCall.strike) {
        logger.info(`CALL Wall Hit! Spot ${spotPrice} >= Strike ${state.legs.sellCall.strike}`);
        await adjustPutSide(jwtToken);
        stopMonitoring();
      }
    } catch (error) {
      logger.error('Error in wall monitor loop:', error.message);
    }
  }, 60 * 1000); // 1 minute
}

/**
 * Stop the monitoring loop.
 */
function stopMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    logger.info('Wall monitoring stopped.');
  }
}

module.exports = {
  startMonitoring,
  stopMonitoring
};
