const { isTradingDay } = require('nse-market-holidays');
const moment = require('moment-timezone');
const logger = require('../utils/logger');

/**
 * Determine if today is the correct day to run the algo.
 * @returns {Promise<boolean>}
 */
async function isTodayExpiryDay() {
  const today = moment().tz('Asia/Kolkata');
  const todayStr = today.format('YYYY-MM-DD');
  const dayOfWeek = today.day(); // 0 (Sun) to 6 (Sat)

  // 1. Helper for holiday check with fallback
  const checkIsTradingDay = async (dateStr) => {
    try {
      return await isTradingDay(dateStr);
    } catch (error) {
      // Fallback logic for when NSE website structure changes (causing library 404s)
      const day = moment(dateStr).day();
      // Simple fallback: If it's Saturday (6) or Sunday (0), it's not a trading day
      return !(day === 0 || day === 6);
    }
  };

  const isTodayTrading = await checkIsTradingDay(todayStr);

  // If today is NOT a trading day, it can't be an expiry day
  if (!isTodayTrading) {
    return false;
  }

  // 2. Logic from BLUEPRINT:
  // - Nifty weekly options expire every Tuesday.
  // - If Tuesday is a holiday, it shifts to Monday.

  // Case A: Today is Tuesday
  if (dayOfWeek === 2) {
    return true;
  }

  // Case B: Today is Monday, and next Tuesday is a holiday
  if (dayOfWeek === 1) {
    const nextTuesday = today.clone().add(1, 'day');
    const isTuesdayTrading = await checkIsTradingDay(nextTuesday.format('YYYY-MM-DD'));
    if (!isTuesdayTrading) {
      return true;
    }
  }

  // All other cases
  return false;
}

module.exports = {
  isTodayExpiryDay
};
