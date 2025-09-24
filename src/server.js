// src/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const ticketsRoutes = require('./routes/tickets');
const drawRoutes = require('./routes/draws');
const redemptionRoutes = require('./routes/redemptions');
const walletRoutes = require('./routes/wallet');
const adminRoutes = require('./routes/admin');
const prizeRoutes = require('./routes/prize');

const app = express();

// Middlewares
app.use(express.json());
app.use(cors({ 
  origin: [
    "http://localhost:5173", 
    "http://localhost:3000", 
    "http://10.0.2.2:3000",
    "http://localhost:50569", // Flutter web debug port
    /^http:\/\/localhost:\d+$/, // Allow any localhost port
    /^http:\/\/127\.0\.0\.1:\d+$/ // Allow any 127.0.0.1 port
  ], 
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
// Disable helmet for development to avoid CORS issues
// app.use(helmet());
app.use(compression());

// Routes
app.get('/', (req, res) => res.json({ ok: true, name: 'lotto-backend', message: 'Server is running!' }));
app.use('/auth', authRoutes);
app.use('/', usersRoutes);
app.use('/', ticketsRoutes);
app.use('/', drawRoutes);
app.use('/', redemptionRoutes);
app.use('/', walletRoutes);
app.use('/', prizeRoutes);
app.use('/admin', adminRoutes);

// (ถ้าจะทดสอบ DB ค่อยเติมให้หลังจากนี้)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API on :${PORT}`));
const pool = require('./db');   // ใส่หลัง require(...) อื่น ๆ