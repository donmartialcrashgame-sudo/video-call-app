import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';

const app = express();
const httpServer = http.createServer(app);

const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || '*';
const corsOrigin = FRONTEND_URL === '*'
  ? '*'
  : FRONTEND_URL.split(',').map((value) => value.trim()).filter(Boolean);

app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    service: 'Video Call Signaling Server',
    status: 'online',
    version: '1.1.0'
  });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'video-call-signaling-server',
    timestamp: new Date().toISOString()
  });
});

const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Demo in-memory registry. Supabase authentication/database will replace this
// in the next phase. Media never passes through this server.
const users = new Map(); // userId -> socketId
const socketUsers = new Map(); // socketId -> userId

function cleanUserId(value) {
  if (typeof value !== 'string') return null;
  const userId = value.trim().slice(0, 80);
  return userId || null;
}

function emitToUser(userId, event, payload) {
  const socketId = users.get(userId);
  if (!socketId) return false;
  io.to(socketId).emit(event, payload);
  return true;
}

function unregister(socket) {
  const userId = socketUsers.get(socket.id);
  if (!userId) return;

  if (users.get(userId) === socket.id) {
    users.delete(userId);
    io.emit('user-status', { userId, online: false });
  }
  socketUsers.delete(socket.id);
}

io.on('connection', (socket) => {
  socket.emit('server-ready', { socketId: socket.id });

  socket.on('register', (rawUserId, callback) => {
    const userId = cleanUserId(rawUserId);
    if (!userId) {
      callback?.({ success: false, message: 'A valid user ID is required.' });
      return;
    }

    const previousSocketId = users.get(userId);
    if (previousSocketId && previousSocketId !== socket.id) {
      io.to(previousSocketId).emit('session-replaced', {
        message: 'This user ID connected from another device.'
      });
      io.sockets.sockets.get(previousSocketId)?.disconnect(true);
    }

    users.set(userId, socket.id);
    socketUsers.set(socket.id, userId);
    socket.join(`user:${userId}`);
    socket.emit('registered', { userId, online: true });
    io.emit('user-status', { userId, online: true });
    callback?.({ success: true, userId });
  });

  socket.on('get-online-users', (callback) => {
    callback?.([...users.keys()]);
  });

  socket.on('call-user', ({ to, callType = 'video' } = {}, callback) => {
    const from = socketUsers.get(socket.id);
    const target = cleanUserId(to);
    const type = callType === 'audio' ? 'audio' : 'video';

    if (!from || !target) {
      callback?.({ success: false, message: 'Register before starting a call.' });
      return;
    }
    if (from === target) {
      callback?.({ success: false, message: 'You cannot call yourself.' });
      return;
    }
    if (!users.has(target)) {
      socket.emit('call-failed', { reason: 'User is offline.' });
      callback?.({ success: false, message: 'User is offline.' });
      return;
    }

    emitToUser(target, 'incoming-call', { from, callType: type });
    callback?.({ success: true });
  });

  socket.on('accept-call', ({ to } = {}) => {
    const from = socketUsers.get(socket.id);
    const target = cleanUserId(to);
    if (from && target) emitToUser(target, 'call-accepted', { from });
  });

  socket.on('reject-call', ({ to } = {}) => {
    const from = socketUsers.get(socket.id);
    const target = cleanUserId(to);
    if (from && target) emitToUser(target, 'call-rejected', { from });
  });

  socket.on('end-call', ({ to, reason = 'ended' } = {}) => {
    const from = socketUsers.get(socket.id);
    const target = cleanUserId(to);
    if (from && target) emitToUser(target, 'call-ended', { from, reason });
  });

  // WebRTC signaling only. Audio/video media stays between peers (or a TURN relay).
  for (const event of ['offer', 'answer', 'ice-candidate']) {
    socket.on(event, ({ to, ...payload } = {}) => {
      const from = socketUsers.get(socket.id);
      const target = cleanUserId(to);
      if (!from || !target || !payload) return;
      emitToUser(target, event, { from, ...payload });
    });
  }

  socket.on('disconnect', () => unregister(socket));
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Video call signaling server running on port ${PORT}`);
  console.log(`Allowed frontend origin: ${FRONTEND_URL}`);
});
