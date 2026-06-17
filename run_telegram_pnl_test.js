// run_telegram_pnl_test.js
const { login } = require('./modules/auth');
const { getPositions } = require('./utils/helpers');
const { getExpiryDate } = require('./modules/optionChain');
const { notify } = require('./utils/notifier');
const logger = require('./utils/logger');
const moment = require('moment-timezone');
require('dotenv').config();

async function run() {
  try {
    logger.info('Starting manual notification test (Telegram/Slack)...');
    const session = await login();
    const { jwtToken } = session;
    
    let summary = '🤖 <b>Nifty Algo Daily Summary (Test Run)</b>\n\n';
    summary += '📅 Trading Day (Normal)\n';
    summary += '🛡 Wall check: All good, no adjustment needed.\n';
    
    const data = await getPositions(jwtToken);
    if (data.status === true && data.data) {
      const positions = data.data;
      const expiryStr = await getExpiryDate(); // e.g. 30JUN2026
      const expiryTag = moment(expiryStr, 'DDMMMYYYY').format('DDMMMYY').toUpperCase(); // 30JUN26
      
      const relevant = positions.filter(p => 
        p.tradingsymbol.startsWith('NIFTY') && 
        p.tradingsymbol.includes(expiryTag) &&
        parseInt(p.netqty) !== 0
      );

      if (relevant.length > 0) {
        summary += '\n📊 <b>Active Monthly Nifty Positions P&L:</b>\n';
        relevant.forEach(p => {
          const qty = parseInt(p.netqty);
          const side = qty > 0 ? 'BUY' : 'SELL';
          const absQty = Math.abs(qty);
          const realised = parseFloat(p.realised || 0);
          const unrealised = parseFloat(p.unrealised || 0);
          const totalLegPnL = parseFloat(p.pnl || 0);
          
          summary += `\n▫️ <b>${p.tradingsymbol}</b> (${side} x ${absQty})\n`;
          summary += `   📍 <b>LTP:</b> ${p.ltp}\n`;
          summary += `   💵 <b>Realised P&L:</b> ₹${realised.toFixed(2)}\n`;
          summary += `   📈 <b>Unrealised P&L:</b> ₹${unrealised.toFixed(2)}\n`;
          summary += `   💰 <b>Net P&L:</b> ₹${totalLegPnL.toFixed(2)}\n`;
        });
      } else {
        summary += '\n📊 <b>Active Monthly Nifty Positions P&L:</b> None found.\n';
      }
    }
    
    summary += '\n✨ <b>Algo run completed successfully.</b>';
    
    console.log('--- Proposed Notification Message ---');
    console.log(summary);
    
    logger.info('Sending test notification...');
    await notify(summary);
    logger.info('Notification test completed!');
  } catch (error) {
    logger.error('Error in notification test:', error);
  }
}

run();
