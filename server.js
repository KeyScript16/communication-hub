const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Strict CORS fix for Firefox/Chrome communication
const io = new Server(server, { 
    cors: { 
        origin: "*",
        methods: ["GET", "POST"]
    } 
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// --- DATABASE HELPERS ---
function readDB() {
    try {
        return JSON.parse(fs.readFileSync('db.json', 'utf8'));
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

// --- LIVE LOGIC ---
let onlineUsers = {}; 

io.on('connection', (socket) => {
    socket.on('go-online', (email) => {
        onlineUsers[email] = socket.id;
        io.emit('update-online-list', Object.keys(onlineUsers));
    });

    socket.on('request-chat', (data) => {
        const target = onlineUsers[data.to];
        if (target) io.to(target).emit('chat-requested', data);
    });

    socket.on('chat-response', (data) => {
        const target = onlineUsers[data.to];
        if (target) io.to(target).emit('start-chat-confirmed', data);
    });

    socket.on('private-message', (data) => {
        const target = onlineUsers[data.to];
        if (target) io.to(target).emit('new-message', data);
    });

    socket.on('typing', (data) => {
        const target = onlineUsers[data.to];
        if (target) io.to(target).emit('friend-typing', data);
    });

    socket.on('leave-chat', (email) => {
        const target = onlineUsers[email];
        if (target) io.to(target).emit('chat-ended-by-friend');
    });

    socket.on('disconnect', () => {
        for (let email in onlineUsers) {
            if (onlineUsers[email] === socket.id) delete onlineUsers[email];
        }
        io.emit('update-online-list', Object.keys(onlineUsers));
    });
});

server.listen(3000, () => console.log("System LIVE at http://localhost:3000"));
