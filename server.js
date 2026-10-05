// server.js
require('dotenv').config();

const dns = require("dns");

dns.setServers([
  "1.1.1.1",
  "8.8.8.8"
]);

const connectDB = require("./config/db");
const app = require('./app');

connectDB();

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`[Server] toronto API running on port ${PORT}`);
});
