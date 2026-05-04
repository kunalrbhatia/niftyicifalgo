const axios = require('axios');
const moment = require('moment-timezone');
const { calculateDelta, roundToNearestStrike, getPublicIP } = require('./utils/helpers');
const { getLastSixExpiries } = require('./utils/backtest_utils');
const logger = require('./utils/logger');
require('dotenv').config();

const BASE_URL = 'https://apiconnect.angelone.in';

const commonHeaders = (jwtToken, publicIP) => ({
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
});

// Black-Scholes constants
const R = 0.065; // 6.5% risk-free rate
const IV = 0.15; // 15% IV default for approximation

function normalCDF(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (x > 0) return 1 - prob;
  return prob;
}

function calculatePremium(type, S, K, T, r, sigma) {
  if (T <= 0) return Math.max(0, type === 'CE' ? S - K : K - S);
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  if (type === 'CE') {
    return S * normalCDF(d1) - K * Math.exp(-r * T) * normalCDF(d2);
  } else {
    return K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
  }
}

async function getHistoricalCandles(jwtToken, publicIP, date) {
  const payload = {
    exchange: 'NSE',
    symboltoken: '99926000', // NIFTY 50 INDEX
    interval: 'ONE_MINUTE',
    fromdate: `${date} 09:15`,
    todate: `${date} 15:30`
  };

  const response = await axios.post(`${BASE_URL}/rest/secure/angelbroking/historical/v1/getCandleData`, payload, { headers: commonHeaders(jwtToken, publicIP) });
  if (response.data.status === true) {
    return response.data.data; // [timestamp, O, H, L, C, V]
  } else {
    throw new Error(`Failed to fetch candles for ${date}: ${response.data.message}`);
  }
}

function findBacktestStrikes(spot, tInYears) {
    // We iterate through strikes every 50 points to find closest to target delta
    const strikes = [];
    const baseStrike = Math.round(spot / 50) * 50;
    for (let s = baseStrike - 1000; s <= baseStrike + 1000; s += 50) {
        const pDelta = calculateDelta('PE', spot, s, tInYears, R, IV);
        const cDelta = calculateDelta('CE', spot, s, tInYears, R, IV);
        strikes.push({ strike: s, pDelta, cDelta });
    }

    const sellPut = strikes.reduce((prev, curr) => Math.abs(curr.pDelta + 0.25) < Math.abs(prev.pDelta + 0.25) ? curr : prev);
    const buyPut = strikes.filter(s => s.strike < sellPut.strike).reduce((prev, curr) => Math.abs(curr.pDelta + 0.17) < Math.abs(prev.pDelta + 0.17) ? curr : prev);
    const sellCall = strikes.reduce((prev, curr) => Math.abs(curr.cDelta - 0.25) < Math.abs(prev.cDelta - 0.25) ? curr : prev);
    const buyCall = strikes.filter(s => s.strike > sellCall.strike).reduce((prev, curr) => Math.abs(curr.cDelta - 0.17) < Math.abs(prev.cDelta - 0.17) ? curr : prev);

    return { sellPut, buyPut, sellCall, buyCall };
}

async function backtestDate(jwtToken, publicIP, date) {
    logger.info(`--- Backtesting Date: ${date} ---`);
    const candles = await getHistoricalCandles(jwtToken, publicIP, date);
    
    // 09:30 Entry
    const entryCandle = candles.find(c => c[0].includes('09:30'));
    if (!entryCandle) {
        logger.error(`No 09:30 candle found for ${date}`);
        return null;
    }
    const entrySpot = entryCandle[4]; // Close price
    const expiryTime = moment.tz(`${date} 15:30`, 'YYYY-MM-DD HH:mm', 'Asia/Kolkata');
    const entryTime = moment.tz(`${date} 09:30`, 'YYYY-MM-DD HH:mm', 'Asia/Kolkata');
    const tInYears = expiryTime.diff(entryTime, 'years', true);

    const strikes = findBacktestStrikes(entrySpot, tInYears);
    logger.info(`Entry Spot: ${entrySpot}`);
    logger.info(`Strikes: SP:${strikes.sellPut.strike} BP:${strikes.buyPut.strike} SC:${strikes.sellCall.strike} BC:${strikes.buyCall.strike}`);

    // Calculate Entry Premiums
    const epSP = calculatePremium('PE', entrySpot, strikes.sellPut.strike, tInYears, R, IV);
    const epBP = calculatePremium('PE', entrySpot, strikes.buyPut.strike, tInYears, R, IV);
    const epSC = calculatePremium('CE', entrySpot, strikes.sellCall.strike, tInYears, R, IV);
    const epBC = calculatePremium('CE', entrySpot, strikes.buyCall.strike, tInYears, R, IV);

    let netPremium = (epSP - epBP) + (epSC - epBC);
    logger.info(`Entry Premium: ${(epSP - epBP).toFixed(2)} (P) + ${(epSC - epBC).toFixed(2)} (C) = ${netPremium.toFixed(2)}`);

    let adjusted = false;
    let finalSpot = candles[candles.length - 1][4];
    let adjLeg = null;

    // Monitor
    for (const candle of candles) {
        const time = moment(candle[0]).tz('Asia/Kolkata');
        if (time.isBefore(entryTime)) continue;
        if (time.isAfter(moment.tz(`${date} 15:25`, 'YYYY-MM-DD HH:mm', 'Asia/Kolkata'))) break;

        const low = candle[3];
        const high = candle[2];

        // PUT Wall Hit
        if (!adjusted && low <= strikes.sellPut.strike) {
            adjusted = true;
            const hitTime = candle[0];
            const spotAtHit = strikes.sellPut.strike;
            const tLeft = expiryTime.diff(moment(hitTime), 'years', true);
            
            // Roll CALL side to ATM
            const exitBC = calculatePremium('CE', spotAtHit, strikes.buyCall.strike, tLeft, R, IV);
            const atmStrike = roundToNearestStrike(spotAtHit);
            const entryATM = calculatePremium('CE', spotAtHit, atmStrike, tLeft, R, IV);
            
            netPremium = netPremium + (epBC - exitBC) + entryATM; // Premium increases because we sell more
            adjLeg = { type: 'CE', strike: atmStrike, entryPremium: entryATM };
            logger.info(`[${hitTime}] PUT Wall hit at ${low}. Rolling CALL side to ATM ${atmStrike}. New Net Premium: ${netPremium.toFixed(2)}`);
        }

        // CALL Wall Hit
        if (!adjusted && high >= strikes.sellCall.strike) {
            adjusted = true;
            const hitTime = candle[0];
            const spotAtHit = strikes.sellCall.strike;
            const tLeft = expiryTime.diff(moment(hitTime), 'years', true);
            
            // Roll PUT side to ATM
            const exitBP = calculatePremium('PE', spotAtHit, strikes.buyPut.strike, tLeft, R, IV);
            const atmStrike = roundToNearestStrike(spotAtHit);
            const entryATM = calculatePremium('PE', spotAtHit, atmStrike, tLeft, R, IV);
            
            netPremium = netPremium + (epBP - exitBP) + entryATM;
            adjLeg = { type: 'PE', strike: atmStrike, entryPremium: entryATM };
            logger.info(`[${hitTime}] CALL Wall hit at ${high}. Rolling PUT side to ATM ${atmStrike}. New Net Premium: ${netPremium.toFixed(2)}`);
        }
    }

    // Settlement at 15:30 (Exit everything)
    // Nifty options settle based on the 3:30 PM closing price of the index
    const settlementCandle = candles.find(c => c[0].includes('15:30')) || candles[candles.length - 1];
    finalSpot = settlementCandle[4];
    logger.info(`Final Settlement Spot at 15:30: ${finalSpot}`);

    const paySP = Math.max(0, strikes.sellPut.strike - finalSpot);
    const payBP = Math.max(0, strikes.buyPut.strike - finalSpot);
    const paySC = Math.max(0, finalSpot - strikes.sellCall.strike);
    const payBC = adjusted && adjLeg.type === 'PE' ? 0 : Math.max(0, finalSpot - strikes.buyCall.strike);
    
    // Correct Exit Logic based on adjustment
    let exitCost = 0;
    if (!adjusted) {
        exitCost = paySP - payBP + paySC - payBC;
    } else {
        if (adjLeg.type === 'CE') { // PUT Wall hit, CALL side rolled
            const payAdj = Math.max(0, finalSpot - adjLeg.strike);
            exitCost = paySP - payBP + paySC + payAdj; 
        } else { // CALL Wall hit, PUT side rolled
            const payAdj = Math.max(0, adjLeg.strike - finalSpot);
            exitCost = payAdj + paySC - payBC + paySP; 
        }
    }

    const slippagePerLeg = 0.5; // 0.5 points slippage per leg entry/exit
    const totalSlippage = adjusted ? 5 * slippagePerLeg : 4 * slippagePerLeg; 

    const pnl = netPremium - exitCost - totalSlippage;
    const points = pnl;
    const lotSize = 50; 
    const finalPnl = points * lotSize * 2; 

    logger.info(`Net Premium Collected: ${netPremium.toFixed(2)}`);
    logger.info(`Exit Intrinsic Value Cost: ${exitCost.toFixed(2)}`);
    logger.info(`Slippage: ${totalSlippage.toFixed(2)} points`);
    logger.info(`P&L per qty: ${points.toFixed(2)} points`);
    logger.info(`Total P&L (2 lots): ₹${finalPnl.toLocaleString()}`);

    return { date, points, pnl: finalPnl, adjusted };
}

async function runBacktest() {
    const jwtToken = process.argv[2];
    if (!jwtToken) {
        console.error('Usage: node backtest.js <jwtToken>');
        process.exit(1);
    }

    const publicIP = await getPublicIP();
    const expiries = getLastSixExpiries();
    const results = [];

    for (const date of expiries) {
        try {
            const res = await backtestDate(jwtToken, publicIP, date);
            if (res) results.push(res);
        } catch (e) {
            logger.error(`Error backtesting ${date}: ${e.message}`);
        }
    }

    console.log('\n================================================');
    console.log('         BACKTEST SUMMARY (LAST 6 MONTHS)       ');
    console.log('================================================');
    let totalPnl = 0;
    let wins = 0;
    let adjustments = 0;

    results.forEach(r => {
        totalPnl += r.pnl;
        if (r.pnl > 0) wins++;
        if (r.adjusted) adjustments++;
        console.log(`${r.date}: ${r.pnl >= 0 ? '✅' : '❌'} ₹${r.pnl.toLocaleString().padStart(10)} | Points: ${r.points.toFixed(2).padStart(7)} | Adjusted: ${r.adjusted ? 'YES' : 'NO'}`);
    });

    console.log('------------------------------------------------');
    console.log(`Total Net P&L: ₹${totalPnl.toLocaleString()}`);
    console.log(`Win Rate: ${((wins / results.length) * 100).toFixed(1)}% (${wins}/${results.length})`);
    console.log(`Adjustments Triggered: ${adjustments}`);
    console.log('================================================');
}

runBacktest();
