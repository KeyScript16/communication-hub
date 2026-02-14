const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Allow all connections (important for cross-device chat)
const io = new Server(server, { 
    cors: { 
        origin: "*",
        methods: ["GET", "POST"]
    } 
});

app.use(cors());
app.use(express.json());
// Serves your CSS and JS files from the main folder
app.use(express.static(path.join(__dirname))); 

// --- THE HOME PAGE FIX ---
// This uses 'path.join' to find index.html no matter where Render puts it
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- DATABASE HELPERS ---
function readDB() {
    try {
        const data = fs.readFileSync(path.join(__dirname, 'db.json'), 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return []; // Return empty list if file doesn't exist yet
    }
}

function writeDB(data) {
    fs.writeFileSync(path.join(__dirname, 'db.json'), JSON.stringify(data, null, 2));
}

// --- API ROUTES ---
app.get('/get-data', (req, res) => res.send(readDB()));

app.post('/save-data', (req, res) => {
    writeDB(req.body);
    res.send({ status: "Saved!" });
});

// --- LIVE CHAT & HANDSHAKE LOGIC ---
let onlineUsers = {}; 

io.on('connection', (socket) => {
    socket.on('go-online', (email) => {
        onlineUsers[email] = socket.id;
        io.emit('update-online-list', Object.keys(onlineUsers));
        console.log(`${email} is online.`);
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

// --- DYNAMIC PORT FIX ---
// This is required for Render to find your server!
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Crescendo-Chat LIVE on port ${PORT}`));
