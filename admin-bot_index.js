// admin-bot/index.js  ─ TgApiStore Admin Bot (v2 — Cloudflare Workers compatible structure)
// All new features:
//  ✅ Deposit approve request → full user details + screenshot + "Message User" button
//  ✅ Product buy → admin gets full details + "Message User" button
//  ✅ Broadcast to all users
//  ✅ Owner can see total user count
//  ✅ Colourful emoji buttons throughout
//  ✅ "Please wait for admin approval" flow on both deposit & buy

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const TelegramBot = require('node-telegram-bot-api');
const db          = require('../shared/db');
const { fmtUsd, fmtInr, fmtMoney, isValidPositiveInt, isValidPositiveNumber, escapeHtml } =
  require('../shared/helpers');

const TOKEN          = process.env.ADMIN_BOT_TOKEN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'hero.96';
const OWNER_ID       = process.env.OWNER_ID ? Number(process.env.OWNER_ID) : null;

if (!TOKEN)    { console.error('❌  Missing ADMIN_BOT_TOKEN in .env'); process.exit(1); }
if (!OWNER_ID) { console.error('❌  Missing OWNER_ID in .env');         process.exit(1); }

db.initDB();
db.ensureOwner(OWNER_ID);

const bot = new TelegramBot(TOKEN, { polling: true });
console.log('✅  Admin Bot started...');

// In-memory session state (resets on restart — fine for admin-only bot)
const verifiedSessions   = new Set();
const pendingPassword    = new Set();
const adminState         = {};   // { [userId]: { state, data } }

// ─── helpers ─────────────────────────────────────────────────────────────────
function isAuthorized(userId) {
  return db.isAdminOrOwner(userId) && verifiedSessions.has(userId);
}
function setAdminState(userId, state, data = {}) { adminState[userId] = { state, data }; }
function getAdminState(userId)                   { return adminState[userId] || null; }
function clearAdminState(userId)                 { delete adminState[userId]; }

// Cross-bot notifier (to send messages to USER bot users from admin bot)
const UserNotifier = process.env.BOT_TOKEN
  ? new TelegramBot(process.env.BOT_TOKEN, { polling: false })
  : null;

function notifyUser(userId, text) {
  if (!UserNotifier) return;
  UserNotifier.sendMessage(userId, text, { parse_mode: 'Markdown' }).catch(() => {});
}

// ─── MAIN PANEL KEYBOARD ─────────────────────────────────────────────────────
function mainPanelKeyboard(isOwner) {
  const rows = [
    [
      { text: '🟢 ➕ Add Product',       callback_data: 'a_add_product' },
      { text: '🟡 📦 Products',           callback_data: 'a_list_products' },
    ],
    [
      { text: '🟣 📊 Statistics',         callback_data: 'a_stats' },
      { text: '🔵 🔗 Link System',        callback_data: 'a_links' },
    ],
    [
      { text: '🟠 📁 Session Bookings',   callback_data: 'a_sessions' },
      { text: '🟡 🧾 Pending Deposits',   callback_data: 'a_deposits' },
    ],
    [
      { text: '🔴 🖼️ Upload QR Codes',   callback_data: 'a_qr' },
      { text: '🔴 🚫 Ban / Restrict',     callback_data: 'a_ban' },
    ],
    [
      { text: '🟢 👮 Manage Admins',      callback_data: 'a_manage_admins' },
    ],
  ];

  if (isOwner) {
    rows.push([
      { text: '📢 🔊 Broadcast Message',  callback_data: 'a_broadcast' },
      { text: '👥 View All Users',        callback_data: 'a_view_users' },
    ]);
  }

  return { inline_keyboard: rows };
}

function sendAdminPanel(chatId, userId) {
  const role    = db.isOwner(userId) ? 'Owner' : 'Admin';
  const isOwner = db.isOwner(userId);
  bot.sendMessage(chatId,
    `👋 *Welcome to Admin Panel*\n` +
    `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
    `Logged in as: *${role}*\n\n` +
    `Select an option below to manage the store:`,
    { parse_mode: 'Markdown', reply_markup: mainPanelKeyboard(isOwner) }
  );
}

// ─── /start ──────────────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!db.isAdminOrOwner(userId)) {
    return bot.sendMessage(chatId, '🚫 You are not authorized to use this bot.');
  }
  if (verifiedSessions.has(userId)) return sendAdminPanel(chatId, userId);

  pendingPassword.add(userId);
  bot.sendMessage(chatId, '🔐 *Admin Login*\n\nPlease enter the admin password:', { parse_mode: 'Markdown' });
});

// ─── /admin <user> ───────────────────────────────────────────────────────────
bot.onText(/\/admin\s+(.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!db.isOwner(userId)) return bot.sendMessage(chatId, '🚫 Only the Owner can add admins.');

  const target = match[1].trim().replace('@', '');
  if (/^\d+$/.test(target)) {
    db.addHiredAdmin(target, '', userId);
    bot.sendMessage(chatId, `✅ User ID \`${target}\` added as admin.`, { parse_mode: 'Markdown' });
  } else {
    db.addHiredAdmin(0, target, userId);
    bot.sendMessage(chatId, `✅ @${target} added as admin. They get access on first /start.`, { parse_mode: 'Markdown' });
  }
});

// ─── TEXT MESSAGE ROUTER ─────────────────────────────────────────────────────
bot.on('message', async (msg) => {
  if (!msg.text) return;
  if (msg.text.startsWith('/start') || msg.text.startsWith('/admin')) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  linkHiredAdminId(userId, msg.from.username);
  if (!db.isAdminOrOwner(userId)) return;

  // Password gate
  if (pendingPassword.has(userId) && !verifiedSessions.has(userId)) {
    if (msg.text.trim() === ADMIN_PASSWORD) {
      verifiedSessions.add(userId);
      pendingPassword.delete(userId);
      bot.sendMessage(chatId, '✅ Password correct! Access granted.');
      return sendAdminPanel(chatId, userId);
    }
    return bot.sendMessage(chatId, '❌ Incorrect password. Try again:');
  }

  if (!isAuthorized(userId)) {
    pendingPassword.add(userId);
    return bot.sendMessage(chatId, '🔐 Please enter the admin password:');
  }

  const state = getAdminState(userId);
  if (state) return handleAdminStateInput(chatId, userId, msg, state);
});

function linkHiredAdminId(userId, username) {
  if (!username) return;
  const admins = db.listHiredAdmins();
  const match  = admins.find(a => a.id === 0 && a.username.toLowerCase() === username.toLowerCase());
  if (match) {
    db.removeHiredAdmin(0);
    db.addHiredAdmin(userId, username, match.addedBy);
  }
}

// ─── PHOTO / DOCUMENT UPLOADS ────────────────────────────────────────────────
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!isAuthorized(userId)) return;
  const state  = getAdminState(userId);
  if (!state) return;

  const fileId = msg.photo[msg.photo.length - 1].file_id;

  if (state.state === 'awaiting_upi_qr') {
    db.updateSettings({ upiQrFileId: fileId });
    clearAdminState(userId);
    return bot.sendMessage(chatId, '✅ UPI QR code updated!', { reply_markup: mainPanelKeyboard(db.isOwner(userId)) });
  }
  if (state.state === 'awaiting_binance_qr') {
    db.updateSettings({ binanceQrFileId: fileId });
    clearAdminState(userId);
    return bot.sendMessage(chatId, '✅ Binance QR code updated!', { reply_markup: mainPanelKeyboard(db.isOwner(userId)) });
  }
  if (state.state === 'awaiting_product_delivery_file') {
    setAdminState(userId, 'awaiting_product_name', { ...state.data, deliveryType: 'auto-file', deliveryFileId: fileId });
    return bot.sendMessage(chatId, '✅ File saved. Now send the *product name*:', { parse_mode: 'Markdown' });
  }
});

bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!isAuthorized(userId)) return;
  const state  = getAdminState(userId);
  if (!state || state.state !== 'awaiting_product_delivery_file') return;
  setAdminState(userId, 'awaiting_product_name', { ...state.data, deliveryType: 'auto-file', deliveryFileId: msg.document.file_id });
  bot.sendMessage(chatId, '✅ File saved. Now send the *product name*:', { parse_mode: 'Markdown' });
});

// ─── CALLBACK QUERY ROUTER ───────────────────────────────────────────────────
bot.on('callback_query', async (query) => {
  const chatId    = query.message.chat.id;
  const userId    = query.from.id;
  const data      = query.data;
  const messageId = query.message.message_id;

  if (!isAuthorized(userId)) {
    return bot.answerCallbackQuery(query.id, { text: '🔐 Please /start and log in first.', show_alert: true });
  }

  try {
    // ── navigation ──────────────────────────────────────────────────────────
    if (data === 'a_back_main') {
      clearAdminState(userId);
      await bot.editMessageText('👋 *Admin Panel*\n\nSelect an option below:',
        { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: mainPanelKeyboard(db.isOwner(userId)) });

    // ── products ────────────────────────────────────────────────────────────
    } else if (data === 'a_add_product')            { startAddProduct(chatId, userId);
    } else if (data === 'a_list_products')           { sendProductList(chatId, userId);
    } else if (data.startsWith('a_prod_'))           { sendProductDetail(chatId, userId, data.replace('a_prod_', ''));
    } else if (data.startsWith('a_addmore_'))        { startAddStock(chatId, userId, data.replace('a_addmore_', ''));
    } else if (data.startsWith('a_delprod_'))        { confirmDeleteProduct(chatId, userId, data.replace('a_delprod_', ''));
    } else if (data.startsWith('a_delprodyes_'))     { doDeleteProduct(chatId, userId, data.replace('a_delprodyes_', ''));
    } else if (data.startsWith('a_toggle_'))         { toggleProductActive(chatId, userId, data.replace('a_toggle_', ''));

    // ── stats / links ────────────────────────────────────────────────────────
    } else if (data === 'a_stats')                   { sendStats(chatId);
    } else if (data === 'a_links')                   { sendLinksMenu(chatId);
    } else if (data === 'a_set_channel')             { promptLinkUpdate(chatId, userId, 'channelUrl',          'Channel URL');
    } else if (data === 'a_set_group')               { promptLinkUpdate(chatId, userId, 'groupUrl',            'Group URL');
    } else if (data === 'a_set_support')             { promptLinkUpdate(chatId, userId, 'supportUsername',     'Support username (without @)');
    } else if (data === 'a_set_botusername')         { promptLinkUpdate(chatId, userId, 'botUsername',         'User bot username (without @)');
    } else if (data === 'a_set_upiid')               { promptLinkUpdate(chatId, userId, 'upiId',              'UPI ID');
    } else if (data === 'a_set_binanceid')           { promptLinkUpdate(chatId, userId, 'binancePayId',        'Binance Pay ID');
    } else if (data === 'a_set_binancename')         { promptLinkUpdate(chatId, userId, 'binanceAccountName', 'Binance Account Name');
    } else if (data === 'a_set_rate')                { promptLinkUpdate(chatId, userId, 'usdtRate',           'USDT to INR rate (number)');

    // ── sessions / deposits ──────────────────────────────────────────────────
    } else if (data === 'a_sessions')                { sendSessionBookings(chatId);
    } else if (data === 'a_deposits')                { sendPendingDeposits(chatId);
    } else if (data.startsWith('a_dep_approve_'))    { approveDeposit(chatId, userId, data.replace('a_dep_approve_', ''));
    } else if (data.startsWith('a_dep_reject_'))     { rejectDeposit(chatId, userId, data.replace('a_dep_reject_', ''));

    // ── msg-to-user (from deposit/buy approval cards) ────────────────────────
    } else if (data.startsWith('a_msg_user_'))       { startMsgToUser(chatId, userId, data.replace('a_msg_user_', ''));

    // ── buy approval ─────────────────────────────────────────────────────────
    } else if (data.startsWith('a_buy_approve_'))    { approveBuyOrder(chatId, userId, data.replace('a_buy_approve_', ''));
    } else if (data.startsWith('a_buy_reject_'))     { rejectBuyOrder(chatId, userId, data.replace('a_buy_reject_', ''));

    // ── qr / ban / admins ────────────────────────────────────────────────────
    } else if (data === 'a_qr')                      { sendQrMenu(chatId);
    } else if (data === 'a_upload_upi_qr') {
      setAdminState(userId, 'awaiting_upi_qr');
      await bot.sendMessage(chatId, '🖼️ Send the new UPI QR code image:');
    } else if (data === 'a_upload_binance_qr') {
      setAdminState(userId, 'awaiting_binance_qr');
      await bot.sendMessage(chatId, '🖼️ Send the new Binance Pay QR code image:');
    } else if (data === 'a_ban') {
      setAdminState(userId, 'awaiting_ban_userid');
      await bot.sendMessage(chatId, '🚫 Send the numeric Telegram User ID to ban:');
    } else if (data === 'a_unban') {
      setAdminState(userId, 'awaiting_unban_userid');
      await bot.sendMessage(chatId, '✅ Send the numeric Telegram User ID to unban:');
    } else if (data === 'a_manage_admins')           { sendManageAdmins(chatId, userId);
    } else if (data.startsWith('a_removeadmin_')) {
      const tid = data.replace('a_removeadmin_', '');
      db.removeHiredAdmin(tid);
      await bot.sendMessage(chatId, `✅ Admin \`${tid}\` removed.`, { parse_mode: 'Markdown' });
      sendManageAdmins(chatId, userId);

    // ── broadcast / user list (owner only) ───────────────────────────────────
    } else if (data === 'a_broadcast')               { startBroadcast(chatId, userId);
    } else if (data === 'a_view_users')              { sendUserStats(chatId, userId);

    // ── add-product delivery type ─────────────────────────────────────────────
    } else if (data === 'a_deliv_file') {
      setAdminState(userId, 'awaiting_product_delivery_file', {});
      bot.sendMessage(chatId, '📎 Send the file (document or photo) to deliver for this product:');
    } else if (data === 'a_deliv_text') {
      setAdminState(userId, 'awaiting_delivery_text', {});
      bot.sendMessage(chatId, '🔑 Send the text/key/code to deliver for this product:');
    } else if (data === 'a_deliv_manual') {
      setAdminState(userId, 'awaiting_product_name', { deliveryType: 'manual' });
      bot.sendMessage(chatId, '✏️ Send the *product name*:', { parse_mode: 'Markdown' });
    }

    await bot.answerCallbackQuery(query.id).catch(() => {});
  } catch (err) {
    console.error('callback_query error:', err.message);
    bot.answerCallbackQuery(query.id, { text: '⚠️ Error, try again.' }).catch(() => {});
  }
});

// ─── ADD PRODUCT ─────────────────────────────────────────────────────────────
function startAddProduct(chatId, userId) {
  setAdminState(userId, 'awaiting_delivery_choice', {});
  bot.sendMessage(chatId,
    '➕ *Add New Product*\n\nHow will this product be delivered to buyers?',
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🟢 📄 Auto-send a file',                     callback_data: 'a_deliv_file' }],
          [{ text: '🟡 🔑 Auto-send a text/key/code',            callback_data: 'a_deliv_text' }],
          [{ text: '🟠 ✋ Manual delivery (admin sends later)',   callback_data: 'a_deliv_manual' }],
        ],
      },
    }
  );
}

function sendProductList(chatId, userId) {
  const products = db.getProducts();
  if (!products.length) {
    return bot.sendMessage(chatId, '📦 No products yet. Use ➕ Add Product to create one.', {
      reply_markup: { inline_keyboard: [[{ text: '🔙 « Back', callback_data: 'a_back_main' }]] },
    });
  }
  const buttons = products.map(p => [
    { text: `${p.active ? '🟢' : '🔴'} ${p.emoji} ${p.name} (${p.stock} left)`, callback_data: `a_prod_${p.id}` },
  ]);
  buttons.push([{ text: '🔙 « Back', callback_data: 'a_back_main' }]);
  bot.sendMessage(chatId, '📦 *All Products*\n\nTap a product to manage it:',
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
}

function sendProductDetail(chatId, userId, productId) {
  const p = db.getProductById(productId);
  if (!p) return bot.sendMessage(chatId, '⚠️ Product not found.');
  const text =
    `${p.emoji} *${p.name}*\n` +
    `Category: ${p.category}\n` +
    `Price: ${fmtMoney(p.priceUsd, p.priceInr)}\n` +
    `Stock: ${p.stock}\n` +
    `Sold: ${p.sold || 0}\n` +
    `Delivery: ${p.deliveryType}\n` +
    `Status: ${p.active ? '🟢 Active' : '🔴 Hidden'}\n` +
    (p.description ? `\nDescription: ${escapeHtml(p.description)}\n` : '');
  bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🟡 ➕ Add More Stock',             callback_data: `a_addmore_${p.id}` }],
        [{ text: p.active ? '🔴 Hide Product' : '🟢 Show Product', callback_data: `a_toggle_${p.id}` }],
        [{ text: '🔴 🗑️ Delete Product',            callback_data: `a_delprod_${p.id}` }],
        [{ text: '🔙 « Back to List',                callback_data: 'a_list_products' }],
      ],
    },
  });
}

function startAddStock(chatId, userId, productId) {
  setAdminState(userId, 'awaiting_addstock_qty', { productId });
  bot.sendMessage(chatId, '➕ How many units do you want to add to stock?');
}

function confirmDeleteProduct(chatId, userId, productId) {
  const p = db.getProductById(productId);
  if (!p) return;
  bot.sendMessage(chatId, `⚠️ Delete *${p.name}* permanently?`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [
      [{ text: '🔴 ✅ Yes, delete', callback_data: `a_delprodyes_${productId}` },
       { text: '🟢 ❌ Cancel',     callback_data: `a_prod_${productId}` }],
    ]},
  });
}

function doDeleteProduct(chatId, userId, productId) {
  db.deleteProduct(productId);
  bot.sendMessage(chatId, '🗑️ Product deleted.',
    { reply_markup: { inline_keyboard: [[{ text: '🔙 « Back', callback_data: 'a_list_products' }]] } });
}

function toggleProductActive(chatId, userId, productId) {
  const p = db.getProductById(productId);
  if (!p) return;
  db.updateProduct(productId, { active: !p.active });
  sendProductDetail(chatId, userId, productId);
}

// ─── STATISTICS ──────────────────────────────────────────────────────────────
function sendStats(chatId) {
  const products = db.getProducts();
  const orders   = Object.values(db.getOrders());
  const users    = Object.values(db.getUsers());
  const deposits = Object.values(db.getDeposits());

  const totalSold        = products.reduce((s, p) => s + (p.sold || 0), 0);
  const totalStock       = products.reduce((s, p) => s + p.stock, 0);
  const totalRevUsd      = orders.reduce((s, o) => s + o.amountUsd, 0);
  const totalRevInr      = orders.reduce((s, o) => s + o.amountInr, 0);
  const approved         = deposits.filter(d => d.status === 'approved');
  const totalDepUsd      = approved.reduce((s, d) => s + d.amountUsd, 0);
  const totalDepInr      = approved.reduce((s, d) => s + d.amountInr, 0);
  const pendingCount     = deposits.filter(d => d.status === 'pending').length;

  const text =
    `📊 *Store Statistics*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
    `👥 Total Users: *${users.length}*\n` +
    `🛍️ Total Orders: *${orders.length}*\n` +
    `✅ Units Sold: *${totalSold}*\n` +
    `📦 Units In Stock: *${totalStock}*\n\n` +
    `💰 Total Revenue: *${fmtMoney(db.round2(totalRevUsd), Math.round(totalRevInr))}*\n` +
    `📥 Total Deposited (approved): *${fmtMoney(db.round2(totalDepUsd), Math.round(totalDepInr))}*\n` +
    `⏳ Pending Deposits: *${pendingCount}*\n\n` +
    `📦 *Per-Product Breakdown:*\n` +
    products.map(p => `${p.emoji} ${p.name}: ${p.sold || 0} sold, ${p.stock} left`).join('\n');

  bot.sendMessage(chatId, text,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 « Back', callback_data: 'a_back_main' }]] } });
}

// ─── LINK SYSTEM ─────────────────────────────────────────────────────────────
function sendLinksMenu(chatId) {
  const s = db.getSettings();
  const text =
    `🔗 *Link & Settings System*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
    `📢 Channel: ${s.channelUrl}\n` +
    `👥 Group: ${s.groupUrl}\n` +
    `📞 Support: @${s.supportUsername}\n` +
    `🤖 Bot username: @${s.botUsername}\n` +
    `💳 UPI ID: ${s.upiId}\n` +
    `💳 Binance Pay ID: ${s.binancePayId}\n` +
    `👤 Binance Account: ${s.binanceAccountName}\n` +
    `⚡ USDT Rate: 1 USDT = ₹${s.usdtRate}\n\n` +
    `Tap below to change any value:`;

  bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🟢 📢 Channel',      callback_data: 'a_set_channel' },    { text: '🔵 👥 Group',          callback_data: 'a_set_group' }],
        [{ text: '🟡 📞 Support',      callback_data: 'a_set_support' },    { text: '🟣 🤖 Bot Username',   callback_data: 'a_set_botusername' }],
        [{ text: '🟠 💳 UPI ID',       callback_data: 'a_set_upiid' }],
        [{ text: '🔵 💳 Binance Pay',  callback_data: 'a_set_binanceid' }, { text: '🟡 👤 Binance Name',   callback_data: 'a_set_binancename' }],
        [{ text: '🔴 ⚡ USDT Rate',    callback_data: 'a_set_rate' }],
        [{ text: '🔙 « Back',          callback_data: 'a_back_main' }],
      ],
    },
  });
}

function promptLinkUpdate(chatId, userId, settingKey, label) {
  setAdminState(userId, 'awaiting_setting_value', { settingKey, label });
  bot.sendMessage(chatId, `✏️ Send the new value for *${label}*:`, { parse_mode: 'Markdown' });
}

// ─── SESSION BOOKINGS ────────────────────────────────────────────────────────
function sendSessionBookings(chatId) {
  const orders = Object.values(db.getOrders())
    .filter(o => o.status === 'pending_delivery')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 20);

  if (!orders.length) {
    return bot.sendMessage(chatId, '📁 No pending manual-delivery orders right now.', {
      reply_markup: { inline_keyboard: [[{ text: '🔙 « Back', callback_data: 'a_back_main' }]] },
    });
  }
  let text = `📁 *Pending Manual Deliveries*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n`;
  orders.forEach(o => {
    const date = new Date(o.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
    text += `🆔 \`${o.id}\`\n👤 ${o.username ? '@' + o.username : o.userId}\n📦 ${o.productName} x${o.qty}\n💰 ${fmtMoney(o.amountUsd, o.amountInr)}\n📅 ${date}\n\n`;
  });
  bot.sendMessage(chatId, text,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 « Back', callback_data: 'a_back_main' }]] } });
}

// ─── DEPOSIT APPROVALS (enhanced) ────────────────────────────────────────────
function buildDepositCard(d) {
  const user   = db.getUser(d.userId);
  const joined = user ? new Date(user.joinedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'N/A';
  const userLink = d.username ? `@${d.username}` : `[User](tg://user?id=${d.userId})`;

  return (
    `🆕 *New Deposit Request*\n` +
    `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
    `👤 *User:* ${userLink}\n` +
    `🆔 *ID:* \`${d.userId}\`\n` +
    `📛 *Name:* ${escapeHtml(user ? (user.firstName || user.username || 'N/A') : 'N/A')}\n` +
    `📅 *Member Since:* ${joined}\n` +
    `💼 *Total Purchases:* ${user ? user.purchases : 0}\n` +
    `💰 *Total Spent:* ${user ? fmtMoney(user.spentUsd, user.spentInr) : 'N/A'}\n\n` +
    `💳 *Method:* ${d.method.toUpperCase()}\n` +
    `💵 *Deposit Amount:* ${fmtMoney(d.amountUsd, d.amountInr)}\n` +
    `📊 *Previous Balance:* ${fmtMoney(d.prevBalanceUsd, d.prevBalanceInr)}\n` +
    `🧾 *Ref ID:* \`${d.id}\`\n\n` +
    `⏳ _Please wait for admin approval..._`
  );
}

function buildDepositButtons(d) {
  return {
    inline_keyboard: [
      [
        { text: '✅ 🟢 Approve',        callback_data: `a_dep_approve_${d.id}` },
        { text: '❌ 🔴 Reject',         callback_data: `a_dep_reject_${d.id}` },
      ],
      [
        { text: '💬 📩 Message User',   callback_data: `a_msg_user_${d.userId}` },
      ],
    ],
  };
}

function sendPendingDeposits(chatId) {
  const pending = db.getPendingDeposits().sort((a, b) => b.createdAt - a.createdAt);
  if (!pending.length) {
    return bot.sendMessage(chatId, '🧾 No pending deposits right now.', {
      reply_markup: { inline_keyboard: [[{ text: '🔙 « Back', callback_data: 'a_back_main' }]] },
    });
  }

  pending.forEach(d => {
    const text    = buildDepositCard(d);
    const markup  = buildDepositButtons(d);

    if (d.screenshotFileId) {
      bot.sendPhoto(chatId, d.screenshotFileId, { caption: text, parse_mode: 'Markdown', reply_markup: markup });
    } else {
      bot.sendMessage(chatId, text + '\n\n_(No screenshot uploaded yet)_', { parse_mode: 'Markdown', reply_markup: markup });
    }
  });
}

function approveDeposit(chatId, adminUserId, depositId) {
  const deposit = db.getDeposit(depositId);
  if (!deposit || deposit.status !== 'pending') {
    return bot.sendMessage(chatId, '⚠️ Deposit already processed or not found.');
  }
  db.updateDeposit(depositId, { status: 'approved', decidedAt: Date.now(), decidedBy: adminUserId });
  db.addBalance(deposit.userId, deposit.amountUsd, deposit.amountInr);
  const user = db.getUser(deposit.userId);
  if (user) {
    db.updateUser(deposit.userId, {
      depositedUsd: db.round2(user.depositedUsd + deposit.amountUsd),
      depositedInr: Math.round(user.depositedInr + deposit.amountInr),
    });
  }
  bot.sendMessage(chatId,
    `✅ *Deposit Approved!*\n\nUser \`${deposit.userId}\` — ${fmtMoney(deposit.amountUsd, deposit.amountInr)} credited.`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '💬 Message User', callback_data: `a_msg_user_${deposit.userId}` }]] } }
  );
  notifyUser(deposit.userId,
    `✅ *Deposit Approved!*\n\nYour deposit of ${fmtMoney(deposit.amountUsd, deposit.amountInr)} has been approved and credited to your balance! 🎉`);
}

function rejectDeposit(chatId, adminUserId, depositId) {
  const deposit = db.getDeposit(depositId);
  if (!deposit || deposit.status !== 'pending') {
    return bot.sendMessage(chatId, '⚠️ Deposit already processed or not found.');
  }
  db.updateDeposit(depositId, { status: 'rejected', decidedAt: Date.now(), decidedBy: adminUserId });
  bot.sendMessage(chatId, `❌ *Deposit Rejected.*\n\nRef: \`${depositId}\``,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '💬 Message User', callback_data: `a_msg_user_${deposit.userId}` }]] } }
  );
  notifyUser(deposit.userId,
    `❌ *Deposit Rejected*\n\nYour deposit request (Ref: \`${depositId}\`) was rejected. Please contact support if you believe this is a mistake.`);
}

// ─── BUY ORDER APPROVAL (new feature) ────────────────────────────────────────
// Called by user-bot when a manual-delivery order is placed
// The user-bot pushes the order details to ADMIN_NOTIFY_CHAT_ID via adminPushBot
// The admin can then approve (deliver later manually) or reject (refund)
function buildBuyCard(order) {
  const user   = db.getUser(order.userId);
  const joined = user ? new Date(user.joinedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'N/A';
  const userLink = order.username ? `@${order.username}` : `[User](tg://user?id=${order.userId})`;

  return (
    `🛒 *New Product Order — Approval Needed*\n` +
    `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
    `👤 *User:* ${userLink}\n` +
    `🆔 *ID:* \`${order.userId}\`\n` +
    `📛 *Name:* ${escapeHtml(user ? (user.firstName || user.username || 'N/A') : 'N/A')}\n` +
    `📅 *Member Since:* ${joined}\n` +
    `💼 *Total Purchases:* ${user ? user.purchases : 0}\n` +
    `💰 *Total Spent:* ${user ? fmtMoney(user.spentUsd, user.spentInr) : 'N/A'}\n\n` +
    `📦 *Product:* ${order.productName} x${order.qty}\n` +
    `💵 *Amount Paid:* ${fmtMoney(order.amountUsd, order.amountInr)}\n` +
    `🆔 *Order ID:* \`${order.id}\`\n\n` +
    `⏳ _Please wait for admin approval..._`
  );
}

function approveBuyOrder(chatId, adminUserId, orderId) {
  const orders = db.getOrders();
  const order  = orders[orderId];
  if (!order) return bot.sendMessage(chatId, '⚠️ Order not found.');
  if (order.status !== 'pending_delivery') return bot.sendMessage(chatId, '⚠️ Order already processed.');

  db.updateOrder(orderId, { status: 'completed', approvedAt: Date.now(), approvedBy: adminUserId });
  bot.sendMessage(chatId,
    `✅ *Order Approved!*\n\nOrder \`${orderId}\` marked as completed.\nRemember to manually deliver the product to the user.`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '💬 Message User', callback_data: `a_msg_user_${order.userId}` }]] } }
  );
  notifyUser(order.userId,
    `✅ *Your order is approved!*\n\n📦 *${order.productName}* x${order.qty}\n\nOur team will deliver your item shortly. Order ID: \`${orderId}\``);
}

function rejectBuyOrder(chatId, adminUserId, orderId) {
  const orders = db.getOrders();
  const order  = orders[orderId];
  if (!order) return bot.sendMessage(chatId, '⚠️ Order not found.');
  if (order.status !== 'pending_delivery') return bot.sendMessage(chatId, '⚠️ Order already processed.');

  // Refund the user
  db.addBalance(order.userId, order.amountUsd, order.amountInr);
  db.updateOrder(orderId, { status: 'rejected', rejectedAt: Date.now(), rejectedBy: adminUserId });
  bot.sendMessage(chatId,
    `❌ *Order Rejected & Refunded.*\n\nOrder \`${orderId}\` — ${fmtMoney(order.amountUsd, order.amountInr)} refunded to user's balance.`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '💬 Message User', callback_data: `a_msg_user_${order.userId}` }]] } }
  );
  notifyUser(order.userId,
    `❌ *Order Rejected*\n\nYour order for *${order.productName}* was rejected.\n${fmtMoney(order.amountUsd, order.amountInr)} has been refunded to your balance. Contact support for help.`);
}

// ─── MESSAGE TO USER (from admin panel) ──────────────────────────────────────
function startMsgToUser(chatId, adminUserId, targetUserId) {
  setAdminState(adminUserId, 'awaiting_msg_to_user', { targetUserId });
  bot.sendMessage(chatId,
    `💬 *Send Message to User*\n\nTarget: \`${targetUserId}\`\n\nType the message you want to send to this user:`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'a_back_main' }]] } }
  );
}

// ─── BROADCAST (owner only) ──────────────────────────────────────────────────
function startBroadcast(chatId, userId) {
  if (!db.isOwner(userId)) return bot.sendMessage(chatId, '🚫 Only the Owner can broadcast.');
  setAdminState(userId, 'awaiting_broadcast_msg');
  bot.sendMessage(chatId,
    `📢 *Broadcast to All Users*\n\nType the message you want to send to ALL users.\n⚠️ This will be sent to everyone who has used the User Bot.\n\nSend your message now:`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'a_back_main' }]] } }
  );
}

async function doBroadcast(chatId, userId, text) {
  if (!db.isOwner(userId)) return;
  const users  = Object.values(db.getUsers());
  let sent = 0, failed = 0;

  bot.sendMessage(chatId, `📢 Broadcasting to ${users.length} users... please wait.`);

  for (const user of users) {
    try {
      await notifyUserDirect(user.id, `📢 *Message from Admin:*\n\n${text}`);
      sent++;
    } catch {
      failed++;
    }
    // Small delay to avoid hitting Telegram rate limits
    await new Promise(r => setTimeout(r, 50));
  }

  bot.sendMessage(chatId,
    `✅ *Broadcast Complete!*\n\n✅ Sent: ${sent}\n❌ Failed: ${failed}`,
    { parse_mode: 'Markdown', reply_markup: mainPanelKeyboard(true) }
  );
}

// Direct send via user-bot token
function notifyUserDirect(userId, text) {
  if (!UserNotifier) return Promise.reject(new Error('No UserNotifier'));
  return UserNotifier.sendMessage(userId, text, { parse_mode: 'Markdown' });
}

// ─── VIEW ALL USERS (owner only) ─────────────────────────────────────────────
function sendUserStats(chatId, userId) {
  if (!db.isOwner(userId)) return bot.sendMessage(chatId, '🚫 Only the Owner can view users.');
  const users    = Object.values(db.getUsers());
  const bans     = db.getBans ? Object.values(db.getBans()) : [];
  const now      = Date.now();
  const day      = 86400000;
  const newToday = users.filter(u => now - u.joinedAt < day).length;

  let text =
    `👥 *All Users Overview*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
    `📊 *Total Users:* ${users.length}\n` +
    `🆕 *Joined Today:* ${newToday}\n` +
    `🚫 *Banned:* ${bans.length}\n\n`;

  // Show last 10 users
  const recent = users.sort((a, b) => b.joinedAt - a.joinedAt).slice(0, 10);
  text += `*Recent Users (last 10):*\n`;
  recent.forEach((u, i) => {
    const name = u.username ? '@' + u.username : (u.firstName || u.id);
    const joined = new Date(u.joinedAt).toLocaleDateString('en-IN');
    text += `${i + 1}. ${escapeHtml(name)} — ID: \`${u.id}\` — ${joined}\n`;
  });

  bot.sendMessage(chatId, text,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 « Back', callback_data: 'a_back_main' }]] } });
}

// ─── QR MENU ─────────────────────────────────────────────────────────────────
function sendQrMenu(chatId) {
  bot.sendMessage(chatId, '🖼️ *QR Code Management*\n\nUpload or replace payment QR codes:', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🟢 📱 Upload UPI QR',     callback_data: 'a_upload_upi_qr' }],
        [{ text: '🔵 💳 Upload Binance QR', callback_data: 'a_upload_binance_qr' }],
        [{ text: '🔙 « Back',               callback_data: 'a_back_main' }],
      ],
    },
  });
}

// ─── MANAGE ADMINS ───────────────────────────────────────────────────────────
function sendManageAdmins(chatId, userId) {
  if (!db.isOwner(userId)) return bot.sendMessage(chatId, '🚫 Only the Owner can manage admins.');
  const admins = db.listHiredAdmins();
  let text = `👮 *Manage Admins*\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n`;
  text += `Use \`/admin <user_id_or_username>\` to add a new admin.\n\n`;
  text += admins.length ? `*Current Admins:*\n` : '_No hired admins yet._';
  admins.forEach(a => { text += `• ${a.username ? '@' + a.username : a.id} (ID: \`${a.id}\`)\n`; });

  const buttons = admins.map(a => [
    { text: `🗑️ Remove ${a.username ? '@' + a.username : a.id}`, callback_data: `a_removeadmin_${a.id}` },
  ]);
  buttons.push([{ text: '🔙 « Back', callback_data: 'a_back_main' }]);

  bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
}

// ─── CENTRAL STATE INPUT HANDLER ─────────────────────────────────────────────
function handleAdminStateInput(chatId, userId, msg, state) {
  const text = (msg.text || '').trim();

  switch (state.state) {
    case 'awaiting_broadcast_msg': {
      clearAdminState(userId);
      return doBroadcast(chatId, userId, text);
    }
    case 'awaiting_msg_to_user': {
      const { targetUserId } = state.data;
      clearAdminState(userId);
      notifyUser(targetUserId, `💬 *Message from Admin:*\n\n${text}`);
      return bot.sendMessage(chatId, `✅ Message sent to user \`${targetUserId}\`.`,
        { parse_mode: 'Markdown', reply_markup: mainPanelKeyboard(db.isOwner(userId)) });
    }
    case 'awaiting_delivery_text': {
      setAdminState(userId, 'awaiting_product_name', { deliveryType: 'auto-text', deliveryText: text });
      return bot.sendMessage(chatId, '✅ Saved. Now send the *product name*:', { parse_mode: 'Markdown' });
    }
    case 'awaiting_product_name': {
      setAdminState(userId, 'awaiting_product_emoji', { ...state.data, name: text });
      return bot.sendMessage(chatId, '🎨 Send an emoji for this product (e.g. 🔑, 📦, 💎):');
    }
    case 'awaiting_product_emoji': {
      setAdminState(userId, 'awaiting_product_category', { ...state.data, emoji: text });
      return bot.sendMessage(chatId, '🏷️ Send a category name (e.g. "General" or "Keys"):');
    }
    case 'awaiting_product_category': {
      setAdminState(userId, 'awaiting_product_price_usd', { ...state.data, category: text });
      return bot.sendMessage(chatId, '💵 Send the price in USD (e.g. 0.50):');
    }
    case 'awaiting_product_price_usd': {
      if (!isValidPositiveNumber(text)) return bot.sendMessage(chatId, '❌ Please enter a valid number (e.g. 0.50)');
      setAdminState(userId, 'awaiting_product_price_inr', { ...state.data, priceUsd: parseFloat(text) });
      return bot.sendMessage(chatId, '💵 Send the price in ₹ INR (e.g. 45):');
    }
    case 'awaiting_product_price_inr': {
      if (!isValidPositiveNumber(text)) return bot.sendMessage(chatId, '❌ Please enter a valid number (e.g. 45)');
      setAdminState(userId, 'awaiting_product_stock', { ...state.data, priceInr: parseFloat(text) });
      return bot.sendMessage(chatId, '📦 How many units are in stock?');
    }
    case 'awaiting_product_stock': {
      if (!isValidPositiveInt(text)) return bot.sendMessage(chatId, '❌ Please enter a valid number (e.g. 10)');
      setAdminState(userId, 'awaiting_product_description', { ...state.data, stock: parseInt(text, 10) });
      return bot.sendMessage(chatId, '📝 Send a short description (or send "-" to skip):');
    }
    case 'awaiting_product_description': {
      const description = text === '-' ? '' : text;
      const product = db.addProduct({ ...state.data, description });
      clearAdminState(userId);
      return bot.sendMessage(chatId,
        `✅ *Product added!*\n\n${product.emoji} ${product.name}\n${fmtMoney(product.priceUsd, product.priceInr)} | ${product.stock} in stock`,
        { parse_mode: 'Markdown', reply_markup: mainPanelKeyboard(db.isOwner(userId)) });
    }
    case 'awaiting_addstock_qty': {
      if (!isValidPositiveInt(text)) return bot.sendMessage(chatId, '❌ Please enter a valid number');
      const qty     = parseInt(text, 10);
      const product = db.getProductById(state.data.productId);
      if (!product) { clearAdminState(userId); return; }
      db.updateProduct(product.id, { stock: product.stock + qty });
      clearAdminState(userId);
      return bot.sendMessage(chatId, `✅ Added ${qty} units. New stock: ${product.stock + qty}`,
        { reply_markup: mainPanelKeyboard(db.isOwner(userId)) });
    }
    case 'awaiting_setting_value': {
      const { settingKey, label } = state.data;
      let value = text;
      if (settingKey === 'usdtRate') {
        if (!isValidPositiveNumber(text)) return bot.sendMessage(chatId, '❌ Please enter a valid number');
        value = parseFloat(text);
      }
      db.updateSettings({ [settingKey]: value });
      clearAdminState(userId);
      return bot.sendMessage(chatId, `✅ *${label}* updated!`,
        { parse_mode: 'Markdown', reply_markup: mainPanelKeyboard(db.isOwner(userId)) });
    }
    case 'awaiting_ban_userid': {
      if (!isValidPositiveInt(text)) return bot.sendMessage(chatId, '❌ Enter a valid numeric user ID');
      db.banUser(text, 'Manual ban by admin', userId);
      clearAdminState(userId);
      return bot.sendMessage(chatId, `🚫 User \`${text}\` has been banned.`,
        { parse_mode: 'Markdown', reply_markup: mainPanelKeyboard(db.isOwner(userId)) });
    }
    case 'awaiting_unban_userid': {
      if (!isValidPositiveInt(text)) return bot.sendMessage(chatId, '❌ Enter a valid numeric user ID');
      db.unbanUser(text);
      clearAdminState(userId);
      return bot.sendMessage(chatId, `✅ User \`${text}\` has been unbanned.`,
        { parse_mode: 'Markdown', reply_markup: mainPanelKeyboard(db.isOwner(userId)) });
    }
    default:
      clearAdminState(userId);
  }
}

// ─── EXPORT (for cross-file use if needed) ───────────────────────────────────
module.exports = {
  bot,
  sendAdminPanel,
  mainPanelKeyboard,
  buildBuyCard,
  buildDepositCard,
};
