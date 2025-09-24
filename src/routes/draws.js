const express = require('express');
const { pool } = require('../db');
const { auth, requireOwner } = require('../middleware/auth');

const router = express.Router();

function randChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// GET /draws - Get all draws
router.get('/draws', auth(false), async (req, res, next) => {
  try {
    const [draws] = await pool.query(`
      SELECT id, draw_date, draw_method, created_by, created_at
      FROM draw
      ORDER BY draw_date DESC
    `);

    res.json({ draws });
  } catch (e) {
    next(e);
  }
});

// GET /draws/latest - Get latest draw
router.get('/draws/latest', auth(false), async (req, res, next) => {
  try {
    const [draws] = await pool.query(`
      SELECT id, draw_date, draw_method, created_by, created_at
      FROM draw
      ORDER BY id DESC
      LIMIT 1
    `);

    if (draws.length === 0) {
      return res.json({ draw: null });
    }

    res.json({ draw: draws[0] });
  } catch (e) {
    next(e);
  }
});

// GET /draws/latest-results - Get latest draw results with winning numbers
router.get('/draws/latest-results', auth(false), async (req, res, next) => {
  try {
    const [draws] = await pool.query(`
      SELECT d.id, d.draw_date, d.draw_method,
             po.prize_tier_id, po.number_full, po.suffix_len, po.suffix_value, po.derived_from_tier,
             pt.tier_rank, pt.name as prize_name, pt.prize_amount,
             d.draw_date as original_draw_date
      FROM draw d
      JOIN prize_outcome po ON po.draw_id = d.id
      JOIN prize_tier pt ON pt.id = po.prize_tier_id
      WHERE d.id = (SELECT MAX(id) FROM draw)
      ORDER BY pt.tier_rank
    `);

    if (draws.length === 0) {
      return res.json({ draw: null, results: [], round_date: null });
    }

    // Calculate display date: if time is 00:00:00, show next day
    const originalDate = new Date(draws[0].original_draw_date);
    let displayDate = new Date(originalDate);

    // Check if time is 00:00:00
    if (originalDate.getHours() === 0 && originalDate.getMinutes() === 0 && originalDate.getSeconds() === 0) {
      // Add 1 day
      displayDate.setDate(displayDate.getDate() + 1);
    }

    // Format as YYYY-MM-DD
    const roundDate = displayDate.toISOString().split('T')[0];

    const drawInfo = {
      id: draws[0].id,
      draw_date: draws[0].draw_date,
      draw_method: draws[0].draw_method,
      round_date: roundDate
    };

    const results = draws.map(row => ({
      prize_tier_id: row.prize_tier_id,
      tier_rank: row.tier_rank,
      prize_name: row.prize_name,
      prize_amount: row.prize_amount,
      number_full: row.number_full,
      suffix_len: row.suffix_len,
      suffix_value: row.suffix_value,
      derived_from_tier: row.derived_from_tier
    }));

    res.json({
      draw: drawInfo,
      results,
      round_date: roundDate
    });
  } catch (e) {
    next(e);
  }
});

router.post('/draws', async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const { drawDate, method } = req.body;
    if (!drawDate) throw new Error('drawDate required');
    const drawMethod = (method === 'all_tickets') ? 'all_tickets' : 'sold_only';

    await conn.beginTransaction();
    const [dres] = await conn.query(
      'INSERT INTO draw(draw_date, draw_method, created_by) VALUES (?,?,?)',
      [`${drawDate} 12:00:00`, drawMethod, 1] // Use default user ID 1
    );
    const drawId = dres.insertId;

    const [candidates] = await conn.query(
      drawMethod === 'sold_only'
        ? 'SELECT DISTINCT number_6 FROM ticket t JOIN purchase p ON p.ticket_id=t.id WHERE DATE(t.round_date)=?'
        : 'SELECT number_6 FROM ticket WHERE DATE(round_date)=?',
      [drawDate]
    );
    if (candidates.length < 3) throw new Error('Not enough tickets in this round to draw 3 unique numbers');

    const poolNums = candidates.map(r => r.number_6);
    const pick = new Set(); while (pick.size < 3) { pick.add(randChoice(poolNums)); }
    const [n1, n2, n3] = Array.from(pick);
    const suffix3 = n1.slice(-3);
    const suffix2 = n1.slice(-2);

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

    const [tiers] = await conn.query('SELECT id, tier_rank, prize_amount FROM prize_tier');
    const amtByTier = Object.fromEntries(tiers.map(t => [t.tier_rank, Number(t.prize_amount)]));

    // Exact match tiers (1..3)
    for (const { tier, number_full } of outcomes.filter(o => o.number_full)) {
      await conn.query(`
        INSERT INTO winning_ticket(draw_id,prize_tier_id,prize_outcome_id,purchase_id,amount)
        SELECT d.id, ?, po.id, p.id, ?
        FROM draw d
        JOIN prize_outcome po ON po.draw_id=d.id AND po.prize_tier_id=?
        JOIN ticket t ON t.number_6=po.number_full AND DATE(t.round_date)=DATE(d.draw_date)
        JOIN purchase p ON p.ticket_id=t.id
        WHERE d.id=?
      `, [tier, amtByTier[tier], tier, drawId]);
    }

    // Suffix tiers (4..5)
    for (const { tier } of outcomes.filter(o => !o.number_full)) {
      await conn.query(`
        INSERT INTO winning_ticket(draw_id,prize_tier_id,prize_outcome_id,purchase_id,amount)
        SELECT d.id, po.prize_tier_id, po.id, p.id, ?
        FROM draw d
        JOIN prize_outcome po ON po.draw_id=d.id AND po.prize_tier_id=?
        JOIN ticket t ON DATE(t.round_date)=DATE(d.draw_date)
        JOIN purchase p ON p.ticket_id=t.id
        WHERE d.id=? AND RIGHT(t.number_6, po.suffix_len) = po.suffix_value
      `, [amtByTier[tier], tier, drawId]);
    }

    await conn.query(
      'UPDATE ticket SET status="drawn", updated_at=NOW() WHERE DATE(round_date)=? AND status="available"',
      [drawDate]
    );

    await conn.commit();
    res.json({ ok: true, draw_id: drawId, tier1: n1, tier2: n2, tier3: n3, suffix3, suffix2 });
  } catch (e) {
    await conn.rollback(); next(e);
  } finally { conn.release(); }
});

module.exports = router;
