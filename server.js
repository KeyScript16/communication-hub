const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Initialize Database Tables
const initDB = async () => {
    try {
        await pool.query('CREATE TABLE IF NOT EXISTS site_data (id SERIAL PRIMARY KEY, content JSONB)');
        await pool.query(`CREATE TABLE IF NOT EXISTS chat_groups (
            id SERIAL PRIMARY KEY, group_name TEXT NOT NULL, description TEXT,
            creator_email TEXT NOT NULL, members JSONB DEFAULT '[]',
            pending_invites JSONB DEFAULT '[]', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log("DB Ready ✅");
    } catch (err) { console.error("DB Error:", err); }
};
initDB();

// Middlewares - THE "LAZY" CORS FIX
app.use(cors({ origin: '*' }));
app.use(express.json());

// API Routes
// This tells the server to send your index file when someone visits the main site
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/get-data', async (req, res) => {
    const rs = await pool.query('SELECT content FROM site_data WHERE id = 1');
    res.json(rs.rows[0]?.content || []);
});

app.post('/save-data', async (req, res) => {
    await pool.query('INSERT INTO site_data (id, content) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content', [JSON.stringify(req.body)]);
    res.json({ status: "Saved" });
});

app.get('/get-my-groups', async (req, res) => {
    const email = req.query.email?.toLowerCase();
    if (!email) return res.json({ joined: [], pending: [] });
    try {
        const result = await pool.query('SELECT * FROM chat_groups');
        const joined = result.rows.filter(g => (g.members || []).includes(email));
        const pending = result.rows.filter(g => (g.pending_invites || []).includes(email));
        res.json({ joined, pending });
    } catch (e) { res.status(500).json({ joined: [], pending: [] }); }
});

// Socket.io with CORS enabled
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });
let onlineUsers = {};

io.on('connection', (socket) => {
    socket.on('go-online', (data) => {
        const email = data?.email?.toLowerCase().trim();
        if (email) { onlineUsers[email] = socket.id; io.emit('update-online-list', Object.keys(onlineUsers)); }
    });
    socket.on('disconnect', () => {
        for (let e in onlineUsers) { if (onlineUsers[e] === socket.id) { delete onlineUsers[e]; break; } }
        io.emit('update-online-list', Object.keys(onlineUsers));
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server live on ${PORT} 🚀`));

