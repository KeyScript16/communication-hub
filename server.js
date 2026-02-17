const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);

// 1. --- DATABASE CONNECTION ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Initialize Table
const initDB = async () => {
    try {
        await pool.query('CREATE TABLE IF NOT EXISTS site_data (id SERIAL PRIMARY KEY, content JSONB)');
        console.log("Database Table Ready");
    } catch (err) {
        console.error("DB Init Error:", err);
    }
};
initDB();

// 2. --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());

// 3. --- DATABASE HELPERS ---
async function readDB() {
    try {
        const res = await pool.query('SELECT content FROM site_data LIMIT 1');
        // Returns the JSON content if it exists, otherwise an empty array
        return (res.rows.length > 0) ? res.rows[0].content : [];
    } catch (err) {
        console.error("Read Error:", err);
        return [];
    }
}

async function writeDB(data) {
    try {
        await pool.query('DELETE FROM site_data'); 
        await pool.query('INSERT INTO site_data (content) VALUES ($1)', [JSON.stringify(data)]);
    } catch (err) {
        console.error("Write Error:", err);
    }
}

// 4. --- API ROUTES (MUST BE ABOVE STATIC FILES) ---
app.get('/get-data', async (req, res) => {
    const data = await readDB();
    res.json(data); 
});

app.post('/save-data', async (req, res) => {
    await writeDB(req.body);
    res.json({ status: "Saved!" });
});

// 5. --- STATIC FILES (MUST BE AT THE BOTTOM) ---
// This serves your HTML, CSS, and JS files
app.use(express.static(path.join(__dirname))); 

// Default route to serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 6. --- LIVE CHAT (SOCKET.IO) ---
let onlineUsers = {}; 
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] } 
});

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

// 7. --- SERVER START ---
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Crescendo-Chat LIVE on port ${PORT}`);
});
