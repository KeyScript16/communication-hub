const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const cors = require('cors');
const path = require('path'); // Added for Render file paths

const app = express();
const server = http.createServer(app);

// Strict CORS fix for cross-browser/cross-device communication
const io = new Server(server, { 
    cors: { 
        origin: "*",
        methods: ["GET", "POST"]
    } 
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// --- 1. THE RENDER HOME PAGE FIX ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- DATABASE HELPERS ---
function readDB() {
    try {
        const data = fs.readFileSync('db.json', 'utf8');
        return JSON.parse(data);
    } catch (err) { return []; }
}
function writeDB(data) {
    fs.writeFileSync('db.json', JSON.stringify(data, null, 2));
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
        console.log(`${email} is live.`);
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

// --- 2. THE DYNAMIC PORT FIX ---
// This lets Render choose the port (usually 10000) instead of forcing 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Crescendo-Chat LIVE on port ${PORT}`));
