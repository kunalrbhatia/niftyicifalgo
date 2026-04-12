const { isHoliday } = require('nse-market-holidays');
const moment = require('moment-timezone');

/**
 * Determine if today is the correct day to run the algo.
 * @returns {Promise<boolean>}
 */
async function isTodayExpiryDay() {
  const today = moment().tz('Asia/Kolkata');
  const todayStr = today.format('YYYY-MM-DD');

  // 1. Check if today is a trading day
  if (isHoliday(todayStr)) {
    return false;
  }

  const dayOfWeek = today.day(); // 0 (Sun) to 6 (Sat)

  // 3. If today is Tuesday AND it's a trading day
  if (dayOfWeek === 2) {
    return true;
  }

  // 4. If today is Monday AND it's a trading day AND next Tuesday is NOT a trading day
  if (dayOfWeek === 1) {
    const nextTuesday = today.clone().add(1, 'day');
    if (isHoliday(nextTuesday.format('YYYY-MM-DD'))) {
      return true;
    }
  }

  // All other cases
  return false;
}

module.exports = {
  isTodayExpiryDay
};
