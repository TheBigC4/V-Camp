/**
 * PodCamp WebRTC Signaling Server
 * Deploy auf Railway: https://railway.app (kostenlos)
 *
 * npm install express socket.io cors
 * node server.js
 */

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling']
});

// Raum → Set von Socket-IDs
const rooms = {};

app.get('/', (req, res) => res.json({ status: 'PodCamp Signaling Server online' }));

io.on('connection', socket => {
  console.log(`[+] ${socket.id} verbunden`);

  // Raum beitreten
  socket.on('join-room', ({ roomId, userId, username, color }) => {
    socket.roomId = roomId;
    socket.userId = userId;
    socket.username = username;
    socket.color = color || '#6ac46a';

    if (!rooms[roomId]) rooms[roomId] = {};
    rooms[roomId][socket.id] = { userId, username, color, socketId: socket.id };

    socket.join(roomId);

    // Allen anderen im Raum sagen: jemand neues ist da
    socket.to(roomId).emit('user-joined', {
      socketId: socket.id,
      userId,
      username,
      color
    });

    // Dem neuen Nutzer: wer ist schon da?
    socket.emit('room-users', Object.values(rooms[roomId]).filter(u => u.socketId !== socket.id));

    console.log(`[Room ${roomId}] ${username} joined. Total: ${Object.keys(rooms[roomId]).length}`);
  });

  // WebRTC Offer (von Anrufer an Angerufenen)
  socket.on('webrtc-offer', ({ targetSocketId, offer, fromUserId, fromUsername }) => {
    io.to(targetSocketId).emit('webrtc-offer', {
      offer,
      fromSocketId: socket.id,
      fromUserId,
      fromUsername
    });
  });

  // WebRTC Answer (vom Angerufenen zurück)
  socket.on('webrtc-answer', ({ targetSocketId, answer }) => {
    io.to(targetSocketId).emit('webrtc-answer', {
      answer,
      fromSocketId: socket.id
    });
  });

  // ICE Candidates austauschen
  socket.on('ice-candidate', ({ targetSocketId, candidate }) => {
    io.to(targetSocketId).emit('ice-candidate', {
      candidate,
      fromSocketId: socket.id
    });
  });

  // Chat
  socket.on('chat-message', ({ roomId, text, username, color }) => {
    io.to(roomId).emit('chat-message', {
      socketId: socket.id,
      username,
      color,
      text,
      time: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    });
  });

  // Raum verlassen / Verbindung getrennt
  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      delete rooms[roomId][socket.id];
      if (Object.keys(rooms[roomId]).length === 0) delete rooms[roomId];
      socket.to(roomId).emit('user-left', { socketId: socket.id, userId: socket.userId });
      console.log(`[-] ${socket.username || socket.id} left room ${roomId}`);
    }
    console.log(`[-] ${socket.id} disconnected`);
  });

  socket.on('leave-room', () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      delete rooms[roomId][socket.id];
      socket.to(roomId).emit('user-left', { socketId: socket.id, userId: socket.userId });
      socket.leave(roomId);
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`✅ Signaling Server läuft auf Port ${PORT}`));