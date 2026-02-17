const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg'); // Required for the database

const app = express();
const server = http.createServer(app);

// --- DATABASE CONNECTION ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Required for Render
});

// Create the table automatically if it doesn't exist
const initDB = async () => {
    await pool.query('CREATE TABLE IF NOT EXISTS site_data (id SERIAL PRIMARY KEY, content JSONB)');
};
initDB();

const io = new Server(server, { 
    cors: { 
        origin: "*",
        methods: ["GET", "POST"]
    } 
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname))); 

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- UPDATED DATABASE HELPERS (ASYNC) ---
async function readDB() {
    try {
        const res = await pool.query('SELECT content FROM site_data LIMIT 1');
        return res.rows.length ? res.rows[0].content : [];
    } catch (err) {
        console.error("Read Error:", err);
        return [];
    }
}

async function writeDB(data) {
    try {
        await pool.query('DELETE FROM site_data'); // Clear old
        await pool.query('INSERT INTO site_data (content) VALUES ($1)', [JSON.stringify(data)]);
    } catch (err) {
        console.error("Write Error:", err);
    }
}

// --- API ROUTES (NOW ASYNC) ---
app.get('/get-data', async (req, res) => {
    const data = await readDB();
    res.send(data);
});

app.post('/save-data', async (req, res) => {
    await writeDB(req.body);
    res.send({ status: "Saved!" });
});

// --- LIVE CHAT & HANDSHAKE LOGIC ---
let onlineUsers = {}; 

io.on('connection', (socket) => {
    socket.on('go-online', (email) => {
        onlineUsers[email] = socket.id;
        io.emit('update-online-list', Object.keys(onlineUsers));
    });

    socket.on('request-chat', (data) => {
        const targetId = onlineUsers[data.to];
        if (targetId) io.to(targetId).emit('chat-requested', data);
    });

    socket.on('chat-response', (data) => {
        const targetId = onlineUsers[data.to];
        if (targetId) io.to(targetId).emit('start-chat-confirmed', data);
    });

    socket.on('private-message', (data) => {
        const targetId = onlineUsers[data.to];
        if (targetId) io.to(targetId).emit('new-message', data);
    });

    socket.on('typing', (data) => {
        const targetId = onlineUsers[data.to];
        if (targetId) io.to(targetId).emit('friend-typing', data);
    });

    socket.on('leave-chat', (email) => {
        const targetId = onlineUsers[email];
        if (targetId) io.to(targetId).emit('chat-ended-by-friend');
    });

    socket.on('disconnect', () => {
        for (let email in onlineUsers) {
            if (onlineUsers[email] === socket.id) delete onlineUsers[email];
        }
        io.emit('update-online-list', Object.keys(onlineUsers));
    });
});

// --- DYNAMIC PORT & HOST FIX ---
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Crescendo-Chat LIVE on port ${PORT}`);
});
