const express = require('express');
const yfinance = require('yahoo-finance2').default;
const { RSI, MACD, SMA, BollingerBands } = require('technicalindicators');
const authMiddleware = require('../middleware/auth');
const db = require('../db/database');

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

const router = express.Router();

router.get('/stock/:ticker', authMiddleware, async (req, res) => {
    try {
        const { ticker } = req.params;
        const { rsiPeriod = 14, macdFast = 12, macdSlow = 26, macdSignal = 9, bbPeriod = 20, bbStdDev = 2, } = req.query;
        const today = new Date();
        const todayFormatted = formatDate(today);
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(today.getFullYear() - 1);
        const oneYearAgoFormatted = formatDate(oneYearAgo);

        const summary = await yfinance.quoteSummary(ticker);
        const chartData = await yfinance.chart(ticker, {
            period1: oneYearAgoFormatted,
            period2: todayFormatted
        });


        const price = summary.price || [];

        if (!chartData.quotes || chartData.quotes.length === 0) {
            return res.status(400).json({ error: 'Дані для тікера недоступні' });
        }

        const closePrices = [];
        const dataPoints = [];
        for (const quote of chartData.quotes) {
            if (quote.close !== undefined && quote.close !== null) {
                dataPoints.push({
                    date: new Date(quote.date).toISOString().split('T')[0],
                    close: quote.close,
                });
                closePrices.push(quote.close);
            }
        }

        if (closePrices.length < Number(rsiPeriod)) {
            return res.status(400).json({ error: `Недостатньо даних для RSI (${rsiPeriod} періодів)` });
        }

        // Обчислюємо RSI
        const rsi = new RSI({ period: Number(rsiPeriod), values: closePrices });
        const rsiValues = rsi.getResult();

        // Обчислюємо MACD
        const macd = new MACD({
            values: closePrices,
            fastPeriod: Number(macdFast),
            slowPeriod: Number(macdSlow),
            signalPeriod: Number(macdSignal),
            SimpleMAOscillator: false, // Використовуємо EMA, а не SMA
            SimpleMASignal: false, // Використовуємо EMA для сигнальної лінії
        });
        const macdValues = macd.getResult();

        // Обчислюємо Bollinger Bands
        const bb = new BollingerBands({
            period: Number(bbPeriod),
            stdDev: Number(bbStdDev),
            values: closePrices,
        });
        const bbValues = bb.getResult();
        res.json(
            {
                general: {
                    ticker: price.symbol,
                    fullName: price.longName,
                    type: price.quoteType,
                    price: price.regularMarketPrice,
                },
                technicalIndicators: {
                    rsi: rsiValues[rsiValues.length - 1],
                    macd: macdValues.slice(macdValues.length - 14, macdValues.length),
                    crossPossition: macdValues[macdValues.length - 1].histogram > 0 ? "Up" : "Down",
                    bbValues: bbValues[bbValues.length - 1],
                }
                // summary: summary,
            }
        );

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: `Error fetching stock data ${error}` });
    }
});

// Ендпоінт для додавання акції до списку користувача
router.post('/stock', authMiddleware, (req, res) => {
    const { symbol } = req.body;
    const userId = req.user.id;

    if (!symbol || typeof symbol !== 'string') {
        return res.status(400).json({ error: 'Тікер акції обов’язковий і має бути рядком' });
    }

    // Отримуємо поточний список акцій
    db.get('SELECT stocks FROM user_stocks WHERE user_id = ?', [userId], (err, row) => {
        if (err) {
            console.error('Помилка отримання списку акцій:', err.message);
            return res.status(500).json({ error: 'Помилка сервера' });
        }

        let stocks = row ? JSON.parse(row.stocks) : [];
        const upperSymbol = symbol.toUpperCase();

        if (stocks.includes(upperSymbol)) {
            return res.status(400).json({ error: 'Акція вже додана' });
        }

        stocks.push(upperSymbol);

        // Оновлюємо або додаємо запис
        const query = `
            INSERT INTO user_stocks (user_id, stocks)
            VALUES (?, ?)
            ON CONFLICT(user_id) DO UPDATE SET stocks = excluded.stocks
        `;
        db.run(query, [userId, JSON.stringify(stocks)], function (err) {
            if (err) {
                console.error('Помилка додавання акції:', err.message);
                return res.status(500).json({ error: `Помилка при додаванні акції --- ${err.message}` });
            }
            res.json({ message: `Акція ${symbol} додана до списку`, stocks });
        });
    });
});

// Ендпоінт для отримання списку акцій користувача
router.get('/user/stocks', authMiddleware, (req, res) => {
    const userId = req.user.id;
    db.get('SELECT stocks FROM user_stocks WHERE user_id = ?', [userId], (err, row) => {
        if (err) {
            console.error('Помилка отримання списку акцій:', err.message);
            return res.status(500).json({ error: 'Помилка при отриманні списку акцій' });
        }
        const stocks = row ? JSON.parse(row.stocks) : [];
        res.json({ stocks });
    });
});

module.exports = router;



// {"username":"newuser123","email":"newuser123@example.com","password":"newpass123"}