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
// rooms: Map<code, { hostSocketId, players, draftStarted, createdAt, lastActivity }>
// players: [{socketId, displayName, seatIndex}]
const rooms = new Map();
// socketToRoom: Map<socketId, {code, seatIndex}>
const socketToRoom = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function getRoom(socketId) {
  const info = socketToRoom.get(socketId);
  return info ? rooms.get(info.code) : null;
}

function getRoomCode(socketId) {
  const info = socketToRoom.get(socketId);
  return info ? info.code : null;
}

function getSeatIndex(socketId) {
  const info = socketToRoom.get(socketId);
  return info ? info.seatIndex : null;
}

function cleanupSocket(socketId) {
  const info = socketToRoom.get(socketId);
  if (!info) return null;
  const { code } = info;
  const room = rooms.get(code);
  if (!room) return null;

  socketToRoom.delete(socketId);
  room.players = room.players.filter(p => p.socketId !== socketId);
  room.lastActivity = Date.now();

  // If room is completely empty, schedule cleanup
  if (room.players.length === 0) {
    setTimeout(() => {
      if (rooms.has(code)) {
        const r = rooms.get(code);
        if (r.players.length === 0) {
          rooms.delete(code);
          console.log(`[Room ${code}] Deleted (empty)`);
        }
      }
    }, 60 * 1000);
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
    let code;
    let attempts = 0;
    do { code = generateCode(); attempts++; } while (rooms.has(code) && attempts < 20);

    const hostPlayer = { socketId: socket.id, displayName: displayName || 'Host', seatIndex: 0 };
    rooms.set(code, {
      hostSocketId: socket.id,
      players: [hostPlayer],
      draftStarted: false,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    });
    socketToRoom.set(socket.id, { code, seatIndex: 0 });
    socket.join(code);

    socket.emit('room_created', { code, seatIndex: 0 });
    console.log(`[Room ${code}] Created by ${displayName || socket.id} (seat 0)`);
  });

  // ── Join room ──────────────────────────────────────────────────────────────
  socket.on('join_room', ({ code, displayName } = {}) => {
    const upperCode = (code || '').toUpperCase().trim();
    const room = rooms.get(upperCode);

    if (!room) {
      socket.emit('join_error', { message: 'Sala não encontrada. Verifique o código.' });
      return;
    }
    if (room.players.length >= 8) {
      socket.emit('join_error', { message: 'Sala já está cheia (8 jogadores).' });
      return;
    }
    if (room.players.find(p => p.socketId === socket.id)) {
      socket.emit('join_error', { message: 'Você já está nesta sala.' });
      return;
    }

    // Find next free seat (1-7)
    const occupiedSeats = new Set(room.players.map(p => p.seatIndex));
    let seatIndex = -1;
    for (let i = 1; i <= 7; i++) {
      if (!occupiedSeats.has(i)) { seatIndex = i; break; }
    }
    if (seatIndex === -1) {
      socket.emit('join_error', { message: 'Sala já está cheia.' });
      return;
    }

    const newPlayer = { socketId: socket.id, displayName: displayName || 'Guest', seatIndex };
    room.players.push(newPlayer);
    room.lastActivity = Date.now();
    socketToRoom.set(socket.id, { code: upperCode, seatIndex });
    socket.join(upperCode);

    const playersPublic = room.players.map(p => ({ displayName: p.displayName, seatIndex: p.seatIndex }));

    socket.emit('room_joined', { code: upperCode, seatIndex, players: playersPublic });
    io.to(upperCode).emit('room_updated', { players: playersPublic });

    console.log(`[Room ${upperCode}] ${displayName || socket.id} joined as seat ${seatIndex}`);
  });

  // ── Draft event — broadcast to ALL including sender ────────────────────────
  socket.on('draft_event', (data) => {
    const code = getRoomCode(socket.id);
    const room = code ? rooms.get(code) : null;
    if (!room) return;
    room.lastActivity = Date.now();
    io.to(code).emit('draft_event', data);
  });

  // ── Game state update (host → others) ─────────────────────────────────────
  socket.on('game_state_update', (data) => {
    const code = getRoomCode(socket.id);
    const room = code ? rooms.get(code) : null;
    if (!room || room.hostSocketId !== socket.id) return;
    room.lastActivity = Date.now();
    // Send to all non-host players
    for (const player of room.players) {
      if (player.socketId !== socket.id) {
        const s = io.sockets.sockets.get(player.socketId);
        if (s) s.emit('game_state_update', data);
      }
    }
  });

  // ── Player action (guest → host) ──────────────────────────────────────────
  socket.on('player_action', (action) => {
    const code = getRoomCode(socket.id);
    const room = code ? rooms.get(code) : null;
    if (!room || room.hostSocketId === socket.id) return;
    room.lastActivity = Date.now();
    const hostSocket = io.sockets.sockets.get(room.hostSocketId);
    if (hostSocket) hostSocket.emit('player_action', action);
  });

  // ── Chat message ──────────────────────────────────────────────────────────
  socket.on('chat_message', ({ text, emote } = {}) => {
    const code = getRoomCode(socket.id);
    const room = code ? rooms.get(code) : null;
    if (!room) return;
    room.lastActivity = Date.now();

    const isHost = room.hostSocketId === socket.id;
    const player = room.players.find(p => p.socketId === socket.id);
    const senderName = player ? player.displayName : 'Unknown';
    const payload = { text, emote, senderName, isHost, timestamp: Date.now() };

    // Relay to the other players
    for (const p of room.players) {
      if (p.socketId !== socket.id) {
        const s = io.sockets.sockets.get(p.socketId);
        if (s) s.emit('chat_message', payload);
      }
    }
    socket.emit('chat_message_echo', payload);
  });

  // ── Resync request ─────────────────────────────────────────────────────────
  socket.on('request_resync', () => {
    const code = getRoomCode(socket.id);
    const room = code ? rooms.get(code) : null;
    if (!room || room.hostSocketId === socket.id) return;
    const hostSocket = io.sockets.sockets.get(room.hostSocketId);
    if (hostSocket) hostSocket.emit('resync_requested');
  });

  // ── Host starts game ──────────────────────────────────────────────────────
  socket.on('start_game', (data) => {
    const code = getRoomCode(socket.id);
    const room = code ? rooms.get(code) : null;
    if (!room || room.hostSocketId !== socket.id) return;
    // Relay start signal to all non-host players
    for (const player of room.players) {
      if (player.socketId !== socket.id) {
        const s = io.sockets.sockets.get(player.socketId);
        if (s) s.emit('game_started', data);
      }
    }
    socket.emit('game_started', { ...data, isHost: true });
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[Socket] Disconnected: ${socket.id}`);
    const result = cleanupSocket(socket.id);
    if (!result) return;

    const { code, room } = result;
    const playersPublic = room.players.map(p => ({ displayName: p.displayName, seatIndex: p.seatIndex }));

    if (room.players.length > 0) {
      io.to(code).emit('room_updated', { players: playersPublic });
      // If the host disconnected, notify remaining players
      if (room.hostSocketId === socket.id) {
        io.to(code).emit('host_disconnected', { code });
      } else {
        // Notify host specifically
        const hostSocket = io.sockets.sockets.get(room.hostSocketId);
        if (hostSocket) hostSocket.emit('opponent_disconnected', { code });
      }
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
