// 犬の描画モジュール
// 画像がロード済みなら画像で描画、未ロードならcanvasフォールバック

const DOG_CONFIGS = {
  chihuahua:  { label: 'チワワ' },
  golden:     { label: 'ゴールデンレトリバー' },
  shiba:      { label: '柴犬' },
  pomeranian: { label: 'ポメラニアン' },
};

// 表示サイズ設定（物理ボディのコンパウンド形状に合わせたサイズ）
// w/h: 描画サイズ（px）、flip: 画像が左向きの場合はtrue
// offsetX/Y: 画像中心を物理ボディの重心からずらすピクセル数（画像の配置調整用）
const DOG_DISPLAY = {
  chihuahua:  { w: 55,  h: 48,  flip: false, offsetX: 0, offsetY: 0 },
  golden:     { w: 88,  h: 50,  flip: false, offsetX: 0, offsetY: 0 },
  shiba:      { w: 72,  h: 54,  flip: false, offsetX: 0, offsetY: 0 },
  pomeranian: { w: 68,  h: 62,  flip: false, offsetX: 0, offsetY: 0 },
};

// ロード済み画像キャッシュ
const dogImages = {};

// 画像ファイル名マップ（client/assets/ 以下に置く）
const IMAGE_FILES = {
  chihuahua:  'assets/chihuahua.png',
  golden:     'assets/golden.png',
  shiba:      'assets/shiba.png',
  pomeranian: 'assets/pomeranian.png',
};

// 画像をプリロードして返す Promise
function loadDogImages() {
  const promises = Object.entries(IMAGE_FILES).map(([type, src]) =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload  = () => { dogImages[type] = img; resolve(); };
      img.onerror = () => { resolve(); }; // 画像がなければフォールバック描画を使用
      img.src = src;
    })
  );
  return Promise.all(promises);
}

// ---- メイン描画エントリ ----
function drawDog(ctx, type, x, y, angle = 0, puffRatio = 1) {
  const img  = dogImages[type];
  const disp = DOG_DISPLAY[type];

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(puffRatio, puffRatio);

  if (img && disp) {
    const w = disp.w, h = disp.h;
    const ox = disp.offsetX, oy = disp.offsetY;

    if (disp.flip) {
      ctx.scale(-1, 1);
      ctx.drawImage(img, -(w / 2) - ox, -(h / 2) + oy, w, h);
    } else {
      ctx.drawImage(img, -(w / 2) + ox, -(h / 2) + oy, w, h);
    }
  } else {
    // 画像未ロード時のフォールバック
    _fallbackDog(ctx, type);
  }

  ctx.restore();
}

// ---- プレビュー（次の犬パネル） ----
function drawDogPreview(canvas, type) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const img  = dogImages[type];
  const disp = DOG_DISPLAY[type];

  if (img && disp) {
    // アスペクト比を保ちつつ60x60に収める
    const scale = Math.min(canvas.width / disp.w, canvas.height / disp.h) * 0.9;
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

// ========== フォールバック描画（画像がない場合）==========

function _fallbackDog(ctx, type) {
  const colors = {
    chihuahua:  '#C8925A',
    golden:     '#D4A017',
    shiba:      '#C04000',
    pomeranian: '#F07018',
  };
  const c = colors[type] || '#888';
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.ellipse(0, 0, 20, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(18, -6, 12, 0, Math.PI * 2);
  ctx.fill();

  const cfg = DOG_CONFIGS[type];
  ctx.fillStyle = '#333';
  ctx.font = 'bold 8px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(cfg?.label ?? type, 0, 22);
}
