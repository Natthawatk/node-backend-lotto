const express = require('express');
const { pool } = require('../db');
const { auth, requireOwner } = require('../middleware/auth');

const router = express.Router();

function randChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// POST /admin/draw - Perform a draw
router.post('/draw', auth(true), requireOwner, async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const { drawDate, method } = req.body;
    const currentDate = new Date().toISOString().split('T')[0];
    const targetDate = drawDate || currentDate;
    const drawMethod = (method === 'all_tickets') ? 'all_tickets' : 'sold_only';

    await conn.beginTransaction();

    // Create the draw
    const [dres] = await conn.query(
      'INSERT INTO draw(draw_date, draw_method, created_by) VALUES (?,?,?)',
      [`${trgetDate} 12:00:00`, drawMethod, req.user.id]
    );
    const drawId = dres.insertId;

    // Get candidate numbers
    const [candidates] = await conn.query(
      drawMethod === 'sold_only'
        ? 'SELECT DISTINCT number_6 FROM ticket t JOIN purchase p ON p.ticket_id=t.id WHERE t.round_date=?'
        : 'SELECT number_6 FROM ticket WHERE round_date=?',
      [targetDate]
    );

    if (candidates.length < 3) {
      throw new Error('Not enough tickets in this round to draw 3 unique numbers');
    }

    // Pick 3 unique winning numbers
    const poolNums = candidates.map(r => r.number_6);
    const pick = new Set();
    while (pick.size < 3) {
      pick.add(randChoice(poolNums));
    }
    const [n1, n2, n3] = Array.from(pick);
    const suffix3 = n1.slice(-3);
    const suffix2 = n1.slice(-2);

    // Create prize outcomes
    const outcomes = [
      { tier: 1, number_full: n1, suffix_len: null, suffix_value: null, derived_from: null },
      { tier: 2, number_full: n2, suffix_len: null, suffix_value: null, derived_from: null },
      { tier: 3, number_full: n3, suffix_len: null, suffix_value: null, derived_from: null },
      { tier: 4, number_full: null, suffix_len: 3, suffix_value: suffix3, derived_from: 1 },
      { tier: 5, number_full: null, suffix_len: 2, suffix_value: suffix2, derived_from: 1 }
    ];

    for (const o of outcomes) {
      await conn.query(
        'INSERT INTO prize_outcome(draw_id,prize_tier_id,number_full,suffix_len,suffix_value,derived_from_tier) VALUES (?,?,?,?,?,?)',
        [drawId, o.tier, o.number_full, o.suffix_len, o.suffix_value, o.derived_from]
      );
    }

    // Get prize amounts
    const [tiers] = await conn.query('SELECT id, tier_rank, prize_amount FROM prize_tier');
    const amtByTier = Object.fromEntries(tiers.map(t => [t.tier_rank, Number(t.prize_amount)]));

    // Create winning tickets for exact matches (tiers 1-3)
    for (const { tier, number_full } of outcomes.filter(o => o.number_full)) {
      await conn.query(`
        INSERT INTO winning_ticket(draw_id,prize_tier_id,prize_outcome_id,purchase_id,amount)
        SELECT d.id, ?, po.id, p.id, ?
        FROM draw d
        JOIN prize_outcome po ON po.draw_id=d.id AND po.prize_tier_id=?
        JOIN ticket t ON t.number_6=po.number_full AND t.round_date=DATE(d.draw_date)
        JOIN purchase p ON p.ticket_id=t.id
        WHERE d.id=?
      `, [tier, amtByTier[tier], tier, drawId]);
    }

    // Create winning tickets for suffix matches (tiers 4-5)
    for (const { tier } of outcomes.filter(o => !o.number_full)) {
      await conn.query(`
        INSERT INTO winning_ticket(draw_id,prize_tier_id,prize_outcome_id,purchase_id,amount)
        SELECT d.id, po.prize_tier_id, po.id, p.id, ?
        FROM draw d
        JOIN prize_outcome po ON po.draw_id=d.id AND po.prize_tier_id=?
        JOIN ticket t ON t.round_date=DATE(d.draw_date)
        JOIN purchase p ON p.ticket_id=t.id
        WHERE d.id=? AND RIGHT(t.number_6, po.suffix_len) = po.suffix_value
      `, [amtByTier[tier], tier, drawId]);
    }

    // Update ticket status
    await conn.query(
      'UPDATE ticket SET status="drawn", updated_at=NOW() WHERE round_date=? AND status="available"',
      [targetDate]
    );

    await conn.commit();
    res.json({
      ok: true,
      draw_id: drawId,
      tier1: n1,
      tier2: n2,
      tier3: n3,
      suffix3,
      suffix2
    });
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally {
    conn.release();
  }
});

router.post('/reset', auth(true), requireOwner, async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM wallet_txn');
    await conn.query('DELETE FROM redemption');
    await conn.query('DELETE FROM winning_ticket');
    await conn.query('DELETE FROM prize_outcome');
    await conn.query('DELETE FROM draw');
    await conn.query('DELETE FROM purchase');
    await conn.query('DELETE FROM ticket');
    await conn.commit();
    res.json({ success: true, message: 'System reset successfully' });
  } catch (e) {
    await conn.rollback(); next(e);
  } finally { conn.release(); }
});

module.exports = router;
