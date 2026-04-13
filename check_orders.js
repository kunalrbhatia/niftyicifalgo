const { login } = require('./modules/auth');
const axios = require('axios');
const logger = require('./utils/logger');
require('dotenv').config();

async function checkOrders() {
  try {
    console.log('Logging in to fetch order book...');
    const session = await login();
    const { jwtToken } = session;

    const headers = {
      'Authorization': `Bearer ${jwtToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-ClientLocalIP': '127.0.0.1',
      'X-ClientPublicIP': process.env.ANGEL_PUBLIC_IP || '103.160.108.203',
      'X-MACAddress': '02:00:00:00:00:00',
      'X-PrivateKey': process.env.ANGEL_API_KEY,
      'User-Agent': 'Mozilla/5.0'
    };

    const response = await axios.get('https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/getOrderBook', { headers });

    if (response.data.status === true) {
      const orders = response.data.data;
      console.log('--- Order Book (Today) ---');
      orders.filter(o => o.updatetime.includes('13-Apr-2026')).forEach(o => {
        console.log(`[${o.updatetime}] ${o.tradingsymbol} | ${o.transactiontype} | Qty: ${o.quantity} | Status: ${o.orderstatus} | Msg: ${o.text}`);
      });
    } else {
      console.error('Failed to fetch order book:', response.data.message);
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkOrders();
