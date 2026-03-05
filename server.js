const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

// Erhöhe die maximale JSON-Payload-Größe (für Express)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(cors());

const http = createServer(app);
const io = new Server(http, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
  pingTimeout: 30000,
  pingInterval: 25000,
  // Erhöhe die maximale Nachrichtengröße für Socket.io (Standard 1 MB)
  maxHttpBufferSize: 50 * 1024 * 1024 // 50 MB
});

// Raum-Verwaltung
const rooms = new Map();

function leaveRoom(socket) {
  const roomId = socket.roomId;
  if (!roomId) return;
  const room = rooms.get(roomId);
  if (room) {
    room.delete(socket.id);
    if (room.size === 0) rooms.delete(roomId);
  }
  socket.to(roomId).emit('user-left', { socketId: socket.id });
  socket.leave(roomId);
}

io.on('connection', (socket) => {
  console.log('[+] Neu verbunden:', socket.id);

  socket.on('join', ({ roomId, userId, username, color, avatar, podcast_url, role }) => {
    socket.roomId = roomId;
    socket.userId = userId;
    socket.username = username;
    socket.color = color || '#b0ff47';
    socket.avatar = avatar;
    socket.podcast_url = podcast_url;
    socket.role = role || 'user';

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    const room = rooms.get(roomId);

    const existing = [];
    room.forEach((info, sid) => {
      existing.push({
        socketId: sid,
        userId: info.userId,
        username: info.username,
        color: info.color,
        avatar: info.avatar,
        podcast_url: info.podcast_url
      });
    });
    socket.emit('room-users', existing);

    room.set(socket.id, {
      userId, username, color: socket.color,
      avatar: socket.avatar, podcast_url: socket.podcast_url
    });
    socket.join(roomId);

    socket.to(roomId).emit('user-joined', {
      socketId: socket.id,
      userId, username,
      color: socket.color,
      avatar: socket.avatar,
      podcast_url: socket.podcast_url
    });
  });

  socket.on('offer', ({ to, offer }) => io.to(to).emit('offer', { from: socket.id, offer }));
  socket.on('answer', ({ to, answer }) => io.to(to).emit('answer', { from: socket.id, answer }));
  socket.on('ice', ({ to, candidate }) => io.to(to).emit('ice', { from: socket.id, candidate }));

  socket.on('chat', ({ roomId, username, color, text, time, userId }) => {
    io.to(roomId).emit('chat', { socketId: socket.id, username, color, text, time, userId });
  });

  // Moderations-Events
  socket.on('mute', ({ roomId, targetSocketId }) => {
    io.to(targetSocketId).emit('forceMute');
  });

  socket.on('kick', ({ roomId, targetSocketId, reason }) => {
    io.to(targetSocketId).emit('kicked', { reason });
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      leaveRoom(targetSocket);
      targetSocket.disconnect(true);
    }
  });

  socket.on('ban', ({ roomId, userId, targetSocketId, reason, moderatorId }) => {
    io.to(targetSocketId).emit('banned', { reason });
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      leaveRoom(targetSocket);
      targetSocket.disconnect(true);
    }
  });

  socket.on('moderator-appointed', ({ roomId, userId, username, appointedBy }) => {
    socket.to(roomId).emit('moderator-appointed', { userId, username });
  });

  socket.on('leave', () => leaveRoom(socket));
  socket.on('disconnect', () => {
    leaveRoom(socket);
    console.log('[-] Getrennt:', socket.id);
  });
});

app.get('/', (req, res) => {
  res.json({
    status: 'PodCamp Signaling Server online',
    rooms: rooms.size,
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3001;
http.listen(PORT, () => {
  console.log(`✅ PodCamp Signaling Server läuft auf Port ${PORT}`);
});
