/* PS.ItemArt -- 道具「按名字建模」的美术层 (v5.6, 主程新建)
 * ===========================================================================
 * 事实(实测, work/probe-itemicon-audit.cjs): 旧实现 PS.Art.drawItemIcon 的形状由
 *   **mods 的数值通道族**(IFAM 20 族)决定, 与道具名毫无关系 —— 于是「走失小鸭」被画成一个罐子。
 *   121 件可售道具里有 **354 对**的剪影像素余弦相似度 = 1.000(同族只换颜色), 即 121 件其实
 *   只有约 20 个形状。用户原话:「道具建模和道具名称完全不关联」「每次生成的我的不满意」。
 *
 * 本层规矩(美术纪律与 weapons/enemies 同一套):
 *   1) 一件道具 = 一个专属画师函数, 画的必须是**它名字里的那个物件**(小鸭画鸭子, 陶罐画罐子);
 *   2) 平涂实色 + INK 描边 + 至多 1 处浅色高光; **零发光、零径向渐变、零滤镜**;
 *      描边的 INK 底衬宽度见 INK_PAD —— 它不是审美偏好, 是**可读性硬约束**(见那里的注释);
 *   3) 画布固定 52 逻辑单位(IIW), 主体必须落在 ±20 内 —— 超出会被相邻卡片压住;
 *   4) 每枚图标烘焙 1 次, 热路径只 1 次 drawImage、零 path(bake 倍率 2x, 落图按 dpr 缩);
 *   5) 品阶只额外画一枚右上角**角标**(形状+颜色都随品阶变), 不进烘焙 key。
 *
 * 契约(两个画师文件 items-a.js / items-b.js 依赖):
 *     PS.ItemArt.reg(id, function (x, P, T) { ... })   // 注册一件道具的画师
 *     id  = 道具 id(与 PS.ItemData.list 的 key 逐字相同, 数字型的也要用字符串)
 *     x   = 已经 translate 到画布中心、scale=1 的 2D 上下文(直接按逻辑单位画)
 *     P   = 该件道具的调色板 {main, dark, light, ink} (取自 def.color, 会做可读性校正)
 *     T   = 工具集(见下)
 *   没注册的道具会**回退**到 art.js 的旧造型族并在 PS.ItemArt.missing() 里列出。
 *
 * 验收: qa/verify-item-icon.cjs —— ① 每件可售道具都有专属画师(不得回退)
 *       ② 任意两件道具的剪影不得近似(阈值 0.985) ③ 不透明像素亮度/覆盖率达标(暗底下看得清)
 */
(function (global) {
  'use strict';
  var PS = global.PS || (global.PS = {});
  var A = (PS.ItemArt = PS.ItemArt || {});
  var IIW = 52;                     /* 烘焙画布边长(逻辑单位) */
  var HALF = 20;                    /* 主体允许半径 */
  A.IIW = IIW; A.HALF = HALF;

  /* ============================ 工具集 ============================ */
  var INK = '#0b0f0b';
  var WSHINE = '#f2f6ef';

  function hex2rgb(c) {
    var s = ('' + c).replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var n = parseInt(s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgb2hex(r, g, b) {
    var f = function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); };
    return '#' + f(r) + f(g) + f(b);
  }
  function shade(c, amt) {                             /* amt > 0 提亮, < 0 压暗 */
    var p = hex2rgb(c);
    if (amt >= 0) return rgb2hex(p[0] + (255 - p[0]) * amt, p[1] + (255 - p[1]) * amt, p[2] + (255 - p[2]) * amt);
    return rgb2hex(p[0] * (1 + amt), p[1] * (1 + amt), p[2] * (1 + amt));
  }
  function mix(a, b, t) {
    var p = hex2rgb(a), q = hex2rgb(b);
    return rgb2hex(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t);
  }
  function lumOf(c) { var p = hex2rgb(c); return (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255; }
  function satOf(c) { var p = hex2rgb(c), mx = Math.max(p[0], p[1], p[2]), mn = Math.min(p[0], p[1], p[2]); return mx ? (mx - mn) / mx : 0; }

  /** 道具的调色板: 用 def.color 当身份色, 但把它夹进可读窄带 —— 太暗的提亮, 太亮的压暗,
   *  饱和度不足的抬饱和。图标必须比商店卡底(#141a14 一档)明显亮。 */
  function palette(color) {
    var main = color || '#c2a86a';
    var s = satOf(main);
    if (s > 0 && s < 0.35) main = shade(mix(main, '#d8c27a', 0.45), 0.06);
    var l = lumOf(main);
    if (l < 0.42) main = shade(main, (0.42 - l) * 0.9);
    else if (l > 0.62) main = shade(main, -(l - 0.62) * 0.7);
    l = lumOf(main);
    return { main: main, dark: shade(main, -0.32), light: shade(main, 0.42), ink: INK, mid: shade(main, -0.12) };
  }
  A.palette = palette;

  function polyPath(x, pts) {
    x.beginPath();
    x.moveTo(pts[0], pts[1]);
    for (var i = 2; i < pts.length; i += 2) x.lineTo(pts[i], pts[i + 1]);
    x.closePath();
  }
  /** 实心造型(带 INK 描边) —— 全层唯一的"面"画法 */
  function shape(x, pathFn, col, lw) {
    x.beginPath(); pathFn(x);
    x.fillStyle = col; x.fill();
    x.lineWidth = lw || 2.2; x.strokeStyle = INK; x.stroke();
  }
  function poly(x, pts, col, lw) { shape(x, function (c) { polyPath(c, pts); }, col, lw); }
  function circle(x, cx, cy, r, col, lw) { shape(x, function (c) { c.arc(cx, cy, r, 0, Math.PI * 2); }, col, lw); }
  function ell(x, cx, cy, rx, ry, col, lw, rot) { shape(x, function (c) { c.ellipse(cx, cy, rx, ry, rot || 0, 0, Math.PI * 2); }, col, lw); }
  /* INK 底衬的**单侧**外扩量(逻辑单位)。
   * 事实(2026-09-24, 由两个画师文件各自独立实测收敛到同一个数): 画布 52 逻辑单位、图标最终落到
   *   ~22~26px 时, 描边是按**线宽**画的、不随缩放变细 —— 底衬 +2.4 会让 INK 的**像素面积超过填色本身**
   *   (实测第一版 61 件里有 30 件的不透明像素 40%~70% 是 INK), 于是"图标发暗、看不清",
   *   直接被 qa/verify-item-icon.cjs 的"不透明像素平均亮度 >= 0.32"挡下。
   * 1.1 是实测把最低亮度从 0.195 抬到 0.350 的那个值; 两个画师文件当时各自抄了一份同样的补丁
   *   (这就是它必须收回本层的原因 —— 工具集的默认值错了, 画师只能绕过它)。 */
  var INK_PAD = 1.1;
  function line(x, x1, y1, x2, y2, w, col) {
    x.lineCap = 'round';
    x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2);
    x.lineWidth = (w || 3) + INK_PAD; x.strokeStyle = INK; x.stroke();
    x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2);
    x.lineWidth = w || 3; x.strokeStyle = col; x.stroke();
  }
  /** 弧线(提梁 / 手环 / 蒸汽 / 反击弧) —— 与 line 同一套 INK 底衬宽度 */
  function arc(x, cx, cy, r, a0, a1, w, col) {
    w = w || 3;
    x.lineCap = 'round';
    x.beginPath(); x.arc(cx, cy, r, a0, a1); x.lineWidth = w + INK_PAD; x.strokeStyle = INK; x.stroke();
    x.beginPath(); x.arc(cx, cy, r, a0, a1); x.lineWidth = w; x.strokeStyle = col; x.stroke();
  }
  /** 锥形肢体(从 (x1,y1) 粗 w1 收到 (x2,y2) 粗 w2) —— 枝条/手臂/腿 */
  function limb(x, x1, y1, x2, y2, w1, w2, col) {
    var dx = x2 - x1, dy = y2 - y1, L = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / L, ny = dx / L;
    poly(x, [x1 + nx * w1, y1 + ny * w1, x2 + nx * w2, y2 + ny * w2, x2 - nx * w2, y2 - ny * w2, x1 - nx * w1, y1 - ny * w1], col, INK_PAD);
  }
  function eye(x, cx, cy, r) { circle(x, cx, cy, r || 2.2, INK, 0.9); }
  function shadowUnder(x, cy, rx) { /* 底座投影: 让物件"站住" */ ell(x, 0, cy, rx, rx * 0.28, 'rgba(0,0,0,0.30)', 0); }
  function hl(x, pts, col, a) {                       /* 浅色高光块(不描边) */
    x.save(); x.globalAlpha = a == null ? 0.5 : a;
    polyPath(x, pts); x.fillStyle = col || WSHINE; x.fill(); x.restore();
  }
  var T = A.T = {
    INK: INK, WSHINE: WSHINE, shade: shade, mix: mix, lum: lumOf, sat: satOf,
    shape: shape, poly: poly, circle: circle, ell: ell, line: line, limb: limb, arc: arc,
    INK_PAD: INK_PAD,
    eye: eye, hl: hl, shadow: shadowUnder, polyPath: polyPath, palette: palette
  };

  /* ============================ 画师注册表 ============================ */
  var PAINT = {};
  A.reg = function (id, fn) { PAINT['' + id] = fn; };
  A.regMany = function (map) { for (var k in map) A.reg(k, map[k]); };
  A.has = function (id) { return typeof PAINT['' + id] === 'function'; };
  A.count = function () { return Object.keys(PAINT).length; };
  /** 哪些道具还没画师(门禁与自查用) */
  A.missing = function () {
    /* list 是**数组**(不是对象): 真实 id 在 def.id(如 alien_tongue), 与 D.byId / poolByRarity 同一口径。 */
    var out = [], L = (PS.ItemData && PS.ItemData.list) || [], i, d;
    for (i = 0; i < L.length; i++) { d = L[i]; if (d && d.pool !== false && !A.has(d.id)) out.push(d.id); }
    return out;
  };

  /* ============================ 烘焙缓存 ============================ */
  var CACHE = {}, CACHE_N = 0, CAP = 200, BAKE = 2;
  function newCanvas(w, h) {
    if (typeof document !== 'undefined' && document.createElement) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
    if (global.PS && PS.Platform && PS.Platform.createCanvas) return PS.Platform.createCanvas(w, h);
    return null;
  }
  function bake(id, fn, P) {
    var cv = newCanvas(IIW * BAKE, IIW * BAKE);
    if (!cv || !cv.getContext) return null;
    var c = cv.getContext('2d');
    c.save();
    c.translate(IIW * BAKE / 2, IIW * BAKE / 2);
    c.scale(BAKE, BAKE);
    try { fn(c, P, T); } catch (e) { c.restore(); return null; }
    c.restore();
    return cv;
  }
  A.debugLastErr = null;
  function ensure(id, def) {
    var key = 'ia:' + id;
    if (CACHE[key]) return CACHE[key];
    var P = palette(def.color);
    var img = bake(id, PAINT[id], P);
    if (!img) { A.debugLastErr = '烘焙失败: ' + id; return null; }
    if (CACHE_N >= CAP) { CACHE = {}; CACHE_N = 0; }        /* 简单整体回收: 图标总量 131 < CAP, 不会抖动(121 → 128 = G1 重新上架 7 件; 128 → 131 = G2 放行 3 件) */
    CACHE[key] = img; CACHE_N++;
    return img;
  }
  A.stats = function () { return { painters: A.count(), cached: CACHE_N, cap: CAP, bake: BAKE, lastErr: A.debugLastErr }; };

  /* ============================ 品阶角标 ============================ */
  var TRIM = ['#8fb28f', '#79c0d8', '#e0a24a', '#e0687a'];
  function badge(x, cx, cy, s, rar) {
    var col = TRIM[Math.max(1, Math.min(4, rar || 1)) - 1];
    var r = Math.max(1.6, s * 0.16);
    if (rar >= 4) {                                   /* 五角星 */
      var pts = [];
      for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, rr = (i % 2 ? r * 0.46 : r * 1.15); pts.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
      poly(x, pts, col, Math.max(0.9, s * 0.05));
    } else if (rar === 3) {                           /* 三角 */
      poly(x, [cx, cy - r * 1.05, cx + r, cy + r * 0.8, cx - r, cy + r * 0.8], col, Math.max(0.9, s * 0.05));
    } else if (rar === 2) {                           /* 菱形 */
      poly(x, [cx, cy - r, cx + r * 0.86, cy, cx, cy + r, cx - r * 0.86, cy], col, Math.max(0.9, s * 0.05));
    } else {                                          /* 圆 */
      circle(x, cx, cy, r * 0.82, col, Math.max(0.9, s * 0.05));
    }
  }

  /* ============================ 对外入口 ============================ */
  /** art.js 的原实现(经 PS.Sprites → PS.Atlas 的烘焙钩子: 命中位图就用位图, 没位图才程序化)。
   *  由下面的 override 记下来 —— 位图优先那条路要复用它, 不再抄一份落图逻辑。 */
  A.baseIcon = null;
  /** 这件道具在图集里有没有位图?(有 → 让位给 baseIcon, 本层的专属画师当兜底) */
  A.serves = function (def) {
    if (!def || !PS.Atlas || !PS.Atlas.canServe) return false;
    return !!PS.Atlas.canServe('i2:' + (def.src || def.id || 'x'));
  };
  /** 作废本层自己的程序化缓存(图集就绪后由 PS.Atlas 的 ready 钩子调用) */
  A.dropCache = function () { CACHE = {}; CACHE_N = 0; };

  /** 与 PS.Art.drawItemIcon 同签名。返回 true = 真的画了(调用方据此决定是否再画兜底)。 */
  A.render = function (ctx, def, cx, cy, size, opts) {
    if (!ctx || !def) return false;
    /* 身份键 = def.id(与 PS.ItemData.byId / poolByRarity 同口径, 如 alien_tongue)。
     * 注意 list 里的**下标**(0,2,3...)不是 id —— 曾经踩过这个坑。 */
    var id = def.id != null ? def.id : def.key;
    if (id == null || !A.has(id)) return false;
    /* 位图优先(2026-09-28 事故): 图集里若有这件道具的图, 走 art.js 的原实现 —— 那条路经
     * PS.Sprites 命中 PS.Atlas 的烘焙钩子, 真的用位图。**不接这一步的话, 图集里的道具图
     * 永远不会被取用**(本层走自己的 ensure 缓存, 根本不过 PS.Sprites), 于是"图打包了但游戏里
     * 看不到"。与 09-28 那次"帧表没被真实入口加载"是同一类缺陷, 已在 tools/gate-atlas-coverage.cjs
     * 里加了"图集里的每一项都必须能在真实入口下被取到"的守门。 */
    if (A.baseIcon && A.serves(def)) return A.baseIcon.call(PS.Art, ctx, def, cx, cy, size, opts) === true;
    var img = ensure('' + id, def);
    var sz = Math.max(6, size || 20), sc = sz / HALF;
    if (!img) {                                     /* 无画布工厂: 直接现画(不崩) */
      ctx.save(); ctx.translate(cx, cy); ctx.scale(sc, sc);
      try { PAINT['' + id](ctx, palette(def.color), T); } catch (e) { ctx.restore(); return false; }
      ctx.restore();
    } else {
      var d = IIW * sc;
      ctx.drawImage(img, cx - d / 2, cy - d / 2, d, d);
    }
    badge(ctx, cx + sz * 0.64, cy - sz * 0.64, sz, (opts && opts.rarity) || def.rarity || 1);
    return true;
  };
  A.override = function () {
    if (!PS.Art) return false;
    var old = PS.Art.drawItemIcon;
    A.baseIcon = old;
    /* 图集可能比本层晚就绪: 就绪时先把本层缓存作废, 否则早已手绘过的图标会一直停在手绘版 */
    if (PS.Atlas && PS.Atlas.addReadyHook) PS.Atlas.addReadyHook(A.dropCache);
    PS.Art.drawItemIcon = function (ctx, def, cx, cy, size, opts) {
      if (A.render(ctx, def, cx, cy, size, opts)) return true;
      return old ? old.apply(this, arguments) : false;
    };
    PS.Art.drawItemIcon.__itemart = true;
    return true;
  };
  A.override();
})(typeof window !== 'undefined' ? window : (typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis));
