const winston = require('winston');
const path = require('path');
require('dotenv').config();

const logFormat = winston.format.printf(({ timestamp, level, message, ...metadata }) => {
  let msg = `${timestamp} [${level}] : ${message} `;
  if (Object.keys(metadata).length > 0) {
    msg += JSON.stringify(metadata);
  }
  return msg;
});

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.colorize(),
    logFormat
  ),
  transports: [
    new winston.transports.Console({ level: 'info' }),
    new winston.transports.File({ 
      filename: path.join(__dirname, '../logs', `algo-${new Date().toISOString().split('T')[0]}.log`),
      level: 'debug'
    })
  ]
});

module.exports = logger;
