const express = require('express');
const yahooFinance = require('yahoo-finance2').default;
const { SMA } = require('technicalindicators');
const authMiddleware = require('../middleware/auth');

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

const router = express.Router();

router.get('/stock/:symbol', authMiddleware, async (req, res) => {
    const { symbol } = req.params;
    const today = new Date();
    const todayFormatted = formatDate(today);
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(today.getFullYear() - 1);
    const oneYearAgoFormatted = formatDate(oneYearAgo);
    try {
        const result = await yahooFinance.chart(symbol, {
            period1: oneYearAgoFormatted,
            period2: todayFormatted
        });
        const closes = result.quotes.map((entry) => entry.close);
        const sma = SMA.calculate({ period: 14, values: closes });

        res.json({
            symbol,
            historical: result,
            sma: sma.slice(-10),
        });
    } catch (error) {
        res.status(500).json({ error: 'Error fetching stock data' });
    }
});

module.exports = router;