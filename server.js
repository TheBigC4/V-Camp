const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.get('/', (req, res) => res.send('Server läuft!'));

const http = createServer(app);
const io = new Server(http, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling']
});

io.on('connection', (socket) => {
  console.log('✅ Client verbunden:', socket.id);
  
  socket.on('disconnect', (reason) => {
    console.log('❌ Client getrennt:', socket.id, reason);
  });
});

const PORT = process.env.PORT || 3001;
http.listen(PORT, () => {
  console.log(`🚀 Test-Server läuft auf Port ${PORT}`);
});
