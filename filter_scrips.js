const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');

const MASTER_URL = 'https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json';
const OUTPUT_FILE = path.join(__dirname, 'scrip_master.json');

async function downloadAndFilterScrips() {
  try {
    logger.info('Starting Scrip Master update...');
    logger.info(`Fetching latest scrip master from ${MASTER_URL}`);

    const response = await axios.get(MASTER_URL, { timeout: 60000 }); // 60s timeout for large file
    
    if (!Array.isArray(response.data)) {
      throw new Error('Invalid response format from Angel One Scrip Master');
    }

    logger.info(`Total scrips received: ${response.data.length}`);

    // Filter for NIFTY and NFO (NSE Futures & Options)
    // We filter for NIFTY because this algo is specifically for NIFTY Iron Condor
    const filteredScrips = response.data.filter(scrip => 
      scrip.exch_seg === 'NFO' && 
      scrip.name === 'NIFTY'
    );

    logger.info(`Filtered NIFTY NFO scrips: ${filteredScrips.length}`);

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(filteredScrips, null, 2));
    logger.info(`Scrip master updated successfully! Saved to ${OUTPUT_FILE}`);
    return true;

  } catch (error) {
    logger.error('Error updating scrip master:', error);
    return false;
  }
}

// Only execute if called directly from node
if (require.main === module) {
  downloadAndFilterScrips().then(success => {
    if (!success) process.exit(1);
  });
}

module.exports = {
  downloadAndFilterScrips
};
