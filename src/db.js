// src/db.js
require('dotenv').config();
const mysql = require('mysql2/promise');

const useSSL = (process.env.DB_SSL || 'false').toLowerCase() === 'true';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 15000,
  ssl: useSSL ? { rejectUnauthorized: false } : undefined,
  charset: 'utf8mb4'
});

module.exports = { pool };
