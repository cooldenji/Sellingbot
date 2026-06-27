// shared/db.js
// Simple file-based JSON database shared between User Bot and Admin Bot.
// Both bots require() this same file and point DATA_DIR at the same folder,
// so data (products, users, orders, deposits, settings) stays in sync.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

const FILES = {
  products: path.join(DATA_DIR, 'products.json'),
  users: path.join(DATA_DIR, 'users.json'),
  deposits: path.join(DATA_DIR, 'deposits.json'),
  orders: path.join(DATA_DIR, 'orders.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
  admins: path.join(DATA_DIR, 'admins.json'),
  bans: path.join(DATA_DIR, 'bans.json'),
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function ensureFile(filePath, defaultData) {
  ensureDataDir();
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
  }
}

function initDB() {
  ensureFile(FILES.products, []);
  ensureFile(FILES.users, {});
  ensureFile(FILES.deposits, {});
  ensureFile(FILES.orders, {});
  ensureFile(FILES.bans, {});
  ensureFile(FILES.admins, {
    // ownerId is set on first admin-bot login via OWNER_ID in .env
    owners: [],
    hiredAdmins: [], // [{ id, username, addedBy, addedAt }]
  });
  ensureFile(FILES.settings, {
    upiId: 'yourupi@bank',
    upiQrFileId: '', // telegram file_id of the UPI QR image, uploaded by admin
    binancePayId: '',
    binanceAccountName: '',
    binanceQrFileId: '',
    channelUrl: 'https://t.me/YourChannel',
    groupUrl: 'https://t.me/YourGroup',
    botUsername: 'YourBot_bot',
    supportUsername: 'YourSupportUsername',
    minDeposit: 20,
    usdtRate: 90.0, // 1 USDT = X INR
    referralRewardUsd: 0.01,
    referralRewardInr: 1,
    qrValidityMinutes: 15,
  });
}

// --- generic read/write helpers ---
function readJSON(filePath) {
  ensureDataDir();
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function writeJSON(filePath, data) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// --- Products ---
function getProducts() {
  return readJSON(FILES.products) || [];
}
function saveProducts(products) {
  writeJSON(FILES.products, products);
}
function addProduct(product) {
  const products = getProducts();
  const id = 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const newProduct = {
    id,
    name: product.name,
    emoji: product.emoji || '📦',
    category: product.category || 'General',
    priceUsd: Number(product.priceUsd) || 0,
    priceInr: Number(product.priceInr) || 0,
    stock: Number(product.stock) || 0,
    description: product.description || '',
    deliveryType: product.deliveryType || 'manual', // 'manual' | 'auto-file' | 'auto-text'
    deliveryFileId: product.deliveryFileId || '', // telegram file_id, if auto-file
    deliveryText: product.deliveryText || '', // text/key/code, if auto-text
    active: true,
    createdAt: Date.now(),
    sold: 0,
  };
  products.push(newProduct);
  saveProducts(products);
  return newProduct;
}
function getProductById(id) {
  return getProducts().find((p) => p.id === id);
}
function updateProduct(id, updates) {
  const products = getProducts();
  const idx = products.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  products[idx] = { ...products[idx], ...updates };
  saveProducts(products);
  return products[idx];
}
function deleteProduct(id) {
  const products = getProducts().filter((p) => p.id !== id);
  saveProducts(products);
}
function decrementStock(id, qty = 1) {
  const products = getProducts();
  const idx = products.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  products[idx].stock = Math.max(0, products[idx].stock - qty);
  products[idx].sold = (products[idx].sold || 0) + qty;
  saveProducts(products);
  return products[idx];
}

// --- Users ---
function getUsers() {
  return readJSON(FILES.users) || {};
}
function saveUsers(users) {
  writeJSON(FILES.users, users);
}
function getUser(userId) {
  const users = getUsers();
  return users[String(userId)] || null;
}
function createUserIfNotExists(userId, profile = {}) {
  const users = getUsers();
  const key = String(userId);
  if (!users[key]) {
    users[key] = {
      id: userId,
      username: profile.username || '',
      firstName: profile.firstName || '',
      joinedAt: Date.now(),
      balanceUsd: 0,
      balanceInr: 0,
      depositedUsd: 0,
      depositedInr: 0,
      spentUsd: 0,
      spentInr: 0,
      purchases: 0,
      referredBy: profile.referredBy || null,
      referrals: 0,
      referralEarnedUsd: 0,
      referralEarnedInr: 0,
      referralsToday: 0,
      referralsThisWeek: 0,
      lastReferralDay: null,
      lastReferralWeek: null,
      acceptedTerms: false,
      joinedChannel: false,
      joinedGroup: false,
      state: null, // for multi-step flows e.g. "awaiting_session_qty"
      stateData: {},
    };
    saveUsers(users);
  }
  return users[key];
}
function updateUser(userId, updates) {
  const users = getUsers();
  const key = String(userId);
  if (!users[key]) return null;
  users[key] = { ...users[key], ...updates };
  saveUsers(users);
  return users[key];
}
function setUserState(userId, state, stateData = {}) {
  return updateUser(userId, { state, stateData });
}
function clearUserState(userId) {
  return updateUser(userId, { state: null, stateData: {} });
}
function addBalance(userId, usd, inr) {
  const user = getUser(userId);
  if (!user) return null;
  return updateUser(userId, {
    balanceUsd: round2(user.balanceUsd + usd),
    balanceInr: Math.round(user.balanceInr + inr),
  });
}
function deductBalance(userId, usd, inr) {
  const user = getUser(userId);
  if (!user) return null;
  return updateUser(userId, {
    balanceUsd: round2(Math.max(0, user.balanceUsd - usd)),
    balanceInr: Math.round(Math.max(0, user.balanceInr - inr)),
  });
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// --- Deposits ---
function getDeposits() {
  return readJSON(FILES.deposits) || {};
}
function saveDeposits(deposits) {
  writeJSON(FILES.deposits, deposits);
}
function createDeposit(deposit) {
  const deposits = getDeposits();
  const id = 'dep-' + deposit.userId + '-' + Date.now();
  deposits[id] = {
    id,
    userId: deposit.userId,
    username: deposit.username || '',
    method: deposit.method, // 'upi' | 'binance'
    amountInr: deposit.amountInr || 0,
    amountUsd: deposit.amountUsd || 0,
    screenshotFileId: deposit.screenshotFileId || '',
    status: 'pending', // 'pending' | 'approved' | 'rejected'
    createdAt: Date.now(),
    decidedAt: null,
    decidedBy: null,
    prevBalanceUsd: deposit.prevBalanceUsd || 0,
    prevBalanceInr: deposit.prevBalanceInr || 0,
  };
  saveDeposits(deposits);
  return deposits[id];
}
function getDeposit(id) {
  const deposits = getDeposits();
  return deposits[id] || null;
}
function updateDeposit(id, updates) {
  const deposits = getDeposits();
  if (!deposits[id]) return null;
  deposits[id] = { ...deposits[id], ...updates };
  saveDeposits(deposits);
  return deposits[id];
}
function getPendingDeposits() {
  const deposits = getDeposits();
  return Object.values(deposits).filter((d) => d.status === 'pending');
}

// --- Orders ---
function getOrders() {
  return readJSON(FILES.orders) || {};
}
function saveOrders(orders) {
  writeJSON(FILES.orders, orders);
}
function createOrder(order) {
  const orders = getOrders();
  const id = 'ord-' + order.userId + '-' + Date.now();
  orders[id] = {
    id,
    userId: order.userId,
    username: order.username || '',
    productId: order.productId,
    productName: order.productName,
    qty: order.qty || 1,
    amountUsd: order.amountUsd || 0,
    amountInr: order.amountInr || 0,
    status: order.status || 'completed', // 'completed' | 'pending_delivery'
    createdAt: Date.now(),
  };
  saveOrders(orders);
  return orders[id];
}
function updateOrder(orderId, updates) {
  const orders = getOrders();
  if (orders[orderId]) {
    orders[orderId] = { ...orders[orderId], ...updates };
    saveOrders(orders);
  }
  return orders[orderId];
}

// --- Settings ---
function getSettings() {
  return readJSON(FILES.settings) || {};
}
function updateSettings(updates) {
  const settings = getSettings();
  const merged = { ...settings, ...updates };
  writeJSON(FILES.settings, merged);
  return merged;
}

// --- Admins (hired admins, separate from the single Owner) ---
function getAdminData() {
  return readJSON(FILES.admins) || { owners: [], hiredAdmins: [] };
}
function saveAdminData(data) {
  writeJSON(FILES.admins, data);
}
function isOwner(userId) {
  const data = getAdminData();
  return data.owners.includes(Number(userId));
}
function ensureOwner(userId) {
  const data = getAdminData();
  if (!data.owners.includes(Number(userId))) {
    data.owners.push(Number(userId));
    saveAdminData(data);
  }
}
function isHiredAdmin(userId) {
  const data = getAdminData();
  return data.hiredAdmins.some((a) => a.id === Number(userId));
}
function isAdminOrOwner(userId) {
  return isOwner(userId) || isHiredAdmin(userId);
}
function addHiredAdmin(id, username, addedBy) {
  const data = getAdminData();
  if (!data.hiredAdmins.some((a) => a.id === Number(id))) {
    data.hiredAdmins.push({ id: Number(id), username: username || '', addedBy, addedAt: Date.now() });
    saveAdminData(data);
  }
  return data;
}
function removeHiredAdmin(id) {
  const data = getAdminData();
  data.hiredAdmins = data.hiredAdmins.filter((a) => a.id !== Number(id));
  saveAdminData(data);
  return data;
}
function listHiredAdmins() {
  return getAdminData().hiredAdmins;
}

// --- Bans / restrictions ---
function getBans() {
  return readJSON(FILES.bans) || {};
}
function saveBans(bans) {
  writeJSON(FILES.bans, bans);
}
function banUser(userId, reason, by) {
  const bans = getBans();
  bans[String(userId)] = { banned: true, reason: reason || 'Violation of terms', by, at: Date.now() };
  saveBans(bans);
}
function unbanUser(userId) {
  const bans = getBans();
  delete bans[String(userId)];
  saveBans(bans);
}
function isBanned(userId) {
  const bans = getBans();
  return !!(bans[String(userId)] && bans[String(userId)].banned);
}

module.exports = {
  initDB,
  // products
  getProducts,
  saveProducts,
  addProduct,
  getProductById,
  updateProduct,
  deleteProduct,
  decrementStock,
  // users
  getUsers,
  saveUsers,
  getUser,
  createUserIfNotExists,
  updateUser,
  setUserState,
  clearUserState,
  addBalance,
  deductBalance,
  // deposits
  getDeposits,
  createDeposit,
  getDeposit,
  updateDeposit,
  getPendingDeposits,
  // orders
  getOrders,
  createOrder,
  updateOrder,
  // bans export
  getBans,
  // settings
  getSettings,
  updateSettings,
  // admins
  isOwner,
  ensureOwner,
  isHiredAdmin,
  isAdminOrOwner,
  addHiredAdmin,
  removeHiredAdmin,
  listHiredAdmins,
  // bans
  banUser,
  unbanUser,
  isBanned,
  // util
  round2,
};
