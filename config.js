// config.js
module.exports = {
  // Strategy
  sellDelta: parseInt(process.env.SELL_DELTA) || 25,   // Short strike delta
  buyDelta: parseInt(process.env.BUY_DELTA) || 17,     // Wing delta
  lots: parseInt(process.env.LOTS) || 2,               // 1 lot = 65 qty as per 2025-26 NSE update
  lotSize: parseInt(process.env.LOT_SIZE) || 65,                                          

  // Timing (IST — 24hr format)
  entryTime: process.env.ENTRY_TIME || '09:30',         // Place orders at
  monitorIntervalMs: 60 * 1000,                         // Check every 1 minute
  finalExitTime: process.env.EXIT_CHECK_TIME || '15:25',// ITM exit check time

  // Orders
  orderType: 'MARKET',                                  // Always market orders
  exchange: 'NFO',                                      // NSE F&O segment
  productType: 'INTRADAY',                              // Intraday product

  // Instrument
  symbol: 'NIFTY',
  expiryType: 'weekly',

  // SmartAPI endpoints
  baseURL: 'https://apiconnect.angelone.in',

  // Logging
  logDir: './logs',
};
