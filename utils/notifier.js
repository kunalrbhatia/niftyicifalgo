const axios = require('axios');
const logger = require('./logger');
const config = require('../config');

/**
 * Helper to convert simple HTML (<b>, <i>, <code>) to Slack mrkdwn
 * @param {string} html 
 * @returns {string}
 */
function htmlToMrkdwn(html) {
  if (!html) return '';
  return html
    .replace(/<b>(.*?)<\/b>/g, '*$1*')
    .replace(/<strong>(.*?)<\/strong>/g, '*$1*')
    .replace(/<i>(.*?)<\/i>/g, '_$1_')
    .replace(/<em>(.*?)<\/em>/g, '_$1_')
    .replace(/<code>(.*?)<\/code>/g, '`$1`');
}

/**
 * Send a message via Telegram Bot API
 * @param {string} message 
 */
async function sendTelegram(message) {
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
async function sendSlack(message) {
  const { webhookUrl } = config.notifications.slack;

  if (!webhookUrl) {
    logger.warn('Slack Webhook URL not found in config. Skipping message.');
    return;
  }

  const mrkdwnMessage = htmlToMrkdwn(message);

  try {
    await axios.post(webhookUrl, {
      text: mrkdwnMessage
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
    return await sendTelegram(message);
  }
  
  if (config.notifications.slack.enabled) {
    return await sendSlack(message);
  }

  logger.warn('No notification channel enabled in config.');
}

module.exports = {
  sendTelegram,
  sendSlack,
  notify,
  htmlToMrkdwn,
  // Aliases for backward compatibility if any
  sendTelegramMessage: sendTelegram,
  sendSlackMessage: sendSlack
};
