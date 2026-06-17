const axios = require('axios');
const logger = require('./logger');
const config = require('../config');

/**
 * Send a message via Telegram Bot API
 * @param {string} message 
 */
async function sendTelegramMessage(message) {
  const { token, chatId } = config.notifications.telegram;

  if (!token || !chatId) {
    logger.warn('Telegram credentials not found in config. Skipping message.');
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

/**
 * Send a message via Slack Webhook
 * @param {string} message 
 */
async function sendSlackMessage(message) {
  const { webhookUrl } = config.notifications.slack;

  if (!webhookUrl) {
    logger.warn('Slack Webhook URL not found in config. Skipping message.');
    return;
  }

  try {
    await axios.post(webhookUrl, {
      text: message
    });
    logger.info('Slack message sent successfully.');
  } catch (error) {
    const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    logger.error(`Error sending Slack message: ${errorDetails}`, error);
  }
}

/**
 * Unified notification function
 * Picks channel based on config priority (Telegram > Slack)
 * @param {string} message 
 */
async function notify(message) {
  if (config.notifications.telegram.enabled) {
    await sendTelegramMessage(message);
  } else if (config.notifications.slack.enabled) {
    await sendSlackMessage(message);
  } else {
    logger.warn('No notification channel enabled in config.');
  }
}

module.exports = {
  sendTelegramMessage,
  sendSlackMessage,
  notify
};
