const express = require('express');
const { pool } = require('../db');
const { auth, requireOwner } = require('../middleware/auth');

const router = express.Router();

// GET /prize-tiers
router.get("/prize-tiers", auth(false), async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, tier_rank, name, prize_amount FROM prize_tier ORDER BY tier_rank"
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// POST /prize-tiers  (OWNER)
router.post("/prize-tiers", auth(true), requireOwner, async (req, res, next) => {
  try {
    const { tier_rank, name, prize_amount } = req.body || {};
    if (tier_rank == null || !name || prize_amount == null) {
      return res.status(400).json({ error: "tier_rank, name, prize_amount required" });
    }
    const [dup] = await pool.query("SELECT id FROM prize_tier WHERE tier_rank=? LIMIT 1", [tier_rank]);
    if (dup.length) {
      await pool.query("UPDATE prize_tier SET name=?, prize_amount=? WHERE id=?",
        [name, prize_amount, dup[0].id]);
      return res.json({ updated_id: dup[0].id });
    } else {
      const [ins] = await pool.query(
        "INSERT INTO prize_tier(tier_rank,name,prize_amount) VALUES (?,?,?)",
        [tier_rank, name, prize_amount]
      );
      return res.json({ id: ins.insertId });
    }
  } catch (e) { next(e); }
});

module.exports = router;
