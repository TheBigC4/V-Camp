// server.js – PodCamp Signaling Server (sicher & performant)
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// ==================== SICHERHEIT & RATE LIMITING ====================
app.use(helmet()); // Setzt wichtige Security-Header
app.use(cors({
  origin: '*', // In Produktion auf deine Domain beschränken!
  methods: ['GET', 'POST']
}));

// Rate-Limiting: maximal 100 Anfragen pro 15 Minuten pro IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 Minuten
  max: 100,
  message: 'Zu viele Anfragen, bitte später erneut versuchen.'
});
app.use(limiter);

const http = createServer(app);
const io = new Server(http, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
  pingTimeout: 30000,      // Höhere Timeouts für stabile Verbindungen
  pingInterval: 25000,
  connectTimeout: 45000
});

// ==================== RAUM-VERWALTUNG ====================
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
  console.log(`[leave] ${socket.username || socket.id} verließ Raum ${roomId}`);
}

// ==================== SOCKET-EVENTS ====================
io.on('connection', (socket) => {
  const clientIp = socket.handshake.address;
  console.log(`[+] Neue Verbindung: ${socket.id} (IP: ${clientIp})`);

  // ---- Beitritt zu einem Raum ----
  socket.on('join', ({ roomId, userId, username, color, avatar, podcast_url, role }) => {
    // Eingabedaten validieren
    if (!roomId || !userId || !username) {
      socket.emit('error', 'Ungültige Beitrittsdaten');
      return;
    }

    socket.roomId = roomId;
    socket.userId = userId;
    socket.username = username;
    socket.color = color || '#b0ff47';
    socket.avatar = avatar || null;
    socket.podcast_url = podcast_url || null;
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

    // Neuen Teilnehmer in Raum eintragen
    room.set(socket.id, {
      userId,
      username,
      color: socket.color,
      avatar: socket.avatar,
      podcast_url: socket.podcast_url
    });
    socket.join(roomId);

    // Alle anderen über neuen Teilnehmer informieren
    socket.to(roomId).emit('user-joined', {
      socketId: socket.id,
      userId,
      username,
      color: socket.color,
      avatar: socket.avatar,
      podcast_url: socket.podcast_url
    });

    console.log(`[join] ${username} (${socket.id}) betrat Raum ${roomId}`);
  });

  // ---- WebRTC-Signaling ----
  socket.on('offer', ({ to, offer }) => {
    if (!to || !offer) return;
    io.to(to).emit('offer', { from: socket.id, offer });
  });

  socket.on('answer', ({ to, answer }) => {
    if (!to || !answer) return;
    io.to(to).emit('answer', { from: socket.id, answer });
  });

  socket.on('ice', ({ to, candidate }) => {
    if (!to || !candidate) return;
    io.to(to).emit('ice', { from: socket.id, candidate });
  });

  // ---- Chat ----
  socket.on('chat', ({ roomId, username, color, text, time, userId }) => {
    if (!roomId || !username || !text) return;
    // Nachricht an alle im Raum (außer Sender? – wir senden an alle, Client filtert selbst)
    io.to(roomId).emit('chat', {
      socketId: socket.id,
      username,
      color,
      text,
      time: time || new Date().toLocaleTimeString(),
      userId
    });
  });

  // ---- Moderation ----
  socket.on('mute', ({ roomId, targetSocketId }) => {
    // In einer echten App sollte hier eine Berechtigungsprüfung erfolgen
    io.to(targetSocketId).emit('forceMute');
  });

  socket.on('kick', ({ roomId, targetSocketId, reason }) => {
    io.to(targetSocketId).emit('kicked', { reason });
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) targetSocket.disconnect(true);
  });

  socket.on('ban', ({ roomId, userId, targetSocketId, reason, moderatorId }) => {
    io.to(targetSocketId).emit('banned', { reason });
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) targetSocket.disconnect(true);
    // Hinweis: Der Eintrag in der Datenbank erfolgt bereits im Client (Supabase)
  });

  socket.on('moderator-appointed', ({ roomId, userId, username, appointedBy }) => {
    socket.to(roomId).emit('moderator-appointed', { userId, username });
  });

  // ---- Verlassen & Trennen ----
  socket.on('leave', () => {
    leaveRoom(socket);
  });

  socket.on('disconnect', () => {
    leaveRoom(socket);
    console.log(`[-] Verbindung getrennt: ${socket.id}`);
  });
});

// ==================== GESUNDHEITS-CHECK ====================
app.get('/', (req, res) => {
  res.json({
    status: 'PodCamp Signaling Server online',
    rooms: rooms.size,
    timestamp: new Date().toISOString()
  });
});

// ==================== SERVER START ====================
const PORT = process.env.PORT || 3001;
http.listen(PORT, () => {
  console.log(`✅ PodCamp Signaling Server läuft auf Port ${PORT}`);
  console.log(`🔒 Sicherheitsfeatures aktiv: Helmet, Rate-Limiting`);
});
