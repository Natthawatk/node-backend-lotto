// src/routes/users.js
const express = require('express');
const { pool } = require('../db');
const router = express.Router();

// Get all users (admin only)
router.get('/users', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, username, full_name, phone, url, address, user_type, created_at FROM app_user ORDER BY created_at DESC'
        );

        res.json({
            success: true,
            users: rows
        });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get user profile by ID
router.get('/users/:id', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        console.log('👤 [USERS] Getting profile for user ID:', userId);

        if (!userId) {
            console.log('❌ [USERS] Invalid user ID provided');
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        console.log('🔍 [USERS] Executing SQL query for user:', userId);
        const [rows] = await pool.query(
            'SELECT id, username, full_name, phone, url, address, user_type, created_at FROM app_user WHERE id = ?',
            [userId]
        );

        console.log('📊 [USERS] Query result rows:', rows.length);
        console.log('📊 [USERS] Query result data:', rows);

        if (rows.length === 0) {
            console.log('❌ [USERS] User not found');
            return res.status(404).json({ error: 'User not found' });
        }

        console.log('✅ [USERS] User profile found:', rows[0]);
        res.json({
            success: true,
            user: rows[0]
        });
    } catch (error) {
        console.error('❌ [USERS] Get user profile error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;