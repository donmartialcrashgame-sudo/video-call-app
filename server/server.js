import 'dotenv/config';
import express from 'express';
import http from 'http';
import crypto from 'crypto';
import { Server } from 'socket.io';

const app = express();
const httpServer = http.createServer(app);
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || '*';
const corsOrigin = FRONTEND_URL === '*' ? '*' : FRONTEND_URL.split(',').map(v => v.trim()).filter(Boolean);

app.use(express.json());
app.get('/', (_req, res) => res.json({ service: 'Video Call Signaling Server', status: 'online', version: '2.0.1' }));
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

const io = new Server(httpServer, {
  cors: { origin: corsOrigin, methods: ['GET', 'POST'], credentials: true },
  transports: ['websocket', 'polling']
});

const rooms = new Map();
const socketRooms = new Map();
const ROOM_TTL = 30 * 60 * 1000;

function makeCode() {
  let code;
  do code = String(crypto.randomInt(100000, 1000000)); while (rooms.has(code));
  return code;
}
function validCode(v) { return typeof v === 'string' && /^\d{6}$/.test(v); }
function reply(callback, payload) { if (typeof callback === 'function') callback(payload); }
function cleanupRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  rooms.delete(code);
  if (room.host) socketRooms.delete(room.host);
  if (room.guest) socketRooms.delete(room.guest);
}
function getRoom(code) {
  const room = rooms.get(code);
  if (!room) return null;
  if (Date.now() - room.createdAt > ROOM_TTL) { cleanupRoom(code); return null; }
  return room;
}
function peerSocket(code, socketId) {
  const room = rooms.get(code);
  if (!room) return null;
  return room.host === socketId ? room.guest : room.host;
}
function leaveRoom(socket, notify = true) {
  const code = socketRooms.get(socket.id);
  if (!code) return;
  const other = peerSocket(code, socket.id);
  if (notify && other) io.to(other).emit('peer-left', { reason: 'The other person left the call.' });
  cleanupRoom(code);
}

io.on('connection', socket => {
  socket.emit('server-ready', { socketId: socket.id });

  socket.on('create-room', (...args) => {
    const callback = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    if (socketRooms.has(socket.id)) leaveRoom(socket, false);
    const code = makeCode();
    rooms.set(code, { host: socket.id, guest: null, createdAt: Date.now() });
    socketRooms.set(socket.id, code);
    socket.join(`call:${code}`);
    reply(callback, { success: true, code, expiresIn: ROOM_TTL });
  });

  socket.on('check-room', (...args) => {
    const callback = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    const data = args[0] || {};
    const room = validCode(data.code) ? getRoom(data.code) : null;
    reply(callback, room && !room.guest
      ? { success: true, available: true }
      : { success: false, message: room ? 'This call already has two people.' : 'Call code not found or expired.' });
  });

  socket.on('join-room', (...args) => {
    const callback = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    const data = args[0] || {};
    const code = data.code;
    if (!validCode(code)) return reply(callback, { success: false, message: 'Enter a valid 6-digit code.' });
    const room = getRoom(code);
    if (!room) return reply(callback, { success: false, message: 'Call code not found or expired.' });
    if (room.host === socket.id) return reply(callback, { success: false, message: 'You cannot join your own call.' });
    if (room.guest && room.guest !== socket.id) return reply(callback, { success: false, message: 'This call already has two people.' });

    room.guest = socket.id;
    socketRooms.set(socket.id, code);
    socket.join(`call:${code}`);
    reply(callback, { success: true, code, role: 'guest' });
    io.to(room.host).emit('peer-joined', { code });
  });

  socket.on('room-status', (...args) => {
    const callback = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    const data = args[0] || {};
    const room = validCode(data.code) ? getRoom(data.code) : null;
    reply(callback, room ? { success: true, connected: Boolean(room.guest) } : { success: false, message: 'Call expired.' });
  });

  for (const event of ['offer', 'answer', 'ice-candidate']) {
    socket.on(event, data => {
      const payload = data || {};
      const code = payload.code;
      const room = validCode(code) ? getRoom(code) : null;
      if (!room || socketRooms.get(socket.id) !== code) return;
      const other = peerSocket(code, socket.id);
      if (!other) return;
      const { code: _code, ...signal } = payload;
      io.to(other).emit(event, signal);
    });
  }

  socket.on('end-call', data => {
    const code = data?.code;
    const room = validCode(code) ? getRoom(code) : null;
    if (!room || socketRooms.get(socket.id) !== code) return;
    const other = peerSocket(code, socket.id);
    if (other) io.to(other).emit('call-ended', { reason: 'Call ended.' });
    cleanupRoom(code);
  });

  socket.on('disconnect', () => leaveRoom(socket, true));
});

setInterval(() => {
  for (const [code, room] of rooms) if (Date.now() - room.createdAt > ROOM_TTL) cleanupRoom(code);
}, 60_000).unref();

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Video call signaling server listening on ${PORT}`);
});
