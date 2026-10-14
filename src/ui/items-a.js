/* PS.ItemArt 画师 A 组(道具 0..60) — 见 src/ui/itemart.js 契约头注释
 * 61 件道具各一个专属画师: 画的必须是名字里的那个物件(走失小鸭就画小鸭), 颜色全部走 P.main/dark/light/mid。
 * 唯一写权: PS.ItemArt.regMany —— 画法只用 itemart.js 提供的工具集, 本文件不另造美术层。
 */
(function (global) {
  'use strict';
  var PS = global.PS || (global.PS = {});
  var IA = PS.ItemArt;
  if (!IA || !IA.T) return;
  var T = IA.T, INK = T.INK;
  var shape = T.shape, poly = T.poly, circle = T.circle, ell = T.ell,
      line = T.line, limb = T.limb, eye = T.eye, hl = T.hl, shadow = T.shadow;

  /* ========================= 本地小工具(只服务本文件) ========================= */
  function sym(x, pts, col, lw) {                  /* 画一份 + 沿 x=0 镜像再画一份 */
    poly(x, pts, col, lw);
    var m = [], i;
    for (i = 0; i < pts.length; i += 2) m.push(-pts[i], pts[i + 1]);
    poly(x, m, col, lw);
  }
  function smooth(x, pts, col, lw) {               /* 过点光滑闭合块(有机造型) */
    var n = pts.length / 2;
    shape(x, function (c) {
      c.moveTo((pts[0] + pts[2]) / 2, (pts[1] + pts[3]) / 2);
      for (var i = 0; i < n; i++) {
        var bx = pts[2 * ((i + 1) % n)], by = pts[2 * ((i + 1) % n) + 1];
        var ux = pts[2 * ((i + 2) % n)], uy = pts[2 * ((i + 2) % n) + 1];
        c.quadraticCurveTo(bx, by, (bx + ux) / 2, (by + uy) / 2);
      }
      c.closePath();
    }, col, lw);
  }
  function rect(x, cx, cy, w, h, col, lw) {
    poly(x, [cx - w / 2, cy - h / 2, cx + w / 2, cy - h / 2, cx + w / 2, cy + h / 2, cx - w / 2, cy + h / 2], col, lw);
  }
  function rrect(x, cx, cy, w, h, r, col, lw) {     /* 圆角矩形骨架 */
    var a = w / 2, b = h / 2;
    r = Math.min(r, a, b);
    shape(x, function (c) {
      c.moveTo(cx - a + r, cy - b);
      c.lineTo(cx + a - r, cy - b); c.quadraticCurveTo(cx + a, cy - b, cx + a, cy - b + r);
      c.lineTo(cx + a, cy + b - r); c.quadraticCurveTo(cx + a, cy + b, cx + a - r, cy + b);
      c.lineTo(cx - a + r, cy + b); c.quadraticCurveTo(cx - a, cy + b, cx - a, cy + b - r);
      c.lineTo(cx - a, cy - b + r); c.quadraticCurveTo(cx - a, cy - b, cx - a + r, cy - b);
      c.closePath();
    }, col, lw);
  }
  function dome(x, cx, cy, rx, ry, col, lw) {       /* 上半椭圆壳(帽/菌盖/壳) */
    shape(x, function (c) { c.ellipse(cx, cy, rx, ry, 0, Math.PI, Math.PI * 2); c.closePath(); }, col, lw);
  }
  /* 小图标上 INK 描边占的面积会压过填色(实测 40%~70%, 亮度就不够)—— 本组统一收细:
   * 面 1.55 / 细节 1.1 / 线的 INK 底衬只外扩 1.3(工具集的 +2.4 太肥)。 */
  function ARC(x, cx, cy, r, a0, a1, w, col) {     /* 弧线(提梁/手环/蒸汽/反击弧) */
    x.lineCap = 'round';
    x.beginPath(); x.arc(cx, cy, r, a0, a1); x.lineWidth = (w || 3) + 1.1; x.strokeStyle = INK; x.stroke();
    x.beginPath(); x.arc(cx, cy, r, a0, a1); x.lineWidth = w || 3; x.strokeStyle = col; x.stroke();
  }
  function LN(x, x1, y1, x2, y2, w, col) {         /* 直线(细 INK 底衬) */
    x.lineCap = 'round';
    x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2);
    x.lineWidth = (w || 3) + 1.1; x.strokeStyle = INK; x.stroke();
    x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2);
    x.lineWidth = w || 3; x.strokeStyle = col; x.stroke();
  }
  function LMB(x, x1, y1, x2, y2, w1, w2, col) {   /* 锥形肢体(描边 1.1) */
    var dx = x2 - x1, dy = y2 - y1, L = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / L, ny = dx / L;
    poly(x, [x1 + nx * w1, y1 + ny * w1, x2 + nx * w2, y2 + ny * w2, x2 - nx * w2, y2 - ny * w2, x1 - nx * w1, y1 - ny * w1], col, 1.0);
  }
  function rot(x, cx, cy, a, fn) { x.save(); x.translate(cx, cy); x.rotate(a); fn(); x.restore(); }
  function star(x, cx, cy, rIn, rOut, col, lw) {    /* 五角星 */
    var p = [], i;
    for (i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5, rr = (i % 2) ? rIn : rOut;
      p.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    poly(x, p, col, lw);
  }

  /* =============================== 画师表 =============================== */
  IA.regMany({
    /* 0 卷舌苗: 土堆上冒苗, 一条长舌卷回来 */
    'alien_tongue': function (x, P) {
      poly(x, [-13, 18, 13, 18, 9, 12, -9, 12], P.dark, 1.15);
      LMB(x, 0, 13, -1, -2, 3.6, 3.0, P.main);
      sym(x, [-2, -4, -12.5, -8.5, -9, -1, -2, 1], P.main, 0.9);
      LMB(x, -1, -2, 9, -9, 4.4, 3.4, P.main);
      LMB(x, 9, -9, 4, -17, 3.4, 2.4, P.main);
      LMB(x, 4, -17, -5, -14, 2.4, 1.5, P.main);
      circle(x, -6.5, -14, 2, P.main, 0.9);
      hl(x, [-1, -5, 5, -8, 5, -12, -1, -9], P.light, 0.45);
    },
    /* 1 夜蝠藤: 藤枝挂叶 + 展翅的夜蝠 */
    'bat': function (x, P) {
      LMB(x, -19, -17, -6, -11, 2.4, 2.0, P.main);
      ell(x, -15, -19, 5, 2.8, P.main, 0.9, 0.45);
      sym(x, [5, -2, 18, -8, 15, -1, 17, 4, 6, 7], P.main, 1.5);
      ell(x, 0, 1, 6, 8.5, P.main, 1.5);
      sym(x, [1, -8, 4, -7, 6.5, -13], P.main, 0.9);
      eye(x, -2, -3, 1.05); eye(x, 2, -3, 1.05);
      hl(x, [-4, -5, 0, -6, 0, 3, -4, 3], P.light, 0.45);
    },
    /* 2 毛线兜帽: 圆顶 + 厚翻边 + 顶球 + 织纹 */
    'beanie': function (x, P) {
      dome(x, 0, 5, 15, 14, P.main, 1.55);
      LN(x, -5, 4, -3, -5, 1.6, P.mid);
      LN(x, 5, 4, 3, -5, 1.6, P.mid);
      rrect(x, 0, 8, 31, 7, 2.5, P.main, 1.55);
      circle(x, 0, -12, 4.6, P.main, 1.55);
      hl(x, [-11, 2, -6, 3, -5, -3, -10, -4], P.light, 0.45);
    },
    /* 3 滚水壶: 圆壶身 + 上翘壶嘴 + 提梁 + 蒸汽 */
    'boiling_water': function (x, P) {
      ARC(x, 0, 0, 9, Math.PI * 1.08, Math.PI * 1.92, 3, P.dark);
      LMB(x, -11, -3, -18, -10, 3.6, 1.8, P.main);
      ell(x, 0, 5, 13, 11, P.main, 1.55);
      rect(x, 0, -5, 15, 5, P.main, 1.55);
      circle(x, 0, -8, 3.2, P.main, 1.4);
      ARC(x, 8, -15, 3.4, Math.PI * 1.1, Math.PI * 1.9, 1.6, P.dark);
      ARC(x, -7, -16, 2.6, Math.PI * 1.1, Math.PI * 1.9, 1.6, P.dark);
      hl(x, [-8, 0, -4, -1, -3, 6, -7, 7], P.light, 0.45);
    },
    /* 4 农书残页: 竖页 + 撕口下缘 + 书脊 + 夹着的苗 */
    'book': function (x, P) {
      poly(x, [-12, -14, 12, -15, 13, 9, 10, 15, 6, 10, 2, 15, -2, 10, -6, 15, -10, 10, -13, 14], P.main, 1.55);
      poly(x, [-12, -14, -6, -14.5, -5, 13, -11, 14], P.dark, 1.35);
      LN(x, -3, -6, 7, -7, 1.6, P.mid);
      LN(x, -3, -1, 8, -2, 1.6, P.mid);
      LN(x, -5, 4, 2, 3.5, 1.6, P.mid);
      ell(x, 7, 6, 4.5, 2.6, P.light, 0.9, -0.35);
    },
    /* 5 拳套: 大圆拳面 + 拇指 + 护腕 */
    'boxing_glove': function (x, P) {
      rrect(x, 4, 11, 15, 12, 3, P.dark, 1.55);
      rrect(x, -1, -1, 26, 21, 10, P.main, 1.55);
      ell(x, -11, 3, 6.5, 5.5, P.main, 1.4, -0.35);
      LN(x, 3, 8, 4, 16, 1.6, P.mid);
      hl(x, [-8, -9, 4, -10, 5, -6, -9, -5], P.light, 0.45);
    },
    /* 6 豁口陶罐: 罐口崩了一块 + 裂纹 */
    'broken_mouth': function (x, P) {
      shadow(x, 16, 12);
      poly(x, [-9, -13, -3, -13.5, 0.5, -9.5, 4, -13.5, 9, -13, 8, -8, -8, -8], P.main, 1.55);
      ell(x, 0, 4, 13, 12, P.main, 1.55);
      LN(x, 4, 1, 7, 8, 1.8, P.dark);
      LN(x, 7, 8, 3, 12, 1.8, P.dark);
      poly(x, [-8, 16, 8, 16, 10, 11, -10, 11], P.dark, 1.35);
      hl(x, [-9, 0, -5, -2, -4, 6, -8, 7], P.light, 0.4);
    },
    /* 7 菜粉蝶: 四片翅 + 细身 + 触角 */
    'butterfly': function (x, P) {
      sym(x, [-3, -1, -16.5, -14, -19, -4, -12, 3, -3, 5], P.main, 1.45);
      sym(x, [-3, 4, -15.5, 7, -12, 15, -4, 11], P.light, 1.45);
      ell(x, 0, 3, 3, 10.5, P.dark, 1.2);
      LN(x, -1, -7, -7, -16, 1.0, P.ink);
      LN(x, 1, -7, 7, -16, 1.0, P.ink);
      eye(x, -11.5, -5, 1.8); eye(x, 11.5, -5, 1.8);
    },
    /* 8 胡萝卜糕: 方块糕 + 糖霜层 + 顶上插的胡萝卜 */
    'cake': function (x, P) {
      shadow(x, 15, 13);
      rrect(x, 0, 7, 27, 15, 2.5, P.main, 1.55);
      rect(x, 0, -3.5, 27, 6, P.light, 1.35);
      poly(x, [-5, -6, 4.5, -6, 1, -13.5, -2.5, -14.5], P.dark, 1.2);
      ell(x, -5, -15, 4, 2.6, P.main, 0.9, -0.55);
      ell(x, 4.5, -15, 4, 2.6, P.main, 0.9, 0.55);
      LN(x, -9, 11, 9, 11, 1.2, P.mid);
    },
    /* 9 炭渣: 三块棱角炭 */
    'charcoal': function (x, P) {
      shadow(x, 15, 13);
      poly(x, [-18, 8, -14, -6, -2, -8, 2, 1, -3, 12], P.main, 1.55);
      poly(x, [1, 3, 10, -6, 18, 1, 16, 9, 6, 13], P.main, 1.55);
      poly(x, [-9, -5, 0, -15, 8, -9, -1, -2], P.dark, 1.1);
      hl(x, [-3, -6, 2, -12, 6, -9, 0, -4], P.light, 0.4);
    },
    /* 10 钩爪枝: 斜枝 + 三根弯钩爪 */
    'claw_tree': function (x, P) {
      LMB(x, -17, 15, 5, -5, 6.5, 4.5, P.main);
      LMB(x, -7, 5, -14, 0, 2.2, 1.4, P.dark);
      LMB(x, 5, -5, -2, -14, 4.2, 2.4, P.main);
      LMB(x, -2, -14, -8, -11, 2.4, 1.4, P.main);
      LMB(x, 5, -5, 10, -14, 4.2, 2.4, P.main);
      LMB(x, 10, -14, 16, -11, 2.4, 1.4, P.main);
      LMB(x, 5, -5, 15, -3, 4.2, 2.4, P.main);
      LMB(x, 15, -3, 13, 4, 2.4, 1.4, P.main);
      hl(x, [-12, 10, -5, 2, -4, -1, -11, 6], P.light, 0.35);
    },
    /* 11 浓煮豆汁: 锥形杯 + 杯把 + 热气 + 一颗豆 */
    'coffee': function (x, P) {
      ARC(x, 11, 4, 6, -1.15, 1.15, 3.2, P.main);
      ARC(x, -4, -12, 3.6, Math.PI * 1.15, Math.PI * 1.85, 1.6, P.dark);
      ARC(x, 3, -14, 3, Math.PI * 1.15, Math.PI * 1.85, 1.6, P.dark);
      poly(x, [-11, -6, 11, -6, 9, 15, -9, 15], P.main, 1.55);
      rect(x, 0, -6, 23, 4, P.dark, 1.4);
      circle(x, -14, 13, 3.2, P.dark, 1.35);
      LN(x, -16, 11, -12, 15, 1.2, P.ink);
      hl(x, [-7, -3, -3, -3, -4, 8, -8, 8], P.light, 0.45);
    },
    /* 12 菜场劵: 横票 + 锯齿边 + 副券 + 打孔 */
    'coupon': function (x, P) {
      rot(x, 0, 0, -0.12, function () {
        poly(x, [-14, -8, -17, -5, -14, -2, -17, 1, -14, 4, -17, 7, -14, 9, 14, 9, 15, -8], P.main, 1.55);
        rect(x, 8, 0.5, 7, 17, P.dark, 1.35);
        LN(x, -3, -6, -3, -3, 1.4, P.ink);
        LN(x, -3, -1, -3, 2, 1.4, P.ink);
        LN(x, -3, 4, -3, 7, 1.4, P.ink);
        circle(x, -8, 2, 2.2, P.ink, 1.05);
        hl(x, [-7, -6, 3, -6.5, 3, -3, -7, -2.5], P.light, 0.4);
      });
    },
    /* 13 劣质营养剂: 玻璃瓶 + 崩角瓶盖 + 裂纹 */
    'defective_steroids': function (x, P) {
      shadow(x, 16, 9);
      rrect(x, 0, 5, 15, 22, 3.5, P.main, 1.55);
      rect(x, 0, -6, 7, 7, P.main, 1.55);
      rect(x, 0, -11, 10, 5, P.dark, 1.4);
      poly(x, [1, -13.5, 5, -10.6, 1.4, -10.6], P.ink, 0.85);
      LN(x, -3, 1, 2, 6, 1.5, P.ink);
      LN(x, 2, 6, -1, 10, 1.5, P.ink);
      hl(x, [-4.5, 1, -1.5, 0, -1.5, 11, -4.5, 11], P.light, 0.45);
    },
    /* 14 胶布卷: 粗环 + 中孔 + 撕开的胶带 */
    'duct_tape': function (x, P) {
      poly(x, [9, -6, 16, -12, 18, -4, 11, -1], P.main, 1.55);
      circle(x, 0, 2, 14, P.main, 1.55);
      circle(x, 0, 2, 6, P.ink, 1.25);
      ARC(x, 0, 2, 10, Math.PI * 1.05, Math.PI * 1.5, 1.4, P.mid);
      hl(x, [-12, -4, -7, -10, -2, -7, -8, -1], P.light, 0.45);
    },
    /* 15 陈年肥: 扎口麻袋 + 两片袋耳 + 撒出来的肥 */
    'fertilizer': function (x, P) {
      shadow(x, 17, 13);
      poly(x, [-5, -11, -1, -19, 1, -12], P.main, 1.4);
      poly(x, [0, -12, 4, -18, 5, -11], P.main, 1.4);
      rrect(x, 0, 6, 27, 22, 6, P.main, 1.55);
      poly(x, [-7, -4, 7, -4, 5, -12, -5, -12], P.dark, 1.4);
      LN(x, -8, -4, 8, -4, 2.2, P.ink);
      circle(x, 13, 15, 3.2, P.dark, 1.25);
      hl(x, [-10, 0, -4, -2, -3, 8, -9, 9], P.light, 0.4);
    },
    /* 16 鲜肉片: 不规则肉块 + 骨头 + 肌理 */
    'fresh_meat': function (x, P) {
      smooth(x, [-15, -3, -9, -11, 3, -13, 12, -8, 15, 1, 9, 10, -2, 12, -12, 7], P.main, 1.55);
      poly(x, [7, -7, 15, -11, 16, -4, 9, -1], P.main, 1.55);
      circle(x, 14, -7, 4.5, P.light, 1.55);
      LMB(x, -9, 1, 4, 5, 2.2, 1.4, P.dark);
      LMB(x, -6, 6, 6, -3, 2.0, 1.4, P.dark);
    },
    /* 17 老花镜: 双圆镜圈 + 鼻梁 + 镜腿 */
    'glasses': function (x, P) {
      LMB(x, -14, 0, -18, -5, 2.6, 1.8, P.main);
      LMB(x, 14, 0, 18, -5, 2.6, 1.8, P.main);
      LN(x, -1, 1, 1, 1, 2.4, P.main);
      ARC(x, -8, 1, 7, 0, Math.PI * 2, 3.6, P.main);
      ARC(x, 8, 1, 7, 0, Math.PI * 2, 3.6, P.main);
      hl(x, [-11, -4, -7, -7, -4, -4, -8, -1], P.light, 0.45);
    },
    /* 18 羊头骨: 弯角 + 颅骨 + 吻部 + 眼窝 */
    'goat_skull': function (x, P) {
      LMB(x, -7, -7, -16, -12, 4.2, 2.6, P.main);
      LMB(x, -16, -12, -12, -18, 2.6, 1.2, P.main);
      LMB(x, 7, -7, 16, -12, 4.2, 2.6, P.main);
      LMB(x, 16, -12, 12, -18, 2.6, 1.2, P.main);
      ell(x, 0, -3, 10.5, 9, P.main, 1.55);
      poly(x, [-6, 3, 6, 3, 4, 16, -4, 16], P.main, 1.55);
      eye(x, -4.5, -2, 2.6); eye(x, 4.5, -2, 2.6);
      eye(x, -2, 12, 0.95); eye(x, 2, 12, 0.95);
      LN(x, -3.5, 8, 3.5, 8, 1.6, P.dark);
    },
    /* 19 软糖狂徒: 圆头圆耳 + 举起的胳膊 */
    'gummy_berserker': function (x, P) {
      LMB(x, -8, -3, -16, -10, 4.4, 3.2, P.main);
      LMB(x, 8, -3, 16, -10, 4.4, 3.2, P.main);
      rrect(x, 0, 6, 20, 19, 8, P.main, 1.55);
      sym(x, [3.5, -13, 9.5, -13, 6.5, -17], P.main, 1.4);
      circle(x, 0, -8, 8.5, P.main, 1.55);
      eye(x, -3, -9, 0.95); eye(x, 3, -9, 0.95);
      LN(x, -2.5, -5, 2.5, -5, 1.6, P.ink);
      hl(x, [-8, 2, -3, 1, -3, 10, -8, 10], P.light, 0.4);
    },
    /* 20 脑门旧伤: 侧脸 + 缠额绷带 + 旧伤 */
    'head_injury': function (x, P) {
      poly(x, [-12, -2, -16, 3, -11, 5], P.main, 1.4);
      circle(x, 0, 1, 12.5, P.main, 1.55);
      rot(x, 0, -5, -0.22, function () { rrect(x, 0, 0, 29, 8, 2.5, P.light, 1.55); });
      LN(x, -6, -12, -2, -10, 1.4, P.dark);
      eye(x, -6, 3, 1.35);
      LN(x, 2, 8, 8, 7, 1.8, P.ink);
    },
    /* 21 刺猬: 锯齿刺背 + 尖吻 + 短脚 */
    'hedgehog': function (x, P) {
      shadow(x, 16, 13);
      poly(x, [-13, 1, -11, -6, -7, -4, -6, -11, -2, -8, 1, -13, 4, -7, 8, -11, 10, -4, 14, -6, 14, 2], P.main, 1.55);
      ell(x, 0, 6, 13, 8.5, P.main, 1.55);
      poly(x, [-12, 3, -19, 6.5, -12, 9], P.main, 1.4);
      eye(x, -19, 6.5, 0.95);
      eye(x, -8, 2, 1.9);
      hl(x, [-6, -2, 0, -4, 3, 0, -3, 3], P.light, 0.35);
    },
    /* 22 铁皮帽: 半圆壳 + 中脊 + 宽帽檐 + 铆钉 */
    'helmet': function (x, P) {
      dome(x, 0, 5, 15, 14, P.main, 1.55);
      LN(x, 0, -8.5, 0, 5, 2, P.dark);
      ell(x, 0, 6, 19.5, 5, P.main, 1.55);
      eye(x, -12, 5, 1.35); eye(x, 12, 5, 1.35);
      hl(x, [-11, 1, -5, 0, -4, -6, -10, -3], P.light, 0.45);
    },
    /* 23 针剂: 斜置针筒 + 推杆 + 长针 + 药液 */
    'injection': function (x, P) {
      rot(x, 0, 2, -0.62, function () {
        rect(x, 0, -15.5, 17, 4.5, P.main, 1.2);
        rect(x, 0, -10, 6, 8, P.dark, 1.1);
        rrect(x, 0, 1.5, 15, 21, 2.5, P.main, 1.55);
        rect(x, 0, 3, 12, 15, P.light, 0.6);
        LMB(x, 0, 12, 0, 19.5, 2.4, 1.0, P.dark);
        LN(x, -6, -4, 6, -4, 1.0, P.ink);
      });
    },
    /* 24 疯长剂: 圆底锥形瓶 + 木塞 + 冒出来的两片叶 */
    'insanity': function (x, P) {
      ell(x, -8, -15, 5.5, 3, P.main, 0.9, -0.45);
      ell(x, 8, -15, 5.5, 3, P.main, 0.9, 0.45);
      rect(x, 0, -9, 13, 6, P.dark, 1.4);
      shape(x, function (c) {
        c.moveTo(-5.5, -6); c.lineTo(5.5, -6); c.lineTo(14, 10);
        c.quadraticCurveTo(9, 16, 0, 16); c.quadraticCurveTo(-9, 16, -14, 10);
        c.closePath();
      }, P.main, 1.55);
      eye(x, -4, 4, 1.55); eye(x, 3, 8, 1.35);
      hl(x, [-8, -2, -4, -2, -6, 9, -10, 9], P.light, 0.4);
    },
    /* 25 单片镜: 单镜圈 + 挂链垂珠 */
    'lens': function (x, P) {
      ARC(x, -1, 1, 12.5, 0, Math.PI * 2, 4.8, P.main);
      circle(x, 11, -8, 2.6, P.dark, 1.25);
      ARC(x, 8, 6, 2.8, -0.5, 1.2, 1.8, P.dark);
      circle(x, 12, 12, 2.4, P.main, 1.25);
      circle(x, 10, 17, 2.2, P.main, 1.25);
      hl(x, [-9, -4, -3, -9, 2, -6, -4, -1], P.light, 0.4);
    },
    /* 26 走失小鸭: 鸭身 + 圆头 + 扁嘴 + 翘尾 + 脚 */
    'lost_duck': function (x, P) {
      shadow(x, 15, 12);
      poly(x, [-11, 1, -17, -5, -10, 6], P.main, 1.4);
      ell(x, -1, 4, 12.5, 10, P.main, 1.55);
      circle(x, 8, -6, 7.5, P.main, 1.55);
      poly(x, [12, -9, 17, -7, 17, -3, 12, -4], P.main, 1.4);
      ell(x, -3, 4, 7, 5, P.mid, 1.2, -0.2);
      eye(x, 9, -8, 1.25);
      LN(x, 1, 13, 2, 17, 2, P.dark);
      LN(x, -5, 13, -4, 17, 2, P.dark);
      hl(x, [-8, -1, -3, -3, -2, 6, -8, 6], P.light, 0.4);
    },
    /* 27 伞菇: 宽菌盖带斑点 + 粗菌柄 */
    'mushroom': function (x, P) {
      shadow(x, 17, 11);
      poly(x, [-7, 0, 7, 0, 9, 15.5, -9, 15.5], P.mid, 1.35);
      dome(x, 0, 0, 17, 13, P.main, 1.55);
      eye(x, -8, -5, 2.6); eye(x, 5, -8, 2);
      hl(x, [-11, -3, -5, -8, -2, -6, -8, -1], P.light, 0.45);
    },
    /* 28 变异芽: 球茎 + 三片锯齿叶 + 一颗变异眼 */
    'mutation': function (x, P) {
      poly(x, [-7, 17, 7, 17, 4, 12, -4, 12], P.dark, 1.4);
      circle(x, 0, 6, 9.5, P.main, 1.55);
      LMB(x, 0, 0, 0, -6, 3, 2.2, P.main);
      poly(x, [-1, -5, -13, -10, -10, -3, -14, 1, -2, 0], P.main, 1.4);
      poly(x, [1, -6, 12, -14, 14, -6, 9, -2], P.main, 1.4);
      poly(x, [-1, -6, 2, -17, 6, -6], P.main, 1.4);
      eye(x, 3.5, 6, 2.6);
      LN(x, -6, 10, -3, 11, 1.4, P.ink);
    },
    /* 29 温顺土蜂: 横身 + 条纹 + 翅 + 尾刺 + 触角 */
    'peaceful_bee': function (x, P) {
      ell(x, -3, -9.5, 7.5, 4.8, P.light, 0.9, -0.35);
      ell(x, 4.5, -10, 7.5, 4.8, P.light, 0.9, 0.25);
      ell(x, 1, 2.5, 12, 9, P.main, 1.55);
      poly(x, [-0.6, -5, -0.6, 11, 2, 10.5, 2, -5], P.ink, 0.7);
      poly(x, [5, -3, 5, 9, 7.6, 7.5, 7.6, -2], P.ink, 0.7);
      circle(x, -10.5, 1, 7, P.dark, 1.35);
      LN(x, -12.5, -4, -15.5, -12, 1.2, P.ink); eye(x, -16, -12.5, 0.85);
      LN(x, -8.5, -5, -7.5, -13, 1.2, P.ink); eye(x, -7.5, -13.5, 0.85);
      poly(x, [12.5, 0, 16.5, 2.5, 12.5, 4.5], P.dark, 0.8);
    },
    /* 30 铅笔头: 斜置笔杆 + 削尖笔头 + 橡皮 */
    'pencil': function (x, P) {
      rot(x, 0, 0, -0.42, function () {
        rect(x, 0, 1, 13, 25, P.main, 1.5);
        poly(x, [-3.6, -10.5, -2, -10.5, -2, 12.5, -3.6, 12.5], P.mid, 0.6);
        poly(x, [3.6, -10.5, 2, -10.5, 2, 12.5, 3.6, 12.5], P.mid, 0.6);
        poly(x, [-6.5, -11.5, 6.5, -11.5, 0, -20], P.light, 1.5);
        poly(x, [-1.8, -17.5, 1.8, -17.5, 0, -20], P.ink, 0.85);
        rect(x, 0, 14, 13, 5, P.dark, 1.1);
      });
    },
    /* 31 盆栽: 梯形花盆 + 盆沿 + 三片叶 */
    'plant': function (x, P) {
      shadow(x, 16, 11);
      ell(x, -8, -8, 6.5, 4, P.main, 0.9, -0.55);
      ell(x, 8, -8, 6.5, 4, P.main, 0.9, 0.55);
      ell(x, 0, -12, 5.5, 7.5, P.main, 1.4);
      LMB(x, 0, -3, 0, -8, 3, 2.4, P.main);
      rect(x, 0, -3, 26, 5, P.dark, 1.55);
      poly(x, [-11, -1, 11, -1, 8, 16, -8, 16], P.main, 1.55);
      hl(x, [-8, 3, -3, 2, -5, 12, -9, 12], P.light, 0.4);
    },
    /* 32 竹蜻蜓帽: 帽壳 + 帽檐 + 立轴 + 双桨叶 */
    'propeller_hat': function (x, P) {
      LN(x, 0, -3, 0, -12, 2.4, P.dark);
      ell(x, -7, -13, 7, 2.8, P.main, 1.3, -0.16);
      ell(x, 7, -13, 7, 2.8, P.main, 1.3, 0.16);
      circle(x, 0, -12.5, 3, P.dark, 1.35);
      dome(x, 0, 5, 14, 12, P.main, 1.55);
      rect(x, 0, 6, 29, 4.5, P.main, 1.55);
      hl(x, [-9, 4, -4, 2, -3, -5, -8, -3], P.light, 0.45);
    },
    /* 33 旧疤: 撕边皮片 + 一道拉起的疤 + 缝线 */
    'scar': function (x, P) {
      rot(x, 0, 0, -0.18, function () {
        poly(x, [-13, -8, -6, -12, 9, -11, 14, -4, 12, 7, 2, 11, -8, 10, -14, 4], P.main, 1.55);
        poly(x, [-13, -8, -16, -5, -13, -2, -16, 1, -14, 4], P.main, 1.55);
        LMB(x, -9, 6, 9, -6, 3.2, 3.2, P.dark);
        LN(x, -6, 1, -5, 5, 1.4, P.ink);
        LN(x, -1, -1, 1, 3, 1.4, P.ink);
        LN(x, 4, -3, 6, 1, 1.4, P.ink);
        hl(x, [-8, -7, -2, -9, 3, -7, -3, -5], P.light, 0.4);
      });
    },
    /* 34 受惊洋葱: 顶尖圆底 + 两片叶 + 受惊大眼 */
    'terrified_onion': function (x, P) {
      shadow(x, 16.5, 11);
      ell(x, -3.8, -16, 4, 3, P.main, 0.9, -0.6);
      ell(x, 3.8, -16, 4, 3, P.main, 0.9, 0.6);
      shape(x, function (c) {
        c.moveTo(0, -14);
        c.quadraticCurveTo(12.5, -6, 13, 5);
        c.quadraticCurveTo(12.5, 15, 0, 15);
        c.quadraticCurveTo(-12.5, 15, -13, 5);
        c.quadraticCurveTo(-12.5, -6, 0, -14);
        c.closePath();
      }, P.main, 1.55);
      poly(x, [-8.2, -7, -6.2, -7, -6.8, 11, -8.8, 11], P.mid, 0.6);
      poly(x, [8.2, -7, 6.2, -7, 6.8, 11, 8.8, 11], P.mid, 0.6);
      eye(x, -4.8, -1, 2.2); eye(x, 4.8, -1, 2.2);
      LN(x, -9, -6.5, -3.2, -4.2, 1.0, P.ink);
      LN(x, 9, -6.5, 3.2, -4.2, 1.0, P.ink);
      ell(x, 0, 7.8, 2.2, 2.9, P.ink, 0.7);
      hl(x, [-9, 1, -3, -1, -2, 8, -8, 9], P.light, 0.45);
    },
    /* 35 毒泥浆: 一滩不规则浆 + 下滴 + 气泡 */
    'toxic_sludge': function (x, P) {
      shadow(x, 13, 15);
      poly(x, [-5, 8, -2, 8, -3.5, 16], P.main, 1.35);
      poly(x, [4, 9, 7, 9, 5.5, 16], P.main, 1.35);
      shape(x, function (c) {
        c.moveTo(-16, 6); c.quadraticCurveTo(-18, -7, -6, -9);
        c.quadraticCurveTo(1, -15, 8, -8); c.quadraticCurveTo(18, -7, 15, 3);
        c.quadraticCurveTo(14, 10, 5, 9); c.quadraticCurveTo(-2, 13, -9, 9);
        c.closePath();
      }, P.main, 1.55);
      eye(x, -7, -4, 2.8); eye(x, 6, -5, 1.55);
      hl(x, [-11, -1, -5, -5, 0, -3, -6, 2], P.light, 0.4);
    },
    /* 36 酸渍薯皮: 波浪薯皮条 + 酸蚀孔 + 酸滴 */
    'acid': function (x, P) {
      LMB(x, -14, -8, 2, -12, 8, 7.5, P.main);
      LMB(x, 2, -12, 12, -3, 7.5, 7, P.main);
      LMB(x, 12, -3, -3, 6, 7, 6, P.main);
      eye(x, -5, -10, 2.4); eye(x, 5, -6, 1.55); eye(x, 3, 2, 1.4);
      circle(x, 13, 8, 2.8, P.dark, 1.25);
      hl(x, [-10, -9, -4, -12, -1, -10, -5, -7], P.light, 0.4);
    },
    /* 37 旗杆: 立杆 + 杆顶 + 燕尾旗 + 底座 */
    'banner': function (x, P) {
      LMB(x, -7, -14, 3, 18, 4.6, 3.8, P.main);
      poly(x, [-10, 18, 7, 18, 5, 14, -8, 14], P.dark, 1.35);
      circle(x, -7.6, -16, 2.8, P.dark, 1.4);
      poly(x, [-6, -13, 17, -9, 7, -2, 17, 5, -4, 1], P.main, 1.55);
      LN(x, -4, -9, 11, -7, 1.6, P.mid);
      hl(x, [-3, -10, 8, -9, 3, -4, -3, -6], P.light, 0.4);
    },
    /* 38 黑腰带: 横带 + 方带扣 + 垂尾 */
    'black_belt': function (x, P) {
      LMB(x, -17, -1, 16, 1, 7, 7, P.main);
      LMB(x, 6, 3, 12, 15, 6, 4.5, P.dark);
      circle(x, -13, -1, 2, P.dark, 1.05);
      circle(x, 11, 1, 2, P.dark, 1.05);
      rrect(x, -1, 0, 15, 14, 2.5, P.main, 1.55);
      rect(x, -1, 0, 7, 6.5, P.ink, 1.05);
      hl(x, [-11, -4, -8, -4, -8, 2, -11, 2], P.light, 0.45);
    },
    /* 39 蒙眼布: 中间下凹的布带 + 侧结 + 两条布尾 */
    'blindfold': function (x, P) {
      LMB(x, -17, 3, -13, 16, 3.6, 2.4, P.main);
      LMB(x, -15, 5, -19, 13, 3.2, 2.2, P.main);
      shape(x, function (c) {
        c.moveTo(-15, -7); c.quadraticCurveTo(0, -2, 15, -6);
        c.lineTo(16, 3); c.quadraticCurveTo(0, 8, -16, 5);
        c.closePath();
      }, P.main, 1.55);
      circle(x, -16, -1, 4.6, P.dark, 1.55);
      hl(x, [-10, -6, -4, -5, -3, -1, -9, -2], P.light, 0.4);
    },
    /* 40 吸血蛭: 拱起的分节虫身 + 两端吸盘 + 血滴 */
    'blood_leech': function (x, P) {
      LMB(x, -15, 8, -6, -4, 7, 8.5, P.main);
      LMB(x, -6, -4, 6, -7, 8.5, 7.5, P.main);
      LMB(x, 6, -7, 15, 3, 7.5, 5, P.main);
      LN(x, -10, 4, -8, 1, 1.4, P.ink);
      LN(x, -4, -3, -2, -7, 1.4, P.ink);
      LN(x, 8, -4, 10, 0, 1.4, P.ink);
      circle(x, -16, 9, 3.6, P.dark, 1.4);
      eye(x, -17, 9, 1.05);
      poly(x, [6, 12, 10, 12, 8, 18], P.dark, 1.25);
      hl(x, [-8, -1, -3, 1, -2, -4, -7, -4], P.light, 0.35);
    },
    /* 41 篝火堆: 交叉柴 + 外焰 + 内焰 */
    'campfire': function (x, P) {
      shadow(x, 13, 14);
      LMB(x, -16, 14, 13, 7, 5.4, 4.6, P.dark);
      LMB(x, -13, 7, 15, 15, 5.4, 4.6, P.dark);
      shape(x, function (c) {
        c.moveTo(0, -19.5); c.quadraticCurveTo(10, -9, 8, 1);
        c.quadraticCurveTo(7, 10, 0, 10); c.quadraticCurveTo(-7, 10, -8, 1);
        c.quadraticCurveTo(-10, -9, -1.5, -8); c.quadraticCurveTo(2, -13, 0, -19.5);
        c.closePath();
      }, P.main, 1.55);
      poly(x, [0, -8, 4, 1, 0, 9, -4, 1], P.light, 1.2);
    },
    /* 42 齿轮: 八齿 + 轮盘 + 轴孔 */
    'cog': function (x, P) {
      shape(x, function (c) {
        for (var i = 0; i < 8; i++) {
          var a = i * Math.PI / 4, ca = Math.cos(a), sa = Math.sin(a);
          var nx = -sa, ny = ca;
          c.moveTo(ca * 12 - nx * 4, sa * 12 - ny * 4);
          c.lineTo(ca * 19 - nx * 3.2, sa * 19 - ny * 3.2);
          c.lineTo(ca * 19 + nx * 3.2, sa * 19 + ny * 3.2);
          c.lineTo(ca * 12 + nx * 4, sa * 12 + ny * 4);
          c.closePath();
        }
      }, P.main, 1.35);
      circle(x, 0, 0, 12.5, P.main, 1.55);
      circle(x, 0, 0, 8.5, P.mid, 1.05);
      circle(x, 0, 0, 4.5, P.ink, 1.25);
      hl(x, [-10, -3, -4, -8, -1, -6, -8, -1], P.light, 0.4);
    },
    /* 43 罗盘: 提钮 + 表壳 + 表盘 + 指针 */
    'compass': function (x, P) {
      circle(x, 0, -16, 3.4, P.dark, 0.9);
      circle(x, 0, 0, 14, P.main, 1.55);
      circle(x, 0, 0, 11, P.mid, 0.9);
      LN(x, -11, 0, -8, 0, 1.1, P.ink);
      LN(x, 11, 0, 8, 0, 1.1, P.ink);
      LN(x, 0, -11, 0, -8, 1.1, P.ink);
      poly(x, [0, -10, 4.4, 0, -4.4, 0], P.light, 0.9);
      poly(x, [0, 10, 4.4, 0, -4.4, 0], P.dark, 0.9);
    },
    /* 44 独眼虫: 分节虫身 + 大头 + 独眼 + 小足 */
    'cyclops_worm': function (x, P) {
      shadow(x, 13, 13);
      circle(x, 10, 5, 7.5, P.main, 1.4);
      circle(x, 0, 3, 9, P.main, 1.4);
      circle(x, -9, 0, 8, P.main, 1.4);
      circle(x, -12, -8, 6.5, P.dark, 1.4);
      circle(x, -13, -9, 3.6, P.light, 1.1);
      eye(x, -13.5, -9, 1.6);
      LN(x, -3, 12, -4, 16, 1.4, P.dark);
      LN(x, 4, 11, 4, 15, 1.4, P.dark);
      LN(x, 9, 10, 10, 14, 1.4, P.dark);
    },
    /* 45 危险兔: 长耳 + 圆头 + 怒眉 + 獠牙 */
    'dangerous_bunny': function (x, P) {
      ell(x, -5, -8.5, 4, 9, P.main, 1.4, -0.14);
      ell(x, 5, -8.5, 4, 9, P.main, 1.4, 0.14);
      ell(x, -5, -8.5, 1.7, 5, P.dark, 0.7, -0.14);
      ell(x, 5, -8.5, 1.7, 5, P.dark, 0.7, 0.14);
      circle(x, 0, 5, 11.5, P.main, 1.55);
      eye(x, -4.5, 2, 1.8); eye(x, 4.5, 2, 1.8);
      LN(x, -8, -2, -2, 1, 1.2, P.ink);
      LN(x, 8, -2, 2, 1, 1.2, P.ink);
      LN(x, -4, 10, 4, 10, 1.3, P.ink);
      sym(x, [1.5, 11, 4, 11, 2.8, 14.5], P.light, 0.8);
    },
    /* 46 能量手环: 环 + 三颗珠 + 闪电挂坠 */
    'energy_bracelet': function (x, P) {
      ARC(x, 0, -2, 12, 0, Math.PI * 2, 4.6, P.main);
      circle(x, -12, -2, 2.6, P.dark, 1.05);
      circle(x, 12, -2, 2.6, P.dark, 1.05);
      circle(x, 0, -14, 2.6, P.dark, 1.05);
      poly(x, [1, 6, -6, 14, -1, 14, 0, 18], P.light, 1.05);
    },
    /* 47 燃料罐: 方罐 + X 加强筋 + 提手 + 加注口 */
    'fuel_tank': function (x, P) {
      shadow(x, 16, 12);
      rect(x, -7, -13, 5, 5, P.dark, 1.35);
      LMB(x, 3, -10, 12, -13, 3, 2.4, P.main);
      rrect(x, 0, 4, 25, 24, 4, P.main, 1.55);
      LN(x, -9, -6, 9, 15, 2.4, P.dark);
      LN(x, 9, -6, -9, 15, 2.4, P.dark);
      rrect(x, 1, 4, 6, 9, 1.5, P.mid, 1.25);
      hl(x, [-10, -7, -6, -7, -5, -2, -9, -2], P.light, 0.4);
    },
    /* 48 赌运铜牌: 八角牌 + 方孔 + 刻纹 */
    'gambling_token': function (x, P) {
      poly(x, [-8, -16, 8, -16, 16, -8, 16, 8, 8, 16, -8, 16, -16, 8, -16, -8], P.main, 1.55);
      poly(x, [-4.5, -4.5, 4.5, -4.5, 4.5, 4.5, -4.5, 4.5], P.ink, 1.25);
      eye(x, 0, -11.5, 1.4); eye(x, 0, 11.5, 1.4);
      LN(x, -12, 0, -7.5, 0, 1.6, P.ink);
      LN(x, 12, 0, 7.5, 0, 1.6, P.ink);
      hl(x, [-11, -12, -3, -13, -3, -9, -11, -8], P.light, 0.4);
    },
    /* 49 皮马甲: 无袖马甲 + V 领 + 前襟 + 扣 */
    'leather_vest': function (x, P) {
      poly(x, [-14, -16, -5, -12, 5, -12, 14, -16, 15, 6, 10, 16, -10, 16, -15, 6], P.main, 1.55);
      poly(x, [-3, -13, 3, -13, 0, -2], P.ink, 1.25);
      LN(x, 0, -1, 0, 15, 1.8, P.dark);
      LN(x, -11, -8, -9, 8, 1.6, P.mid);
      LN(x, 11, -8, 9, 8, 1.6, P.mid);
      eye(x, -3.5, 11, 1.25); eye(x, 3.5, 11, 1.25);
      hl(x, [-11, 5, -6, 3, -8, 13, -12, 13], P.light, 0.35);
    },
    /* 50 小青蛙: 宽身 + 两只凸眼 + 后腿 */
    'little_frog': function (x, P) {
      shadow(x, 15, 13);
      ell(x, 0, 5, 15, 10, P.main, 1.55);
      circle(x, -8, -7, 5.5, P.main, 1.55);
      circle(x, 8, -7, 5.5, P.main, 1.55);
      eye(x, -8, -8, 2.6); eye(x, 8, -8, 2.6);
      LMB(x, -13, 11, -16, 15, 4.5, 3, P.main);
      LMB(x, 13, 11, 16, 15, 4.5, 3, P.main);
      LN(x, -6, 8, 6, 8, 2, P.ink);
      hl(x, [-7, 1, -2, 0, -1, 8, -6, 8], P.light, 0.4);
    },
    /* 51 矮壮力士: 小头 + 屈臂秀肌肉 + 方躯干 + 粗腿 */
    'little_muscley_dude': function (x, P) {
      LMB(x, -5, -4, -13, 2, 4.5, 3.4, P.main);
      LMB(x, 5, -4, 13, 2, 4.5, 3.4, P.main);
      circle(x, -14, 0, 5, P.main, 1.55);
      circle(x, 14, 0, 5, P.main, 1.55);
      rrect(x, 0, 4, 17, 15, 5, P.main, 1.55);
      LMB(x, -5, 11, -6, 17, 4.5, 3.2, P.main);
      LMB(x, 5, 11, 6, 17, 4.5, 3.2, P.main);
      circle(x, 0, -9, 6, P.main, 1.55);
      eye(x, -2, -10, 1.05); eye(x, 2, -10, 1.05);
      hl(x, [-5, 1, -1, 0, -1, 7, -5, 7], P.light, 0.4);
    },
    /* 52 精通心得: 卷轴 + 两端卷筒 + 三行字 */
    'mastery': function (x, P) {
      rot(x, 0, 0, -0.1, function () {
        circle(x, -12, 0, 5.5, P.dark, 1.55);
        circle(x, 12, 0, 5.5, P.dark, 1.55);
        rect(x, 0, 0, 26, 24, P.main, 1.55);
        LN(x, -6, -6, 6, -6, 1.6, P.mid);
        LN(x, -6, -1, 6, -1, 1.6, P.mid);
        LN(x, -6, 4, 2, 4, 1.6, P.mid);
        poly(x, [-1, 8, 1, 8, 0, 12], P.dark, 0.95);
        hl(x, [-5, -9, 5, -9, 5, -7, -5, -7], P.light, 0.4);
      });
    },
    /* 53 奖章: V 绶带 + 圆章 + 五角星 */
    'medal': function (x, P) {
      poly(x, [-12, -18, -2, -6, 2, -6, 12, -18, 12, -8, 0, -2, -12, -8], P.main, 1.55);
      LN(x, -9, -15, -4, -8, 1.6, P.mid);
      LN(x, 9, -15, 4, -8, 1.6, P.mid);
      circle(x, 0, 6, 11, P.main, 1.55);
      star(x, 0, 6, 3.1, 7.6, P.dark, 1.25);
      hl(x, [-7, 1, -3, -1, -2, 6, -6, 7], P.light, 0.4);
    },
    /* 54 铁板: 略透视的钢板 + 四角铆钉 + 折边 */
    'metal_plate': function (x, P) {
      rot(x, 0, 0, -0.06, function () {
        poly(x, [-17, -11, 17, -14, 17, 10, -17, 13], P.main, 1.55);
        eye(x, -12, -8, 1.4); eye(x, 12, -9, 1.4);
        eye(x, -12, 9, 1.4); eye(x, 12, 8, 1.4);
        LN(x, -14, 0, 14, -1, 2, P.dark);
        hl(x, [-14, -8, 2, -10, 2, -6, -14, -4], P.light, 0.4);
      });
    },
    /* 55 小导弹: 锥头弹体 + 两片尾翼 + 喷口 */
    'missile': function (x, P) {
      poly(x, [-9, 5, 9, 5, 9, -7, 0, -19.5, -9, -7], P.main, 1.55);
      poly(x, [-9, 5, -16, 14, -9, 12], P.main, 1.2);
      poly(x, [9, 5, 16, 14, 9, 12], P.main, 1.2);
      poly(x, [0, -19.5, 9, -7, 0, -7], P.dark, 1.0);
      LN(x, -9, 0, 9, 0, 1.1, P.ink);
      circle(x, 0, 8, 2.8, P.dark, 0.9);
      hl(x, [-5, -5, 0, -6, 0, 3, -5, 3], P.light, 0.45);
    },
    /* 56 棉垫: 圆角方垫 + 绗缝交叉 + 缝结 */
    'padding': function (x, P) {
      shadow(x, 15, 13);
      rrect(x, 0, 2, 29, 26, 6, P.main, 1.55);
      LN(x, -11, -8, 11, 12, 1.8, P.mid);
      LN(x, 11, -8, -11, 12, 1.8, P.mid);
      LN(x, -12, 2, 12, 2, 1.6, P.mid);
      circle(x, 0, 2, 2.6, P.dark, 1.35);
      hl(x, [-10, -6, -5, -9, -2, -7, -7, -4], P.light, 0.4);
    },
    /* 57 强化钢条: 斜置钢条 + 钢肋 + 加强筋 */
    'reinforced_steel': function (x, P) {
      rot(x, 0, 0, -0.5, function () {
        rect(x, 0, 0, 16, 33, P.main, 1.55);
        poly(x, [-8, -9, 8, -13, 8, -10, -8, -6], P.dark, 0.7);
        poly(x, [-8, -1, 8, -5, 8, -2, -8, 2], P.dark, 0.7);
        poly(x, [-8, 7, 8, 3, 8, 6, -8, 10], P.dark, 0.7);
        eye(x, 0, -14.5, 1.6); eye(x, 0, 14.5, 1.6);
      });
    },
    /* 58 反击架势: 两把交叉的刀剑 + 剑柄 + 反击弧 */
    'riposte': function (x, P) {
      LMB(x, -15, 15, 9, -14, 6.5, 4.4, P.main);
      poly(x, [-15, 15, -9, 10, -11, 18], P.dark, 1.35);
      eye(x, -12, 14, 2.4);
      LMB(x, 12, -15, -8, 9, 4.8, 3.4, P.mid);
      circle(x, 12, -15, 3.4, P.dark, 1.4);
      ARC(x, 4, -5, 12, Math.PI * 0.72, Math.PI * 1.3, 2, P.light);
    },
    /* 59 祭礼: 供盘 + 直蜡烛 + 火苗 */
    'ritual': function (x, P) {
      shadow(x, 16, 12);
      poly(x, [-14, 16, 14, 16, 10, 9, -10, 9], P.dark, 1.35);
      rect(x, 0, 7.5, 24, 4.5, P.main, 1.2);
      rect(x, 0, -1, 14, 18, P.main, 1.55);
      LN(x, -4.5, 5, -3.5, -2, 1.0, P.dark);
      LN(x, 4.5, 6, 3.5, 0, 1.0, P.dark);
      poly(x, [0, -19, 4.5, -12, 2.5, -7.5, -2.5, -7.5, -4.5, -12], P.light, 1.0);
    },
    /* 60 瞄具: 横置镜筒 + 两端物镜圈 + 调节钮 + 支架 */
    'scope': function (x, P) {
      rect(x, -16, -2, 5, 17, P.dark, 1.4);
      rect(x, 16, -2, 5, 17, P.dark, 1.4);
      poly(x, [-9, 6, -3, 6, -4, 15, -9, 15], P.main, 1.35);
      poly(x, [3, 6, 9, 6, 9, 15, 4, 15], P.main, 1.35);
      rect(x, 0, -2, 34, 15, P.main, 1.55);
      rect(x, 0, -11, 7, 5, P.dark, 1.35);
      hl(x, [-12, -7, 4, -8, 4, -4, -12, -3], P.light, 0.4);
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
