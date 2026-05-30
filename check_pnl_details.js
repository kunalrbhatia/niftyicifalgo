// check_pnl_details.js
const { login } = require('./modules/auth');
const { getPositions } = require('./utils/helpers');
require('dotenv').config();

async function run() {
  try {
    const session = await login();
    const { jwtToken } = session;
    const response = await getPositions(jwtToken);

    if (response.status === true && response.data) {
      const positions = response.data;
      const niftyPositions = positions.filter(p => p.tradingsymbol.startsWith('NIFTY') && parseInt(p.netqty) !== 0);

      if (niftyPositions.length === 0) {
        console.log('No active Nifty positions found.');
        return;
      }

      console.log('=== Active Nifty Position P&L Details ===');
      niftyPositions.forEach(p => {
        console.log(`Symbol: ${p.tradingsymbol}`);
        console.log(`Net Qty: ${p.netqty}`);
        console.log(`LTP: ${p.ltp}`);
        console.log(`Realised P&L: ₹${p.realised}`);
        console.log(`Unrealised P&L: ₹${p.unrealised}`);
        console.log(`Total P&L (pnl): ₹${p.pnl}`);
        console.log('---------------------------------------');
      });
    } else {
      console.error('Failed to retrieve positions:', response.message);
    }
  } catch (error) {
    console.error('Error during P&L check:', error.message);
  }
}

run();
