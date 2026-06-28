require('dotenv').config();

const dns = require("dns");

dns.setServers([
  "1.1.1.1",
  "8.8.8.8"
]);

const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");

// ---------------------------------------------------------------------------
// toronto Backend — Phases 1-4 Complete
// Initializes Express, connects to MongoDB (toronto_db), and mounts:
//   /api/auth        - registration & login
//   /api/affiliates  - affiliate self-service (apply)
//   /api/admin       - Manager/Admin management (applications, settings,
//                      admin creation, order status + wallet settlement)
//   /api/orders      - customer checkout (Affiliate Engine)
// Product/User CRUD routes remain for a future phase.
// ---------------------------------------------------------------------------

// Connect to MongoDB before starting the server
connectDB();

const app = express();

// ---------------------------------------------------------------------------
// CORS Configuration
// Allow requests from the React frontend
// ---------------------------------------------------------------------------
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

// Core middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health-check / root route
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "toronto API is running.",
    phase: "Phase 4 - Management & Wallet Control Complete",
  });
});

// ---------------------------------------------------------------------------
// Route mounting
// ---------------------------------------------------------------------------
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/affiliates", require("./routes/affiliateRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/orders", require("./routes/orderRoutes"));

// ---------------------------------------------------------------------------
// Future phase placeholder
// ---------------------------------------------------------------------------
// app.use('/api/users', require('./routes/userRoutes'));
// app.use('/api/products', require('./routes/productRoutes'));

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