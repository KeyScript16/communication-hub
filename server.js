const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);

// 1. Database Connection
const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
});

// 2. Initialize Database Tables
const initDB = async () => {
    try {
        await pool.query('CREATE TABLE IF NOT EXISTS site_data (id SERIAL PRIMARY KEY, content JSONB)');
        await pool.query(`CREATE TABLE IF NOT EXISTS chat_groups (
            id SERIAL PRIMARY KEY, group_name TEXT NOT NULL, description TEXT,
            creator_email TEXT NOT NULL, members JSONB DEFAULT '[]',
            pending_invites JSONB DEFAULT '[]', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log("DB Ready ✅");
    } catch (err) { console.error("DB Error:", err); }
};
initDB();

// 3. Middleware Setup
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// 4. API Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/get-data', async (req, res) => {
    const rs = await pool.query('SELECT content FROM site_data WHERE id = 1');
    res.json(rs.rows[0]?.content || []);
});

app.post('/save-data', async (req, res) => {
    await pool.query('INSERT INTO site_data (id, content) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content', [JSON.stringify(req.body)]);
    res.json({ status: "Saved!" });
});

app.get('/get-my-groups', async (req, res) => {
    const email = req.query.email?.toLowerCase();
    const result = await pool.query('SELECT * FROM chat_groups');
    const joined = result.rows.filter(g => (g.members || []).includes(email));
    res.json({ joined });
});

// 5. Socket.io Logic
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });
let onlineUsers = {};

io.on('connection', (socket) => {
    socket.on('go-online', (data) => {
        if (data?.email) {
            const cleanEmail = data.email.toLowerCase();
            onlineUsers[cleanEmail] = socket.id;
            io.emit('update-online-list', Object.keys(onlineUsers));
            console.log(`✨ ONLINE: ${cleanEmail}`);
        }
    });

    socket.on('manual-offline', (email) => {
        if (email) {
            const cleanEmail = email.toLowerCase();
            delete onlineUsers[cleanEmail];
            io.emit('update-online-list', Object.keys(onlineUsers));
            console.log(`👋 MANUAL OFFLINE: ${cleanEmail}`);
        }
    });

    socket.on('private-message', (data) => {
        const targetId = onlineUsers[data.to?.toLowerCase()];
        if (targetId) io.to(targetId).emit('new-message', data);
    });

    socket.on('disconnect', () => {
        for (let e in onlineUsers) { 
            if (onlineUsers[e] === socket.id) { 
                delete onlineUsers[e]; 
                break; 
            } 
        }
        io.emit('update-online-list', Object.keys(onlineUsers));
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server live on ${PORT} 🚀`));
