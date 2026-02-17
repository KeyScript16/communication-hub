const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const initDB = async () => {
    try {
        await pool.query('CREATE TABLE IF NOT EXISTS site_data (id SERIAL PRIMARY KEY, content JSONB)');
        console.log("Database Table Ready");
    } catch (err) { console.error("DB Init Error:", err); }
};
initDB();

app.use(cors());
app.use(express.json());

async function readDB() {
    try {
        const res = await pool.query('SELECT content FROM site_data LIMIT 1');
        return (res.rows.length > 0) ? res.rows[0].content : [];
    } catch (err) { return []; }
}

async function writeDB(data) {
    try {
        await pool.query('DELETE FROM site_data'); 
        await pool.query('INSERT INTO site_data (content) VALUES ($1)', [JSON.stringify(data)]);
    } catch (err) { console.error("Write Error:", err); }
}

// --- API ROUTES FIRST ---
app.get('/get-data', async (req, res) => {
    const data = await readDB();
    res.json(data); 
});

app.post('/save-data', async (req, res) => {
    await writeDB(req.body);
    res.json({ status: "Saved!" });
});

// --- STATIC FILES BOTTOM ---
app.use(express.static(path.join(__dirname))); 

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const io = new Server(server, { cors: { origin: "*" } });
// ... (Your existing Socket.io logic here) ...

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`LIVE on port ${PORT}`));


