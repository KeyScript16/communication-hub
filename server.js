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

// 2. MIDDLEWARE - Allows your GitHub site to communicate with this server
app.use(cors()); 
app.use(express.json());

async function readDB() {
    try {
        const res = await pool.query('SELECT content FROM site_data LIMIT 1');
        // If there's a row AND it has content, return it. Otherwise, return []
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
// A. Tell the server where your files (CSS, JS, Images) are
app.use(express.static(__dirname));

// B. Route for the Home/Login page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// C. Route for the Dashboard
app.get('/dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});
// 3. API ROUTES
app.get('/get-data', async (req, res) => {
    const data = await readDB();
    res.json(data); 
});

app.post('/save-data', async (req, res) => {
    await writeDB(req.body);
    res.json({ status: "Saved!" });
});

// 4. SOCKET.IO LOGIC
const io = new Server(server, { 
    cors: { origin: "*" } 
});

let onlineUsers = {}; // Tracks { email: socketId }

io.on('connection', (socket) => {
    socket.on('go-online', (email) => {
        onlineUsers[email] = socket.id;
        io.emit('update-online-list', Object.keys(onlineUsers));
    });

    socket.on('request-chat', (data) => {
        const targetId = onlineUsers[data.to];
        if (targetId) {
            io.to(targetId).emit('chat-requested', data);
        }
    });

    socket.on('chat-response', (data) => {
        const targetId = onlineUsers[data.to];
        if (targetId) {
            io.to(targetId).emit('start-chat-confirmed', data);
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

// 5. START SERVER (Fixed Port Binding)
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));



