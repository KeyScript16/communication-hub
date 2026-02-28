const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const initDB = async () => {
    await pool.query('CREATE TABLE IF NOT EXISTS site_data (id SERIAL PRIMARY KEY, content JSONB)');
    await pool.query(`CREATE TABLE IF NOT EXISTS chat_groups (
        id SERIAL PRIMARY KEY, group_name TEXT NOT NULL, description TEXT,
        creator_email TEXT NOT NULL, members JSONB DEFAULT '[]',
        pending_invites JSONB DEFAULT '[]', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    console.log("DB Ready ✅");
};
initDB();

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname))); 

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/get-data', async (req, res) => {
    const rs = await pool.query('SELECT content FROM site_data WHERE id = 1');
    res.json(rs.rows[0]?.content || []);
});

app.post('/save-data', async (req, res) => {
    await pool.query('INSERT INTO site_data (id, content) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content', [JSON.stringify(req.body)]);
    res.json({ status: "Saved!" });
});

app.post('/create-new-group', async (req, res) => {
    const { groupName, description, creator, invited } = req.body;
    try {
        await pool.query('INSERT INTO chat_groups (group_name, description, creator_email, pending_invites, members) VALUES ($1, $2, $3, $4, $5)', [groupName, description, creator, JSON.stringify(invited), JSON.stringify([creator])]);
        res.json({ status: "Success" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/get-my-groups', async (req, res) => {
    const email = req.query.email?.toLowerCase();
    const result = await pool.query('SELECT * FROM chat_groups');
    const joined = result.rows.filter(g => (g.members || []).includes(email));
    const pending = result.rows.filter(g => (g.pending_invites || []).includes(email));
    res.json({ joined, pending });
});

// --- SOCKET LOGIC ---
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

    socket.on('request-chat', (data) => {
        const targetId = onlineUsers[data.to?.toLowerCase()];
        if (targetId) io.to(targetId).emit('chat-requested', data);
    });

    socket.on('chat-response', (data) => {
        const reqId = onlineUsers[data.to?.toLowerCase()];
        if (reqId) io.to(reqId).emit('start-chat-confirmed', data);
    });

    // FIXED: Private Message Delivery
    socket.on('private-message', (data) => {
        const targetId = onlineUsers[data.to?.toLowerCase()];
        if (targetId) {
            io.to(targetId).emit('new-message', data);
        }
    });

    // FIXED: Leave Chat Logic
    socket.on('leave-chat', (friendEmail) => {
        const targetId = onlineUsers[friendEmail?.toLowerCase()];
        if (targetId) io.to(targetId).emit('chat-ended-by-friend');
    });

    socket.on('disconnect', () => {
        for (let e in onlineUsers) { if (onlineUsers[e] === socket.id) { delete onlineUsers[e]; break; } }
        io.emit('update-online-list', Object.keys(onlineUsers));
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server live on ${PORT} 🚀`));
