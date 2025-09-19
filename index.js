const express = require('express');
const cors = require('cors');
const session = require('express-session');
const dotenv = require('dotenv');
const authRoutes = require('./src/routes/auth');
const financeRoutes = require('./src/routes/finance');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }, // Set to true in production with HTTPS
  })
);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/finance', financeRoutes);

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});