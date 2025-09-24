// src/server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');

// Routes
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const ticketsRoutes = require('./routes/tickets');
const drawRoutes = require('./routes/draws');
const redemptionRoutes = require('./routes/redemptions');
const walletRoutes = require('./routes/wallet');
const adminRoutes = require('./routes/admin');
const prizeRoutes = require('./routes/prize');

const app = express();

// Trust proxy (Render)
app.set('trust proxy', 1);

// ---- Middlewares ----
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(compression());
app.use(morgan('tiny'));

// CORS allowlist (ปรับเพิ่ม/ลดได้ตามที่ใช้จริง)
const allowlist = [
  'https://node-backend-lotto.onrender.com', // Render domain (self)
  'http://localhost:5173',
  'http://localhost:3000',
  'http://10.0.2.2:3000',
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
];
const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // mobile/postman/no-origin
    const ok = allowlist.some((o) => (o instanceof RegExp ? o.test(origin) : o === origin));
    return ok ? cb(null, true) : cb(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ---- Health check ----
app.get('/health', (req, res) => res.status(200).send('ok'));

// ---- Root ----
app.get('/', (req, res) =>
  res.json({ ok: true, name: 'lotto-backend', message: 'Server is running!' })
);

// ---- Mount routes ----
app.use('/auth', authRoutes);
app.use('/', usersRoutes);
app.use('/', ticketsRoutes);
app.use('/', drawRoutes);
app.use('/', redemptionRoutes);
app.use('/', walletRoutes);
app.use('/', prizeRoutes);
app.use('/admin', adminRoutes);

// ---- 404 ----
app.use((req, res, next) => res.status(404).json({ error: 'Not found' }));

// ---- Error handler ----
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

// ---- Start server (สำคัญ: ต้องฟังที่ PORT และ 0.0.0.0 บน Render) ----
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log(`API on :${PORT}`);
});

// (ถ้าไฟล์ ./db เชื่อม DB ตอน require แล้วพัง ให้จับ error ไว้ไม่ให้ process ตาย)
try {
  require('./db');
} catch (e) {
  console.error('DB init error:', e && e.message ? e.message : e);
}

module.exports = server;
