const moment = require('moment-timezone');

const nseHolidays = [
  '2025-01-26', '2025-03-14', '2025-03-31', '2025-04-10', '2025-04-14', '2025-04-18', '2025-05-01', '2025-08-15', '2025-08-27', '2025-10-02', '2025-10-21', '2025-11-05', '2025-12-25',
  '2026-01-26', '2026-03-03', '2026-03-26', '2026-03-31', '2026-04-03', '2026-04-14', '2026-05-01', '2026-05-28', '2026-06-26', '2026-10-02', '2026-10-20', '2026-12-25',
];

function isTradingDay(date) {
  const dateStr = date.format('YYYY-MM-DD');
  if (nseHolidays.includes(dateStr)) return false;
  const day = date.day();
  return !(day === 0 || day === 6);
}

function getMonthlyExpiry(year, month) {
  let date = moment().tz('Asia/Kolkata').year(year).month(month).endOf('month');
  
  // Find last Tuesday (2)
  while (date.day() !== 2) {
    date.subtract(1, 'day');
  }

  // If holiday, move to preceding trading day
  while (!isTradingDay(date)) {
    date.subtract(1, 'day');
  }
  
  return date.format('YYYY-MM-DD');
}

function getLastSixExpiries() {
  const expiries = [];
  let current = moment().tz('Asia/Kolkata').subtract(1, 'month'); // Start from last month
  
  for (let i = 0; i < 6; i++) {
    expiries.push(getMonthlyExpiry(current.year(), current.month()));
    current.subtract(1, 'month');
  }
  
  return expiries.sort();
}

console.log('Last 6 Monthly Expiries:');
console.log(getLastSixExpiries());

module.exports = { getLastSixExpiries, isTradingDay };
