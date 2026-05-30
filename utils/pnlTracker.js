const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const axios = require('axios');
const logger = require('./logger');

const PNL_FILE = path.join(__dirname, '../logs/pnl_history.json');

/**
 * Save P&L record to history file.
 * @param {Object} record 
 */
function savePnLRecord(record) {
  try {
    let history = [];
    if (fs.existsSync(PNL_FILE)) {
      const data = fs.readFileSync(PNL_FILE, 'utf8');
      history = JSON.parse(data);
    }

    const todayStr = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');
    const existingIndex = history.findIndex(r => r.date.startsWith(todayStr) && r.type === record.type);

    const newRecord = {
      date: moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss'),
      ...record
    };

    if (existingIndex !== -1 && record.type === 'DAILY_SYNC') {
      // Update existing sync record for today instead of duplicating
      history[existingIndex] = newRecord;
    } else {
      history.push(newRecord);
    }

    fs.writeFileSync(PNL_FILE, JSON.stringify(history, null, 2));
    logger.info(`P&L record saved to ${PNL_FILE}`);
  } catch (error) {
    logger.error(`Error saving P&L record: ${error.message}`, error);
  }
}

/**
 * Fetch daily realized P&L from positions and sync with history.
 * @param {string} jwtToken 
 */
async function syncDailyRealizedPnL(jwtToken) {
  try {
    const { getPositions } = require('./helpers');
    const data = await getPositions(jwtToken);
    
    if (data.status === true && data.data) {
      const positions = data.data;
      
      // Calculate total realized P&L for Nifty options today
      const dailyRealized = positions
        .filter(p => p.tradingsymbol.startsWith('NIFTY'))
        .reduce((sum, p) => sum + parseFloat(p.realised || 0), 0);
 
      if (dailyRealized !== 0) {
        logger.info(`Daily Sync: Found ₹${dailyRealized} realized P&L today. Updating history...`);
        savePnLRecord({
          totalPnL: dailyRealized,
          type: 'DAILY_SYNC',
          note: 'Automated daily realized P&L sync'
        });
      } else {
        logger.info('Daily Sync: No realized P&L found today.');
      }
    }
  } catch (error) {
    logger.error(`Error during daily P&L sync: ${error.message}`, error);
  }
}

/**
 * Get total P&L for the current month.
 * @returns {number}
 */
function getMonthlyPnL() {
  try {
    if (!fs.existsSync(PNL_FILE)) return 0;
    const data = fs.readFileSync(PNL_FILE, 'utf8');
    const history = JSON.parse(data);
    const currentMonth = moment().tz('Asia/Kolkata').format('YYYY-MM');

    return history
      .filter(record => record.date.startsWith(currentMonth))
      .reduce((sum, record) => sum + (record.totalPnL || 0), 0);
  } catch (error) {
    logger.error(`Error calculating monthly P&L: ${error.message}`, error);
    return 0;
  }
}

module.exports = {
  savePnLRecord,
  syncDailyRealizedPnL,
  getMonthlyPnL
};
