const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const ticketRoutes = require('./routes/tickets');
const drawRoutes = require('./routes/draws');
const redemptionRoutes = require('./routes/redemptions');
const walletRoutes = require('./routes/wallet');
const adminRoutes = require('./routes/admin');

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/', (req,res)=>res.json({ok:true,name:'lotto-backend'}));

app.use('/auth', authRoutes);
app.use('/', ticketRoutes);
app.use('/', drawRoutes);
app.use('/', redemptionRoutes);
app.use('/', walletRoutes);
app.use('/admin', adminRoutes);

app.use((err,req,res,next)=>{
  console.error(err);
  res.status(err.status||500).json({error: err.message || 'Server error'});
});

module.exports = app;
