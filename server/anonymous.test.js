const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const signature = require('cookie-signature');
const { io } = require('../client/node_modules/socket.io-client');

test('guest rooms, matching, reports and account history stay isolated', { timeout: 30000 }, async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anonymous-chat-'));
    const databasePath = path.join(directory, 'nested', 'chat.db');
    fs.mkdirSync(path.dirname(databasePath));
    const db = new Database(databasePath);
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password TEXT, is_admin INTEGER DEFAULT 0, is_online INTEGER DEFAULT 0)');
    const insert = db.prepare('INSERT INTO users(username,password) VALUES(?,?)');
    insert.run('Alice', bcrypt.hashSync('test-password', 4));
    insert.run('Bob', bcrypt.hashSync('test-password', 4));
    db.close();
    const reservation = net.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
    const cookieSecret = 'test-only-anonymous-cookie-secret-32-characters';
    const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: {
        ...process.env, PORT: String(port), DB_PATH: databasePath,
        JWT_SECRET: 'test-only-anonymous-jwt-secret-32-characters', COOKIE_SECRET: cookieSecret,
        ADMIN_USERNAME: 'TestAdmin', ADMIN_PASSWORD: 'test-admin-password'
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    const sockets = [];
    t.after(async () => {
        sockets.forEach(socket => socket.disconnect());
        if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
        fs.rmSync(directory, { recursive: true, force: true });
    });
    let output = '';
    await new Promise((resolve, reject) => {
        child.stdout.on('data', chunk => { output += chunk; if (output.includes('ChatApp running')) resolve(); });
        child.stderr.on('data', chunk => { output += chunk; });
        child.once('exit', () => reject(new Error(output)));
    });
    const base = `http://127.0.0.1:${port}`;
    const post = (route, data, headers = {}) => fetch(base + route, { method: 'POST', headers: {
        'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
    assert.equal((await fetch(base + '/api/health')).status, 200);
    assert.equal((await post('/api/anonymous/session', {})).status, 400);
    const guests = [];
    for (let i = 0; i < 3; i++) {
        const response = await post('/api/anonymous/session', { captcha: 'ABCDE', alias: 'Admin' }, {
            Cookie: 'captcha=' + encodeURIComponent('s:' + signature.sign('ABCDE', cookieSecret))
        });
        assert.equal(response.status, 200);
        const cookie = response.headers.getSetCookie().find(value => value.startsWith('anonymous_session=')).split(';')[0];
        assert.match(response.headers.getSetCookie().join(';'), /HttpOnly/);
        const { guest } = await response.json();
        assert.notEqual(guest.alias, 'Admin');
        guests.push({ guest, cookie });
    }
    async function connect(options = {}) {
        const socket = io(base + '/anonymous', { autoConnect: false, reconnection: false, ...options });
        sockets.push(socket); const ready = once(socket, 'ready'); socket.connect(); await ready; return socket;
    }
    const [a, b, c] = await Promise.all(guests.map(guest => connect({ extraHeaders: { Cookie: guest.cookie } })));
    const command = (socket, event, data = {}) => new Promise((resolve, reject) => {
        socket.timeout(1500).emit(event, data, (err, reply) => err ? reject(err) : resolve(reply));
    });
    assert.equal((await command(a, 'join_room', { room: 'missing' })).ok, false);
    await command(a, 'join_room', { room: 'lounge' }); await command(b, 'join_room', { room: 'lounge' });
    await command(c, 'join_room', { room: 'games' });
    let leaked = false; c.on('chat_message', () => { leaked = true; });
    const received = once(b, 'chat_message');
    assert.equal((await command(a, 'send_message', { message: 'hello room', sender: 'Admin', alias: 'Admin', timestamp: 'forged' })).ok, true);
    const [message] = await received;
    assert.equal(message.sender, guests[0].guest.id); assert.equal(message.alias, guests[0].guest.alias);
    assert.ok(Number.isFinite(Date.parse(message.timestamp)));
    await new Promise(resolve => setTimeout(resolve, 60)); assert.equal(leaked, false);
    assert.equal((await command(a, 'send_message', { message: {} })).ok, false);
    assert.equal((await command(a, 'send_message', { message: 'x'.repeat(2001) })).ok, false);
    assert.equal((await command(c, 'report_message', { messageId: message.id, reason: 'spam' })).ok, false);
    assert.equal((await command(b, 'report_message', { messageId: message.id, reason: 'spam' })).ok, true);
    const login = await post('/api/login', { username: 'Alice', password: 'test-password' });
    const alice = await login.json(); const member = await connect({ auth: { token: alice.token } });
    await command(member, 'join_room', { room: 'lounge' });
    const clientId = require('node:crypto').randomUUID();
    const firstDelivery = await command(a, 'send_message', { message: 'retained for the account recipient', clientId });
    const retryDelivery = await command(a, 'send_message', { message: 'retained for the account recipient', clientId });
    assert.equal(firstDelivery.id, retryDelivery.id);
    const history = await (await fetch(base + '/api/account/history', { headers: { Authorization: `Bearer ${alice.token}` } })).json();
    assert.equal(history.length, 1); assert.equal(history[0].message, 'retained for the account recipient');
    const bob = await (await post('/api/login', { username: 'Bob', password: 'test-password' })).json();
    const otherHistory = await (await fetch(base + '/api/account/history', { headers: { Authorization: `Bearer ${bob.token}` } })).json();
    assert.deepEqual(otherHistory, []);
    assert.equal((await fetch(base + '/api/account/history', { headers: { Cookie: guests[0].cookie } })).status, 401);
    assert.equal((await fetch(base + '/api/account/history', { method: 'DELETE', headers: { Authorization: `Bearer ${alice.token}` } })).status, 200);
    const emptyHistory = await (await fetch(base + '/api/account/history', { headers: { Authorization: `Bearer ${alice.token}` } })).json();
    assert.deepEqual(emptyHistory, []);
    await command(member, 'leave_chat');
    await command(a, 'find_partner');
    const matchedA = once(a, 'matched'); const matchedB = once(b, 'matched');
    assert.equal((await command(b, 'find_partner')).state, 'matched');
    assert.equal((await matchedA)[0].partner.id, guests[1].guest.id);
    assert.equal((await matchedB)[0].partner.id, guests[0].guest.id);
    const privateReceived = once(b, 'chat_message');
    await command(a, 'send_message', { message: 'hello private' });
    assert.equal((await privateReceived)[0].message, 'hello private'); assert.equal(leaked, false);
    assert.equal((await command(a, 'block_guest', { guest: guests[1].guest.id })).ok, true);
    assert.equal((await command(a, 'find_partner')).state, 'waiting');
    assert.equal((await command(b, 'find_partner')).state, 'waiting');
    const matchedC = once(c, 'matched'); await command(c, 'find_partner');
    assert.equal((await matchedC)[0].partner.id, guests[0].guest.id);
    const blockedUpdate = once(a, 'blocked_guests');
    assert.equal((await command(a, 'unblock_guest', { guest: guests[1].guest.id })).ok, true);
    assert.deepEqual((await blockedUpdate)[0], []);
    await command(a, 'join_room', { room: 'lounge' });
    await command(b, 'join_room', { room: 'lounge' });
    const afterUnblock = once(a, 'chat_message');
    await command(b, 'send_message', { message: 'messages resume after unblocking' });
    assert.equal((await afterUnblock)[0].sender, guests[1].guest.id);
    await command(a, 'find_partner');
    const rematched = once(a, 'matched');
    await command(b, 'find_partner');
    assert.equal((await rematched)[0].partner.id, guests[1].guest.id);
    const results = [];
    for (let i = 0; i < 9; i++) results.push(await command(a, 'send_message', { message: 'rate limit test' }));
    assert.ok(results.some(reply => !reply.ok && reply.message.includes('slow down')));
    const admin = await (await post('/api/admin/login', { username: 'TestAdmin', password: 'test-admin-password' })).json();
    const adminHeaders = { Authorization: `Bearer ${admin.token}` };
    const reports = await (await fetch(base + '/api/admin/reports', { headers: adminHeaders })).json();
    assert.equal(reports.length, 1); assert.equal(reports[0].target, guests[0].guest.id);
    assert.equal((await post('/api/admin/guest-ban', { id: guests[0].guest.id }, adminHeaders)).status, 200);
    assert.equal((await fetch(base + '/api/anonymous/session', { headers: { Cookie: guests[0].cookie } })).status, 403);
    assert.equal((await post('/api/anonymous/session', {}, { Cookie: guests[0].cookie })).status, 403);
    const inspectDb = new Database(databasePath);
    assert.equal(inspectDb.prepare('SELECT count(*) AS total FROM messages').get().total, 0);
    inspectDb.close();
});
