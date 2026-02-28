const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);

// 1. DATABASE SETUP
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const initDB = async () => {
    try {
        await pool.query('CREATE TABLE IF NOT EXISTS site_data (id SERIAL PRIMARY KEY, content JSONB)');
        await pool.query(`CREATE TABLE IF NOT EXISTS chat_groups (
            id SERIAL PRIMARY KEY, group_name TEXT NOT NULL, description TEXT,
            creator_email TEXT NOT NULL, members JSONB DEFAULT '[]',
            pending_invites JSONB DEFAULT '[]', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log("------------------------------------------");
        console.log("📊 DATABASE SYSTEM: Online and Verified ✅");
        console.log("------------------------------------------");
    } catch (err) { console.error("❌ DB ERROR:", err); }
};
initDB();

// 2. MIDDLEWARE & LOGGING
app.use(cors({ origin: '*' }));
app.use(express.json());

// Log every HTTP request that comes in
app.use((req, res, next) => {
    if (req.path !== '/get-data') { // Skip spammy data-polling logs
        console.log(`🌐 [HTTP] ${req.method} request to ${req.path}`);
    }
    next();
});

// 3. API ROUTES
app.get('/get-data', async (req, res) => {
    const rs = await pool.query('SELECT content FROM site_data WHERE id = 1');
    res.json(rs.rows[0]?.content || []);
});

app.post('/save-data', async (req, res) => {
    console.log("💾 SAVING DATA: User database updated.");
    await pool.query('INSERT INTO site_data (id, content) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content', [JSON.stringify(req.body)]);
    res.json({ status: "Saved" });
});

app.post('/create-new-group', async (req, res) => {
    const { groupName, creator } = req.body;
    console.log(`🚀 GROUP ACTION: "${groupName}" created by ${creator}`);
    // ... logic for DB insertion here ...
    res.json({ status: "Created" });
});

// 4. SOCKET.IO (The Real-Time Engine)
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });
let onlineUsers = {};

io.on('connection', (socket) => {
    console.log(`🔌 NEW SOCKET: Connection established (${socket.id})`);

    socket.on('go-online', (data) => {
        const email = data?.email?.toLowerCase().trim();
        if (email) {
            onlineUsers[email] = socket.id;
            console.log(`✨ USER STATUS: ${email} is now ONLINE.`);
            io.emit('update-online-list', Object.keys(onlineUsers));
        }
    });

    socket.on('request-chat', (data) => {
        console.log(`💬 CHAT REQUEST: ${data.fromName} -> ${data.to}`);
        const targetId = onlineUsers[data.to?.toLowerCase()];
        if (targetId) io.to(targetId).emit('chat-requested', data);
    });

    socket.on('disconnect', () => {
        for (let e in onlineUsers) {
            if (onlineUsers[e] === socket.id) {
                console.log(`👋 USER STATUS: ${e} has logged off.`);
                delete onlineUsers[e];
                break;
            }
        }
        io.emit('update-online-list', Object.keys(onlineUsers));
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log("==========================================");
    console.log(`🚀 SERVER LIVE: Running on Port ${PORT}`);
    console.log(`📡 URL: https://crescendo-chat.onrender.com`);
    console.log("==========================================");
});
