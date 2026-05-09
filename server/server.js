const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const Matter = require('matter-js');

const { Engine, Bodies, Body, World } = Matter;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, '../client')));

const CANVAS_W = 600;
const CANVAS_H = 500;
const STAGE_Y = 420;
const STAGE_W = 320;
const STAGE_H = 18;
const STAGE_X = CANVAS_W / 2;
const FALL_THRESHOLD = CANVAS_H + 60;
const PHYSICS_DELTA = 1000 / 60;

const DOG_TYPES = ['chihuahua', 'golden', 'shiba', 'pomeranian'];

// 物理ボディ定義（コンパウンドボディ用）
// 位置は重心≈(0,0)になるよう計算済み
// chihuahua: 胴体円(r=12, -8,3) + 頭円(r=13, 8,-3) → 重心≈(0,0)
// golden:    胴体矩形(50x22, -12,3) + 頭円(r=14, 18,-5) → 重心≈(-1.2,0)
// shiba:     胴体矩形(38x22, -10,3) + 頭円(r=13, 17,-5) → 重心≈(0,0)
// pomeranian:胴体円(r=18, -6,3) + 頭円(r=13, 12,-6) → 重心≈(0,0)
const DOG_CONFIGS = {
  chihuahua: {
    density: 0.003,
    parts: [
      { type: 'circle', x: -8, y: 3, r: 12 },
      { type: 'circle', x: 8,  y: -3, r: 13 },
    ],
    behavior: { type: 'shake', duration: 1800, interval: 80, force: 0.003 },
  },
  golden: {
    density: 0.004,
    parts: [
      { type: 'rect',   x: -12, y: 3,  w: 50, h: 22 },
      { type: 'circle', x: 18,  y: -5, r: 14 },
    ],
    behavior: { type: 'tailwag', duration: 2200, interval: 120, force: 0.006 },
  },
  shiba: {
    density: 0.0035,
    parts: [
      { type: 'rect',   x: -10, y: 3,  w: 38, h: 22 },
      { type: 'circle', x: 17,  y: -5, r: 13 },
    ],
    behavior: { type: 'spin', duration: 1000, torque: 0.12 },
  },
  pomeranian: {
    density: 0.003,
    parts: [
      { type: 'circle', x: -6, y: 3,  r: 18 },
      { type: 'circle', x: 12, y: -6, r: 13 },
    ],
    behavior: { type: 'puff', duration: 1500, puffScale: 1.45 },
  },
};

let waitingSocket = null;
const rooms = {};
let dogIdCounter = 0;

function randomDog() {
  return DOG_TYPES[Math.floor(Math.random() * DOG_TYPES.length)];
}

function createDogBody(dogType, spawnX) {
  const cfg = DOG_CONFIGS[dogType];
  const partOpts = { restitution: 0.15 };
  const parts = cfg.parts.map(p =>
    p.type === 'circle'
      ? Bodies.circle(p.x, p.y, p.r, partOpts)
      : Bodies.rectangle(p.x, p.y, p.w, p.h, partOpts)
  );
  const compound = Body.create({
    label: dogType,
    density: cfg.density,
    friction: 0.6,
    frictionAir: 0.01,
    restitution: 0.15,
    parts,
  });
  Body.setPosition(compound, { x: spawnX, y: 30 });
  return compound;
}

function createRoomPhysics() {
  const engine = Engine.create({ gravity: { y: 1.2 } });
  const world = engine.world;
  World.add(world, [
    Bodies.rectangle(STAGE_X, STAGE_Y, STAGE_W, STAGE_H, {
      isStatic: true, label: 'stage', friction: 0.8, restitution: 0.1,
    }),
    Bodies.rectangle(-30, CANVAS_H / 2, 60, CANVAS_H, { isStatic: true }),
    Bodies.rectangle(CANVAS_W + 30, CANVAS_H / 2, 60, CANVAS_H, { isStatic: true }),
  ]);
  return { engine, world, dogBodies: [] };
}

function applyBehavior(roomId, info) {
  const beh = DOG_CONFIGS[info.type].behavior;
  const body = info.body;
  const startTime = Date.now();

  if (beh.type === 'shake') {
    const iv = setInterval(() => {
      if (!rooms[roomId] || Date.now() - startTime > beh.duration) { clearInterval(iv); return; }
      Body.applyForce(body, body.position, {
        x: (Math.random() - 0.5) * beh.force,
        y: (Math.random() - 0.5) * beh.force * 0.3,
      });
    }, beh.interval);

  } else if (beh.type === 'tailwag') {
    let phase = 0;
    const iv = setInterval(() => {
      if (!rooms[roomId] || Date.now() - startTime > beh.duration) { clearInterval(iv); return; }
      Body.applyForce(body, body.position, { x: Math.sin(++phase * 0.8) * beh.force, y: 0 });
    }, beh.interval);

  } else if (beh.type === 'spin') {
    Body.setAngularVelocity(body, beh.torque);
    setTimeout(() => { Body.setAngularVelocity(body, 0); }, beh.duration);

  } else if (beh.type === 'puff') {
    let expanding = true;
    info.puffRatio = 1;
    const iv = setInterval(() => {
      if (!rooms[roomId] || Date.now() - startTime > beh.duration) {
        clearInterval(iv); info.puffRatio = 1; return;
      }
      const room = rooms[roomId];
      if (expanding) {
        info.puffRatio = Math.min(beh.puffScale, info.puffRatio + 0.08);
        if (info.puffRatio >= beh.puffScale) expanding = false;
        for (const other of room.dogBodies) {
          if (other === info) continue;
          const dx = other.body.position.x - body.position.x;
          const dy = other.body.position.y - body.position.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const range = DOG_CONFIGS[info.type].parts[0].r * beh.puffScale * 2.2;
          if (dist < range && dist > 1) {
            const f = 0.008 / dist;
            Body.applyForce(other.body, other.body.position, { x: (dx / dist) * f, y: (dy / dist) * f });
          }
        }
      } else {
        info.puffRatio = Math.max(1, info.puffRatio - 0.08);
        if (info.puffRatio <= 1) expanding = true;
      }
    }, 30);
  }
}

function addDogToRoom(roomId, x, dogType) {
  const room = rooms[roomId];
  if (!room) return;

  const body = createDogBody(dogType, x);
  World.add(room.world, body);
  const info = { id: ++dogIdCounter, body, type: dogType, puffRatio: 1 };
  room.dogBodies.push(info);

  setTimeout(() => {
    if (!rooms[roomId]) return;
    applyBehavior(roomId, info);
    room.checkingFall = true;
    const maxDur = Math.max(DOG_CONFIGS[dogType].behavior.duration || 1000, 2000) + 1500;
    setTimeout(() => { if (rooms[roomId]) rooms[roomId].checkingFall = false; }, maxDur);
  }, 600);
}

function handleGameOver(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  clearInterval(room.physicsInterval);
  clearInterval(room.broadcastInterval);
  const loserIndex = (room.currentTurn + 1) % 2;
  io.to(roomId).emit('game_over', {
    loserId: room.players[loserIndex],
    winnerId: room.players[1 - loserIndex],
  });
  delete rooms[roomId];
}

function startRoomLoop(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  room.physicsInterval = setInterval(() => {
    if (!rooms[roomId]) { clearInterval(room.physicsInterval); return; }
    Engine.update(room.engine, PHYSICS_DELTA);
    if (room.checkingFall) {
      for (const info of room.dogBodies) {
        if (info.body.position.y > FALL_THRESHOLD) {
          handleGameOver(roomId);
          return;
        }
      }
    }
  }, PHYSICS_DELTA);

  room.broadcastInterval = setInterval(() => {
    if (!rooms[roomId]) { clearInterval(room.broadcastInterval); return; }
    io.to(roomId).emit('physics_update', {
      dogs: room.dogBodies.map(info => ({
        id: info.id,
        type: info.type,
        x: info.body.position.x,
        y: info.body.position.y,
        angle: info.body.angle,
        puffRatio: info.puffRatio,
      })),
    });
  }, 50);
}

function createRoom(socket1, socket2) {
  const roomId = `room_${Date.now()}`;
  const players = [socket1.id, socket2.id];
  const physics = createRoomPhysics();
  rooms[roomId] = { players, currentTurn: 0, checkingFall: false, ...physics };

  socket1.join(roomId);
  socket2.join(roomId);

  const nextDog = randomDog();
  rooms[roomId].nextDog = nextDog;
  io.to(roomId).emit('game_start', {
    roomId,
    players: { [socket1.id]: 'player1', [socket2.id]: 'player2' },
    currentTurn: players[0],
    nextDog,
  });

  startRoomLoop(roomId);
  console.log(`Room created: ${roomId}`);
}

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('find_match', () => {
    if (waitingSocket && waitingSocket.id !== socket.id && waitingSocket.connected) {
      const opponent = waitingSocket;
      waitingSocket = null;
      createRoom(opponent, socket);
    } else {
      waitingSocket = socket;
      socket.emit('waiting');
    }
  });

  socket.on('place_dog', ({ roomId, x, dogType }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (socket.id !== room.players[room.currentTurn]) return;

    addDogToRoom(roomId, x, dogType);

    const nextDog = randomDog();
    room.nextDog = nextDog;
    room.currentTurn = (room.currentTurn + 1) % 2;

    io.to(roomId).emit('dog_placed', {
      playerId: socket.id,
      dogType,
      nextTurn: room.players[room.currentTurn],
      nextDog,
    });
  });

  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
    if (waitingSocket && waitingSocket.id === socket.id) waitingSocket = null;
    for (const [roomId, room] of Object.entries(rooms)) {
      if (room.players.includes(socket.id)) {
        clearInterval(room.physicsInterval);
        clearInterval(room.broadcastInterval);
        socket.to(roomId).emit('opponent_disconnected');
        delete rooms[roomId];
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
