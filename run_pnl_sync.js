// run_pnl_sync.js
const { login } = require('./modules/auth');
const pnlTracker = require('./utils/pnlTracker');
const logger = require('./utils/logger');
require('dotenv').config();

async function run() {
  try {
    logger.info('Starting manual P&L Sync...');
    const session = await login();
    const { jwtToken } = session;
    logger.info('Login successful. Executing P&L Sync...');
    await pnlTracker.syncDailyRealizedPnL(jwtToken);
    logger.info('Manual P&L Sync completed successfully.');
  } catch (error) {
    logger.error('Error during manual P&L sync:', error);
  }
}

run();
