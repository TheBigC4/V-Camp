const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const http = createServer(app);
const io = new Server(http, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
  pingTimeout: 30000,
  pingInterval: 25000
});

// Raum-Verwaltung
const rooms = new Map(); // roomId → Map(socketId → userInfo)

// Hilfsfunktion zum Verlassen eines Raums
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

  // ---- Beitritt ----
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

    // Bestehende Teilnehmer an den Neuen senden
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

    // Neuen Teilnehmer eintragen
    room.set(socket.id, {
      userId, username, color: socket.color,
      avatar: socket.avatar, podcast_url: socket.podcast_url
    });
    socket.join(roomId);

    // Andere informieren
    socket.to(roomId).emit('user-joined', {
      socketId: socket.id,
      userId, username,
      color: socket.color,
      avatar: socket.avatar,
      podcast_url: socket.podcast_url
    });
  });

  // ---- WebRTC Signaling ----
  socket.on('offer', ({ to, offer }) => io.to(to).emit('offer', { from: socket.id, offer }));
  socket.on('answer', ({ to, answer }) => io.to(to).emit('answer', { from: socket.id, answer }));
  socket.on('ice', ({ to, candidate }) => io.to(to).emit('ice', { from: socket.id, candidate }));

  // ---- Chat ----
  socket.on('chat', ({ roomId, username, color, text, time, userId }) => {
    io.to(roomId).emit('chat', { socketId: socket.id, username, color, text, time, userId });
  });

  // ==================== MODERATION ====================
  // Mute (nur Event, keine Trennung)
  socket.on('mute', ({ roomId, targetSocketId }) => {
    io.to(targetSocketId).emit('forceMute');
  });

  // Kick – Ziel wird sofort getrennt und erhält Nachricht
  socket.on('kick', ({ roomId, targetSocketId, reason }) => {
    io.to(targetSocketId).emit('kicked', { reason });
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      leaveRoom(targetSocket);
      targetSocket.disconnect(true);
    }
  });

  // Ban – wie Kick, plus Client wird über Ban informiert
  socket.on('ban', ({ roomId, userId, targetSocketId, reason, moderatorId }) => {
    io.to(targetSocketId).emit('banned', { reason });
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      leaveRoom(targetSocket);
      targetSocket.disconnect(true);
    }
    // Hinweis: Der Eintrag in der Datenbank (IP-Sperre) erfolgt bereits im Client
  });

  // Raum-Moderator ernennen (nur Event)
  socket.on('moderator-appointed', ({ roomId, userId, username, appointedBy }) => {
    socket.to(roomId).emit('moderator-appointed', { userId, username });
  });

  // ---- Verlassen & Trennen ----
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
http.listen(PORT, () => console.log(`✅ PodCamp Signaling Server läuft auf Port ${PORT}`));
