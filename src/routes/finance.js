const express = require('express');
const yfinance = require('yahoo-finance2').default;
const { RSI, MACD, BollingerBands } = require('technicalindicators');
const authMiddleware = require('../middleware/auth');
const db = require('../db/database');

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

const getStockData = async (params, query, res, dateFunction, yfLib, RSIData, MACDData, BBData) => {
    try {
        const { ticker } = params;
        const { rsiPeriod = 14, macdFast = 12, macdSlow = 26, macdSignal = 9, bbPeriod = 20, bbStdDev = 2, } = query;
        const today = new Date();
        const todayFormatted = dateFunction(today);
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(today.getFullYear() - 1);
        const oneYearAgoFormatted = dateFunction(oneYearAgo);

        const summary = await yfLib.quoteSummary(ticker);
        const chartData = await yfLib.chart(ticker, {
            period1: oneYearAgoFormatted,
            period2: todayFormatted
        });

        const price = summary.price || [];

        if (!chartData.quotes || chartData.quotes.length === 0) {
            return res.status(400).json({ error: 'Data for the ticker is not available' });
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
            return res.status(400).json({ error: `Not enough data for RSI (${rsiPeriod} periods)` });
        }

        const rsi = new RSIData({ period: Number(rsiPeriod), values: closePrices });
        const rsiValues = rsi.getResult();

        const macd = new MACDData({
            values: closePrices,
            fastPeriod: Number(macdFast),
            slowPeriod: Number(macdSlow),
            signalPeriod: Number(macdSignal),
            SimpleMAOscillator: false,
            SimpleMASignal: false,
        });
        const macdValues = macd.getResult();

        const bb = new BBData({
            period: Number(bbPeriod),
            stdDev: Number(bbStdDev),
            values: closePrices,
        });
        const bbValues = bb.getResult();

        const stockData = {
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
        };

        return stockData; // Return the stock data instead of sending response directly
    } catch (error) {
        console.error('Error fetching stock data:', error);
        throw error; // Throw error to be handled by the caller
    }
}

const router = express.Router();

// Ендпоінт для пошуку акції
router.get('/stock/:ticker', authMiddleware, async (req, res) => {
    try {
        const stockData = await getStockData(req.params, req.query, res, formatDate, yfinance, RSI, MACD, BollingerBands);
        res.json(stockData);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Ендпоінт для додавання акції до списку користувача
router.post('/stock', authMiddleware, async (req, res) => {
    const { symbol } = req.body;
    const userId = req.user.id;

    if (!symbol || typeof symbol !== 'string') {
        return res.status(400).json({ error: 'Stock ticker is required and must be a string' });
    }

    try {
        const stockData = await getStockData(
            { ticker: symbol },
            req.query,
            res,
            formatDate,
            yfinance,
            RSI,
            MACD,
            BollingerBands
        );

        db.get('SELECT stocks FROM user_stocks WHERE user_id = ?', [userId], (err, row) => {
            if (err) {
                console.error('Error getting stock:', err.message);
                return res.status(500).json({ error: 'Server error' });
            }

            let stocks = row ? JSON.parse(row.stocks) : [];
            const upperSymbol = symbol.toUpperCase();

            if (stocks.some(stock => stock?.general?.ticker.toUpperCase() === upperSymbol)) {
                return res.status(400).json({ error: 'Stock is already added' });
            }

            stocks.push(stockData);

            const query = `
                INSERT INTO user_stocks (user_id, stocks)
                VALUES (?, ?)
                ON CONFLICT(user_id) DO UPDATE SET stocks = excluded.stocks
            `;
            db.run(query, [userId, JSON.stringify(stocks)], function (err) {
                if (err) {
                    console.error('Error adding stock:', err.message);
                    return res.status(500).json({ error: `Error adding stock --- ${err.message}` });
                }
                res.json({ message: `${symbol} stock added to the list`, stocks });
            });
        });
    } catch (error) {
        console.error('Error adding stock:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Ендпоінт для видалення акції зі списку користувача
router.delete('/stock', authMiddleware, async (req, res) => {
    const { symbol } = req.body;
    const userId = req.user.id;

    if (!symbol || typeof symbol !== 'string') {
        return res.status(400).json({ error: 'Stock ticker is required and must be a string' });
    }

    try {
        db.get('SELECT stocks FROM user_stocks WHERE user_id = ?', [userId], (err, row) => {
            if (err) {
                console.error('Error getting stock:', err.message);
                return res.status(500).json({ error: 'Server error' });
            }

            if (!row) {
                return res.status(404).json({ error: 'No stocks found for this user' });
            }

            let stocks = JSON.parse(row.stocks);
            const upperSymbol = symbol.toUpperCase();

            // Перевіряємо, чи є акція в списку
            const stockIndex = stocks.findIndex(stock => stock?.general?.ticker.toUpperCase() === upperSymbol);

            if (stockIndex === -1) {
                return res.status(404).json({ error: 'Stock not found in the list' });
            }

            // Видаляємо акцію зі списку
            stocks.splice(stockIndex, 1);

            // Оновлюємо список акцій у базі даних
            const query = `
                INSERT INTO user_stocks (user_id, stocks)
                VALUES (?, ?)
                ON CONFLICT(user_id) DO UPDATE SET stocks = excluded.stocks
            `;
            db.run(query, [userId, JSON.stringify(stocks)], function (err) {
                if (err) {
                    console.error('Error removing stock:', err.message);
                    return res.status(500).json({ error: `Error removing stock --- ${err.message}` });
                }
                res.json({ message: `${symbol} stock removed from the list`, stocks });
            });
        });
    } catch (error) {
        console.error('Error removing stock:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Ендпоінт для отримання списку акцій користувача
router.get('/user/stocks', authMiddleware, (req, res) => {
    const userId = req.user.id;
    db.get('SELECT stocks FROM user_stocks WHERE user_id = ?', [userId], (err, row) => {
        if (err) {
            console.error('Error fetching the list of stocks:', err.message);
            return res.status(500).json({ error: 'Failed to fetch the list of stocks' });
        }
        const stocks = row ? JSON.parse(row.stocks) : [];
        res.json({ stocks });
    });
});

module.exports = router;