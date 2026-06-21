const { getSetting, getUser } = require('./database');

function generateRefId(userId) {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 9000) + 1000;
  return `DEP-${userId}-${timestamp}-${random}`;
}

async function inrToUsdt(inrAmount) {
  const rate = parseFloat(await getSetting('usdt_to_inr_rate')) || 90;
  return Math.round((inrAmount / rate) * 100) / 100;
}

function formatDateTime(dtStr) {
  if (!dtStr) return 'N/A';
  try {
    const date = new Date(dtStr + (dtStr.includes('Z') ? '' : ' UTC'));
    return date.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata'
    });
  } catch {
    return dtStr;
  }
}

function getMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🛍️ Buy Products', callback_data: 'buy_product' },
        { text: '👤 My Profile', callback_data: 'profile' }
      ],
      [
        { text: '💰 Add Funds', callback_data: 'deposit' },
        { text: '🎁 Refer & Earn', callback_data: 'refer_earn' }
      ],
      [
        { text: '📞 Support', callback_data: 'support' }
      ]
    ]
  };
}

function getBackKeyboard(callbackData = 'main_menu') {
  return {
    inline_keyboard: [
      [{ text: '🏠 Back to Menu', callback_data: callbackData }]
    ]
  };
}

async function isUserBanned(userId) {
  const user = await getUser(userId);
  return user ? !!user.is_banned : false;
}

async function isUserRestricted(userId) {
  const user = await getUser(userId);
  return user ? !!user.is_restricted : false;
}

module.exports = {
  generateRefId,
  inrToUsdt,
  formatDateTime,
  getMainMenuKeyboard,
  getBackKeyboard,
  isUserBanned,
  isUserRestricted
};
