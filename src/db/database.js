const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, '../../database.db'), (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS stock_cache (
        symbol TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);
  }
});

module.exports = db;