const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');

const router = express.Router();

// Debug endpoint to list users (for development only)
router.get('/users', async (req, res, next) => {
  try {
    const [users] = await pool.query('SELECT id, username, full_name, user_type, is_active, created_at FROM app_user');
    res.json({ users });
  } catch (e) {
    next(e);
  }
});

// Create test user endpoint for development
router.post('/create-test-user', async (req, res, next) => {
  try {
    // Check if test user already exists
    const [existing] = await pool.query('SELECT id FROM app_user WHERE username=?', ['test']);
    if (existing.length) {
      return res.json({ success: true, message: 'Test user already exists', user_id: existing[0].id });
    }

    // Create test user
    const hash = await bcrypt.hash('123456', 10);
    const [r] = await pool.query(
      'INSERT INTO app_user(username,password_hash,full_name,phone,url,address,user_type,is_active) VALUES (?,?,?,?,?,?,?,?)',
      ['test', hash, 'Test User', '0123456789', null, 'Test Address', 'MEMBER', 1]
    );
    const userId = r.insertId;

    // Add initial balance
    await pool.query('INSERT INTO wallet_txn(user_id,type,amount,balance_after,note) VALUES (?,?,?,?,?)',
      [userId, 'initial', 1000, 1000, 'Initial balance for test user']);

    res.json({ success: true, message: 'Test user created successfully', user_id: userId });
  } catch (e) {
    next(e);
  }
});

router.post('/register', async (req, res, next) => {
  try {
    const { username, password, full_name, phone, url, address, initial_balance } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username & password required' });
    const [dup] = await pool.query('SELECT id FROM app_user WHERE username=?', [username]);
    if (dup.length) return res.status(409).json({ error: 'username exists' });
    const hash = await bcrypt.hash(password, 10);
    const [r] = await pool.query(
      'INSERT INTO app_user(username,password_hash,full_name,phone,url,address,user_type) VALUES (?,?,?,?,?,?,"MEMBER")',
      [username, hash, full_name || null, phone || null, url || null, address || null]
    );
    const userId = r.insertId;
    const init = Number(initial_balance || 0);
    if (init > 0) {
      await pool.query('INSERT INTO wallet_txn(user_id,type,amount,balance_after,note) VALUES (?,?,?,?,?)',
        [userId, 'initial', init, init, 'Initial balance on register']);
    }
    res.json({ success: true, message: 'User registered successfully', user_id: userId });
  } catch (e) { next(e); }
});

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const [rows] = await pool.query('SELECT * FROM app_user WHERE username=?', [username]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    // Return complete user data for Flutter app
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        phone: user.phone,
        url: user.url,
        address: user.address,
        user_type: user.user_type,
        is_active: user.is_active,
        created_at: user.created_at,
        updated_at: user.updated_at
      }
    });
  } catch (e) { next(e); }
});

module.exports = router;
