const axios = require('axios');
const { authenticator } = require('otplib');
const logger = require('../utils/logger');
require('dotenv').config();

/**
 * Authenticate with Angel One SmartAPI and return a valid session token.
 * @returns {Promise<{ jwtToken: string, feedToken: string, refreshToken: string }>}
 */
async function login() {
  try {
    const totp = authenticator.generate(process.env.ANGEL_TOTP_SECRET);
    
    const payload = {
      clientcode: process.env.ANGEL_CLIENT_ID,
      password: process.env.ANGEL_PASSWORD,
      totp: totp
    };

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-ClientLocalIP': '127.0.0.1',
      'X-ClientPublicIP': '106.193.147.98', // Use your server's public IP
      'X-MACAddress': '02:00:00:00:00:00', // Use your server's MAC address
      'X-PrivateKey': process.env.ANGEL_API_KEY
    };

    const response = await axios.post('https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword', payload, { headers });

    if (response.data.status === true) {
      const { jwtToken, feedToken, refreshToken } = response.data.data;
      return { jwtToken, feedToken, refreshToken };
    } else {
      throw new Error(`Login failed: ${response.data.message}`);
    }
  } catch (error) {
    logger.error('Error during SmartAPI login:', error.message);
    throw error;
  }
}

module.exports = {
  login
};
