const { isTodayExpiryDay, isTradingDay } = require('./modules/holidayCheck');
const { login } = require('./modules/auth');
const { getOptionChain, enrichStrikes } = require('./modules/optionChain');
const { findStrikes } = require('./modules/deltaFinder');
const { placeIronCondorEntry } = require('./modules/orderManager');
const { initPosition, hasOpenPositions, reconstructState } = require('./modules/positionTracker');
const { performSingleWallCheck } = require('./modules/wallMonitor');
const { runFinalExitCheck } = require('./modules/exitManager');
const { isTimeReached, sleep } = require('./utils/helpers');
const { sendTelegramMessage } = require('./utils/notifier');
const logger = require('./utils/logger');
require('dotenv').config();

const { downloadAndFilterScrips } = require('./filter_scrips');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');

async function main() {
  logger.info('=== Nifty Positional Algo Started ===');
  let summary = '🤖 <b>Nifty Algo Daily Summary</b>\n\n';

  try {
    // STEP 0: Ensure scrip master is fresh (Updated daily at 9 AM IST)
    const masterPath = path.join(__dirname, 'scrip_master.json');
    let shouldUpdate = false;
    
    if (!fs.existsSync(masterPath)) {
      logger.info('Scrip master file NOT found. Triggering update...');
      summary += '✅ Scrip master downloaded.\n';
      shouldUpdate = true;
    } else {
      const stats = fs.statSync(masterPath);
      const lastModified = moment(stats.mtime).tz('Asia/Kolkata');
      const today9AM = moment().tz('Asia/Kolkata').set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
      
      // If last modified is BEFORE today's 9 AM, and we are AFTER today's 9 AM, then update
      if (lastModified.isBefore(today9AM) && moment().tz('Asia/Kolkata').isAfter(today9AM)) {
        logger.info('Scrip master is from yesterday or before 9 AM today. Triggering update...');
        summary += '🔄 Scrip master refreshed.\n';
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
      summary += 'ℹ️ Scrip master already current.\n';
    }

    // STEP 1: Check if today is a trading day
    const { isTodayTrading, isExpiry } = await isTodayExpiryDay();
    if (!isTodayTrading) {
      logger.info('Today is NOT a trading day. Algo exits.');
      summary += '⏸ Today is a holiday. No action taken.';
      await sendTelegramMessage(summary);
      process.exit(0);
    }
    logger.info('Today IS a valid trading day. Proceeding...');
    summary += `📅 Trading Day (${isExpiry ? 'Expiry' : 'Normal'})\n`;

    // STEP 2: Login
    logger.info('Logging into SmartAPI...');
    const session = await login();
    const { jwtToken } = session;
    logger.info('Login successful.');

    // STEP 4: Check for existing positions
    const positionsExist = await hasOpenPositions(jwtToken);
    
    if (positionsExist) {
      logger.info('Existing Nifty positions detected. Waiting 1.2s to respect rate limits...');
      summary += '📈 Existing positions found.\n';
      await sleep(1200);
      
      logger.info('Reconstructing state...');
      const success = await reconstructState(jwtToken);
      if (success) {
        // STEP 5: Perform single wall check for adjustment
        logger.info('Performing daily wall check for adjustments...');
        const adjustmentResult = await performSingleWallCheck(jwtToken);
        if (adjustmentResult && adjustmentResult.adjusted) {
            summary += `⚠️ <b>Adjustment Performed!</b> Side: ${adjustmentResult.side}\n`;
        } else {
            summary += '🛡 Wall check: All good, no adjustment needed.\n';
        }
      } else {
        logger.error('Failed to reconstruct state from positions. Skipping wall check.');
        summary += '❌ Failed to reconstruct position state.\n';
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
        summary += '🆕 New Iron Condor entry placed.\n';
      } else {
        logger.info(`Today is day ${dayOfMonth} of the month (> 15). Skipping new entry.`);
        summary += '⌛ No active positions. Skipping entry (> day 15).\n';
      }
    }

    // STEP 6: Special handling for Expiry Day
    const expiryStatus = await isTodayExpiryDay();
    if (expiryStatus.isExpiry) {
      const EXIT_TIME = process.env.EXIT_CHECK_TIME || '15:25';
      logger.info(`Today is EXPIRY DAY. Waiting for final exit check at ${EXIT_TIME}...`);
      summary += `🕒 Expiry day: Waiting for ${EXIT_TIME} exit check...\n`;
      
      while (!isTimeReached(EXIT_TIME)) {
        await sleep(30 * 1000);
      }
      
      logger.info('Running final ITM exit check...');
      await runFinalExitCheck(jwtToken);
      summary += '🏁 Final ITM exit check completed.\n';
    }

    logger.info('=== Daily Algo Run Completed ===');
    summary += '\n✨ <b>Algo run completed successfully.</b>';
    await sendTelegramMessage(summary);
    process.exit(0);
  } catch (error) {
    logger.error('Fatal error in main:', error);
    summary += `\n🚨 <b>FATAL ERROR:</b> ${error.message}`;
    await sendTelegramMessage(summary);
    process.exit(1);
  }
}

main();
