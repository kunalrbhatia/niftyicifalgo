const winston = require('winston');
const path = require('path');
require('dotenv').config();

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }), // handle error objects
    winston.format.splat(),
    winston.format.json() // use json for better structure
  ),
  transports: [
    new winston.transports.Console({ 
      level: 'info',
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, stack }) => {
          return `${timestamp} [${level}] : ${stack || message}`;
        })
      )
    }),
    new winston.transports.File({ 
      filename: path.join(__dirname, '../logs', `algo-${new Date().toISOString().split('T')[0]}.log`),
      level: 'debug'
    })
  ]
});

module.exports = logger;
