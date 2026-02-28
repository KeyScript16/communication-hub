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

// 2. MIDDLEWARE
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname))); 

// 3. ROUTES
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/get-data', async (req, res) => {
    const rs = await pool.query('SELECT content FROM site_data WHERE id = 1');
    res.json(rs.rows[0]?.content || []);
});

app.get('/get-my-groups', async (req, res) => {
    const email = req.query.email?.toLowerCase();
    if (!email) return res.json({ joined: [], pending: [] });
    try {
        const result = await pool.query('SELECT * FROM chat_groups');
        const joined = result.rows.filter(g => (g.members || []).includes(email));
        const pending = result.rows.filter(g => (g.pending_invites || []).includes(email));
        res.json({ joined, pending });
    } catch(e) { res.json({ joined: [], pending: [] }); }
});

// 4. SOCKET.IO
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });
let onlineUsers = {};
let clubRooms = {}; // NEW: Tracker for the Sidebar

io.on('connection', (socket) => {
    
    // Status Logic
    socket.on('go-online', (data) => {
        const email = data?.email?.toLowerCase().trim();
        if (email) {
            onlineUsers[email] = socket.id;
            console.log(`✨ USER ONLINE: ${email}`);
            io.emit('update-online-list', Object.keys(onlineUsers));
        }
    });

    // NEW: CLUB CHAT ENGINE
    socket.on('join-club', (data) => {
        const roomName = `club-${data.groupId}`;
        socket.join(roomName);

        if (!clubRooms[roomName]) clubRooms[roomName] = [];
        if (!clubRooms[roomName].find(u => u.username === data.username)) {
            clubRooms[roomName].push({ username: data.username, socketId: socket.id });
        }

        const members = clubRooms[roomName].map(u => u.username);
        // Sync with your club-chat.html expectations
        io.to(roomName).emit('club-status', {
            allowed: members.length >= 2,
            count: members.length,
            users: members
        });
        console.log(`📡 ${data.username} entered ${roomName}`);
    });

    socket.on('club-message', (data) => {
        const roomName = `club-${data.groupId}`;
        // Send to everyone else in the club
        socket.to(roomName).emit('new-club-message', {
            fromName: data.fromName,
            message: data.message
        });
        console.log(`💬 [${roomName}] ${data.fromName}: ${data.message}`);
    });

    socket.on('disconnect', () => {
        // Cleanup Online List
        for (let e in onlineUsers) {
            if (onlineUsers[e] === socket.id) {
                console.log(`👋 USER OFFLINE: ${e}`);
                delete onlineUsers[e];
                break;
            }
        }
        io.emit('update-online-list', Object.keys(onlineUsers));

        // NEW: Cleanup Club Sidebar
        for (const room in clubRooms) {
            clubRooms[room] = clubRooms[room].filter(u => u.socketId !== socket.id);
            const members = clubRooms[room].map(u => u.username);
            io.to(room).emit('club-status', {
                count: members.length,
                users: members,
                allowed: members.length >= 2
            });
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server live on ${PORT} 🚀`));
