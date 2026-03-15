require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');
const cors = require('cors');
const Database = require('better-sqlite3');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const svgCaptcha = require('svg-captcha');
const cookieParser = require('cookie-parser');

// Environment Variables
const PORT = process.env.PORT || 5000;
const DB_PATH = process.env.DB_PATH || './database/chat.db';
const JWT_SECRET = process.env.JWT_SECRET || 'default_secret_please_change';
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'cookie_secret_change_me';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// -----------------------------------------
// Ensure database folder exists
// -----------------------------------------
const dbDir = DB_PATH.substring(0, DB_PATH.lastIndexOf('/'));
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// -----------------------------------------
// SETUP SQLITE DATABASE
// -----------------------------------------
const db = new Database(DB_PATH);

// USERS TABLE
db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        is_admin INTEGER DEFAULT 0,
        is_online INTEGER DEFAULT 0
    )
`).run();

// MESSAGES TABLE
db.prepare(`
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        message TEXT,
        timestamp TEXT
    )
`).run();

// BANS TABLE
db.prepare(`
    CREATE TABLE IF NOT EXISTS bans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE
    )
`).run();

// Ensure is_admin column exists
try {
    db.prepare(`ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0`).run();
} catch (e) { /* ignore */ }

try {
    db.prepare(`ALTER TABLE users ADD COLUMN is_online INTEGER DEFAULT 0`).run();
} catch (e) { /* ignore */ }

// Insert master admin if missing
const adminUser = db.prepare(`SELECT * FROM users WHERE username=?`).get(ADMIN_USERNAME);
if (!adminUser) {
    const salt = bcrypt.genSaltSync(10);
    const hashedAdminPass = bcrypt.hashSync(ADMIN_PASSWORD, salt);
    db.prepare(`INSERT INTO users (username, password, is_admin) VALUES (?, ?, 1)`)
        .run(ADMIN_USERNAME, hashedAdminPass);
    console.log("Admin user created.");
} else {
    // Optional: Update admin password if it matches the plain text one (migration)
    // For now, we assume if admin exists, it's set up. 
    // If you want to force reset admin pass from env, you'd do it here.
}

// -----------------------------------------
// Express Setup
// -----------------------------------------
const app = express();
const server = http.createServer(app);

// Security Headers
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS - Allow same-origin (NGINX proxy) and known domains
const allowedOrigins = [
    'https://copythingz.shop',
    'https://chat.copythingz.shop',
    'https://chatapi.copythingz.shop',
    'http://194.195.213.151',       // Server public IP
    'http://localhost:3000',        // Dev
    'http://localhost:5173',        // Vite Dev
    'http://127.0.0.1:5500'         // Dev
];

app.use(cors({
    origin: (origin, cb) => {
        // Allow requests with no origin (same-origin via NGINX proxy, mobile apps, curl)
        if (!origin) return cb(null, true);

        // Allow any origin in the whitelist
        if (allowedOrigins.indexOf(origin) !== -1) {
            return cb(null, true);
        }

        // Allow requests from the same server IP (http://x.x.x.x or https://x.x.x.x)
        // This handles accessing via public IP when frontend & backend are co-hosted
        if (origin.match(/^https?:\/\/\d+\.\d+\.\d+\.\d+(:\d+)?$/)) {
            return cb(null, true);
        }

        const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
        return cb(new Error(msg), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

// Handle preflight requests
app.options('*splat', cors());

app.use(cookieParser(COOKIE_SECRET));
app.use(bodyParser.json());

// Rate Limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: "Too many requests from this IP, please try again later."
});
app.use('/api/', apiLimiter);

// Trust Proxy for secure cookies behind Nginx/Netlify
app.set('trust proxy', 1);

// -----------------------------------------
// CAPTCHA
// -----------------------------------------
app.get('/api/captcha', (req, res) => {
    const captcha = svgCaptcha.create({
        size: 5,
        noise: 2,
        color: true,
        background: '#1e1b4b', // Dark Navy
        width: 150,
        height: 50,
        fontSize: 50
    });

    res.cookie('captcha', captcha.text, {
        maxAge: 1000 * 60 * 10, // 10 mins
        httpOnly: true,
        signed: true,
        sameSite: 'none', // Required for cross-site (Netlify -> Ubuntu)
        secure: true      // Required for SameSite=None
    });

    res.type('svg');
    res.status(200).send(captcha.data);
});

// -----------------------------------------
// ADMIN LOGIN (JWT)
// -----------------------------------------
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;

    // Check against DB or Env (if we want master admin to always match env)
    // Here we check DB for "Admin" user
    const user = db.prepare(`SELECT * FROM users WHERE username=?`).get(username);

    if (!user || user.is_admin !== 1) {
        return res.status(401).json({ message: "Invalid admin credentials" });
    }

    const validPass = bcrypt.compareSync(password, user.password);
    if (!validPass) {
        return res.status(401).json({ message: "Invalid admin credentials" });
    }

    const token = jwt.sign(
        { username: user.username, role: "admin" },
        JWT_SECRET,
        { expiresIn: "24h" }
    );

    res.json({ token });
});

// -----------------------------------------
// ADMIN JWT VERIFY MIDDLEWARE
// -----------------------------------------
function verifyAdminJWT(req, res, next) {
    const header = req.headers.authorization;
    if (!header) return res.status(403).json({ message: "Missing token" });

    const token = header.split(" ")[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.admin = decoded;
        next();
    } catch {
        return res.status(403).json({ message: "Invalid or expired token" });
    }
}

// -----------------------------------------
// USER REGISTER
// -----------------------------------------
app.post('/api/register', (req, res) => {
    const { username, password, captcha } = req.body;

    if (!req.signedCookies.captcha || req.signedCookies.captcha !== captcha) {
        return res.status(400).json({ message: "Invalid CAPTCHA. Please try again." });
    }

    if (!username || !password)
        return res.status(400).json({ message: "Missing username or password" });

    if (username.length < 3 || password.length < 6) {
        return res.status(400).json({ message: "Username must be 3+ chars, password 6+ chars" });
    }

    try {
        const salt = bcrypt.genSaltSync(10);
        const hashed = bcrypt.hashSync(password, salt);

        db.prepare(`INSERT INTO users (username, password) VALUES (?, ?)`)
            .run(username, hashed);

        res.clearCookie('captcha'); // Clear captcha after success
        res.json({ message: "User registered" });
    } catch (err) {
        if (err.message.includes("UNIQUE")) {
            return res.status(400).json({ message: "Username already exists" });
        }
        console.error(err);
        return res.status(500).json({ message: "Server error" });
    }
});

// -----------------------------------------
// USER LOGIN
// -----------------------------------------
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    const user = db.prepare(`SELECT * FROM users WHERE username=?`).get(username);

    if (!user) {
        return res.status(401).json({ message: "Invalid username or password" });
    }

    // Check if password matches hash (or plain text for legacy/migration support if needed)
    // NOTE: For security, we assume all passwords are now hashed. 
    // If you have old plain text passwords, you might need a migration strategy.
    // Here we strictly check hash.
    const validPass = bcrypt.compareSync(password, user.password);
    if (!validPass) {
        return res.status(401).json({ message: "Invalid username or password" });
    }

    const banned = db.prepare(`SELECT username FROM bans WHERE username=?`).get(username);
    if (banned) return res.status(403).json({ message: "User is banned" });

    res.clearCookie('captcha'); // Clear captcha after success
    res.json({
        message: "Login successful",
        username: user.username,
        isAdmin: !!user.is_admin
    });
});

// -----------------------------------------
// ADMIN API
// -----------------------------------------

// ALL USERS WITH STATUS
app.get('/api/admin/all-users', verifyAdminJWT, (req, res) => {
    const users = db.prepare(`
        SELECT id, username, is_admin,
               CASE WHEN is_online = 1 THEN 1 ELSE 0 END AS is_online
        FROM users ORDER BY username
    `).all();

    res.json(users);
});

// DELETE USER
app.delete('/api/admin/users/:id', verifyAdminJWT, (req, res) => {
    const { id } = req.params;

    const check = db.prepare(`SELECT * FROM users WHERE id=?`).get(id);

    if (!check) return res.json({ message: "User does not exist." });

    if (check.username === ADMIN_USERNAME) {
        return res.status(400).json({ message: "Cannot delete master Admin." });
    }

    db.prepare(`DELETE FROM users WHERE id=?`).run(id);
    res.json({ message: "User deleted successfully" });
});

// GET MESSAGES
app.get('/api/admin/messages', verifyAdminJWT, (req, res) => {
    const messages = db.prepare(`
        SELECT * FROM messages ORDER BY id DESC LIMIT 200
    `).all().reverse();
    res.json(messages);
});

// DELETE ALL MESSAGES
app.delete('/api/admin/messages/delete-all', verifyAdminJWT, (req, res) => {
    try {
        const result = db.prepare(`DELETE FROM messages`).run();
        console.log(`Deleted ${result.changes} messages`);
        res.json({
            message: "All messages deleted successfully",
            deletedCount: result.changes
        });
    } catch (error) {
        console.error("Error deleting all messages:", error);
        res.status(500).json({ message: "Failed to delete messages" });
    }
});

// DELETE MESSAGE
app.delete('/api/admin/messages/:id', verifyAdminJWT, (req, res) => {
    db.prepare(`DELETE FROM messages WHERE id=?`).run(req.params.id);
    res.json({ message: "Message deleted" });
});

// BANNED USERS
app.get('/api/admin/bans', verifyAdminJWT, (req, res) => {
    res.json(db.prepare(`SELECT username FROM bans`).all());
});

// BAN USER
app.post('/api/admin/ban', verifyAdminJWT, (req, res) => {
    const { username } = req.body;
    db.prepare(`INSERT OR IGNORE INTO bans(username) VALUES(?)`)
        .run(username);

    // Also kick
    const socket = onlineUsers.get(username);
    if (socket) {
        socket.emit("banned");

        // Give it a moment to receive the event before cutting connection
        setTimeout(() => {
            socket.disconnect(true);
        }, 1500);

        onlineUsers.delete(username);
        db.prepare(`UPDATE users SET is_online=0 WHERE username=?`).run(username);
    }

    res.json({ message: "User banned" });
});

// UNBAN USER
app.post('/api/admin/unban', verifyAdminJWT, (req, res) => {
    db.prepare(`DELETE FROM bans WHERE username=?`)
        .run(req.body.username);
    res.json({ message: "User unbanned" });
});

// KICK USER (socket disconnect)
const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        credentials: true
    }
});

const onlineUsers = new Map();

app.post('/api/admin/kick', verifyAdminJWT, (req, res) => {
    const username = req.body.username;
    const socket = onlineUsers.get(username);

    if (socket) {
        // Emit 'kicked' event so client can log out
        socket.emit("kicked");

        // Give it a moment to receive the event before cutting connection
        setTimeout(() => {
            socket.disconnect(true);
        }, 1500);

        onlineUsers.delete(username);
        db.prepare(`UPDATE users SET is_online=0 WHERE username=?`).run(username);
    }

    res.json({ message: "User kicked" });
});

// -----------------------------------------
// ADMIN POWER FEATURES
// -----------------------------------------
let slowMode = 0; // seconds
const lastMessageTimes = new Map();

app.post('/api/admin/broadcast', verifyAdminJWT, (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ message: "Message required" });

    // Emit to all connected clients
    io.emit("system_broadcast", {
        message,
        timestamp: new Date().toISOString()
    });
    res.json({ message: "Broadcast sent" });
});

app.post('/api/admin/slow-mode', verifyAdminJWT, (req, res) => {
    const { duration } = req.body;
    slowMode = parseInt(duration) || 0;

    // Notify clients to update UI
    io.emit("slow_mode_updated", { enabled: slowMode > 0, duration: slowMode });
    res.json({ message: `Slow mode set to ${slowMode}s` });
});

// -----------------------------------------
// SOCKET.IO LOGIC
// -----------------------------------------
function loadHistory() {
    return db.prepare(`
        SELECT username, message, timestamp
        FROM messages ORDER BY id DESC LIMIT 200
    `).all().reverse();
}

function saveMessage(u, m, t) {
    db.prepare(`
        INSERT INTO messages(username, message, timestamp)
        VALUES (?, ?, ?)
    `).run(u, m, t);
}

io.on('connection', (socket) => {
    socket.emit("chatHistory", loadHistory());

    socket.on("join", (username) => {
        socket.username = username;

        const banned = db.prepare(`SELECT username FROM bans WHERE username=?`)
            .get(username);

        if (banned) {
            socket.emit("message", {
                username: "System",
                message: "You are banned from the chat.",
                timestamp: new Date().toISOString()
            });
            return socket.disconnect();
        }

        // Track online status in DB + memory
        onlineUsers.set(username, socket);
        db.prepare(`UPDATE users SET is_online=1 WHERE username=?`).run(username);

        io.emit("updateUserList", [...onlineUsers.keys()]);
    });

    socket.on("message", (data) => {
        if (!data.username || !data.message) return;

        // Slow Mode Check (Skip for Admin)
        if (slowMode > 0 && data.username !== "Admin") {
            const lastTime = lastMessageTimes.get(data.username) || 0;
            const now = Date.now();
            if (now - lastTime < slowMode * 1000) {
                // Send specific error event or reuse private_message as system warning
                socket.emit("private_message", {
                    from: "System",
                    message: `Slow mode is active. Please wait ${slowMode} seconds between messages.`,
                    timestamp: new Date().toISOString()
                });
                return;
            }
            lastMessageTimes.set(data.username, now);
        }

        saveMessage(data.username, data.message, data.timestamp);
        io.emit("message", data);
    });

    socket.on("private_message", ({ to, message }) => {
        if (!to || !message) return;

        const recipientSocket = onlineUsers.get(to);
        const timestamp = new Date().toISOString();

        if (recipientSocket) {
            // 1. Send to Recipient
            recipientSocket.emit("private_message", {
                from: socket.username,
                message: message,
                timestamp: timestamp
            });

            // 2. Send back to Sender (so it shows in their UI)
            socket.emit("private_message", {
                from: socket.username,
                to: to,
                message: message,
                timestamp: timestamp
            });
        }
    });

    socket.on("disconnect", () => {
        onlineUsers.delete(socket.username);

        if (socket.username) {
            db.prepare(`UPDATE users SET is_online=0 WHERE username=?`)
                .run(socket.username);
        }

        io.emit("updateUserList", [...onlineUsers.keys()]);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
