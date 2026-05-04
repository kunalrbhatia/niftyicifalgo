const { login } = require('./modules/auth');
const axios = require('axios');
const { getPublicIP } = require('./utils/helpers');
require('dotenv').config();

async function checkPositions() {
  try {
    const session = await login();
    const { jwtToken } = session;

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

    if (response.data.status === true) {
      const positions = response.data.data;
      console.log('--- Current Positions ---');
      if (!positions) {
          console.log('No open positions found.');
          return;
      }
      positions.forEach(p => {
        if (parseInt(p.netqty) !== 0) {
            console.log(`${p.tradingsymbol} | Net Qty: ${p.netqty} | LTP: ${p.ltp}`);
        }
      });
    } else {
      console.error('Failed to fetch positions:', response.data.message);
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkPositions();
