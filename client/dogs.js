// 犬の描画モジュール
// 画像の実際のサイズ・ポーズに合わせた表示サイズと当たり判定オフセット

const DOG_CONFIGS = {
  chihuahua:  { label: 'チワワ' },
  golden:     { label: 'ゴールデンレトリバー' },
  shiba:      { label: '柴犬' },
  pomeranian: { label: 'ポメラニアン' },
};

// 表示設定（実画像サイズから比率を維持してスケール）
// 画像サイズ: チワワ 328x334, ゴールデン 537x412, 柴犬 439x302, ポメラニアン 334x265
// w/h: 描画サイズ(px)
// flip: true で左右反転（左向き画像を右向きに）
// offsetX/Y: 物理ボディ重心(0,0)から画像中心をずらす微調整
const DOG_DISPLAY = {
  chihuahua:  { w: 52,  h: 53,  flip: false, offsetX:  0, offsetY:  0 },
  golden:     { w: 82,  h: 63,  flip: false, offsetX:  0, offsetY:  0 },
  shiba:      { w: 72,  h: 50,  flip: false, offsetX:  0, offsetY:  0 },
  pomeranian: { w: 64,  h: 51,  flip: false, offsetX:  0, offsetY:  0 },
};

const dogImages = {};

const IMAGE_FILES = {
  chihuahua:  'assets/chihuahua.png',
  golden:     'assets/golden.png',
  shiba:      'assets/shiba.png',
  pomeranian: 'assets/pomeranian.png',
};

function loadDogImages() {
  return Promise.all(
    Object.entries(IMAGE_FILES).map(([type, src]) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload  = () => { dogImages[type] = img; resolve(); };
        img.onerror = () => resolve();
        img.src = src;
      })
    )
  );
}

// ---- メイン描画 ----
// behaviorPhase: 行動フレームカウンタ（シェイク・テールワグの視覚エフェクト用）
// spinActive: 柴犬スピン中フラグ
function drawDog(ctx, type, x, y, angle = 0, puffRatio = 1, behaviorPhase = 0, spinActive = false) {
  ctx.save();
  ctx.translate(x, y);

  // ポメラニアン: 膨張リングをrotateの外側で描く（ステージ固定向き）
  if (type === 'pomeranian' && puffRatio > 1.05) {
    _drawPuffRings(ctx, puffRatio);
  }

  ctx.rotate(angle);
  ctx.scale(puffRatio, puffRatio);

  // 犬の本体画像
  const img  = dogImages[type];
  const disp = DOG_DISPLAY[type];
  if (img && disp) {
    const hw = disp.w / 2, hh = disp.h / 2;
    if (disp.flip) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(img, -(hw) - disp.offsetX, -(hh) + disp.offsetY, disp.w, disp.h);
      ctx.restore();
    } else {
      ctx.drawImage(img, -(hw) + disp.offsetX, -(hh) + disp.offsetY, disp.w, disp.h);
    }
  } else {
    _fallbackDog(ctx, type);
  }

  // 行動エフェクト（本体の上に重ねて描く）
  _drawBehaviorEffect(ctx, type, behaviorPhase, spinActive);

  ctx.restore();
}

// ---- プレビュー ----
function drawDogPreview(canvas, type) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const img  = dogImages[type];
  const disp = DOG_DISPLAY[type];

  if (img && disp) {
    const scale = Math.min(canvas.width / disp.w, canvas.height / disp.h) * 0.88;
    const dw = disp.w * scale, dh = disp.h * scale;
    const dx = (canvas.width  - dw) / 2;
    const dy = (canvas.height - dh) / 2;
    ctx.save();
    if (disp.flip) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, canvas.width - dx - dw, dy, dw, dh);
    } else {
      ctx.drawImage(img, dx, dy, dw, dh);
    }
    ctx.restore();
  } else {
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    _fallbackDog(ctx, type);
    ctx.restore();
  }
}

// ======== 行動エフェクト ========

function _drawBehaviorEffect(ctx, type, phase, spinActive) {
  if (type === 'chihuahua' && phase > 0) {
    // チワワ: オレンジの放射線がパルス（常時震え表現）
    const pulse = (Math.sin(phase * 0.45) + 1) / 2; // 0〜1
    const alpha = 0.35 + pulse * 0.45;
    ctx.strokeStyle = `rgba(255, 110, 0, ${alpha})`;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + phase * 0.08;
      const r1 = 28 + pulse * 4;
      const r2 = 36 + pulse * 5;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
      ctx.stroke();
    }
    // 内側の振動円
    ctx.strokeStyle = `rgba(255, 160, 0, ${alpha * 0.4})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 25 + pulse * 3, 0, Math.PI * 2);
    ctx.stroke();

  } else if (type === 'golden' && phase > 0) {
    // ゴールデン: 尻尾側（左）に揺れる黄金弧
    const swing = Math.sin(phase * 0.7);  // -1〜1
    const absSwing = Math.abs(swing);
    const alpha = absSwing * 0.7 + 0.1;
    const tailX = -30; // 尻尾側（画像左端付近）
    const offsetY = swing * 14;
    // メインアーク
    ctx.strokeStyle = `rgba(220, 170, 20, ${alpha})`;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(tailX, offsetY, 14, 0.4, Math.PI - 0.4);
    ctx.stroke();
    // 外側のアーク
    ctx.strokeStyle = `rgba(255, 210, 60, ${alpha * 0.45})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(tailX, offsetY, 21, 0.3, Math.PI - 0.3);
    ctx.stroke();
    // 動きの軌跡線
    if (absSwing > 0.3) {
      ctx.strokeStyle = `rgba(255, 230, 100, ${absSwing * 0.3})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tailX - 5, -swing * 20);
      ctx.quadraticCurveTo(tailX - 18, 0, tailX - 5, swing * 20);
      ctx.stroke();
    }

  } else if (type === 'shiba' && spinActive) {
    // 柴犬: スピン中に赤い回転リングとスピードライン
    ctx.strokeStyle = 'rgba(200, 60, 0, 0.75)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(220, 80, 0, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 42, 0, Math.PI * 2);
    ctx.stroke();
    // スピードライン（6方向）
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const a2 = a + 0.55;
      ctx.strokeStyle = `rgba(230, 100, 0, 0.45)`;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 30, Math.sin(a) * 30);
      ctx.lineTo(Math.cos(a2) * 44, Math.sin(a2) * 44);
      ctx.stroke();
    }
    // 警告テキスト
    ctx.fillStyle = 'rgba(220, 60, 0, 0.8)';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⚠', 0, -42);
  }
  // ポメラニアン: puffRingsはrotateの外で既に描画済み
}

function _drawPuffRings(ctx, puffRatio) {
  const progress = (puffRatio - 1) / 0.55;
  // 外側に広がる同心円
  ctx.strokeStyle = `rgba(255, 235, 180, ${progress * 0.65})`;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(0, 0, 38 * puffRatio, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = `rgba(255, 255, 220, ${progress * 0.35})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 48 * puffRatio, 0, Math.PI * 2);
  ctx.stroke();

  // ふわふわ感の小円
  if (progress > 0.4) {
    const alpha = (progress - 0.4) / 0.6 * 0.5;
    ctx.fillStyle = `rgba(255, 250, 230, ${alpha})`;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = 36 * puffRatio;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ---- フォールバック描画（画像未ロード時）----
function _fallbackDog(ctx, type) {
  const colors = { chihuahua: '#C8925A', golden: '#D4A017', shiba: '#C04000', pomeranian: '#F07018' };
  const c = colors[type] || '#888';
  ctx.fillStyle = c;
  ctx.beginPath(); ctx.ellipse(0, 0, 20, 14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(18, -6, 12, 0, Math.PI * 2); ctx.fill();
  const cfg = DOG_CONFIGS[type];
  ctx.fillStyle = '#333';
  ctx.font = 'bold 8px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(cfg?.label ?? type, 0, 22);
}
