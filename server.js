// server.js
require('dotenv').config();

const dns = require("dns");

dns.setServers([
  "1.1.1.1",
  "8.8.8.8"
]);

const express = require("express");
const cors = require("cors");
const path = require("path");
const connectDB = require("./config/db");

connectDB();

const app = express();

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "toronto API is running.",
    phase: "Phase 5 - Products & Collections Complete",
  });
});

// ---------------------------------------------------------------------------
// Route mounting
// ---------------------------------------------------------------------------
app.use("/api/auth",        require("./routes/authRoutes"));
app.use("/api/affiliates",  require("./routes/affiliateRoutes"));
app.use("/api/admin",       require("./routes/adminRoutes"));
app.use("/api/orders",      require("./routes/orderRoutes"));
app.use("/api/products",    require("./routes/productRoutes"));
app.use("/api/collections", require("./routes/collectionRoutes"));

// Fallback 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`[Server] toronto API running on port ${PORT}`);
});