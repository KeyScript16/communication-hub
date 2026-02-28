const path = require('path'); // FIXED: Moved to Line 1 to prevent ReferenceError
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

const initDB = async () => {
    try {
        await pool.query('CREATE TABLE IF NOT EXISTS site_data (id SERIAL PRIMARY KEY, content JSONB)');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS chat_groups (
                id SERIAL PRIMARY KEY, group_name TEXT NOT NULL, description TEXT,
                creator_email TEXT NOT NULL, members JSONB DEFAULT '[]',
                pending_invites JSONB DEFAULT '[]', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("DB Ready ✅");
    } catch (err) { console.error("DB Error:", err); }
};
initDB();

// 2. MIDDLEWARE
app.use(cors({ origin: '*' })); // FIXED: Open CORS for GitHub Pages
app.use(express.json());
app.use(express.static(path.join(__dirname))); 

// 3. ROUTES
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
    if (!email) return res.json({ joined: [], pending: [] });
    try {
        const result = await pool.query('SELECT * FROM chat_groups');
        const joined = result.rows.filter(g => (g.members || []).includes(email));
        const pending = result.rows.filter(g => (g.pending_invites || []).includes(email));
        res.json({ joined, pending });
    } catch (e) { res.status(500).json({ joined: [], pending: [] }); }
});

// 4. SOCKET.IO
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
server.listen(PORT, () => console.log(`Server live on ${PORT} 🚀`));
