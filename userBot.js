const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const db = require('./database');
const utils = require('./utils');

const bot = new TelegramBot(config.USER_BOT_TOKEN, { polling: true });

const userState = {};

function getState(userId) {
  if (!userState[userId]) {
    userState[userId] = {};
  }
  return userState[userId];
}

function clearState(userId) {
  userState[userId] = {};
}

// ─── /start ───────────────────────────────────────────────────────────────────
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const userId = msg.from.id;
  const username = msg.from.username || '';
  const firstName = msg.from.first_name || '';
  const lastName = msg.from.last_name || '';
  const fullName = (firstName + ' ' + lastName).trim();

  const banned = await utils.isUserBanned(userId);
  if (banned) {
    await bot.sendMessage(userId,
      '🚫 Your account has been suspended.\n\nContact support if you think this is an error.'
    );
    return;
  }

  let referredBy = null;
  const arg = match && match[1];
  if (arg && arg.startsWith('ref_')) {
    const refUid = parseInt(arg.replace('ref_', ''));
    if (refUid && refUid !== userId) referredBy = refUid;
  }

  let dbUser = await db.getUser(userId);
  if (!dbUser) {
    await db.createUser(userId, username, fullName, referredBy);
    dbUser = await db.getUser(userId);
  }

  if (!dbUser.terms_accepted) {
    await sendTermsMessage(userId);
    return;
  }

  clearState(userId);
  await showMainMenu(userId);
});

// ─── Terms Message ────────────────────────────────────────────────────────────
async function sendTermsMessage(userId) {
  const groupLink = await db.getSetting('group_link') || config.GROUP_LINK;
  const channelLink = await db.getSetting('channel_link') || config.CHANNEL_LINK;
  const botName = await db.getSetting('bot_name') || config.BOT_NAME;

  const text =
    `👋 *Welcome to ${botName}!*\n\n` +
    `Before you begin, please complete these 2 steps:\n\n` +
    `*Step 1 — Read Our Rules:*\n` +
    `• Products are sold as-is — keep your files secure\n` +
    `• Login one account at a time, wait 2–3 min between each\n` +
    `• No spam or mass messaging — misuse may freeze accounts\n` +
    `• Failed OTPs are auto-refunded to your wallet\n` +
    `• One account per person — fake referrals void rewards\n\n` +
    `*Step 2 — Join Our Community:*\n` +
    `Tap the buttons below to join, then accept terms.`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '📢 Join Channel', url: channelLink },
        { text: '👥 Join Group', url: groupLink }
      ],
      [{ text: '📋 View & Accept Terms', callback_data: 'show_terms' }]
    ]
  };

  await bot.sendMessage(userId, text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
}

// ─── Terms Detail ─────────────────────────────────────────────────────────────
async function sendTermsDetail(userId, messageId) {
  const text =
    `📋 *Terms & Conditions*\n\n` +
    `By using this bot, you agree to the following:\n\n` +
    `🔒 *Products:* Sold as-is. Keep files secure, never share.\n\n` +
    `⏰ *Usage:* One account at a time. Wait 2–3 mins between logins.\n\n` +
    `🚫 *Abuse:* No spam or mass messaging. Misuse is your responsibility.\n\n` +
    `💰 *Refunds:* Only as described at purchase. Failed OTPs are auto-refunded.\n\n` +
    `🎁 *Referrals:* One genuine account per person. Fake referrals void all rewards.\n\n` +
    `Do you accept these terms?`;

  await bot.editMessageText(text, {
    chat_id: userId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '✅ I Accept — Continue', callback_data: 'accept_terms' }],
        [{ text: '❌ Decline', callback_data: 'decline_terms' }]
      ]
    }
  });
}

// ─── Main Menu ────────────────────────────────────────────────────────────────
async function showMainMenu(userId, messageId) {
  const refEnabled = await db.getSetting('referral_enabled') === '1';
  const refReward = await db.getSetting('referral_reward_inr') || '10';
  const me = await bot.getMe();
  const refLink = `https://t.me/${me.username}?start=ref_${userId}`;

  let text = `🏠 *Main Menu*\n\nSelect an option below to get started.`;

  if (refEnabled) {
    text =
      `🎁 *Earn While You Share!*\n` +
      `Invite friends and earn *Rs ${refReward}* per successful referral.\n` +
      `🔗 Your Link: \`${refLink}\`\n\n` +
      `🏠 *Main Menu* — Select an option:`;
  }

  const keyboard = utils.getMainMenuKeyboard();

  if (messageId) {
    try {
      await bot.editMessageText(text, {
        chat_id: userId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } catch {
      await bot.sendMessage(userId, text, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    }
  } else {
    await bot.sendMessage(userId, text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }
}

// ─── Callback Handler ─────────────────────────────────────────────────────────
bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  const data = query.data;
  const messageId = query.message.message_id;

  try { await bot.answerCallbackQuery(query.id); } catch {}

  const banned = await utils.isUserBanned(userId);
  if (banned) {
    await bot.sendMessage(userId, '🚫 Your account has been suspended.');
    return;
  }

  try {
    if (data === 'show_terms') {
      await sendTermsDetail(userId, messageId);

    } else if (data === 'accept_terms') {
      await handleAcceptTerms(userId, messageId);

    } else if (data === 'decline_terms') {
      await bot.editMessageText(
        '❌ You must accept the terms to use this bot.\n\nSend /start to try again.',
        { chat_id: userId, message_id: messageId }
      );

    } else if (data === 'main_menu') {
      await showMainMenu(userId, messageId);

    } else if (data === 'buy_product') {
      await showProducts(userId, messageId);

    } else if (data === 'profile') {
      await showProfile(userId, messageId);

    } else if (data === 'deposit') {
      await showDepositMenu(userId, messageId);

    } else if (data === 'refer_earn') {
      await showReferral(userId, messageId);

    } else if (data === 'support') {
      await showSupport(userId, messageId);

    } else if (data.startsWith('buy_item_')) {
      const productId = parseInt(data.replace('buy_item_', ''));
      await showPurchaseConfirm(userId, messageId, productId);

    } else if (data.startsWith('confirm_buy_')) {
      const productId = parseInt(data.replace('confirm_buy_', ''));
      await processPurchase(userId, messageId, productId);

    } else if (data === 'deposit_upi') {
      await showUpiOptions(userId, messageId);

    } else if (data === 'deposit_bnb') {
      await showBnbDeposit(userId, messageId);

    } else if (data.startsWith('upi_app_')) {
      const app = data.replace('upi_app_', '');
      const state = getState(userId);
      state.upiApp = app;
      await askDepositAmount(userId, messageId, app);

    } else if (data === 'i_have_paid') {
      await askPaymentScreenshot(userId, messageId);

    } else if (data === 'cancel_deposit') {
      clearState(userId);
      await bot.editMessageText('❌ Deposit cancelled.', {
        chat_id: userId,
        message_id: messageId,
        reply_markup: utils.getBackKeyboard()
      });
    }
  } catch (err) {
    console.error('UserBot callback error:', err.message);
  }
});

// ─── Accept Terms ─────────────────────────────────────────────────────────────
async function handleAcceptTerms(userId, messageId) {
  const database = await db.getDB();
  await database.run(
    'UPDATE users SET terms_accepted = 1 WHERE user_id = ?', userId
  );

  const dbUser = await db.getUser(userId);

  if (dbUser && dbUser.referred_by) {
    const refEnabled = await db.getSetting('referral_enabled') === '1';
    if (refEnabled) {
      const reward = parseFloat(await db.getSetting('referral_reward_inr')) || 10;
      await database.run(
        `UPDATE users 
         SET balance_inr = balance_inr + ?,
             referral_earned = referral_earned + ?,
             referral_count = referral_count + 1
         WHERE user_id = ?`,
        reward, reward, dbUser.referred_by
      );

      try {
        await bot.sendMessage(dbUser.referred_by,
          `🎁 *Referral Reward!*\n\n` +
          `Someone joined using your link!\n` +
          `✅ *Rs ${reward.toFixed(0)}* has been added to your wallet.`,
          { parse_mode: 'Markdown' }
        );
      } catch {}
    }
  }

  await bot.editMessageText(
    `✅ *Welcome aboard!*\n\nTerms accepted. You're all set!`,
    { chat_id: userId, message_id: messageId, parse_mode: 'Markdown' }
  );

  await showMainMenu(userId);
}

// ─── Products ─────────────────────────────────────────────────────────────────
async function showProducts(userId, messageId) {
  const products = await db.getActiveProducts();
  const rate = parseFloat(await db.getSetting('usdt_to_inr_rate')) || 90;

  if (!products.length) {
    await bot.editMessageText(
      `📦 *No Products Available*\n\nCheck back soon — new stock is being added.`,
      {
        chat_id: userId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: utils.getBackKeyboard()
      }
    );
    return;
  }

  let text = `🛍️ *Available Products*\n`;
  text += `💱 Rate: 1 USDT = Rs ${rate.toFixed(1)}\n\n`;

  const keyboard = [];

  for (const p of products) {
    const usdt = await utils.inrToUsdt(p.price_inr);
    text += `📦 *${p.name}*\n`;
    text += `   💰 Rs ${p.price_inr.toFixed(0)} ($${usdt.toFixed(2)})\n`;
    text += `   📊 Stock: ${p.stock} available\n\n`;

    keyboard.push([{
      text: `🛒 ${p.name} — Rs ${p.price_inr.toFixed(0)}`,
      callback_data: `buy_item_${p.id}`
    }]);
  }

  keyboard.push([{ text: '🏠 Back to Menu', callback_data: 'main_menu' }]);

  await bot.editMessageText(text, {
    chat_id: userId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
}

// ─── Purchase Confirm ─────────────────────────────────────────────────────────
async function showPurchaseConfirm(userId, messageId, productId) {
  const database = await db.getDB();
  const product = await database.get(
    'SELECT * FROM products WHERE id = ? AND is_active = 1', productId
  );

  if (!product) {
    await bot.editMessageText('❌ Product not found.',
      { chat_id: userId, message_id: messageId, reply_markup: utils.getBackKeyboard('buy_product') }
    );
    return;
  }

  const dbUser = await db.getUser(userId);
  const balance = dbUser.balance_inr;
  const price = product.price_inr;
  const usdtPrice = await utils.inrToUsdt(price);
  const usdtBalance = await utils.inrToUsdt(balance);

  const canBuy = balance >= price && product.stock > 0;
  const stockStatus = product.stock > 0 ? `✅ ${product.stock} in stock` : '❌ Out of stock';
  const balanceStatus = balance >= price ? '✅ Sufficient balance' : '⚠️ Insufficient balance';

  const text =
    `🛒 *Purchase Confirmation*\n\n` +
    `📦 *${product.name}*\n` +
    `${product.description || ''}\n\n` +
    `💰 *Price:* Rs ${price.toFixed(0)} ($${usdtPrice.toFixed(2)})\n` +
    `💵 *Your Balance:* Rs ${balance.toFixed(0)} ($${usdtBalance.toFixed(2)})\n` +
    `📊 *Stock:* ${stockStatus}\n` +
    `${balanceStatus}\n\n` +
    `⚠️ Please use Telegram X for best experience.\n` +
    `🚫 We are not responsible for any freeze/ban after delivery.`;

  const keyboard = [];
  if (canBuy) {
    keyboard.push([{ text: '✅ Confirm Purchase', callback_data: `confirm_buy_${productId}` }]);
  } else if (balance < price) {
    keyboard.push([{ text: '💰 Add Funds', callback_data: 'deposit' }]);
  }
  keyboard.push([
    { text: '« Back', callback_data: 'buy_product' },
    { text: '🏠 Menu', callback_data: 'main_menu' }
  ]);

  await bot.editMessageText(text, {
    chat_id: userId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
}

// ─── Process Purchase ─────────────────────────────────────────────────────────
async function processPurchase(userId, messageId, productId) {
  const database = await db.getDB();
  const product = await database.get(
    'SELECT * FROM products WHERE id = ? AND stock > 0 AND is_active = 1', productId
  );

  if (!product) {
    await bot.editMessageText('❌ Out of stock! Please choose another product.',
      { chat_id: userId, message_id: messageId, reply_markup: utils.getBackKeyboard('buy_product') }
    );
    return;
  }

  const dbUser = await db.getUser(userId);
  if (dbUser.balance_inr < product.price_inr) {
    await bot.editMessageText('❌ Insufficient balance. Please add funds first.',
      { chat_id: userId, message_id: messageId, reply_markup: utils.getBackKeyboard('deposit') }
    );
    return;
  }

  await db.deductUserBalance(userId, product.price_inr);

  await database.run(
    'UPDATE products SET stock = stock - 1, total_sold = total_sold + 1 WHERE id = ?',
    productId
  );

  await database.run(
    'INSERT INTO purchases (user_id, product_id, amount_inr, content_delivered) VALUES (?, ?, ?, ?)',
    userId, productId, product.price_inr, product.content
  );

  const text =
    `✅ *Purchase Successful!*\n\n` +
    `📦 *${product.name}*\n\n` +
    `*Your Product:*\n\`\`\`\n${product.content}\n\`\`\`\n\n` +
    `🔒 Keep this secure and do not share with anyone.\n` +
    `📞 Need help? Use the Support option in the menu.`;

  await bot.editMessageText(text, {
    chat_id: userId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: utils.getBackKeyboard()
  });
}

// ─── Profile ──────────────────────────────────────────────────────────────────
async function showProfile(userId, messageId) {
  const u = await db.getUser(userId);
  if (!u) return;

  const balanceUsdt = await utils.inrToUsdt(u.balance_inr);
  const depositedUsdt = await utils.inrToUsdt(u.total_deposited);
  const spentUsdt = await utils.inrToUsdt(u.total_spent);
  const earnedUsdt = await utils.inrToUsdt(u.referral_earned);
  const refReward = await db.getSetting('referral_reward_inr') || '10';
  const me = await bot.getMe();

  const text =
    `👤 *Your Profile*\n\n` +
    `*Account*\n` +
    `Name: ${u.full_name}\n` +
    `ID: \`${u.user_id}\`\n` +
    `Joined: ${utils.formatDateTime(u.joined_at)}\n\n` +
    `*💼 Wallet*\n` +
    `Balance: Rs ${u.balance_inr.toFixed(0)} ($${balanceUsdt.toFixed(2)})\n` +
    `Deposited: Rs ${u.total_deposited.toFixed(0)} ($${depositedUsdt.toFixed(2)})\n` +
    `Spent: Rs ${u.total_spent.toFixed(0)} ($${spentUsdt.toFixed(2)})\n` +
    `Purchases: ${u.total_purchases}\n\n` +
    `*🎁 Referrals*\n` +
    `Referrals: ${u.referral_count}\n` +
    `Earned: Rs ${u.referral_earned.toFixed(0)} ($${earnedUsdt.toFixed(2)})\n` +
    `Reward: Rs ${refReward} per referral\n\n` +
    `*🔗 Your Referral Link:*\n` +
    `\`https://t.me/${me.username}?start=ref_${userId}\``;

  await bot.editMessageText(text, {
    chat_id: userId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: utils.getBackKeyboard()
  });
}

// ─── Deposit Menu ─────────────────────────────────────────────────────────────
async function showDepositMenu(userId, messageId) {
  const upiOn = await db.getSetting('upi_enabled') === '1';
  const bnbOn = await db.getSetting('bnb_enabled') === '1';
  const fampayOn = await db.getSetting('fampay_enabled') === '1';
  const minDep = await db.getSetting('min_deposit_inr') || '20';

  const keyboard = [];

  if (upiOn || fampayOn) {
    keyboard.push([{ text: '📱 UPI Payment', callback_data: 'deposit_upi' }]);
  }
  if (bnbOn) {
    keyboard.push([{ text: '🟡 USDT via BNB Smart Chain (BEP20)', callback_data: 'deposit_bnb' }]);
  }

  if (keyboard.length === 0) {
    await bot.editMessageText(
      `⚠️ *No Payment Methods Available*\n\nPlease contact support for assistance.`,
      {
        chat_id: userId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: utils.getBackKeyboard()
      }
    );
    return;
  }

  keyboard.push([{ text: '🏠 Back to Menu', callback_data: 'main_menu' }]);

  await bot.editMessageText(
    `💰 *Add Funds*\n\n` +
    `Minimum deposit: *Rs ${minDep}*\n\n` +
    `Select your payment method:`,
    {
      chat_id: userId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    }
  );
}

// ─── UPI Options ──────────────────────────────────────────────────────────────
async function showUpiOptions(userId, messageId) {
  const minDep = await db.getSetting('min_deposit_inr') || '20';

  const text =
    `📱 *UPI Payment*\n\n` +
    `✅ Minimum: Rs ${minDep}\n` +
    `⚠️ Deposit is manually verified after screenshot submission.\n\n` +
    `*Select your UPI app:*`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '📱 GPay', callback_data: 'upi_app_gpay' },
        { text: '💳 FamPay', callback_data: 'upi_app_fampay' },
        { text: '📲 Any UPI', callback_data: 'upi_app_any' }
      ],
      [{ text: '« Back', callback_data: 'deposit' }]
    ]
  };

  await bot.editMessageText(text, {
    chat_id: userId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
}

// ─── Ask Deposit Amount ───────────────────────────────────────────────────────
async function askDepositAmount(userId, messageId, upiApp) {
  const minDep = await db.getSetting('min_deposit_inr') || '20';
  const appNames = { gpay: 'GPay', fampay: 'FamPay', any: 'Any UPI' };
  const appName = appNames[upiApp] || 'UPI';

  const state = getState(userId);
  state.waitingDepositAmount = true;
  state.upiApp = upiApp;

  const text =
    `📱 *${appName} Payment*\n\n` +
    `Minimum amount: *Rs ${minDep}*\n\n` +
    `Please type the amount you want to deposit (in Rs):`;

  await bot.editMessageText(text, {
    chat_id: userId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[{ text: '« Back', callback_data: 'deposit_upi' }]]
    }
  });
}

// ─── Show QR & Payment Details ────────────────────────────────────────────────
async function showQrAndPaymentDetails(userId, amount, upiApp) {
  const state = getState(userId);
  const refId = utils.generateRefId(userId);
  state.pendingRefId = refId;
  state.pendingAmount = amount;

  const appNames = { gpay: 'GPay', fampay: 'FamPay', any: 'Any UPI' };
  const appName = appNames[upiApp] || 'UPI';

  const qrKey = `qr_${upiApp}`;
  const qrFileId = await db.getSetting(qrKey);
  const upiId = await db.getSetting('upi_id');
  const upiTextId = await db.getSetting('upi_text_id');

  let text =
    `📱 *${appName} Payment*\n\n` +
    `💰 *Amount: Rs ${amount}*\n` +
    `📝 *Reference ID:* \`${refId}\`\n\n`;

  if (upiTextId) {
    text += `🆔 *Pay to UPI ID:* \`${upiTextId}\`\n`;
  } else if (upiId) {
    text += `🆔 *Pay to UPI ID:* \`${upiId}\`\n`;
  }

  text +=
    `\n*Instructions:*\n` +
    `1. Pay exactly Rs ${amount}\n` +
    `2. Use Reference ID as payment note/remark\n` +
    `3. Take a screenshot of the payment confirmation\n` +
    `4. Click "I Have Paid" and send the screenshot\n\n` +
    `⏱️ Approval is typically within 15–30 minutes.`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '✅ I Have Paid — Send Screenshot', callback_data: 'i_have_paid' }],
      [{ text: '❌ Cancel', callback_data: 'cancel_deposit' }]
    ]
  };

  if (qrFileId) {
    await bot.sendPhoto(userId, qrFileId, {
      caption: text,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  } else {
    await bot.sendMessage(userId, text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }
}

// ─── Ask Payment Screenshot ───────────────────────────────────────────────────
async function askPaymentScreenshot(userId, messageId) {
  const state = getState(userId);
  state.waitingScreenshot = true;

  try {
    await bot.editMessageText(
      `📸 *Send Payment Screenshot*\n\n` +
      `Please send the screenshot of your payment confirmation now.\n\n` +
      `Reference ID: \`${state.pendingRefId || 'N/A'}\``,
      {
        chat_id: userId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'cancel_deposit' }]]
        }
      }
    );
  } catch {
    await bot.sendMessage(userId,
      `📸 *Send Payment Screenshot*\n\nPlease send your payment screenshot now.`,
      { parse_mode: 'Markdown' }
    );
  }
}

// ─── BNB Deposit ──────────────────────────────────────────────────────────────
async function showBnbDeposit(userId, messageId) {
  const bnbAddress = await db.getSetting('bnb_address') || 'Address not configured';
  const refId = utils.generateRefId(userId);
  const qrFileId = await db.getSetting('qr_bnb');

  const text =
    `🟡 *USDT Deposit (BNB Smart Chain / BEP20)*\n\n` +
    `Send *USDT (BEP20)* to this address:\n` +
    `\`${bnbAddress}\`\n\n` +
    `📝 *Your Ref ID:* \`${refId}\`\n\n` +
    `⚠️ *Important:*\n` +
    `• Send only USDT on BEP20 network\n` +
    `• Include Ref ID in transaction memo if possible\n` +
    `• Balance added after blockchain confirmation\n` +
    `• Contact support with Ref ID after sending`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '📞 Contact Support', callback_data: 'support' }],
      [{ text: '« Back', callback_data: 'deposit' }]
    ]
  };

  if (qrFileId) {
    await bot.editMessageText('Loading...', { chat_id: userId, message_id: messageId });
    await bot.sendPhoto(userId, qrFileId, {
      caption: text,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  } else {
    await bot.editMessageText(text, {
      chat_id: userId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }
}

// ─── Referral ─────────────────────────────────────────────────────────────────
async function showReferral(userId, messageId) {
  const refEnabled = await db.getSetting('referral_enabled') === '1';

  if (!refEnabled) {
    await bot.editMessageText(
      `🎁 *Referral Program*\n\nCurrently disabled. Check back soon!`,
      {
        chat_id: userId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: utils.getBackKeyboard()
      }
    );
    return;
  }

  const u = await db.getUser(userId);
  const refReward = await db.getSetting('referral_reward_inr') || '10';
  const earnedUsdt = await utils.inrToUsdt(u.referral_earned);
  const me = await bot.getMe();
  const refLink = `https://t.me/${me.username}?start=ref_${userId}`;

  const text =
    `🎁 *Refer & Earn*\n\n` +
    `Earn *Rs ${refReward}* for every friend who joins using your link!\n\n` +
    `*Your Stats:*\n` +
    `👥 Referrals: ${u.referral_count}\n` +
    `💰 Total Earned: Rs ${u.referral_earned.toFixed(0)} ($${earnedUsdt.toFixed(2)})\n\n` +
    `*Your Referral Link:*\n` +
    `\`${refLink}\`\n\n` +
    `Share this link and earn when they join!`;

  await bot.editMessageText(text, {
    chat_id: userId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: utils.getBackKeyboard()
  });
}

// ─── Support ──────────────────────────────────────────────────────────────────
async function showSupport(userId, messageId) {
  const supportLink = await db.getSetting('support_link') || config.SUPPORT_LINK;

  const text =
    `📞 *Support*\n\n` +
    `Need help? Our support team is here for you.\n\n` +
    `*Before contacting support:*\n` +
    `• Check your Reference ID for deposits\n` +
    `• Wait 30 minutes for deposit approval\n` +
    `• Check the FAQ in our group\n\n` +
    `*Contact Support:*`;

  await bot.editMessageText(text, {
    chat_id: userId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '💬 Contact Support', url: supportLink }],
        [{ text: '🏠 Back to Menu', callback_data: 'main_menu' }]
      ]
    }
  });
}

// ─── Message Handler ──────────────────────────────────────────────────────────
bot.on('message', async (msg) => {
  if (msg.text && msg.text.startsWith('/')) return;
  if (msg.photo) {
    await handlePhotoMessage(msg);
    return;
  }
  if (!msg.text) return;

  const userId = msg.from.id;
  const text = msg.text.trim();
  const state = getState(userId);

  const commandMap = {
    'menu': 'main_menu',
    'start': 'main_menu',
    'buy': 'buy_product',
    'profile': 'profile',
    'deposit': 'deposit',
    'refer': 'refer_earn',
    'support': 'support'
  };

  const lower = text.toLowerCase();
  if (commandMap.hasOwnProperty(lower)) {
    await handleTextCommand(userId, commandMap[lower]);
    return;
  }

  if (state.waitingDepositAmount) {
    const amount = parseFloat(text);
    const minDep = parseFloat(await db.getSetting('min_deposit_inr')) || 20;

    if (isNaN(amount) || amount < minDep) {
      await bot.sendMessage(userId,
        `⚠️ Please enter a valid amount of at least *Rs ${minDep}*`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    state.waitingDepositAmount = false;
    await showQrAndPaymentDetails(userId, amount, state.upiApp);
    return;
  }

  const dbUser = await db.getUser(userId);
  if (!dbUser || !dbUser.terms_accepted) return;

  await bot.sendMessage(userId,
    `ℹ️ *This command is not recognized here.*\n\n` +
    `Please use the menu buttons to navigate.\n` +
    `Type /start to return to the main menu.`,
    { parse_mode: 'Markdown' }
  );
});

// ─── Handle Photo (Screenshot) ────────────────────────────────────────────────
async function handlePhotoMessage(msg) {
  const userId = msg.from.id;
  const state = getState(userId);

  if (!state.waitingScreenshot) {
    await bot.sendMessage(userId,
      `ℹ️ *Unexpected photo.*\n\nPlease use the menu to initiate a deposit first.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const fileId = msg.photo[msg.photo.length - 1].file_id;
  const refId = state.pendingRefId;
  const amount = state.pendingAmount;

  if (!refId || !amount) {
    await bot.sendMessage(userId,
      `❌ Session expired. Please start the deposit process again.`
    );
    clearState(userId);
    return;
  }

  const database = await db.getDB();
  const dbUser = await db.getUser(userId);

  await database.run(
    `INSERT OR IGNORE INTO deposits 
     (user_id, amount_inr, ref_id, method, screenshot_file_id, status) 
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    userId, amount, refId, state.upiApp || 'upi', fileId
  );

  clearState(userId);

  await bot.sendMessage(userId,
    `✅ *Payment Screenshot Received!*\n\n` +
    `📝 Ref ID: \`${refId}\`\n` +
    `💰 Amount: Rs ${amount}\n\n` +
    `Your payment is under review. Approval within *15–30 minutes*.\n` +
    `Keep your Ref ID safe for any queries.`,
    { parse_mode: 'Markdown' }
  );

  // ✅ FIX: Admin Bot Token se send ho raha hai — User Bot se nahi
  try {
    const adminCaption =
      `📥 *New Deposit Request*\n\n` +
      `👤 *User:* ${dbUser.full_name} (@${dbUser.username || 'N/A'})\n` +
      `🆔 *User ID:* \`${userId}\`\n` +
      `💰 *Amount:* Rs ${amount}\n` +
      `📝 *Ref ID:* \`${refId}\`\n` +
      `📱 *Method:* ${state.upiApp || 'UPI'}\n` +
      `🕐 *Time:* ${utils.formatDateTime(new Date().toISOString())}`;

    const adminKeyboard = {
      inline_keyboard: [
        [
          { text: `✅ Approve Rs ${amount}`, callback_data: `adm_approve_${refId}` },
          { text: '❌ Reject', callback_data: `adm_reject_${refId}` }
        ],
        [{ text: `💬 Message User`, callback_data: `adm_msg_${userId}` }]
      ]
    };

    // ✅ FIXED: Admin Bot Token use ho raha hai fetch se
    const adminApiUrl = `https://api.telegram.org/bot${config.ADMIN_BOT_TOKEN}/sendPhoto`;
    await fetch(adminApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.OWNER_ID,
        photo: fileId,
        caption: adminCaption,
        parse_mode: 'Markdown',
        reply_markup: adminKeyboard
      })
    });

  } catch (err) {
    console.error('Failed to notify admin:', err.message);
  }
}

// ─── Text Command Router ──────────────────────────────────────────────────────
async function handleTextCommand(userId, callbackData) {
  const banned = await utils.isUserBanned(userId);
  if (banned) return;

  const dbUser = await db.getUser(userId);
  if (!dbUser || !dbUser.terms_accepted) {
    await sendTermsMessage(userId);
    return;
  }

  if (callbackData === 'main_menu') await showMainMenu(userId);
  else if (callbackData === 'buy_product') {
    const msg = await bot.sendMessage(userId, '⏳ Loading...');
    await showProducts(userId, msg.message_id);
  }
  else if (callbackData === 'profile') {
    const msg = await bot.sendMessage(userId, '⏳ Loading...');
    await showProfile(userId, msg.message_id);
  }
  else if (callbackData === 'deposit') {
    const msg = await bot.sendMessage(userId, '⏳ Loading...');
    await showDepositMenu(userId, msg.message_id);
  }
  else if (callbackData === 'refer_earn') {
    const msg = await bot.sendMessage(userId, '⏳ Loading...');
    await showReferral(userId, msg.message_id);
  }
  else if (callbackData === 'support') {
    const msg = await bot.sendMessage(userId, '⏳ Loading...');
    await showSupport(userId, msg.message_id);
  }
}

module.exports = { bot };
