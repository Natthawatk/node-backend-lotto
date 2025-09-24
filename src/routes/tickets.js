const express = require('express');
const { pool } = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

async function getOnSaleRound(conn) {
  const [d] = await conn.query('SELECT DATE(MAX(draw_date)) AS dd FROM draw');
  if (d.length && d[0].dd) {
    const [r] = await conn.query('SELECT DATE_ADD(?, INTERVAL 1 DAY) AS on_sale', [d[0].dd]);
    return r[0].on_sale;
  }
  const [r] = await conn.query('SELECT CURDATE() AS on_sale');
  return r[0].on_sale;
}

router.get('/tickets/for-sale', auth(false), async (req, res, next) => {
  try {
    const conn = pool;

    if (req.query.roundDate) {
      // If specific round date is requested, use it
      const round = req.query.roundDate;
      const [rows] = await conn.query(
        'SELECT id, number_6, price, round_date FROM ticket WHERE status="available" AND DATE(round_date)=? ORDER BY number_6',
        [round]
      );
      const roundDate = rows.length > 0 ? rows[0].display_round_date : null;
      res.json({ round_date: roundDate, tickets: rows });
    } else {
      // Get tickets for the next selling round (latest draw_date + 1 day)
      const [latestDraw] = await conn.query('SELECT MAX(draw_date) as latest_draw_date FROM draw');
      console.log('🎯 Latest draw:', latestDraw[0]);

      if (latestDraw.length && latestDraw[0].latest_draw_date) {
        const latestDrawDate = latestDraw[0].latest_draw_date;
        console.log('🎯 Latest draw date:', latestDrawDate);

        // Get tickets where round_date = latest_draw_date + 1 day
        const [rows] = await conn.query(`
          SELECT id, number_6, price, round_date, DATE(round_date) as display_round_date
          FROM ticket 
          WHERE status="available" 
          AND DATE(round_date) = DATE_ADD(DATE(?), INTERVAL 1 DAY)
          ORDER BY number_6
        `, [latestDrawDate]);

        console.log('🎯 Found tickets:', rows.length);
        console.log(
          '🎯 Expected round date:',
          new Date(latestDrawDate).toISOString().split('T')[0]
        );


        const roundDate = rows.length > 0 ? rows[0].display_round_date : null;
        res.json({ round_date: roundDate, tickets: rows });
      } else {
        console.log('🎯 No draws found in database');
        // No draws yet, return empty
        res.json({ round_date: null, tickets: [] });
      }
    }
  } catch (e) { next(e); }
});

// GET /tickets/my-stats - Get user's ticket statistics
router.get('/tickets/my-stats', auth(true), async (req, res, next) => {
  try {
    // Get total tickets purchased
    const [totalTickets] = await pool.query(
      'SELECT COUNT(*) as total FROM purchase WHERE user_id = ?',
      [req.user.id]
    );

    // Get winning tickets
    const [winningTickets] = await pool.query(`
      SELECT COUNT(*) as total_wins, SUM(wt.amount) as total_winnings
      FROM purchase p 
      JOIN winning_ticket wt ON wt.purchase_id = p.id
      WHERE p.user_id = ?
    `, [req.user.id]);

    // Get tickets by status
    const [statusBreakdown] = await pool.query(`
      SELECT 
        CASE 
          WHEN wt.id IS NOT NULL THEN 'won'
          WHEN t.status = 'drawn' THEN 'lost'
          WHEN t.status = 'sold' THEN 'pending'
          ELSE 'unknown'
        END AS result_status,
        COUNT(*) as count
      FROM purchase p 
      JOIN ticket t ON t.id = p.ticket_id 
      LEFT JOIN winning_ticket wt ON wt.purchase_id = p.id
      WHERE p.user_id = ?
      GROUP BY result_status
    `, [req.user.id]);

    // Get current wallet balance
    const [balance] = await pool.query(
      'SELECT balance_after FROM wallet_txn WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 1',
      [req.user.id]
    );

    res.json({
      user_id: req.user.id,
      total_tickets_purchased: totalTickets[0].total,
      total_wins: winningTickets[0].total_wins || 0,
      total_winnings: winningTickets[0].total_winnings || 0,
      current_balance: balance.length ? Number(balance[0].balance_after) : 0,
      status_breakdown: statusBreakdown,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/tickets/mine', auth(true), async (req, res, next) => {
  try {
    const { roundDate } = req.query;
    const params = [req.user.id];
    let sql = `SELECT 
                 p.id AS purchase_id, 
                 t.id AS ticket_id,
                 t.number_6, 
                 t.status AS ticket_status,
                 p.round_date AS original_round_date,
                 p.purchase_price, 
                 p.purchased_at,
                 CASE 
                   WHEN r.id IS NOT NULL THEN 'claimed'
                   WHEN wt.id IS NOT NULL THEN 'won'
                   WHEN t.status = 'drawn' THEN 'lost'
                   WHEN t.status = 'sold' THEN 'pending'
                   ELSE 'unknown'
                 END AS result_status,
                 wt.amount AS winning_amount,
                 wt.draw_id AS winning_draw_id,
                 pt.name AS prize_name,
                 pt.tier_rank,
                 r.id AS redemption_id,
                 r.amount_total AS claimed_amount
               FROM purchase p 
               JOIN ticket t ON t.id = p.ticket_id 
               LEFT JOIN winning_ticket wt ON wt.purchase_id = p.id
               LEFT JOIN prize_tier pt ON pt.id = wt.prize_tier_id
               LEFT JOIN redemption r ON r.purchase_id = p.id
               WHERE p.user_id=?`;
    if (roundDate) { sql += ' AND DATE(p.round_date)=?'; params.push(roundDate); }
    sql += ' ORDER BY p.purchased_at DESC';
    const [rows] = await pool.query(sql, params);

    // Get latest draw ID and date (force UTC and format consistently)
    const [latestDrawResult] = await pool.query('SELECT id as latest_draw_id, draw_date FROM draw ORDER BY id DESC LIMIT 1');
    const latestDrawId = latestDrawResult[0]?.latest_draw_id || null;
    let latestDrawDate = null;
    
    if (latestDrawResult[0]?.draw_date) {
      // Apply same logic as ticket round_date: if time is 00:00:00, show next day
      const originalDrawDate = new Date(latestDrawResult[0].draw_date);
      let displayDrawDate = new Date(originalDrawDate);
      
      // Format as YYYY-MM-DD
      latestDrawDate = displayDrawDate.toISOString().split('T')[0];
    }
    
    console.log('🎯 Latest draw info:', { latestDrawId, latestDrawDate, rawDate: latestDrawResult[0]?.draw_date });

    // Group rows by purchase_id to handle multiple prizes for same ticket
    const ticketGroups = {};
    rows.forEach(row => {
      const purchaseId = row.purchase_id;
      if (!ticketGroups[purchaseId]) {
        ticketGroups[purchaseId] = {
          purchase_id: row.purchase_id,
          ticket_id: row.ticket_id,
          number_6: row.number_6,
          ticket_status: row.ticket_status,
          original_round_date: row.original_round_date,
          purchase_price: row.purchase_price,
          purchased_at: row.purchased_at,
          redemption_id: row.redemption_id,
          claimed_amount: row.claimed_amount,
          prizes: []
        };
      }
      
      // Add prize info if exists
      if (row.winning_amount || row.prize_name) {
        ticketGroups[purchaseId].prizes.push({
          winning_amount: row.winning_amount,
          winning_draw_id: row.winning_draw_id,
          prize_name: row.prize_name,
          tier_rank: row.tier_rank
        });
      }
    });

    // Process each grouped ticket
    const processedRows = Object.values(ticketGroups).map(ticket => {
      // Calculate display date: if time is 00:00:00, show next day
      const originalDate = new Date(ticket.original_round_date);
      let displayDate = new Date(originalDate);

      // Check if time is 00:00:00
      if (originalDate.getHours() === 0 && originalDate.getMinutes() === 0 && originalDate.getSeconds() === 0) {
        // Add 1 day
        displayDate.setDate(displayDate.getDate() + 1);
      }

      // Format as YYYY-MM-DD
      const roundDate = displayDate.toISOString().split('T')[0];
      const canCheck = roundDate === latestDrawDate;
      
      // Determine result status
      let resultStatus = 'pending';
      if (ticket.redemption_id) {
        resultStatus = 'claimed';
      } else if (ticket.prizes.length > 0) {
        resultStatus = 'won';
      } else if (ticket.ticket_status === 'drawn') {
        resultStatus = 'lost';
      }
      
      // Calculate total winning amount
      const totalWinningAmount = ticket.prizes.reduce((sum, prize) => sum + (prize.winning_amount || 0), 0);
      
      console.log(`🎫 Ticket ${ticket.number_6}: roundDate="${roundDate}", latestDrawDate="${latestDrawDate}", canCheck=${canCheck}, prizes=${ticket.prizes.length}`);

      return {
        purchase_id: ticket.purchase_id,
        ticket_id: ticket.ticket_id,
        number_6: ticket.number_6,
        ticket_status: ticket.ticket_status,
        round_date: roundDate,
        purchase_price: ticket.purchase_price,
        purchased_at: ticket.purchased_at,
        result_status: resultStatus,
        winning_amount: totalWinningAmount,
        prizes: ticket.prizes,
        redemption_id: ticket.redemption_id,
        claimed_amount: ticket.claimed_amount,
        is_claimed: ticket.redemption_id !== null,
        can_check: canCheck
      };
    });

    // Group by round_date for better organization
    const groupedByRound = {};
    processedRows.forEach(row => {
      const roundKey = row.round_date;
      if (!groupedByRound[roundKey]) {
        groupedByRound[roundKey] = [];
      }
      groupedByRound[roundKey].push(row);
    });

    res.json({
      user_id: req.user.id,
      total_tickets: processedRows.length,
      tickets_by_round: groupedByRound,
      all_tickets: processedRows,
      latest_draw_id: latestDrawId,
      latest_draw_date: latestDrawDate
    });
  } catch (e) { next(e); }
});

router.post('/purchases', auth(true), async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const { ticketId } = req.body;
    await conn.beginTransaction();
    const [[ticket]] = await conn.query('SELECT * FROM ticket WHERE id=? FOR UPDATE', [ticketId]);
    if (!ticket) throw new Error('Ticket not found');
    if (ticket.status !== 'available') throw new Error('Ticket not available');

    const [last] = await conn.query('SELECT balance_after FROM wallet_txn WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 1', [req.user.id]);
    const bal = last.length ? Number(last[0].balance_after) : 0;
    if (bal < Number(ticket.price)) throw new Error('Insufficient balance');

    const [pr] = await conn.query('INSERT INTO purchase(user_id, ticket_id, round_date, purchase_price) VALUES (?,?,?,?)',
      [req.user.id, ticket.id, ticket.round_date, ticket.price]);

    await conn.query('UPDATE ticket SET status="sold", updated_at=NOW() WHERE id=?', [ticket.id]);

    const newBal = bal - Number(ticket.price);
    await conn.query('INSERT INTO wallet_txn(user_id,type,amount,balance_after,purchase_id,note) VALUES (?,?,?,?,?,?)',
      [req.user.id, 'purchase', -Number(ticket.price), newBal, pr.insertId, `Buy ticket ${ticket.number_6}`]);

    await conn.commit();
    res.json({ ok: true, purchase_id: pr.insertId, round_date: ticket.round_date });
  } catch (e) {
    await conn.rollback(); next(e);
  } finally { conn.release(); }
});

module.exports = router;
