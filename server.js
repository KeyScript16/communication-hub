const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);

// 1. Database Connection (using your Render Environment Variable)
const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
});

// 2. Initialize Database Tables
const initDB = async () => {
    try {
        // Table for User Data (Logins, Friends, etc.)
        await pool.query('CREATE TABLE IF NOT EXISTS site_data (id SERIAL PRIMARY KEY, content JSONB)');
        // Table for Clubs/Groups
        await pool.query(`CREATE TABLE IF NOT EXISTS chat_groups (
            id SERIAL PRIMARY KEY, group_name TEXT NOT NULL, description TEXT,
            creator_email TEXT NOT NULL, members JSONB DEFAULT '[]',
            pending_invites JSONB DEFAULT '[]', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log("DB Ready ✅");
    } catch (err) {
        console.error("DB Error:", err);
    }
};
initDB();

// 3. Middleware Setup
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname))); 

// 4. API Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Get all user data (for logins and friends list)
app.get('/get-data', async (req, res) => {
    try {
        const rs = await pool.query('SELECT content FROM site_data WHERE id = 1');
        res.json(rs.rows[0]?.content || []);
    } catch (err) { res.status(500).json([]); }
});

// Save all user data
app.post('/save-data', async (req, res) => {
    try {
        await pool.query('INSERT INTO site_data (id, content) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content', [JSON.stringify(req.body)]);
        res.json({ status: "Saved!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create a new Club
app.post('/create-new-group', async (req, res) => {
    const { groupName, description, creator, invited } = req.body;
    try {
        await pool.query('INSERT INTO chat_groups (group_name, description, creator_email, pending_invites, members) VALUES ($1, $2, $3, $4, $5)', 
        [groupName, description, creator, JSON.stringify(invited), JSON.stringify([creator])]);
        res.json({ status: "Success" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get Clubs for a specific user
app.get('/get-my-groups', async (req, res) => {
    const email = req.query.email?.toLowerCase();
    try {
        const result = await pool.query('SELECT * FROM chat_groups');
        const joined = result.rows.filter(g => (g.members || []).includes(email));
        res.json({ joined });
    } catch (err) { res.status(500).json({ joined: [] }); }
});

// 5. Socket.io Logic
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });
let onlineUsers = {};

io.on('connection', (socket) => {
    
    // User comes online
    socket.on('go-online', (data) => {
        if (data?.email) {
            const cleanEmail = data.email.toLowerCase();
            onlineUsers[cleanEmail] = socket.id;
            io.emit('update-online-list', Object.keys(onlineUsers));
            console.log(`✨ ONLINE: ${cleanEmail}`);
        }
    });

    // FAST OFFLINE FIX: Triggered by Logout or Back buttons
    socket.on('manual-offline', (email) => {
        if (email) {
            const cleanEmail = email.toLowerCase();
            delete onlineUsers[cleanEmail];
            io.emit('update-online-list', Object.keys(onlineUsers));
            console.log(`👋 MANUAL OFFLINE: ${cleanEmail}`);
        }
    });

    // Send private message
    socket.on('private-message', (data) => {
        const targetId = onlineUsers[data.to?.toLowerCase()];
        if (targetId) {
            io.to(targetId).emit('new-message', data);
        }
    });

    // Handle typing status
    socket.on('typing', (data) => {
        const targetId = onlineUsers[data.to?.toLowerCase()];
        if (targetId) {
            io.to(targetId).emit('friend-typing', data);
        }
    });

    // Leave Chat / End Session
    socket.on('leave-chat', (friendEmail) => {
        const targetId = onlineUsers[friendEmail?.toLowerCase()];
        if (targetId) io.to(targetId).emit('chat-ended-by-friend');
    });

    // Handle Tab Close / Disconnect
    socket.on('disconnect', () => {
        for (let e in onlineUsers) { 
            if (onlineUsers[e] === socket.id) { 
                delete onlineUsers[e]; 
                console.log(`🔌 DISCONNECT: ${e}`);
                break; 
            } 
        }
        io.emit('update-online-list', Object.keys(onlineUsers));
    });
});

// 6. Start the Engine
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server live on ${PORT} 🚀`));
