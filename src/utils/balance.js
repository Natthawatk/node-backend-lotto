const { pool } = require('../db');
async function getCurrentBalance(userId){
  const [rows] = await pool.query('SELECT balance_after FROM wallet_txn WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 1',[userId]);
  return rows.length ? Number(rows[0].balance_after) : 0;
}
module.exports = { getCurrentBalance };
