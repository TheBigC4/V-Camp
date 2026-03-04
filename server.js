/**
 * PodCamp Signaling Server
 * Deploy: Railway / Render / jeder Node.js Host
 * npm install express socket.io cors
 */
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const http = createServer(app);
const io = new Server(http, {
  cors: { origin: '*', methods: ['GET','POST'] },
  transports: ['websocket','polling'],
  pingTimeout: 20000,
  pingInterval: 10000
});

// roomId → Map(socketId → userInfo)
const rooms = new Map();

app.get('/', (req, res) => res.json({ status: 'PodCamp Signaling Server online', rooms: rooms.size }));

io.on('connection', socket => {
  console.log(`[+] ${socket.id}`);

  // ── Raum beitreten ──────────────────────────────────────────
  socket.on('join', ({ roomId, userId, username, color }) => {
    socket.roomId   = roomId;
    socket.userId   = userId;
    socket.username = username;
    socket.color    = color || '#6ac46a';

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    const room = rooms.get(roomId);

    // Allen anderen: neuer User
    // Aber ZUERST dem neuen User sagen wer schon da ist
    const existing = [];
    room.forEach((info, sid) => {
      existing.push({ socketId: sid, userId: info.userId, username: info.username, color: info.color });
    });

    // Neuen User in den Raum eintragen
    room.set(socket.id, { userId, username, color });
    socket.join(roomId);

    // Neuer User bekommt Liste der Bestehenden
    socket.emit('room-users', existing);

    // Bestehende bekommen Notification
    socket.to(roomId).emit('user-joined', {
      socketId: socket.id, userId, username, color
    });

    console.log(`[Room ${roomId}] ${username} joined. Total: ${room.size}`);
  });

  // ── WebRTC Signaling ────────────────────────────────────────
  socket.on('offer', ({ to, offer }) => {
    io.to(to).emit('offer', { from: socket.id, offer });
  });

  socket.on('answer', ({ to, answer }) => {
    io.to(to).emit('answer', { from: socket.id, answer });
  });

  socket.on('ice', ({ to, candidate }) => {
    io.to(to).emit('ice', { from: socket.id, candidate });
  });

  // ── Chat ────────────────────────────────────────────────────
  socket.on('chat', ({ roomId, username, color, text, time }) => {
    // An alle im Raum (inkl. Sender — Client filtert selbst)
    io.to(roomId).emit('chat', {
      socketId: socket.id, username, color, text, time
    });
  });

  // ── Raum verlassen ──────────────────────────────────────────
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
    console.log(`[-] ${socket.username} left ${roomId}`);
  }

  socket.on('leave', leaveRoom);
  socket.on('disconnect', () => {
    leaveRoom();
    console.log(`[-] ${socket.id} disconnected`);
  });
});

const PORT = process.env.PORT || 3001;
http.listen(PORT, () => console.log(`✅ PodCamp Signaling läuft auf Port ${PORT}`));
