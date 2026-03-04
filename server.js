const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const http = createServer(app);
const io = new Server(http, {
  cors: { origin: '*', methods: ['GET','POST'] },
  transports: ['websocket','polling']
});

// Raum‑Verwaltung (socket.roomId, socket.userId, etc.)
const rooms = new Map(); // roomId → Map(socketId → { userId, username, role? })

io.on('connection', (socket) => {
  console.log('[+]', socket.id);

  socket.on('join', ({ roomId, userId, username, color, avatar, role }) => {
    socket.roomId = roomId;
    socket.userId = userId;
    socket.username = username;
    socket.role = role; // 'admin' oder 'user'
    // ... (bestehende Logik: room‑users, user‑joined)
  });

  // ---- Moderations‑Events ----
  socket.on('mute', ({ roomId, targetSocketId }) => {
    // Prüfen: socket.role === 'admin' oder socket.userId ist Moderator des Raums
    // Hier nur Weiterleitung
    io.to(targetSocketId).emit('forceMute');
  });

  socket.on('kick', ({ roomId, targetSocketId, reason }) => {
    // Prüfung (s.o.)
    io.to(targetSocketId).emit('kicked', { reason });
    // Socket des Ziels trennen
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) targetSocket.disconnect(true);
  });

  socket.on('ban', ({ roomId, userId, targetSocketId, reason, moderatorId }) => {
    // Prüfung (s.o.)
    io.to(targetSocketId).emit('banned', { reason });
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) targetSocket.disconnect(true);
    // Hier müsste zusätzlich ein Eintrag in der DB erfolgen (per REST-API)
  });

  // ... leave, disconnect, etc.
});

const PORT = process.env.PORT || 3001;
http.listen(PORT, () => console.log(`✅ Signaling on ${PORT}`));
