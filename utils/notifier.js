const axios = require('axios');
const logger = require('./logger');
require('dotenv').config();

/**
 * Send a message via Telegram Bot API
 * Requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env
 * @param {string} message 
 */
async function sendTelegramMessage(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    logger.warn('Telegram credentials not found in .env. Skipping message.');
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await axios.post(url, {
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML'
    });
    logger.info('Telegram message sent successfully.');
  } catch (error) {
    const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    logger.error(`Error sending Telegram message: ${errorDetails}`, error);
  }
}

module.exports = {
  sendTelegramMessage
};
