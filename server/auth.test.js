const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { io } = require('../client/node_modules/socket.io-client');

test('authenticated chat rejects impersonation and protects admin endpoints', { timeout: 20000 }, async (t) => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-auth-'));
    const databasePath = path.join(folder, 'database', 'chat.db');
    fs.mkdirSync(path.dirname(databasePath));
    const db = new Database(databasePath);
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password TEXT, is_admin INTEGER DEFAULT 0, is_online INTEGER DEFAULT 0)');
    db.prepare('INSERT INTO users(username,password) VALUES (?,?)').run('Alice', bcrypt.hashSync('test-password', 4));
    db.close();
    const portReservation = net.createServer();
    portReservation.listen(0, '127.0.0.1');
    await once(portReservation, 'listening');
    const port = portReservation.address().port;
    await new Promise(resolve => portReservation.close(resolve));
    const secret = 'test-only-jwt-secret-at-least-32-characters';
    const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
        env: { ...process.env, PORT: String(port), DB_PATH: databasePath, JWT_SECRET: secret,
            COOKIE_SECRET: 'test-only-cookie-secret-at-least-32-characters',
            ADMIN_USERNAME: 'TestAdmin', ADMIN_PASSWORD: 'test-admin-password' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    const sockets = [];
    t.after(async () => {
        sockets.forEach(socket => socket.disconnect());
        if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
        fs.rmSync(folder, { recursive: true, force: true });
    });
    let output = '';
    await new Promise((resolve, reject) => {
        child.stdout.on('data', chunk => {
            output += chunk;
            if (output.includes('ChatApp running')) resolve();
        });
        child.stderr.on('data', chunk => { output += chunk; });
        child.once('exit', () => reject(new Error(output)));
    });
    const base = `http://127.0.0.1:${port}`;
    const post = async (route, body) => fetch(base + route, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    assert.equal((await post('/api/login', {})).status, 400);
    assert.equal((await post('/api/register', { username: [], password: {} })).status, 400);
    const login = await post('/api/login', { username: 'Alice', password: 'test-password' });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    assert.equal((await fetch(base + '/api/admin/all-users', {
        headers: { Authorization: `Bearer ${token}` }
    })).status, 403);
    function socketFor(auth) {
        const socket = io(base, { auth, autoConnect: false, reconnection: false, timeout: 2000 });
        sockets.push(socket);
        return socket;
    }
    async function rejected(auth) {
        const socket = socketFor(auth);
        let historyReceived = false;
        socket.on('chatHistory', () => { historyReceived = true; });
        const error = once(socket, 'connect_error');
        socket.connect();
        assert.match((await error)[0].message, /Authentication required/);
        assert.equal(historyReceived, false);
    }
    await rejected({});
    await rejected({ token: 'forged' });
    await rejected({ token: jwt.sign({ username: 'Alice', role: 'chat' }, secret, { expiresIn: -1 }) });
    await rejected({ token: jwt.sign({ username: 'Alice', role: 'admin' }, secret) });
    const socket = socketFor({ token });
    const connected = once(socket, 'connect');
    socket.connect();
    await connected;
    socket.emit('join', 'TestAdmin');
    const received = once(socket, 'message');
    socket.emit('message', { username: 'TestAdmin', message: 'hello', timestamp: 'forged' });
    const [message] = await received;
    assert.equal(message.username, 'Alice');
    assert.equal(message.message, 'hello');
    assert.ok(Number.isFinite(Date.parse(message.timestamp)));
    const adminLogin = await post('/api/admin/login', { username: 'TestAdmin', password: 'test-admin-password' });
    const admin = await adminLogin.json();
    const disconnected = once(socket, 'disconnect');
    const ban = await fetch(base + '/api/admin/ban', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ username: 'Alice' })
    });
    assert.equal(ban.status, 200);
    await disconnected;
    await rejected({ token });
});
