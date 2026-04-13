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

  // 1. Helper for holiday check (Manual List for 2026)
  const checkIsTradingDay = (dateStr) => {
    const nseHolidays2026 = [
      '2026-01-26', // Republic Day
      '2026-03-03', // Holi
      '2026-03-26', // Shri Ram Navami
      '2026-03-31', // Shri Mahavir Jayanti
      '2026-04-03', // Good Friday
      '2026-04-14', // Dr. Ambedkar Jayanti
      '2026-05-01', // Maharashtra Day
      '2026-05-28', // Bakri Id
      '2026-06-26', // Muharram
      '2026-10-02', // Mahatma Gandhi Jayanti
      '2026-10-20', // Dussehra
      '2026-12-25', // Christmas
    ];

    if (nseHolidays2026.includes(dateStr)) {
      return false;
    }

    const day = moment(dateStr).day();
    // Weekend check
    return !(day === 0 || day === 6);
  };

  const isTodayTrading = checkIsTradingDay(todayStr);

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
    const isTuesdayTrading = checkIsTradingDay(nextTuesday.format('YYYY-MM-DD'));
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
