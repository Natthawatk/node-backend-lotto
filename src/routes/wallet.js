const express = require('express');
const { pool } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

// GET /wallet/transactions - Get user's wallet transactions
router.get('/wallet/transactions', auth(true), async (req, res, next) => {
  try {
    const userId = req.query.user_id || req.user.id;
    const [rows] = await pool.query(
      'SELECT id, type, amount, balance_after, created_at, purchase_id, redemption_id, draw_id, note FROM wallet_txn WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 200',
      [userId]
    );
    res.json({ transactions: rows });
  } catch (e) {
    next(e);
  }
});

// GET /wallet/balance - Get user's current wallet balance
router.get('/wallet/balance', auth(true), async (req, res, next) => {
  try {
    const userId = req.query.user_id || req.user.id;
    const [rows] = await pool.query(
      'SELECT balance_after FROM wallet_txn WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 1',
      [userId]
    );

    const balance = rows.length ? Number(rows[0].balance_after) : 0;
    res.json({ balance });
  } catch (e) {
    next(e);
  }
});

// Legacy endpoint for backward compatibility
router.get('/wallet', auth(true), async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, type, amount, balance_after, created_at, purchase_id, redemption_id, draw_id, note FROM wallet_txn WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 200',
      [req.user.id]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

module.exports = router;
