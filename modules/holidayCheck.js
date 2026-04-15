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

  const getMonthlyExpiry = (date) => {
    let lastDayOfMonth = date.clone().endOf('month');
    let lastTuesday = lastDayOfMonth.clone();
    
    // Find the last Tuesday (2 = Tuesday)
    while (lastTuesday.day() !== 2) {
      lastTuesday.subtract(1, 'day');
    }

    // Check if last Tuesday is a holiday, if so, move to preceding trading day
    while (!checkIsTradingDay(lastTuesday.format('YYYY-MM-DD'))) {
      lastTuesday.subtract(1, 'day');
    }
    
    return lastTuesday.format('YYYY-MM-DD');
  };

  const monthlyExpiryToday = getMonthlyExpiry(today);
  const isExpiry = todayStr === monthlyExpiryToday;

  return { isTodayTrading, todayStr, isExpiry, checkIsTradingDay };
}

module.exports = {
  isTodayExpiryDay,
  isTradingDay: async () => {
    const { isTodayTrading } = await isTodayExpiryDay();
    return isTodayTrading;
  }
};
