const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const db = require('./database');
const utils = require('./utils');

const bot = new TelegramBot(config.ADMIN_BOT_TOKEN, { polling: true });

const authenticatedUsers = new Set();
const adminState = {};

function getState(userId) {
  if (!adminState[userId]) adminState[userId] = {};
  return adminState[userId];
}

function clearState(userId) {
  adminState[userId] = {};
}

function isOwner(userId) {
  return userId === config.OWNER_ID;
}

function backBtn(label = 'Back to Menu', data = 'adm_menu') {
  return { inline_keyboard: [[{ text: `« ${label}`, callback_data: data }]] };
}

// User Bot pe message bhejne ke liye
async function notifyUser(chatId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${config.USER_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
  } catch (err) {
    console.error('notifyUser error:', err.message);
  }
}

// ─── /start ───────────────────────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const userId = msg.from.id;
  if (!isOwner(userId)) {
    await bot.sendMessage(userId, '🚫 Unauthorized.');
    return;
  }
  if (authenticatedUsers.has(userId)) {
    await showAdminMenu(userId);
    return;
  }
  getState(userId).waitingPassword = true;
  await bot.sendMessage(userId, `🔐 *Admin Panel*\n\nEnter your password to continue:`, { parse_mode: 'Markdown' });
});

// ─── Admin Menu ───────────────────────────────────────────────────────────────
async function showAdminMenu(userId, messageId) {
  const stats = await db.getStats();
  const text =
    `🏠 *Admin Control Panel*\n\n` +
    `👥 Users: ${stats.totalUsers} | 📥 Pending: ${stats.pendingDeposits}\n\n` +
    `Select an option:`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: `📥 Deposits (${stats.pendingDeposits})`, callback_data: 'adm_deposits' },
        { text: '📦 Products', callback_data: 'adm_products' }
      ],
      [
        { text: '💳 Payment Methods', callback_data: 'adm_payments' },
        { text: '💱 Rate Settings', callback_data: 'adm_rate' }
      ],
      [
        { text: '🎁 Referral', callback_data: 'adm_referral' },
        { text: '👥 Users', callback_data: 'adm_users' }
      ],
      [
        { text: '🔗 Links', callback_data: 'adm_links' },
        { text: '📊 Stats', callback_data: 'adm_stats' }
      ],
      [
        { text: '📢 Broadcast', callback_data: 'adm_broadcast' },
        { text: '🔑 Password', callback_data: 'adm_password' }
      ]
    ]
  };

  if (messageId) {
    try {
      await bot.editMessageText(text, { chat_id: userId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard });
      return;
    } catch {}
  }
  await bot.sendMessage(userId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

// ─── Callback Handler ─────────────────────────────────────────────────────────
bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  const data = query.data;
  const messageId = query.message.message_id;

  try { await bot.answerCallbackQuery(query.id); } catch {}

  if (!isOwner(userId) || !authenticatedUsers.has(userId)) {
    await bot.sendMessage(userId, 'Please /start and authenticate first.');
    return;
  }

  try {
    if (data === 'adm_menu') {
      await showAdminMenu(userId, messageId);
    } else if (data === 'adm_deposits') {
      await showPendingDeposits(userId, messageId);
    } else if (data === 'adm_products') {
      await showProductsMenu(userId, messageId);
    } else if (data === 'adm_sold_products') {
      await showSoldProducts(userId, messageId);
    } else if (data === 'adm_payments') {
      await showPaymentMethods(userId, messageId);
    } else if (data === 'adm_rate') {
      await showRateSettings(userId, messageId);
    } else if (data === 'adm_referral') {
      await showReferralSettings(userId, messageId);
    } else if (data === 'adm_users') {
      await showUsersMenu(userId, messageId);
    } else if (data === 'adm_broadcast') {
      await startBroadcast(userId, messageId);
    } else if (data === 'adm_stats') {
      await showStats(userId, messageId);
    } else if (data === 'adm_password') {
      await showPasswordSettings(userId, messageId);
    } else if (data === 'adm_links') {
      await showLinksSettings(userId, messageId);
    } else if (data === 'adm_change_group') {
      getState(userId).waitingGroupLink = true;
      await bot.sendMessage(userId, 'Enter new Group link:');
    } else if (data === 'adm_change_channel') {
      getState(userId).waitingChannelLink = true;
      await bot.sendMessage(userId, 'Enter new Channel link:');
    } else if (data === 'adm_change_support') {
      getState(userId).waitingSupportLink = true;
      await bot.sendMessage(userId, 'Enter new Support link:');
    } else if (data.startsWith('adm_approve_')) {
      const refId = data.replace('adm_approve_', '');
      await approveDeposit(userId, refId, messageId);
    } else if (data.startsWith('adm_reject_')) {
      const refId = data.replace('adm_reject_', '');
      await rejectDeposit(userId, refId, messageId);
    } else if (data.startsWith('adm_msg_')) {
      const targetId = parseInt(data.replace('adm_msg_', ''));
      const state = getState(userId);
      state.sendMsgTo = targetId;
      state.waitingSendMsg = true;
      await bot.sendMessage(userId, `Type your message for user ${targetId}:`);
    } else if (data === 'adm_add_product') {
      await startAddProduct(userId);
    } else if (data.startsWith('adm_edit_product_')) {
      const pid = parseInt(data.replace('adm_edit_product_', ''));
      await showEditProduct(userId, pid);
    } else if (data.startsWith('adm_del_product_')) {
      const pid = parseInt(data.replace('adm_del_product_', ''));
      await confirmDeleteProduct(userId, pid);
    } else if (data.startsWith('adm_confirm_del_')) {
      const pid = parseInt(data.replace('adm_confirm_del_', ''));
      await deleteProduct(userId, pid);
    } else if (data.startsWith('adm_add_more_')) {
      const pid = parseInt(data.replace('adm_add_more_', ''));
      const state = getState(userId);
      state.addingStockToProduct = pid;
      state.waitingAddStock = true;
      await bot.sendMessage(userId, `Enter number of stock to add for product ID ${pid}:`);
    } else if (data.startsWith('adm_edit_field_')) {
      const raw = data.replace('adm_edit_field_', '');
      const idx = raw.indexOf('_');
      const pid = parseInt(raw.substring(0, idx));
      const field = raw.substring(idx + 1);
      const state = getState(userId);
      state.editingProductId = pid;
      state.editingField = field;
      state.waitingProductEdit = true;
      const labels = { name: 'Product Name', price_inr: 'Price (Rs)', stock: 'Stock Count', description: 'Description', content: 'Product Content' };
      await bot.sendMessage(userId, `Enter new ${labels[field] || field}:`);
    } else if (data === 'adm_toggle_upi') {
      await togglePayment(userId, messageId, 'upi_enabled');
    } else if (data === 'adm_toggle_bnb') {
      await togglePayment(userId, messageId, 'bnb_enabled');
    } else if (data === 'adm_toggle_fampay') {
      await togglePayment(userId, messageId, 'fampay_enabled');
    } else if (data === 'adm_toggle_referral') {
      const current = await db.getSetting('referral_enabled');
      await db.setSetting('referral_enabled', current === '1' ? '0' : '1');
      await showReferralSettings(userId, messageId);
    } else if (data === 'adm_upi_settings') {
      await showUpiSettings(userId, messageId);
    } else if (data === 'adm_change_upi_id') {
      getState(userId).waitingUpiId = true;
      await bot.sendMessage(userId, 'Enter new UPI ID (e.g. name@upi):');
    } else if (data === 'adm_change_upi_text_id') {
      getState(userId).waitingUpiTextId = true;
      await bot.sendMessage(userId, 'Enter Display UPI Text ID to show users (e.g. yourname@bank):');
    } else if (data === 'adm_change_qr') {
      await showQrChangeMenu(userId, messageId);
    } else if (data.startsWith('adm_qr_method_')) {
      const method = data.replace('adm_qr_method_', '');
      const state = getState(userId);
      state.qrUploadMethod = method;
      state.waitingQrUpload = true;
      const names = { gpay: 'GPay', fampay: 'FamPay', any: 'Any UPI', bnb: 'BNB' };
      // ✅ Admin ko both options batao — QR pic ya Text ID
      await bot.sendMessage(userId,
        `📸 *Set Payment Info for ${names[method] || method}*\n\n` +
        `You can set:\n` +
        `• *QR Code* — Send a photo of your QR\n` +
        `• *UPI Text ID* — Type your UPI ID as text\n` +
        `• *Both* — Send photo first, then type ID\n\n` +
        `*Send your QR code photo now, or type your UPI ID:*`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '« Back', callback_data: 'adm_change_qr' }]] } }
      );
    } else if (data === 'adm_skip_text_id') {
      clearState(userId);
      await bot.sendMessage(userId, `✅ Done! QR saved.`, { reply_markup: backBtn('Back to Payments', 'adm_payments') });
    } else if (data === 'adm_set_rate') {
      getState(userId).waitingRate = true;
      await bot.sendMessage(userId, 'Enter new USDT to INR rate (e.g. 90):');
    } else if (data === 'adm_set_ref_reward') {
      getState(userId).waitingRefReward = true;
      await bot.sendMessage(userId, 'Enter referral reward amount (Rs):');
    } else if (data.startsWith('adm_user_')) {
      const uid = parseInt(data.replace('adm_user_', ''));
      await showUserDetail(userId, uid);
    } else if (data.startsWith('adm_ban_')) {
      const uid = parseInt(data.replace('adm_ban_', ''));
      await toggleBanUser(userId, uid);
    } else if (data.startsWith('adm_restrict_')) {
      const uid = parseInt(data.replace('adm_restrict_', ''));
      await toggleRestrictUser(userId, uid);
    } else if (data === 'adm_change_password') {
      getState(userId).waitingNewPassword = true;
      await bot.sendMessage(userId, 'Enter new admin password:');
    } else if (data === 'adm_set_bnb_addr') {
      getState(userId).waitingBnbAddress = true;
      await bot.sendMessage(userId, 'Enter your BNB Wallet Address:');
    } else if (data.startsWith('adm_deliver_')) {
      const purchaseId = parseInt(data.replace('adm_deliver_', ''));
      await deliverPurchase(userId, purchaseId);
    } else if (data.startsWith('adm_refund_')) {
      const purchaseId = parseInt(data.replace('adm_refund_', ''));
      await refundPurchase(userId, purchaseId);
    } else if (data.startsWith('adm_view_ss_')) {
      const refId = data.replace('adm_view_ss_', '');
      await viewDepositScreenshot(userId, refId);
    }
  } catch (err) {
    console.error('Admin callback error:', err.message);
  }
});

// ─── Pending Deposits ─────────────────────────────────────────────────────────
async function showPendingDeposits(userId, messageId) {
  const deposits = await db.getPendingDeposits();

  if (!deposits.length) {
    try {
      await bot.editMessageText(
        `📥 *Pending Deposits*\n\n✅ No pending deposits!`,
        { chat_id: userId, message_id: messageId, parse_mode: 'Markdown', reply_markup: backBtn() }
      );
    } catch {}
    return;
  }

  let text = `📥 *Pending Deposits (${deposits.length})*\n\n`;
  const keyboard = [];

  for (const dep of deposits) {
    text +=
      `👤 *${dep.full_name}*\n` +
      `💰 Rs ${dep.amount_inr.toFixed(0)} | 📱 ${dep.method || 'UPI'}\n` +
      `🆔 \`${dep.ref_id}\`\n\n`;

    keyboard.push([
      { text: `✅ Approve Rs ${dep.amount_inr.toFixed(0)}`, callback_data: `adm_approve_${dep.ref_id}` },
      { text: '❌ Reject', callback_data: `adm_reject_${dep.ref_id}` }
    ]);
    keyboard.push([
      { text: `📸 View Screenshot`, callback_data: `adm_view_ss_${dep.ref_id}` },
      { text: '💬 Message', callback_data: `adm_msg_${dep.user_id}` }
    ]);
  }

  keyboard.push([{ text: '« Back', callback_data: 'adm_menu' }]);

  try {
    await bot.editMessageText(text, {
      chat_id: userId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch {}
}

// ─── Approve Deposit ──────────────────────────────────────────────────────────
async function approveDeposit(userId, refId, messageId) {
  const database = await db.getDB();
  const deposit = await database.get('SELECT * FROM deposits WHERE ref_id = ?', refId);

  if (!deposit || deposit.status !== 'pending') {
    await bot.sendMessage(userId, '⚠️ Deposit not found or already processed.');
    return;
  }

  await database.run(
    `UPDATE deposits SET status = 'approved', approved_at = CURRENT_TIMESTAMP WHERE ref_id = ?`, refId
  );
  await db.updateUserBalance(deposit.user_id, deposit.amount_inr);

  await notifyUser(deposit.user_id,
    `✅ *Payment Approved!*\n\n` +
    `Rs ${deposit.amount_inr.toFixed(0)} has been added to your wallet.\n` +
    `📝 Ref: \`${refId}\`\n\nThank you for your deposit!`
  );

  await bot.sendMessage(userId,
    `✅ *Approved!*\n\nRs ${deposit.amount_inr.toFixed(0)} added to user \`${deposit.user_id}\` wallet.`,
    { parse_mode: 'Markdown', reply_markup: backBtn('Back to Deposits', 'adm_deposits') }
  );
}

// ─── Reject Deposit ───────────────────────────────────────────────────────────
async function rejectDeposit(userId, refId, messageId) {
  const database = await db.getDB();
  const deposit = await database.get('SELECT * FROM deposits WHERE ref_id = ?', refId);

  if (!deposit) {
    await bot.sendMessage(userId, '⚠️ Deposit not found.');
    return;
  }

  await database.run(`UPDATE deposits SET status = 'rejected' WHERE ref_id = ?`, refId);

  await notifyUser(deposit.user_id,
    `❌ *Payment Rejected*\n\n` +
    `Your deposit of Rs ${deposit.amount_inr.toFixed(0)} was not approved.\n` +
    `📝 Ref: \`${refId}\`\n\nContact support if you think this is an error.`
  );

  await bot.sendMessage(userId,
    `❌ *Rejected!*\n\nDeposit \`${refId.substring(0, 25)}\` rejected.`,
    { parse_mode: 'Markdown', reply_markup: backBtn('Back to Deposits', 'adm_deposits') }
  );
}

// ─── View Screenshot ──────────────────────────────────────────────────────────
async function viewDepositScreenshot(userId, refId) {
  const database = await db.getDB();
  const deposit = await database.get(
    `SELECT d.*, u.full_name, u.username FROM deposits d JOIN users u ON d.user_id = u.user_id WHERE d.ref_id = ?`, refId
  );

  if (!deposit) {
    await bot.sendMessage(userId, '❌ Deposit not found.');
    return;
  }

  if (!deposit.screenshot_file_id) {
    await bot.sendMessage(userId,
      `⚠️ No screenshot for this deposit.\nRef: \`${refId}\``,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const caption =
    `📸 *Payment Screenshot*\n\n` +
    `👤 *User:* ${deposit.full_name} (@${deposit.username || 'N/A'})\n` +
    `💰 *Amount:* Rs ${deposit.amount_inr.toFixed(0)}\n` +
    `📝 *Ref ID:* \`${deposit.ref_id}\`\n` +
    `📱 *Method:* ${deposit.method || 'UPI'}\n` +
    `🕐 *Time:* ${utils.formatDateTime(deposit.created_at)}\n` +
    `📊 *Status:* ${deposit.status}`;

  await bot.sendPhoto(userId, deposit.screenshot_file_id, {
    caption: caption,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: `✅ Approve Rs ${deposit.amount_inr.toFixed(0)}`, callback_data: `adm_approve_${refId}` },
          { text: '❌ Reject', callback_data: `adm_reject_${refId}` }
        ],
        [{ text: '« Back to Deposits', callback_data: 'adm_deposits' }]
      ]
    }
  });
}

// ─── Products Menu ────────────────────────────────────────────────────────────
async function showProductsMenu(userId, messageId) {
  const products = await db.getAllProducts();

  let text = `📦 *Products Management*\n\n`;
  const keyboard = [
    [
      { text: '➕ Add New Product', callback_data: 'adm_add_product' },
      { text: '📊 Sold Report', callback_data: 'adm_sold_products' }
    ]
  ];

  if (!products.length) {
    text += 'No products yet. Add your first product!';
  } else {
    for (const p of products) {
      const status = p.stock > 0 ? '🟢' : '🔴';
      text += `${status} *${p.name}*\n   💰 Rs ${p.price_inr.toFixed(0)} | 📦 Stock: ${p.stock} | Sold: ${p.total_sold}\n\n`;
      keyboard.push([
        { text: `✏️ Edit`, callback_data: `adm_edit_product_${p.id}` },
        { text: `➕ Add Stock`, callback_data: `adm_add_more_${p.id}` },
        { text: `🗑️ Delete`, callback_data: `adm_del_product_${p.id}` }
      ]);
    }
  }

  keyboard.push([{ text: '« Back', callback_data: 'adm_menu' }]);

  try {
    await bot.editMessageText(text, {
      chat_id: userId, message_id: messageId, parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch {}
}

// ─── Sold Products ────────────────────────────────────────────────────────────
async function showSoldProducts(userId, messageId) {
  const sold = await db.getSoldProducts();

  let text = `📊 *Sold Products Report*\n\n`;
  let totalRevenue = 0;

  if (!sold.length) {
    text += 'No products sold yet.';
  } else {
    for (const p of sold) {
      text += `📦 *${p.name}*\n   🛒 Sold: ${p.total_sold} | 💰 Revenue: Rs ${(p.total_revenue || 0).toFixed(0)}\n\n`;
      totalRevenue += p.total_revenue || 0;
    }
    text += `*Total Revenue: Rs ${totalRevenue.toFixed(0)}*`;
  }

  try {
    await bot.editMessageText(text, {
      chat_id: userId, message_id: messageId, parse_mode: 'Markdown',
      reply_markup: backBtn('Back to Products', 'adm_products')
    });
  } catch {}
}

// ─── Add Product ──────────────────────────────────────────────────────────────
async function startAddProduct(userId) {
  const state = getState(userId);
  state.addingProduct = { step: 'name', data: {} };
  await bot.sendMessage(userId, `➕ *Add New Product*\n\n*Step 1/5:* Enter product name:`, { parse_mode: 'Markdown' });
}

// ─── Edit Product ─────────────────────────────────────────────────────────────
async function showEditProduct(userId, pid) {
  const database = await db.getDB();
  const p = await database.get('SELECT * FROM products WHERE id = ?', pid);

  if (!p) { await bot.sendMessage(userId, '❌ Product not found.'); return; }

  const text =
    `✏️ *Edit Product*\n\n` +
    `*Name:* ${p.name}\n*Price:* Rs ${p.price_inr.toFixed(0)}\n` +
    `*Stock:* ${p.stock}\n*Total Sold:* ${p.total_sold}\n` +
    `*Description:* ${p.description || 'N/A'}\n\nSelect field to edit:`;

  await bot.sendMessage(userId, text, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📝 Name', callback_data: `adm_edit_field_${pid}_name` },
          { text: '💰 Price', callback_data: `adm_edit_field_${pid}_price_inr` }
        ],
        [
          { text: '📦 Stock', callback_data: `adm_edit_field_${pid}_stock` },
          { text: '📄 Description', callback_data: `adm_edit_field_${pid}_description` }
        ],
        [{ text: '🔑 Content', callback_data: `adm_edit_field_${pid}_content` }],
        [
          { text: '➕ Add Stock', callback_data: `adm_add_more_${pid}` },
          { text: '« Back', callback_data: 'adm_products' }
        ]
      ]
    }
  });
}

// ─── Confirm Delete ───────────────────────────────────────────────────────────
async function confirmDeleteProduct(userId, pid) {
  const database = await db.getDB();
  const p = await database.get('SELECT * FROM products WHERE id = ?', pid);
  if (!p) { await bot.sendMessage(userId, '❌ Product not found.'); return; }

  await bot.sendMessage(userId,
    `⚠️ *Confirm Delete?*\n\nProduct: *${p.name}*\nStock remaining: ${p.stock}\n\nThis will deactivate the product.`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
        
