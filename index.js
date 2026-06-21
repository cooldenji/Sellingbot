const http = require('http');
const { initDB } = require('./database');

async function main() {
  console.log('🚀 Initializing database...');
  await initDB();

  console.log('🤖 Starting User Bot...');
  require('./userBot');

  console.log('👑 Starting Admin Bot...');
  require('./adminBot');

  console.log('✅ Both bots are running!');

  const PORT = process.env.PORT || 3000;
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Zed Zoee Bot is running ✅');
  }).listen(PORT, () => {
    console.log(`🌐 Health check server on port ${PORT}`);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
