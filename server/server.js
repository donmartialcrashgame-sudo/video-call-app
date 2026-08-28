import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, '..', 'public');

app.use(express.json());
app.use(express.static(publicDir));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'video-call-signaling-server' });
});

// Demo signaling registry. Authentication/database will be added in the next phase.
const users = new Map();

io.on('connection', (socket) => {
  socket.on('register', (userId) => {
    if (!userId || typeof userId !== 'string') return;

    users.set(userId, socket.id);
    socket.data.userId = userId;
    socket.join(`user:${userId}`);
    socket.emit('registered', { userId });
    io.emit('user-status', { userId, online: true });
  });

  socket.on('call-user', ({ to, callType = 'video' } = {}) => {
    if (!to || !socket.data.userId) return;

    const targetSocketId = users.get(to);
    if (!targetSocketId) {
      socket.emit('call-failed', { reason: 'User is offline.' });
      return;
    }

    io.to(targetSocketId).emit('incoming-call', {
      from: socket.data.userId,
      callType
    });
  });

  socket.on('accept-call', ({ to } = {}) => {
    if (!to || !socket.data.userId) return;
    const targetSocketId = users.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-accepted', { from: socket.data.userId });
    }
  });

  socket.on('reject-call', ({ to } = {}) => {
    if (!to || !socket.data.userId) return;
    const targetSocketId = users.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-rejected', { from: socket.data.userId });
    }
  });

  // WebRTC signaling: these messages contain negotiation data, not the media stream.
  for (const event of ['offer', 'answer', 'ice-candidate']) {
    socket.on(event, ({ to, ...payload } = {}) => {
      if (!to) return;
      const targetSocketId = users.get(to);
      if (targetSocketId) {
        io.to(targetSocketId).emit(event, {
          from: socket.data.userId,
          ...payload
        });
      }
    });
  }

  socket.on('end-call', ({ to } = {}) => {
    if (!to) return;
    const targetSocketId = users.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-ended', { from: socket.data.userId });
    }
  });

  socket.on('disconnect', () => {
    const userId = socket.data.userId;
    if (!userId) return;

    if (users.get(userId) === socket.id) {
      users.delete(userId);
      io.emit('user-status', { userId, online: false });
    }
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Video call server running on port ${PORT}`);
});
