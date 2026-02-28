const path = require('path'); // MUST BE AT THE TOP
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

// 2. MIDDLEWARE
app.use(cors({ origin: '*' }));
app.use(express.json());
// Serves your CSS, JS, and Images automatically
app.use(express.static(path.join(__dirname))); 

// 3. THE "HOME" ROUTE (Fixes 'Cannot GET /')
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 4. API ROUTES
app.get('/get-data', async (req, res) => {
    const rs = await pool.query('SELECT content FROM site_data WHERE id = 1');
    res.json(rs.rows[0]?.content || []);
});

app.get('/get-my-groups', async (req, res) => {
    const email = req.query.email?.toLowerCase();
    if (!email) return res.json({ joined: [], pending: [] });
    const result = await pool.query('SELECT * FROM chat_groups');
    const joined = result.rows.filter(g => (g.members || []).includes(email));
    const pending = result.rows.filter(g => (g.pending_invites || []).includes(email));
    res.json({ joined, pending });
});

// 5. SOCKET.IO
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });
let onlineUsers = {};

io.on('connection', (socket) => {
    socket.on('go-online', (data) => {
        const email = data?.email?.toLowerCase().trim();
        if (email) {
            onlineUsers[email] = socket.id;
            console.log(`✨ USER ONLINE: ${email}`);
            io.emit('update-online-list', Object.keys(onlineUsers));
        }
    });
    socket.on('disconnect', () => {
        for (let e in onlineUsers) {
            if (onlineUsers[e] === socket.id) {
                console.log(`👋 USER OFFLINE: ${e}`);
                delete onlineUsers[e];
                break;
            }
        }
        io.emit('update-online-list', Object.keys(onlineUsers));
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server live on ${PORT} 🚀`));
