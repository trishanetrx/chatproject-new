const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const ROOMS = [
    { id: 'lounge', name: 'The lounge', topic: 'A little bit of everything', image: '/rooms/lounge.jpg' },
    { id: 'music', name: 'Music', topic: 'On repeat, on stage, on your mind', image: '/rooms/music.jpg' },
    { id: 'games', name: 'Games & tech', topic: 'New worlds and good ideas', image: '/rooms/games.jpg' },
    { id: 'life', name: 'Everyday life', topic: 'Small wins and real conversations', image: '/rooms/life.jpg' }
];
const COOKIE = 'anonymous_session';
const SESSION_MS = 24 * 60 * 60 * 1000;
const REPORT_MS = 7 * SESSION_MS;

module.exports = function mountAnonymous({ app, io, db, jwtSecret, cookieSecret, allowedOrigins }) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS anonymous_sessions (
            id TEXT PRIMARY KEY, alias TEXT NOT NULL, expires INTEGER NOT NULL, banned INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS anonymous_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT, reporter TEXT NOT NULL, target TEXT NOT NULL,
            reason TEXT NOT NULL, evidence TEXT NOT NULL, created INTEGER NOT NULL, resolved INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS account_chat_history (
            account_id INTEGER NOT NULL, message_id TEXT NOT NULL, payload TEXT NOT NULL, created INTEGER NOT NULL,
            PRIMARY KEY(account_id, message_id)
        );
    `);
    const namespace = io.of('/anonymous');
    const active = new Map();
    const waiting = new Set();
    const recent = new Map();
    const blocked = new Map();
    const blockedList = id => [...(blocked.get(id) || new Map())].map(([guest, alias]) => ({ id: guest, alias }));
    const eventBudgets = new Map();
    const deliveries = new Map();
    const saveAccountMessage = db.prepare('INSERT OR IGNORE INTO account_chat_history(account_id,message_id,payload,created) VALUES(?,?,?,?)');
    const persistForAccounts = db.transaction((recipients, message) => {
        for (const recipient of recipients) if (recipient.guest.account) {
            saveAccountMessage.run(recipient.guest.accountId, message.id, JSON.stringify(message), Date.now());
        }
    });
    const rooms = new Map(ROOMS.map(room => [room.id, new Set()]));
    const parseCookies = cookieParser(cookieSecret);
    const sessionById = db.prepare('SELECT * FROM anonymous_sessions WHERE id=? AND expires>?');
    const getSession = request => {
        try {
            const decoded = jwt.verify(request.cookies?.[COOKIE], jwtSecret, { algorithms: ['HS256'] });
            if (decoded.role !== 'guest') return null;
            return sessionById.get(decoded.sid, Date.now()) || null;
        } catch { return null; }
    };
    const publicSession = session => ({ id: session.id, alias: session.alias, expires: session.expires });
    function accountFromToken(token) {
        try {
            const decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
            if (decoded.role !== 'chat' || !Number.isFinite(decoded.exp)) return null;
            const account = db.prepare('SELECT id,username FROM users WHERE username=?').get(decoded.username);
            if (!account || db.prepare('SELECT username FROM bans WHERE username=?').get(account.username)) return null;
            return { id: `member:${account.id}`, alias: account.username, expires: decoded.exp * 1000, account: true, accountId: account.id };
        } catch { return null; }
    }
    const requireAccount = (req, res, next) => {
        const account = accountFromToken(req.headers.authorization?.split(' ')[1]);
        if (!account) return res.status(401).json({ message: 'Please log in again.' });
        req.account = account;
        next();
    };
    app.get('/api/account/history', requireAccount, (req, res) => {
        res.set('Cache-Control', 'no-store');
        const history = db.prepare('SELECT payload FROM account_chat_history WHERE account_id=? AND created>? ORDER BY created DESC LIMIT 500').all(req.account.accountId, Date.now() - 30 * SESSION_MS);
        res.json(history.reverse().map(item => JSON.parse(item.payload)));
    });
    app.get('/api/account/session', requireAccount, (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json({ guest: req.account, rooms: roomList() });
    });
    app.delete('/api/account/history', requireAccount, (req, res) => {
        db.prepare('DELETE FROM account_chat_history WHERE account_id=?').run(req.account.accountId);
        res.json({ message: 'Your account history was cleared.' });
    });
    const roomList = () => ROOMS.map(room => ({ ...room, online: rooms.get(room.id).size }));
    const validOrigin = request => !request.headers.origin || allowedOrigins.includes(request.headers.origin);
    const cookieOptions = request => ({ httpOnly: true, sameSite: 'strict', secure: request.secure, path: '/', maxAge: SESSION_MS });

    app.get('/api/anonymous/session', (req, res) => {
        res.set('Cache-Control', 'no-store');
        const session = getSession(req);
        if (session?.banned) return res.status(403).json({ message: 'This guest session has been suspended.' });
        res.json({ guest: session ? publicSession(session) : null, rooms: roomList() });
    });
    app.post('/api/anonymous/session', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10,
        message: { message: 'Too many guest sessions. Please try again later.' } }), (req, res) => {
        res.set('Cache-Control', 'no-store');
        if (!validOrigin(req)) return res.status(403).json({ message: 'Origin not allowed.' });
        const existing = getSession(req);
        if (existing?.banned) return res.status(403).json({ message: 'This guest session has been suspended.' });
        if (existing) return res.json({ guest: publicSession(existing), rooms: roomList() });
        const captcha = req.body?.captcha;
        const expected = req.signedCookies.captcha;
        if (typeof captcha !== 'string' || !expected || captcha.toLowerCase() !== expected.toLowerCase()) {
            return res.status(400).json({ message: 'The security check did not match. Please try again.' });
        }
        if (active.size >= 500) return res.status(503).json({ message: 'The chat is full. Please try again shortly.' });
        const id = crypto.randomUUID();
        const adjectives = ['Quiet', 'Bright', 'Silver', 'Golden', 'Lucky', 'Mellow', 'Cosmic', 'Fresh'];
        const names = ['Comet', 'Signal', 'Echo', 'Orbit', 'Atlas', 'Pixel', 'Rhythm', 'Spark'];
        const alias = `${adjectives[crypto.randomInt(adjectives.length)]}${names[crypto.randomInt(names.length)]}-${id.slice(0, 4)}`;
        const expires = Date.now() + SESSION_MS;
        db.prepare('INSERT INTO anonymous_sessions(id,alias,expires) VALUES(?,?,?)').run(id, alias, expires);
        res.cookie(COOKIE, jwt.sign({ sid: id, role: 'guest' }, jwtSecret, { expiresIn: '24h' }), cookieOptions(req));
        res.clearCookie('captcha', { path: '/' });
        res.json({ guest: { id, alias, expires }, rooms: roomList() });
    });
    app.delete('/api/anonymous/session', (req, res) => {
        if (!validOrigin(req)) return res.status(403).json({ message: 'Origin not allowed.' });
        const session = getSession(req);
        if (session?.banned) return res.status(403).json({ message: 'This guest session has been suspended.' });
        if (session) {
            active.get(session.id)?.disconnect(true);
            db.prepare('DELETE FROM anonymous_sessions WHERE id=?').run(session.id);
        }
        res.clearCookie(COOKIE, { path: '/' });
        res.json({ message: 'Guest session ended.' });
    });
    app.get('/api/health', (_req, res) => {
        try { db.prepare('SELECT 1').get(); res.json({ status: 'ok' }); }
        catch { res.status(503).json({ status: 'unavailable' }); }
    });

    namespace.use((socket, next) => {
        if (!validOrigin(socket.request)) return next(new Error('Origin not allowed.'));
        if (socket.handshake.auth?.token) {
            const account = accountFromToken(socket.handshake.auth.token);
            if (!account) return next(new Error('Account session expired or suspended.'));
            if (active.size >= 500 && !active.has(account.id)) return next(new Error('The chat is full.'));
            socket.guest = account;
            return next();
        }
        parseCookies(socket.request, {}, () => {
            const session = getSession(socket.request);
            if (!session || session.banned) return next(new Error('Guest session expired or suspended.'));
            if (active.size >= 500 && !active.has(session.id)) return next(new Error('The chat is full.'));
            socket.guest = publicSession(session);
            next();
        });
    });
    function emitRooms() { namespace.emit('rooms', roomList()); }
    function presence(room) {
        namespace.to(`room:${room}`).emit('presence', [...rooms.get(room)].map(id => active.get(id)?.guest).filter(Boolean));
        emitRooms();
    }
    function leave(socket) {
        waiting.delete(socket.guest.id);
        if (socket.roomId) {
            const room = socket.roomId;
            rooms.get(room).delete(socket.guest.id);
            socket.leave(`room:${room}`);
            socket.roomId = null;
            presence(room);
        }
        if (socket.partnerId) {
            const partner = active.get(socket.partnerId);
            if (partner?.partnerId === socket.guest.id) {
                partner.partnerId = null;
                partner.conversationId = null;
                partner.emit('partner_left');
            }
            socket.partnerId = null;
            socket.conversationId = null;
        }
    }
    function budget(socket, kind, limit, window) {
        const key = `${socket.guest.id}:${kind}`;
        const now = Date.now();
        let state = eventBudgets.get(key);
        if (!state || state.until <= now) {
            state = { count: 0, until: now + window };
            eventBudgets.set(key, state);
        }
        state.count += 1;
        return state.count <= limit;
    }
    function eligible(socket) {
        return active.get(socket.guest.id) === socket && Date.now() < socket.guest.expires;
    }
    namespace.on('connection', socket => {
        active.get(socket.guest.id)?.disconnect(true);
        active.set(socket.guest.id, socket);
        if (socket.guest.account) db.prepare('UPDATE users SET is_online=1 WHERE id=?').run(socket.guest.accountId);
        socket.emit('ready', { guest: socket.guest, rooms: roomList(), blocked: blockedList(socket.guest.id) });
        const expiry = setTimeout(() => socket.disconnect(true), Math.max(0, socket.guest.expires - Date.now()));
        const handle = (event, action) => socket.on(event, (data, acknowledge) => {
            const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
            if (!eligible(socket)) return reply({ ok: false, message: 'Session unavailable. Please reconnect.' });
            if (!budget(socket, 'events', 60, 10000)) return reply({ ok: false, message: 'Too many actions. Please slow down.' });
            try { action(data, reply); }
            catch (error) { console.error('Anonymous event failed:', event, error.message); reply({ ok: false, message: 'Something went wrong. Please try again.' }); }
        });
        handle('join_room', (data, reply) => {
            if (!rooms.has(data?.room)) return reply({ ok: false, message: 'Unknown room.' });
            if (rooms.get(data.room).size >= 100 && socket.roomId !== data.room) return reply({ ok: false, message: 'This room is full.' });
            leave(socket);
            socket.roomId = data.room;
            socket.join(`room:${data.room}`);
            rooms.get(data.room).add(socket.guest.id);
            presence(data.room);
            reply({ ok: true, room: data.room });
        });
        handle('find_partner', (_data, reply) => {
            if (!budget(socket, 'matching', 12, 60000)) return reply({ ok: false, message: 'Please wait before searching again.' });
            leave(socket);
            for (const id of waiting) {
                const partner = active.get(id);
                if (!partner) { waiting.delete(id); continue; }
                if (id === socket.guest.id || blocked.get(id)?.has(socket.guest.id) || blocked.get(socket.guest.id)?.has(id)) continue;
                waiting.delete(id);
                const conversation = crypto.randomUUID();
                socket.partnerId = id;
                partner.partnerId = socket.guest.id;
                socket.conversationId = partner.conversationId = conversation;
                socket.emit('matched', { partner: partner.guest, conversation });
                partner.emit('matched', { partner: socket.guest, conversation });
                return reply({ ok: true, state: 'matched' });
            }
            waiting.add(socket.guest.id);
            reply({ ok: true, state: 'waiting' });
        });
        handle('leave_chat', (_data, reply) => { leave(socket); reply({ ok: true }); });
        handle('send_message', (data, reply) => {
            if (typeof data?.message !== 'string' || !data.message.trim() || data.message.length > 2000) {
                return reply({ ok: false, message: 'Messages must be between 1 and 2,000 characters.' });
            }
            if (!socket.roomId && !socket.partnerId) return reply({ ok: false, message: 'Join a room or find a partner first.' });
            if (data.clientId !== undefined && (typeof data.clientId !== 'string' || !/^[a-f0-9-]{36}$/i.test(data.clientId))) {
                return reply({ ok: false, message: 'Invalid message identifier.' });
            }
            const previous = deliveries.get(socket.guest.id)?.get(data.clientId);
            if (previous) return reply({ ok: true, id: previous });
            if (!budget(socket, 'messages', 8, 10000)) return reply({ ok: false, message: 'Please slow down. Try again in a few seconds.' });
            const message = { id: crypto.randomUUID(), sender: socket.guest.id, alias: socket.guest.alias,
                message: data.message.trim(), timestamp: new Date().toISOString(),
                account: !!socket.guest.account,
                conversation: socket.roomId ? `room:${socket.roomId}` : socket.conversationId };
            const recipients = socket.roomId ? [...rooms.get(socket.roomId)] : [socket.guest.id, socket.partnerId];
            const targets = recipients.filter(id => !blocked.get(id)?.has(socket.guest.id)).map(id => active.get(id)).filter(Boolean);
            persistForAccounts(targets, message);
            if (data.clientId) {
                const sent = deliveries.get(socket.guest.id) || new Map();
                sent.set(data.clientId, message.id);
                if (sent.size > 128) sent.delete(sent.keys().next().value);
                deliveries.set(socket.guest.id, sent);
            }
            for (const recipient of targets) {
                const id = recipient.guest.id;
                recipient.emit('chat_message', message);
                const history = recent.get(id) || [];
                history.push(message);
                recent.set(id, history.slice(-50));
            }
            reply({ ok: true, id: message.id });
        });
        handle('block_guest', (data, reply) => {
            const target = data?.guest;
            const visible = target === socket.partnerId || (socket.roomId && rooms.get(socket.roomId).has(target));
            if (!visible || target === socket.guest.id) return reply({ ok: false, message: 'Guest is not in this conversation.' });
            const list = blocked.get(socket.guest.id) || new Map();
            if (list.size >= 100 && !list.has(target)) return reply({ ok: false, message: 'Block list is full for this session.' });
            list.set(target, active.get(target).guest.alias);
            blocked.set(socket.guest.id, list);
            if (socket.partnerId === target) leave(socket);
            socket.emit('blocked_guests', blockedList(socket.guest.id));
            reply({ ok: true });
        });
        handle('unblock_guest', (data, reply) => {
            if (typeof data?.guest !== 'string') return reply({ ok: false, message: 'Guest identity required.' });
            const list = blocked.get(socket.guest.id);
            list?.delete(data.guest);
            if (list?.size === 0) blocked.delete(socket.guest.id);
            socket.emit('blocked_guests', blockedList(socket.guest.id));
            reply({ ok: true });
        });
        handle('report_message', (data, reply) => {
            const message = recent.get(socket.guest.id)?.find(item => item.id === data?.messageId);
            if (!message || message.sender === socket.guest.id) return reply({ ok: false, message: 'This message is no longer available to report.' });
            if (!['harassment', 'spam', 'sexual', 'threats', 'other'].includes(data.reason)) return reply({ ok: false, message: 'Choose a report reason.' });
            if (!budget(socket, 'reports', 5, 60000)) return reply({ ok: false, message: 'Please wait before sending another report.' });
            const existing = db.prepare('SELECT id FROM anonymous_reports WHERE reporter=? AND target=? AND evidence=?').get(socket.guest.id, message.sender, JSON.stringify(message));
            if (!existing) db.prepare('INSERT INTO anonymous_reports(reporter,target,reason,evidence,created) VALUES(?,?,?,?,?)')
                .run(socket.guest.id, message.sender, data.reason, JSON.stringify(message), Date.now());
            reply({ ok: true });
        });
        socket.on('disconnect', () => {
            clearTimeout(expiry);
            if (active.get(socket.guest.id) !== socket) return;
            leave(socket);
            active.delete(socket.guest.id);
            if (socket.guest.account) db.prepare('UPDATE users SET is_online=0 WHERE id=?').run(socket.guest.accountId);
            recent.delete(socket.guest.id);
        });
    });
    const cleanup = setInterval(() => {
        const now = Date.now();
        db.prepare('DELETE FROM anonymous_reports WHERE created<?').run(now - REPORT_MS);
        db.prepare('DELETE FROM anonymous_sessions WHERE expires<?').run(now);
        db.prepare('DELETE FROM account_chat_history WHERE created<?').run(now - 30 * SESSION_MS);
        for (const [key, value] of eventBudgets) if (value.until <= now) eventBudgets.delete(key);
        for (const id of blocked.keys()) if (!id.startsWith('member:') && !sessionById.get(id, now)) blocked.delete(id);
        for (const id of deliveries.keys()) if (!active.has(id)) deliveries.delete(id);
    }, 60000);
    cleanup.unref();
    return {
        reports: () => db.prepare('SELECT * FROM anonymous_reports WHERE created>? ORDER BY created DESC LIMIT 100').all(Date.now() - REPORT_MS),
        resolveReport: id => db.prepare('UPDATE anonymous_reports SET resolved=1 WHERE id=?').run(id),
        ban: id => {
            if (id.startsWith('member:')) {
                const account = db.prepare('SELECT username,is_admin FROM users WHERE id=?').get(id.slice(7));
                if (!account || account.is_admin) return 0;
                db.prepare('INSERT OR IGNORE INTO bans(username) VALUES(?)').run(account.username);
                active.get(id)?.emit('suspended');
                active.get(id)?.disconnect(true);
                return 1;
            }
            const result = db.prepare('UPDATE anonymous_sessions SET banned=1 WHERE id=?').run(id);
            active.get(id)?.emit('suspended');
            active.get(id)?.disconnect(true);
            return result.changes;
        },
        disconnectAccount: username => {
            const user = db.prepare('SELECT id FROM users WHERE username=?').get(username);
            if (user) active.get(`member:${user.id}`)?.disconnect(true);
        }
    };
};
