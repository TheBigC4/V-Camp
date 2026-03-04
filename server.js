const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const http = createServer(app);
const io = new Server(http, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling']
});

const rooms = new Map(); // roomId → Map(socketId → userInfo)

io.on('connection', (socket) => {
  console.log('Neu verbunden:', socket.id);

  socket.on('join', ({ roomId, userId, username, color, avatar, role }) => {
    socket.roomId = roomId;
    socket.userId = userId;
    socket.username = username;
    socket.color = color;
    socket.avatar = avatar;
    socket.role = role;

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    const room = rooms.get(roomId);

    // Bestehende Teilnehmer dem Neuen mitteilen
    const existing = [];
    room.forEach((info, sid) => {
      existing.push({ socketId: sid, userId: info.userId, username: info.username, color: info.color, avatar: info.avatar });
    });
    socket.emit('room-users', existing);

    // Neuen Teilnehmer in Raum eintragen
    room.set(socket.id, { userId, username, color, avatar });
    socket.join(roomId);

    // Alle anderen über neuen Teilnehmer informieren
    socket.to(roomId).emit('user-joined', {
      socketId: socket.id, userId, username, color, avatar
    });
  });

  // WebRTC-Signaling
  socket.on('offer', ({ to, offer }) => {
    io.to(to).emit('offer', { from: socket.id, offer });
  });
  socket.on('answer', ({ to, answer }) => {
    io.to(to).emit('answer', { from: socket.id, answer });
  });
  socket.on('ice', ({ to, candidate }) => {
    io.to(to).emit('ice', { from: socket.id, candidate });
  });

  // Chat
  socket.on('chat', ({ roomId, username, color, text, time }) => {
    io.to(roomId).emit('chat', { socketId: socket.id, username, color, text, time });
  });

  // Moderations-Events (nur weiterleiten – Berechtigungsprüfung müsste hier serverseitig erfolgen)
  socket.on('mute', ({ roomId, targetSocketId }) => {
    io.to(targetSocketId).emit('forceMute');
  });
  socket.on('kick', ({ roomId, targetSocketId, reason }) => {
    io.to(targetSocketId).emit('kicked', { reason });
    io.sockets.sockets.get(targetSocketId)?.disconnect(true);
  });
  socket.on('ban', ({ roomId, userId, targetSocketId, reason, moderatorId }) => {
    io.to(targetSocketId).emit('banned', { reason });
    io.sockets.sockets.get(targetSocketId)?.disconnect(true);
  });
  socket.on('moderator-appointed', ({ roomId, userId, username, appointedBy }) => {
    socket.to(roomId).emit('moderator-appointed', { userId, username });
  });

  function leaveRoom() {
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

  socket.on('leave', leaveRoom);
  socket.on('disconnect', () => {
    leaveRoom();
    console.log('Verbindung getrennt:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
http.listen(PORT, () => console.log(`✅ Signaling-Server läuft auf Port ${PORT}`));
