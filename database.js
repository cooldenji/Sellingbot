const path = require('path');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const config = require('./config');

let db;

async function getDB() {
  if (!db) {
    db = await open({
      filename: config.DATABASE_FILE,
      driver: sqlite3.Database
    });
  }
  return db;
}

async function initDB() {
  const database = await getDB();

  await database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY,
      username TEXT DEFAULT '',
      full_name TEXT DEFAULT '',
      balance_inr REAL DEFAULT 0,
      total_deposited REAL DEFAULT 0,
      total_spent REAL DEFAULT 0,
      total_purchases INTEGER DEFAULT 0,
      referral_count INTEGER DEFAULT 0,
      referral_earned REAL DEFAULT 0,
      referred_by INTEGER DEFAULT NULL,
      terms_accepted INTEGER DEFAULT 0,
      is_banned INTEGER DEFAULT 0,
      is_restricted INTEGER DEFAULT 0,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price_inr REAL NOT NULL,
      stock INTEGER DEFAULT 0,
      description TEXT DEFAULT '',
      content TEXT DEFAULT '',
      total_sold INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount_inr REAL NOT NULL,
      ref_id TEXT UNIQUE NOT NULL,
      method TEXT DEFAULT 'upi',
      screenshot_file_id TEXT DEFAULT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      approved_at DATETIME DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      amount_inr REAL NOT NULL,
      content_delivered TEXT DEFAULT '',
      purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const defaults = [
    ['upi_enabled', '1'],
    ['bnb_enabled', '0'],
    ['fampay_enabled', '0'],
    ['upi_id', ''],
    ['bnb_address', ''],
    ['usdt_to_inr_rate', '90'],
    ['min_deposit_inr', '20'],
    ['referral_enabled', '1'],
    ['referral_reward_inr', '10'],
    ['group_link', config.GROUP_LINK],
    ['channel_link', config.CHANNEL_LINK],
    ['support_link', config.SUPPORT_LINK],
    ['bot_name', config.BOT_NAME],
    ['qr_gpay', ''],
    ['qr_fampay', ''],
    ['qr_any', ''],
    ['qr_bnb', ''],
    ['upi_text_id', '']
  ];

  for (const [key, value] of defaults) {
    await database.run(
      'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
      key, value
    );
  }

  console.log('✅ Database initialized successfully');
}

async function getSetting(key) {
  const database = await getDB();
  const row = await database.get('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : null;
}

async function setSetting(key, value) {
  const database = await getDB();
  await database.run(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    key, value
  );
}

async function getUser(userId) {
  const database = await getDB();
  return await database.get('SELECT * FROM users WHERE user_id = ?', userId);
}

async function createUser(userId, username, fullName, referredBy) {
  const database = await getDB();
  await database.run(
    `INSERT OR IGNORE INTO users 
     (user_id, username, full_name, referred_by) 
     VALUES (?, ?, ?, ?)`,
    userId, username, fullName, referredBy
  );
}

async function getAllUsers() {
  const database = await getDB();
  return await database.all('SELECT * FROM users ORDER BY joined_at DESC');
}

async function updateUserBalance(userId, amount) {
  const database = await getDB();
  await database.run(
    `UPDATE users 
     SET balance_inr = balance_inr + ?, 
         total_deposited = total_deposited + ? 
     WHERE user_id = ?`,
    amount, amount, userId
  );
}

async function deductUserBalance(userId, amount) {
  const database = await getDB();
  await database.run(
    `UPDATE users 
     SET balance_inr = balance_inr - ?, 
         total_spent = total_spent + ?,
         total_purchases = total_purchases + 1
     WHERE user_id = ?`,
    amount, amount, userId
  );
}

async function getActiveProducts() {
  const database = await getDB();
  return await database.all(
    'SELECT * FROM products WHERE is_active = 1 AND stock > 0 ORDER BY id ASC'
  );
}

async function getAllProducts() {
  const database = await getDB();
  return await database.all(
    'SELECT * FROM products WHERE is_active = 1 ORDER BY id ASC'
  );
}

async function getPendingDeposits() {
  const database = await getDB();
  return await database.all(
    `SELECT d.*, u.full_name, u.username 
     FROM deposits d 
     JOIN users u ON d.user_id = u.user_id 
     WHERE d.status = 'pending' 
     ORDER BY d.created_at ASC`
  );
}

async function getSoldProducts() {
  const database = await getDB();
  return await database.all(
    `SELECT p.id, p.name, p.price_inr, p.total_sold,
            COUNT(pu.id) as purchase_count,
            SUM(pu.amount_inr) as total_revenue
     FROM products p
     LEFT JOIN purchases pu ON p.id = pu.product_id
     WHERE p.total_sold > 0
     GROUP BY p.id
     ORDER BY p.total_sold DESC`
  );
}

async function getStats() {
  const database = await getDB();

  const totalUsers = await database.get('SELECT COUNT(*) as count FROM users');
  const totalDeposits = await database.get(
    "SELECT SUM(amount_inr) as total FROM deposits WHERE status = 'approved'"
  );
  const totalSales = await database.get(
    'SELECT SUM(amount_inr) as total, COUNT(*) as count FROM purchases'
  );
  const pendingCount = await database.get(
    "SELECT COUNT(*) as count FROM deposits WHERE status = 'pending'"
  );
  const totalProducts = await database.get(
    'SELECT COUNT(*) as count FROM products WHERE is_active = 1'
  );

  return {
    totalUsers: totalUsers.count || 0,
    totalDeposits: totalDeposits.total || 0,
    totalRevenue: totalSales.total || 0,
    totalSalesCount: totalSales.count || 0,
    pendingDeposits: pendingCount.count || 0,
    totalProducts: totalProducts.count || 0
  };
}

module.exports = {
  getDB,
  initDB,
  getSetting,
  setSetting,
  getUser,
  createUser,
  getAllUsers,
  updateUserBalance,
  deductUserBalance,
  getActiveProducts,
  getAllProducts,
  getPendingDeposits,
  getSoldProducts,
  getStats
};
