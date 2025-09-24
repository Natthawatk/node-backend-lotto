// Simple auth middleware - just use user_id from session/storage
function auth(required=true){
  return async (req,res,next)=>{
    // Get user_id from query params, body, or headers
    const userId = req.query.user_id || req.body.user_id || req.headers['x-user-id'];
    
    if(required && !userId) {
      return res.status(401).json({error:'user_id required'});
    }
    
    if(userId) {
      // Get user from database to check actual user_type
      try {
        const { pool } = require('../db');
        const [[user]] = await pool.query('SELECT id, username, user_type FROM app_user WHERE id = ?', [userId]);
        
        console.log(`Auth middleware: userId=${userId}, found user:`, user);
        
        if (user) {
          req.user = {
            id: user.id,
            username: user.username,
            user_type: user.user_type
          };
          console.log(`Auth middleware: set req.user:`, req.user);
        } else {
          // Fallback for non-existent users
          req.user = { 
            id: parseInt(userId), 
            username: `user${userId}`, 
            user_type: 'MEMBER' 
          };
        }
      } catch (e) {
        console.error('Auth middleware error:', e);
        // Fallback on error
        req.user = { 
          id: parseInt(userId), 
          username: `user${userId}`, 
          user_type: userId === '1' ? 'OWNER' : 'MEMBER' 
        };
      }
    }
    
    next();
  }
}

function requireOwner(req,res,next){
  console.log('requireOwner check: req.user =', req.user);
  if(!req.user || req.user.user_type!=='OWNER') {
    console.log('requireOwner failed: user_type =', req.user?.user_type);
    return res.status(403).json({error:'Owner only'});
  }
  console.log('requireOwner passed');
  next();
}

module.exports = { auth, requireOwner };
