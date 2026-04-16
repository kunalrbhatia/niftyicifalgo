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

const { downloadAndFilterScrips } = require('./filter_scrips');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');

async function main() {
  logger.info('=== Nifty Positional Algo Started ===');

  try {
    // STEP 0: Ensure scrip master is fresh (Updated daily at 9 AM IST)
    const masterPath = path.join(__dirname, 'scrip_master.json');
    let shouldUpdate = false;
    
    if (!fs.existsSync(masterPath)) {
      logger.info('Scrip master file NOT found. Triggering update...');
      shouldUpdate = true;
    } else {
      const stats = fs.statSync(masterPath);
      const lastModified = moment(stats.mtime).tz('Asia/Kolkata');
      const today9AM = moment().tz('Asia/Kolkata').set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
      
      // If last modified is BEFORE today's 9 AM, and we are AFTER today's 9 AM, then update
      if (lastModified.isBefore(today9AM) && moment().tz('Asia/Kolkata').isAfter(today9AM)) {
        logger.info('Scrip master is from yesterday or before 9 AM today. Triggering update...');
        shouldUpdate = true;
      }
    }

    if (shouldUpdate) {
      const success = await downloadAndFilterScrips();
      if (!success) {
        throw new Error('Failed to update scrip master. Cannot proceed.');
      }
    } else {
      logger.info('Scrip master is already up-to-date.');
    }

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
      logger.info('Existing Nifty positions detected. Waiting 1.2s to respect rate limits...');
      await sleep(1200);
      
      logger.info('Reconstructing state...');
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
      
      const moment = require('moment-timezone');
      const today = moment().tz('Asia/Kolkata');
      const dayOfMonth = today.date();

      if (dayOfMonth <= 15) {
        logger.info(`Today is day ${dayOfMonth} of the month (<= 15). Initiating new Iron Condor...`);
        
        // Fetch option chain + find strikes
        logger.info('Fetching option chain...');
        const chain = await getOptionChain(jwtToken);
        const initialStrikes = findStrikes(chain);
        
        logger.info('Identifying tokens and LTP for strikes...');
        const strikes = await enrichStrikes(jwtToken, initialStrikes);
        logger.info('Strikes identified and enriched:', strikes);

        // Place Iron Condor entry (4 legs)
        logger.info('Placing Iron Condor orders...');
        const orderIds = await placeIronCondorEntry(jwtToken, strikes);
        initPosition(strikes, orderIds);
        logger.info('New positional Iron Condor initiated.');
      } else {
        logger.info(`Today is day ${dayOfMonth} of the month (> 15). Skipping new entry.`);
      }
    }

    // STEP 6: Special handling for Expiry Day
    const expiryStatus = await isTodayExpiryDay();
    if (expiryStatus.isExpiry) {
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
