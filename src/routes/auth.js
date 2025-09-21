const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const util = require('util');

// Промісифікуємо db.run для асинхронного використання
const dbRun = util.promisify(db.run).bind(db);
const dbGet = util.promisify(db.get).bind(db);

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  console.log('Register attempt:', { username, email });

  // Валідація
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    // Перевірка, чи існує username або email
    const existingUser = await dbGet('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
    if (existingUser) {
      return res.status(400).json({
        error: existingUser.username === username ? 'Username already exists' : 'Email already exists',
      });
    }

    // Хешування пароля
    const hashedPassword = await bcrypt.hash(password, 10);

    // Вставка нового користувача
    await dbRun(
      'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
      [username, email, hashedPassword]
    );

    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    console.error('Register error:', error.message, error.stack);
    if (error.code === 'SQLITE_CONSTRAINT') {
      return res.status(400).json({ error: 'Username or email already exists' });
    }
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user.id, username }, process.env.JWT_SECRET, {
      expiresIn: '24h',
    });
    res.json({ token });
  } catch (error) {
    console.error('Login error:', error.message, error.stack);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

module.exports = router;