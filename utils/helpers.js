const moment = require('moment-timezone');
const axios = require('axios');

let cachedIP = null;

/**
 * Get the current public IPv4 address.
 * Caches the result to avoid repeated external calls.
 * @returns {Promise<string>}
 */
async function getPublicIP() {
  if (cachedIP) return cachedIP;
  
  try {
    const response = await axios.get('https://api.ipify.org?format=json');
    cachedIP = response.data.ip;
    return cachedIP;
  } catch (error) {
    // Fallback to a default if fetch fails
    return process.env.ANGEL_PUBLIC_IP || '103.160.108.203';
  }
}

/**
 * Check if current IST time >= target time string "HH:MM"
 * @param {string} timeStr - Time in HH:MM format (IST)
 * @returns {boolean}
 */
function isTimeReached(timeStr) {
  const currentIST = moment().tz('Asia/Kolkata');
  const [targetHour, targetMin] = timeStr.split(':').map(Number);
  
  const targetTime = moment().tz('Asia/Kolkata').set({
    hour: targetHour,
    minute: targetMin,
    second: 0,
    millisecond: 0
  });

  return currentIST.isSameOrAfter(targetTime);
}

/**
 * Get current IST time as "HH:MM" string
 * @returns {string}
 */
function getCurrentISTTime() {
  return moment().tz('Asia/Kolkata').format('HH:MM');
}

/**
 * Round to nearest Nifty strike (multiples of 100)
 * @param {number} price 
 * @returns {number}
 */
function roundToNearestStrike(price) {
  return Math.round(price / 100) * 100;
}

/**
 * Sleep utility
 * @param {number} ms 
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Standard normal cumulative distribution function (used for Black-Scholes)
 * @param {number} x 
 * @returns {number}
 */
function normalCDF(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (x > 0) return 1 - prob;
  return prob;
}

/**
 * Calculate Black-Scholes Delta
 * @param {string} optionType - 'CE' or 'PE'
 * @param {number} S - Spot Price
 * @param {number} K - Strike Price
 * @param {number} T - Time to Expiry (in years)
 * @param {number} r - Risk-free rate (e.g., 0.065 for 6.5%)
 * @param {number} sigma - Volatility (e.g., 0.15 for 15% IV)
 * @returns {number}
 */
function calculateDelta(optionType, S, K, T, r, sigma) {
  if (T <= 0 || sigma <= 0) return optionType === 'CE' ? 0.5 : -0.5;
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  if (optionType === 'CE') return normalCDF(d1);
  return normalCDF(d1) - 1;
}

module.exports = {
  getPublicIP,
  isTimeReached,
  getCurrentISTTime,
  roundToNearestStrike,
  sleep,
  calculateDelta
};
