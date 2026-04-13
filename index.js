const { isTodayExpiryDay } = require('./modules/holidayCheck');
const { login } = require('./modules/auth');
const { getOptionChain } = require('./modules/optionChain');
const { findStrikes } = require('./modules/deltaFinder');
const { placeIronCondorEntry } = require('./modules/orderManager');
const { initPosition } = require('./modules/positionTracker');
const { startMonitoring, stopMonitoring } = require('./modules/wallMonitor');
const { runFinalExitCheck } = require('./modules/exitManager');
const { isTimeReached, sleep } = require('./utils/helpers');
const logger = require('./utils/logger');
require('dotenv').config();

async function main() {
  logger.info('=== Nifty Expiry Algo Started ===');

  try {
    // STEP 1: Check if today is expiry day
    const isExpiry = await isTodayExpiryDay();
    if (!isExpiry) {
      logger.info('Today is NOT Nifty expiry day. Algo exits.');
      process.exit(0);
    }
    logger.info('Today IS Nifty expiry day. Proceeding...');

    // STEP 2: Wait until entry time (09:30 AM IST)
    while (!isTimeReached(process.env.ENTRY_TIME || '09:30')) {
      logger.info(`Waiting for entry time ${process.env.ENTRY_TIME || '09:30'}...`);
      await sleep(30 * 1000); // check every 30 sec
    }

    // STEP 3: Login
    logger.info('Logging into SmartAPI...');
    const session = await login();
    const { jwtToken } = session;
    logger.info('Login successful.');

    // NEW: Check if positions already exist to avoid redundant entry on restart
    const { hasOpenPositions, reconstructState } = require('./modules/positionTracker');
    const positionsExist = await hasOpenPositions(jwtToken);
    if (positionsExist) {
      logger.warn('Detected existing Nifty positions for today.');
      const success = await reconstructState(jwtToken);
      if (success) {
        logger.info('Successfully reconstructed state. Resuming monitoring...');
        startMonitoring(jwtToken);
      } else {
        logger.error('Failed to reconstruct state from positions. Monitoring will NOT start.');
      }
    } else {
      // STEP 4: Fetch option chain + find strikes
      logger.info('Fetching option chain...');
      const chain = await getOptionChain(jwtToken);
      const initialStrikes = findStrikes(chain);
      logger.info('Identifying tokens and LTP for strikes...');
      const { enrichStrikes } = require('./modules/optionChain');
      const strikes = await enrichStrikes(jwtToken, initialStrikes);
      logger.info('Strikes identified and enriched:', strikes);

      // STEP 5: Place Iron Condor entry (4 legs)
      logger.info('Placing Iron Condor orders...');
      const orderIds = await placeIronCondorEntry(jwtToken, strikes);
      initPosition(strikes, orderIds);
      logger.info('Orders placed. Position initiated.');

      // STEP 6: Start wall monitoring loop
      logger.info('Starting wall monitor...');
      startMonitoring(jwtToken);
    }

    // STEP 7: Wait until 15:25 (Final Exit)
    while (!isTimeReached(process.env.EXIT_CHECK_TIME || '15:25')) {
      await sleep(60 * 1000); // wait 1 min
    }

    // STEP 8: Stop monitor (if still running) and run final exit check
    stopMonitoring();
    logger.info('Running final ITM exit check at 15:25...');
    await runFinalExitCheck(jwtToken);

    logger.info('=== Algo Completed for Today ===');
    process.exit(0);
  } catch (error) {
    logger.error('Fatal error in main:', error);
    process.exit(1);
  }
}

main();
