const express = require('express');
const { pool } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

// POST /redemptions - Redeem winning ticket
router.post('/redemptions', auth(true), async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const { purchase_id, user_id, draw_id } = req.body;
    await conn.beginTransaction();

    // Verify purchase belongs to user
    const [[p]] = await conn.query('SELECT p.id, p.user_id FROM purchase p WHERE p.id=? FOR UPDATE', [purchase_id]);
    if (!p || p.user_id !== user_id) throw new Error('Not your purchase');

    // Check if already redeemed for this draw
    const [existing] = await conn.query('SELECT id FROM redemption WHERE purchase_id=? AND draw_id=?', [purchase_id, draw_id]);
    if (existing.length) throw new Error('Already redeemed');

    // Get total winning amount for this purchase and draw
    const [[sumRow]] = await conn.query('SELECT COALESCE(SUM(amount),0) AS total FROM winning_ticket WHERE purchase_id=? AND draw_id=?', [purchase_id, draw_id]);
    const total = Number(sumRow.total || 0);
    if (total <= 0) throw new Error('No prize for this purchase/draw');

    // Create redemption record
    const [r] = await conn.query('INSERT INTO redemption(purchase_id, draw_id, amount_total) VALUES (?,?,?)', [purchase_id, draw_id, total]);

    // Update wallet balance
    const [last] = await conn.query('SELECT balance_after FROM wallet_txn WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 1', [user_id]);
    const bal = last.length ? Number(last[0].balance_after) : 0;
    const newBal = bal + total;
    await conn.query('INSERT INTO wallet_txn(user_id,type,amount,balance_after,redemption_id,draw_id,note) VALUES (?,?,?,?,?,?,?)',
      [user_id, 'prize', total, newBal, r.insertId, draw_id, `Prize redemption for purchase ${purchase_id}`]);

    await conn.commit();
    res.json({ success: true, redemption_id: r.insertId, amount: total, balance_after: newBal });
  } catch (e) {
    await conn.rollback();
    res.status(400).json({ success: false, error: e.message });
  } finally {
    conn.release();
  }
});

router.post('/redemptions/claim', async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const { purchaseId, drawId, userId } = req.body;
    await conn.beginTransaction();

    const [[p]] = await conn.query('SELECT p.id, p.user_id FROM purchase p WHERE p.id=? FOR UPDATE', [purchaseId]);
    if (!p || p.user_id !== userId) throw new Error('Not your purchase');

    const [red] = await conn.query('SELECT id FROM redemption WHERE purchase_id=? AND draw_id=?', [purchaseId, drawId]);
    if (red.length) throw new Error('Already redeemed');

    const [[sumRow]] = await conn.query('SELECT COALESCE(SUM(amount),0) AS total FROM winning_ticket WHERE purchase_id=? AND draw_id=?', [purchaseId, drawId]);
    const total = Number(sumRow.total || 0);
    if (total <= 0) throw new Error('No prize for this purchase/draw');

    const [r] = await conn.query('INSERT INTO redemption(purchase_id, draw_id, amount_total) VALUES (?,?,?)', [purchaseId, drawId, total]);

    const [last] = await conn.query('SELECT balance_after FROM wallet_txn WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 1', [userId]);
    const bal = last.length ? Number(last[0].balance_after) : 0;
    const newBal = bal + total;
    await conn.query('INSERT INTO wallet_txn(user_id,type,amount,balance_after,redemption_id,draw_id,note) VALUES (?,?,?,?,?,?,?)',
      [userId, 'prize', total, newBal, r.insertId, drawId, `Prize claim for purchase ${purchaseId}`]);

    await conn.commit();
    res.json({ ok: true, redemption_id: r.insertId, amount: total, balance_after: newBal });
  } catch (e) {
    await conn.rollback(); next(e);
  } finally { conn.release(); }
});

module.exports = router;
