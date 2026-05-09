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

// コンパウンドボディ定義（画像の実際の形状に合わせて設計）
// 重心がほぼ(0,0)になるよう部品位置を計算済み
//
// チワワ:  正面向き座り(328x334≈正方形) → 縦長の2円コンパウンド
// ゴールデン: 横長伏せ(537x412) → 横長矩形＋頭円
// 柴犬: 横長伏せ(439x302) → 横長矩形＋頭円
// ポメラニアン: 丸い座り(334x265) → 大円＋小円
const DOG_CONFIGS = {
  chihuahua: {
    density: 0.003,
    parts: [
      { type: 'circle', x: -2, y: 6,  r: 16 }, // 胴体（下）
      { type: 'circle', x:  2, y: -8, r: 14 }, // 頭（上）
    ],
    // 常時ブルブル震え → 置いた後も継続
    behavior: { type: 'shake', interval: 80, force: 0.0045 },
  },
  golden: {
    density: 0.004,
    parts: [
      { type: 'rect',   x: -15, y: 5, w: 56, h: 22 }, // 横長胴体
      { type: 'circle', x:  22, y: -8, r: 16 },         // 頭
    ],
    // 常時尻尾振り → 左右に周期的な力
    behavior: { type: 'tailwag', interval: 120, force: 0.009 },
  },
  shiba: {
    density: 0.0035,
    parts: [
      { type: 'rect',   x: -12, y: 4, w: 46, h: 20 }, // 横長胴体
      { type: 'circle', x:  18, y: -7, r: 14 },         // 頭
    ],
    // 3.5秒ごとに突然スピン
    behavior: { type: 'spin', torque: 0.20, spinInterval: 3500, spinDuration: 650 },
  },
  pomeranian: {
    density: 0.003,
    parts: [
      { type: 'circle', x: -7, y: 4,  r: 18 }, // もこもこ胴体
      { type: 'circle', x: 13, y: -8, r: 13 }, // 頭
    ],
    // 2.5秒ごとに膨張して周囲を押し出す
    behavior: { type: 'puff', puffScale: 1.55, puffInterval: 2500 },
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
  const parts = cfg.parts.map(p =>
    p.type === 'circle'
      ? Bodies.circle(p.x, p.y, p.r, { restitution: 0.15 })
      : Bodies.rectangle(p.x, p.y, p.w, p.h, { restitution: 0.15 })
  );
  const compound = Body.create({
    label: dogType,
    density: cfg.density,
    friction: 0.65,
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

// 行動を適用（永続動作）
function applyBehavior(roomId, info) {
  const beh = DOG_CONFIGS[info.type].behavior;
  const body = info.body;
  info.behaviorPhase = 0;
  info.spinActive = false;

  if (beh.type === 'shake') {
    // チワワ: ブルブル震え（無限ループ）
    const iv = setInterval(() => {
      if (!rooms[roomId]) { clearInterval(iv); return; }
      Body.applyForce(body, body.position, {
        x: (Math.random() - 0.5) * beh.force,
        y: (Math.random() - 0.5) * beh.force * 0.2,
      });
      info.behaviorPhase++;
    }, beh.interval);
    info.behaviorInterval = iv;

  } else if (beh.type === 'tailwag') {
    // ゴールデン: 尻尾を振り続ける（無限ループ）
    let phase = 0;
    const iv = setInterval(() => {
      if (!rooms[roomId]) { clearInterval(iv); return; }
      phase++;
      Body.applyForce(body, body.position, {
        x: Math.sin(phase * 0.7) * beh.force,
        y: 0,
      });
      info.behaviorPhase = phase;
    }, beh.interval);
    info.behaviorInterval = iv;

  } else if (beh.type === 'spin') {
    // 柴犬: 一定間隔でスピン
    const doSpin = () => {
      if (!rooms[roomId]) return;
      info.spinActive = true;
      Body.setAngularVelocity(body, beh.torque);
      setTimeout(() => {
        if (!rooms[roomId]) return;
        Body.setAngularVelocity(body, 0);
        info.spinActive = false;
      }, beh.spinDuration);
    };
    doSpin(); // 即座に最初のスピン
    const iv = setInterval(() => {
      if (!rooms[roomId]) { clearInterval(iv); return; }
      doSpin();
    }, beh.spinInterval);
    info.behaviorInterval = iv;

  } else if (beh.type === 'puff') {
    // ポメラニアン: 膨張→収縮を繰り返す
    const doPuff = () => {
      if (!rooms[roomId]) return;
      let expanding = true;
      info.puffRatio = 1;
      const puffIv = setInterval(() => {
        if (!rooms[roomId]) { clearInterval(puffIv); return; }
        if (expanding) {
          info.puffRatio = Math.min(beh.puffScale, info.puffRatio + 0.12);
          if (info.puffRatio >= beh.puffScale) expanding = false;
          // 周囲の犬を押し出す
          const room = rooms[roomId];
          for (const other of room.dogBodies) {
            if (other === info) continue;
            const dx = other.body.position.x - body.position.x;
            const dy = other.body.position.y - body.position.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 58 && dist > 1) {
              const f = 0.015 / dist;
              Body.applyForce(other.body, other.body.position, {
                x: (dx / dist) * f, y: (dy / dist) * f,
              });
            }
          }
        } else {
          info.puffRatio = Math.max(1, info.puffRatio - 0.12);
          if (info.puffRatio <= 1) { clearInterval(puffIv); info.puffRatio = 1; }
        }
      }, 30);
    };
    doPuff();
    const iv = setInterval(() => {
      if (!rooms[roomId]) { clearInterval(iv); return; }
      doPuff();
    }, beh.puffInterval);
    info.behaviorInterval = iv;
  }
}

function addDogToRoom(roomId, x, dogType) {
  const room = rooms[roomId];
  if (!room) return;

  const body = createDogBody(dogType, x);
  World.add(room.world, body);
  const info = {
    id: ++dogIdCounter, body, type: dogType,
    puffRatio: 1, behaviorPhase: 0, spinActive: false,
    behaviorInterval: null,
  };
  room.dogBodies.push(info);

  // 着地後（600ms）に行動開始
  setTimeout(() => {
    if (!rooms[roomId]) return;
    applyBehavior(roomId, info);
  }, 600);

  // 最初の犬が着地してから落下チェックを有効化（1回だけ）
  if (!room.checkingFall) {
    setTimeout(() => {
      if (rooms[roomId]) rooms[roomId].checkingFall = true;
    }, 1500);
  }
}

function clearRoomResources(room) {
  clearInterval(room.physicsInterval);
  clearInterval(room.broadcastInterval);
  for (const info of room.dogBodies) {
    if (info.behaviorInterval) clearInterval(info.behaviorInterval);
  }
}

function handleGameOver(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  clearRoomResources(room);
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

  // 20fps で座標・行動状態を配信
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
        behaviorPhase: info.behaviorPhase || 0,
        spinActive: info.spinActive || false,
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
        clearRoomResources(room);
        socket.to(roomId).emit('opponent_disconnected');
        delete rooms[roomId];
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
