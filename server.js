const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
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
        console.log("Database Table Ready");
    } catch (err) { console.error("DB Init Error:", err); }
};
initDB();

// 2. MIDDLEWARE
app.use(cors()); 
app.use(express.json());
app.use(express.static(path.join(__dirname))); 

async function readDB() {
    try {
        const res = await pool.query('SELECT content FROM site_data LIMIT 1');
        if (res.rows && res.rows[0] && res.rows[0].content) {
            return res.rows[0].content; 
        }
        return []; 
    } catch (err) { 
        console.error("Database Read Error:", err);
        return []; 
    }
}

async function writeDB(data) {
    try {
        await pool.query('DELETE FROM site_data'); 
        await pool.query('INSERT INTO site_data (content) VALUES ($1)', [JSON.stringify(data)]);
    } catch (err) { console.error("Write Error:", err); }
}

// 3. PAGE ROUTES
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/dashboard.html', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

// 4. API ROUTES
app.get('/get-data', async (req, res) => {
    const data = await readDB();
    res.json(data); 
});

app.post('/save-data', async (req, res) => {
    await writeDB(req.body);
    res.json({ status: "Saved!" });
});

// 5. SOCKET.IO LOGIC
const io = new Server(server, { cors: { origin: "*" } });
let onlineUsers = {}; 

// FIXED: Added the missing connection block
io.on('connection', (socket) => {
    
    socket.on('go-online', (data) => {
        // Safety check for object vs string
        const email = (typeof data === 'object') ? data.email : data;
        if (email) {
            onlineUsers[email] = socket.id; 
            io.emit('update-online-list', Object.keys(onlineUsers));
        }
    });

    socket.on('private-message', (data) => {
        const targetSocketId = onlineUsers[data.to];
        if (targetSocketId) {
            io.to(targetSocketId).emit('new-message', data);
        }
    });

    socket.on('typing', (data) => {
        const targetSocketId = onlineUsers[data.to];
        if (targetSocketId) {
            io.to(targetSocketId).emit('friend-typing', data);
        }
    });

    socket.on('leave-chat', (friendEmail) => {
        const targetSocketId = onlineUsers[friendEmail];
        if (targetSocketId) {
            io.to(targetSocketId).emit('chat-ended-by-friend');
        }
    });

    socket.on('request-chat', (data) => {
        const targetSocketId = onlineUsers[data.to];
        if (targetSocketId) {
            io.to(targetSocketId).emit('chat-requested', data);
        }
    });

    socket.on('chat-response', (data) => {
        const requesterSocketId = onlineUsers[data.to];
        if (requesterSocketId) {
            io.to(requesterSocketId).emit('start-chat-confirmed', data);
        }
    });

    socket.on('disconnect', () => {
        for (let email in onlineUsers) {
            if (onlineUsers[email] === socket.id) {
                delete onlineUsers[email];
                break;
            }
        }
        io.emit('update-online-list', Object.keys(onlineUsers));
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
