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

// ─── Notify User via User Bot ─────────────────────────────────────────────────
async function notifyUser(chatId, text) {
  try {
    const url = `https://api.telegram.org/bot${config.USER_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
      })
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
  const state = getState(userId);
  state.waitingPassword = true;
  await bot.sendMessage(userId,
    `🔐 *Admin Panel*\n\nEnter your password to continue:`,
    { parse_mode: 'Markdown' }
  );
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
      await bot.editMessageText(text, {
        chat_id: userId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
      return;
    } catch {}
  }
  await bot.sendMessage(userId, text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
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
      await approveDeposit(userId, refId);
    } else if (data.startsWith('adm_reject_')) {
      const refId = data.replace('adm_reject_', '');
      await rejectDeposit(userId, refId);
    } else if (data.startsWith('adm_view_ss_')) {
      // ✅ NEW: View Screenshot button
      const refId = data.replace('adm_view_ss_', '');
      await viewDepositScreenshot(userId, refId);
    } else if (data.startsWith('adm_msg_')) {
      const targetId = parseInt(data.replace('adm_msg_', ''));
      const state = getState(userId);
      state.sendMsgTo = targetId;
      state.waitingSendMsg = true;
      await bot.sendMessage(userId,
        `Type your message for user \`${targetId}\`:`,
        { parse_mode: 'Markdown' }
      );
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
      await bot.sendMessage(userId,
        `Enter number of stock to add for product ID ${pid}:`
      );
    } else if (data.startsWith('adm_edit_field_')) {
      const raw = data.replace('adm_edit_field_', '');
      const underscoreIdx = raw.indexOf('_');
      const pid = parseInt(raw.substring(0, underscoreIdx));
      const field = raw.substring(underscoreIdx + 1);
      const state = getState(userId);
      state.editingProductId = pid;
      state.editingField = field;
      state.waitingProductEdit = true;
      const labels = {
        name: 'Product Name',
        price_inr: 'Price (Rs)',
        stock: 'Stock Count',
        description: 'Description',
        content: 'Product Content'
      };
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
      await bot.sendMessage(userId,
        'Enter UPI Text ID to display to users (e.g. yourname@bank):'
      );
    } else if (data === 'adm_change_qr') {
      await showQrChangeMenu(userId, messageId);
    } else if (data.startsWith('adm_qr_method_')) {
      const method = data.replace('adm_qr_method_', '');
      const state = getState(userId);
      state.qrUploadMethod = method;
      state.waitingQrUpload = true;
      const names = { gpay: 'GPay', fampay: 'FamPay', any: 'Any UPI', bnb: 'BNB' };
      await bot.sendMessage(userId,
        `📸 Send the QR code image for *${names[method] || method}*:`,
        { parse_mode: 'Markdown' }
      );
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
    } else if (data === 'noop') {
      // separator button — do nothing
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
        {
          chat_id: userId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: backBtn()
        }
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

// ─── View Deposit Screenshot ──────────────────────────────────────────────────
async function viewDepositScreenshot(userId, refId) {
  const database = await db.getDB();
  const deposit = await database.get(
    `SELECT d.*, u.full_name, u.username 
     FROM deposits d 
     JOIN users u ON d.user_id = u.user_id 
     WHERE d.ref_id = ?`,
    refId
  );

  if (!deposit) {
    await bot.sendMessage(userId, '❌ Deposit not found.');
    return;
  }

  if (!deposit.screenshot_file_id) {
    await bot.sendMessage(userId,
      `⚠️ *No screenshot available*\n\nRef ID: \`${refId}\``,
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

  const keyboard = {
    inline_keyboard: [
      [
        { text: `✅ Approve Rs ${deposit.amount_inr.toFixed(0)}`, callback_data: `adm_approve_${refId}` },
        { text: '❌ Reject', callback_data: `adm_reject_${refId}` }
      ],
      [{ text: '« Back to Deposits', callback_data: 'adm_deposits' }]
    ]
  };

  await bot.sendPhoto(userId, deposit.screenshot_file_id, {
    caption: caption,
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
}

// ─── Approve Deposit ──────────────────────────────────────────────────────────
async function approveDeposit(userId, refId) {
  const database = await db.getDB();
  const deposit = await database.get(
    'SELECT * FROM deposits WHERE ref_id = ?', refId
  );

  if (!deposit || deposit.status !== 'pending') {
    await bot.sendMessage(userId, '⚠️ Deposit not found or already processed.');
    return;
  }

  await database.run(
    `UPDATE deposits SET status = 'approved', approved_at = CURRENT_TIMESTAMP WHERE ref_id = ?`,
    refId
  );
  await db.updateUserBalance(deposit.user_id, deposit.amount_inr);

  await notifyUser(deposit.user_id,
    `✅ *Payment Approved!*\n\n` +
    `Rs ${deposit.amount_inr.toFixed(0)} has been added to your wallet.\n` +
    `📝 Ref: \`${refId}\`\n\n` +
    `Thank you for your deposit!`
  );

  await bot.sendMessage(userId,
    `✅ *Approved!*\n\nRs ${deposit.amount_inr.toFixed(0)} added to user \`${deposit.user_id}\` wallet.`,
    {
      parse_mode: 'Markdown',
      reply_markup: backBtn('Back to Deposits', 'adm_deposits')
    }
  );
}

// ─── Reject Deposit ───────────────────────────────────────────────────────────
async function rejectDeposit(userId, refId) {
  const database = await db.getDB();
  const deposit = await database.get(
    'SELECT * FROM deposits WHERE ref_id = ?', refId
  );

  if (!deposit) {
    await bot.sendMessage(userId, '⚠️ Deposit not found.');
    return;
  }

  await database.run(
    `UPDATE deposits SET status = 'rejected' WHERE ref_id = ?`, refId
  );

  await notifyUser(deposit.user_id,
    `❌ *Payment Rejected*\n\n` +
    `Your deposit of Rs ${deposit.amount_inr.toFixed(0)} was not approved.\n` +
    `📝 Ref: \`${refId}\`\n\n` +
    `If you believe this is an error, please contact support with your Ref ID.`
  );

  await bot.sendMessage(userId,
    `❌ *Rejected!*\n\nDeposit \`${refId.substring(0, 25)}\` has been rejected.`,
    {
      parse_mode: 'Markdown',
      reply_markup: backBtn('Back to Deposits', 'adm_deposits')
    }
  );
}

// ─── Products Menu ────────────────────────────────────────────────────────────
async function showProductsMenu(userId, messageId) {
  const products = await db.getAllProducts();

  let text = `📦 *Products Management*\n\n`;
  const keyboard = [
    [
      { text: '➕ Add New Product', callback_data: 'adm_add_product' },
      { text: '📊 Sold Products', callback_data: 'adm_sold_products' }
    ]
  ];

  if (!products.length) {
    text += 'No products yet. Add your first product!';
  } else {
    for (const p of products) {
      const status = p.stock > 0 ? '🟢' : '🔴';
      text +=
        `${status} *${p.name}*\n` +
        `   💰 Rs ${p.price_inr.toFixed(0)} | 📦 Stock: ${p.stock} | Sold: ${p.total_sold}\n\n`;

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
      chat_id: userId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch {}
}

// ─── Sold Products ────────────────────────────────────────────────────────────
async function showSoldProducts(userId, messageId) {
  const sold = await db.getSoldProducts();

  let text = `📊 *Sold Products Report*\n\n`;

  if (!sold.length) {
    text += 'No products sold yet.';
  } else {
    let totalRevenue = 0;
    for (const p of sold) {
      text +=
        `📦 *${p.name}*\n` +
        `   🛒 Total Sold: ${p.total_sold}\n` +
        `   💰 Revenue: Rs ${(p.total_revenue || 0).toFixed(0)}\n\n`;
      totalRevenue += p.total_revenue || 0;
    }
    text += `*Total Revenue: Rs ${totalRevenue.toFixed(0)}*`;
  }

  try {
    await bot.editMessageText(text, {
      chat_id: userId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: backBtn('Back to Products', 'adm_products')
    });
  } catch {}
}

// ─── Add Product ──────────────────────────────────────────────────────────────
async function startAddProduct(userId) {
  const state = getState(userId);
  state.addingProduct = { step: 'name', data: {} };
  await bot.sendMessage(userId,
    `➕ *Add New Product*\n\n*Step 1/5:* Enter product name:`,
    { parse_mode: 'Markdown' }
  );
}

// ─── Edit Product ─────────────────────────────────────────────────────────────
async function showEditProduct(userId, pid) {
  const database = await db.getDB();
  const p = await database.get('SELECT * FROM products WHERE id = ?', pid);

  if (!p) {
    await bot.sendMessage(userId, '❌ Product not found.');
    return;
  }

  const text =
    `✏️ *Edit Product*\n\n` +
    `*Name:* ${p.name}\n` +
    `*Price:* Rs ${p.price_inr.toFixed(0)}\n` +
    `*Stock:* ${p.stock}\n` +
    `*Total Sold:* ${p.total_sold}\n` +
    `*Description:* ${p.description || 'N/A'}\n\n` +
    `Select field to edit:`;

  const keyboard = {
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
        { text: '➕ Add More Stock', callback_data: `adm_add_more_${pid}` },
        { text: '« Back', callback_data: 'adm_products' }
      ]
    ]
  };

  await bot.sendMessage(userId, text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
}

// ─── Confirm Delete Product ───────────────────────────────────────────────────
async function confirmDeleteProduct(userId, pid) {
  const database = await db.getDB();
  const p = await database.get('SELECT * FROM products WHERE id = ?', pid);
  if (!p) {
    await bot.sendMessage(userId, '❌ Product not found.');
    return;
  }

  await bot.sendMessage(userId,
    `⚠️ *Confirm Delete?*\n\nProduct: *${p.name}*\nStock: ${p.stock} remaining\n\nThis will deactivate the product.`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🗑️ Yes, Delete', callback_data: `adm_confirm_del_${pid}` },
            { text: '« Cancel', callback_data: `adm_edit_product_${pid}` }
          ]
        ]
      }
    }
  );
}

// ─── Delete Product ───────────────────────────────────────────────────────────
async function deleteProduct(userId, pid) {
  const database = await db.getDB();
  await database.run('UPDATE products SET is_active = 0 WHERE id = ?', pid);
  await bot.sendMessage(userId,
    `✅ Product deactivated successfully.`,
    { reply_markup: backBtn('Back to Products', 'adm_products') }
  );
}

// ─── Payment Methods ──────────────────────────────────────────────────────────
async function showPaymentMethods(userId, messageId) {
  const upi = await db.getSetting('upi_enabled') === '1' ? 'ON ✅' : 'OFF ❌';
  const bnb = await db.getSetting('bnb_enabled') === '1' ? 'ON ✅' : 'OFF ❌';
  const fampay = await db.getSetting('fampay_enabled') === '1' ? 'ON ✅' : 'OFF ❌';

  const text =
    `💳 *Payment Methods*\n\n` +
    `📱 UPI: ${upi}\n` +
    `💳 FamPay: ${fampay}\n` +
    `🟡 BNB Chain: ${bnb}\n\n` +
    `Tap to toggle or manage:`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: `📱 UPI ${upi}`, callback_data: 'adm_toggle_upi' },
        { text: `💳 FamPay ${fampay}`, callback_data: 'adm_toggle_fampay' }
      ],
      [{ text: `🟡 BNB ${bnb}`, callback_data: 'adm_toggle_bnb' }],
      [{ text: '⚙️ UPI Settings', callback_data: 'adm_upi_settings' }],
      [{ text: '📸 Change QR Codes', callback_data: 'adm_change_qr' }],
      [{ text: '🏦 Set BNB Address', callback_data: 'adm_set_bnb_addr' }],
      [{ text: '« Back', callback_data: 'adm_menu' }]
    ]
  };

  try {
    await bot.editMessageText(text, {
      chat_id: userId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  } catch {}
}

async function togglePayment(userId, messageId, key) {
  const current = await db.getSetting(key);
  await db.setSetting(key, current === '1' ? '0' : '1');
  await showPaymentMethods(userId, messageId);
}

// ─── UPI Settings ─────────────────────────────────────────────────────────────
async function showUpiSettings(userId, messageId) {
  const upiId = await db.getSetting('upi_id') || 'Not set';
  const upiTextId = await db.getSetting('upi_text_id') || 'Not set';

  const text =
    `⚙️ *UPI Settings*\n\n` +
    `*Primary UPI ID:* \`${upiId}\`\n` +
    `*Display Text ID:* \`${upiTextId}\`\n\n` +
    `• Primary UPI ID — internal reference\n` +
    `• Display Text ID — shown to users on payment screen`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '✏️ Change UPI ID', callback_data: 'adm_change_upi_id' }],
      [{ text: '🔤 Change Display Text ID', callback_data: 'adm_change_upi_text_id' }],
      [{ text: '« Back', callback_data: 'adm_payments' }]
    ]
  };

  try {
    await bot.editMessageText(text, {
      chat_id: userId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  } catch {}
}

// ─── QR Change Menu ───────────────────────────────────────────────────────────
async function showQrChangeMenu(userId, messageId) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: '📱 GPay QR', callback_data: 'adm_qr_method_gpay' },
        { text: '💳 FamPay QR', callback_data: 'adm_qr_method_fampay' }
      ],
      [
        { text: '📲 Any UPI QR', callback_data: 'adm_qr_method_any' },
        { text: '🟡 BNB QR', callback_data: 'adm_qr_method_bnb' }
      ],
      [{ text: '« Back', callback_data: 'adm_payments' }]
    ]
  };

  try {
    await bot.editMessageText(
      `📸 *Change QR Code*\n\nSelect which QR code to update:`,
      {
        chat_id: userId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }
    );
  } catch {}
}

// ─── Rate Settings ────────────────────────────────────────────────────────────
async function showRateSettings(userId, messageId) {
  const rate = await db.getSetting('usdt_to_inr_rate') || '90';
  try {
    await bot.editMessageText(
      `💱 *Rate Settings*\n\n*Current Rate:* 1 USDT = Rs ${rate}`,
      {
        chat_id: userId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✏️ Change Rate', callback_data: 'adm_set_rate' }],
            [{ text: '« Back', callback_data: 'adm_menu' }]
          ]
        }
      }
    );
  } catch {}
}

// ─── Referral Settings ────────────────────────────────────────────────────────
async function showReferralSettings(userId, messageId) {
  const enabled = await db.getSetting('referral_enabled') === '1';
  const reward = await db.getSetting('referral_reward_inr') || '10';

  try {
    await bot.editMessageText(
      `🎁 *Referral Settings*\n\n` +
      `Status: ${enabled ? '✅ Active' : '❌ Disabled'}\n` +
      `Reward per referral: *Rs ${reward}*`,
      {
        chat_id: userId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: enabled ? '❌ Disable' : '✅ Enable', callback_data: 'adm_toggle_referral' }],
            [{ text: '✏️ Change Reward Amount', callback_data: 'adm_set_ref_reward' }],
            [{ text: '« Back', callback_data: 'adm_menu' }]
          ]
        }
      }
    );
  } catch {}
}

// ─── Links Settings ───────────────────────────────────────────────────────────
async function showLinksSettings(userId, messageId) {
  const group = await db.getSetting('group_link') || 'Not set';
  const channel = await db.getSetting('channel_link') || 'Not set';
  const support = await db.getSetting('support_link') || 'Not set';

  try {
    await bot.editMessageText(
      `🔗 *Links Settings*\n\n` +
      `👥 Group: ${group}\n` +
      `📢 Channel: ${channel}\n` +
      `📞 Support: ${support}`,
      {
        chat_id: userId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '👥 Change Group Link', callback_data: 'adm_change_group' }],
            [{ text: '📢 Change Channel Link', callback_data: 'adm_change_channel' }],
            [{ text: '📞 Change Support Link', callback_data: 'adm_change_support' }],
            [{ text: '« Back', callback_data: 'adm_menu' }]
          ]
        }
      }
    );
  } catch {}
}

// ─── Users Menu ───────────────────────────────────────────────────────────────
async function showUsersMenu(userId, messageId) {
  const users = await db.getAllUsers();

  let text = `👥 *Users (${users.length} total)*\n\n`;
  const keyboard = [];

  const recent = users.slice(0, 10);
  for (const u of recent) {
    const status = u.is_banned ? '🚫' : '✅';
    text += `${status} ${u.full_name} | Rs ${u.balance_inr.toFixed(0)}\n`;
    keyboard.push([{
      text: `${status} ${u.full_name}`,
      callback_data: `adm_user_${u.user_id}`
    }]);
  }

  if (users.length > 10) {
    text += `\n_Showing 10 of ${users.length} users_`;
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

// ─── User Detail ──────────────────────────────────────────────────────────────
async function showUserDetail(userId, targetUid) {
  const u = await db.getUser(targetUid);
  if (!u) {
    await bot.sendMessage(userId, '❌ User not found.');
    return;
  }

  const text =
    `👤 *User Detail*\n\n` +
    `Name: ${u.full_name}\n` +
    `Username: @${u.username || 'N/A'}\n` +
    `ID: \`${u.user_id}\`\n` +
    `Joined: ${utils.formatDateTime(u.joined_at)}\n\n` +
    `💰 Balance: Rs ${u.balance_inr.toFixed(0)}\n` +
    `📥 Deposited: Rs ${u.total_deposited.toFixed(0)}\n` +
    `💸 Spent: Rs ${u.total_spent.toFixed(0)}\n` +
    `🛍️ Purchases: ${u.total_purchases}\n` +
    `👥 Referrals: ${u.referral_count}\n\n` +
    `Status: ${u.is_banned ? '🚫 Banned' : u.is_restricted ? '⚠️ Restricted' : '✅ Active'}`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: u.is_banned ? '✅ Unban' : '🚫 Ban', callback_data: `adm_ban_${targetUid}` },
        { text: u.is_restricted ? '✅ Unrestrict' : '⚠️ Restrict', callback_data: `adm_restrict_${targetUid}` }
      ],
      [{ text: '💬 Send Message', callback_data: `adm_msg_${targetUid}` }],
      [{ text: '« Back to Users', callback_data: 'adm_users' }]
    ]
  };

  await bot.sendMessage(userId, text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
}

// ─── Ban/Restrict ─────────────────────────────────────────────────────────────
async function toggleBanUser(userId, targetUid) {
  const database = await db.getDB();
  const u = await db.getUser(targetUid);
  if (!u) return;
  const newBan = u.is_banned ? 0 : 1;
  await database.run('UPDATE users SET is_banned = ? WHERE user_id = ?', newBan, targetUid);
  await bot.sendMessage(userId,
    `${newBan ? '🚫 User banned' : '✅ User unbanned'}: \`${targetUid}\``,
    { parse_mode: 'Markdown', reply_markup: backBtn('Back to Users', 'adm_users') }
  );
}

async function toggleRestrictUser(userId, targetUid) {
  const database = await db.getDB();
  const u = await db.getUser(targetUid);
  if (!u) return;
  const newRestrict = u.is_restricted ? 0 : 1;
  await database.run('UPDATE users SET is_restricted = ? WHERE user_id = ?', newRestrict, targetUid);
  await bot.sendMessage(userId,
    `${newRestrict ? '⚠️ User restricted' : '✅ User unrestricted'}: \`${targetUid}\``,
    { parse_mode: 'Markdown', reply_markup: backBtn('Back to Users', 'adm_users') }
  );
}

// ─── Stats ────────────────────────────────────────────────────────────────────
async function showStats(userId, messageId) {
  const stats = await db.getStats();

  const text =
    `📊 *Bot Statistics*\n\n` +
    `👥 Total Users: ${stats.totalUsers}\n` +
    `📥 Pending Deposits: ${stats.pendingDeposits}\n` +
    `💰 Total Deposited: Rs ${stats.totalDeposits.toFixed(0)}\n` +
    `💸 Total Revenue: Rs ${stats.totalRevenue.toFixed(0)}\n` +
    `🛍️ Total Sales: ${stats.totalSalesCount}\n` +
    `📦 Active Products: ${stats.totalProducts}`;

  try {
    await bot.editMessageText(text, {
      chat_id: userId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: backBtn()
    });
  } catch {}
}

// ─── Password Settings ────────────────────────────────────────────────────────
async function showPasswordSettings(userId, messageId) {
  try {
    await bot.editMessageText(
      `🔑 *Password Settings*\n\nChange your admin panel password:`,
      {
        chat_id: userId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✏️ Change Password', callback_data: 'adm_change_password' }],
            [{ text: '« Back', callback_data: 'adm_menu' }]
          ]
        }
      }
    );
  } catch {}
}

// ─── Broadcast ────────────────────────────────────────────────────────────────
async function startBroadcast(userId, messageId) {
  getState(userId).waitingBroadcast = true;
  try {
    await bot.editMessageText(
      `📢 *Broadcast Message*\n\nType your message to send to ALL users:`,
      {
        chat_id: userId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: backBtn()
      }
    );
  } catch {}
}

// ─── Message Handler ──────────────────────────────────────────────────────────
bot.on('message', async (msg) => {
  if (!msg.from) return;
  const userId = msg.from.id;
  if (!isOwner(userId)) return;

  const state = getState(userId);

  // ─── Photo — QR Upload ───────────────────────────────────────────────────
  if (msg.photo) {
    if (state.waitingQrUpload) {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const method = state.qrUploadMethod;
      await db.setSetting(`qr_${method}`, fileId);
      clearState(userId);
      await bot.sendMessage(userId,
        `✅ QR code updated for *${method}*!`,
        {
          parse_mode: 'Markdown',
          reply_markup: backBtn('Back to Payments', 'adm_payments')
        }
      );
    }
    return;
  }

  if (!msg.text) return;
  const text = msg.text.trim();

  // ─── Password Auth ───────────────────────────────────────────────────────
  if (state.waitingPassword) {
    if (text === config.ADMIN_PASSWORD) {
      authenticatedUsers.add(userId);
      clearState(userId);
      await bot.sendMessage(userId, '✅ Authenticated! Welcome.');
      await showAdminMenu(userId);
    } else {
      await bot.sendMessage(userId, '❌ Wrong password. Try again:');
    }
    return;
  }

  if (!authenticatedUsers.has(userId)) {
    await bot.sendMessage(userId, 'Please /start to authenticate.');
    return;
  }

  // ─── Add Stock ───────────────────────────────────────────────────────────
  if (state.waitingAddStock) {
    const addCount = parseInt(text);
    if (isNaN(addCount) || addCount <= 0) {
      await bot.sendMessage(userId, '❌ Enter a valid positive number.');
      return;
    }
    const database = await db.getDB();
    await database.run(
      'UPDATE products SET stock = stock + ? WHERE id = ?',
      addCount, state.addingStockToProduct
    );
    clearState(userId);
    await bot.sendMessage(userId,
      `✅ Added *${addCount}* stock successfully!`,
      {
        parse_mode: 'Markdown',
        reply_markup: backBtn('Back to Products', 'adm_products')
      }
    );
    return;
  }

  // ─── Product Edit ────────────────────────────────────────────────────────
  if (state.waitingProductEdit) {
    const { editingProductId, editingField } = state;
    const database = await db.getDB();
    let value = text;
    if (editingField === 'price_inr' || editingField === 'stock') {
      value = parseFloat(text);
      if (isNaN(value)) {
        await bot.sendMessage(userId, '❌ Enter a valid number.');
        return;
      }
    }
    await database.run(
      `UPDATE products SET ${editingField} = ? WHERE id = ?`,
      value, editingProductId
    );
    clearState(userId);
    await bot.sendMessage(userId,
      `✅ Updated successfully!`,
      {
        parse_mode: 'Markdown',
        reply_markup: backBtn('Back to Products', 'adm_products')
      }
    );
    return;
  }

  // ─── Add Product Flow ────────────────────────────────────────────────────
  if (state.addingProduct) {
    const ap = state.addingProduct;
    const steps = ['name', 'price_inr', 'stock', 'description', 'content'];
    const labels = ['Product Name', 'Price (Rs)', 'Stock Count', 'Description', 'Product Content'];
    const currentIdx = steps.indexOf(ap.step);

    ap.data[ap.step] = text;

    if (currentIdx < steps.length - 1) {
      ap.step = steps[currentIdx + 1];
      await bot.sendMessage(userId,
        `*Step ${currentIdx + 2}/${steps.length}:* Enter ${labels[currentIdx + 1]}:`,
        { parse_mode: 'Markdown' }
      );
    } else {
      const database = await db.getDB();
      await database.run(
        `INSERT INTO products (name, price_inr, stock, description, content) 
         VALUES (?, ?, ?, ?, ?)`,
        ap.data.name,
        parseFloat(ap.data.price_inr) || 0,
        parseInt(ap.data.stock) || 0,
        ap.data.description,
        ap.data.content
      );
      clearState(userId);
      await bot.sendMessage(userId,
        `✅ *Product added successfully!*\n\n` +
        `📦 Name: ${ap.data.name}\n` +
        `💰 Price: Rs ${ap.data.price_inr}\n` +
        `📊 Stock: ${ap.data.stock}`,
        {
          parse_mode: 'Markdown',
          reply_markup: backBtn('Back to Products', 'adm_products')
        }
      );
    }
    return;
  }

  // ─── Settings Input ──────────────────────────────────────────────────────
  if (state.waitingRate) {
    const rate = parseFloat(text);
    if (isNaN(rate) || rate <= 0) {
      await bot.sendMessage(userId, '❌ Enter a valid rate (e.g. 90):');
      return;
    }
    await db.setSetting('usdt_to_inr_rate', rate.toString());
    clearState(userId);
    await bot.sendMessage(userId,
      `✅ Rate updated: 1 USDT = Rs ${rate}`,
      { reply_markup: backBtn() }
    );
    return;
  }

  if (state.waitingRefReward) {
    const reward = parseFloat(text);
    if (isNaN(reward) || reward < 0) {
      await bot.sendMessage(userId, '❌ Enter a valid amount:');
      return;
    }
    await db.setSetting('referral_reward_inr', reward.toString());
    clearState(userId);
    await bot.sendMessage(userId,
      `✅ Referral reward updated: Rs ${reward}`,
      { reply_markup: backBtn() }
    );
    return;
  }

  if (state.waitingUpiId) {
    await db.setSetting('upi_id', text);
    clearState(userId);
    await bot.sendMessage(userId,
      `✅ UPI ID updated: \`${text}\``,
      {
        parse_mode: 'Markdown',
        reply_markup: backBtn('Back to Payments', 'adm_payments')
      }
    );
    return;
  }

  if (state.waitingUpiTextId) {
    await db.setSetting('upi_text_id', text);
    clearState(userId);
    await bot.sendMessage(userId,
      `✅ Display UPI Text ID updated: \`${text}\``,
      {
        parse_mode: 'Markdown',
        reply_markup: backBtn('Back to Payments', 'adm_payments')
      }
    );
    return;
  }

  if (state.waitingBnbAddress) {
    await db.setSetting('bnb_address', text);
    clearState(userId);
    await bot.sendMessage(userId,
      `✅ BNB Address updated: \`${text}\``,
      {
        parse_mode: 'Markdown',
        reply_markup: backBtn('Back to Payments', 'adm_payments')
      }
    );
    return;
  }

  if (state.waitingGroupLink) {
    await db.setSetting('group_link', text);
    clearState(userId);
    await bot.sendMessage(userId, `✅ Group link updated.`, { reply_markup: backBtn() });
    return;
  }

  if (state.waitingChannelLink) {
    await db.setSetting('channel_link', text);
    clearState(userId);
    await bot.sendMessage(userId, `✅ Channel link updated.`, { reply_markup: backBtn() });
    return;
  }

  if (state.waitingSupportLink) {
    await db.setSetting('support_link', text);
    clearState(userId);
    await bot.sendMessage(userId, `✅ Support link updated.`, { reply_markup: backBtn() });
    return;
  }

  if (state.waitingNewPassword) {
    if (text.length < 4) {
      await bot.sendMessage(userId, '❌ Password too short. Minimum 4 characters:');
      return;
    }
    config.ADMIN_PASSWORD = text;
    clearState(userId);
    await bot.sendMessage(userId,
      `✅ Password updated!\n\n⚠️ Update your Render env variable too to make it permanent.`,
      { reply_markup: backBtn() }
    );
    return;
  }

  // ─── Broadcast ───────────────────────────────────────────────────────────
  if (state.waitingBroadcast) {
    const users = await db.getAllUsers();
    clearState(userId);

    await bot.sendMessage(userId, `📢 Sending to ${users.length} users...`);

    let success = 0;
    let failed = 0;

    for (const u of users) {
      try {
        await fetch(`https://api.telegram.org/bot${config.USER_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: u.user_id,
            text: text,
            parse_mode: 'Markdown'
          })
        });
        success++;
        await new Promise(r => setTimeout(r, 50));
      } catch {
        failed++;
      }
    }

    await bot.sendMessage(userId,
      `📢 *Broadcast Complete!*\n\n✅ Sent: ${success}\n❌ Failed: ${failed}`,
      { parse_mode: 'Markdown', reply_markup: backBtn() }
    );
    return;
  }

  // ─── Send Message to User ─────────────────────────────────────────────────
  if (state.waitingSendMsg) {
    const targetId = state.sendMsgTo;
    clearState(userId);
    await notifyUser(targetId, `📨 *Message from Admin:*\n\n${text}`);
    await bot.sendMessage(userId,
      `✅ Message sent to user \`${targetId}\``,
      {
        parse_mode: 'Markdown',
        reply_markup: backBtn('Back to Users', 'adm_users')
      }
    );
    return;
  }

  // ─── Unknown ──────────────────────────────────────────────────────────────
  await bot.sendMessage(userId, `ℹ️ Use /start to access the admin panel.`);
});

module.exports = { bot };
