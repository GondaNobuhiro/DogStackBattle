const CANVAS_W = 600;
const CANVAS_H = 500;
const STAGE_Y = 420;
const STAGE_W = 320;
const STAGE_H = 18;
const STAGE_X = CANVAS_W / 2;
const FALL_THRESHOLD = CANVAS_H + 60;

const DOG_TYPES = ['chihuahua', 'golden', 'shiba', 'pomeranian'];

// 練習モード用：サーバーと同じ物理ボディ定義
const PRACTICE_PHYSICS = {
  chihuahua: {
    density: 0.003,
    parts: [{ type: 'circle', x: -2, y: 6, r: 16 }, { type: 'circle', x: 2, y: -8, r: 14 }],
    behavior: { type: 'shake', interval: 80, force: 0.0045 },
  },
  golden: {
    density: 0.004,
    parts: [{ type: 'rect', x: -15, y: 5, w: 56, h: 22 }, { type: 'circle', x: 22, y: -8, r: 16 }],
    behavior: { type: 'tailwag', interval: 120, force: 0.009 },
  },
  shiba: {
    density: 0.0035,
    parts: [{ type: 'rect', x: -12, y: 4, w: 46, h: 20 }, { type: 'circle', x: 18, y: -7, r: 14 }],
    behavior: { type: 'spin', torque: 0.20, spinInterval: 3500, spinDuration: 650 },
  },
  pomeranian: {
    density: 0.003,
    parts: [{ type: 'circle', x: -7, y: 4, r: 18 }, { type: 'circle', x: 13, y: -8, r: 13 }],
    behavior: { type: 'puff', puffScale: 1.55, puffInterval: 2500 },
  },
};

// ---- ソケット ----
const socket = io();

// 起動時に犬画像をプリロード
loadDogImages().then(() => {
  console.log('Dog images loaded:', Object.keys(dogImages));
});

// ---- 対戦ゲーム状態 ----
let myId = null;
let roomId = null;
let isMyTurn = false;
let nextDogType = null;
let serverDogs = [];
let gameOver = false;
let lastMouseX = CANVAS_W / 2;

// ---- 練習モード状態 ----
let practiceMode = false;
let practiceEngine = null;
let practiceDogBodies = [];
let practiceBehaviorIntervals = [];
let practiceScore = 0;
let practiceFallDetected = false;
let practiceNextDogType = null;
let practiceFallCheckIv = null;
let practiceCheckingFall = false;

// ---- Canvas ----
const canvas = document.getElementById('game-canvas');
canvas.width = CANVAS_W;
canvas.height = CANVAS_H;
const ctx = canvas.getContext('2d');

// 最初からレンダーループを開始
renderLoop();

// ========== 描画ループ ==========

function renderLoop() {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // 練習モード中はクライアント物理を更新
  if (practiceMode && practiceEngine) {
    Matter.Engine.update(practiceEngine, 1000 / 60);
  }

  // 背景
  const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  grad.addColorStop(0, '#e8f4f8');
  grad.addColorStop(1, '#f5f0e8');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // ステージ
  ctx.fillStyle = '#8B5E3C';
  ctx.beginPath();
  ctx.roundRect(STAGE_X - STAGE_W / 2, STAGE_Y - STAGE_H / 2, STAGE_W, STAGE_H, 6);
  ctx.fill();
  ctx.fillStyle = '#a07040';
  ctx.fillRect(STAGE_X - STAGE_W / 2, STAGE_Y - STAGE_H / 2, STAGE_W, 5);

  // 犬を描画（練習モード or 対戦モード）
  const dogs = practiceMode
    ? practiceDogBodies.map(info => ({
        type: info.type,
        x: info.body.position.x,
        y: info.body.position.y,
        angle: info.body.angle,
        puffRatio: info.puffRatio,
        behaviorPhase: info.behaviorPhase || 0,
        spinActive: info.spinActive || false,
      }))
    : serverDogs;

  for (const dog of dogs) {
    drawDog(ctx, dog.type, dog.x, dog.y, dog.angle, dog.puffRatio,
            dog.behaviorPhase || 0, dog.spinActive || false);
  }

  // ドロップ位置インジケーター
  const showIndicator = practiceMode
    ? (!practiceFallDetected && practiceNextDogType)
    : (isMyTurn && !gameOver && nextDogType);
  const indicatorDogType = practiceMode ? practiceNextDogType : nextDogType;

  if (showIndicator && indicatorDogType) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    drawDog(ctx, indicatorDogType, lastMouseX, 40, 0, 1, 0, false);
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(lastMouseX, 60);
    ctx.lineTo(lastMouseX, STAGE_Y - STAGE_H / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  requestAnimationFrame(renderLoop);
}

// ========== 練習モード ==========

function startPracticeMode() {
  practiceMode = true;
  practiceScore = 0;
  practiceFallDetected = false;
  practiceDogBodies = [];
  practiceBehaviorIntervals = [];
  practiceCheckingFall = false;

  const { Engine, Bodies, World } = Matter;

  practiceEngine = Engine.create({ gravity: { y: 1.2 } });
  const world = practiceEngine.world;
  World.add(world, [
    Bodies.rectangle(STAGE_X, STAGE_Y, STAGE_W, STAGE_H,
      { isStatic: true, friction: 0.8, restitution: 0.1 }),
    Bodies.rectangle(-30, CANVAS_H / 2, 60, CANVAS_H, { isStatic: true }),
    Bodies.rectangle(CANVAS_W + 30, CANVAS_H / 2, 60, CANVAS_H, { isStatic: true }),
  ]);

  practiceNextDogType = randomDogType();
  updateNextDog(practiceNextDogType);

  document.getElementById('practice-banner').classList.remove('hidden');
  document.getElementById('turn-indicator').textContent = '犬を落とす位置をクリック';
  document.getElementById('turn-indicator').className = 'practice-turn';
  updatePracticeScoreDisplay();

  showScreen('screen-game');
}

function stopPracticeMode() {
  if (!practiceMode) return;
  practiceMode = false;

  clearInterval(practiceFallCheckIv);
  for (const iv of practiceBehaviorIntervals) clearInterval(iv);
  practiceBehaviorIntervals = [];
  practiceDogBodies = [];
  practiceEngine = null;

  document.getElementById('practice-banner').classList.add('hidden');
  document.getElementById('practice-fell').classList.add('hidden');
}

function practiceReset() {
  // 行動インターバルをすべてクリア
  for (const iv of practiceBehaviorIntervals) clearInterval(iv);
  practiceBehaviorIntervals = [];

  // 物理ボディを削除
  if (practiceEngine) {
    for (const info of practiceDogBodies) {
      Matter.World.remove(practiceEngine.world, info.body);
    }
  }
  practiceDogBodies = [];
  practiceScore = 0;
  practiceFallDetected = false;
  practiceCheckingFall = false;

  practiceNextDogType = randomDogType();
  updateNextDog(practiceNextDogType);
  updatePracticeScoreDisplay();
  document.getElementById('practice-fell').classList.add('hidden');
}

function practicePlaceDog(x) {
  if (!practiceMode || practiceFallDetected || !practiceNextDogType) return;

  const dogType = practiceNextDogType;
  const { Bodies, Body, World } = Matter;
  const cfg = PRACTICE_PHYSICS[dogType];

  const parts = cfg.parts.map(p =>
    p.type === 'circle'
      ? Bodies.circle(p.x, p.y, p.r, { restitution: 0.15 })
      : Bodies.rectangle(p.x, p.y, p.w, p.h, { restitution: 0.15 })
  );
  const compound = Body.create({
    label: dogType, density: cfg.density,
    friction: 0.65, frictionAir: 0.01, restitution: 0.15, parts,
  });
  Body.setPosition(compound, { x, y: 30 });
  World.add(practiceEngine.world, compound);

  const info = { body: compound, type: dogType, puffRatio: 1, behaviorPhase: 0, spinActive: false };
  practiceDogBodies.push(info);
  practiceScore++;
  updatePracticeScoreDisplay();

  // 着地後に行動を開始
  setTimeout(() => {
    if (practiceMode) applyPracticeBehavior(info);
  }, 600);

  // 最初の犬が落ち着いてから落下チェックを有効化
  if (!practiceCheckingFall) {
    setTimeout(() => {
      if (practiceMode) {
        practiceCheckingFall = true;
        startPracticeFallCheck();
      }
    }, 1500);
  }

  practiceNextDogType = randomDogType();
  updateNextDog(practiceNextDogType);
}

function startPracticeFallCheck() {
  clearInterval(practiceFallCheckIv);
  practiceFallCheckIv = setInterval(() => {
    if (!practiceMode || practiceFallDetected) return;
    for (const info of practiceDogBodies) {
      if (info.body.position.y > FALL_THRESHOLD) {
        practiceFallDetected = true;
        clearInterval(practiceFallCheckIv);

        // 落下表示
        document.getElementById('practice-fell-text').textContent =
          `${practiceScore}匹積めました！`;
        document.getElementById('practice-fell').classList.remove('hidden');

        // 2秒後にリセット
        setTimeout(() => {
          if (practiceMode) practiceReset();
        }, 2000);
        return;
      }
    }
  }, 50);
}

function applyPracticeBehavior(info) {
  const beh = PRACTICE_PHYSICS[info.type].behavior;
  const { Body } = Matter;
  const body = info.body;

  if (beh.type === 'shake') {
    const iv = setInterval(() => {
      if (!practiceMode) { clearInterval(iv); return; }
      Body.applyForce(body, body.position, {
        x: (Math.random() - 0.5) * beh.force,
        y: (Math.random() - 0.5) * beh.force * 0.2,
      });
      info.behaviorPhase++;
    }, beh.interval);
    practiceBehaviorIntervals.push(iv);

  } else if (beh.type === 'tailwag') {
    let phase = 0;
    const iv = setInterval(() => {
      if (!practiceMode) { clearInterval(iv); return; }
      phase++;
      Body.applyForce(body, body.position, { x: Math.sin(phase * 0.7) * beh.force, y: 0 });
      info.behaviorPhase = phase;
    }, beh.interval);
    practiceBehaviorIntervals.push(iv);

  } else if (beh.type === 'spin') {
    const doSpin = () => {
      if (!practiceMode) return;
      info.spinActive = true;
      Body.setAngularVelocity(body, beh.torque);
      setTimeout(() => {
        if (practiceMode) { Body.setAngularVelocity(body, 0); info.spinActive = false; }
      }, beh.spinDuration);
    };
    doSpin();
    const iv = setInterval(() => {
      if (!practiceMode) { clearInterval(iv); return; }
      doSpin();
    }, beh.spinInterval);
    practiceBehaviorIntervals.push(iv);

  } else if (beh.type === 'puff') {
    const doPuff = () => {
      if (!practiceMode) return;
      let expanding = true;
      info.puffRatio = 1;
      const puffIv = setInterval(() => {
        if (!practiceMode) { clearInterval(puffIv); return; }
        if (expanding) {
          info.puffRatio = Math.min(beh.puffScale, info.puffRatio + 0.12);
          if (info.puffRatio >= beh.puffScale) expanding = false;
          for (const other of practiceDogBodies) {
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
      practiceBehaviorIntervals.push(puffIv);
    };
    doPuff();
    const iv = setInterval(() => {
      if (!practiceMode) { clearInterval(iv); return; }
      doPuff();
    }, beh.puffInterval);
    practiceBehaviorIntervals.push(iv);
  }
}

// ========== UI ヘルパー ==========

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function updateTurnUI() {
  const el = document.getElementById('turn-indicator');
  el.className = '';
  if (isMyTurn) {
    el.textContent = 'あなたのターン！犬を落とせ！';
    el.classList.add('my-turn');
  } else {
    el.textContent = '相手のターン...';
    el.classList.add('opponent-turn');
  }
}

function updateNextDog(type) {
  nextDogType = practiceMode ? nextDogType : type;
  const displayType = practiceMode ? (practiceNextDogType || type) : type;
  document.getElementById('next-dog-name').textContent = DOG_CONFIGS[type]?.label || '';
  drawDogPreview(document.getElementById('next-dog-preview'), type);
  if (!practiceMode) nextDogType = type;
}

function updatePracticeScoreDisplay() {
  const el = document.getElementById('practice-score-display');
  if (el) el.textContent = `${practiceScore}匹積み中`;
}

function randomDogType() {
  return DOG_TYPES[Math.floor(Math.random() * DOG_TYPES.length)];
}

// ========== マウス ==========

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  lastMouseX = e.clientX - rect.left;
});

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;

  if (practiceMode) {
    practicePlaceDog(x);
    return;
  }

  if (!isMyTurn || gameOver || !nextDogType) return;
  socket.emit('place_dog', { roomId, x, dogType: nextDogType });
});

// ========== ソケットイベント ==========

socket.on('connect', () => { myId = socket.id; });

socket.on('waiting', () => {
  document.getElementById('match-status').textContent = '相手を探しています...';
  document.getElementById('btn-match').disabled = true;
  document.getElementById('btn-practice').classList.remove('hidden');
});

socket.on('game_start', (data) => {
  // 練習モード中なら終了して本番ゲームへ
  if (practiceMode) stopPracticeMode();

  roomId = data.roomId;
  isMyTurn = data.currentTurn === myId;
  serverDogs = [];
  gameOver = false;

  const dogForStart = data.nextDog;
  nextDogType = dogForStart;
  document.getElementById('next-dog-name').textContent = DOG_CONFIGS[dogForStart]?.label || '';
  drawDogPreview(document.getElementById('next-dog-preview'), dogForStart);

  showScreen('screen-game');
  updateTurnUI();
});

socket.on('physics_update', ({ dogs }) => {
  if (!practiceMode) serverDogs = dogs;
});

socket.on('dog_placed', ({ nextTurn, nextDog }) => {
  isMyTurn = nextTurn === myId;
  nextDogType = nextDog;
  document.getElementById('next-dog-name').textContent = DOG_CONFIGS[nextDog]?.label || '';
  drawDogPreview(document.getElementById('next-dog-preview'), nextDog);
  updateTurnUI();
});

socket.on('game_over', ({ loserId, winnerId }) => {
  gameOver = true;
  const won = winnerId === myId;
  document.getElementById('result-title').textContent = won ? '🏆 勝ち！' : '💀 負け...';
  document.getElementById('result-message').textContent = won
    ? '相手の犬を落としました！'
    : 'あなたのターンに犬が落ちました...';
  showScreen('screen-result');
});

socket.on('opponent_disconnected', () => {
  gameOver = true;
  document.getElementById('result-title').textContent = '🏆 勝ち！';
  document.getElementById('result-message').textContent = '相手が接続を切断しました';
  showScreen('screen-result');
});

// ========== ボタン ==========

document.getElementById('btn-match').addEventListener('click', () => {
  socket.emit('find_match');
});

document.getElementById('btn-practice').addEventListener('click', () => {
  document.getElementById('btn-practice').classList.add('hidden');
  startPracticeMode();
});

document.getElementById('btn-rematch').addEventListener('click', () => {
  gameOver = false;
  serverDogs = [];
  nextDogType = null;
  document.getElementById('btn-match').disabled = false;
  document.getElementById('match-status').textContent = '';
  document.getElementById('btn-practice').classList.add('hidden');
  showScreen('screen-match');
  socket.emit('find_match');
});
