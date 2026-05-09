const CANVAS_W = 600;
const CANVAS_H = 500;
const STAGE_Y = 420;
const STAGE_W = 320;
const STAGE_H = 18;
const STAGE_X = CANVAS_W / 2;

const socket = io();

// 起動時に犬の画像をプリロード（失敗してもフォールバックで動く）
loadDogImages().then(() => {
  console.log('Dog images loaded:', Object.keys(dogImages));
});

let myId = null;
let roomId = null;
let isMyTurn = false;
let nextDogType = null;
let serverDogs = [];
let gameOver = false;
let renderStarted = false;
let lastMouseX = CANVAS_W / 2;

const canvas = document.getElementById('game-canvas');
canvas.width = CANVAS_W;
canvas.height = CANVAS_H;
const ctx = canvas.getContext('2d');

// ---- 描画ループ（サーバーから受け取った座標だけで描画） ----
function renderLoop() {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

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

  // 犬（サーバーの座標で描画）
  for (const dog of serverDogs) {
    drawDog(ctx, dog.type, dog.x, dog.y, dog.angle, dog.puffRatio);
  }

  // ドロップ位置インジケーター
  if (isMyTurn && !gameOver && nextDogType) {
    const mx = lastMouseX;
    ctx.save();
    ctx.globalAlpha = 0.35;
    drawDog(ctx, nextDogType, mx, 40, 0, 1);
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mx, 60);
    ctx.lineTo(mx, STAGE_Y - STAGE_H / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  requestAnimationFrame(renderLoop);
}

// ---- マウス ----
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  lastMouseX = e.clientX - rect.left;
});

canvas.addEventListener('click', (e) => {
  if (!isMyTurn || gameOver || !nextDogType) return;
  const rect = canvas.getBoundingClientRect();
  socket.emit('place_dog', { roomId, x: e.clientX - rect.left, dogType: nextDogType });
});

// ---- UI ----
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
  nextDogType = type;
  document.getElementById('next-dog-name').textContent = DOG_CONFIGS[type]?.label || '';
  drawDogPreview(document.getElementById('next-dog-preview'), type);
}

// ---- ソケットイベント ----
socket.on('connect', () => { myId = socket.id; });

socket.on('waiting', () => {
  document.getElementById('match-status').textContent = '相手を探しています...';
  document.getElementById('btn-match').disabled = true;
});

socket.on('game_start', (data) => {
  roomId = data.roomId;
  isMyTurn = data.currentTurn === myId;
  updateNextDog(data.nextDog);
  serverDogs = [];

  if (!renderStarted) {
    renderStarted = true;
    renderLoop();
  }

  showScreen('screen-game');
  updateTurnUI();
});

// サーバーから物理状態を受け取って描画バッファを更新
socket.on('physics_update', ({ dogs }) => {
  serverDogs = dogs;
});

socket.on('dog_placed', ({ nextTurn, nextDog }) => {
  isMyTurn = nextTurn === myId;
  updateNextDog(nextDog);
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

// ---- ボタン ----
document.getElementById('btn-match').addEventListener('click', () => {
  socket.emit('find_match');
});

document.getElementById('btn-rematch').addEventListener('click', () => {
  gameOver = false;
  serverDogs = [];
  document.getElementById('btn-match').disabled = false;
  document.getElementById('match-status').textContent = '';
  showScreen('screen-match');
  socket.emit('find_match');
});
