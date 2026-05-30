const axios = require('axios');
const { generateSync, createGuardrails } = require('otplib');
const logger = require('../utils/logger');
const { getPublicIP } = require('../utils/helpers');
require('dotenv').config();

/**
 * Authenticate with Angel One SmartAPI and return a valid session token.
 * @returns {Promise<{ jwtToken: string, feedToken: string, refreshToken: string }>}
 */
async function login() {
  try {
    const secret = process.env.ANGEL_TOTP_SECRET;
    // Base32 16 chars = 10 bytes. otplib v13 defaults to 16 bytes min.
    // We adjust guardrails to allow common broker secret lengths.
    const token = generateSync({ 
      secret,
      guardrails: createGuardrails({
        MIN_SECRET_BYTES: Math.min(10, secret.length) 
      })
    });
    
    const payload = {
      clientcode: process.env.ANGEL_CLIENT_ID,
      password: process.env.ANGEL_PASSWORD,
      totp: token
    };

    const publicIP = await getPublicIP();

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-ClientLocalIP': '127.0.0.1',
      'X-ClientPublicIP': publicIP,
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
    logger.error(`Error during SmartAPI login: ${error.message}`, error);
    throw error;
  }
}

module.exports = {
  login
};
