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
        await pool.query(`
            CREATE TABLE IF NOT EXISTS chat_groups (
                id SERIAL PRIMARY KEY,
                group_name TEXT NOT NULL,
                description TEXT,
                creator_email TEXT NOT NULL,
                members JSONB DEFAULT '[]',
                pending_invites JSONB DEFAULT '[]',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("Database Tables Verified & Ready ✅");
    } catch (err) { 
        console.error("DB Init Error:", err); 
    }
};
initDB();

// 2. MIDDLEWARE (The "Club Fix" for Express)
app.use(cors({ origin: '*' })); 
app.use(express.json());
app.use(express.static(path.join(__dirname))); 

async function readDB() {
    try {
        const res = await pool.query('SELECT content FROM site_data WHERE id = 1 LIMIT 1');
        return res.rows[0]?.content || []; 
    } catch (err) { 
        console.error("DB Read Error:", err);
        return []; 
    }
}

async function writeDB(data) {
    try {
        await pool.query(`
            INSERT INTO site_data (id, content) VALUES (1, $1) 
            ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content`, 
            [JSON.stringify(data)]
        );
    } catch (err) { console.error("DB Write Error:", err); }
}

// 3. API ROUTES
app.get('/get-data', async (req, res) => {
    const data = await readDB();
    res.json(data); 
});

app.post('/save-data', async (req, res) => {
    await writeDB(req.body);
    res.json({ status: "Saved!" });
});

app.post('/create-new-group', async (req, res) => {
    const { groupName, description, creator, invited } = req.body;
    try {
        const cleanInvited = Array.isArray(invited) ? invited.map(e => e.toLowerCase()) : [];
        await pool.query(
            'INSERT INTO chat_groups (group_name, description, creator_email, pending_invites, members) VALUES ($1, $2, $3, $4, $5)',
            [groupName, description, creator.toLowerCase(), JSON.stringify(cleanInvited), JSON.stringify([creator.toLowerCase()])]
        );
        res.json({ status: "Group Created!" });
    } catch (err) { res.status(500).json({ error: "DB Error" }); }
});

// FIXED: Improved Group Logic to prevent "Waking up server" hang
app.get('/get-my-groups', async (req, res) => {
    const email = req.query.email?.toLowerCase();
    if (!email) return res.json({ joined: [], pending: [] });

    try {
        const result = await pool.query('SELECT * FROM chat_groups');
        const joined = result.rows.filter(g => (g.members || []).includes(email));
        const pending = result.rows.filter(g => (g.pending_invites || []).includes(email));
        res.json({ joined, pending });
    } catch (err) {
        console.error("Fetch Groups Error:", err);
        res.status(500).json({ joined: [], pending: [] });
    }
});

app.post('/accept-group', async (req, res) => {
    const { groupId, email } = req.body;
    const cleanEmail = email.toLowerCase();
    try {
        const groupRes = await pool.query('SELECT * FROM chat_groups WHERE id = $1', [groupId]);
        const group = groupRes.rows[0];
        if (group) {
            let members = group.members || [];
            let pending = group.pending_invites || [];
            if (!members.includes(cleanEmail)) members.push(cleanEmail);
            pending = pending.filter(e => e !== cleanEmail);

            await pool.query(
                'UPDATE chat_groups SET members = $1, pending_invites = $2 WHERE id = $3',
                [JSON.stringify(members), JSON.stringify(pending), groupId]
            );
            res.json({ status: "Joined!" });
        }
    } catch (err) { res.status(500).send("Error joining"); }
});

// 4. SOCKET.IO (The "Club Fix" for Sockets)
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });
let onlineUsers = {}; 

io.on('connection', (socket) => {
    socket.on('go-online', (data) => {
        const email = data?.email?.toLowerCase().trim();
        if (email) {
            onlineUsers[email] = socket.id; 
            io.emit('update-online-list', Object.keys(onlineUsers));
        }
    });

    socket.on('request-chat', (data) => {
        const targetId = onlineUsers[data.to?.toLowerCase()];
        if (targetId) io.to(targetId).emit('chat-requested', data);
    });

    socket.on('chat-response', (data) => {
        const targetId = onlineUsers[data.to?.toLowerCase()];
        if (targetId) io.to(targetId).emit('start-chat-confirmed', data);
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

app.post('/admin/reset-all-data', async (req, res) => {
    if (req.body.adminPassword === "you must know what you're doing in order to delete everything.") {
        try {
            await pool.query('TRUNCATE TABLE chat_groups, site_data RESTART IDENTITY CASCADE');
            return res.json({ status: "System Purged!" });
        } catch (err) { return res.status(500).json({ error: "Reset Failed" }); }
    }
    res.status(403).json({ error: "Denied" });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server live on port ${PORT} 🚀`));
