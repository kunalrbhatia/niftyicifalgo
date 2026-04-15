const { login } = require('./modules/auth');
const axios = require('axios');
require('dotenv').config();

const BASE_URL = 'https://apiconnect.angelone.in';

async function run() {
    try {
        console.log('Logging in...');
        const session = await login();
        const jwtToken = session.jwtToken;
        console.log('Login successful.');

        const commonHeaders = {
            'Authorization': `Bearer ${jwtToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-UserType': 'USER',
            'X-SourceID': 'WEB',
            'X-ClientLocalIP': '127.0.0.1',
            'X-ClientPublicIP': process.env.ANGEL_PUBLIC_IP || '103.160.108.203',
            'X-MACAddress': '02:00:00:00:00:00',
            'X-PrivateKey': process.env.ANGEL_API_KEY,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        };

        async function test(name, expiryDate) {
            console.log(`Testing with name: ${name}, expiryDate: ${expiryDate}`);
            try {
                const response = await axios.post(`${BASE_URL}/rest/secure/angelbroking/marketData/v1/optionGreeks`, 
                    { name, expiryDate }, 
                    { headers: commonHeaders }
                );
                console.log('Status:', response.data.status);
                console.log('Message:', response.data.message);
                if (response.data.data) console.log('Data count:', response.data.data.length);
            } catch (e) {
                console.error('Error:', e.message);
                if (e.response) console.log('Response:', e.response.data);
            }
        }

        await test('NIFTY', '13APR2026');
        await test('NIFTY', '16APR2026');
        await test('Nifty 50', '13APR2026');

    } catch (err) {
        console.error('Fatal error:', err.message);
    }
}

run();
