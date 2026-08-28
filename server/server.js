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
app.get('/', (_req, res) => res.json({ service: 'Video Call Signaling Server', status: 'online', version: '2.0.0' }));
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

const io = new Server(httpServer, { cors: { origin: corsOrigin, methods: ['GET', 'POST'], credentials: true }, transports: ['websocket', 'polling'] });
const rooms = new Map(); // code -> { host, guest, createdAt }
const socketRooms = new Map(); // socketId -> code
const ROOM_TTL = 30 * 60 * 1000;

function makeCode() {
  let code;
  do { code = String(crypto.randomInt(100000, 1000000)); } while (rooms.has(code));
  return code;
}
function validCode(v) { return typeof v === 'string' && /^\d{6}$/.test(v); }
function cleanupRoom(code) {
  if (!rooms.has(code)) return;
  rooms.delete(code);
  for (const [socketId, roomCode] of socketRooms) if (roomCode === code) socketRooms.delete(socketId);
}
function getRoom(code) { const room = rooms.get(code); if (!room) return null; if (Date.now() - room.createdAt > ROOM_TTL) { cleanupRoom(code); return null; } return room; }
function peerSocket(code, socketId) { const room = rooms.get(code); if (!room) return null; return room.host === socketId ? room.guest : room.host; }
function leaveRoom(socket, notify = true) {
  const code = socketRooms.get(socket.id);
  if (!code) return;
  const other = peerSocket(code, socket.id);
  if (notify && other) io.to(other).emit('peer-left', { reason: 'The other person left the call.' });
  cleanupRoom(code);
}

io.on('connection', socket => {
  socket.emit('server-ready', { socketId: socket.id });

  socket.on('create-room', callback => {
    if (socketRooms.has(socket.id)) leaveRoom(socket, false);
    const code = makeCode();
    rooms.set(code, { host: socket.id, guest: null, createdAt: Date.now() });
    socketRooms.set(socket.id, code);
    socket.join(`call:${code}`);
    callback?.({ success: true, code, expiresIn: ROOM_TTL });
  });

  socket.on('check-room', ({ code } = {}, callback) => {
    const room = validCode(code) ? getRoom(code) : null;
    callback?.(room ? { success: true, available: !room.guest } : { success: false, message: 'Call code not found or expired.' });
  });

  socket.on('join-room', ({ code } = {}, callback) => {
    if (!validCode(code)) return callback?.({ success: false, message: 'Enter a valid 6-digit code.' });
    const room = getRoom(code);
    if (!room) return callback?.({ success: false, message: 'Call code not found or expired.' });
    if (room.guest && room.guest !== socket.id) return callback?.({ success: false, message: 'This call already has two people.' });
    if (room.host === socket.id) return callback?.({ success: false, message: 'You cannot join your own call.' });

    room.guest = socket.id;
    socketRooms.set(socket.id, code);
    socket.join(`call:${code}`);
    callback?.({ success: true, code, role: 'guest' });
    io.to(room.host).emit('peer-joined', { code });
  });

  socket.on('room-status', ({ code } = {}, callback) => {
    const room = validCode(code) ? getRoom(code) : null;
    callback?.(room ? { success: true, connected: Boolean(room.guest) } : { success: false, message: 'Call expired.' });
  });

  // Signaling only. Camera/microphone media stays in WebRTC between browsers.
  for (const event of ['offer', 'answer', 'ice-candidate']) {
    socket.on(event, ({ code, ...payload } = {}) => {
      const room = validCode(code) ? getRoom(code) : null;
      if (!room || socketRooms.get(socket.id) !== code) return;
      const other = peerSocket(code, socket.id);
      if (other) io.to(other).emit(event, payload);
    });
  }

  socket.on('end-call', ({ code } = {}) => {
    const room = validCode(code) ? getRoom(code) : null;
    if (!room || socketRooms.get(socket.id) !== code) return;
    const other = peerSocket(code, socket.id);
    if (other) io.to(other).emit('call-ended', { reason: 'Call ended.' });
    cleanupRoom(code);
  });

  socket.on('disconnect', () => leaveRoom(socket, true));
});

setInterval(() => { for (const [code, room] of rooms) if (Date.now() - room.createdAt > ROOM_TTL) cleanupRoom(code); }, 60_000).unref();

httpServer.listen(PORT, '0.0.0.0', () => console.log(`Video call signaling server listening on ${PORT}`));
