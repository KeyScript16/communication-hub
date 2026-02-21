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
        // 1. Create the original data table
        await pool.query('CREATE TABLE IF NOT EXISTS site_data (id SERIAL PRIMARY KEY, content JSONB)');
        
        // 2. Create the NEW Group Chat table (The "Backdoor" fix)
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
// --- NEW GROUP ROUTES ---

// 1. Create the Group in the DB
app.post('/create-new-group', async (req, res) => {
    const { groupName, description, creator, invited } = req.body;
    try {
        await pool.query(
            'INSERT INTO chat_groups (group_name, description, creator_email, pending_invites, members) VALUES ($1, $2, $3, $4, $5)',
            [groupName, description, creator, JSON.stringify(invited), JSON.stringify([creator])]
        );
        res.json({ status: "Group Created!" });
    } catch (err) {
        console.error("Group Create Error:", err);
        res.status(500).json({ error: "DB Error" });
    }
});

// 2. Get Groups for a specific user (Invites + Joined)
app.get('/get-my-groups', async (req, res) => {
    const { email } = req.query;
    try {
        // Find groups where user is either a member OR has a pending invite
        const result = await pool.query(
            "SELECT * FROM chat_groups WHERE members @> $1 OR pending_invites @> $1",
            [JSON.stringify([email])]
        );
        
        const joined = result.rows.filter(g => g.members.includes(email));
        const pending = result.rows.filter(g => g.pending_invites.includes(email));
        
        res.json({ joined, pending });
    } catch (err) {
        console.error("Fetch Groups Error:", err);
        res.status(500).json({ joined: [], pending: [] });
    }
});

// 3. Accept a Group Invite
app.post('/accept-group', async (req, res) => {
    const { groupId, email } = req.body;
    try {
        const groupRes = await pool.query('SELECT * FROM chat_groups WHERE id = $1', [groupId]);
        const group = groupRes.rows[0];

        if (group) {
            let members = group.members || [];
            let pending = group.pending_invites || [];

            if (!members.includes(email)) members.push(email);
            pending = pending.filter(e => e !== email);

            await pool.query(
                'UPDATE chat_groups SET members = $1, pending_invites = $2 WHERE id = $3',
                [JSON.stringify(members), JSON.stringify(pending), groupId]
            );
            res.json({ status: "Joined!" });
        }
    } catch (err) {
        res.status(500).send("Error joining");
    }
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


