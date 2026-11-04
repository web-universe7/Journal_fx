const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json());

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    ssl: { rejectUnauthorized: false }
});

db.connect((err) => {
    if (err) console.error('DB Connection Failed:', err);
    else console.log('Connected to Aiven MySQL Database.');

    const sql = `
        CREATE TABLE IF NOT EXISTS forex_trades (
            trade_id INT AUTO_INCREMENT PRIMARY KEY,
            trade_date DATE NOT NULL,
            pair VARCHAR(20) NOT NULL,
            entry_type VARCHAR(10) NOT NULL,
            entry_price DECIMAL(10, 4) NOT NULL,
            tp_price DECIMAL(10, 4) NOT NULL,
            sl_price DECIMAL(10, 4) NOT NULL,
            lot_size DECIMAL(5, 2) NOT NULL,
            result_status VARCHAR(10) NOT NULL,
            profit_loss DECIMAL(10, 2) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `;
    db.query(sql);
});

// Add and Calculate Trade Route with Exact Rules
app.post('/api/add-forex-trade', (req, res) => {
    const { trade_date, pair, entry_type, entry_price, tp_price, sl_price, lot_size, result_status } = req.body;

    const lots = parseFloat(lot_size);

    // Validation: Lot size cannot be less than 0.01
    if (isNaN(lots) || lots < 0.01) {
        return res.status(400).json({ success: false, message: 'Lot size cannot be less than 0.01!' });
    }

    let pnl = 0;
    const entry = parseFloat(entry_price);
    const tp = parseFloat(tp_price);
    const sl = parseFloat(sl_price);
    const cleanPair = pair.toUpperCase();

    if (result_status === 'TP') {
        let diff = entry_type === 'BUY' ? (tp - entry) : (entry - tp);
        
        if (cleanPair.includes('XAUUSD')) {
            // XAUUSD Rule: 1 point = $1 for 0.01 lot -> PnL = diff * 100 * lot_size
            pnl = diff * 100 * lots; 
        } else if (cleanPair.includes('BTCUSD')) {
            // BTCUSD Rule: 100 points = $1 for 0.01 lot
            pnl = (diff / 100) * (lots / 0.01);
        } else {
            // Standard Forex Pips
            let pips = diff * 10000;
            if (cleanPair.includes('JPY')) pips = diff * 100;
            pnl = pips * 0.10 * (lots / 0.01); // $0.10 per pip for 0.01 lot
        }
    } else {
        // SL Hit (Loss)
        let diff = entry_type === 'BUY' ? (entry - sl) : (sl - entry);

        if (cleanPair.includes('XAUUSD')) {
            pnl = -(diff * 100 * lots);
        } else if (cleanPair.includes('BTCUSD')) {
            pnl = -((diff / 100) * (lots / 0.01));
        } else {
            let pips = diff * 10000;
            if (cleanPair.includes('JPY')) pips = diff * 100;
            pnl = -(pips * 0.10 * (lots / 0.01));
        }
    }

    const query = `INSERT INTO forex_trades (trade_date, pair, entry_type, entry_price, tp_price, sl_price, lot_size, result_status, profit_loss) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    db.query(query, [trade_date, cleanPair, entry_type, entry, tp, sl, lots, result_status, pnl.toFixed(2)], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error' });
        res.status(201).json({ success: true, message: 'Trade recorded successfully!', pnl: pnl.toFixed(2) });
    });
});

// Summary Endpoint for UI & Power BI
app.get('/api/trades-summary', (req, res) => {
    db.query('SELECT * FROM forex_trades ORDER BY trade_date DESC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        
        let totalTrades = results.length;
        let totalProfit = results.reduce((acc, curr) => acc + parseFloat(curr.profit_loss), 0);
        let wins = results.filter(t => t.result_status === 'TP').length;
        let winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : 0;

        res.json({ totalTrades, totalProfit: totalProfit.toFixed(2), winRate, trades: results });
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));