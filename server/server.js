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
  maxHttpBufferSize: 5e6, // 5 MB (game snapshots can be large)
});

// ── Room storage ──────────────────────────────────────────────────────────────
// rooms: Map<code, { host: socketId, guest: socketId|null, hostName, guestName, createdAt, lastActivity }>
const rooms = new Map();
const socketToRoom = new Map(); // socketId → roomCode

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function getRoom(socketId) {
  const code = socketToRoom.get(socketId);
  return code ? rooms.get(code) : null;
}

function cleanupSocket(socketId) {
  const code = socketToRoom.get(socketId);
  if (!code) return null;
  const room = rooms.get(code);
  if (!room) return null;

  socketToRoom.delete(socketId);

  if (room.host === socketId) {
    room.host = null;
    room.hostName = null;
  } else if (room.guest === socketId) {
    room.guest = null;
    room.guestName = null;
  }

  // If room is completely empty, schedule cleanup
  if (!room.host && !room.guest) {
    setTimeout(() => {
      if (rooms.has(code)) {
        const r = rooms.get(code);
        if (!r.host && !r.guest) {
          rooms.delete(code);
          console.log(`[Room ${code}] Deleted (empty)`);
        }
      }
    }, 60 * 1000); // 60s grace period
  }

  return { code, room };
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size });
});

// ── Socket events ─────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  // ── Create room ────────────────────────────────────────────────────────────
  socket.on('create_room', ({ displayName } = {}) => {
    // Generate unique code
    let code;
    let attempts = 0;
    do { code = generateCode(); attempts++; } while (rooms.has(code) && attempts < 20);

    rooms.set(code, {
      host: socket.id,
      guest: null,
      hostName: displayName || 'Host',
      guestName: null,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    });
    socketToRoom.set(socket.id, code);
    socket.join(code);

    socket.emit('room_created', { code, role: 'host' });
    console.log(`[Room ${code}] Created by ${displayName || socket.id}`);
  });

  // ── Join room ──────────────────────────────────────────────────────────────
  socket.on('join_room', ({ code, displayName } = {}) => {
    const upperCode = (code || '').toUpperCase().trim();
    const room = rooms.get(upperCode);

    if (!room) {
      socket.emit('join_error', { message: 'Sala não encontrada. Verifique o código.' });
      return;
    }
    if (room.guest) {
      socket.emit('join_error', { message: 'Sala já está cheia.' });
      return;
    }
    if (room.host === socket.id) {
      socket.emit('join_error', { message: 'Você já é o host desta sala.' });
      return;
    }

    room.guest = socket.id;
    room.guestName = displayName || 'Guest';
    room.lastActivity = Date.now();
    socketToRoom.set(socket.id, upperCode);
    socket.join(upperCode);

    socket.emit('room_joined', { code: upperCode, role: 'guest', opponentName: room.hostName });
    // Notify host
    const hostSocket = io.sockets.sockets.get(room.host);
    if (hostSocket) {
      hostSocket.emit('opponent_joined', { opponentName: room.guestName });
    }
    console.log(`[Room ${upperCode}] ${displayName || socket.id} joined as guest`);
  });

  // ── Game state update (host → guest) ──────────────────────────────────────
  socket.on('game_state_update', (data) => {
    const room = getRoom(socket.id);
    if (!room || room.host !== socket.id || !room.guest) return;
    room.lastActivity = Date.now();
    const guestSocket = io.sockets.sockets.get(room.guest);
    if (guestSocket) guestSocket.emit('game_state_update', data);
  });

  // ── Player action (guest → host) ──────────────────────────────────────────
  socket.on('player_action', (action) => {
    const room = getRoom(socket.id);
    if (!room || room.guest !== socket.id || !room.host) return;
    room.lastActivity = Date.now();
    const hostSocket = io.sockets.sockets.get(room.host);
    if (hostSocket) hostSocket.emit('player_action', action);
  });

  // ── Chat message (either → other) ─────────────────────────────────────────
  socket.on('chat_message', ({ text, emote } = {}) => {
    const code = socketToRoom.get(socket.id);
    const room = code ? rooms.get(code) : null;
    if (!room) return;
    room.lastActivity = Date.now();

    const isHost = room.host === socket.id;
    const senderName = isHost ? room.hostName : room.guestName;
    const payload = { text, emote, senderName, isHost, timestamp: Date.now() };

    // Relay to the other player
    const otherId = isHost ? room.guest : room.host;
    const otherSocket = otherId ? io.sockets.sockets.get(otherId) : null;
    if (otherSocket) otherSocket.emit('chat_message', payload);
    // Echo back to sender with their own name confirmed
    socket.emit('chat_message_echo', payload);
  });

  // ── Resync request (guest reconnected) ────────────────────────────────────
  socket.on('request_resync', () => {
    const room = getRoom(socket.id);
    if (!room || room.guest !== socket.id || !room.host) return;
    const hostSocket = io.sockets.sockets.get(room.host);
    if (hostSocket) hostSocket.emit('resync_requested');
  });

  // ── Host starts game ──────────────────────────────────────────────────────
  socket.on('start_game', (data) => {
    const code = socketToRoom.get(socket.id);
    const room = code ? rooms.get(code) : null;
    if (!room || room.host !== socket.id) return;
    // Relay start signal to guest
    const guestSocket = room.guest ? io.sockets.sockets.get(room.guest) : null;
    if (guestSocket) guestSocket.emit('game_started', data);
    socket.emit('game_started', { ...data, isHost: true });
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[Socket] Disconnected: ${socket.id}`);
    const result = cleanupSocket(socket.id);
    if (!result) return;

    const { code, room } = result;
    const otherId = room.host || room.guest;
    const otherSocket = otherId ? io.sockets.sockets.get(otherId) : null;
    if (otherSocket) {
      otherSocket.emit('opponent_disconnected', { code });
    }
  });
});

// ── Periodic cleanup: remove rooms inactive > 2 hours ─────────────────────────
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [code, room] of rooms) {
    if (room.lastActivity < cutoff) {
      rooms.delete(code);
      console.log(`[Room ${code}] Cleaned up (inactive)`);
    }
  }
}, 30 * 60 * 1000);

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Magic Draft relay server running on port ${PORT}`);
});
