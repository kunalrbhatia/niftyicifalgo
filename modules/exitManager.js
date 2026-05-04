const optionChain = require('./optionChain');
const { getPosition } = require('./positionTracker');
const orderManager = require('./orderManager');
const logger = require('../utils/logger');
const pnlTracker = require('../utils/pnlTracker');
const axios = require('axios');
require('dotenv').config();

/**
 * At 3:25 PM, check each open leg. Exit ITM legs only. Leave OTM legs to expire.
 * @param {string} jwtToken 
 */
async function runFinalExitCheck(jwtToken) {
  try {
    const spotPrice = await optionChain.getNiftySpotPrice(jwtToken);
    const state = getPosition();
    const config = require('../config');
    const quantity = config.lots * config.lotSize;

    logger.info(`Final Exit Check: Nifty Spot = ${spotPrice}`);

    const legsToProcess = [];

    // Standard legs + adjusted legs are all in state.legs
    for (const [name, leg] of Object.entries(state.legs)) {
      if (leg && leg.status === 'OPEN') {
        legsToProcess.push({ name, ...leg });
      }
    }

    let totalPnL = 0;
    const exitedLegs = [];

    for (const leg of legsToProcess) {
      let isITM = false;
      const isCall = leg.tradingSymbol.includes('CE') || leg.name.toLowerCase().includes('call');
      const isPut = leg.tradingSymbol.includes('PE') || leg.name.toLowerCase().includes('put');

      if (isCall && spotPrice > leg.strike) isITM = true;
      if (isPut && spotPrice < leg.strike) isITM = true;

      if (isITM) {
        logger.info(`Exiting ITM Leg: ${leg.tradingSymbol} (Strike: ${leg.strike})`);
        await orderManager.exitLeg(jwtToken, { 
          tradingSymbol: leg.tradingSymbol, 
          token: leg.token, 
          transactionType: leg.transactionType, 
          quantity 
        });
        logger.info(`Exited ITM Leg: ${leg.tradingSymbol}`);
        exitedLegs.push(leg.tradingSymbol);
      } else {
        logger.info(`Leg ${leg.tradingSymbol} is OTM. Leaving to expire.`);
      }
    }

    // Wait 2 seconds for order processing before fetching final P&L
    if (exitedLegs.length > 0) {
      const { sleep } = require('../utils/helpers');
      await sleep(2000);
    }

    // Fetch live P&L for record keeping
    try {
      const { getPublicIP } = require('../utils/helpers');
      const publicIP = await getPublicIP();

      const headers = {
        'Authorization': `Bearer ${jwtToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': '127.0.0.1',
        'X-ClientPublicIP': publicIP,
        'X-MACAddress': '02:00:00:00:00:00',
        'X-PrivateKey': process.env.ANGEL_API_KEY,
        'User-Agent': 'Mozilla/5.0'
      };

      const response = await axios.get('https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/getPosition', { headers });
      if (response.data.status === true && response.data.data) {
        const positions = response.data.data;
        // Filter positions belonging to the current monthly expiry
        const moment = require('moment-timezone');
        const expiryStr = await optionChain.getExpiryDate();
        const expiryTag = moment(expiryStr, 'DDMMMYYYY').format('DDMMMYY').toUpperCase();

        totalPnL = positions
          .filter(p => p.tradingsymbol.startsWith('NIFTY') && p.tradingsymbol.includes(expiryTag))
          .reduce((sum, p) => sum + parseFloat(p.pnl || 0), 0);

        logger.info(`Recorded Final Realized P&L for Monthly Expiry: ${totalPnL}`);
        
        // Save to history
        pnlTracker.savePnLRecord({
          expiryDate: expiryStr,
          totalPnL: totalPnL,
          spotAtExit: spotPrice,
          exitedLegs: exitedLegs
        });
      }
    } catch (pnlError) {
      logger.error('Could not fetch final P&L for record keeping:', pnlError.message);
    }

    logger.info('Final ITM exit check completed.');
  } catch (error) {
    logger.error('Error during final exit check:', error.message);
  }
}

module.exports = {
  runFinalExitCheck
};
