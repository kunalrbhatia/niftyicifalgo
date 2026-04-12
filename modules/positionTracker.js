let state = {
  entryTime: null,
  expiryDate: null,
  adjusted: false,          // has wall been hit and adjustment done?
  wallHitSide: null,        // 'PUT' or 'CALL' or null
  legs: {
    sellPut:  null,
    buyPut:   null,
    sellCall: null,
    buyCall:  null,
  },
  netPremiumCollected: 0,
};

/**
 * Initialize the position state.
 * @param {Object} strikes 
 * @param {Object} orderIds 
 */
function initPosition(strikes, orderIds) {
  state.entryTime = new Date();
  state.legs.sellPut = { ...strikes.sellPut, transactionType: 'SELL', orderId: orderIds.sellPut, status: 'OPEN' };
  state.legs.buyPut = { ...strikes.buyPut, transactionType: 'BUY', orderId: orderIds.buyPut, status: 'OPEN' };
  state.legs.sellCall = { ...strikes.sellCall, transactionType: 'SELL', orderId: orderIds.sellCall, status: 'OPEN' };
  state.legs.buyCall = { ...strikes.buyCall, transactionType: 'BUY', orderId: orderIds.buyCall, status: 'OPEN' };
}

/**
 * Mark the position as adjusted.
 * @param {string} side - 'PUT' or 'CALL' (the side that was rolled)
 * @param {Object} newLeg - The new ATM leg information
 */
function markAdjusted(side, newLeg) {
  state.adjusted = true;
  state.wallHitSide = side === 'PUT' ? 'CALL' : 'PUT'; // If PUT wall was hit, CALL side was adjusted

  if (side === 'CALL') {
    // Old wing closed, new ATM leg added
    state.legs.buyCall.status = 'CLOSED';
    state.legs.newAtmCall = { ...newLeg, transactionType: 'SELL', status: 'OPEN' };
  } else {
    state.legs.buyPut.status = 'CLOSED';
    state.legs.newAtmPut = { ...newLeg, transactionType: 'SELL', status: 'OPEN' };
  }
}

/**
 * Get current position state.
 * @returns {Object}
 */
function getPosition() {
  return state;
}

/**
 * Update the status of a leg.
 * @param {string} legName 
 * @param {string} status 
 */
function updateLegStatus(legName, status) {
  if (state.legs[legName]) {
    state.legs[legName].status = status;
  }
}

module.exports = {
  initPosition,
  markAdjusted,
  getPosition,
  updateLegStatus
};
