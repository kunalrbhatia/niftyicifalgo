const { isTodayExpiryDay, isTradingDay } = require('./modules/holidayCheck');
const { login } = require('./modules/auth');
const { getOptionChain, enrichStrikes } = require('./modules/optionChain');
const { findStrikes } = require('./modules/deltaFinder');
const { placeIronCondorEntry } = require('./modules/orderManager');
const { initPosition, hasOpenPositions, reconstructState } = require('./modules/positionTracker');
const { performSingleWallCheck } = require('./modules/wallMonitor');
const { runFinalExitCheck } = require('./modules/exitManager');
const { isTimeReached, sleep } = require('./utils/helpers');
const logger = require('./utils/logger');
require('dotenv').config();

async function main() {
  logger.info('=== Nifty Positional Algo Started ===');

  try {
    // STEP 1: Check if today is a trading day
    const { isTodayTrading, isExpiry } = await isTodayExpiryDay();
    if (!isTodayTrading) {
      logger.info('Today is NOT a trading day. Algo exits.');
      process.exit(0);
    }
    logger.info('Today IS a valid trading day. Proceeding...');

    // STEP 2: Login
    logger.info('Logging into SmartAPI...');
    const session = await login();
    const { jwtToken } = session;
    logger.info('Login successful.');

    // STEP 4: Check for existing positions
    const positionsExist = await hasOpenPositions(jwtToken);
    
    if (positionsExist) {
      logger.info('Existing Nifty positions detected. Reconstructing state...');
      const success = await reconstructState(jwtToken);
      if (success) {
        // STEP 5: Perform single wall check for adjustment
        logger.info('Performing daily wall check for adjustments...');
        await performSingleWallCheck(jwtToken);
      } else {
        logger.error('Failed to reconstruct state from positions. Skipping wall check.');
      }
    } else {
      logger.info('No open Nifty positions found.');
      
      // OPTIONAL: Entry Logic
      // For now, if no positions, we might want to enter a new Iron Condor 
      // if today is the correct entry day (e.g. after expiry).
      // Based on user request, the focus is on adjustment.
      // If you want auto-entry when empty, uncomment below:
      /*
      const { isExpiry } = await isTodayExpiryDay();
      if (!isExpiry) {
        logger.info('Not an expiry day and no positions. Entering new Iron Condor...');
        const chain = await getOptionChain(jwtToken);
        const initialStrikes = findStrikes(chain);
        const strikes = await enrichStrikes(jwtToken, initialStrikes);
        const orderIds = await placeIronCondorEntry(jwtToken, strikes);
        initPosition(strikes, orderIds);
        logger.info('New positional Iron Condor initiated.');
      }
      */
    }

    // STEP 6: Special handling for Expiry Day
    const { isExpiry } = await isTodayExpiryDay();
    if (isExpiry) {
      const EXIT_TIME = process.env.EXIT_CHECK_TIME || '15:25';
      logger.info(`Today is EXPIRY DAY. Waiting for final exit check at ${EXIT_TIME}...`);
      
      while (!isTimeReached(EXIT_TIME)) {
        await sleep(30 * 1000);
      }
      
      logger.info('Running final ITM exit check...');
      await runFinalExitCheck(jwtToken);
    }

    logger.info('=== Daily Algo Run Completed ===');
    process.exit(0);
  } catch (error) {
    logger.error('Fatal error in main:', error);
    process.exit(1);
  }
}

main();
