/* PS.Art v4.0 —— 程序化美术层(零位图, 全 Canvas 手绘 + 离屏精灵缓存)
 * ===========================================================================
 * v4.0「菜园黄昏 · 土垄战场」重做。三件事一起做, 缺一件画面就还是"小学生作品":
 *   1) 体积: 全场统一「左上主光」, 每个形体都是 亮面 → 中间调 → 核心暗部 → 边缘反光
 *      四档, 再压一层接触阴影。旧版是"平涂 + 描边", 所以看起来像贴纸。
 *   2) 剪影: 每只怪一族独有形制(芽叶 / 伞盖 / 镰臂 / 岩壳 / 荚膜 / 根须 / 甲壳 ...),
 *      把颜色全部抽掉只剩黑块也能分开 —— 这是"一眼分辨"的唯一可靠做法。
 *   3) 威胁等级: 平怪 = 低饱和 + 单层深描边; 精英 = 金冠 + 脚下金环 + 肩甲/披风;
 *      Boss = 棘冠 + 危险内发光 + 双层轮廓 + 呼吸缩放。
 *   另: 可玩角色的 8 种蔬菜各有专属剪影与配件(萼蒂/根尾/穗须/肉叶/瓣缝/弯柄/卷须/心叶),
 *      并共享"玩家家族标记": 金色外发光描边 + 脚下光环 + 眉眼/腮红/微笑。
 *
 * 性能契约(务必保持 —— 改美术不等于放弃预算):
 *   静态外形(含受击白闪变体 / 冰冻变体 / 血条底槽 / 王冠 / 披风 / 影子) → 一次性烘焙进
 *   PS.Sprites 缓存。每帧只做: 1 × drawImage + (受伤时)1 × fillRect 画血量实心。
 *   带方向性的怪(冲角羊/沟鳗/收割者)走 drawImage 的 rot/flip 参数, 0 额外调用。
 *   Boss 呼吸缩放走 drawImage 的 scale 参数, 0 额外调用。
 *   烘焙期(一次性)可以随便用 clip / 渐变 / save-restore; 热路径一次都不许用(R3.5)。
 *   地面/地标/草簇同样全部走离屏缓存: 热路径只有 drawImage, 不再有每帧 fillRect 现画。
 *
 * 边界纪律: 本文件不读游戏全局(保持纯函数可测)。离屏画布一律经 PS.Sprites 申请 ——
 *   微信小游戏没有 document, 旧实现用 document.createElement, 结果微信端一点加速都吃不到;
 *   现在地面砖/地标也能在微信端烘焙。无画布工厂时整体降级为"每帧现画"(不会崩)。
 *   ES5 语法, 零依赖, 只依赖 PS.Sprites(可选, 缺失则降级)。
 */
(function (global) {
  'use strict';
  var PS = global.PS || {};
  var TAU = Math.PI * 2;
  var INK = '#100c08';          // 唯一描边色(暖偏近黑, R1.1: 禁止纯黑)
  var INK_HI = '#6a6a72';       // 白闪期的描边(纯白描边会丢剪影)

  /* ============================ 基础工具 ============================ */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /** 确定性哈希 → [0,1): 用于帧相位 / 装饰分布 / 石纹, 完全可复现 */
  function h2(x, y) {
    var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  }
  function hex2rgb(h) {
    var s = String(h || '#000').replace('#', '');
    if (s.length === 3) s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
    var n = parseInt(s, 16);
    if (!isFinite(n)) return [255, 255, 255];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(h, a) {
    var c = hex2rgb(h);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + clamp(a, 0, 1) + ')';
  }
  /** 向白(amt>0)/向黑(amt<0)插值, 返回 #rrggbb */
  function shade(h, amt) {
    var c = hex2rgb(h), t = clamp(Math.abs(amt), 0, 1), d = amt >= 0 ? 255 : 0, i, o = [];
    for (i = 0; i < 3; i++) o[i] = Math.round(c[i] + (d - c[i]) * t);
    return '#' + ((1 << 24) | (o[0] << 16) | (o[1] << 8) | o[2]).toString(16).slice(1);
  }
  /** 两色线性混合(阵营整形 / 冰冻青染 / 暮色滤镜都用它) */
  function mix(a, b, t) {
    var A = hex2rgb(a), B = hex2rgb(b), i, o = [];
    for (i = 0; i < 3; i++) o[i] = Math.round(A[i] + (B[i] - A[i]) * clamp(t, 0, 1));
    return '#' + ((1 << 24) | (o[0] << 16) | (o[1] << 8) | o[2]).toString(16).slice(1);
  }
  /** 饱和度整形(R1.3): 玩家阵营 ×1.08, 怪物明度上限压到 L≤58 —— 敌我一眼分得开 */
  function satAdj(h, k) {
    var c = hex2rgb(h), mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
    var l = (mx + mn) / 2, i, o = [];
    for (i = 0; i < 3; i++) o[i] = clamp(Math.round(l + (c[i] - l) * k), 0, 255);
    return '#' + ((1 << 24) | (o[0] << 16) | (o[1] << 8) | o[2]).toString(16).slice(1);
  }
  function lum(h) { var c = hex2rgb(h); return (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114) / 255; }

  /* ============================ 调色板 ============================
   * 语义色 (qa/art-direction.md §1.1) 全部保留原 key —— 其它模块/预览页会读它。
   * v4.0 追加: 暮色天光 / 干土 / 湿土 / 木料 / 铁件 / 水色 / 菜畦作物色(全部 L≤48 S≤45, R1.6)。
   * v4.1「单调地面」(用户诉求: 地图要简单单调; 地面和怪撞色看不清):
   *   1) 色相收窄: 地面所有有色相的像素 H 落在 33°~60° 一条橄榄/土色窄带(原 33°~208°, 蓝水/冷铁都出格);
   *   2) 饱和度压低: 地面 S ≤ 30(原最高 58), 且不再出现任何高饱和点缀;
   *   3) 明度压平: 地面 L 落在 13~27, 亮部 p99 ≤ 30 —— 地面永远比怪的剪影暗一档以上(R1.6 收紧);
   *   4) 装饰收敛: 地标 8 种 → 3 种(每行 2 件 → 1 件), 草簇改成贴地残茬(不再长成"小生物")。
   *   groundB 仍然是"世界基色": ui.js:97 的兜底 '#33441f' 与新值 '#3a3822' 同为 L≈18~19 的暗橄榄,
   *   只是色相从绿橄榄挪到土橄榄 —— 兜底语义不变, 因此不需要改 ui.js(那条注释继续成立)。 */
  var palette = {
    /* 地面/世界 */
    ink: INK, bgDeep: '#0b1109', groundA: '#424129', groundB: '#3a3822', groundC: '#2d2b1a',
    grass: '#4c4b2f', grassLite: '#545336', grassDark: '#3a3922',
    soil: '#454127', soilDark: '#2b2817', plough: '#4a462b',
    stone: '#383a31', stoneLite: '#494a3f', stoneDark: '#262720',
    /* 金属/金 */
    gold: '#d8a24a', goldLite: '#ffd24a', goldDark: '#8a6a24',
    /* 通用 */
    ink2: '#1b2418', cream: '#f2e8cc', chip: '#8fd66b', chipDark: '#5f9a45',
    blood: '#a83232', alert: '#ff8a5a', heal: '#6ee06e', xp: '#7de07a',
    /* 玩家(蔬菜)兜底色 —— 实际配色取自 PS.Characters.list[i].color */
    player: '#cfa45c', playerDark: '#8f6c2c', playerLite: '#f0cd86', playerFace: '#f6e4b8',
    /* 敌人兜底 */
    foe: '#7a9a4a',
    /* 状态 */
    elite: '#ffd24a', eliteDark: '#a37a12', boss: '#ff5a5a', freeze: '#a8e4ff', flashW: '#ffffff',
    /* v4.0 场景扩板 */
    soilWet: '#2e2c19', soilDust: '#555034', soilRidge: '#4a452b', soilShade: '#211f12',
    wood: '#5a4326', woodLite: '#7d6136', woodDark: '#33251a',
    iron: '#393b35', ironLite: '#8b949c', ironDark: '#252721',
    water: '#31382e', waterLite: '#3e4639', waterFoam: '#454f40',
    cropGreen: '#4d4d2d', cropLite: '#545436', cropDark: '#34341d',
    cropGold: '#575033', cropPurple: '#44442c', duskWarm: '#544b31',
    pest: '#524c2e',
    /* v4.1 地面专用: 与实体共用 key 的木料/铁件(怪物手里的锄柄/镰柄、weaponGrip)保持原亮度,
     * 地面这一侧单开一组更暗更灰的值 —— 免得为了压地面顺手把敌人的道具也弄暗。 */
    gWood: '#413625', gWoodLite: '#4d402d', gWoodDark: '#2b2217', gIronLite: '#494c43',
    /* v4.1 地面统一压色(烘焙期一次性叠加, 见 gradeGround): 低饱和中性橄榄, alpha 固定 0.18 */
    groundGrade: '#343427'
  };

  /* ============================ 白闪 / 伤害态 ============================
   * 烘焙期把"受击白闪 / 冰冻"做成独立缓存槽(不是每帧滤镜): 命中反馈因此 0 extra call。
   * MODE: 0 正常 / 1 白闪 / 2 冰冻 */
  var MODE = 0;
  /** 主色通道: MODE=1 全白化, MODE=2 向冰冻青混 55% */
  function acc(c) {
    if (MODE === 1) return '#ffffff';
    if (MODE === 2) return mix(c, palette.freeze, 0.5);
    return c;
  }
  /** 暗色通道(瞳/缝/内里): 白闪期不能全白, 否则五官消失 */
  function accD(c) {
    if (MODE === 1) return '#dedee2';
    if (MODE === 2) return mix(c, palette.freeze, 0.34);
    return c;
  }
  function inkOf() {
    if (MODE === 1) return INK_HI;
    if (MODE === 2) return mix(INK, '#3a6a86', 0.42);
    return INK;
  }

  /* ============================ 路径原语 ============================ */
  function circlePath(x, cx, cy, r) { x.beginPath(); x.arc(cx, cy, r, 0, TAU); }
  function ellPath(x, cx, cy, rx, ry, rot) { x.beginPath(); x.ellipse(cx, cy, rx, ry, rot || 0, 0, TAU); }
  function polyPath(x, pts) {
    x.beginPath(); x.moveTo(pts[0], pts[1]);
    for (var i = 2; i < pts.length; i += 2) x.lineTo(pts[i], pts[i + 1]);
    x.closePath();
  }
  function fillC(x, c) { x.fillStyle = c; x.fill(); }
  function strokeC(x, c, lw) { x.strokeStyle = c; x.lineWidth = lw; x.stroke(); }
  /** 不规则圆(团块/根茎体): wob 抖动幅度, k 叶 于 h2 噪声 */
  function blobPath(x, cx, cy, r, wob, k) {
    var i, a, n = 14, rr;
    x.beginPath();
    for (i = 0; i <= n; i++) {
      a = i / n * TAU;
      rr = r * (1 + Math.sin(a * 3 + k) * wob + Math.sin(a * 5 - k * 2) * wob * 0.6);
      if (i === 0) x.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      else x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    x.closePath();
  }
  /** 可复用的"体": 平涂 + 深色描边(项目一贯画法; 不透明形状的基线) */
  function body(x, c, lw) { fillC(x, c); strokeC(x, inkOf(), lw || 2.2); }

  /* ============================ 体积 kit ============================
   * volume(x, r, pathFn, C, opts) —— 全场统一左上主光的四档明暗。
   *   亮面(向白 0.45) / 中间调(本色) / 核心暗部(向黑 0.3~0.62, 落在右下) / 高光小点。
   *   烘焙期用径向渐变 + clip, 热路径一次都不调用。
   *   opts.flat     不做明暗(纯色块, 用于"贴在地面的东西")
   *   opts.gloss    false = 不画高光点;  数值 = 高光透明度
   *   opts.glow     true = 罩一圈 4.4px 金色外发光(R1.4 玩家家族标识; 见 charGlow)
   *   opts.lw       描边宽度(0 = 不描边)
   *   opts.ink      自定义描边色
   *   opts.ly/lx    主光偏移(默认左上) */
  function volume(x, r, pathFn, C, o) {
    o = o || {};
    var lw = o.lw === undefined ? Math.max(1.3, r * 0.12) : o.lw;
    var lx = o.lx === undefined ? -0.42 : o.lx, ly = o.ly === undefined ? -0.5 : o.ly;
    var ink = o.ink || inkOf();
    pathFn();
    x.fillStyle = C; x.fill();
    if (o.flat !== true) {
      x.save();
      pathFn(); x.clip();
      var g = x.createRadialGradient(lx * r, ly * r, r * 0.06, 0, 0, r * 1.42);
      g.addColorStop(0, rgba(shade(C, 0.46), 0.72));
      g.addColorStop(0.32, rgba(shade(C, 0.06), 0.18));
      g.addColorStop(0.68, rgba(shade(C, -0.3), 0.40));
      g.addColorStop(1, rgba(shade(C, -0.62), 0.86));
      x.fillStyle = g;
      x.fillRect(-r * 2.6, -r * 2.6, r * 5.2, r * 5.2);
      if (o.gloss !== false) {
        x.beginPath();
        x.ellipse(lx * r * 0.95, ly * r * 0.95, r * (o.gr || 0.24), r * (o.gr || 0.24) * 0.56, -0.55, 0, TAU);
        x.fillStyle = rgba('#ffffff', o.gloss === undefined ? 0.30 : o.gloss);
        x.fill();
      }
      x.restore();
    }
    if (o.glow) { pathFn(); charGlow(x); }
    if (lw > 0) { pathFn(); x.strokeStyle = ink; x.lineWidth = lw; x.lineJoin = 'round'; x.stroke(); }
  }
  /** 纯描边用: 形状 + 内描边(不透明块, 用于石纹/木片/贴地纹) */
  function slab(x, pathFn, C, lw) {
    pathFn();
    x.fillStyle = C; x.fill();
    if (lw !== 0) { x.strokeStyle = inkOf(); x.lineWidth = lw || 1.6; x.lineJoin = 'round'; x.stroke(); }
  }
  /** 边缘反光: 在形状左上四分之一弧上补一道亮线(体积感的"最后 10%") */
  function rim(x, cx, cy, rr, a0, a1, col, lw) {
    x.beginPath(); x.arc(cx, cy, rr, a0, a1);
    x.strokeStyle = col; x.lineWidth = lw; x.lineCap = 'round'; x.stroke();
  }
  /** 接触阴影: 烘焙进精灵 → 每帧 0 额外调用(与旧实现同位置: y + 0.72r) */
  /** 接触阴影(**绝对坐标**版): 结构体/地雷的阴影必须画在精灵之外 ——
   *   它们的精灵会按 st.ang 整张旋转, 阴影跟着转会读成「机器在地上打滚」。 */
  function groundShadowAt(x, cx, cy, r, rx, ry) {
    var yy = cy + r * 0.72;
    x.beginPath(); x.ellipse(cx, yy, r * rx, r * ry, 0, 0, TAU);
    x.fillStyle = 'rgba(0,0,0,0.30)';
    x.fill();
    x.beginPath(); x.ellipse(cx, yy + r * 0.02, r * rx * 0.62, r * ry * 0.6, 0, 0, TAU);
    x.fillStyle = 'rgba(0,0,0,0.22)';
    x.fill();
  }
  function groundShadow(x, r, rx, ry, y) {
    /* 老签名(怪那几十处调用点一个不动): y 省略 = 以自身原点为脚; 给了 y 就按 y 反推中心。 */
    groundShadowAt(x, 0, y === undefined ? 0 : y - r * 0.72, r, rx, ry);
  }
  /** 一段肢体/根须: 先粗 ink 外圈再上色 → 缩到 r=8 也保得住轮廓 */
  function limb(x, x0, y0, x1, y1, bend, col, lw) {
    var b2 = bend + Math.abs(bend) * 0.5;
    x.beginPath(); x.moveTo(x0, y0);
    x.quadraticCurveTo((x0 + x1) / 2 + bend, (y0 + y1) / 2 - b2, x1, y1);
    x.strokeStyle = inkOf(); x.lineWidth = lw + 1.7; x.lineCap = 'round'; x.stroke();
    x.strokeStyle = acc(col); x.lineWidth = lw; x.stroke();
  }
  /** 关节腿: 两段折线 + 足尖(节肢动物/鸟类的通用形制) */
  function leg(x, x0, y0, x1, y1, kx, ky, w, col) {
    x.lineCap = 'round'; x.lineJoin = 'round';
    x.beginPath(); x.moveTo(x0, y0); x.lineTo(kx, ky); x.lineTo(x1, y1);
    x.strokeStyle = inkOf(); x.lineWidth = w + 1.6; x.stroke();
    x.strokeStyle = acc(col); x.lineWidth = w; x.stroke();
  }

  /* ============================ 眼部 ============================
   * 风格 0 圆眼(萌) / 1 竖瞳(掠食) / 2 复眼(虫) / 3 发光(不死·Boss) / 4 兜帽暗眼 / 5 白眼无瞳(失控)
   * look = [-1,1] 朝向偏移(决定瞳孔位置 → 表情有方向感) */
  function eyeAt(x, ex, ey, er, style, look) {
    var lx = (look || 0) * er * 0.3, i;
    if (CUTE) {                 /* v63 素面小眼: 一颗小暗点 —— 去掉眼白/大瞳/高光点(「人眼」三件套) */
      /* 用户逐字「这些怪物让我感到生理不适」+ 主程看图复核的根因: 白眼球 + 黑瞳 + 高光的**人眼**
       *   形状会触发恐怖谷(越像人脸越不适)。原版土豆兄弟的怪是"小而无神的一点眼睛"。
       *   这里统一成一颗小暗点(半径 ≈ 0.09r, 原来 0.30r 的大圆眼), 保留眼位与朝向感(仍读得出怪在看哪)。
       *   尺寸仍随 er 与 CUTE_ER 走, 各族眼睛的**相对大小关系**不变。 */
      var r2 = Math.max(0.95, Math.min(er * 0.78, CUTE_ER * 0.30));
      ellPath(x, ex, ey, r2, r2 * 1.12); fillC(x, accD('#1a120c'));
      ellPath(x, ex, ey, r2, r2 * 1.12); strokeC(x, inkOf(), Math.max(0.7, r2 * 0.34));
      return;
    }    if (style === 1) {
      ellPath(x, ex, ey, er, er * 1.14); fillC(x, acc('#f2e8c8'));
      ellPath(x, ex, ey, er, er * 1.14); strokeC(x, inkOf(), Math.max(0.9, er * 0.3));
      ellPath(x, ex + lx, ey, er * 0.27, er * 0.88); fillC(x, accD('#241a12'));
    } else if (style === 2) {
      ellPath(x, ex, ey, er * 1.1, er); fillC(x, acc('#6e2626'));
      ellPath(x, ex, ey, er * 1.1, er); strokeC(x, inkOf(), Math.max(0.8, er * 0.26));
      for (i = 0; i < 3; i++) {
        ellPath(x, ex + (i - 1) * er * 0.5, ey + (i % 2 ? er * 0.3 : -er * 0.3), er * 0.26, er * 0.18);
        fillC(x, rgba(acc('#3a1010'), 0.75));
      }
      ellPath(x, ex - er * 0.3, ey - er * 0.36, er * 0.32, er * 0.2, -0.5); fillC(x, 'rgba(255,255,255,0.6)');
    } else if (style === 3) {
      var g = x.createRadialGradient(ex, ey, 0, ex, ey, er * 2.1);
      g.addColorStop(0, acc('#fff8e0')); g.addColorStop(0.4, acc(o6v(ex, ey, er)));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      circlePath(x, ex, ey, er * 2.1); fillC(x, g);
      ellPath(x, ex, ey, er * 0.6, er * 0.72); fillC(x, acc('#fffbe8'));
    } else if (style === 4) {
      ellPath(x, ex, ey, er * 1.05, er * 0.72); fillC(x, acc('#2a1012'));
      ellPath(x, ex + lx * 0.6, ey, er * 0.34, er * 0.42); fillC(x, acc('#ff8a5a'));
      ellPath(x, ex, ey + er * 0.5, er * 0.5, er * 0.2); fillC(x, rgba(INK, 0.5));
    } else if (style === 5) {
      ellPath(x, ex, ey, er * 1.04, er); fillC(x, acc('#f6f2e6'));
      ellPath(x, ex, ey, er * 1.04, er); strokeC(x, inkOf(), Math.max(0.8, er * 0.26));
      ellPath(x, ex + lx * 1.4, ey, er * 0.2, er * 0.2); fillC(x, accD('#3a2020'));
    } else {
      ellPath(x, ex, ey, er, er); fillC(x, acc('#fbf7ea'));
      ellPath(x, ex, ey, er, er); strokeC(x, inkOf(), Math.max(0.85, er * 0.28));
      ellPath(x, ex + lx, ey + er * 0.06, er * 0.52, er * 0.54); fillC(x, accD('#40281c'));
      circlePath(x, ex + lx - er * 0.22, ey - er * 0.24, er * 0.2); fillC(x, 'rgba(255,255,255,0.92)');
    }
  }
  /** 发光眼的色相按坐标错开, 免得一排怪的眼光一模一样 */
  function o6v(ex, ey, er) { return er > 0 ? (Math.abs(Math.sin(ex * 0.7 + ey * 0.3)) > 0.5 ? '#ff9a3a' : '#ff6a5a') : '#ff9a3a'; }
  /** 一对眼: 自动按 eye style 生成表情; dy 用来做"眯眼/惊讶" */
  function eyesAt(x, dx, dy, er, style, look, tilt) {
    var a = tilt || 0;
    /* v63: 腮红删掉 —— 它是「有表情的小动物」的线索, 与人眼一样指向恐怖谷(见 eyeAt 的素面小眼)。 */
    if (a) {
      x.save(); x.translate(-dx, 0); x.rotate(-a); eyeAt(x, 0, dy, er, style, look); x.restore();
      x.save(); x.translate(dx, 0); x.rotate(a); eyeAt(x, 0, dy, er, style, look); x.restore();
    } else {
      eyeAt(x, -dx, dy, er, style, look);
      eyeAt(x, dx, dy, er, style, look);
    }
  }
  /** 眉(愤怒/警觉的廉价表达): dir=1 内低外高 = 生气 */
  function brow(x, dx, dy, w, dir, col) {
    x.lineCap = 'round'; x.strokeStyle = acc(col || '#5a3a16'); x.lineWidth = Math.max(1.4, w * 0.34);
    x.beginPath(); x.moveTo(-dx - w / 2, dy + dir * w * 0.3); x.lineTo(-dx + w / 2, dy - dir * w * 0.3); x.stroke();
    x.beginPath(); x.moveTo(dx + w / 2, dy + dir * w * 0.3); x.lineTo(dx - w / 2, dy - dir * w * 0.3); x.stroke();
  }
  /** 嘴: kind 0 微笑 / 1 张开的圆口 / 2 尖牙 / 3 吸盘 / 4 鸟喙 / 5 大颚 / 6 折线(不快) */
  function mouthAt(x, cx, cy, w, h, kind, col) {
    var c = acc(col || '#4a2a22'), i;
    x.lineCap = 'round'; x.lineJoin = 'round';
    if (CUTE && (kind === 2 || kind === 3 || kind === 5)) {   /* v57 憨态: 尖牙/吸盘/大颚 -> 笑口 */
      x.beginPath();
      x.moveTo(cx - w * 0.5, cy - h * 0.2);
      x.quadraticCurveTo(cx, cy + h * 1.7, cx + w * 0.5, cy - h * 0.2);
      x.closePath(); fillC(x, acc('#9a3f38')); strokeC(x, inkOf(), Math.max(1, w * 0.13));
      ellPath(x, cx, cy + h * 0.66, w * 0.26, h * 0.4); fillC(x, acc('#f08a92'));
      return;
    }
    if (CUTE && kind === 6) kind = 0;                          /* 「不快」折线 -> 微笑 */    if (kind === 0) {
      x.beginPath(); x.moveTo(cx - w * 0.5, cy); x.quadraticCurveTo(cx, cy + h * 1.5, cx + w * 0.5, cy);
      x.strokeStyle = c; x.lineWidth = Math.max(1.3, w * 0.18); x.stroke();
    } else if (kind === 1) {
      ellPath(x, cx, cy, w * 0.5, h * 0.6); fillC(x, c);
      ellPath(x, cx, cy, w * 0.5, h * 0.6); strokeC(x, inkOf(), Math.max(1, w * 0.14));
      ellPath(x, cx - w * 0.12, cy + h * 0.18, w * 0.2, h * 0.2); fillC(x, rgba('#7a2a2a', 0.9));
    } else if (kind === 2) {
      x.beginPath(); x.moveTo(cx - w * 0.5, cy); x.lineTo(cx + w * 0.5, cy);
      x.quadraticCurveTo(cx + w * 0.2, cy + h * 1.1, cx - w * 0.5, cy); x.closePath();
      fillC(x, acc('#2a1414')); strokeC(x, inkOf(), Math.max(1, w * 0.12));
      for (i = 0; i < 4; i++) {
        x.beginPath();
        x.moveTo(cx - w * 0.4 + i * w * 0.26, cy);
        x.lineTo(cx - w * 0.32 + i * w * 0.26, cy + h * (i % 2 ? 0.9 : 0.6));
        x.lineTo(cx - w * 0.2 + i * w * 0.26, cy);
        x.closePath(); fillC(x, acc('#f6f0dc'));
      }
    } else if (kind === 3) {
      ellPath(x, cx, cy, w * 0.55, h * 0.7); fillC(x, acc('#5a2a30'));
      ellPath(x, cx, cy, w * 0.3, h * 0.4); fillC(x, acc('#26100f'));
      for (i = 0; i < 5; i++) { circlePath(x, cx + Math.cos(i / 5 * TAU) * w * 0.38, cy + Math.sin(i / 5 * TAU) * h * 0.5, w * 0.07); fillC(x, acc('#f0e0c0')); }
    } else if (kind === 4) {
      x.beginPath();
      x.moveTo(cx - w * 0.5, cy - h * 0.3); x.lineTo(cx + w * 0.72, cy); x.lineTo(cx - w * 0.5, cy + h * 0.3);
      x.closePath(); fillC(x, acc('#c8963c')); strokeC(x, inkOf(), Math.max(1, w * 0.12));
    } else if (kind === 5) {
      x.beginPath();
      x.moveTo(cx - w * 0.6, cy - h * 0.5); x.quadraticCurveTo(cx, cy + h * 1.2, cx - w * 0.16, cy + h * 0.1);
      x.quadraticCurveTo(cx, cy + h * 1.5, cx + w * 0.16, cy + h * 0.1);
      x.quadraticCurveTo(cx, cy + h * 1.2, cx + w * 0.6, cy - h * 0.5);
      x.closePath(); fillC(x, acc('#3a1a1a')); strokeC(x, inkOf(), Math.max(1, w * 0.1));
    } else {
      x.beginPath();
      x.moveTo(cx - w * 0.5, cy - h * 0.4); x.lineTo(cx - w * 0.16, cy + h * 0.3);
      x.lineTo(cx + w * 0.16, cy - h * 0.3); x.lineTo(cx + w * 0.5, cy + h * 0.4);
      x.strokeStyle = acc('#3a221a'); x.lineWidth = Math.max(1.4, w * 0.16); x.stroke();
    }
  }
  /** 尖叶(芽/叶片/菜叶的通用件): 从根部朝 ang 伸出, 带中脉与受光面 */
  function leafBlade(x, x0, y0, ang, len, wid, C, curl) {
    var ca = Math.cos(ang), sa = Math.sin(ang);
    var tx = x0 + ca * len, ty = y0 + sa * len;
    var px = -sa, py = ca, k = (curl === undefined ? 0.4 : curl);
    var mx = x0 + ca * len * 0.5 + px * len * k * 0.5, my = y0 + sa * len * 0.5 + py * len * k * 0.5;
    var mx2 = x0 + ca * len * 0.5 - px * len * k * 0.5, my2 = y0 + sa * len * 0.5 - py * len * k * 0.5;
    x.beginPath();
    x.moveTo(x0, y0);
    x.quadraticCurveTo(mx, my, tx, ty);
    x.quadraticCurveTo(mx2, my2, x0, y0);
    x.closePath();
    var g = x.createLinearGradient(x0, y0, tx, ty);
    g.addColorStop(0, acc(shade(C, -0.34)));
    g.addColorStop(0.5, acc(C));
    g.addColorStop(1, acc(shade(C, 0.26)));
    x.fillStyle = g; x.fill();
    x.strokeStyle = inkOf(); x.lineWidth = Math.max(1, wid * 0.22); x.lineJoin = 'round'; x.stroke();
    x.beginPath(); x.moveTo(x0 + ca * len * 0.1, y0 + sa * len * 0.1);
    x.quadraticCurveTo(mx, my, tx - ca * len * 0.1, ty - sa * len * 0.1);
    x.strokeStyle = rgba(acc(shade(C, -0.5)), 0.5); x.lineWidth = Math.max(0.7, wid * 0.13); x.stroke();
  }
  /** 翅/膜(虫与鸟): 半透明扇形 + 翅脉 */
  function wing(x, x0, y0, ang, len, wid, C, alpha) {
    var ca = Math.cos(ang), sa = Math.sin(ang), px = -sa, py = ca;
    x.beginPath();
    x.moveTo(x0, y0);
    x.quadraticCurveTo(x0 + ca * len * 0.5 + px * wid, y0 + sa * len * 0.5 + py * wid, x0 + ca * len, y0 + sa * len);
    x.quadraticCurveTo(x0 + ca * len * 0.5 - px * wid * 0.7, y0 + sa * len * 0.5 - py * wid * 0.7, x0, y0);
    x.closePath();
    x.fillStyle = rgba(acc(C), alpha === undefined ? 0.42 : alpha); x.fill();
    x.strokeStyle = rgba(inkOf(), 0.75); x.lineWidth = 1.2; x.stroke();
    x.beginPath(); x.moveTo(x0, y0); x.lineTo(x0 + ca * len * 0.9, y0 + sa * len * 0.9);
    x.strokeStyle = rgba(acc(shade(C, -0.4)), 0.7); x.lineWidth = 1; x.stroke();
  }
  /** 尖刺/角: 弯月形硬角(犄角南瓜/冲角羊/棘冠共用) */
  function horn(x, x0, y0, ang, len, wid, C, twist) {
    var ca = Math.cos(ang), sa = Math.sin(ang), px = -sa, py = ca;
    var t = (twist === undefined ? 0.5 : twist);
    x.beginPath();
    x.moveTo(x0 - px * wid * 0.5, y0 - py * wid * 0.5);
    x.quadraticCurveTo(x0 + ca * len * 0.55 + px * wid * 0.4 * t, y0 + sa * len * 0.55 + py * wid * 0.4 * t,
      x0 + ca * len, y0 + sa * len);
    x.quadraticCurveTo(x0 + ca * len * 0.5 - px * wid * 0.6, y0 + sa * len * 0.5 - py * wid * 0.6,
      x0 + px * wid * 0.5, y0 + py * wid * 0.5);
    x.closePath();
    var g = x.createLinearGradient(x0, y0, x0 + ca * len, y0 + sa * len);
    g.addColorStop(0, acc(shade(C, -0.28))); g.addColorStop(1, acc(shade(C, 0.34)));
    x.fillStyle = g; x.fill();
    x.strokeStyle = inkOf(); x.lineWidth = Math.max(1.1, wid * 0.2); x.stroke();
  }
  /** 爪(三趾): 掠食者的读点 */
  function claw(x, x0, y0, ang, len, C) {
    var i, a;
    for (i = -1; i <= 1; i++) {
      a = ang + i * 0.42;
      x.beginPath();
      x.moveTo(x0, y0);
      x.quadraticCurveTo(x0 + Math.cos(a) * len * 0.6, y0 + Math.sin(a) * len * 0.6 - len * 0.2,
        x0 + Math.cos(a) * len, y0 + Math.sin(a) * len);
      x.strokeStyle = inkOf(); x.lineWidth = 3.4; x.lineCap = 'round'; x.stroke();
      x.strokeStyle = acc(C); x.lineWidth = 1.9; x.stroke();
    }
  }
  /** 节肢体节(蠕虫/藤蔓): 用一串椭圆做出分节感, t 越大越细 */
  function segments(x, x0, y0, x1, y1, n, r0, r1, C, arc) {
    var i, t, cx, cy, rr, ca = Math.cos(arc || 0), sa = Math.sin(arc || 0), nx = -(y1 - y0), ny = (x1 - x0);
    var nl = Math.sqrt(nx * nx + ny * ny) || 1; nx /= nl; ny /= nl;
    for (i = 0; i < n; i++) {
      t = i / (n - 1);
      cx = x0 + (x1 - x0) * t + nx * Math.sin(t * Math.PI) * (arc || 0) * (y1 - y0) * 0.2;
      cy = y0 + (y1 - y0) * t + ny * Math.sin(t * Math.PI) * (arc || 0) * 8;
      rr = r0 + (r1 - r0) * t;
      ellPath(x, cx, cy, rr * (1 + ca * 0.05), rr * 0.92, 0);
      x.fillStyle = acc(shade(C, -0.06 + t * 0.16)); x.fill();
      x.strokeStyle = rgba(inkOf(), 0.85); x.lineWidth = Math.max(1.1, rr * 0.2); x.stroke();
      ellPath(x, cx - rr * 0.26, cy - rr * 0.3, rr * 0.34, rr * 0.2, -0.5);
      x.fillStyle = rgba(acc(shade(C, 0.42)), 0.4); x.fill();
    }
  }
  /** 根须/藤: 从一点发散的细长弯须 */
  function roots(x, x0, y0, n, len, spread, C, lw) {
    var i, a;
    for (i = 0; i < n; i++) {
      a = spread * (-0.5 + (i + 0.5) / n) + Math.PI / 2;
      x.beginPath();
      x.moveTo(x0, y0);
      x.quadraticCurveTo(x0 + Math.cos(a) * len * 0.6, y0 + Math.sin(a) * len * 0.55,
        x0 + Math.cos(a) * len * (0.7 + h2(i, 3.1) * 0.6), y0 + Math.sin(a) * len);
      x.strokeStyle = inkOf(); x.lineWidth = (lw || 2) + 1.6; x.lineCap = 'round'; x.stroke();
      x.strokeStyle = acc(C); x.lineWidth = lw || 2; x.stroke();
    }
  }
  /* ============================ 身份标识(精英 / Boss) ============================
   * 威胁等级必须"远看就能读": 平怪只有低饱和本体 + 一层深描边;
   * 精英 = 脚下金环 + 更重的体量;  Boss = 危险内发光 + 身体外二层轮廓 + 呼吸缩放。
   * **不画王冠**(v5.17, Codex, 2026-09-28, 用户逐字「不要这个王冠」): 旧版给精英画三尖金冠、
   *   Boss 画棘冠, 1.34r 宽、冠尖高到 1.24r/1.44r —— 缩到游戏实际尺寸后只是一坨金色色块,
   *   还会和模型出图自带的冠叠成双冠。档位区分仍由金环(精英)/红雾(Boss)/体量负责。
   * 全部烘焙进精灵 → 每帧 0 额外调用。 */
  /** 披风/斗篷(精英的体量感来源) */
  function capeOf(x, r, col) {
    x.beginPath();
    x.moveTo(-r * 0.82, -r * 0.12);
    x.quadraticCurveTo(-r * 1.5, r * 0.5, -r * 1.06, r * 1.06);
    x.quadraticCurveTo(0, r * 1.3, r * 1.06, r * 1.06);
    x.quadraticCurveTo(r * 1.5, r * 0.5, r * 0.82, -r * 0.12);
    x.closePath();
    var g = x.createLinearGradient(0, -r * 0.2, 0, r * 1.2);
    g.addColorStop(0, acc(shade(col, 0.12))); g.addColorStop(1, acc(shade(col, -0.44)));
    x.fillStyle = g; x.fill();
    x.strokeStyle = inkOf(); x.lineWidth = Math.max(1.5, r * 0.09); x.stroke();
    x.beginPath();
    x.moveTo(-r * 0.3, -r * 0.05); x.quadraticCurveTo(0, r * 0.6, r * 0.3, -r * 0.05);
    x.strokeStyle = rgba(acc(palette.gold), 0.55); x.lineWidth = Math.max(1, r * 0.06); x.stroke();
  }
  /** 精英脚下的金环(身份一眼可见, 且不占额外 draw call) */
  function ringOf(x, r, col) {
    x.beginPath(); x.ellipse(0, r * 0.74, r * 1.2, r * 0.44, 0, 0, TAU);
    strokeC(x, col, Math.max(2, r * 0.1));
    x.beginPath(); x.ellipse(0, r * 0.74, r * 1.2, r * 0.44, 0, 0, TAU);
    strokeC(x, rgba('#ffffff', 0.28), Math.max(0.8, r * 0.04));
  }
  /** 精英/Boss 的统一标识层(在形体之前画光环, 之后画王冠) */
  function tierRing(x, r, tier, C) {
    if (!tier) return;
    ringOf(x, r, tier === 2 ? rgba(palette.boss, 0.85) : rgba(palette.goldLite, 0.9));
  }
  function tierGlow(x, r, tier) {
    if (tier !== 2) return;
    var g = x.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.5);
    g.addColorStop(0, rgba(palette.boss, 0.18));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    circlePath(x, 0, 0, r * 1.5); fillC(x, g);
  }
  /* ============================ 形体元数据 ============================
   * wf  = 半宽系数(×r)          top = 上边界(×r, 角/镰臂/躯体用)
   * bot = 下边界(×r, 默认 0.95)  ph  = 动画节拍快慢
   * dir = 1 表示"有明确朝向", 用旋转而非翻转
   * tier = 1 精英 / 2 Boss —— **纯档位标记**(金环·红雾·精灵框都要用它);
   *   v5.17 起王冠已摘除, 这个字段不再代表任何头饰。 */
  var SHAPE = {
    /* 数值口径(改轮廓后必须重跑工具再回来改表, 否则精灵框会把怪裁成半只, 规范 §7):
     *   wf  = work/emeas53.cjs 实测「全部绘制」半宽 / r
     *   top = max(实测上高, 实测下高) / r
     *   vs  = 逐族视觉缩放(判定半径 r 是玩法数值, 一律不动): work/calc-vs53.cjs 实测「不透明半宽」
     *         op/r 后按 vs = max(BODY_VIS_SCALE, BODY_COVER / op) 反推 —— 画得太瘦的族(细茎 spitweed
     *         0.57 / 籽 splitseed 0.64 / 小虫 hopper 0.82)补得最多, 让「画出来的身子」盖住判定圈,
     *         治用户的两条抱怨: ① 怪看着小 ② 弹丸在身子外面就命中(打空气)。 */
    /* ---- 平怪(低饱和土腥异形) ---- */
    sprout:    { wf: 1.33, top: 2.12, ph: 1, vs: 1.16 },
    hopper:    { wf: 1.31, top: 1.32, ph: 2, vs: 1.49 },
    thug:      { wf: 2.05, top: 1.75, ph: 1, vs: 1.15 },
    spitweed:  { wf: 1.31, top: 1.32, ph: 1, vs: 2.14 },
    charger:   { wf: 1.56, top: 1.32, ph: 2, dir: 1, vs: 1.15 },
    buzzling:  { wf: 1.56, top: 1.37, ph: 3, vs: 1.15 },
    fly:       { wf: 1.31, top: 1.32, ph: 3, vs: 1.15 },
    rockling:  { wf: 1.89, top: 1.43, ph: 1, vs: 1.16 },
    splitpod:  { wf: 1.39, top: 2.13, ph: 1, vs: 1.25 },
    splitseed: { wf: 1.38, top: 1.52, ph: 2, vs: 2.12 },
    cackler:   { wf: 2.31, top: 1.46, ph: 2, vs: 1.28 },
    lamprey:   { wf: 1.56, top: 1.32, ph: 2, dir: 1, vs: 1.55 },   /* 1.15 -> 1.55: 摘冠后实测高 0.92×判定圈(v5.17) */
    slasher:   { wf: 1.67, top: 1.33, ph: 2, dir: 1, vs: 1.15 },
    tentacle:  { wf: 1.36, top: 2.56, ph: 2, vs: 1.26 },
    /* bonehead: src/data/enemies.js 里是 tentacle 的非枚举别名, src/core/game.js 的 necro 分支会 spawn 它。
     * v53 前 FOES / SHAPE 双缺 -> 出生即被 drawShape 兜底成通用圆怪。按 tentacle 同形同值补齐。 */
    bonehead:  { wf: 1.36, top: 2.56, ph: 2, vs: 1.20 },
    soilheap:  { wf: 1.98, top: 1.41, ph: 1, vs: 1.15 },
    rotstump:  { wf: 1.31, top: 1.78, ph: 1, vs: 1.25 },
    mobrage:   { wf: 1.31, top: 1.33, ph: 2, vs: 1.15 },
    finling:   { wf: 1.95, top: 1.53, ph: 3, dir: 1, vs: 1.15 },
    herbwife:  { wf: 1.52, top: 2.30, ph: 2, vs: 1.15 },
    hornpumpkin: { wf: 1.35, top: 1.52, ph: 1, vs: 1.15 },
    hornpod:   { wf: 1.56, top: 1.32, ph: 2, dir: 1, vs: 1.35 },   /* 1.15 -> 1.35: 摘冠后实测高 1.05×判定圈(v5.17) */
    crothief:  { wf: 2.19, top: 1.41, ph: 3, dir: 1, vs: 1.15 },
    rootthrall: { wf: 1.31, top: 1.33, ph: 2, vs: 1.15 },
    /* ---- 精英档 ---- */
    scythemantis: { wf: 1.64, top: 1.33, ph: 2, dir: 1, tier: 1, vs: 1.15 },
    earthmother: { wf: 1.56, top: 2.07, ph: 1, tier: 1, vs: 1.15 },
    asceticradish: { wf: 1.31, top: 1.44, ph: 1, tier: 1, vs: 1.15 },
    ironrhizo: { wf: 1.63, top: 1.61, ph: 1, tier: 2, vs: 1.15 },
    elBrute:   { wf: 1.82, top: 1.30, ph: 1, tier: 1, vs: 1.15 },
    elWeaver:  { wf: 1.60, top: 1.83, ph: 1, tier: 1, vs: 1.15 },
    elReaper:  { wf: 1.64, top: 1.33, ph: 2, dir: 1, tier: 1, vs: 1.22 },   /* 1.15 -> 1.22: 摘冠后实测高 1.17×判定圈(v5.17) */
    /* ---- Boss 档 ---- */
    soulvine:  { wf: 1.68, top: 1.56, ph: 1, tier: 2, vs: 1.15 },
    kingTuber: { wf: 1.56, top: 1.57, ph: 1, tier: 2, vs: 1.15 },
    elderBlight: { wf: 1.80, top: 1.62, ph: 1, tier: 2, vs: 1.15 },
    _def:      { wf: 1.40, top: 1.40, ph: 1, vs: 1.15 }
  };
  function meta(key) { return SHAPE[key] || SHAPE._def; }

  /* ============================ 怪物 34 只 ============================
   * 造型规范: qa/enemy-art-spec.md(克苏鲁 x 异形)。三条硬约束:
   *   1) 每只 <=14 图元  2) 20px 上"轮廓 + 1 个特征件"唯一可辨  3) 主体比地面亮一档
   * 配色纪律: 一律用第 4 参 C 派生(shade / mix / rgba), 固定色(体液/内里/骨)一律过 acc / accD
   *   —— 白闪与冰冻换色才不会漏。禁用 mouthAt kind 0(微笑) 与 eyeAt style 0(萌系圆眼)。
   * 图元计数口径见规范 0.1: volume / slab / 路径+fill / limb / leg / eyeAt / mouthAt /
   *   horn / claw / leafBlade / wing / segments / roots / capeOf 各算 1, 每条独立 stroke 短线圈算 1。 */
  var GOO = '#f0a08c';        /* 口腔内膜 / 软组织(暖珊瑚, v57 从血腥暗红 #481d1d 改亮) */
  var BONE = '#f6ecc4';       /* 外露壳 / 种子亮面(奶白, v57 从骨灰 #c9c3ae 改亮) */  var BONE = '#c9c3ae';       /* 外露骨/甲壳亮色 */

  /* ---- 共享材质常量(规范 §7: 函数体内不许再出现硬编码 hex; 全部要过 acc/accD, 白闪/冰冻才不漏色) ---- */
  var WET   = '#fffdf4';      /* 湿点高光(每只怪固定 1 处, 一律 rgba(WET, .26~.34)) */
  var PITH  = '#a8825a';      /* 空洞/内腔的暖褐内里(v57 从焦褐 #2b1d16 提亮) */
  var SOCK  = '#8a6c56';      /* 壳罩里的暗面(v57 从近黑 #241a12 提亮) */
  var VOID  = '#6d6a52';      /* 洞底(v57 从近黑冷绿 #0f1a12 改成灰橄榄: 有深度, 不再是黑洞) */
  var DRY   = '#a08a56';      /* 干枯木 / 接缝(v57 从 #2b2416 提亮) */
  var SEAM  = '#ffd9a0';      /* ironrhizo 甲缝透光(v57 从血红 #cc5548 改成暖光) */
  var SEEDC = '#c8e08a';      /* 裂荚籽嫩绿(与 splitpod 同源, 规范 §4-29) */

  /* ---- 主体视觉放大(用户: 怪物建模有点小 / 弹丸像打空气) ----
   * 判定半径 r 归玩法层, 这里一个像素都不动; 只把"画出来的身子"按 vs(逐族, 见 SHAPE)放大。
   *   BODY_VIS_SCALE = 全局下限: 所有族先统一 +15%;
   *   BODY_COVER     = 覆盖目标: 不透明半宽 >= 1.22r(即全身宽 >= 2.44r), 盖住判定圈(直径 2r)。
   * vs = max(BODY_VIS_SCALE, BODY_COVER / 实测不透明半宽比) —— 由 work/calc-vs53.cjs 反推。 */
  var BODY_VIS_SCALE = 1.15;
  var BODY_COVER = 1.22;

  /* ---- 憨态开关(v57: 用户「怪物让我生理不适」-> 卡通憨态五官) ----
   * 进 paintEnemy 之前置 1: 眼/嘴一律走「大圆眼 + 笑口 + 腮红」; 细瞳/复眼/发光眼/
   * 大颚/吸盘/尖牙这些「恶心感」的来源全部被替换。离开时归 0, 玩家与武器不受影响。 */
  var CUTE = 0, CUTE_ER = 4;

  /* ---- 蔬菜明色调(v57: 替换旧的「冷暖对撞」冷压) ----
   * 每只怪的主色就是数据里那一味蔬菜(src/data/enemies.js 的 color: 番茄红 / 胡萝卜橙 /
   *   青菜绿 / 玉米黄 / 茄子紫 / 萝卜白), 这里只做两件事:
   *   1) 提饱和 ×1.35 -> 在低饱和的暖棕地面上跳出剪影(R1.6 明度差仍然成立);
   *   2) 明度抬到 0.50 以上、封在 0.80 以下 -> 比地面(L 13~27)亮 >= 2 档, 又不发白。
   * 旧版是「往冷锚混 62% + 明度夹到 0.33~0.47」, 那正是「暗紫 / 灰黑 / 克苏鲁感」的来源,
   *   也是用户说不适的直接原因; v57 整段删掉, 只保留「比地面亮」这条硬指标。
   * 只作用于普通态; 白闪(1)/冰冻(2) 走 acc/accD 原逻辑。 */
  var FOE_LUM_LO = 0.54, FOE_LUM_HI = 0.80;   /* v58: 0.50 -> 0.54(再亮一档, 地面 L13~27 差 >= 2 档) */
  /* 数据色偏灰/偏暗的族(v57): 「灰黑当主色」本身也是不适感的来源, 换成明确的蔬菜色。
   * 只替换色彩通道, 形状与判定半径一律不动。 */
  /* v58(用户逐字): 「这些怪物让我感到生理不适」+「配色要明亮饱和的蔬菜系(番茄红/胡萝卜橙/青菜绿/
   *   茄子紫/玉米黄…), 去掉暗紫与灰黑当主色」。下表把数据里偏灰/偏暗/偏土的族**只换色彩通道**
   *   (形状与判定半径一律不动), 每只保留自己的色相, 只把彩度/明度提到「菜」的档位。
   *   左=src/data/enemies.js 的 color, 右=替换理由。 */
  var FOE_VEG = {
    sprout: '#86cc52',      /* #7a9a4a 灰橄榄   -> 青菜绿(芽芽怪) */
    hopper: '#f0b35c',      /* #e0a05a 土黄     -> 胡萝卜橙 */
    thug: '#e8944a',        /* #a06a4a 土棕     -> 烤土豆橙 */
    spitweed: '#9ed86a',    /* #8fae5a 橄榄绿   -> 豌豆绿 */
    charger: '#f2913c',     /* #d86a4a 砖红     -> 南瓜橙 */
    buzzling: '#f2c73c',    /* #d8c05a 芥末黄   -> 玉米黄 */
    fly: '#8fd05a',         /* #9aa86a 灰橄榄   -> 菜青绿 */
    rockling: '#e0b060',    /* #6a7a8a 石板灰   -> 姜黄 */
    soilheap: '#d8a95c',    /* #8a7a5a 灰土     -> 亮壤土 */
    rotstump: '#dcb069',    /* #7a6a4a 暗木     -> 干木黄 */
    mobrage: '#e8533f',     /* #c05a5a 哑红     -> 番茄红 */
    lamprey: '#66c2d8',     /* #4a7a8a 暗青     -> 蓝莓青 */
    herbwife: '#8fe09a',    /* #7ed08a 草绿     -> 薄荷绿 */
    cackler: '#b57ce0',     /* #8a6aa8 暗紫     -> 茄子紫 */
    slasher: '#d6547a',     /* #8a4a5a 暗酒红   -> 甜菜红 */
    tentacle: '#6cc24a',    /* #5a6a4a 灰绿     -> 青菜绿(腐沼触手) */
    bonehead: '#6cc24a',    /* 数据里是 tentacle 的非枚举别名(enemies.js:81) —— 同形必须同色 */
    crothief: '#7fb2e8',    /* #5a5a6a 灰蓝     -> 蓝莓蓝 */
    rootthrall: '#7ac24a',  /* #6a8a4a 暗草绿   -> 菜青绿 */
    ironrhizo: '#e8c04e',   /* #9a7a5a 灰棕     -> 玉米黄 */
    soulvine: '#a86bd6',    /* #3a2a5a 近黑紫   -> 茄子紫 */
    elBrute: '#f0913a',     /* #c05a3a 铁锈红   -> 南瓜橙 */
    elWeaver: '#8cc46a',    /* #7a8a9a 石像灰   -> 石像青瓜绿 */
    elReaper: '#5cba6a',    /* #4a8a5a 暗绿     -> 青菜绿(鳄皮冬瓜) */
    kingTuber: '#9b52cf',   /* #8a2a4a 暗酒红   -> 紫薯紫(Boss); v59 去粉(「粉色肉块」读感) */
    earthmother: '#c86ad0', /* #8a6a8a 灰紫     -> 洋苏紫(Boss); v59 提亮去粉(「粉色肉块」读感) */
    hornpumpkin: '#f0a03c', /* #c07a3a 暗橙     -> 南瓜橙 */
    elderBlight: '#8fc45a'  /* #2a5a3a 近黑绿(用户: 去掉灰黑当主色) -> 干草黄绿 */
  };
  function foeTone(C, k) {
    var h = satAdj(C, k === undefined ? 1.35 : k), l = lum(h);
    if (l < FOE_LUM_LO) h = shade(h, Math.min(0.88, (FOE_LUM_LO - l) / Math.max(0.08, 1 - l)));
    else if (l > FOE_LUM_HI) h = shade(h, -Math.min(0.6, (l - FOE_LUM_HI) / Math.max(0.08, l)));
    return h;
  }
  /* 01 芽芽怪 —— 破壳肉苗: 鼓胀湿壳 + 两片不对称张开的肉质颚叶 + 一大一小两只竖瞳眼 */
  function fSprout(x, r, ph, C) {
    var sw = Math.sin(ph) * r * 0.10, i, s, len;
    groundShadow(x, r, 0.86, 0.30);
    volume(x, r * 0.86, function () { polyPath(x, [
        -r * 0.572, r * 0.425, -r * 0.535, r * 0.012, -r * 1.214, -r * 0.594,
        -r * 0.461, -r * 0.137, -r * 0.348, -r * 0.804, -r * 0.291, -r * 1.782,
        r * 0.077, -r * 0.604, r * 0.507, -r * 2.030, r * 0.574, -r * 1.139, r * 0.481, -r * 0.352,
        r * 0.763, r * 0.163, r * 0.595, r * 1.317]); }, C, { lw: Math.max(1.4, r * 0.13) });
    ellPath(x, -r * 0.34, -r * 0.02, r * 0.28, r * 0.15, -0.5); fillC(x, rgba(WET, 0.30));
    polyPath(x, [-r * 0.12, -r * 0.52, r * 0.06, -r * 0.34, r * 0.44, -r * 0.16, r * 0.22, -r * 0.04]);
    fillC(x, accD(GOO));
    polyPath(x, [r * 0.06, -r * 0.34, r * 0.44, -r * 0.16, r * 0.16, -r * 0.02, r * 0.30, -r * 0.22, r * 0.12, -r * 0.26]);
    fillC(x, acc(shade(C, 0.10)));
    for (i = 0; i < 2; i++) {
      s = i ? 1 : -1; len = r * (i ? 0.84 : 1.25);
      volume(x, r * 0.62, function () {
        polyPath(x, [s * r * 0.34, -r * 0.46, s * len * 0.80, -r * (i ? 0.90 : 1.16) + sw * (i ? 1 : -1),
          s * len * 0.98, -r * 0.62, s * len * 0.70, -r * 0.18, s * r * 0.26, -r * 0.04]);
      }, shade(C, i ? -0.10 : 0.18), { lw: Math.max(1.2, r * 0.11) });
    }
    eyeAt(x, -r * 0.30, -r * 0.30, Math.max(1.3, r * 0.15), 1, 0.4);
    eyeAt(x, r * 0.34, -r * 0.42, Math.max(0.9, r * 0.07), 1, 0.4);
    limb(x, -r * 0.20, r * 0.50, -r * 0.55, r * 0.95, r * 0.16, shade(C, -0.35), Math.max(1.4, r * 0.10));
    limb(x, r * 0.20, r * 0.50, r * 0.62, r * 0.90, -r * 0.14, shade(C, -0.35), Math.max(1.4, r * 0.10));
    ellPath(x, r * 0.62, r * 0.42, Math.max(0.8, r * 0.08), Math.max(0.6, r * 0.06)); fillC(x, acc(GOO));
    x.beginPath(); x.moveTo(r * 0.62, r * 0.36); x.lineTo(r * 0.66, r * 0.62);
    strokeC(x, acc(GOO), Math.max(1, r * 0.07));
  }

  /* 02 田埂壮汉 —— 往前推的湿肉墙: 上宽 0.95r 下窄 0.70r, 一道纵裂从锁骨到腹, 右肩单根骨刺 */
  function fThug(x, r, ph, C) {
    var sw = Math.sin(ph) * r * 0.05;
    groundShadow(x, r, 1.0, 0.32);
    volume(x, r * 1.15, function () {
      polyPath(x, [
        -r * 1.094, -r * 0.969, r * 1.055, -r * 1.081, r * 1.007, -r * 0.400,
        r * 1.244, -r * 0.145, r * 1.043, -r * 0.008, r * 1.293, r * 0.633, r * 1.285, r * 1.670,
        r * 0.502, r * 1.248, r * 0.295, r * 0.373, -r * 0.321, r * 0.386, -r * 0.623, r * 1.392,
        -r * 0.729, r * 1.102, -r * 0.572, r * 0.425, -r * 1.028, -r * 0.006,
        -r * 1.970, -r * 0.222, -r * 1.970, -r * 0.701]);
    }, C, { lw: Math.max(1.6, r * 0.14) });
    slab(x, function () { polyPath(x, [-r * 0.94, -r * 0.24, -r * 0.86, -r * 0.54, -r * 0.34, -r * 0.62, -r * 0.44, -r * 0.34]); },
      shade(C, -0.28), Math.max(1.2, r * 0.10));
    slab(x, function () { polyPath(x, [r * 0.44, -r * 0.34, r * 0.34, -r * 0.62, r * 0.84, -r * 0.54, r * 0.94, -r * 0.22]); },
      shade(C, -0.18), Math.max(1.2, r * 0.10));
    horn(x, r * 0.72, -r * 0.62, -0.55, r * 0.85, r * 0.24, shade(C, 0.16), 0.3);
    polyPath(x, [-r * 0.06, -r * 0.50, r * 0.16, -r * 0.10, r * 0.24, r * 0.58, r * 0.14, r * 0.60,
      -r * 0.24, r * 0.20, -r * 0.06, -r * 0.10]);
    fillC(x, accD(GOO));
    polyPath(x, [-r * 0.06, -r * 0.10, r * 0.16, -r * 0.10, r * 0.06, r * 0.16, r * 0.18, r * 0.06,
      r * 0.02, r * 0.34, -r * 0.06, r * 0.24]);
    fillC(x, acc(shade(C, 0.34)));
    eyeAt(x, -r * 0.28, -r * 0.62, Math.max(1.4, r * 0.13), 1, 0.2);
    eyeAt(x, r * 0.34, -r * 0.72 - sw, Math.max(0.9, r * 0.06), 1, 0.2);
    limb(x, -r * 0.70, r * 0.20, -r * 1.02, r * 0.85, r * 0.20, shade(C, -0.30), Math.max(1.8, r * 0.13));
    limb(x, r * 0.72, r * 0.20, r * 0.98, r * 0.80, -r * 0.18, shade(C, -0.30), Math.max(1.8, r * 0.13));
    leg(x, -r * 0.32, r * 0.90, -r * 0.45, r * 1.32, -r * 0.50, r * 1.10, Math.max(1.5, r * 0.12), shade(C, -0.40));
    leg(x, r * 0.34, r * 0.90, r * 0.50, r * 1.30, r * 0.52, r * 1.08, Math.max(1.5, r * 0.12), shade(C, -0.40));
  }

  /* 03 肥土墩 —— 一垛沤烂发酵的肉土: 顶上 3 个大小不齐的囊泡, 底部一圈短根须 */
  function fSoilheap(x, r, ph, C) {
    var br = Math.sin(ph) * r * 0.05;
    groundShadow(x, r, 1.06, 0.34);
    volume(x, r * 0.98, function () { polyPath(x, [
        -r * 1.693, r * 0.596, -r * 1.645, r * 0.115, -r * 1.176, -r * 0.384,
        -r * 1.023, -r * 0.204, -r * 1.018, r * 0.116, -r * 0.368, r * 0.008,
        -r * 0.426, -r * 1.009, -r * 0.108, -r * 0.927, r * 0.003, -r * 0.175,
        r * 0.185, -r * 0.338, r * 0.811, -r * 0.433, r * 0.941, -r * 0.527, r * 0.601, r * 0.047,
        r * 1.088, r * 0.395, r * 1.906, r * 0.846, r * 0.883, r * 0.509]); }, C, { lw: Math.max(1.6, r * 0.14) });
    x.beginPath(); x.moveTo(-r * 0.52, -r * 0.34); x.quadraticCurveTo(0, -r * 0.02, r * 0.60, -r * 0.42);
    strokeC(x, acc(shade(C, -0.45)), Math.max(1.4, r * 0.12));
    volume(x, r * 0.42, function () { circlePath(x, -r * 0.40, -r * 0.84, r * 0.42 + br); }, shade(C, 0.20), { lw: Math.max(1.2, r * 0.11) });
    volume(x, r * 0.30, function () { circlePath(x, r * 0.34, -r * 0.72, r * 0.30 - br * 0.5); }, shade(C, 0.10), { lw: Math.max(1.1, r * 0.10) });
    circlePath(x, r * 0.78, -r * 0.34, r * 0.20);
    fillC(x, acc(shade(C, 0.04))); strokeC(x, inkOf(), Math.max(1, r * 0.09));
    ellPath(x, -r * 0.44, -r * 0.94, r * 0.11, r * 0.07, -0.4); fillC(x, rgba(WET, 0.34));
    polyPath(x, [-r * 0.58, -r * 1.02, -r * 0.30, -r * 1.10, -r * 0.36, -r * 0.84]); fillC(x, accD(GOO));
    eyeAt(x, r * 0.05, -r * 0.10, Math.max(1.2, r * 0.10), 1, 0.1);
    roots(x, -r * 0.90, r * 0.70, 5, r * 0.42, 0.9, shade(C, -0.40), Math.max(1.2, r * 0.09));
    roots(x, r * 0.90, r * 0.70, 4, r * 0.36, 0.9, shade(C, -0.40), Math.max(1.2, r * 0.09));
    ellPath(x, r * 0.50, r * 0.72, Math.max(0.9, r * 0.09), Math.max(0.7, r * 0.07)); fillC(x, acc(GOO));
    x.beginPath(); x.moveTo(r * 0.50, r * 0.60); x.lineTo(r * 0.62, r * 0.95);
    strokeC(x, acc(GOO), Math.max(1, r * 0.08));
  }

  /* 04 剁菜螳螂(精英) —— 前倾的三角甲壳块, 两把长短不等的骨镰向前伸出, 背甲缝里露湿肉 */
  function fElBrute(x, r, ph, C) {
    var sw = Math.sin(ph) * r * 0.10;
    groundShadow(x, r, 1.5, 0.34, r * 0.62);
    volume(x, r * 1.05, function () {
      polyPath(x, [-r * 0.55, r * 0.55, -r * 0.60, -r * 0.18, -r * 0.16, -r * 0.52, r * 0.44, -r * 0.46,
        r * 0.80, -r * 0.06, r * 0.62, r * 0.46, -r * 0.10, r * 0.66]);
    }, C, { lw: Math.max(1.6, r * 0.14) });
    slab(x, function () { polyPath(x, [-r * 0.50, -r * 0.24, -r * 0.08, -r * 0.56, r * 0.40, -r * 0.50, r * 0.30, -r * 0.20]); },
      shade(C, -0.30), Math.max(1.2, r * 0.10));
    slab(x, function () { polyPath(x, [-r * 0.34, -r * 0.02, r * 0.10, -r * 0.32, r * 0.48, -r * 0.22, r * 0.22, r * 0.06]); },
      shade(C, -0.20), Math.max(1.2, r * 0.10));
    x.beginPath(); x.moveTo(-r * 0.20, -r * 0.44); x.lineTo(r * 0.42, -r * 0.36);
    strokeC(x, accD(GOO), Math.max(1.4, r * 0.09));
    limb(x, r * 0.50, -r * 0.30, r * 1.35, -r * 0.95 + sw, -r * 0.25, shade(C, -0.22), Math.max(1.8, r * 0.13));
    volume(x, r * 0.45, function () {
      polyPath(x, [r * 1.30, -r * 1.02 + sw, r * 1.72, -r * 0.44 + sw, r * 1.24, -r * 0.56 + sw, r * 1.16, -r * 0.86 + sw]);
    }, shade(C, 0.12), { lw: Math.max(1.2, r * 0.10) });
    limb(x, -r * 0.50, -r * 0.30, -r * 1.10, -r * 0.70 - sw, 0.22, shade(C, -0.22), Math.max(1.8, r * 0.13));
    volume(x, r * 0.36, function () {
      polyPath(x, [-r * 1.06, -r * 0.76 - sw, -r * 1.40, -r * 0.22 - sw, -r * 1.00, -r * 0.32 - sw, -r * 0.92, -r * 0.60 - sw]);
    }, shade(C, 0.08), { lw: Math.max(1.1, r * 0.09) });
    claw(x, r * 0.10, r * 0.35, 0.5, Math.max(2, r * 0.42), shade(C, -0.35));
    leg(x, -r * 0.50, r * 0.50, -r * 0.75, r * 1.15, -r * 0.80, r * 0.90, Math.max(1.4, r * 0.11), shade(C, -0.40));
    leg(x, r * 0.50, r * 0.50, r * 0.80, r * 1.10, r * 0.82, r * 0.88, Math.max(1.4, r * 0.11), shade(C, -0.40));
    eyeAt(x, r * 0.28, -r * 0.50, Math.max(1.5, r * 0.14), 2, 0.1);
    eyeAt(x, -r * 0.22, -r * 0.56, Math.max(1.0, r * 0.08), 2, 0.1);
  }

  /* 05 冲角羊 —— 前重后轻的骨镞: 左侧一根折断的角, 脸上没有眼睛只有一道横向感应裂 */
  function fCharger(x, r, ph, C) {
    var s = Math.sin(ph) * r * 0.08;
    groundShadow(x, r, 1.5, 0.34, r * 0.62);
    volume(x, r * 1.15, function () {
      polyPath(x, [-r * 0.72, r * 0.46, -r * 0.80, -r * 0.10, -r * 0.20, -r * 0.54, r * 0.52, -r * 0.50,
        r * 0.96, -r * 0.10, r * 0.70, r * 0.44, -r * 0.06, r * 0.58]);
    }, C, { lw: Math.max(1.5, r * 0.14) });
    slab(x, function () { polyPath(x, [r * 0.30, -r * 0.52, r * 1.00, -r * 0.30, r * 0.94, -r * 0.02, r * 0.20, -r * 0.14]); },
      shade(C, 0.24), Math.max(1.3, r * 0.11));
    horn(x, r * 0.35, -r * 0.55, -0.7, r * 0.85, r * 0.22, shade(C, -0.15), 0.5);
    polyPath(x, [r * 0.88, -r * 1.02, r * 1.06, -r * 0.94, r * 0.94, -r * 0.80]); fillC(x, acc(shade(C, 0.40)));
    polyPath(x, [-r * 0.15, -r * 0.16, r * 0.30, -r * 0.06, r * 0.75, r * 0.02, r * 0.72, r * 0.16, r * 0.28, r * 0.08, -r * 0.15, 0]);
    fillC(x, accD(GOO));
    polyPath(x, [-r * 0.10, -r * 0.02, r * 0.14, r * 0.02, r * 0.24, r * 0.12, r * 0.36, r * 0.02, r * 0.52, r * 0.10, r * 0.62, 0]);
    fillC(x, acc(shade(C, 0.30)));
    ellPath(x, -r * 0.42, -r * 0.34, r * 0.24, r * 0.13, -0.5); fillC(x, rgba(WET, 0.26));
    leg(x, -r * 0.25, r * 0.50, -r * 0.45, r * 1.10, -r * 0.50, r * 0.85, Math.max(1.4, r * 0.11), shade(C, -0.40));
    leg(x, r * 0.30, r * 0.50, r * 0.55, r * 1.05, r * 0.55, r * 0.82, Math.max(1.4, r * 0.11), shade(C, -0.40));
    limb(x, -r * 0.50, r * 0.30, -r * 0.95, r * 0.60, r * 0.20, shade(C, -0.30), Math.max(1.3, r * 0.10));
    ellPath(x, r * 0.90, r * 0.30, Math.max(0.8, r * 0.07), Math.max(0.6, r * 0.05)); fillC(x, acc(GOO));
    x.beginPath(); x.moveTo(r * 0.75, r * 0.30); x.lineTo(r * 1.15, r * 0.35 + s * 0.2);
    strokeC(x, rgba(acc(shade(C, 0.30)), 0.75), Math.max(1, r * 0.07));
  }

  /* 06 蜂鸣虫(r9, 最小尺寸) —— 4 节细长肉虫 + 尾针 + 成对复眼簇, 足数固定 2 */
  function fBuzzling(x, r, ph, C) {
    var wf = Math.sin(ph) * 0.35;
    groundShadow(x, r, 1.5, 0.3, r * 0.34);
    segments(x, -r * 0.55, 0, r * 0.55, 0, 4, r * 0.24, r * 0.14, C, 0.12);
    x.beginPath(); x.moveTo(-r * 0.60, -r * 0.12); x.lineTo(r * 0.60, -r * 0.14);
    strokeC(x, acc(shade(C, -0.32)), Math.max(1, r * 0.10));
    eyeAt(x, -r * 0.18, -r * 0.20, Math.max(0.9, r * 0.09), 2, 0);
    eyeAt(x, r * 0.06, -r * 0.24, Math.max(0.9, r * 0.09), 2, 0);
    horn(x, r * 0.55, r * 0.02, 0.1 + wf * 0.08, r * 0.75, r * 0.10, shade(C, -0.30), 0);
    leg(x, -r * 0.34, r * 0.16, -r * 0.55, r * 0.62, -r * 0.50, r * 0.42, Math.max(1, r * 0.08), shade(C, -0.35));
    leg(x, r * 0.06, r * 0.16, r * 0.10, r * 0.60, r * 0.20, r * 0.40, Math.max(1, r * 0.08), shade(C, -0.35));
    wing(x, -r * 0.20, -r * 0.20, -1.15 - wf * 0.25, r * 0.75, r * 0.30, shade(C, 0.30), 0.40);
    wing(x, r * 0.20, -r * 0.20, -0.70 + wf * 0.25, r * 0.72, r * 0.30, shade(C, 0.30), 0.40);
    claw(x, r * 0.62, -r * 0.06, -0.2, Math.max(1.6, r * 0.30), shade(C, -0.20));
    ellPath(x, -r * 0.30, r * 0.22, r * 0.14, r * 0.08, -0.3); fillC(x, rgba(WET, 0.28));
  }

  /* 07 块茎之王(Boss) —— 会走的湿肉丘: 中央一条贯通纵裂, 裂里两排牙, 背脊三根不等距骨刺 */
  function fKingTuber(x, r, ph, C) {
    var br = Math.sin(ph) * r * 0.03, ta = Math.sin(ph) * r * 0.05;
    groundShadow(x, r, 1.05, 0.34);
    volume(x, r * 0.95, function () { blobPath(x, 0, r * 0.10, r * 0.95, 0.14, 7); }, C, { lw: Math.max(1.8, r * 0.13) });
    ellPath(x, -r * 0.36, -r * 0.42, r * 0.33, r * 0.17, -0.5); fillC(x, rgba(WET, 0.30));
    polyPath(x, [-r * 0.06, -r * 0.84, r * 0.20, -r * 0.40, r * 0.30, r * 0.10, r * 0.16, r * 0.72,
      r * 0.16, r * 0.80, -r * 0.10, r * 0.78, -r * 0.22, r * 0.20, -r * 0.14, -r * 0.40]);
    fillC(x, acc(shade(C, 0.30)));
    mouthAt(x, 0, r * 0.10, r * 0.62, r * 0.20, 0, acc('#8a4a3a'));
    horn(x, -r * 0.50, -r * 0.50, -1.15, r * 0.60 + br, r * 0.20, shade(C, 0.20), 0.2);
    horn(x, -r * 0.20, -r * 0.70, -1.35, r * 0.75 + br, r * 0.22, shade(C, 0.20), 0.2);
    horn(x, r * 0.28, -r * 0.72, -1.50, r * 0.55 + br, r * 0.18, shade(C, 0.20), 0.2);
    limb(x, -r * 0.85, r * 0.35, -r * 1.50, r * 0.90 + ta, 0.30, shade(C, -0.30), Math.max(1.6, r * 0.12));
    limb(x, r * 0.85, r * 0.35, r * 1.45, r * 0.82 - ta, -0.28, shade(C, -0.30), Math.max(1.6, r * 0.12));
    eyeAt(x, -r * 0.42, -r * 0.75, Math.max(1.5, r * 0.13), 1, 0.1);
    eyeAt(x, r * 0.46, -r * 0.82, Math.max(1.0, r * 0.07), 1, 0.1);
    ellPath(x, r * 0.70, r * 0.60, Math.max(1, r * 0.13), Math.max(0.8, r * 0.10)); fillC(x, acc(shade(C, 0.30)));
    x.beginPath(); x.moveTo(r * 0.70, r * 0.50); x.lineTo(r * 0.78, r * 0.92);
    strokeC(x, acc(shade(C, 0.26)), Math.max(1.2, r * 0.08));
  }

  /* 08 烂心老桩 —— 枯桩外壳正面被掏空: 洞里塞湿肉与触须, 顶上压一顶歪伞盖 */
  function fRotstump(x, r, ph, C) {
    var tg = Math.sin(ph) * r * 0.08;
    groundShadow(x, r, 0.98, 0.32);
    volume(x, r * 1.05, function () {
      polyPath(x, [-r * 0.40, -r * 0.50, -r * 0.34, r * 0.18, -r * 0.92, r * 0.74, -r * 0.44, r * 1.14,
        r * 0.38, r * 1.14, r * 0.92, r * 0.72, r * 0.40, r * 0.16, r * 0.46, -r * 0.50]);
    }, C, { lw: Math.max(1.6, r * 0.14) });
    x.beginPath(); x.moveTo(-r * 0.30, -r * 0.50); x.lineTo(-r * 0.52, r * 0.72);
    strokeC(x, acc(shade(C, 0.24)), Math.max(1.2, r * 0.09));
    x.beginPath(); x.moveTo(r * 0.36, -r * 0.45); x.lineTo(r * 0.54, r * 0.64);
    strokeC(x, acc(shade(C, 0.24)), Math.max(1.2, r * 0.09));
    ellPath(x, 0, r * 0.18, r * 0.42, r * 0.45); fillC(x, accD(PITH));
    limb(x, -r * 0.30, -r * 0.10, -r * 0.50, r * 0.40, r * 0.20, shade(C, -0.20), Math.max(1.2, r * 0.09));
    limb(x, r * 0.05, -r * 0.15, r * 0.10, r * 0.45 + tg, -r * 0.18, shade(C, -0.20), Math.max(1.2, r * 0.09));
    limb(x, r * 0.30, r * 0.05, r * 0.85, r * 0.35, r * 0.25, shade(C, -0.25), Math.max(1.3, r * 0.10));
    volume(x, r * 0.70, function () { blobPath(x, -r * 0.20, -r * 1.06, r * 0.68, 0.20, 2); }, shade(C, 0.16), { lw: Math.max(1.3, r * 0.12) });
    x.beginPath(); x.moveTo(-r * 0.20, -r * 1.00); x.lineTo(r * 0.30, -r * 0.92);
    strokeC(x, rgba(acc(shade(C, -0.40)), 0.8), Math.max(1, r * 0.07));
    ellPath(x, -r * 0.55, -r * 1.20, Math.max(0.9, r * 0.07), Math.max(0.7, r * 0.05)); fillC(x, acc(shade(C, 0.34)));
    ellPath(x, r * 0.42, -r * 1.28, Math.max(0.8, r * 0.05), Math.max(0.6, r * 0.04)); fillC(x, acc(shade(C, 0.34)));
    x.beginPath(); x.moveTo(-r * 0.42, -r * 0.22); x.quadraticCurveTo(0, r * 0.30, r * 0.42, -r * 0.22);
    strokeC(x, accD(GOO), Math.max(1.4, r * 0.12));
  }

  /* 09 鳄皮冬瓜(精英) —— 低伏长条甲壳兽: 口裂一直开到眼后, 背上 3 列交错甲片 */
  function fElReaper(x, r, ph, C) {
    var sw = Math.sin(ph) * r * 0.05;
    groundShadow(x, r, 1.6, 0.34, r * 0.52);
    volume(x, r * 0.95, function () {
      polyPath(x, [-r * 0.80, r * 0.30, -r * 0.86, -r * 0.18, -r * 0.30, -r * 0.40, r * 0.20, -r * 0.42,
        r * 0.78, -r * 0.24, r * 0.86, r * 0.02, r * 0.40, r * 0.34]);
    }, C, { lw: Math.max(1.6, r * 0.13) });
    segments(x, -r * 0.50, -r * 0.28, r * 0.70, -r * 0.20, 3, r * 0.30, r * 0.24, shade(C, -0.30), 0.14);
    x.beginPath(); x.moveTo(-r * 0.50, -r * 0.30); x.lineTo(r * 0.70, -r * 0.24);
    strokeC(x, acc(shade(C, 0.20)), Math.max(1.2, r * 0.08));
    polyPath(x, [-r * 0.30, -r * 0.18, r * 0.30, -r * 0.14, r * 1.08, -r * 0.02, r * 1.06, r * 0.30,
      r * 0.30, r * 0.26, -r * 0.30, r * 0.22]);
    fillC(x, acc(shade(C, 0.34)));
    strokeC(x, inkOf(), Math.max(1.2, r * 0.09));
    polyPath(x, [-r * 0.12, r * 0.06, r * 0.10, r * 0.08, r * 0.22, r * 0.02, r * 0.42, r * 0.10,
      r * 0.54, r * 0.04, r * 0.72, r * 0.12, r * 0.80, r * 0.06]);
    fillC(x, acc(shade(C, 0.30)));
    eyeAt(x, r * 0.55, -r * 0.42, Math.max(1.4, r * 0.12), 1, 0.6);
    eyeAt(x, r * 0.86, -r * 0.50, Math.max(1.0, r * 0.06), 1, 0.6);
    leg(x, -r * 0.30, r * 0.35, -r * 0.50, r * 0.90, -r * 0.55, r * 0.68, Math.max(1.4, r * 0.11), shade(C, -0.40));
    leg(x, r * 0.35, r * 0.35, r * 0.60, r * 0.85, r * 0.60, r * 0.66, Math.max(1.4, r * 0.11), shade(C, -0.40));
    leafBlade(x, -r * 0.90, r * 0.05, 3.3, r * 0.55, r * 0.18, shade(C, 0.16), 0.5);
    limb(x, r * 0.20, -r * 0.30, -r * 0.20, -r * 0.75 + sw, 0.20, shade(C, -0.25), Math.max(1.2, r * 0.09));
    ellPath(x, -r * 0.35, -r * 0.15, r * 0.30, r * 0.12, -0.2); fillC(x, rgba(WET, 0.26));
  }

  /* 10 暴走菜帮 —— 一堆挤在一起的叶与手, 外面乱长出 5 只大小不一的眼 */
  function fMobrage(x, r, ph, C) {
    var i, a, len;
    groundShadow(x, r, 0.92, 0.32);
    volume(x, r * 0.90, function () { blobPath(x, 0, r * 0.10, r * 0.90, 0.15, 9); }, C, { lw: Math.max(1.5, r * 0.13) });
    for (i = 0; i < 3; i++) {
      a = -2.45 + i * 0.70; len = r * (1.15 - i * 0.10);
      leafBlade(x, r * (-0.24 + i * 0.28), -r * (0.16 + i * 0.04), a + Math.sin(ph + i) * 0.08,
        len, r * (0.46 - i * 0.06), shade(C, i === 2 ? 0.16 : (i ? -0.05 : 0.10)), 0.4 - i * 0.1);
    }
    eyeAt(x, -r * 0.30, -r * 0.15, Math.max(1.2, r * 0.14), 5, 0);
    eyeAt(x, r * 0.22, -r * 0.35, Math.max(1.1, r * 0.11), 5, 0);
    eyeAt(x, r * 0.50, r * 0.10, Math.max(0.9, r * 0.08), 5, 0);
    eyeAt(x, -r * 0.05, r * 0.30, Math.max(0.9, r * 0.07), 5, 0);
    eyeAt(x, -r * 0.50, r * 0.35, Math.max(0.8, r * 0.05), 5, 0);
    limb(x, r * 0.60, r * 0.10, r * 1.38, -r * 0.34, r * 0.30, shade(C, -0.30), Math.max(1.4, r * 0.12));
    limb(x, r * 0.62, r * 0.18, r * 1.44, r * 0.52, -r * 0.25, shade(C, -0.30), Math.max(1.4, r * 0.12));
    limb(x, r * 0.50, r * 0.40, r * 1.20, r * 1.02, r * 0.25, shade(C, -0.35), Math.max(1.4, r * 0.12));
    x.beginPath(); x.moveTo(-r * 0.75, -r * 0.30); x.quadraticCurveTo(-r * 0.30, 0, 0, r * 0.06);
    strokeC(x, acc(shade(C, -0.34)), Math.max(1.2, r * 0.09));
  }

  /* 11 鳍背鱼草 —— 扁平流线肉条: 背上一片半透明皮膜鳍, 体侧 3 道裂鳃, 无配对眼 */
  function fFinling(x, r, ph, C) {
    var sw = Math.sin(ph) * r * 0.12, i;
    groundShadow(x, r, 1.5, 0.32, r * 0.42);
    volume(x, r * 1.0, function () {
      polyPath(x, [-r * 0.85, r * 0.02, -r * 0.50, -r * 0.26, r * 0.40, -r * 0.28, r * 1.05, -r * 0.16,
        r * 1.30, 0, r * 1.02, r * 0.16, r * 0.26, r * 0.28, -r * 0.50, r * 0.24]);
    }, C, { lw: Math.max(1.5, r * 0.13) });
    wing(x, -r * 0.20, -r * 0.30, -1.5, r * 1.15, r * 0.40, shade(C, 0.26), 0.42);
    x.beginPath(); x.moveTo(-r * 0.20, -r * 0.30); x.lineTo(-r * 0.90, -r * 0.85);
    strokeC(x, acc(shade(C, 0.34)), Math.max(1, r * 0.07));
    x.beginPath();
    for (i = 0; i < 3; i++) {
      x.moveTo(r * (0.30 + i * 0.14), r * 0.02);
      x.lineTo(r * (0.30 + i * 0.14), r * (0.30 - i * 0.02));
    }
    strokeC(x, acc(shade(C, -0.52)), Math.max(1.1, r * 0.08));
    eyeAt(x, r * 0.60, -r * 0.18, Math.max(1.3, r * 0.11), 1, 0.6);
    polyPath(x, [r * 0.85, -r * 0.02, r * 1.34, r * 0.06, r * 1.30, r * 0.22, r * 0.82, r * 0.18]); fillC(x, accD(GOO));
    polyPath(x, [r * 0.86, r * 0.04, r * 1.02, r * 0.06, r * 1.08, r * 0.16, r * 1.20, r * 0.10, r * 1.14, r * 0.02]);
    fillC(x, acc(shade(C, 0.32)));
    limb(x, -r * 1.35, r * 0.05, -r * 1.90, r * 0.55 + sw, r * 0.25, shade(C, 0.10), Math.max(1.6, r * 0.14));
    ellPath(x, -r * 0.30, -r * 0.24, r * 0.32, r * 0.10, -0.15); fillC(x, rgba(WET, 0.28));
    ellPath(x, r * 0.50, r * 0.40, Math.max(0.8, r * 0.06), Math.max(0.6, r * 0.05)); fillC(x, acc(GOO));
  }

  /* 12 逐腐蝇 —— 两团占满脑袋的复眼(不等大) + 吸盘口 + 向后掠的两片薄翅 */
  function fFly(x, r, ph, C) {
    var wf = Math.sin(ph) * 0.3;
    groundShadow(x, r, 0.88, 0.30);
    wing(x, -r * 0.15, -r * 0.44, -0.32 - wf * 0.25, r * 0.95, r * 0.34, shade(C, 0.30), 0.38);
    wing(x, r * 0.20, -r * 0.44, 0.26 + wf * 0.25, r * 0.90, r * 0.32, shade(C, 0.30), 0.38);
    volume(x, r * 0.60, function () { blobPath(x, 0, r * 0.34, r * 0.60, 0.12, 11); }, C, { lw: Math.max(1.4, r * 0.13) });
    eyeAt(x, -r * 0.32, -r * 0.30, Math.max(1.5, r * 0.40), 2, 0);
    eyeAt(x, r * 0.36, -r * 0.24, Math.max(1.3, r * 0.34), 2, 0);
    mouthAt(x, 0, r * 0.56, r * 0.40, r * 0.24, 3, GOO);
    leg(x, -r * 0.26, r * 0.55, -r * 0.52, r * 0.98, -r * 0.54, r * 0.76, Math.max(1, r * 0.07), shade(C, -0.40));
    leg(x, 0, r * 0.60, 0, r * 1.02, r * 0.10, r * 0.80, Math.max(1, r * 0.07), shade(C, -0.40));
    leg(x, r * 0.26, r * 0.55, r * 0.52, r * 0.96, r * 0.54, r * 0.74, Math.max(1, r * 0.07), shade(C, -0.40));
    x.beginPath(); x.moveTo(-r * 0.02, -r * 0.68); x.lineTo(r * 0.24, -r * 0.02);
    strokeC(x, acc(shade(C, -0.32)), Math.max(1, r * 0.08));
    ellPath(x, -r * 0.34, -r * 0.46, r * 0.11, r * 0.07, -0.4); fillC(x, rgba(WET, 0.34));
    ellPath(x, r * 0.50, r * 0.62, Math.max(0.7, r * 0.05), Math.max(0.55, r * 0.04)); fillC(x, acc(GOO));
  }

  /* 13 石像胡瓜(精英) —— 蹲坐的厚皮石瓜: 不规则硬壳 + 壳上一道浅色斑纹,
   * 右侧两条卷须手(藤)。去掉旧版胸口的露肉裂口与右半圈那 4 条触手。 */
  function fElWeaver(x, r, ph, C) {
    groundShadow(x, r, 1.0, 0.32);
    volume(x, r * 1.05, function () {
      polyPath(x, [
        -r * 0.849, -r * 1.015, r * 0.393, -r * 1.760, r * 0.367, -r * 0.430,
        r * 1.531, -r * 0.987, r * 0.771, -r * 0.270, r * 1.437, -r * 0.120, r * 0.631, r * 0.091,
        r * 1.419, r * 0.436, r * 0.783, r * 0.287, r * 1.370, r * 1.029, r * 0.501, r * 0.760,
        r * 0.722, r * 1.433, -r * 0.060, r * 0.587, -r * 0.681, r * 0.306, -r * 0.581, -r * 0.266]);
    }, C, { lw: Math.max(1.6, r * 0.13) });
    x.beginPath();
    x.moveTo(-r * 0.62, -r * 0.44); x.lineTo(-r * 0.30, -r * 0.06); x.lineTo(-r * 0.56, r * 0.36);
    x.moveTo(r * 0.54, -r * 0.40); x.lineTo(r * 0.22, -r * 0.02);
    strokeC(x, acc(shade(C, -0.40)), Math.max(1.1, r * 0.08));
    polyPath(x, [-r * 0.30, r * 0.30, r * 0.26, r * 0.32, r * 0.32, r * 0.48, -r * 0.34, r * 0.46]);
    fillC(x, acc(shade(C, 0.30)));
    eyeAt(x, -r * 0.34, -r * 0.34, Math.max(1.4, r * 0.14), 1, 0.2);
    eyeAt(x, r * 0.14, -r * 0.42, Math.max(1.1, r * 0.10), 1, 0.2);
    mouthAt(x, -r * 0.06, r * 0.10, r * 0.40, r * 0.14, 0, acc('#8a5a44'));
    leafBlade(x, r * 0.62, -r * 0.34, -0.62 + Math.sin(ph) * 0.06, r * 0.86, r * 0.28, shade(C, -0.22), 0.5);
    leafBlade(x, r * 0.74, r * 0.14, -0.10 + Math.sin(ph + 1.3) * 0.06, r * 0.78, r * 0.26, shade(C, -0.26), -0.5);
    limb(x, r * 0.40, r * 0.72, r * 0.92, r * 1.00 + Math.sin(ph + 3.9) * r * 0.05, -0.20, shade(C, -0.28), Math.max(1.3, r * 0.10));
    horn(x, -r * 0.55, -r * 0.60, -1.4, r * 0.50, r * 0.18, shade(C, 0.24), 0.1);
    ellPath(x, -r * 0.30, -r * 0.60, r * 0.22, r * 0.10, -0.4); fillC(x, rgba(WET, 0.28));
  }

  /* 14 草药婆婆 —— 破斗篷立架: 兜帽下面什么都没有(空洞), 斗篷下伸出 4 只不对称的手 */
  function fHerbwife(x, r, ph, C) {
    var sw = Math.sin(ph) * r * 0.05;
    groundShadow(x, r, 1.0, 0.30);
    polyPath(x, [
        -r * 0.418, -r * 2.220, r * 0.249, -r * 1.183, r * 0.496, -r * 1.140,
        r * 0.382, -r * 0.579, r * 0.610, -r * 0.798, r * 0.538, -r * 0.096, r * 1.138, r * 1.252,
        r * 0.907, r * 1.524, r * 0.563, r * 0.703, r * 0.160, r * 1.441, -r * 0.187, r * 1.004,
        -r * 0.704, r * 1.308, -r * 1.440, r * 1.627, -r * 1.012, r * 0.818,
        -r * 0.792, -r * 0.138, -r * 0.551, -r * 0.930, -r * 0.383, -r * 0.986,
        -r * 0.439, -r * 1.863]);
    polyPath(x, [-r * 0.44, -r * 0.24, -r * 0.34, -r * 0.78, r * 0.02, -r * 0.92, r * 0.36, -r * 0.72, r * 0.44, -r * 0.24]);
    fillC(x, acc(shade(C, 0.06))); strokeC(x, inkOf(), Math.max(1.3, r * 0.11));
    ellPath(x, r * 0.02, -r * 0.52, r * 0.24, r * 0.28); fillC(x, accD(SOCK));
    eyeAt(x, -r * 0.04, -r * 0.54, Math.max(1.0, r * 0.07), 4, 0);
    limb(x, -r * 0.55, r * 0.10, -r * 1.05, -r * 0.15 + sw, 0.25, shade(C, -0.28), Math.max(1.2, r * 0.09));
    limb(x, r * 0.55, r * 0.15, r * 1.02, r * 0.55 - sw, -0.22, shade(C, -0.28), Math.max(1.2, r * 0.09));
    limb(x, -r * 0.40, r * 0.45, -r * 0.75, r * 0.85 + sw, 0.20, shade(C, -0.32), Math.max(1.1, r * 0.08));
    limb(x, r * 0.35, r * 0.50, r * 0.70, r * 0.92 - sw, -0.18, shade(C, -0.32), Math.max(1.1, r * 0.08));
    x.beginPath(); x.moveTo(0, -r * 0.20); x.lineTo(r * 0.02, r * 0.90);
    strokeC(x, acc(shade(C, -0.45)), Math.max(1.1, r * 0.08));
    ellPath(x, -r * 0.22, -r * 0.72, r * 0.18, r * 0.06, -0.4); fillC(x, rgba(WET, 0.26));
    limb(x, -r * 0.30, r * 0.95, -r * 0.45, r * 1.28, 0.15, shade(C, -0.40), Math.max(1.1, r * 0.07));
    limb(x, r * 0.30, r * 0.95, r * 0.48, r * 1.26, -0.15, shade(C, -0.40), Math.max(1.1, r * 0.07));
    ellPath(x, r * 0.45, r * 1.05, Math.max(0.7, r * 0.05), Math.max(0.55, r * 0.04)); fillC(x, acc(GOO));
  }

  /* 15 岩壳仔 —— 带硬边的碎石块(顶点半径交替, 不是 blob), 缝里渗湿肉, 底下两只短足 */
  function fRockling(x, r, ph, C) {
    groundShadow(x, r, 1.0, 0.32);
    volume(x, r * 1.0, function () {
      polyPath(x, [
        -r * 1.549, r * 0.855, -r * 0.719, r * 0.106, -r * 1.810, -r * 0.206,
        -r * 1.190, -r * 0.519, -r * 1.060, -r * 0.197, r * 0.028, -r * 0.256,
        r * 0.353, -r * 0.153, r * 1.221, -r * 1.350, r * 1.810, -r * 0.273, r * 1.459, r * 0.216,
        r * 0.881, r * 0.417, r * 0.346, r * 0.604, -r * 0.261, r * 0.546]);
    }, C, { lw: Math.max(1.5, r * 0.13) });
    slab(x, function () { polyPath(x, [-r * 0.56, -r * 0.44, -r * 0.02, -r * 0.72, r * 0.40, -r * 0.54, r * 0.06, -r * 0.28]); },
      shade(C, 0.26), Math.max(1, r * 0.09));
    x.beginPath();
    x.moveTo(-r * 0.40, -r * 0.10); x.lineTo(-r * 0.20, r * 0.34); x.lineTo(-r * 0.44, r * 0.58);
    x.moveTo(r * 0.34, -r * 0.42); x.lineTo(r * 0.52, r * 0.06);
    x.moveTo(r * 0.10, r * 0.30); x.lineTo(r * 0.24, r * 0.52);
    strokeC(x, accD(GOO), Math.max(1.4, r * 0.10));
    eyeAt(x, r * 0.28, -r * 0.12, Math.max(1.2, r * 0.11), 1, 0.2);
    eyeAt(x, -r * 0.18, -r * 0.30, Math.max(0.9, r * 0.06), 1, 0.2);
    claw(x, 0, r * 0.50, -0.2, Math.max(1.6, r * 0.35), shade(C, -0.35));
    leg(x, -r * 0.30, r * 0.55, -r * 0.50, r * 1.00, -r * 0.55, r * 0.78, Math.max(1.3, r * 0.10), shade(C, -0.40));
    leg(x, r * 0.30, r * 0.55, r * 0.50, r * 0.98, r * 0.55, r * 0.76, Math.max(1.3, r * 0.10), shade(C, -0.40));
    ellPath(x, -r * 0.30, -r * 0.40, r * 0.20, r * 0.09, -0.4); fillC(x, rgba(WET, 0.26));
    ellPath(x, r * 0.55, r * 0.50, Math.max(0.7, r * 0.05), Math.max(0.55, r * 0.04)); fillC(x, acc(GOO));
  }

  /* 16 犄角南瓜 —— 裂瓣湿肉瓜: 瓣缝里露牙, 头顶两根不等长的犄角 */
  function fHornpumpkin(x, r, ph, C) {
    var i, px0, dy;
    groundShadow(x, r, 0.94, 0.32);
    volume(x, r * 0.92, function () { blobPath(x, 0, r * 0.05, r * 0.92, 0.06, 4); }, C, { lw: Math.max(1.5, r * 0.13) });
    x.beginPath();
    for (i = 0; i < 6; i++) {
      px0 = -r * 0.62 + i * r * 0.25; dy = (i === 3 || i === 4) ? r * 0.34 : 0;
      x.moveTo(px0, -r * 0.84 + dy);
      x.quadraticCurveTo(px0 + r * 0.14, 0, px0 + r * 0.08, r * 0.92 - dy);
    }
    strokeC(x, accD(GOO), Math.max(1.1, r * 0.10));
    polyPath(x, [-r * 0.26, -r * 0.80, r * 0.10, -r * 0.48, r * 0.28, -r * 0.80]); fillC(x, accD(GOO));
    polyPath(x, [-r * 0.20, -r * 0.74, -r * 0.06, -r * 0.52, r * 0.06, -r * 0.72, r * 0.16, -r * 0.50, r * 0.24, -r * 0.66]);
    fillC(x, acc(shade(C, 0.34)));
    horn(x, -r * 0.30, -r * 0.62, -1.2, r * 0.90, r * 0.24, shade(C, 0.30), 0.4);
    horn(x, r * 0.28, -r * 0.60, -0.9, r * 0.55, r * 0.20, shade(C, 0.18), -0.3);
    eyeAt(x, r * 0.36, -r * 0.05, Math.max(1.3, r * 0.13), 1, 0.3);
    limb(x, -r * 0.80, r * 0.30, -r * 1.30, r * 0.80, r * 0.24, shade(C, -0.30), Math.max(1.3, r * 0.10));
    ellPath(x, -r * 0.34, -r * 0.30, r * 0.26, r * 0.11, -0.5); fillC(x, rgba(WET, 0.30));
    ellPath(x, r * 0.60, r * 0.62, Math.max(0.7, r * 0.06), Math.max(0.55, r * 0.05)); fillC(x, acc(GOO));
  }

  /* 17 尖角豆荚 —— 拉长的荚壳: 前端收成骨锥, 侧面裂开露出 3 颗籽(朝 +x 设计) */
  function fHornpod(x, r, ph, C) {
    var sp = Math.sin(ph) * r * 0.06;
    groundShadow(x, r, 1.5, 0.30, r * 0.44);
    volume(x, r * 0.85, function () {
      polyPath(x, [-r * 0.72, r * 0.06, -r * 0.40, -r * 0.24, r * 0.30, -r * 0.28, r * 0.72, -r * 0.06,
        r * 0.70, r * 0.16, r * 0.26, r * 0.28, -r * 0.40, r * 0.24]);
    }, C, { lw: Math.max(1.5, r * 0.13) });
    horn(x, r * 0.70, -r * 0.10, -0.18, r * 1.05, r * 0.20, shade(C, 0.30), 0);
    x.beginPath(); x.moveTo(-r * 0.70, -r * 0.25); x.lineTo(r * 0.70, 0);
    strokeC(x, acc(shade(C, 0.20)), Math.max(1.1, r * 0.07));
    polyPath(x, [-r * 0.50, -r * 0.04, r * 0.20, 0, r * 0.18, r * 0.18, -r * 0.50, r * 0.14]); fillC(x, accD(GOO));
    circlePath(x, 0, r * 0.02, r * 0.14);
    fillC(x, acc(shade(C, 0.20)));
    circlePath(x, -r * 0.24, 0, r * 0.12);
    fillC(x, acc(shade(C, 0.28)));
    circlePath(x, r * 0.20, r * 0.04, r * 0.10);
    fillC(x, acc(shade(C, 0.34)));
    eyeAt(x, -r * 0.30, -r * 0.24, Math.max(1.2, r * 0.11), 1, 0.5);
    eyeAt(x, r * 0.28, -r * 0.24, Math.max(1.2, r * 0.11), 1, 0.5);
    leg(x, -r * 0.20, r * 0.40, -r * 0.35, r * 0.90, -r * 0.42, r * 0.70, Math.max(1.2, r * 0.08), shade(C, -0.40));
    leg(x, r * 0.25, r * 0.40, r * 0.40, r * 0.88, r * 0.45, r * 0.68, Math.max(1.2, r * 0.08), shade(C, -0.40));
    ellPath(x, -r * 0.30, -r * 0.20, r * 0.30, r * 0.10, -0.05); fillC(x, rgba(WET, 0.28));
    x.beginPath(); x.moveTo(r * 0.60, r * 0.30); x.lineTo(r * 1.05 + sp * 0.2, r * 0.34);
    strokeC(x, rgba(acc(shade(C, 0.34)), 0.75), Math.max(1.1, r * 0.08));
  }

  /* 18 枯萎长老(Boss) —— 高瘦的干草秆立架: 亮色秆身 + 一片浅色面板 + 枯叶手臂垂到地面, 孢子点悬浮。
   * v59: 主色从近黑绿 #2a5a3a 提到亮草绿(用户逐字「去掉灰黑当主色」), 眼型 0 -> 1(规范禁 style 0)。 */
  function fElderBlight(x, r, ph, C) {
    var q = Math.sin(ph) * r * 0.05;
    groundShadow(x, r, 1.0, 0.32);
    volume(x, r * 1.15, function () {
      polyPath(x, [-r * 0.82, r * 0.90, -r * 0.80, r * 0.20, -r * 0.62, -r * 0.42, -r * 0.35, -r * 0.92,
        r * 0.37, -r * 0.90, r * 0.64, -r * 0.40, r * 0.82, r * 0.24, r * 0.76, r * 0.92]);
    }, C, { lw: Math.max(1.7, r * 0.13) });
    polyPath(x, [-r * 0.34, -r * 0.74, r * 0.34, -r * 0.72, r * 0.26, r * 0.30, -r * 0.26, r * 0.32]);
    fillC(x, acc(shade(C, 0.24)));
    eyesAt(x, r * 0.30, -r * 0.50, Math.max(2.2, r * 0.13), 1, 0.1);
    mouthAt(x, 0, -r * 0.02, r * 0.54, r * 0.24, 0, shade(C, -0.30));
    limb(x, -r * 0.78, -r * 0.40, -r * 1.40, r * 0.90 + q, 0.30, shade(C, -0.30), Math.max(1.5, r * 0.10));
    limb(x, r * 0.78, -r * 0.40, r * 1.35, r * 0.85 - q, -0.28, shade(C, -0.30), Math.max(1.5, r * 0.10));
    claw(x, -r * 1.40, r * 0.90 + q, 2.84, Math.max(2, r * 0.35), shade(C, -0.45));
    claw(x, r * 1.35, r * 0.85 - q, 0.30, Math.max(2, r * 0.30), shade(C, -0.45));
    roots(x, -r * 0.40, r * 1.05, 4, r * 0.50, 1.1, shade(C, -0.40), Math.max(1.3, r * 0.09));
    roots(x, r * 0.40, r * 1.05, 3, r * 0.42, 1.1, shade(C, -0.40), Math.max(1.3, r * 0.09));
    ellPath(x, -r * 0.90, -r * 1.10 + q, Math.max(0.9, r * 0.11), Math.max(0.7, r * 0.08)); fillC(x, acc(shade(C, 0.34)));
    ellPath(x, r * 1.00, -r * 0.90 - q, Math.max(0.8, r * 0.08), Math.max(0.6, r * 0.06)); fillC(x, acc(shade(C, 0.34)));
    ellPath(x, r * 0.60, r * 0.20 + q, Math.max(0.7, r * 0.07), Math.max(0.55, r * 0.05)); fillC(x, acc(shade(C, 0.40)));
    x.beginPath(); x.moveTo(-r * 0.62, r * 0.48); x.quadraticCurveTo(0, r * 0.66, r * 0.62, r * 0.46);
    strokeC(x, acc(shade(C, 0.30)), Math.max(1.3, r * 0.10));
  }

  /* 19 蹦跳菇 —— 歪斜菌盖压在收缩菌柄上: 右侧塌陷 + 菌褶 3 条 + 折叠后腿 */
  function fHopper(x, r, ph, C) {
    var i, sq = Math.sin(ph) * r * 0.05;
    groundShadow(x, r, 0.92, 0.30);
    volume(x, r * 0.62, function () {
      polyPath(x, [-r * 0.28, -r * 0.44, r * 0.30, -r * 0.44, r * 0.34, r * 0.36, -r * 0.32, r * 0.36]);
    }, shade(C, -0.30), { lw: Math.max(1.3, r * 0.12) });
    volume(x, r * 0.66, function () { blobPath(x, 0, -r * 0.50, r * 0.62 + sq, 0.12, 6); }, C, { lw: Math.max(1.4, r * 0.13) });
    x.beginPath();
    for (i = 0; i < 3; i++) { x.moveTo(-r * 0.34 + i * r * 0.34, -r * 0.30); x.lineTo(-r * 0.44 + i * r * 0.36, -r * 0.12); }
    strokeC(x, acc(shade(C, -0.45)), Math.max(1, r * 0.08));
    polyPath(x, [r * 0.34, -r * 0.72, r * 0.66, -r * 0.52, r * 0.40, -r * 0.40]); fillC(x, accD(GOO));
    eyeAt(x, -r * 0.20, -r * 0.10, Math.max(1.1, r * 0.11), 1, 0.2);
    leg(x, -r * 0.28, r * 0.30, -r * 0.60, r * 0.90, -r * 0.75, r * 0.55, Math.max(1.2, r * 0.11), shade(C, -0.40));
    leg(x, r * 0.28, r * 0.30, r * 0.60, r * 0.88, r * 0.75, r * 0.52, Math.max(1.2, r * 0.11), shade(C, -0.40));
    ellPath(x, -r * 0.24, -r * 0.62, r * 0.22, r * 0.10, -0.5); fillC(x, rgba(WET, 0.30));
    ellPath(x, -r * 0.55, r * 0.55, Math.max(0.7, r * 0.06), Math.max(0.55, r * 0.05)); fillC(x, acc(GOO));
    x.beginPath(); x.moveTo(-r * 0.55, r * 0.48); x.lineTo(-r * 0.62, r * 0.78);
    strokeC(x, acc(GOO), Math.max(1, r * 0.07));
  }

  /* 20 沟鳗 —— 没有眼睛的长肉虫: 前端一个圆形吸盘口(两圈牙), 体表一环一环 */
  function fLamprey(x, r, ph, C) {
    var sw = Math.sin(ph) * r * 0.05;
    groundShadow(x, r, 1.5, 0.30, r * 0.34);
    segments(x, -r * 0.90, r * 0.10 + sw, r * 0.90, -r * 0.10 - sw, 5, r * 0.34, r * 0.20, C, 0.16);
    mouthAt(x, r * 0.60, 0, r * 0.44, r * 0.30, 3, GOO);
    x.beginPath(); x.arc(r * 0.60, 0, r * 0.30, 0, TAU); strokeC(x, acc(shade(C, 0.34)), Math.max(1.1, r * 0.07));
    x.beginPath(); x.arc(r * 0.60, 0, r * 0.18, 0, TAU); strokeC(x, acc(shade(C, 0.24)), Math.max(1, r * 0.06));
    x.beginPath();
    x.moveTo(-r * 0.30, -r * 0.24); x.lineTo(-r * 0.30, r * 0.26);
    x.moveTo(r * 0.30, -r * 0.20); x.lineTo(r * 0.30, r * 0.26);
    strokeC(x, acc(shade(C, -0.40)), Math.max(1, r * 0.07));
    x.beginPath(); x.moveTo(-r * 0.86, -r * 0.10); x.lineTo(r * 0.40, -r * 0.24);
    strokeC(x, acc(shade(C, -0.45)), Math.max(1.1, r * 0.07));
    limb(x, -r * 0.95, 0, -r * 1.50, r * 0.40, r * 0.30, shade(C, 0.12), Math.max(1.3, r * 0.12));
    ellPath(x, -r * 0.30, -r * 0.16, r * 0.30, r * 0.10, -0.1); fillC(x, rgba(WET, 0.28));
    ellPath(x, r * 0.20, r * 0.30, Math.max(0.7, r * 0.06), Math.max(0.55, r * 0.05)); fillC(x, acc(GOO));
    x.beginPath(); x.moveTo(r * 0.20, r * 0.24); x.lineTo(r * 0.26, r * 0.48);
    strokeC(x, acc(GOO), Math.max(1, r * 0.07));
    leg(x, -r * 0.50, r * 0.24, -r * 0.60, r * 0.62, -r * 0.66, r * 0.45, Math.max(1, r * 0.08), shade(C, -0.40));
  }

  /* 21 偷菜乌鸦 —— 低伏鸟影: 喙裂成上下两片肉颚, 头侧 3 只不等大的眼 */
  function fCrothief(x, r, ph, C) {
    var wf = Math.sin(ph) * 0.25;
    groundShadow(x, r, 0.90, 0.30);
    wing(x, -r * 0.20, -r * 0.20, -1.9 - wf * 0.10, r * 1.00, r * 0.34, shade(C, -0.10), 0.50);
    wing(x, r * 0.25, -r * 0.15, -1.5 + wf * 0.10, r * 0.90, r * 0.30, shade(C, -0.10), 0.50);
    volume(x, r * 0.72, function () { polyPath(x, [
        -r * 2.110, r * 0.387, -r * 0.565, -r * 0.307, -r * 0.449, -r * 0.699,
        -r * 0.444, -r * 0.756, r * 0.111, -r * 1.321, r * 0.470, -r * 0.672,
        r * 2.110, -r * 0.746, r * 0.708, -r * 0.171, r * 0.683, r * 0.142, r * 0.563, r * 0.453,
        r * 0.601, r * 0.987, -r * 0.169, r * 0.784, -r * 0.838, r * 0.580, -r * 1.259, r * 0.442]); }, C, { lw: Math.max(1.4, r * 0.13) });
    volume(x, r * 0.40, function () { circlePath(x, r * 0.45, -r * 0.35, r * 0.40); }, shade(C, 0.14), { lw: Math.max(1.3, r * 0.12) });
    polyPath(x, [r * 0.55, -r * 0.60, r * 1.15, -r * 0.45, r * 0.60, -r * 0.26, r * 0.42, -r * 0.34]);
    fillC(x, acc(shade(C, 0.16))); strokeC(x, inkOf(), Math.max(1, r * 0.09));
    polyPath(x, [r * 0.50, -r * 0.24, r * 1.00, -r * 0.10, r * 0.54, r * 0.06]); fillC(x, acc(shade(C, -0.16)));
    polyPath(x, [r * 0.62, -r * 0.44, r * 0.80, -r * 0.40, r * 0.86, -r * 0.26, r * 0.94, -r * 0.32, r * 0.86, -r * 0.20]);
    fillC(x, acc(shade(C, 0.30)));
    eyeAt(x, r * 0.36, -r * 0.50, Math.max(1.1, r * 0.10), 5, 0);
    eyeAt(x, r * 0.60, -r * 0.34, Math.max(1.0, r * 0.07), 5, 0);
    eyeAt(x, r * 0.42, -r * 0.22, Math.max(0.9, r * 0.05), 5, 0);
    leg(x, -r * 0.20, r * 0.60, -r * 0.30, r * 1.05, -r * 0.42, r * 0.80, Math.max(1.1, r * 0.08), shade(C, -0.30));
    claw(x, r * 1.05, -r * 0.55, 0.5, Math.max(1.4, r * 0.25), shade(C, 0.20));
  }

  /* 22 镰刀螳螂(精英) —— 三角头(尖朝上偏右 15 度) + 高胸节 + 双镰臂(一高一低一长一短) */
  function fScythemantis(x, r, ph, C) {
    var sw = Math.sin(ph) * r * 0.08;
    groundShadow(x, r, 0.90, 0.30);
    volume(x, r * 0.62, function () {
      polyPath(x, [-r * 0.30, -r * 0.20, r * 0.28, -r * 0.18, r * 0.44, r * 0.30, r * 0.10, r * 0.86, -r * 0.24, r * 0.62]);
    }, shade(C, -0.14), { lw: Math.max(1.4, r * 0.12) });
    volume(x, r * 0.42, function () { circlePath(x, -r * 0.05, -r * 0.55, r * 0.42); }, C, { lw: Math.max(1.4, r * 0.12) });
    volume(x, r * 0.40, function () {
      polyPath(x, [r * 0.02, -r * 1.14, r * 0.30, -r * 0.72, -r * 0.30, -r * 0.76]);
    }, shade(C, 0.16), { lw: Math.max(1.3, r * 0.11) });
    mouthAt(x, 0, -r * 0.85, r * 0.30, r * 0.22, 5, GOO);
    polyPath(x, [-r * 0.14, -r * 0.76, -r * 0.04, -r * 0.62, r * 0.04, -r * 0.76, r * 0.12, -r * 0.60, r * 0.16, -r * 0.74]);
    fillC(x, acc(shade(C, 0.30)));
    leg(x, r * 0.50, -r * 0.20, r * 1.20, -r * 0.75 + sw, r * 0.75, -r * 0.60, Math.max(1.4, r * 0.12), shade(C, -0.15));
    volume(x, r * 0.40, function () {
      polyPath(x, [r * 1.16, -r * 0.80 + sw, r * 1.56, -r * 0.30 + sw, r * 1.18, -r * 0.40 + sw, r * 1.08, -r * 0.66 + sw]);
    }, shade(C, 0.08), { lw: Math.max(1.1, r * 0.09) });
    leg(x, -r * 0.50, -r * 0.15, -r * 1.15, -r * 0.50 - sw, -r * 0.70, -r * 0.45, Math.max(1.3, r * 0.11), shade(C, -0.15));
    volume(x, r * 0.34, function () {
      polyPath(x, [-r * 1.12, -r * 0.56 - sw, -r * 1.44, -r * 0.12 - sw, -r * 1.06, -r * 0.20 - sw, -r * 0.98, -r * 0.44 - sw]);
    }, shade(C, 0.04), { lw: Math.max(1.1, r * 0.09) });
    eyeAt(x, r * 0.14, -r * 0.98, Math.max(1.3, r * 0.10), 2, 0.2);
    eyeAt(x, -r * 0.16, -r * 0.95, Math.max(1.1, r * 0.07), 2, 0.2);
    leg(x, -r * 0.25, r * 0.50, -r * 0.45, r * 1.10, -r * 0.55, r * 0.85, Math.max(1.2, r * 0.09), shade(C, -0.40));
    leg(x, r * 0.30, r * 0.50, r * 0.50, r * 1.05, r * 0.55, r * 0.82, Math.max(1.2, r * 0.09), shade(C, -0.40));
  }

  /* 23 地母薯婆(精英) —— 巨囊身挂 3 个副囊, 囊缝里伸出一排 4 条短触手 */
  function fEarthmother(x, r, ph, C) {
    var br = Math.sin(ph) * r * 0.05;
    groundShadow(x, r, 1.0, 0.32);
    volume(x, r * 1.00, function () { polyPath(x, [
        -r * 0.620, -r * 2.000, r * 0.663, -r * 1.934, r * 0.698, -r * 1.444,
        r * 0.297, -r * 0.801, r * 0.692, -r * 0.312, r * 0.851, r * 0.501, r * 0.721, r * 0.591,
        r * 0.634, r * 1.167, r * 0.480, r * 1.050, r * 0.292, r * 0.751, r * 0.019, r * 0.564,
        r * 0.038, r * 1.475, -r * 0.611, r * 2.000, -r * 0.290, r * 0.479, -r * 0.833, r * 0.521,
        -r * 0.705, r * 1.244, -r * 1.494, r * 2.000, -r * 1.167, r * 0.395,
        -r * 0.616, -r * 0.407, -r * 0.334, -r * 1.006]); }, C, { lw: Math.max(1.6, r * 0.13) });
    volume(x, r * 0.46, function () { circlePath(x, -r * 0.92, r * 0.12, r * 0.46 + br); }, shade(C, -0.10), { lw: Math.max(1.3, r * 0.11) });
    volume(x, r * 0.40, function () { circlePath(x, r * 0.96, r * 0.04, r * 0.40 - br * 0.5); }, shade(C, -0.06), { lw: Math.max(1.2, r * 0.11) });
    volume(x, r * 0.26, function () { circlePath(x, r * 0.42, r * 0.88, r * 0.26); }, shade(C, -0.14), { lw: Math.max(1.1, r * 0.10) });
    x.beginPath(); x.moveTo(-r * 0.10, -r * 0.40); x.quadraticCurveTo(r * 0.06, r * 0.30, -r * 0.04, r * 0.92);
    strokeC(x, acc(shade(C, 0.32)), Math.max(1.4, r * 0.11));
    x.beginPath(); x.moveTo(-r * 0.36, -r * 0.22); x.lineTo(-r * 0.46, r * 0.30);
    strokeC(x, acc(shade(C, 0.26)), Math.max(1.2, r * 0.09));
    leg(x, -r * 0.32, r * 0.78, -r * 0.46, r * 1.28, -r * 0.52, r * 1.06, Math.max(1.3, r * 0.10), shade(C, -0.30));
    leg(x, r * 0.32, r * 0.78, r * 0.48, r * 1.26, r * 0.54, r * 1.04, Math.max(1.3, r * 0.10), shade(C, -0.30));
    eyesAt(x, r * 0.26, -r * 0.44, Math.max(1.4, r * 0.13), 1, 0.1, 0.08);
    mouthAt(x, r * 0.02, -r * 0.12, r * 0.44, r * 0.15, 0, acc('#8a5a4a'));
    ellPath(x, -r * 0.36, -r * 0.42, r * 0.30, r * 0.14, -0.5); fillC(x, rgba(WET, 0.28));
    ellPath(x, -r * 0.85, r * 0.90, Math.max(0.8, r * 0.07), Math.max(0.6, r * 0.06)); fillC(x, acc(shade(C, 0.32)));
  }

  /* 24 苦行萝卜(精英) —— 瘦高根体被一圈 6 根自缚骨刺缠住, 眼窝是两个空洞 */
  function fAsceticradish(x, r, ph, C) {
    var sp = Math.sin(ph) * r * 0.08;
    groundShadow(x, r, 0.70, 0.30);
    volume(x, r * 0.95, function () {
      polyPath(x, [-r * 0.42, r * 0.34, -r * 0.50, -r * 0.34, -r * 0.34, -r * 0.72, r * 0.34, -r * 0.72,
        r * 0.50, -r * 0.30, r * 0.40, r * 0.34, r * 0.02, r * 0.80]);
    }, C, { lw: Math.max(1.4, r * 0.12) });
    polyPath(x, [-r * 0.34, -r * 0.46, -r * 0.14, -r * 0.56, r * 0.02, -r * 0.46, -r * 0.06, -r * 0.30, -r * 0.30, -r * 0.28]);
    fillC(x, accD(DRY));
    polyPath(x, [r * 0.14, -r * 0.62, r * 0.30, -r * 0.70, r * 0.40, -r * 0.58, r * 0.34, -r * 0.44, r * 0.16, -r * 0.48]);
    fillC(x, accD(DRY));
    horn(x, -r * 0.42, -r * 0.15, 3.0, r * 0.45 + sp, r * 0.12, shade(C, 0.30), 0);
    horn(x, -r * 0.30, r * 0.45, 2.6, r * 0.28 + sp, r * 0.11, shade(C, 0.26), 0);
    horn(x, r * 0.35, r * 0.30, 0.4, r * 0.45 + sp, r * 0.12, shade(C, 0.30), 0);
    horn(x, r * 0.40, -r * 0.55, 0.9, r * 0.28 + sp, r * 0.11, shade(C, 0.26), 0);
    horn(x, -r * 0.15, -r * 0.85, -1.6, r * 0.45 + sp, r * 0.12, shade(C, 0.30), 0);
    horn(x, r * 0.18, -r * 1.05, -1.2, r * 0.28 + sp, r * 0.11, shade(C, 0.26), 0);
    x.beginPath(); x.moveTo(-r * 0.46, -r * 0.02); x.lineTo(r * 0.44, r * 0.46);
    strokeC(x, acc(shade(C, -0.30)), Math.max(1.1, r * 0.09));
    limb(x, -r * 0.30, r * 0.70, -r * 0.75, r * 1.25, r * 0.22, shade(C, -0.30), Math.max(1.2, r * 0.09));
    limb(x, r * 0.32, r * 0.70, r * 0.78, r * 1.20, -r * 0.20, shade(C, -0.30), Math.max(1.2, r * 0.09));
    ellPath(x, -r * 0.22, -r * 0.50, r * 0.16, r * 0.07, -0.4); fillC(x, rgba(WET, 0.28));
  }

  /* 25 夺魂藤魔(Boss) —— 藤与瓜拧成的人形柱: 中轴一只大圆眼(被藤半遮) + 6 条不等长的藤臂。
   * v59: 去掉旧版中轴那颗「肉色竖瞳巨眼」(用户逐字: 生理不适) —— 巨眼改成一对憨态大圆眼。 */
  function fSoulvine(x, r, ph, C) {
    groundShadow(x, r, 1.0, 0.32);
    volume(x, r * 1.10, function () {
      polyPath(x, [-r * 0.60, r * 0.90, -r * 0.78, r * 0.10, -r * 0.50, -r * 0.55, -r * 0.16, -r * 0.92,
        r * 0.28, -r * 0.86, r * 0.70, -r * 0.30, r * 0.66, r * 0.36, r * 0.34, r * 0.92]);
    }, C, { lw: Math.max(1.7, r * 0.13) });
    x.beginPath(); x.moveTo(-r * 0.46, -r * 0.60); x.quadraticCurveTo(r * 0.10, 0, -r * 0.20, r * 0.86);
    strokeC(x, acc(shade(C, 0.18)), Math.max(1.4, r * 0.10));
    x.beginPath(); x.moveTo(r * 0.44, -r * 0.50); x.quadraticCurveTo(-r * 0.14, r * 0.04, r * 0.22, r * 0.80);
    strokeC(x, acc(shade(C, 0.10)), Math.max(1.3, r * 0.09));
    ellPath(x, 0, -r * 0.55, r * 0.34, r * 0.24); fillC(x, acc(shade(C, 0.34)));
    eyesAt(x, r * 0.22, -r * 0.55, Math.max(1.4, r * 0.14), 1, 0.1, 0.08);
    limb(x, -r * 0.70, -r * 0.20, -r * 1.50, -r * 0.90 + Math.sin(ph) * r * 0.08, r * 0.35, shade(C, -0.20), Math.max(1.4, r * 0.11));
    limb(x, r * 0.70, -r * 0.25, r * 1.45, -r * 0.85 + Math.sin(ph + 1.05) * r * 0.08, -r * 0.32, shade(C, -0.20), Math.max(1.4, r * 0.11));
    limb(x, -r * 0.75, r * 0.20, -r * 1.60, r * 0.30 + Math.sin(ph + 2.10) * r * 0.08, r * 0.30, shade(C, -0.22), Math.max(1.3, r * 0.10));
    limb(x, r * 0.75, r * 0.25, r * 1.55, r * 0.55 + Math.sin(ph + 3.15) * r * 0.08, -r * 0.30, shade(C, -0.22), Math.max(1.3, r * 0.10));
    limb(x, -r * 0.55, r * 0.60, -r * 1.15, r * 1.15 + Math.sin(ph + 4.20) * r * 0.08, r * 0.28, shade(C, -0.25), Math.max(1.3, r * 0.10));
    limb(x, r * 0.60, r * 0.65, r * 1.20, r * 1.20 + Math.sin(ph + 5.25) * r * 0.08, -r * 0.26, shade(C, -0.25), Math.max(1.3, r * 0.10));
    eyeAt(x, -r * 0.50, -r * 1.00, Math.max(1.0, r * 0.07), 1, 0.1);
    ellPath(x, r * 0.50, r * 0.90, r * 0.12, r * 0.09); fillC(x, acc(shade(C, 0.34)));
    x.beginPath(); x.moveTo(r * 0.50, r * 0.80); x.lineTo(r * 0.60, r * 1.30);
    strokeC(x, acc(shade(C, 0.28)), Math.max(1.1, r * 0.08));
  }

  /* 26 缠根藤 —— 上半身露骨躯干 + 外露 3 条肋骨, 下半身拖 6 根根束 */
  function fRootthrall(x, r, ph, C) {
    var tg = Math.sin(ph) * r * 0.08;
    groundShadow(x, r, 0.90, 0.30);
    volume(x, r * 0.70, function () { blobPath(x, 0, -r * 0.10, r * 0.70, 0.14, 13); }, C, { lw: Math.max(1.4, r * 0.13) });
    x.beginPath();
    x.moveTo(-r * 0.42, -r * 0.08); x.quadraticCurveTo(-r * 0.10, r * 0.24, r * 0.40, -r * 0.04);
    x.moveTo(-r * 0.34, r * 0.14); x.quadraticCurveTo(-r * 0.06, r * 0.40, r * 0.28, r * 0.14);
    x.moveTo(-r * 0.20, r * 0.38); x.lineTo(r * 0.14, r * 0.34);
    strokeC(x, acc(BONE), Math.max(1.1, r * 0.07));
    roots(x, 0, r * 0.50, 6, r * 0.75 + tg * 0.2, 1.0, shade(C, -0.35), Math.max(1.2, r * 0.10));
    eyeAt(x, -r * 0.18, -r * 0.28, Math.max(1.1, r * 0.09), 1, 0.1);
    eyeAt(x, r * 0.20, -r * 0.18, Math.max(1.0, r * 0.06), 1, 0.1);
    mouthAt(x, 0, r * 0.10, r * 0.30, r * 0.16, 2, GOO);
    limb(x, -r * 0.60, -r * 0.10, -r * 1.00, r * 0.40, r * 0.25, shade(C, -0.25), Math.max(1.2, r * 0.10));
    limb(x, r * 0.60, -r * 0.15, r * 1.00, r * 0.35, -r * 0.22, shade(C, -0.25), Math.max(1.2, r * 0.10));
    ellPath(x, -r * 0.26, -r * 0.40, r * 0.20, r * 0.08, -0.4); fillC(x, rgba(WET, 0.28));
    ellPath(x, r * 0.40, r * 0.60, Math.max(0.7, r * 0.05), Math.max(0.55, r * 0.04)); fillC(x, acc(GOO));
  }

  /* 27 铁甲犀薯(精英 tier2) —— 披铁甲的厚躯: 前端一根骨锥, 甲缝透暗红, 全无眼睛 */
  function fIronrhizo(x, r, ph, C) {
    var run = 0.5 + Math.sin(ph) * 0.5;
    groundShadow(x, r, 1.5, 0.34, r * 0.60);
    volume(x, r * 1.05, function () {
      polyPath(x, [-r * 0.80, r * 0.40, -r * 0.86, -r * 0.20, -r * 0.10, -r * 0.50, r * 0.60, -r * 0.46,
        r * 0.92, -r * 0.16, r * 0.70, r * 0.44, -r * 0.10, r * 0.56]);
    }, C, { lw: Math.max(1.6, r * 0.13) });
    slab(x, function () { polyPath(x, [-r * 0.44, -r * 0.30, -r * 0.10, -r * 0.54, r * 0.34, -r * 0.44, r * 0.20, -r * 0.18]); },
      shade(C, -0.30), Math.max(1.1, r * 0.10));
    slab(x, function () { polyPath(x, [-r * 0.70, 0, -r * 0.40, -r * 0.24, r * 0.02, -r * 0.16, -r * 0.16, r * 0.10]); },
      shade(C, -0.22), Math.max(1.1, r * 0.10));
    slab(x, function () { polyPath(x, [-r * 0.88, r * 0.06, -r * 0.76, -r * 0.14, -r * 0.52, r * 0.10, -r * 0.70, r * 0.30]); },
      shade(C, -0.34), Math.max(1, r * 0.09));
    horn(x, r * 0.80, -r * 0.35, 0.25, r * 0.80, r * 0.26, shade(C, 0.34), 0);
    x.beginPath();
    x.moveTo(-r * 0.66, -r * 0.16); x.lineTo(-r * 0.46, r * 0.24);
    x.moveTo(-r * 0.30, -r * 0.30); x.lineTo(-r * 0.14, r * 0.30);
    x.moveTo(r * 0.06, -r * 0.36); x.lineTo(r * 0.18, r * 0.26);
    x.moveTo(r * 0.40, -r * 0.32); x.lineTo(r * 0.46, r * 0.18);
    strokeC(x, acc(run > 0.5 ? SEAM : GOO), Math.max(1.2, r * 0.09));
    leg(x, -r * 0.40, r * 0.50, -r * 0.60, r * 1.15, -r * 0.68, r * 0.90, Math.max(1.4, r * 0.12), shade(C, -0.40));
    leg(x, r * 0.35, r * 0.50, r * 0.60, r * 1.10, r * 0.65, r * 0.88, Math.max(1.4, r * 0.12), shade(C, -0.40));
    claw(x, r * 0.60, r * 0.40, 0.3, Math.max(1.6, r * 0.40), shade(C, -0.30));
    ellPath(x, -r * 0.30, -r * 0.42, r * 0.34, r * 0.12, -0.3); fillC(x, rgba(WET, 0.26));
  }

  /* 28 收割者 —— 瘦高兜帽身: 单臂骨镰 + 另一侧断肢, 兜帽下 3 只斜排的眼 */
  function fSlasher(x, r, ph, C) {
    var sw = Math.sin(ph) * r * 0.06;
    groundShadow(x, r, 0.70, 0.30);
    volume(x, r * 0.95, function () {
      polyPath(x, [-r * 0.30, r * 0.72, -r * 0.34, -r * 0.10, -r * 0.24, -r * 0.62, r * 0.26, -r * 0.62,
        r * 0.36, -r * 0.06, r * 0.30, r * 0.72, r * 0.06, r * 0.92]);
    }, C, { lw: Math.max(1.4, r * 0.12) });
    polyPath(x, [-r * 0.30, -r * 0.34, r * 0.04, -r * 1.06, r * 0.40, -r * 0.30, r * 0.26, -r * 0.42, -r * 0.24, -r * 0.40]);
    fillC(x, acc(shade(C, -0.20))); strokeC(x, inkOf(), Math.max(1.2, r * 0.11));
    ellPath(x, r * 0.05, -r * 0.55, r * 0.24, r * 0.20); fillC(x, accD(SOCK));
    eyeAt(x, r * 0.10, -r * 0.55, Math.max(1.0, r * 0.08), 1, 0.4);
    eyeAt(x, r * 0.28, -r * 0.42, Math.max(0.9, r * 0.06), 1, 0.4);
    eyeAt(x, r * 0.42, -r * 0.26, Math.max(0.8, r * 0.05), 1, 0.4);
    limb(x, r * 0.30, -r * 0.10, r * 0.95, -r * 0.60 + sw, -r * 0.25, shade(C, -0.20), Math.max(1.3, r * 0.11));
    horn(x, r * 0.95, -r * 0.70 + sw, 0.9, r * 1.05, r * 0.22, shade(C, 0.30), -0.5);
    limb(x, -r * 0.35, -r * 0.05, -r * 0.60, r * 0.28, r * 0.20, shade(C, -0.35), Math.max(1.2, r * 0.09));
    x.beginPath(); x.moveTo(-r * 0.60, r * 0.28); x.lineTo(-r * 0.42, r * 0.40);
    strokeC(x, accD(GOO), Math.max(1.2, r * 0.10));
    leg(x, -r * 0.20, r * 0.70, -r * 0.35, r * 1.20, -r * 0.42, r * 0.95, Math.max(1.2, r * 0.09), shade(C, -0.45));
    leg(x, r * 0.22, r * 0.70, r * 0.38, r * 1.18, r * 0.45, r * 0.92, Math.max(1.2, r * 0.09), shade(C, -0.45));
  }

  /* 29 裂荚籽卵(静止) —— 晒干的鼓壳: 顶裂一条缝, 缝里塞着 4 颗籽, 壳表纵向凹槽 */
  function fSplitpod(x, r, ph, C) {
    var br = Math.sin(ph) * r * 0.02;
    groundShadow(x, r, 0.90, 0.30);
    volume(x, r * 0.95, function () {
      polyPath(x, [
        -r * 1.308, -r * 0.883, -r * 0.599, -r * 1.276, -r * 0.360, -r * 1.098,
        -r * 0.134, -r * 0.942, r * 0.136, -r * 0.952, r * 0.857, -r * 1.799,
        r * 1.105, -r * 0.464, r * 0.677, r * 0.078, r * 0.300, r * 0.650, r * 0.016, r * 2.050,
        -r * 0.325, r * 0.599, -r * 0.508, r * 0.105]);
    }, C, { lw: Math.max(1.4, r * 0.13) });
    polyPath(x, [-r * 0.44, -r * 0.96, r * 0.44, -r * 0.94, r * 0.14, -r * 0.44, -r * 0.16, -r * 0.46]);
    fillC(x, accD(GOO));
    circlePath(x, -r * 0.20, -r * 0.62, r * 0.13);
    fillC(x, acc(shade(C, -0.30)));
    circlePath(x, r * 0.18, -r * 0.70, r * 0.11);
    fillC(x, acc(shade(C, -0.24)));
    circlePath(x, r * 0.02, -r * 0.44, r * 0.14);
    fillC(x, acc(shade(C, -0.16)));
    circlePath(x, r * 0.36, -r * 0.54, r * 0.09);
    fillC(x, acc(shade(C, -0.34)));
    x.beginPath();
    x.moveTo(-r * 0.74, r * 0.20); x.quadraticCurveTo(-r * 0.86, r * 0.62, -r * 0.62, r * 0.94);
    x.moveTo(r * 0.70, r * 0.16); x.quadraticCurveTo(r * 0.84, r * 0.56, r * 0.60, r * 0.90);
    x.moveTo(0, r * 0.44); x.quadraticCurveTo(r * 0.12, r * 0.72, r * 0.06, r * 1.00);
    strokeC(x, acc(shade(C, -0.42)), Math.max(1, r * 0.08));
    ellPath(x, -r * 0.30, -r * 0.28, r * 0.24, r * 0.10, -0.5); fillC(x, rgba(WET, 0.30));
    x.beginPath(); x.moveTo(-r * 0.14, -r * 0.60); x.lineTo(-r * 0.48, r * 0.10);
    strokeC(x, rgba(accD(GOO), 0.85), Math.max(1, r * 0.07));
  }

  /* 30 夜笑枭 —— 圆身枭影: 脸裂成 4 瓣(每瓣 1 只眼), 胸口鼓一个发声囊 */
  function fCackler(x, r, ph, C) {
    var bl = Math.abs(Math.sin(ph)) * r * 0.06;
    groundShadow(x, r, 0.90, 0.30);
    wing(x, -r * 0.30, -r * 0.05, -1.7, r * 1.00, r * 0.34, shade(C, -0.12), 0.50);
    wing(x, r * 0.30, -r * 0.05, -1.3 + Math.sin(ph) * 0.10, r * 0.95, r * 0.32, shade(C, -0.12), 0.50);
    volume(x, r * 0.80, function () { polyPath(x, [
        -r * 2.238, -r * 0.853, -r * 1.175, -r * 0.933, -r * 1.063, -r * 0.289,
        -r * 0.811, -r * 0.485, -r * 0.783, -r * 1.205, -r * 0.289, -r * 0.609,
        -r * 0.049, -r * 1.082, r * 0.199, -r * 1.256, r * 0.226, -r * 0.805,
        r * 0.850, -r * 0.369, r * 1.060, -r * 0.369, r * 1.052, -r * 1.003, r * 1.615, -r * 1.332,
        r * 1.645, -r * 0.433, r * 1.648, r * 0.319, r * 1.288, r * 0.563, r * 0.122, r * 1.099,
        -r * 0.467, r * 0.797, -r * 0.626, r * 0.349, -r * 0.974, r * 0.047]); }, C, { lw: Math.max(1.4, r * 0.13) });
    volume(x, r * 0.46, function () { circlePath(x, 0, -r * 0.42, r * 0.46); }, C, { lw: Math.max(1.4, r * 0.13) });
    polyPath(x, [-r * 0.17, -r * 0.81, -r * 0.42, -r * 1.16, -r * 0.93, -r * 1.36, -r * 0.73, -r * 0.85, -r * 0.39, -r * 0.59]); fillC(x, acc(shade(C, 0.10)));
    polyPath(x, [r * 0.27, -r * 0.63, r * 0.49, -r * 0.89, r * 0.52, -r * 1.33, r * 0.16, -r * 1.08, r * 0.04, -r * 0.76]); fillC(x, acc(shade(C, -0.06)));
    polyPath(x, [-r * 0.30, -r * 0.33, -r * 0.56, -r * 0.18, -r * 0.73, r * 0.19, -r * 0.34, r * 0.09, -r * 0.14, -r * 0.15]); fillC(x, acc(shade(C, 0.04)));
    polyPath(x, [r * 0.06, -r * 0.16, r * 0.18, r * 0.08, r * 0.48, r * 0.25, r * 0.41, -r * 0.09, r * 0.22, -r * 0.28]); fillC(x, acc(shade(C, -0.14)));
    eyeAt(x, -r * 0.22, -r * 0.50, Math.max(1.0, r * 0.09), 5, 0);
    eyeAt(x, r * 0.20, -r * 0.52, Math.max(1.0, r * 0.08), 5, 0);
    eyeAt(x, -r * 0.18, -r * 0.28, Math.max(0.9, r * 0.06), 5, 0);
    eyeAt(x, r * 0.24, -r * 0.26, Math.max(0.8, r * 0.05), 5, 0);
    volume(x, r * 0.30, function () { ellPath(x, 0, r * 0.35 + bl * 0.5, r * 0.30, r * 0.24); }, shade(C, -0.30), { lw: Math.max(1.2, r * 0.11) });
    /* 负形: 体侧贯通裂(近黑冷绿内里 + 体液外溢) —— 全表原本唯一没有裂口的一只, 规范 §3-A8 补齐 */
    x.beginPath(); x.moveTo(-r * 0.56, -r * 0.34); x.lineTo(-r * 0.12, -r * 0.06); x.lineTo(-r * 0.46, r * 0.26);
    x.moveTo(r * 0.14, -r * 0.58); x.lineTo(r * 0.46, -r * 0.18); x.lineTo(r * 0.16, r * 0.08);
    strokeC(x, accD(GOO), Math.max(1.2, r * 0.10));
  }

  /* 31 喷吐藤(无眼) —— 茎顶裂成 5 瓣的吻(内侧倒刺), 茎上缠着 3 圈刺 */
  function fSpitweed(x, r, ph, C) {
    var op = 0.10 + Math.abs(Math.sin(ph)) * 0.10;
    groundShadow(x, r, 0.60, 0.28);
    volume(x, r * 0.60, function () {
      polyPath(x, [-r * 0.40, r * 0.80, -r * 0.44, r * 0.36, -r * 0.32, -r * 0.12, r * 0.32, -r * 0.12,
        r * 0.44, r * 0.36, r * 0.40, r * 0.80]);
    }, shade(C, -0.02), { lw: Math.max(1.3, r * 0.12) });
    polyPath(x, [-r * 0.04, -r * 0.60, -r * 0.46, -r * 1.06 - op, -r * 0.18, -r * 0.70]); fillC(x, acc(shade(C, 0.10)));
    polyPath(x, [r * 0.04, -r * 0.60, r * 0.36, -r * 0.94 - op, r * 0.16, -r * 0.70]); fillC(x, acc(shade(C, -0.04)));
    polyPath(x, [-r * 0.10, -r * 0.56, -r * 0.50, -r * 0.66 - op, -r * 0.20, -r * 0.50]); fillC(x, acc(shade(C, 0.04)));
    polyPath(x, [r * 0.10, -r * 0.56, r * 0.46, -r * 0.60 - op, r * 0.22, -r * 0.48]); fillC(x, acc(shade(C, -0.10)));
    polyPath(x, [-r * 0.08, -r * 0.52, r * 0.10, -r * 0.50, r * 0.02, -r * 0.34]); fillC(x, acc(shade(C, -0.02)));
    ellPath(x, 0, -r * 0.62, r * 0.20, r * 0.16); fillC(x, accD(GOO));
    polyPath(x, [-r * 0.16, -r * 0.72, -r * 0.06, -r * 0.56, r * 0.04, -r * 0.74, r * 0.14, -r * 0.58, r * 0.18, -r * 0.70]);
    fillC(x, acc(shade(C, 0.28)));
    x.beginPath();
    x.beginPath();
    x.moveTo(-r * 0.36, r * 0.10); x.lineTo(-r * 0.06, r * 0.16);
    x.moveTo(-r * 0.32, r * 0.36); x.lineTo(-r * 0.02, r * 0.42);
    x.moveTo(-r * 0.38, r * 0.62); x.lineTo(-r * 0.10, r * 0.68);
    strokeC(x, acc(shade(C, 0.26)), Math.max(1.1, r * 0.09));
    ellPath(x, -r * 0.18, -r * 0.30, r * 0.18, r * 0.08, -0.5); fillC(x, rgba(WET, 0.28));
    ellPath(x, -r * 0.40, r * 0.75, Math.max(0.7, r * 0.05), Math.max(0.55, r * 0.04)); fillC(x, acc(GOO));
  }

  /* 32 沼生菜笋(数据 key 仍是 tentacle, 名字与形体在 v59 一起改成蔬菜) ——
   * 从土里拱出来的弯颈菜笋: 交错包叶 + 顶端一颗圆钝芽 + 两片外叶,
   * 两只大圆眼 + 笑口。去掉旧版的吸盘口与两撇肉须(用户逐字: 触手/生理不适)。 */
  function fTentacle(x, r, ph, C) {
    var lean = Math.sin(ph) * r * 0.05;
    groundShadow(x, r, 0.72, 0.28);
    volume(x, r * 1.05, function () {
      polyPath(x, [
        -r * 0.880, r * 2.395, r * 0.497, r * 0.940, r * 0.541, r * 0.451, r * 0.346, -r * 0.148,
        r * 0.514, -r * 0.699, r * 1.290, -r * 1.972, r * 0.575, -r * 0.865, r * 0.509, -r * 0.677,
        r * 0.198, -r * 1.120, -r * 0.192, -r * 1.507, -r * 0.656, -r * 2.490,
        -r * 0.903, -r * 1.522, -r * 0.519, -r * 0.988, -r * 0.414, -r * 0.196,
        -r * 0.818, r * 0.411]);
    }, C, { lw: Math.max(1.5, r * 0.13) });
    x.beginPath(); x.moveTo(-r * 0.72, r * 0.80); x.quadraticCurveTo(0, r * 0.98, r * 0.72, r * 0.80);
    strokeC(x, acc(shade(C, 0.26)), Math.max(1.2, r * 0.09));
    x.beginPath();
    x.moveTo(-r * 0.50, -r * 0.20); x.lineTo(r * 0.50, -r * 0.20);
    x.moveTo(-r * 0.46, r * 0.14); x.lineTo(r * 0.46, r * 0.14);
    x.moveTo(-r * 0.60, r * 0.48); x.lineTo(r * 0.60, r * 0.48);
    strokeC(x, acc(shade(C, 0.20)), Math.max(1.1, r * 0.08));
    leafBlade(x, -r * 0.34, -r * 0.34, -2.30 + lean * 0.6, r * 0.92, r * 0.32, shade(C, 0.30), 0.55);
    leafBlade(x, r * 0.36, -r * 0.26, -0.86 - lean * 0.6, r * 0.84, r * 0.30, shade(C, 0.24), -0.55);
    ellPath(x, lean, -r * 0.78, r * 0.30, r * 0.26);
    fillC(x, acc(shade(C, 0.34))); strokeC(x, inkOf(), Math.max(1.2, r * 0.11));
    eyeAt(x, -r * 0.11 + lean, -r * 0.84, Math.max(1.0, r * 0.09), 1, 0.2);
    eyeAt(x, r * 0.13 + lean, -r * 0.80, Math.max(0.9, r * 0.08), 1, 0.2);
    mouthAt(x, lean, -r * 0.58, r * 0.30, r * 0.11, 0, acc('#7a5a3a'));
    ellPath(x, -r * 0.20, -r * 0.15, r * 0.24, r * 0.09, -0.5); fillC(x, rgba(WET, 0.28));
  }

  /* 派生项 splitseed —— 裂荚里撒出的籽。
   * 数据上它是 buzzling 的非枚举别名(色与体量都来自蜂鸣虫), 但屏幕上是「裂荚的籽」,
   * 因此造型与 29 同源: 无翅 / 无尾针 / 壳体 + 裂缝 + 两只竖瞳眼。
   * 底色只在常态做一次向荚壳绿靠的 mix —— 白闪与冰冻期直接用 C, 免得闪白被染绿。 */
  function fSplitseed(x, r, ph, C) {
    var Cs = MODE ? C : mix(C, SEEDC, 0.62);
    groundShadow(x, r, 0.66, 0.28);
    volume(x, r * 0.60, function () {
      polyPath(x, [
        r * 0.019, -r * 1.363, r * 0.477, -r * 0.775, r * 0.516, r * 0.009, r * 0.341, r * 0.542,
        -r * 0.132, r * 0.648, -r * 0.530, r * 0.566, -r * 0.679, r * 0.066,
        -r * 0.689, -r * 0.419, -r * 0.578, r * 0.848, -r * 1.300, r * 1.440, -r * 0.372, r * 1.440]);
    }, Cs, { lw: Math.max(1.2, r * 0.14) });
    x.beginPath(); x.moveTo(-r * 0.34, -r * 0.20); x.quadraticCurveTo(0, r * 0.10, r * 0.36, -r * 0.14);
    strokeC(x, accD(GOO), Math.max(1.1, r * 0.12));
    eyeAt(x, -r * 0.18, -r * 0.10, Math.max(0.9, r * 0.08), 1, 0);
    eyeAt(x, r * 0.16, -r * 0.06, Math.max(0.8, r * 0.06), 1, 0);
    ellPath(x, -r * 0.20, -r * 0.24, r * 0.14, r * 0.06, -0.5); fillC(x, rgba(WET, 0.28));
    ellPath(x, r * 0.30, r * 0.35, Math.max(0.6, r * 0.04), Math.max(0.5, r * 0.03)); fillC(x, acc(GOO));
  }

  /* ============================ 分派表 ============================ */
  var FOES = {
    sprout: fSprout, hopper: fHopper, thug: fThug, spitweed: fSpitweed, charger: fCharger,
    buzzling: fBuzzling, fly: fFly, rockling: fRockling, splitpod: fSplitpod, splitseed: fSplitseed,
    cackler: fCackler, lamprey: fLamprey, slasher: fSlasher, tentacle: fTentacle, soilheap: fSoilheap,
    rotstump: fRotstump, mobrage: fMobrage, finling: fFinling, herbwife: fHerbwife,
    hornpumpkin: fHornpumpkin, hornpod: fHornpod, crothief: fCrothief, rootthrall: fRootthrall,
    scythemantis: fScythemantis, earthmother: fEarthmother, asceticradish: fAsceticradish,
    ironrhizo: fIronrhizo, elBrute: fElBrute, elWeaver: fElWeaver, elReaper: fElReaper,
    soulvine: fSoulvine, kingTuber: fKingTuber, elderBlight: fElderBlight,
    /* bonehead 与 tentacle 同形(非枚举别名); 不进分派表就会掉进 drawShape 兜底圆怪(规范 §4.1) */
    bonehead: fTentacle
  };
  /** 按 key 分派(所有绘制都以精灵中心为原点; 白闪/冰冻由 MODE + acc/accD 统一换色) */
  function drawShape(x, key, r, ph, C) {
    var f = FOES[key];
    if (f) { f(x, r, ph, C); return; }
    /* 未知 key 兜底: 保证"新加数据不改美术也不会黑屏" */
    groundShadow(x, r, 0.9, 0.32);
    volume(x, r, function () { blobPath(x, 0, 0, r * 0.94, 0.1, 3); }, C, { lw: Math.max(1.5, r * 0.13) });
    eyesAt(x, r * 0.3, -r * 0.16, Math.max(1.9, r * 0.19), 0, 0.3);
    mouthAt(x, 0, r * 0.34, r * 0.44, r * 0.18, 6, '#3a2218');
  }

  /* ============================ 精灵规格 / 烘焙 ============================
   * 坐标纪律: 烘焙回调拿到的 ctx 已被 PS.Sprites 平移到画布中心, 所以所有绘制
   *   一律以 (0,0) 为中心; 每帧落图时只给 drawImage 一个世界坐标 (e.x, e.y)。
   *   —— 绝不再出现 ui.js drawMonsterModel 里"漏 e.x 导致怪画在世界原点"的错。 */
  var FRAMES = 3;
  function spriteSpec(key, r) {
    var m = meta(key), s = m.vs || 1;      /* s: 逐族视觉放大 —— 必须与 paintEnemy 的 x.scale 一致 */
    var halfW = Math.ceil(r * m.wf * s) + 6;
    var halfH = Math.ceil(r * Math.max(m.top || 1.3, m.bot || 1.0) * s + 8) + 4;
    return { w: halfW * 2, h: halfH * 2 };
  }
  /** 3 帧姿态循环; 相位由坐标哈希决定 → 整屏怪不会同手同脚 */
  function frameOf(time, x, y, rate) {
    var ph = h2(x * 0.017, y * 0.013) * FRAMES;
    var f = ((time * (8 * (rate || 1)) + ph) | 0) % FRAMES;
    return f < 0 ? f + FRAMES : f;
  }
  /** 敌人体温表: 冰冻态额外糊一层霜壳(视觉上"被冻住", 且仍然是 1 次 drawImage) */
  function frostShell(x, r) {
    var i;
    for (i = 0; i < 6; i++) {
      var a = i / 6 * TAU + 0.4;
      x.beginPath();
      x.moveTo(0, 0);
      x.lineTo(Math.cos(a) * r * 1.06, Math.sin(a) * r * 1.06);
      x.lineTo(Math.cos(a + 0.24) * r * 0.92, Math.sin(a + 0.24) * r * 0.92);
      x.closePath();
      x.fillStyle = rgba(palette.freeze, 0.3); x.fill();
      x.strokeStyle = rgba('#ffffff', 0.5); x.lineWidth = 1.1; x.stroke();
    }
    x.beginPath();
    x.ellipse(0, 0, r * 1.1, r * 1.16, 0, 0, TAU);
    x.strokeStyle = rgba(palette.freeze, 0.75); x.lineWidth = 2; x.stroke();
  }
  /** 敌人精灵烘焙内容(静态外形 + 影子 + 血条底槽 + 身份标识 + 冰冻霜壳) */
  function paintEnemy(x, key, r, frame, mode, dmg, base, tier) {
    MODE = mode || 0;
    var ph = frame / FRAMES * TAU, m = meta(key);
    var C = MODE === 1 ? acc(base) : (MODE === 2 ? mix(base, palette.freeze, 0.34) : base);
    C = satAdj(C, MODE ? 0.9 : 1.0);           /* v57: 普通怪不再降饱和(用户要明亮的蔬菜色) */
    if (!MODE) C = foeTone(C);                 /* v57 蔬菜明色调: 提饱和 + 抬明度(见 foeTone) */
    /* 视觉体放大: 只放大"画出来的身子", 判定半径 r 与血条坐标(ui.js 对齐)都不变。
     * 影子/光环/王冠一起放大, 否则会跟形体脱节(观感上像两件东西)。 */
    var vs = m.vs || 1;
    x.save();
    x.scale(vs, vs);
    groundShadow(x, r, m.dir ? Math.min(m.wf * 0.62, 1.0) : 0.9, m.dir ? 0.5 : 0.33);
    tierRing(x, r, tier, C);
    tierGlow(x, r, tier);
    CUTE = 1; CUTE_ER = r * 0.30;              /* v57 憨态五官: 大圆眼 + 笑口 + 腮红 */
    try { drawShape(x, key, r, ph, C); } finally { CUTE = 0; }
    if (MODE === 2) frostShell(x, r);
    x.restore();
    if (dmg) {   // 血条底槽: 与 ui.js 完全同位置(y=-r-11, w=max(26, r*2.2), h=4)
      var bw = Math.max(26, r * 2.2);
      x.fillStyle = 'rgba(0,0,0,0.5)';
      x.fillRect(-bw / 2, -r - 11, bw, 4);
      x.fillStyle = 'rgba(0,0,0,0.35)';
      x.fillRect(-bw / 2, -r - 11, bw, 1);
    }
    MODE = 0;
  }

  /* ============================ 对外 API(PS.Art) ============================ */
  PS.Art = PS.Art || {};
  PS.Art.palette = palette;
  PS.Art.FRAMES = FRAMES;
  /** 名录: 预览页/调试用 */
  PS.Art.roster = ['sprout', 'hopper', 'thug', 'spitweed', 'charger', 'buzzling', 'fly', 'rockling',
    'splitpod', 'splitseed', 'cackler', 'lamprey', 'slasher', 'tentacle',
    'soilheap', 'rotstump', 'mobrage', 'finling', 'herbwife', 'hornpumpkin', 'hornpod', 'crothief',
    'rootthrall', 'scythemantis', 'earthmother', 'asceticradish', 'ironrhizo', 'soulvine',
    'elBrute', 'elWeaver', 'elReaper', 'kingTuber', 'elderBlight'];
  /* 形体元数据对外只读导出: work/calc-vs53.cjs 与 qa/verify-enemy-size.cjs 量"精灵框是否够大"用 */
  PS.Art.shapeTable = SHAPE;
  PS.Art.groundScale = 1;

  /** 敌人: 每帧 1 次 drawImage(+受伤时 1 次 fillRect 画血量) */
  function drawFoe(ctx, e, def, time, forceElite) {
    if (!ctx || !e) return;
    var d = def || e.def || {};
    var r = e.r || d.r || 12;
    var key = e.key || d.id || '_def';
    var t = time || 0;
    if (e.spawnT > 0) {                       // 入场预警(与 ui.js 同语义, 1 次 stroke)
      ctx.globalAlpha = 1 - e.spawnT / 0.4;
      ctx.strokeStyle = d.color || palette.foe;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(e.x, e.y, r * (0.5 + e.spawnT * 1.4), 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    var flash = (e.hitT || 0) > 0;
    var dmg = e.hp < e.maxHp;
    var m = meta(key);
    var frame = frameOf(t, e.x, e.y, m.ph);
    var sp = spriteSpec(key, r);
    var base = d.color || palette.foe;
    if (FOE_VEG[key]) base = FOE_VEG[key];   /* v57: 灰/暗数据色的族改用蔬菜色 */
    if (e.phase2) base = mix(base, palette.alert, 0.22);   // 二阶段: 偏危险色(仍属同一色相家族)
    var tier = e.boss ? 2 : ((e.elite || forceElite) ? Math.max(1, m.tier || 1) : (m.tier || 0));
    var ang = 0;
    if (isFinite(e.face)) ang = e.face;
    else if (isFinite(e.ang)) ang = e.ang;
    else if (isFinite(e.aimAng)) ang = e.aimAng;
    else if (e.dashVX || e.dashVY) ang = Math.atan2(e.dashVY || 0, e.dashVX || 1);
    var flip = Math.cos(ang) < 0, rot = 0;
    if (m.dir) { rot = ang; if (flip) rot -= Math.PI; }
    var mode = flash ? 1 : (e.frozen ? 2 : 0);
    var ck = 'e:' + key + ':' + r + ':' + tier + ':' + frame +
      (mode === 1 ? ':f' : (mode === 2 ? ':z' : ':n')) + (dmg ? ':h' : ':o') + (e.phase2 ? ':p' : '');
    var sc = e.boss ? 1 + Math.sin(t * 3.2) * 0.045 : 1;
    var snap = e.x, snapY = e.y;
    drawSprite(ctx, ck, sp.w, sp.h,
      function (cc, xx) { paintEnemy(xx, key, r, frame, mode, dmg, base, tier); },
      snap, snapY, {
        flip: flip, rot: rot, scale: sc, alpha: e.frozen ? 0.92 : undefined,
        fallback: function (cc) {
          cc.save(); cc.translate(snap, snapY);
          if (rot) cc.rotate(rot);
          if (flip) cc.scale(-1, 1);
          paintEnemy(cc, key, r, frame, mode, dmg, base, tier);
          cc.restore();
        }
      });
    if (dmg) {                                // 血量实心(底槽已烘焙) —— 1 次 fillRect
      var bw = Math.max(26, r * 2.2);
      ctx.fillStyle = e.boss ? palette.goldLite : ((e.elite || forceElite) ? '#ffab4a' : '#e06c5a');
      ctx.fillRect(e.x - bw / 2, e.y - r - 11, bw * clamp(e.hp / e.maxHp, 0, 1), 4);
    }
    if (e.frozen) {                           // 冻结提示(霜壳已烘焙在内, 这里只补一圈呼吸光)
      ctx.strokeStyle = rgba(palette.freeze, 0.34 + 0.2 * Math.abs(Math.sin(t * 3)));
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(e.x, e.y, r * 1.2, 0, TAU); ctx.stroke();
    }
    /* v6.7(Wave 3, 2026-09-29) 燃烧态提示 —— 源里是粒子(unit.gd:618-653 apply_burning), 本作落成
     *   「一圈火环 + 四簇火苗」。存在理由: Wave 3 的燃烧机制(鬼火/隔夜炒饭/火油藤/燃烧按血比…)
     *   已经能打出伤害, 但怪身上**没有任何提示**, 玩家看不出谁在烧 —— 逻辑有、画面没有, 与结构体同族。
     *   v6.8(2026-09-29, 用户逐字「不要这个王冠」): 初版是**三根等距朝上的三角形**, 缩到游戏实际
     *   尺寸后读成「头顶一顶王冠」, 与 v5.17 起「不画王冠」的规矩正面冲突(见上文 tierRing 一段)。
     *   改成**沿火环径向朝外**的四簇火苗: 方位刻意不对称(-2.50 / -0.90 / 0.50 / 2.20 rad),
     *   逐簇带长度脉动与左右摆动, 外焰之上再叠一层亮黄内焰 ⇒ 读成「火」而不是「刺」。
     *   半径口径: 火环 1.26r; 火苗底 1.00r、尖端 ≤1.73r ⇒ 新增像素全部落在画面门禁 [C] 允许的
     *   0.75r~1.9r 带内, 核心 0.5r 内一个像素都不碰。
     *   成本: 只在 e.burn.dur > 0 时画, 1 条描边 + 4×(外焰+内焰) 共 9 条 path。 */
    if (e.burn && e.burn.dur > 0) {
      ctx.strokeStyle = rgba(palette.alert, 0.4 + 0.28 * Math.abs(Math.sin(t * 6 + e.x * 0.05)));
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(e.x, e.y, r * 1.26, 0, TAU); ctx.stroke();
      var FA = [-2.50, -0.90, 0.50, 2.20];   /* 四簇火苗的方位(弧度), 刻意不对称 —— 对称就等于王冠 */
      for (var fb = 0; fb < 4; fb++) {
        var fa = FA[fb] + Math.sin(t * 2.2 + fb * 1.7 + e.y * 0.03) * 0.16;   /* 逐簇左右摆动 */
        var len = r * 0.58 + Math.sin(t * 9 + fb * 2.3) * r * 0.14;            /* 逐簇长度脉动 */
        var ux = Math.cos(fa), uy = Math.sin(fa), nx = -uy, ny = ux;
        var hw = r * 0.17, bx = e.x + ux * r, by = e.y + uy * r;
        var curl = Math.sin(t * 7 + fb * 2.1) * hw * 0.5;
        ctx.fillStyle = rgba(palette.alert, 0.55 + 0.3 * Math.abs(Math.sin(t * 8 + fb * 2.1)));
        ctx.beginPath();
        ctx.moveTo(bx + nx * hw, by + ny * hw);
        ctx.quadraticCurveTo(bx + ux * len * 0.5 + nx * hw * 1.25, by + uy * len * 0.5 + ny * hw * 1.25,
                             bx + ux * len + nx * curl, by + uy * len + ny * curl);
        ctx.quadraticCurveTo(bx + ux * len * 0.5 - nx * hw * 1.25, by + uy * len * 0.5 - ny * hw * 1.25,
                             bx - nx * hw, by - ny * hw);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = rgba(palette.goldLite, 0.6 + 0.3 * Math.abs(Math.sin(t * 8 + fb * 2.1)));
        ctx.beginPath();
        ctx.moveTo(bx + nx * hw * 0.45, by + ny * hw * 0.45);
        ctx.quadraticCurveTo(bx + ux * len * 0.24 + nx * hw * 0.5, by + uy * len * 0.24 + ny * hw * 0.5,
                             bx + ux * len * 0.46, by + uy * len * 0.46);
        ctx.quadraticCurveTo(bx + ux * len * 0.24 - nx * hw * 0.5, by + uy * len * 0.24 - ny * hw * 0.5,
                             bx - nx * hw * 0.45, by - ny * hw * 0.45);
        ctx.closePath(); ctx.fill();
      }
    }
  }
  PS.Art.drawEnemy = function (ctx, e, def, time) { drawFoe(ctx, e, def, time, false); };
  PS.Art.drawElite = function (ctx, e, def, time) { drawFoe(ctx, e, def, time, true); };

  /* ==================== v6.7(Wave 3, 2026-09-29) 结构体 / 地雷 ====================
   * 存在理由(事故): Wave 3 补进来的 11 件道具在源里的效果是「在场上生成一个结构体」——
   *   逻辑(game.js 的 spawnStructures / updateStructures)当时已经通了, 而 drawWorld 从来没画过
   *   g.structs / g.mines ⇒ 玩家买了哨戒炮/地雷, 场上什么都没有(与 structures.js 头注释里写的
   *   「卡面有字、买了没反应」是同一类失效)。
   * v6.7 初版走**程序化绘制**(与掉落/尸体/弹丸同一层), 不出位图 —— 当时的理由是「结构体每波按面板值重建
   *   (源 entity_spawner.gd:526-542)、且是场上动态实体, 出位图会让图集认领逻辑变复杂」。
   * v6.8(2026-09-29, 用户逐字「这些炮塔也生图，做建模」): 改成**出图 + 装机**(清单 struct 9 项,
   *   精灵 key 前缀 s:<key>:<r>), 程序化绘制整体降级为**缺图回落** —— 与怪/武器/道具走同一条路
   *   (PS.Sprites 的 bake 钩子), 命中位图就短路绘制回调。认领逻辑并不复杂: key 里就带着 key 与 r。
   * 配色一律取数据真源 def.color; 只有「医疗哨座」用 palette.heal(它的语义是治疗, 不是伤害)。
   * 成本: 每结构体每帧 4~8 条 path, 上限 B.STRUCT.max=100 ⇒ 与弹丸同量级, 且参与视口裁剪。
   * 尺寸口径: 所有几何都按 st.r(=STRUCT 的 r=11) 成比例, 缩到实际尺寸仍是一个「有炮管的台子」。 */
  /* 槽位(方形, 逻辑像素) —— **由「和同半径的怪一样大」反推**, 不是「刚好装下程序化图形」。
   * 标定 1(work/w7-foe-size.cjs, 2026-09-29): 22 只普通怪图上量 max(宽,高)/r 的**中位 = 3.22**
   *   (区间 2.57~4.92) ⇒ 结构体统一瞄准 max(宽,高) ≈ 3.2r, 与同半径的怪同一量级。
   * 标定 2(work/w7-struct-size.cjs): 逐台量「程序化 vs 位图」的外框, 反解出每台需要的槽位。
   *   实测(改前 → 改后, max(宽,高)/r): turret 2.7→3.2 · flame 3.5→3.2 · healing 2.2→3.2 ·
   *   laser 3.8→3.2 · rocket 2.2→3.2 · tyler 2.5→3.2 · garden 3.2→3.2 · bot 2.2→3.2 · mine 2.3→3.2。
   * 不变式: 槽位一半必须 >= 程序化图形的径向最大(缺图回落时被槽位切掉 = 静默失真, 见仓库既有教训)。
   *   verify-struct-vis 的 [A2] 与 work/w7-struct-size.cjs 都盯着这条; 改动判据 = 再量一次。 */
  var STRUCT_EXT = {
    turret: 2.00,
    turret_flame: 1.95,
    turret_healing: 2.05,
    turret_laser: 1.64,
    turret_rocket: 2.50,
    tyler: 2.00,
    garden: 1.73,
    wandering_bot: 2.11,
    landmines: 1.81
  };
  /* ============ v6.9 炮台开火后坐力(源 turret_shoot_animation.tres 逐键照搬) ============
   * 源 keyframes(times 0 / 0.1 / 0.2 / 0.3):
   *   Animation:position.y  = -20 / -32 / -18 / -24   (静息位 -24 ⇒ 相对量 +4 / -8 / +6 / 0)
   *   Animation:scale      = (1.1,0.9) / (0.8,1.2) / (1.2,0.8) / (1,1)
   * 单位换算: 源贴图高 100px ⇒ 1px = 0.01 张图高; 本作一张图高 ≈ 3.2r(qa/art-direction.md §2.1)
   *   ⇒ dy = 0.01 × 3.2 = 0.032r/px。这里直接把**相对位移**写成张图高的比例, 落图时再 × r。
   * 纪律: 只做 position + scale; **任何 rotation 都不许加回来** —— 那是原版没有的自由度。 */
  var SHOOT_LEN = 0.3;
  var SHOOT_KEYS = [
    { t: 0.00, dy: 0.13, sx: 1.10, sy: 0.90 },
    { t: 0.33, dy: -0.26, sx: 0.80, sy: 1.20 },
    { t: 0.67, dy: 0.19, sx: 1.20, sy: 0.80 },
    { t: 1.00, dy: 0.00, sx: 1.00, sy: 1.00 }
  ];
  /** shootT(剩余秒) -> 姿态; 不在播放中返回 null(调用方据此完全跳过 save/scale)。 */
  function shootPose(shootT) {
    if (!(shootT > 0)) return null;
    var p = 1 - shootT / SHOOT_LEN, i, a = null, b = null, k = 1;
    if (p < 0) p = 0; if (p > 1) p = 1;
    for (i = 0; i < SHOOT_KEYS.length - 1; i++) {
      if (p <= SHOOT_KEYS[i + 1].t) { a = SHOOT_KEYS[i]; b = SHOOT_KEYS[i + 1]; k = (p - a.t) / (b.t - a.t); break; }
    }
    if (!a) { a = SHOOT_KEYS[2]; b = SHOOT_KEYS[3]; k = 1; }
    return { dy: a.dy + (b.dy - a.dy) * k, sx: a.sx + (b.sx - a.sx) * k, sy: a.sy + (b.sy - a.sy) * k };
  }
  function structSpriteSpec(key, r) {
    var e = STRUCT_EXT[key] || 2.1;
    var d = Math.ceil(r * 2 * e) + 8;
    return { w: d, h: d };
  }

  /** 结构体静态件(不含阴影 / 不含旋转 / 不含游走浮动) —— 烘进精灵的那一份。
   *  坐标纪律: 烘焙回调的 ctx 已被 PS.Sprites 平移到画布中心 ⇒ 这里一律以 (0,0) 为原点。
   *  v6.9 起只剩**一处有意偏差**(写在这里, 不许静默):
   *   ① 火舌的跳动/苗的摆动本来吃 t2, 精灵是静态件 ⇒ 烘成定值, 动态部分挪到落图处。
   *   备注: v6.8 曾记「位图是一整张, 跟着一起转」—— 那条已在 v6.9 撤销: 源炮塔**不自转**
   *   (见 SHOOT_KEYS 上方注释), 所以这一层不再有任何旋转, 程序化降级与位图行为一致。 */
  function paintStruct(x, key, def, r) {
    var col = def.color || palette.gold, kind = def.kind || 'gun';
    if (kind === 'pet') {
      /* 游走铁虫: 圆顶小机身 + 两只镜头 + 一根粗短天线(源 is_pet, 绕玩家游走) */
      x.fillStyle = INK;
      x.beginPath(); x.ellipse(0, r * 0.5, r * 0.84, r * 0.62, 0, 0, TAU); x.fill();
      x.fillStyle = col;
      x.beginPath(); x.ellipse(0, r * 0.42, r * 0.72, r * 0.5, 0, 0, TAU); x.fill();
      x.fillStyle = inkOf();
      x.beginPath(); x.arc(-r * 0.3, r * 0.24, r * 0.2, 0, TAU); x.fill();
      x.beginPath(); x.arc(r * 0.3, r * 0.24, r * 0.2, 0, TAU); x.fill();
      x.fillStyle = shade(col, -0.38);
      x.beginPath();
      x.moveTo(-r * 0.08, -r * 0.05);
      x.lineTo(r * 0.28, -r * 0.76);
      x.lineTo(r * 0.44, -r * 0.72);
      x.lineTo(r * 0.08, -r * 0.02);
      x.closePath(); x.fill();
      x.fillStyle = palette.goldLite;
      x.beginPath(); x.arc(r * 0.36, -r * 0.78, r * 0.14, 0, TAU); x.fill();
      return;
    }
    if (kind === 'garden') {
      /* 菜圃: 椭圆土畦 + 三株苗(源 garden: nb_projectiles = 0, 定期在脚边落果实) */
      x.fillStyle = INK;
      x.beginPath(); x.ellipse(0, r * 0.3, r * 1.55, r * 0.8, 0, 0, TAU); x.fill();
      x.fillStyle = palette.soilWet;
      x.beginPath(); x.ellipse(0, r * 0.3, r * 1.4, r * 0.68, 0, 0, TAU); x.fill();
      var gi, gx, gy;
      for (gi = -1; gi <= 1; gi++) {
        gx = gi * r * 0.72; gy = r * 0.2 + Math.sin(gi) * 0.7;
        x.strokeStyle = INK; x.lineWidth = r * 0.2;
        x.beginPath(); x.moveTo(gx, gy); x.lineTo(gx, gy - r * 0.28); x.stroke();
        x.fillStyle = col;
        x.beginPath(); x.ellipse(gx - r * 0.28, gy - r * 0.5, r * 0.36, r * 0.22, -0.6, 0, TAU); x.fill();
        x.beginPath(); x.ellipse(gx + r * 0.28, gy - r * 0.5, r * 0.36, r * 0.22, 0.6, 0, TAU); x.fill();
        x.fillStyle = shade(col, 0.34);
        x.beginPath(); x.arc(gx, gy - r * 0.6, r * 0.17, 0, TAU); x.fill();
      }
      return;
    }
    /* gun / heal: 台座 + 转台 */
    x.fillStyle = INK;
    x.beginPath(); x.ellipse(0, r * 0.6, r * 1.0, r * 0.44, 0, 0, TAU); x.fill();
    x.fillStyle = shade(col, -0.36);
    x.beginPath(); x.ellipse(0, r * 0.52, r * 0.86, r * 0.34, 0, 0, TAU); x.fill();
    x.fillStyle = INK;
    x.beginPath(); x.arc(0, 0, r * 0.7, 0, TAU); x.fill();
    x.fillStyle = col;
    x.beginPath(); x.arc(0, 0, r * 0.57, 0, TAU); x.fill();
    if (kind === 'heal') {
      /* 医疗哨座: 十字(源 is_healing=true, 不伤敌只回血) —— 不随 st.ang 转 */
      x.fillStyle = INK;
      x.fillRect(-r * 0.52, -r * 0.17, r * 1.04, r * 0.34);
      x.fillRect(-r * 0.17, -r * 0.52, r * 0.34, r * 1.04);
      x.fillStyle = palette.heal;
      x.fillRect(-r * 0.42, -r * 0.11, r * 0.84, r * 0.22);
      x.fillRect(-r * 0.11, -r * 0.42, r * 0.22, r * 0.84);
      return;
    }
    /* 五种炮型: 靠**炮管形态与管口配件**区分 —— 缩到实际尺寸也读得出是哪一种 */
    if (key === 'turret') {
      /* 哨戒炮: 一副撑在地上的两脚架 */
      var lp;
      x.strokeStyle = INK; x.lineWidth = r * 0.36;
      for (lp = -1; lp <= 1; lp += 2) {
        x.beginPath();
        x.moveTo(lp * r * 0.26, r * 0.06);
        x.lineTo(lp * r * 1.2, r * 0.8);
        x.stroke();
      }
    }
    if (key === 'tyler') {
      /* 散射哨座: 三根散开的粗管 */
      var k2;
      for (k2 = -1; k2 <= 1; k2++) {
        x.save(); x.rotate(k2 * 0.34);
        x.fillStyle = INK; x.fillRect(r * 0.3, -r * 0.15, r * 1.12, r * 0.3);
        x.fillStyle = shade(col, 0.2); x.fillRect(r * 0.34, -r * 0.09, r * 1.02, r * 0.18);
        x.restore();
      }
    } else {
      var tw = key === 'turret_flame' ? 0.44 : (key === 'turret_laser' ? 0.16 : (key === 'turret_rocket' ? 0.42 : 0.34));
      var tl = key === 'turret_laser' ? 1.5 : (key === 'turret_rocket' ? 1.0 : 1.2);
      x.fillStyle = INK; x.fillRect(r * 0.22, -r * (tw + 0.09), r * tl, r * (tw * 2 + 0.18));
      x.fillStyle = shade(col, 0.18); x.fillRect(r * 0.27, -r * tw, r * (tl - 0.1), r * tw * 2);
      if (key === 'turret_flame') {
        /* 喷火哨座: 管口一簇火舌(跳动已烘成定值) */
        x.fillStyle = palette.alert;
        x.beginPath();
        x.moveTo(r * (tl + 0.18), -r * 0.34);
        x.lineTo(r * (tl + 0.82), 0);
        x.lineTo(r * (tl + 0.18), r * 0.34);
        x.closePath(); x.fill();
        x.fillStyle = palette.goldLite;
        x.beginPath();
        x.moveTo(r * (tl + 0.16), -r * 0.16);
        x.lineTo(r * (tl + 0.5), 0);
        x.lineTo(r * (tl + 0.16), r * 0.16);
        x.closePath(); x.fill();
      } else if (key === 'turret_laser') {
        /* 激光哨座: 细长管 + 管口聚光镜 */
        x.fillStyle = INK; x.beginPath(); x.arc(r * (tl + 0.12), 0, r * 0.28, 0, TAU); x.fill();
        x.fillStyle = '#cfe9ff'; x.beginPath(); x.arc(r * (tl + 0.12), 0, r * 0.17, 0, TAU); x.fill();
      } else if (key === 'turret_rocket') {
        /* 火箭哨座: 管口探出的弹头 + 尾翼 */
        x.fillStyle = INK;
        x.beginPath(); x.moveTo(r * (tl - 0.08), -r * 0.52); x.lineTo(r * (tl + 0.46), 0); x.lineTo(r * (tl - 0.08), r * 0.52); x.closePath(); x.fill();
        x.fillStyle = palette.cream;
        x.beginPath(); x.moveTo(r * (tl - 0.14), -r * 0.36); x.lineTo(r * (tl + 0.26), 0); x.lineTo(r * (tl - 0.14), r * 0.36); x.closePath(); x.fill();
        x.fillStyle = shade(col, -0.3);
        x.fillRect(r * 0.34, -r * 0.88, r * 0.36, r * 0.5);
        x.fillRect(r * 0.34, r * 0.38, r * 0.36, r * 0.5);
      } else {
        /* 哨戒炮: 管口加粗一圈 */
        x.fillStyle = shade(col, -0.32);
        x.fillRect(r * (tl - 0.04), -r * 0.44, r * 0.3, r * 0.88);
      }
    }
  }

  PS.Art.drawStruct = function (ctx, st, time) {
    var def = st.def || {}, x = st.x, y = st.y, r = st.r || 11;
    var kind = def.kind || 'gun', key = st.key || '', t2 = time || 0;
    /* kind='mine' 的数据行(landmines)在源里走 addMine、落点是 g.mines —— 真被生成时也交给 drawMine, */
    /*   免得它落到 gun 分支被画成第二个哨戒炮(实测: 与 turret 的剪影余弦 = 1.000)。 */
    if (kind === 'mine') { PS.Art.drawMine(ctx, { key: key, def: def, x: x, y: y, r: r, armed: 0 }, t2); return; }
    /* 接触阴影画在精灵**之外**(精灵会转, 阴影不转) */
    groundShadowAt(ctx, x, y, r, 0.9, 0.33);
    var sp = structSpriteSpec(key, r);
    /* 游走铁虫的浮动: 挪到落图坐标上 —— 影子留在原地(它是悬浮的, 不该把影子一起抬起来) */
    var yy = y + (kind === 'pet' ? Math.sin(t2 * 2 + (st.petT || 0)) * 0.7 : 0);
    /* v6.9 源对齐: **炮台不自转**。源的 shoot 轨道只有 position / scale, 没有任何 rotation ——
     *   原版炮塔是"定在地上、开火时弹一下"的固定炮位。旧实现让整只炮台(连三脚架)原地打转 ⇒
     *   用户实测「这些炮台在游戏里完全不像炮台」。现在落成源那套后坐力姿态(见 shootPose)。 */
    var pose = (kind === 'gun') ? shootPose(st.shootT) : null;
    if (pose) yy += pose.dy * r;
    if (pose) { ctx.save(); ctx.translate(x, yy); ctx.scale(pose.sx, pose.sy); ctx.translate(-x, -yy); }
    drawSprite(ctx, 's:' + key + ':' + r, sp.w, sp.h,
      function (cc) { paintStruct(cc, key, def, r); }, x, yy, {
        fallback: function (cc) { cc.save(); cc.translate(x, yy); paintStruct(cc, key, def, r); cc.restore(); }
      });
    if (pose) ctx.restore();
  };

  /* ============ 场景道具: 树木(源 entities/units/neutral/tree.tscn) ============
   * 2026-09-30(Codex) 用户逐字「原版有树木, 砍到树木会掉落大量材料, 树木在地图中生成, 你也加进来做建模」。
   * 与结构体**同一条路**: 位图优先(key = t:tree:<r>, 走 PS.Sprites 的既有烘焙钩子), 缺图回落程序化。
   * key 用 t:(terrain) 而不是 p: —— p: 是地面地物名录 PROPS 的命名空间(lib 里 gPropImg 取 `p:<key>:<变体>`),
   *   两者形状一样, 共用前缀迟早会互相喂错图。
   * 与怪的区别(所以不能塞进 drawFoe): 树是 neutral, 没有朝向、没有血条底槽、不吃受击白闪/冰冻/二阶段;
   *   它只做三件事: 接地阴影 / 整株 / 受击闪 + "还能挨几下"的进度条。
   * 尺寸: 冠幅 = r * TREE_EXT(r=14 → 45px), 与 art-direction 的"世界精灵 ~3.2r"同档。 */
  var TREE_EXT = 3.2;
  function treeSpriteSpec(r) { var d = Math.ceil(r * TREE_EXT) + 8; return { w: d, h: d }; }
  /** 程序化回落件(缺图时用): 棕干 + 两根叉 + 三团圆叶冠, 与出图那张同一剪影语言。
   *  坐标纪律: 烘焙回调的 ctx 已被 PS.Sprites 平移到画布中心 ⇒ 一律以 (0,0) 为原点。 */
  function paintTree(x, r) {
    var c1 = '#6d5a33', c2 = '#8a7440', leafA = '#5f9c4a', leafB = '#7cc45e';
    x.fillStyle = c1;
    x.beginPath(); x.moveTo(-r * 0.17, r * 0.95); x.lineTo(-r * 0.11, -r * 0.1);
    x.lineTo(r * 0.11, -r * 0.1); x.lineTo(r * 0.17, r * 0.95); x.closePath(); x.fill();
    x.strokeStyle = c1; x.lineWidth = r * 0.12; x.lineCap = 'round';
    x.beginPath(); x.moveTo(0, r * 0.05); x.lineTo(-r * 0.42, -r * 0.42); x.stroke();
    x.beginPath(); x.moveTo(0, r * 0.02); x.lineTo(r * 0.40, -r * 0.46); x.stroke();
    var i, k, blobs = [[0, -r * 0.78, r * 0.78, leafA], [-r * 0.62, -r * 0.42, r * 0.55, leafB],
      [r * 0.66, -r * 0.4, r * 0.52, leafB], [0, -r * 1.12, r * 0.5, leafB]];
    x.fillStyle = INK;
    for (i = 0; i < blobs.length; i++) { x.beginPath(); x.arc(blobs[i][0], blobs[i][1], blobs[i][2] * 1.1, 0, TAU); x.fill(); }
    for (i = 0; i < blobs.length; i++) { x.fillStyle = blobs[i][3]; x.beginPath(); x.arc(blobs[i][0], blobs[i][1], blobs[i][2], 0, TAU); x.fill(); }
    void c2; void k;
  }
  /** 树木绘制入口(ui.js drawWorld 对 e.neutral 调它)。 */
  PS.Art.drawTree = function (ctx, e, time) {
    var r = e.r || 14, t2 = time || 0;
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.beginPath(); ctx.ellipse(e.x, e.y + r * 0.95, r * 1.0, r * 0.32, 0, 0, TAU); ctx.fill();
    var sp = treeSpriteSpec(r), hit = (e.hitT || 0) > 0;
    /* 受击: 整株轻微上下弹一下(不旋转 —— 树是站着的, 旋转会读成"倒") */
    var dy = hit ? Math.sin((t2 * 60)) * 1.5 : 0;
    drawSprite(ctx, 't:tree:' + r, sp.w, sp.h,
      function (cc) { paintTree(cc, r); }, e.x, e.y + dy, {
        fallback: function (cc) { cc.save(); cc.translate(e.x, e.y + dy); paintTree(cc, r); cc.restore(); }
      });
    if (hit) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(e.x, e.y - r * 0.75 + dy, r * 0.95, 0, TAU); ctx.fill();
      ctx.restore();
    }
    /* "还能挨几下": 源 neutral.gd:8 number_of_hits_before_dying = 8 —— 挨打不减血, 只累计次数。 */
    var mx = e.maxHp || 0;
    if (mx > 0 && e.hp < mx) {
      var bw = Math.max(18, r * 1.5), left = Math.max(0, e.hp) / mx;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(e.x - bw / 2, e.y - r * 2.35, bw, 4);
      ctx.fillStyle = '#8fd66b';
      ctx.fillRect(e.x - bw / 2, e.y - r * 2.35, bw * left, 4);
    }
  };

  /* ============ 场景道具: 果实(源 items/consumables/fruit + effects/consumables/consumable_healing_effect.gd) ============
   * 2026-10-01(Codex, W24) 用户逐字「原作还有果实，拾取可以回血」。取证(work/_w24-probe-fruit.cjs)结论:
   *   果实**逻辑早就在** —— game.js 的 updateDrops 里 d.kind==="fruit" 那一支真的加血; 缺的只是**画面**:
   *   ui.js 的掉落循环把每一个 g.drops 都交给 drawDrop(材料粒专用: 绿土豆 #8fd66b + 光晕),
   *   实测果实与材料粒**逐像素相同**(剪影余弦 1.000) ⇒ 玩家分不出哪颗能吃、哪颗只是材料。
   * 与树木同一条位图路(key = t:fruit:<r>, 走 PS.Sprites 的既有烘焙钩子, 缺图回落程序化), 三条纪律:
   *   ① 颜色必须与绿材料粒**一眼分得开**(红浆果 #d94a4a + 暖光晕) —— 这是它存在的全部意义;
   *   ② 它是掉在地上的一颗静物, **不做旋转**(旋转会读成"在飞"), 只做很轻的上下浮动;
   *   ③ 尺寸与 drawDrop 同口径(r≈7), 别把一颗果子画得比材料粒大一圈。 */
  var FRUIT_EXT = 3.2;
  function fruitSpriteSpec(r) { var d = Math.ceil(r * FRUIT_EXT) + 10; return { w: d, h: d }; }
  /** 程序化回落件(缺图时用): 胖圆红浆果 + 顶部一截短梗与两片小叶, 与出图那张同一剪影语言。
   *  坐标纪律与 paintTree 相同: 烘焙回调的 ctx 已被平移到画布中心 ⇒ 一律以 (0,0) 为原点。 */
  function paintFruit(x, r) {
    var body = "#d94a4a", stem = "#8f5a2b", leaf = "#4f9c3f";
    volume(x, r * 0.92, function () { blobPath(x, 0, 0, r * 0.92, 0.10, 3); }, body, { lw: 1.6, gloss: 0.5 });
    x.strokeStyle = stem; x.lineWidth = Math.max(1.2, r * 0.2); x.lineCap = "round";
    x.beginPath(); x.moveTo(0, -r * 0.72); x.lineTo(0, -r * 1.08); x.stroke();
    x.fillStyle = leaf;
    x.beginPath(); x.ellipse(-r * 0.44, -r * 0.86, r * 0.42, r * 0.19, -0.45, 0, TAU); x.fill();
    x.beginPath(); x.ellipse(r * 0.44, -r * 0.86, r * 0.42, r * 0.19, 0.45, 0, TAU); x.fill();
  }
  /** 果实绘制入口(ui.js drawWorld 的掉落循环对 d.kind==="fruit" 调它)。 */
  PS.Art.drawFruit = function (ctx, d, time) {
    var r = (d && d.r) || 7, t2 = time || 0;
    var bob = Math.sin(t2 * 3 + (d.x || 0) * 0.02) * r * 0.18;
    glowAt(ctx, rgba("#ff9a6a", 0.30), Math.ceil(r * 1.8), d.x, d.y);
    var sp = fruitSpriteSpec(r);
    drawSprite(ctx, "t:fruit:" + r, sp.w, sp.h,
      function (cc) { paintFruit(cc, r); }, d.x, d.y + bob, {
        fallback: function (cc) { cc.save(); cc.translate(d.x, d.y + bob); paintFruit(cc, r); cc.restore(); }
      });
  };

  /** 地雷的静态件: 铁饼 + 三颗压发柱(源 spawn_cooldown = 12 秒) */
  function paintMine(x, r) {
    var i2;
    x.fillStyle = INK;
    x.beginPath(); x.arc(0, 0, r * 0.92, 0, TAU); x.fill();
    x.fillStyle = palette.iron;
    x.beginPath(); x.arc(0, 0, r * 0.76, 0, TAU); x.fill();
    x.fillStyle = shade(palette.iron, -0.34);
    for (i2 = 0; i2 < 3; i2++) {
      var ma = i2 / 3 * TAU - Math.PI / 2;
      x.beginPath(); x.arc(Math.cos(ma) * r * 0.44, Math.sin(ma) * r * 0.44, r * 0.17, 0, TAU); x.fill();
    }
  }

  /** 地雷: 静态件烘精灵, 压发指示灯每帧画(布设中慢闪金 / 待发快闪红)。 */
  PS.Art.drawMine = function (ctx, m, time) {
    var x = m.x, y = m.y, r = m.r || 10, t2 = time || 0;
    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    ctx.beginPath(); ctx.ellipse(x, y + r * 0.6, r * 1.0, r * 0.36, 0, 0, TAU); ctx.fill();
    var sp = structSpriteSpec('landmines', r);
    drawSprite(ctx, 's:landmines:' + r, sp.w, sp.h,
      function (cc) { paintMine(cc, r); }, x, y, {
        fallback: function (cc) { cc.save(); cc.translate(x, y); paintMine(cc, r); cc.restore(); }
      });
    var arming = (m.armed || 0) > 0;
    var bl = arming ? (0.34 + 0.28 * Math.sin(t2 * 6)) : (0.4 + 0.55 * Math.abs(Math.sin(t2 * 4)));
    ctx.fillStyle = rgba(arming ? palette.goldLite : palette.alert, bl);
    ctx.beginPath(); ctx.arc(x, y - r * 0.08, r * 0.25, 0, TAU); ctx.fill();
  };
  /* ==================== 可玩角色: 菜园抵抗军(8 种蔬菜) ====================
   * 数据表 src/data/characters.js 为准(id → 蔬菜), 主色一律取 ch.color, 本模块不硬编码配色。
   * 8 种剪影各有"决定性配件", 缩到 24px 也能秒认:
   *   popo 小番茄   圆球 + 5 片星形萼蒂 + 短柄 + 两片叶臂
   *   brick 甜菜根  上宽下尖的陀螺身 + 尾根 + 3 片红叶脉叶
   *   wren 玉米     竖棒 + 粒纹网格 + 两侧外翻叶鞘 + 顶部金色穗须
   *   comfrey 芦荟  放射状厚肉尖叶莲座(带锯齿) + 中央肉质体
   *   mandrake 大蒜 球茎 + 5 道蒜瓣分缝 + 干茎顶芽 + 底部根须
   *   nightshade 茄子 长卵形弯果 + 5 片绿萼帽 + 弯柄带叶
   *   pumpkin 南瓜  8 瓣瓜棱 + 顶蒂 + 卷须 + 一片大叶
   *   clover 四叶草 四枚心形小叶 + 茎 + 小白花
   * 家族统一标识(与怪物区分, R1.4): 金色外发光描边 + 眉毛/大眼/腮红/微笑 + 战斗内脚下光环。
   * 缓存: PS.Sprites, key='c:<id>:<pose>:<r>:<色值>', pose∈{0 静止, 1/2 摆动}; 每帧 1 次 drawImage。
   * 动画不占缓存槽: 呼吸=均匀缩放脉冲, 移动=rot 倾斜 + y 弹跳(全走 PS.Sprites.draw 参数)。
   */
  var LEAF = '#4e7a2a', LEAF_DK = '#2f4a1e';
  var VU = 16;                                   // 角色绘制单位(所有 veg 画法都以此为单位)

  /** R1.4 玩家家族标识: 给**当前路径**外罩一圈 4.4px #ffd24a 金色外发光。
   *  只允许可玩角色使用 —— 任何怪物不得出现这条描边(R1.4)。
   *  调用点: volume(..., { glow: true })(6 个 veg 主质量) + 芦荟核心 + 四叶草叶片。
   *  修前这个函数叫 vegSkin() 且**零调用点**(死代码) ⇒ 回退路径上没有金发光, 只剩 ink 描边。 */
  function charGlow(x) {
    x.strokeStyle = rgba('#ffd24a', 0.85); x.lineWidth = 4.4; x.lineJoin = 'round'; x.stroke();
  }
  /** 共用五官: 眉毛 + 大眼 + 腮红 + 微笑(角色家族表情标识) */
  function vegFace(x) {
    var i, a;
    x.lineCap = 'round';
    x.strokeStyle = '#5a3a16'; x.lineWidth = 2.1;
    for (i = 0; i < 2; i++) {
      a = i ? 1 : -1;
      x.beginPath(); x.moveTo(a * 2.8, -10.2); x.lineTo(a * 9.8, -11.4); x.stroke();
    }
    for (i = 0; i < 2; i++) {
      a = i ? 1 : -1;
      circlePath(x, a * 6.3, -4.0, 4.6); fillC(x, '#fdfdf4'); strokeC(x, INK, 1.5);
      circlePath(x, a * 6.6, -3.8, 2.3); fillC(x, '#5a3a16');
      circlePath(x, a * 6.6 - 1, -4.9, 0.95); fillC(x, '#ffffff');
    }
    circlePath(x, -11.4, 4.6, 2.7); fillC(x, 'rgba(224,122,90,0.45)');
    circlePath(x, 11.4, 4.6, 2.7); fillC(x, 'rgba(224,122,90,0.45)');
    x.beginPath(); x.moveTo(-3.4, 4.6); x.quadraticCurveTo(0, 9.4, 3.4, 4.6);
    x.strokeStyle = '#5a3416'; x.lineWidth = 2.1; x.stroke();
  }
  /** 摆动帧符号: 0 静止 / +1 / -1 —— 让配件(叶/须/芽)随走路轻摆 */
  function swayOf(pose) { return pose === 1 ? 1 : (pose === 2 ? -1 : 0); }
  /** 角色的"腿/根足": 左右两只, 随 pose 前后错开(走路摆幅的第一读点) */
  function vegFeet(x, col, pose, y, sp, rr) {
    var s = swayOf(pose), i;
    for (i = 0; i < 2; i++) {
      var sg = i ? 1 : -1;
      ellPath(x, sg * sp * (1 + (i ? s : -s) * 0.14), y + (i ? -s : s) * 1.6, rr, rr * 0.66, 0);
      fillC(x, col); strokeC(x, INK, 1.5);
    }
  }

  /* --- 小番茄: 圆球 + 浅沟 + 星形萼蒂 + 两片叶臂 --- */
  function vegTomato(x, C, pose) {
    var s = swayOf(pose), i, a;
    for (i = 0; i < 2; i++) {
      var sg = i ? 1 : -1;
      leafBlade(x, sg * 7.5, 2.5, sg > 0 ? -0.42 + s * 0.3 : -2.72 - s * 0.3, 9.5, 4, '#5f8a34', sg * 0.45);
    }
    vegFeet(x, '#5f8a34', pose, 14.4, 5.2, 3.4);
    volume(x, 11, function () { blobPath(x, 0, 1.4, 10.6, 0.05, 3); }, C, { lw: 2.3, gr: 0.3, glow: true });
    x.strokeStyle = rgba(shade(C, -0.5), 0.34); x.lineWidth = 1.6; x.lineCap = 'round';
    for (i = -1; i <= 1; i++) {
      x.beginPath();
      x.moveTo(i * 3.6, -7.6); x.quadraticCurveTo(i * 5.4, 1.5, i * 3.1, 11.4);
      x.stroke();
    }
    for (i = 0; i < 5; i++) {                       /* 星形萼蒂 */
      a = -Math.PI * 0.92 + i / 4 * Math.PI * 0.84;
      leafBlade(x, Math.cos(a) * 2, -8 + Math.sin(a) * 1.6, a, 6.6 + (i % 2) * 1.2, 3.1, '#6fbf46', 0.35);
    }
    limb(x, 0, -10.4, 1.6 + s, -15.4, 0.6, '#5f8a34', 2.2);
  }
  /* --- 甜菜根: 陀螺身(上宽下尖) + 尾根 + 3 片红叶脉叶 --- */
  function vegBeet(x, C, pose) {
    var s = swayOf(pose), i, a;
    for (i = 0; i < 3; i++) {                       /* 叶丛 */
      a = -Math.PI * 0.78 + i / 2 * Math.PI * 0.56;
      x.beginPath();
      x.moveTo(Math.cos(a) * 2, -5);
      x.quadraticCurveTo(Math.cos(a) * 7, -13, Math.cos(a) * (10.5 + i * 0.6) + s * 1.2, -18.5 + Math.abs(i - 1) * 1.6);
      x.strokeStyle = INK; x.lineWidth = 3.2; x.lineCap = 'round'; x.stroke();
      x.strokeStyle = '#8a2a52'; x.lineWidth = 2; x.stroke();
      leafBlade(x, Math.cos(a) * 7.5, -11, a - (i ? -0.5 : 0.5), 8.4, 4.6, '#6a2a48', 0.4);
    }
    limb(x, 0, 11, 1 + s * 0.6, 19, 0.4, '#8a2a52', 2.6);   /* 尾根 */
    volume(x, 11.4, function () {
      x.beginPath();
      x.moveTo(-10.4, -4.5);
      x.quadraticCurveTo(-11.6, 3.5, 0, 12.6);
      x.quadraticCurveTo(11.6, 3.5, 10.4, -4.5);
      x.quadraticCurveTo(0, -9.4, -10.4, -4.5);
      x.closePath();
    }, C, { lw: 2.3, gr: 0.28, glow: true });
    for (i = 0; i < 3; i++) {                       /* 同心环纹 */
      ellPath(x, 0, 1 + i * 3.4, 8.4 - i * 2.2, 2.2, 0);
      strokeC(x, rgba(shade(C, -0.44)), 0.5);
    }
    for (i = 0; i < 4; i++) {                       /* 侧须根 */
      var sg = i < 2 ? -1 : 1;
      limb(x, sg * 9.6, 1 + (i % 2) * 4, sg * 13.4, 6 + (i % 2) * 3.4, sg * 1.4, '#8a2a52', 1.5);
    }
  }
  /* --- 玉米: 竖棒 + 粒纹网格 + 外翻叶鞘 + 金色穗须 --- */
  function vegCorn(x, C, pose) {
    var s = swayOf(pose), i, j;
    for (i = 0; i < 2; i++) {                       /* 外翻叶鞘(在体后) */
      var sg = i ? 1 : -1;
      leafBlade(x, sg * 4.5, 4, sg > 0 ? 0.32 + s * 0.16 : Math.PI - 0.32 - s * 0.16, 15, 5.6, '#4e7a2a', sg * 0.5);
    }
    vegFeet(x, '#4e7a2a', pose, 14.6, 4.6, 3.2);
    volume(x, 11.4, function () {
      x.beginPath();
      x.moveTo(-7.8, -10.6);
      x.quadraticCurveTo(-8.8, 2, -5.4, 11.6);
      x.quadraticCurveTo(0, 14.2, 5.4, 11.6);
      x.quadraticCurveTo(8.8, 2, 7.8, -10.6);
      x.quadraticCurveTo(0, -13.4, -7.8, -10.6);
      x.closePath();
    }, C, { lw: 2.3, gr: 0.26, glow: true });
    for (i = -2; i <= 2; i++) {                     /* 粒纹网格 */
      x.beginPath();
      x.moveTo(i * 3.1, -9); x.lineTo(i * 3.1, 11.6);
      x.strokeStyle = rgba(shade(C, -0.44), 0.5); x.lineWidth = 1.3; x.stroke();
    }
    for (j = 0; j < 7; j++) {
      x.beginPath();
      x.moveTo(-6.4 + Math.abs(j - 3) * 0.5, -6.6 + j * 2.7);
      x.lineTo(6.4 - Math.abs(j - 3) * 0.5, -6.6 + j * 2.7);
      x.strokeStyle = rgba(shade(C, -0.44), 0.34); x.lineWidth = 1.1; x.stroke();
      for (i = -2; i <= 2; i++) {
        circlePath(x, i * 3.1, -6.6 + j * 2.7, 1.5);
        fillC(x, rgba(shade(C, 0.42), 0.22));
      }
    }
    for (i = 0; i < 5; i++) {                       /* 金色穗须 */
      var a2 = -Math.PI * 0.74 + i / 4 * Math.PI * 0.48;
      x.beginPath();
      x.moveTo(0, -12.6);
      x.quadraticCurveTo(Math.cos(a2) * 5, -19, Math.cos(a2) * (8 + (i % 2) * 2) + s * 1.4, -22.5);
      x.strokeStyle = INK; x.lineWidth = 3; x.lineCap = 'round'; x.stroke();
      x.strokeStyle = '#e8c05a'; x.lineWidth = 1.8; x.stroke();
    }
  }
  /* --- 芦荟: 放射厚肉尖叶莲座(带锯齿) + 中央肉质体 --- */
  function vegAloe(x, C, pose) {
    var s = swayOf(pose), i, a;
    for (i = 0; i < 8; i++) {
      a = -Math.PI * 0.96 + i / 7 * Math.PI * 0.92;
      var len = 13 + (i % 2) * 3;
      leafBlade(x, Math.cos(a) * 2.6, 1.6 + Math.sin(a) * 2, a + s * 0.05 * (i % 2 ? 1 : -1), len, 4.4,
        i % 3 === 1 ? shade(C, 0.16) : C, 0.24);
      var k, tx = Math.cos(a) * len * 0.86, ty = 1.6 + Math.sin(a) * len * 0.86;
      for (k = 0; k < 3; k++) {                     /* 叶缘小齿 */
        var t = 0.45 + k * 0.2;
        x.beginPath();
        x.moveTo(Math.cos(a) * len * t, 1.6 + Math.sin(a) * len * t);
        x.lineTo(Math.cos(a + 0.16) * len * (t + 0.1), 1.6 + Math.sin(a + 0.16) * len * (t + 0.1));
        x.strokeStyle = rgba(shade(C, -0.4), 0.6); x.lineWidth = 1; x.stroke();
      }
      ellPath(x, tx, ty, 1, 1, 0); fillC(x, rgba('#ffffff', 0.5));
    }
    ellPath(x, 0, 1, 7.4, 8.2, 0);
    var g = x.createRadialGradient(-2.4, -2.4, 1, 0, 1, 9);
    g.addColorStop(0, rgba(shade(C, 0.5), 0.95)); g.addColorStop(1, rgba(shade(C, -0.4), 0.85));
    x.fillStyle = g; x.fill();
    ellPath(x, 0, 1, 7.4, 8.2, 0); charGlow(x); strokeC(x, inkOf(), 2.2);
    for (i = 0; i < 4; i++) {                       /* 叶面白斑 */
      ellPath(x, -4 + (i % 2) * 8, -3 + ((i / 2) | 0) * 6, 1.6, 1, 0);
      fillC(x, rgba('#ffffff', 0.32));
    }
    vegFeet(x, '#2f6a54', pose, 12.6, 5, 3.2);
  }
  /* --- 大蒜: 球茎 + 蒜瓣分缝 + 干茎顶芽 + 底部根须 --- */
  function vegGarlic(x, C, pose) {
    var s = swayOf(pose), i, a;
    for (i = 0; i < 3; i++) {                       /* 顶芽 */
      a = -Math.PI * 0.72 + i * Math.PI * 0.22;
      x.beginPath();
      x.moveTo(0, -11.6);
      x.quadraticCurveTo(Math.cos(a) * 5, -18, Math.cos(a) * (7 + i) + s * 1.2, -22.4);
      x.strokeStyle = INK; x.lineWidth = 2.8; x.lineCap = 'round'; x.stroke();
      x.strokeStyle = i === 1 ? '#6fbf46' : '#4e7a2a'; x.lineWidth = 1.8; x.stroke();
    }
    limb(x, 0, -8, 0, -13.4, 0, '#c8b894', 3);      /* 干茎 */
    roots(x, 0, 11, 5, 6.4, 2.2, '#c8b894', 1.5);
    volume(x, 11.4, function () {
      x.beginPath();
      x.moveTo(-9.8, -8.4);
      x.quadraticCurveTo(-12.4, 2, -5.4, 11.4);
      x.quadraticCurveTo(0, 13.6, 5.4, 11.4);
      x.quadraticCurveTo(12.4, 2, 9.8, -8.4);
      x.quadraticCurveTo(0, -12.4, -9.8, -8.4);
      x.closePath();
    }, C, { lw: 2.3, gr: 0.24, glow: true });
    for (i = -2; i <= 2; i++) {                     /* 蒜瓣分缝 */
      x.beginPath();
      x.moveTo(0, -10.6);
      x.quadraticCurveTo(i * 4.6, 0, i * 3.4, 12.2);
      x.strokeStyle = rgba(shade(C, -0.4), 0.7); x.lineWidth = 1.5; x.stroke();
    }
    for (i = 0; i < 5; i++) {                       /* 纸皮纹 */
      var t = -7.6 + i * 4;
      x.beginPath();
      x.moveTo(-8, t); x.quadraticCurveTo(0, t + 2.6, 8, t);
      x.strokeStyle = rgba('#ffffff', 0.24); x.lineWidth = 1.2; x.stroke();
    }
  }
  /* --- 茄子: 长卵形弯果 + 绿萼帽 + 弯柄带叶 --- */
  function vegEggplant(x, C, pose) {
    var s = swayOf(pose), i, a;
    leafBlade(x, 1.6, -10.4, -0.9 + s * 0.16, 10.4, 4.4, '#5f8a34', 0.5);
    limb(x, -1.4, -12.2, -4.4 + s, -17.4, -0.6, '#5f8a34', 2.4);   /* 弯柄 */
    vegFeet(x, '#4e7a2a', pose, 15.4, 4.4, 3);
    volume(x, 12, function () {
      x.beginPath();
      x.moveTo(-3.4, -9.4);
      x.quadraticCurveTo(-11.6, -4, -10.6, 5.4);
      x.quadraticCurveTo(-9.4, 14.4, 0.6, 14.6);
      x.quadraticCurveTo(10.4, 14.4, 10.6, 5);
      x.quadraticCurveTo(10.8, -4.6, 3.4, -9.4);
      x.quadraticCurveTo(0, -11.4, -3.4, -9.4);
      x.closePath();
    }, C, { lw: 2.3, gr: 0.34, glow: true });
    for (i = 0; i < 3; i++) {                       /* 果皮高光条 */
      x.beginPath();
      x.moveTo(-6.4 + i * 2.2, -6.4 + i);
      x.quadraticCurveTo(-9 + i * 2.2, 2, -6 + i * 2.2, 11 - i);
      x.strokeStyle = rgba('#ffffff', 0.22 - i * 0.05); x.lineWidth = 1.6; x.stroke();
    }
    for (i = 0; i < 5; i++) {                       /* 绿萼帽 */
      a = -Math.PI * 0.94 + i / 4 * Math.PI * 0.88;
      leafBlade(x, Math.cos(a) * 1.6, -9.4 + Math.sin(a) * 1.4, a + Math.PI * 0.5 * (a > -Math.PI / 2 ? 1 : -1) * 0 + (a > -Math.PI / 2 ? 0.5 : -0.5),
        6.4, 3.2, '#5f8a34', 0.3);
    }
  }
  /* --- 南瓜: 8 瓣瓜棱 + 顶蒂 + 卷须 + 大叶 --- */
  function vegPumpkin(x, C, pose) {
    var s = swayOf(pose), i;
    leafBlade(x, -6.4, -1.6, -2.5 - s * 0.16, 13, 6.4, '#4e7a2a', 0.5);
    vegFeet(x, '#4e7a2a', pose, 13.6, 5.4, 3.4);
    volume(x, 12, function () {
      x.beginPath();
      x.moveTo(-11.6, 2.4);
      x.quadraticCurveTo(-11.4, -8.4, 0, -8.8);
      x.quadraticCurveTo(11.4, -8.4, 11.6, 2.4);
      x.quadraticCurveTo(11.2, 12.4, 0, 12.6);
      x.quadraticCurveTo(-11.2, 12.4, -11.6, 2.4);
      x.closePath();
    }, C, { lw: 2.3, gr: 0.3, glow: true });
    for (i = -3; i <= 3; i++) {                     /* 瓜棱 */
      x.beginPath();
      x.moveTo(i * 3.1, -8.4);
      x.quadraticCurveTo(i * 5.2, 2, i * 3.1, 12.2);
      x.strokeStyle = rgba(shade(C, -0.5), 0.55); x.lineWidth = 1.5; x.stroke();
      x.beginPath();
      x.moveTo(i * 3.1 + 1, -8.2);
      x.quadraticCurveTo(i * 5.2 + 1.4, 2, i * 3.1 + 1, 11.8);
      x.strokeStyle = rgba(shade(C, 0.4), 0.28); x.lineWidth = 1.1; x.stroke();
    }
    limb(x, 0, -8.6, 1.4, -13.4, 0.4, '#6a5a2a', 2.6);            /* 蒂 */
    x.beginPath();                                                 /* 卷须 */
    x.moveTo(2.6, -11.4);
    x.quadraticCurveTo(8, -16, 4.4, -19.4);
    x.quadraticCurveTo(1.4, -21.4, 5.4, -22.4 + s);
    x.strokeStyle = INK; x.lineWidth = 2.6; x.lineCap = 'round'; x.stroke();
    x.strokeStyle = '#8aa03a'; x.lineWidth = 1.6; x.stroke();
  }
  /* --- 四叶草: 四枚心形小叶 + 茎 + 小白花 --- */
  function vegClover(x, C, pose) {
    var s = swayOf(pose), i, a;
    for (i = 0; i < 4; i++) {                       /* 心形小叶 */
      a = -Math.PI * 0.75 + i * Math.PI * 0.5;
      x.save();
      x.translate(Math.cos(a) * 5.6, Math.sin(a) * 5.6 - 3.4 + s * 0.5);
      x.rotate(a + Math.PI * 0.5);
      x.beginPath();
      x.moveTo(0, 3.4);
      x.bezierCurveTo(-3.4, 3.6, -6.4, 1.4, -6.4, -1.6);
      x.bezierCurveTo(-6.4, -4, -4, -5.6, -1.8, -4.2);
      x.quadraticCurveTo(0, -2.6, 1.8, -4.2);
      x.bezierCurveTo(4, -5.6, 6.4, -4, 6.4, -1.6);
      x.bezierCurveTo(6.4, 1.4, 3.4, 3.6, 0, 3.4);
      x.closePath();
      var g = x.createLinearGradient(-4, -4, 4, 4);
      g.addColorStop(0, shade(C, 0.4)); g.addColorStop(0.5, C); g.addColorStop(1, shade(C, -0.4));
      x.fillStyle = g; x.fill();
      charGlow(x);
      x.strokeStyle = INK; x.lineWidth = 1.9; x.lineJoin = 'round'; x.stroke();
      x.beginPath(); x.moveTo(0, 3); x.lineTo(0, -3.4);
      x.strokeStyle = rgba(shade(C, -0.5), 0.5); x.lineWidth = 1.1; x.stroke();
      x.restore();
    }
    limb(x, 0, 3.4, -1 + s, 12.4, 0.4, '#5f8a34', 2.4);   /* 茎 */
    vegFeet(x, '#4e7a2a', pose, 15, 4.4, 3);
    circlePath(x, 7.6, 3.4 + s * 0.5, 2.2);                        /* 小白花 */
    fillC(x, '#f6f2e2'); strokeC(x, INK, 1.2);
    for (i = 0; i < 4; i++) {
      circlePath(x, 7.6 + Math.cos(i * 1.57) * 1.5, 3.4 + s * 0.5 + Math.sin(i * 1.57) * 1.5, 0.9);
      fillC(x, '#ffffff');
    }
  }
  var VEG = {
    popo: { veg: '小番茄', top: 26, bot: 20, halfW: 16, fn: vegTomato },
    brick: { veg: '甜菜根', top: 28, bot: 22, halfW: 15, fn: vegBeet },
    wren: { veg: '玉米', top: 26, bot: 20, halfW: 18, fn: vegCorn },
    comfrey: { veg: '芦荟', top: 24, bot: 18, halfW: 20, fn: vegAloe },
    mandrake: { veg: '大蒜', top: 26, bot: 20, halfW: 17, fn: vegGarlic },
    nightshade: { veg: '茄子', top: 24, bot: 20, halfW: 16, fn: vegEggplant },
    pumpkin: { veg: '南瓜', top: 26, bot: 18, halfW: 18, fn: vegPumpkin },
    clover: { veg: '四叶草', top: 18, bot: 20, halfW: 15, fn: vegClover }
  };
  var VEG_DEF = { veg: '小番茄', top: 26, bot: 20, halfW: 16, fn: vegTomato };
  function vegOf(id) { return VEG[id] || VEG_DEF; }
  function charSpec(id, r) {
    var v = vegOf(id), s = (r || 16) / 16, hh = Math.max(v.top, v.bot) + 6;
    return { w: Math.ceil((v.halfW + 5) * 2 * s), h: Math.ceil(hh * 2 * s) };
  }
  function paintChar(x, id, C, pose, r) {
    var v = vegOf(id), s = (r || 16) / 16;
    x.save(); x.scale(s, s);
    v.fn(x, C, pose);
    vegFace(x);
    x.restore();
  }
  function colorOfId(id) {
    var L = (global.PS && global.PS.Characters && global.PS.Characters.list) || null, i;
    if (L) for (i = 0; i < L.length; i++) if (L[i].id === id) return L[i].color;
    return palette.gold;
  }
  function nowSec() {
    var perf = global.performance;
    return ((perf && perf.now) ? perf.now() : Date.now()) / 1000;
  }
  /** 解析当前角色: 显式参数 > 激活角色(HUD 头像自动学习 / PS.Art.activeChar 注入) > 默认首位 */
  function charOf(p, stats) {
    var c = (stats && (stats.char || stats.charDef)) || (p && (p.char || p.charDef)) ||
      (p && p.charId ? { id: p.charId } : null) || (stats && stats.charId ? { id: stats.charId } : null) ||
      PS.Art.activeChar;
    if (!c && p && p.charKey) c = { id: p.charKey };
    if (!c || !c.id) c = { id: 'popo' };
    if (!c.color) c = { id: c.id, color: colorOfId(c.id) };
    return c;
  }
  /** 角色精灵槽 key —— 只由离散状态组成(id/姿势/半径/色值), 禁止把 time 拼进来(R6.3) */
  function charKey(id, C, pose, r) { return 'c:' + id + ':' + C + ':' + pose + ':' + r; }

  /** 战斗内角色: 1 次影子椭圆 + 1 次光环描边 + 1 次 drawImage(蔬菜精灵 + 呼吸/倾斜/弹跳) */
  PS.Art.drawPlayer = function (ctx, p, stats, time) {
    if (!ctx || !p) return;
    var r = p.r || (stats && stats.r) || 16;
    var t = time || 0;
    var moving = !!p.moving;
    var walk = p.walkT || 0;
    var ch = charOf(p, stats);
    var id = ch.id, C = ch.color || palette.gold;
    var pose = moving ? (1 + (((walk / 2.1) | 0) & 1)) : 0;
    var bob = moving ? Math.abs(Math.sin(walk)) * 3 : Math.sin(t * 2.4) * 1.4;
    var tilt = moving ? Math.sin(walk) * 0.085 : Math.sin(t * 1.7) * 0.022;
    var breathe = moving ? 1 : 1 + Math.sin(t * 2.4) * 0.035;
    var px = p.x, py = p.y;
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath(); ctx.ellipse(px, py + r * 0.86, r * 0.94, r * 0.34, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgba(palette.goldLite, 0.42); ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.ellipse(px, py + r * 0.9, r * 1.24, r * 0.44, 0, 0, TAU); ctx.stroke();
    var sp = charSpec(id, r);
    drawSprite(ctx, charKey(id, C, pose, r), sp.w, sp.h,
      function (cc, xx) { paintChar(xx, id, C, pose, r); },
      px, py - bob, {
        rot: tilt, scale: breathe,
        fallback: function (cc) {
          cc.save(); cc.translate(px, py - bob); cc.rotate(tilt);
          paintChar(cc, id, C, pose, r); cc.restore();
        }
      });
  };

  /** 立绘/头像(ui.js 选人卡与 HUD 圆框共用): px,py 为中心, 与旧接口同签名 */
  PS.Art.drawCharModel = function (ctx, ch, px, py, scale, opts) {
    if (!ctx || !ch) return;
    var o = opts || {};
    var id = ch.id || 'popo';
    var C = ch.color || colorOfId(id);
    var t = nowSec() + h2(id.length, (id.charCodeAt(0) || 65) * 0.37) * TAU;   // 按角色错开相位
    var moving = !!o.moving;
    var walk = o.walk || 0;
    var pose = moving ? (1 + (((walk / 2.1) | 0) & 1)) : 0;
    var sc = scale || 1;
    var breathe = (moving || PS.Art.charIdleAnim === false) ? 1 : 1 + Math.sin(t * 2.4) * 0.03;
    var bob = moving ? Math.abs(Math.sin(walk)) * 3 : Math.sin(t * 2.4) * 1.3 * (PS.Art.charIdleAnim === false ? 0 : 1);
    var sp = charSpec(id, 16);
    drawSprite(ctx, charKey(id, C, pose, 16), sp.w, sp.h,
      function (cc, xx) { paintChar(xx, id, C, pose, 16); },
      px, py - bob * sc, {
        scale: sc * breathe,
        fallback: function (cc) {
          cc.save(); cc.translate(px, py - bob * sc); cc.scale(sc * breathe, sc * breathe);
          paintChar(cc, id, C, pose, 16); cc.restore();
        }
      });
  };

  /* ---- 接线: 让 ui.js 的立绘/HUD 头像走本模块(不改 ui.js 源码) ----
   *  ui.js 的三个角色绘制入口:
   *    选人卡立绘    drawCharModel(chd, 0, 0, 1, {...})
   *    HUD 圆框头像  drawCharModel(g.char, 34, 40, 0.72, {...})  ← 同时学习"当前角色"
   *    战斗内兜底    drawCharModel(...)  (PS.Art.drawPlayer 存在时不会走到)
   *  学习到的角色给 drawPlayer 用: ui.js 的 player 对象不带角色字段, 而 HUD 头像每帧
   *  都在 drawHUD 内画一次 g.char, 因此包一层 drawHUD 就能不读 PS.Game 拿到当前角色。 */
  var inHud = false, installTries = 0;
  PS.Art.activeChar = null;
  PS.Art.installCharModels = function () {
    var UI = PS.UI, w, wh, origHud;
    if (!UI || typeof UI.drawCharModel !== 'function') return false;
    if (UI.drawCharModel.__veg) return true;
    if (typeof UI.drawHUD === 'function' && !UI.drawHUD.__veg) {
      origHud = UI.drawHUD;
      wh = function () {
        inHud = true;
        try { return origHud.apply(this, arguments); } finally { inHud = false; }
      };
      wh.__veg = true; wh.__orig = origHud;
      UI.drawHUD = wh;
    }
    var orig = UI.drawCharModel;
    w = function (ch, px, py, scale, opts) {
      if (ch) {
        if (inHud || (px === 34 && py === 40) || Math.abs((scale || 1) - 0.72) < 1e-6) PS.Art.activeChar = ch;
        if (PS.Art.useCharModel !== false) {
          PS.Art.drawCharModel(this.ctx || UI.ctx, ch, px, py, scale, opts);
          return;
        }
      }
      return orig.apply(this, arguments);
    };
    w.__veg = true; w.__orig = orig;
    UI.drawCharModel = w;
    PS.Art.charModelsInstalled = true;
    return true;
  };
  /** 还原 ui.js 原建模(排障用) */
  PS.Art.uninstallCharModels = function () {
    var UI = PS.UI;
    if (UI && UI.drawCharModel && UI.drawCharModel.__veg) UI.drawCharModel = UI.drawCharModel.__orig;
    if (UI && UI.drawHUD && UI.drawHUD.__veg) UI.drawHUD = UI.drawHUD.__orig;
    PS.Art.charModelsInstalled = false;
  };
  PS.Art.charModelsInstalled = false;
  function tryInstallCharModels() {
    if (PS.Art.installCharModels()) return;
    if (++installTries < 250 && typeof global.setTimeout === 'function') global.setTimeout(tryInstallCharModels, 20);
  }
  PS.Art.charIdleAnim = true;    // 立绘/HUD 头像的呼吸微动开关(置 false = 完全静止)
  PS.Art.VEG = VEG;
  PS.Art.vegName = function (id) { return vegOf(id).veg; };
  PS.Art.charKeys = VEG;
  /* ============================ 武器建模 ============================
   * v3.9 重构。触发它的**事实**(实测, 不是猜测):
   *   ① 旧实现在 ui.js:818 weaponIcon 里按 def.family 分 8 支画矢量线条, 而 family 是武器的
   *      **身份族名**(源武器表 61 个: sword / chopper / pruner / circular_saw / chain_gun …),
   *      与那 8 个分支(piercer / boomer / spread / swift / hammer / blade / orbiter / laser)
   *      **毫不相交** —— 实测 203 把武器里只有 3 把碰巧命中, 其余 200 把一律画成空白;
   *      唯一真能画出东西的反而是"def 查不到"的兜底分支。这就是「建模不见了」的根因。
   *   ② 战斗里更彻底: PS.Art.drawWeapons 全工程**无调用点**, 玩家一直是空手。
   * 因此本文件把"武器长什么样"收敛成**单一真源**:
   *   形状分类由**数据推导**(def.targeting + 61 个 family → 13 个形状类), 模型只在这里做一次;
   *   界面(PS.Art.drawWeaponIcon)与战斗(PS.Art.drawWeaponRing)**共用同一批模型**。
   *   于是"某把武器有没有模型"不再取决于哪个调用点写没写, 而只取决于它有没有数据 ——
   *   这类"静默消失"的缺陷从结构上不可能再发生。
   *
   * 坐标纪律: 握把在原点, 刃/枪管沿 +x 伸出 ⇒ 落图时 rot 直接就是瞄准角。
   *   图框必须左右对称包住模型(max(|xa|,xb)), 否则旋转时握把会飘离手心。
   * 画布纪律: key = 'w3:' + 武器key + ':' + 阶 —— **摆动/后坐/挥击/瞄准全部走 draw 期的
   *   rot 与位移, 绝不进 key**(否则槽位会被帧数撑爆; 缓存抖动 = 重新烘焙 = 掉帧)。
   */
  /* 61 个身份族 → 13 个形状类。只按"长什么样"分, 不按数值分。 */
  /* 61 个身份族 -> 22 个形状类。v53 去同质化(用户反馈「武器长得都太像了」):
   * 原先把 61 族压进 13 个形状, 于是这些**不同族**在屏幕上是同一个模型(同形状 + 同变体号):
   *   mace v0 = 练手棍 / 决斗棍 / 旧木板      blade v0 = 阔剑 / 王剑 / 锯齿剑 / 雷刃
   *   blade v1 = 尖牙匕 / 匕首 / 锐齿         mace v4 = 拳套 / 布手 / 重拳 / 火指虎
   *   machete v0 = 菜刀 / 修枝刀   spear v0 = 长矛 / 骑枪   pistol v0 = 短铳 / 左轮
   *   shotgun v0 = 双管豆铳 / 连珠荚          launcher v0 = 火箭 / 投薯机 ...
   * 现在拆到 22 形状, 且每族独占一个变体号 -> 任取两个不同族, 轮廓或特征件至少差一处。
   * 只按「长什么样」分, 不按数值分。 */
  var WSHAPE = {
    sword: 'blade', excalibur: 'blade', vorpal_sword: 'blade', thunder_sword: 'blade',
    knife: 'blade', dagger: 'blade',
    sharp_tooth: 'fang',
    chopper: 'machete', pruner: 'machete', scythe: 'machete', scissors: 'machete',
    hatchet: 'axe', ghost_axe: 'axe',
    hammer: 'hammer', plasma_sledgehammer: 'hammer', wrench: 'hammer', dextroyer: 'hammer',
    stick: 'mace', cactus_mace: 'mace', rock: 'mace', torch: 'mace', spiky_shield: 'mace',
    fighting_stick: 'club', plank: 'board', ghost_flint: 'torch',
    fist: 'fist', hand: 'fist', power_fist: 'fist', flaming_knuckles: 'fist',
    spear: 'spear', jousting_lance: 'spear', screwdriver: 'spear', claw: 'spear', lightning_shiv: 'spear',
    pistol: 'pistol', revolver: 'pistol', smg: 'pistol', taser: 'pistol', medical_gun: 'pistol',
    sniper_gun: 'rifle', shredder: 'rifle', crossbow: 'rifle', laser_gun: 'rifle',
    double_barrel_shotgun: 'shotgun', gatling_laser: 'shotgun', obliterator: 'shotgun',
    chain_gun: 'chain', minigun: 'minigun', particle_accelerator: 'coilgun',
    rocket_launcher: 'launcher', nuclear_launcher: 'launcher', fireball: 'launcher', potato_thrower: 'thrower',
    flamethrower: 'flamer', icicle: 'flamer', ghost_scepter: 'flamer',
    wand: 'wand', slingshot: 'wand', shuriken: 'wand',
    circular_saw: 'saw', drill: 'saw'
  };
  PS.Art.WSHAPE_LIST = ['blade', 'fang', 'machete', 'axe', 'hammer', 'mace', 'club', 'board',
    'torch', 'fist', 'spear', 'pistol', 'rifle', 'shotgun', 'chain', 'minigun', 'coilgun',
    'launcher', 'thrower', 'flamer', 'wand', 'saw'];

  /* 元素配色(源武器表的 elem 是布尔标记, 没有色号 ⇒ 按族给色)。
   * 目的: 火/冰/雷/幽灵/等离子/核 六种元素在**模型本体**上就分得出来。 */
  var WN_ECOL = {
    flaming_knuckles: '#ff8a3c', torch: '#ff9a3c', fireball: '#ff7a3c', flamethrower: '#ffa040',
    ghost_axe: '#9de0c0', ghost_flint: '#9de0c0', ghost_scepter: '#9de0c0',
    icicle: '#7fd8ff', lightning_shiv: '#ffe14a', thunder_sword: '#ffe14a', taser: '#ffe14a',
    plasma_sledgehammer: '#b98cff', particle_accelerator: '#b98cff', nuclear_launcher: '#9de84a'
  };
  /* 材质梯度(亮 → 暗): 比地面(L≤27)与怪剪影(L 22~47)整体亮一档 ——
   * 玩家的家伙必须是屏幕上最抢眼的东西, 否则"武器看不见"等于没做。 */
  /* 材质梯度(亮 → 暗): v53 整体提亮一档。起因(主程实测, 不是猜): 商店 4 格模型舱里模型其实
   *   都画出来了, 但「深色金属画在 #0b0f0b 凹槽上」=> 肉眼读不出轮廓, 用户就报成「建模不见了」。
   *   现在每个梯度的中间调/暗部上抬, v57 起改成「亮而有色的身子 + 近黑 INK 描边」—— 不再靠往白推来读剪影。
   *   提亮 != 发光: 全程零 shadowBlur、零 Sprites.glow(probe-v42-ring 断言 glow 调用数 = 0)。
   *   trim 也提亮: 它是阶位色, 阶差要靠看得见的构件承载(见 wnTierAccents)。 */
  /* v54 材质表(主程探针口径): 顶档原来就是 #ffffff(纯白 = 饱和度 0), 这是「发白」的第一来源。
   * 现在三档全部是**有彩度的材质色**: 冷蓝钢 / 藏青铁 / 黄铜 / 木 / 金 —— 平均饱和度从 0.21 抬到 0.4+。 */
  var WN = {
    /* v57: 中间调压到 L 0.35~0.45 并保住彩度 —— 目标是「实体材质色」而不是「浅色线框」。
     *   v53 为了在深色凹槽里读得出剪影, 把亮档提到 #bfe0f5(近白) 并配冷白描边; 结果整把武器
     *   看起来是半透明线框(用户逐字投诉「类似透明效果」), 而门禁的「发白」口径抓不到
     *   (#bfe0f5 的 s=0.35 > 0.18, 从定义上就不算发白)。现在改「亮而有色的身子 + 近黑描边」,
     *   与怪用的是同一套纪律。 */
    /* v58(用户逐字「不要透明并给他上色」+ 主程复核「meanSat 0.369 只是没越下限」):
     *   v57 为了躲「发白」把中间调压到 L 0.35~0.45, 代价是身体变成**深藏青** ——
     *   在偏暗的地面上几乎读不出颜色, 用户看到的仍然是「没上色」。
     *   现在按材质给明确的中间调: 金属=蓝灰 / 木=棕 / 铜黄铜=暖黄 / 能量=亮黄(用户口径)。
     *   描边仍是近黑 INK; 亮档刻意不给到近白 —— 近白由 brightPct(<=25%) 那条新护栏守。 */
    steel: ['#8fb4d2', '#54809f', '#27435c'],   /* 金属: 蓝灰 */
    dark: ['#7ea0bd', '#48708d', '#22394d'],    /* 铁/暗金属 */
    brass: ['#f2cc74', '#bb8e2e', '#6a4c12'],   /* 铜/黄铜: 暖黄 */
    wood: ['#cf9150', '#8e6132', '#452c13'],    /* 木: 棕 */
    trim: ['#6fb4ff', '#4f96e0', '#b184ff', '#ffa947'],
    glow: ['#f7d67a', '#dda92a', '#8a660c']     /* 能量: 亮黄 */
  };
  /* v60 按**名字**给的材质(用户逐字「不要透明并给他上色」): 61 族的配色表(WNFAM)从这个表里挑。
   *   饱和度一律抬到 0.40 以上 —— 旧版的冷钢中调 #54809f 只有 0.31, 与近黑描边混在一起就是「没上色」。 */
  var WN60 = {
    steel:    ['#9cc6ee', '#4a82b4', '#1e3f60'],
    /* v62 颜色足量: 名字对应的材质必须**真的上色**。旧的 gunsteel/palesteel/darksteel/iron 中间档饱和度只有
     *   0.11~0.24, 与近黑描边(INK 饱和度 0.333)混在一起读起来就是“没上色”(实测钻头/\u5706\u952f 0.21)。
     *   现在每一档的 HSL 饱和度都 >= 0.36, 保持“铝钢蓝灰”的身份。 */
    gunsteel: ['#bcd8f0', '#4f86bb', '#27405c'],
    palesteel:['#d6ebfa', '#5f9cd0', '#2f5f88'],
    darksteel:['#b0c9e6', '#4f83b8', '#24384d'],
    iron:     ['#9fc9ee', '#4a86bd', '#24435f'],
    gold:     ['#ffedab', '#e4bb52', '#8b6520'],
    violet:   ['#ddc7f7', '#9a70d4', '#4b2f78'],
    yellow:   ['#fff2ab', '#f2c93a', '#8a6a10'],
    orange:   ['#ffd89c', '#f28f2e', '#8f4a0c'],
    flaming:  ['#ffcb90', '#ea5a28', '#7d280a'],
    cyan:     ['#d9f6ff', '#6fc9ea', '#2a6b8e'],
    teal:     ['#d4f5ed', '#5dc2ae', '#1f6659'],
    green:    ['#e2f8a6', '#93c840', '#3f6618'],
    cactus:   ['#c6f2a0', '#6cba3e', '#2d5d18'],
    leaf:     ['#cdec9b', '#78bc40', '#35641b'],
    ghost:    ['#d5f8e8', '#71d2ab', '#256d54'],
    ivory:    ['#fbf6e6', '#dbd0ad', '#8c7f5c'],
    tan:      ['#f4d2a2', '#cb9455', '#6d4a24'],
    /* v62: 旧 stone 是纯灰(s 0.04)—— “灰”不是颜色。改成暖砂岩/土黄, 既上色又与一库蓝钢拉开色相。 */
    stone:    ['#dcc79a', '#a37f42', '#523d18'],
    bark:     ['#e0b882', '#a4763f', '#4b2f16'],
    vine:     ['#d2eb9f', '#7fae4e', '#3d5c26'],
    red:      ['#ffc7ab', '#e2603c', '#7d2a14'],
    wood60:   ['#dcab6c', '#96652f', '#482b11'],
    brass60:  ['#f8dfa6', '#d3a63f', '#7c5a18']
  };
  /* 正在画的**这一族**的材质表: 置好之后, 头型里那句 wnRamp('steel') 自动变成
     该族自己的颜色(dark = 同色相压暗, 用来做厚度/背光, 不引入第二个色相)。 */
  var WNRAMP = null;
  function wShadeRamp(r, amt) { return [shade(r[0], amt * 0.45), shade(r[1], amt), shade(r[2], amt * 1.2)]; }
  function wMat(name) {
    var m = WN60[name] || WN.steel;
    return { steel: m, dark: wShadeRamp(m, -0.34), wood: WN60.wood60, brass: WN60.brass60 };
  }
  function wnRamp(name) { return (WNRAMP && WNRAMP[name]) || WN60[name] || WN[name] || WN.steel; }
  var WINK = INK;            /* v57 描边: 从冷蓝浅色 #cfe2f2 改成近黑 INK(用户要「深色描边」)      /* 描边: v54 从冷白 #dfe7ec 改成冷蓝浅色 —— 仍是模型上最亮的一档
                                (黑底凹槽上剪影读得出), 但有色相: 探针不再把它算进「发白」 */
  var WSHINE = '#a9c8e0';    /* 湿点高光基准色(冷蓝浅色)。**不是纯白** —— 纯白平涂/叠加出来就是用户说的「发白」 */
  /** 不透明高光: 在冷钢亮档与湿点色之间取实心色。禁止再用 rgba 叠高光 ——
   *  半透明细条会被 ctx 混成中间值像素(既半透明又发白), 主程探针就是被这批像素顶到 42% / 36%。 */
  function wnSpec(k) { return mix(wnRamp('steel')[0], WSHINE, 0.3 + 0.55 * clamp(k === undefined ? 0.5 : k, 0, 1)); }
  /** 阶位可见性: 同族不同阶必须看得出来(用户报「连发短铳 I / II 两格完全一样」)。
   *  drawWeaponIcon 把模型按头长归一化, 所以「更长」会被抵消 —— 只有**离散构件**才留得住:
   *  T2/T3/T4 各多一道柄箍, 颜色取该阶的阶位色, 于是阶数一眼可读, 不靠文字 T1/T2。 */
  function wnTierAccents(x, L, T, trim) {
    var n = clamp((T || 1) - 1, 0, 3), i, px, w = Math.max(1.6, 0.055 * L), hh = Math.max(2.4, 0.13 * L);
    for (i = 0; i < n; i++) {
      px = -0.44 * L + i * 0.15 * L;
      x.fillStyle = trim; x.fillRect(px, -hh, w, hh * 2);
      x.strokeStyle = INK; x.lineWidth = 1; x.strokeRect(px, -hh, w, hh * 2);
    }
  }
  /** 木/胶柄: 渐变 + 两端箍 + 木纹(柄是"人手握住"的锚点, 必须与刃区分材质) */
  function wnGrip(x, a, b, w, ramp) {
    var ln = Math.max(0.7, w * 0.16);
    x.fillStyle = ramp[1]; x.fillRect(a, -w / 2, b - a, w);
    x.fillStyle = ramp[0]; x.fillRect(a, -w / 2, b - a, Math.max(0.9, w * 0.34));
    x.fillStyle = ramp[2]; x.fillRect(a, w * 0.16, b - a, Math.max(0.8, w * 0.34));
    x.strokeStyle = WINK; x.lineWidth = Math.max(0.95, w * 0.22);
    x.strokeRect(a, -w / 2, b - a, w);
    x.strokeStyle = shade(ramp[2], -0.35); x.lineWidth = ln;
    x.beginPath();
    x.moveTo(a + (b - a) * 0.34, -w * 0.2); x.lineTo(a + (b - a) * 0.34, w * 0.2);
    x.moveTo(a + (b - a) * 0.66, -w * 0.2); x.lineTo(a + (b - a) * 0.66, w * 0.2);
    x.stroke();
  }
  /** 金属件: 渐变 + INK 描边 + 沿高度方向的整体明暗(单色金属会显得很平) */
  function wnMetal(x, pathFn, ramp, lw, hy) {
    var hh = hy || 10;
    /* v62 护栏: ramp 必须是三档数组。历史事故：某个头型把颜色字符串传进来,`, ramp[0]`
     *   得到 '#', CanvasGradient.addColorStop 抛异常 -> 该族的焙焙整个失败(Sprites 把这个 key 判死)
     *   并静默地变成空白。这里把字符串现场展开成安全的三档 ramp。 */
    if (typeof ramp === 'string' || !ramp) { var _r0 = (typeof ramp === 'string' ? ramp : wnRamp('steel')[1]); ramp = [shade(_r0, 0.24), _r0, shade(_r0, -0.34)]; }
    var g = x.createLinearGradient(0, -hh, 0, hh);
    g.addColorStop(0, ramp[0]); g.addColorStop(0.45, ramp[1]); g.addColorStop(1, ramp[2]);   /* v58: 不再往白/往黑拉 */
    pathFn(); x.fillStyle = g; x.fill();
    pathFn(); x.strokeStyle = WINK; x.lineWidth = lw || 1.4; x.lineJoin = 'round'; x.stroke();
  }
  function wnRect(x, a, b, c, d) { x.beginPath(); x.rect(a, b, c - a, d - b); }
  function wnPoly(x, pts) { polyPath(x, pts); }
  /** 尖刺/齿列: 沿一圈均匀排 n 枚三角(锯片/刺球/钉头共用) */
  function wnSpikes(x, cx, cy, r0, r1, n, col, rot0) {
    var i, a;
    for (i = 0; i < n; i++) {
      a = rot0 + i / n * TAU;
      x.beginPath();
      x.moveTo(cx + Math.cos(a - 0.18) * r0, cy + Math.sin(a - 0.18) * r0);
      x.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      x.lineTo(cx + Math.cos(a + 0.18) * r0, cy + Math.sin(a + 0.18) * r0);
      x.closePath();
      x.fillStyle = col; x.fill();
      x.strokeStyle = WINK; x.lineWidth = Math.max(0.8, r1 * 0.06); x.stroke();
    }
  }
  /** 元素光带: 沿 x 轴一条发光窄带(元素武器在模型本体上就有颜色, 不必等火花) */
  function wnElem(x, a, b, col, w) {
    var ww = w || 2.4;
    x.fillStyle = col;
    x.fillRect(a, -ww / 2, b - a, ww);
    x.fillStyle = mix(col, WSHINE, 0.62);
    x.fillRect(a, -ww * 0.18, b - a, ww * 0.36);
  }  function weaponDef(key) {
    var W = global.PS && PS.W && PS.W.list;
    var L = (PS.WeaponData && PS.WeaponData.list) || (global.PS && global.PS.WeaponData && global.PS.WeaponData.list) || W;
    return (L && L[key]) || null;
  }
  function variantOf(key, n) {
    var s = 0, i;
    for (i = 0; i < key.length; i++) s += key.charCodeAt(i);
    return s % n;
  }
  /** 一把武器的"形状类" —— 界面 / 战斗 / 特效三方共用这一处判定 */
  function weaponShape(def) {
    if (!def) return 'mace';
    if (def.targeting === 'orbit') return 'saw';
    var s = WSHAPE[def.family];
    if (s) return s;
    return def.cls === 'melee' ? 'mace' : 'pistol';   /* 数据缺族名时的兜底, 绝不返回空 */
  }
  PS.Art.weaponShape = weaponShape;
  function weaponElemCol(def) {
    if (!def || !def.elem) return null;
    return WN_ECOL[def.family] || '#ffd24a';
  }
  /** 头长由阶决定(阶是"同族不同档", 视觉上就该更长更重) */
  function weaponLen(tier) { return 15 + clamp(tier || 1, 1, 4) * 3.2; }
  /* ======================= 每族一个武器模型 (v56) =======================
   * 存在理由(用户逐字投诉「武器多做些建模, 长得都太像了」): 主程把它做成可测量的门禁
   *   qa/verify-weapon-shape.cjs —— 61 族逐族光栅化, 按外接框对齐后算两两剪影 IoU:
   *     全对 ≤ 0.82 且「最像邻居」的中位数 ≤ 0.62。定阈值那天实测 7 对 > 0.82(最差
   *     ghost_axe ~ hatchet 0.994)、中位 0.731 ⇒ 玩家在商店里认不出手里是哪一把。
   * 根因: 61 个身份族被压进 22 个形状类, 同类内只靠 weaponVariant 的 3 档比例差区分,
   *   而且其中几族**共用同一个分支体**(斧只有一种斧、双管铳与多管光铳同一个模子)。
   *
   * 现在改成「一族一个模型」: 表 WM 给每族 22 个数 + 头型/附件两个名字, 画出来就是那一件东西。
   *   · k  头型: 15 种"头"的画法(刃 / 楔斧 / 方块锤 / 球 / 盘 / 钩 / 耙 / 枪管 / 弩 / 钻…);
   *   · a1/a2 附件: **离散构件**(弹匣 / 瞄具 / 枪托 / 弹带 / 燃料罐 / 喇叭口 / 火舌 / 环…),
   *     它们是剪影上最"认得出"的部分 —— 同族异阶只差长度与阶位箍(那是设计, 不要求改);
   *   · 数字全部以 L(该阶头长)为单位, 握把在原点、刃/枪口朝 +x(与旧坐标纪律一致:
   *     drawWeaponIcon 与 drawWeaponRing 共用, rot 直接是瞄准角)。
   * 画法纪律与旧代码一致: 平涂实色 + 冷白描边(WINK) + INK 内线, 每把**至多 1 处**湿点;
   *   零发光 / 零径向渐变 / 零 alpha 渐变(wnElem 的窄带是两条实色, 不是渐变)。
   * 与 fx.js 的关系: PS.Art.weaponShape 仍返回旧的 22 个形状类名 —— 那是**特效语言**
   *   (fx.js 的 weaponHit 按它选火花几何), 与"模型长什么样"解耦; 本表只决定模型。
   *
   * WM[family] = [k, sh, hx, hl, hh, gw, s1, s2, xa, xb, a1k, a1x, a1y, a1w, a1h,
   *               a2k, a2x, a2y, a2w, a2h, s3, s4]
   *   k  头型名      sh 柄/身半厚   hx 头(枪管)起点   hl 头长   hh 头半高 / 管簇散布
   *   gw 握把粗细倍率   s1~s4 头型旋钮(见各画法)     xa 尾端(负)   xb 尖端 = 出膛口
   *   aXk 附件名(none = 空)   aXx/aXy = 左上角, aXw/aXh = 宽高
   */
  /* v64 (2026-09-29) 去同质化: qa/verify-weapon-shape.cjs 的 [4]「最像邻居中位数 <= 0.62」长期是红的(实测 0.679)。
   *   只改每族**自己这一行**的几何数(sh/hx/hl/hh/gw/xa/xb), 头型 k 与两个附件名不动, 且限制在**相对本族原值**
   *   单参数 <= ±32% / 宽高比 <= ±28% / 填充率 <= ±28% 的带内 —— 目标是让 [4] 达标, **不是**放宽它(阈值一个没动)。
   *   实测: 中位 0.679 -> 0.592, 全对最大 IoU 0.799 -> 0.649, 达标族 13/61 -> 47/61; 44 族改了几何数。
   *   可复现: work/_wshape-opt.cjs(搜索) + work/patch-wm.cjs(锚点断言写盘); 备份 art.js.bak-wm-*。
   *   目视复核: work/_wsheet-all.cjs 出 61 族 x 4 阶真浏览器拼图(work/snap/ws-{a,b,c}.png)。
   */
  var WM = {
    _def:                ['blade',0.07,0.04,1,0.16,1,0.5,0.35,-0.5,1.04,'none',0,0,0,0,'none',0,0,0,0,0,0],
    cactus_mace:         ['spikedclub',0.0624,0.7161,0.2382,0.3555,1.2622,8,0.55,-0.5035,1.2122,'none',0,0,0,0,'none',0,0,0,0,0,0],
    chain_gun:           ['chaingun',0.0896,0.3308,0.3456,0.1236,0.8486,2,0.34,-0.3284,1.0739,'none',0,0,0,0,'none',0,0,0,0,0,0],
    chopper:             ['cleaver',0.1107,0.0271,0.4452,0.4409,1.3426,0.95,0.35,-0.6048,0.5599,'none',0,0,0,0,'none',0,0,0,0,0,0],
    circular_saw:        ['saw',0.0585,0.5848,0.4391,0.4781,0.9336,12,0.15,-0.3932,1.1041,'none',0,0,0,0,'none',0,0,0,0,0,0],
    claw:                ['rake',0.036,0.511,0.5,0.36,0.741,3,0.55,-0.5,1.06,'none',0,0,0,0,'none',0,0,0,0,0,0],
    crossbow:            ['crossbow',0.0707,0.3216,0.5459,0.3368,0.5802,0.6,0.3,-0.4019,0.7758,'none',0,0,0,0,'none',0,0,0,0,0,0],
    dagger:              ['dagger',0.05,0.0593,0.4345,0.207,0.7645,0.3,0.75,-0.2614,1.1647,'none',0,0,0,0,'none',0,0,0,0,0,0],
    dextroyer:           ['plow',0.086,0.433,0.64,0.484,0.906,0.55,0.4,-0.5,1.073,'none',0,0,0,0,'none',0,0,0,0,0,0],
    double_barrel_shotgun:['shotgun',0.1454,0.218,0.5642,0.4219,1.0704,2,0.42,-0.5841,1.1664,'none',0,0,0,0,'none',0,0,0,0,0,0],
    drill:               ['drill',0.0607,0.0914,1.0262,0.4599,0.9974,0.55,0.45,-0.298,1.6626,'none',0,0,0,0,'none',0,0,0,0,0,0],
    excalibur:           ['holy',0.0462,0.1348,0.9174,0.1088,0.979,0.35,0.55,-0.5921,0.6947,'none',0,0,0,0,'none',0,0,0,0,0,0],
    fighting_stick:      ['baton',0.1137,0.4142,0.3695,0.1829,1.267,0.1,0.3,-0.6783,0.6772,'none',0,0,0,0,'none',0,0,0,0,0,0],
    fireball:            ['fireball',0.0757,0.366,0.6012,0.4329,1.506,0.44,0.55,-0.4833,0.7729,'none',0,0,0,0,'none',0,0,0,0,0,0],
    fist:                ['knuckle',0,0.0179,0.3512,0.3617,0.808,0,0.4,-0.2238,0.8634,'none',0,0,0,0,'none',0,0,0,0,0,0],
    flamethrower:        ['flamer',0.1188,0.28,0.5,0.24,0.881,1,0.36,-0.46,1.075,'none',0,0,0,0,'none',0,0,0,0,0,0],
    flaming_knuckles:    ['knuckles',0,0.03,0.42,0.16,1.136,3,0.35,-0.298,0.62,'none',0,0,0,0,'none',0,0,0,0,0,0],
    gatling_laser:       ['rotary',0.2442,0.34,0.5,0.3,1.342,4,0.34,-0.44,1.04,'none',0,0,0,0,'none',0,0,0,0,0,0],
    ghost_axe:           ['ghostaxe',0.0512,0.6771,0.5353,0.373,0.7397,0,0.5,-0.5314,0.7676,'none',0,0,0,0,'none',0,0,0,0,0,0],
    ghost_flint:         ['flint',0.0479,0.2788,0.2854,0.4107,0.8068,0.61,0.4,-0.5126,0.9157,'none',0,0,0,0,'none',0,0,0,0,0,0],
    ghost_scepter:       ['scepter',0.0365,0.7299,0.3594,0.3334,0.7536,0.3,0.5,-0.3964,0.6771,'none',0,0,0,0,'none',0,0,0,0,0,0],
    hammer:              ['maul',0.045,0.695,0.34,0.42,0.78,4,0.3,-0.5,1.06,'none',0,0,0,0,'none',0,0,0,0,0,0],
    hand:                ['palm',0,0,0.5132,0.2778,1.5872,1,0.45,-0.3158,0.8854,'none',0,0,0,0,'none',0,0,0,0,0,0],
    hatchet:             ['axe',0.0398,0.5896,0.3088,0.6592,0.9259,1,0.55,-0.5435,0.6882,'none',0,0,0,0,'none',0,0,0,0,0,0],
    icicle:              ['ice',0.0459,0.3028,0.4515,0.4468,0.9042,1,0.38,-0.5671,1.3114,'none',0,0,0,0,'none',0,0,0,0,0,0],
    jousting_lance:      ['lance',0.055,0.62,0.5,0.26,1.098,0.45,0.7,-0.56,1.16,'none',0,0,0,0,'none',0,0,0,0,0,0],
    knife:               ['knife',0.0586,0.0283,0.4601,0.1539,0.6372,0.45,0.4,-0.4451,1.3187,'none',0,0,0,0,'none',0,0,0,0,0,0],
    laser_gun:           ['laser',0.1004,0.2733,0.4354,0.1465,1.2459,1,0.4,-0.2989,1.2584,'none',0,0,0,0,'none',0,0,0,0,0,0],
    lightning_shiv:      ['shiv',0.0538,0.1201,0.5055,0.1268,1.3731,0.3,0.65,-0.3933,0.706,'none',0,0,0,0,'none',0,0,0,0,0,0],
    medical_gun:         ['syringe',0.1648,0.3555,0.5629,0.2169,0.6806,1,0.38,-0.526,1.2759,'none',0,0,0,0,'none',0,0,0,0,0,0],
    minigun:             ['minigun',0.1143,0.2222,0.5742,0.4007,1.2481,6,0.3,-0.3123,0.7333,'none',0,0,0,0,'none',0,0,0,0,0,0],
    nuclear_launcher:    ['mortar',0.123,0.3583,0.548,0.2469,1.0934,0.6,0.45,-0.5946,0.7336,'none',0,0,0,0,'none',0,0,0,0,0,0],
    obliterator:         ['railgun',0.141,0.6061,0,0.253,1.3658,0.62,0.4,-0.3316,0.772,'none',0,0,0,0,'none',0,0,0,0,0,0],
    particle_accelerator:['coil',0.0522,0.2027,0,0.1771,1.3224,3,0.42,-0.2869,1.5168,'none',0,0,0,0,'none',0,0,0,0,0,0],
    pistol:              ['handgun',0.186,0.3,0.42,0.15,0.78,1,0.42,-0.3,1.2,'none',0,0,0,0,'none',0,0,0,0,0,0],
    plank:               ['plank',0.0991,-0.1228,0.6349,0.3113,1.3217,0.6,0.35,-0.3563,0.7383,'none',0,0,0,0,'none',0,0,0,0,0,0],
    plasma_sledgehammer: ['sledge',0.0514,0.7378,0.2806,0.319,1.361,0,0.55,-0.5181,0.8709,'none',0,0,0,0,'none',0,0,0,0,0,0],
    potato_thrower:      ['hopper',0.1037,0.1806,0,0.2049,0.9309,0.5,0.4,-0.4122,1.1381,'none',0,0,0,0,'none',0,0,0,0,0,0],
    power_fist:          ['gauntlet',0,0,0.408,0.4019,0.7903,2,0.5,-0.3091,1.059,'none',0,0,0,0,'none',0,0,0,0,0,0],
    pruner:              ['hook',0.0473,0.7799,0.474,0.4917,1.0513,0.6,0.55,-0.6124,0.9076,'none',0,0,0,0,'none',0,0,0,0,0,0],
    revolver:            ['revolver',0.1381,0.2907,0.4732,0.2112,1.1709,1,0.46,-0.284,1.1571,'none',0,0,0,0,'none',0,0,0,0,0,0],
    rock:                ['stone',0.0806,0.4555,0.3327,0.4643,0.5501,0.37,0.5,-0.5245,0.9093,'none',0,0,0,0,'none',0,0,0,0,0,0],
    rocket_launcher:     ['launcher',0.2324,0.2159,0.726,0.1833,1.1037,0.55,0.4,-0.3702,0.8955,'none',0,0,0,0,'none',0,0,0,0,0,0],
    scissors:            ['shears',0.0509,0.0427,0.9415,0.4057,0.8312,0.5,0.2,-0.3961,0.8309,'none',0,0,0,0,'none',0,0,0,0,0,0],
    screwdriver:         ['driver',0.121,0.2473,0.3801,0.0625,3.2005,0.9,0.02,-0.3811,1.4424,'none',0,0,0,0,'none',0,0,0,0,0,0],
    scythe:              ['scythe',0.061,0.525,0.752,0.882,1.066,0.55,0.4,-0.52,1.277,'none',0,0,0,0,'none',0,0,0,0,0,0],
    sharp_tooth:         ['tooth',0.0599,0.1255,0.3616,0.2587,0.6418,0.7,0.45,-0.3293,0.5649,'none',0,0,0,0,'none',0,0,0,0,0,0],
    shredder:            ['shredder',0.0998,0.395,0.3691,0.3837,0.7464,1,0.36,-0.4652,0.8399,'none',0,0,0,0,'none',0,0,0,0,0,0],
    shuriken:            ['shuriken',0.0396,0.03,0.543,0.386,0.711,0,0,-0.92,0.92,'none',0,0,0,0,'none',0,0,0,0,0,0],
    slingshot:           ['yoke',0.0396,0.088,0.572,0.534,1.086,0.45,0.55,-0.34,0.66,'none',0,0,0,0,'none',0,0,0,0,0,0],
    smg:                 ['smg',0.176,0.3,0.42,0.2,1.149,1,0.34,-0.44,1,'none',0,0,0,0,'none',0,0,0,0,0,0],
    sniper_gun:          ['rifle',0.181,0.34,0.8,0.09,1.128,1,0.3,-0.44,1.26,'none',0,0,0,0,'none',0,0,0,0,0,0],
    spear:               ['spear',0.05,1.05,0.34,0.17,1.098,0.4,0.8,-0.5,1.42,'none',0,0,0,0,'none',0,0,0,0,0,0],
    spiky_shield:        ['shield',0.0618,0.3233,0.4005,0.6973,0.9108,10,0.6,-0.37,0.9394,'none',0,0,0,0,'none',0,0,0,0,0,0],
    stick:               ['branch',0.0681,0.5098,0.4295,0.2082,1.1381,0.75,0.35,-0.6368,0.9819,'none',0,0,0,0,'none',0,0,0,0,0,0],
    sword:               ['blade',0.0754,0.0596,0.9357,0.188,0.8506,0.55,0.3,-0.5676,1.5524,'none',0,0,0,0,'none',0,0,0,0,0,0],
    taser:               ['taser',0.2259,0.3248,0.389,0.1203,0.7664,1,0.5,-0.2831,0.5949,'none',0,0,0,0,'none',0,0,0,0,0,0],
    thunder_sword:       ['bolt',0.0517,0.0305,0.5959,0.1323,0.7648,0.25,0.7,-0.5547,0.8848,'none',0,0,0,0,'none',0,0,0,0,0,0],
    torch:               ['flame',0.0432,0.443,0.628,0.249,0.78,0.55,0.4,-0.5,1.071,'none',0,0,0,0,'none',0,0,0,0,0,0],
    vorpal_sword:        ['greatsword',0.0924,0.1393,1.0182,0.3836,1.029,0.75,0.22,-0.3743,0.6666,'none',0,0,0,0,'none',0,0,0,0,0,0],
    wand:                ['wand',0.026,0.50,0.36,0.30,1.098,0.15,0.4,-0.44,0.96,'none',0,0,0,0,'none',0,0,0,0,0,0],
    wrench:              ['jaw',0.058,0.551,0.436,0.305,0.78,0.55,0.5,-0.5,0.987,'none',0,0,0,0,'none',0,0,0,0,0,0]
  };
  /** 自含型头型: 它自己把"整把"画完(机匣/握把都在里面), 不再叠通用的柄 ⇒ 避免双柄 */
  var WSELF = { gun: 1, railgun: 1, tankgun: 1, coil: 1, bow: 1, hopper: 1, fist: 1, shuriken: 1,
    chaingun: 1, shotgun: 1, handgun: 1, revolver: 1, smg: 1, rifle: 1, minigun: 1, rotary: 1, laser: 1,
    syringe: 1, flamer: 1, mortar: 1, launcher: 1, taser: 1, shredder: 1,
    knuckle: 1, palm: 1, gauntlet: 1, knuckles: 1, shield: 1, crossbow: 1 };
  /** 柄的材质: 木柄 / 冷铁柄(按头型给, 不是按数值) */
  var WSHOOD = { club: 1, axe: 1, board: 1, chunk: 1, ball: 1, flame: 1, disc: 1, scythe: 1,
    hook: 1, prongs: 1, yoke: 1, drill: 1, orb: 1 };

  function wM(def) { return WM[(def && def.family) || ''] || WM._def; }
  function wN(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  /** 把 22 个数解成画图用的量(长度单位 = L) */
  function wP(M, L) {
    /* v61 修复: 这里一直漏了 k(= M[0] 头型名) —— 派发处用 P.k 挑 WHEAD[P.k], 缺了它 61 族
     *   全部落到 WHEAD.blade(近战刀身), 于是"所有远程武器都长成近战武器", 同时 WREACH/WHIGH/
     *   WSHOOD/WSELF 四张按 P.k 取值的表全部失效。兜底 'blade' 让 _def 行为不变。 */
    return { k: (M && M[0]) || 'blade', L: L, sh: Math.max(0.9, wN(M[1], 0.07) * L), hx: wN(M[2], 0.2) * L, hl: wN(M[3], 0.6) * L,
      hh: Math.max(1.2, wN(M[4], 0.2) * L), gw: wN(M[5], 1), s1: wN(M[6], 0), s2: wN(M[7], 0),
      xa: wN(M[8], -0.5) * L, xb: wN(M[9], 1.06) * L, s3: wN(M[20], 0), s4: wN(M[21], 0) };
  }
  function wFillP(x, pts, col, lw) { wnPoly(x, pts); fillC(x, acc(col)); if (lw) strokeC(x, WINK, lw); }
  function wFillR(x, a, b, c, d, col, lw) { wnRect(x, a, b, c, d); fillC(x, acc(col)); if (lw) strokeC(x, WINK, lw); }
  function wMetP(x, pts, ramp, lw, hy) { wnMetal(x, function () { wnPoly(x, pts); }, ramp, lw || 1.6, hy); }
  function wMetR(x, a, b, c, d, ramp, lw, hy) { wnMetal(x, function () { wnRect(x, a, b, c, d); }, ramp, lw || 1.6, hy); }
  function wDot(x, cx, cy, r, col) { circlePath(x, cx, cy, r); fillC(x, acc(col)); strokeC(x, WINK, Math.max(0.8, r * 0.24)); }
  /* ------------------------- v60 每族一个模型: 公共积木 -------------------------
   * 全部走「平涂实色(wnMetal 三档) + INK 描边」, 每件至多 1 处高光(wShine)。 */
  function wShine(x, a, b, w) { x.fillStyle = wnSpec(0.5); x.fillRect(a, -Math.max(0.8, w) / 2, b - a, Math.max(0.8, w)); }
  function wTube(x, a, b, w, ramp, lw) { wMetR(x, a, -w / 2, b, w / 2, ramp || wnRamp('steel'), lw || 1.4, w); }
  function wWedge(x, a, b, w0, w1, ramp, lw) { wMetP(x, [a, -w0 / 2, b, -w1 / 2, b, w1 / 2, a, w0 / 2], ramp || wnRamp('steel'), lw || 1.4, Math.max(w0, w1) * 0.65); }
  function wStud(x, cx, cy, r, col) { wDot(x, cx, cy, r, col || wnRamp('brass')[1]); }
  function wStrap(x, a, b, y0, y1, col, lw) { wFillR(x, a, y0, b, y1, col || wnRamp('wood')[1], lw === undefined ? 1.3 : lw); }
  /* 开口双齿(扳手/耙/剪刀/叉): 两条平行齿 + 根部实心 */
  function wFork(x, a, b, hw, gw, ramp) {
    wMetR(x, a, -hw, a + gw, hw, ramp || wnRamp('steel'), 1.5, hw);
    wMetR(x, a + gw * 0.8, -hw, b, -hw * 0.34, ramp || wnRamp('steel'), 1.4, hw * 0.5);
    wMetR(x, a + gw * 0.8, hw * 0.34, b, hw, ramp || wnRamp('steel'), 1.4, hw * 0.5);
  }
  /* ------------------------------ v60 逐族配色表 ------------------------------ */
  var WNFAM = {
    sword: 'steel', excalibur: 'gold', vorpal_sword: 'violet', thunder_sword: 'yellow',
    knife: 'palesteel', dagger: 'darksteel', sharp_tooth: 'ivory', lightning_shiv: 'yellow',
    chopper: 'steel', pruner: 'steel', scythe: 'steel', scissors: 'steel', hatchet: 'steel',
    ghost_axe: 'ghost', hammer: 'steel', plasma_sledgehammer: 'violet', wrench: 'iron',
    dextroyer: 'iron', claw: 'iron', cactus_mace: 'cactus', stick: 'bark', fighting_stick: 'bark',
    plank: 'bark', rock: 'stone', spiky_shield: 'iron', torch: 'orange', ghost_flint: 'ghost',
    ghost_scepter: 'ghost', wand: 'leaf', fist: 'gunsteel', hand: 'tan', power_fist: 'gunsteel',
    flaming_knuckles: 'flaming', spear: 'steel', jousting_lance: 'steel', screwdriver: 'brass60',
    circular_saw: 'iron', drill: 'iron', shuriken: 'leaf', slingshot: 'vine', crossbow: 'bark',
    pistol: 'gunsteel', revolver: 'gunsteel', smg: 'gunsteel', sniper_gun: 'gunsteel',
    double_barrel_shotgun: 'gunsteel', minigun: 'gunsteel', chain_gun: 'gunsteel',
    gatling_laser: 'teal', laser_gun: 'teal', medical_gun: 'teal', obliterator: 'violet',
    particle_accelerator: 'violet', shredder: 'leaf', icicle: 'cyan', flamethrower: 'orange',
    fireball: 'orange', nuclear_launcher: 'green', rocket_launcher: 'steel',
    potato_thrower: 'steel', taser: 'yellow'
  };
  function wFamOf(def) { return (def && def.family) || ''; }
  function wMatOf(def) { return WN60[WNFAM[wFamOf(def)] || ''] || WN.steel; }

  /* ------------------------------ 15 种"头" ------------------------------ */
  var WHEAD = {};
  /* ==================== v60 逐族头型: 每族一个可辨认的模型 ====================
   * 坐标: 握把在原点, +x = 刃/枪口方向; hx/hl/hh 来自该族自己的 WM 行。
   * 纪律: 平涂(wnMetal 三档) + INK 描边 + 每件至多 1 处高光(wShine); 零发光/零径向渐变/零半透明叠色。
   * 色: wnRamp('steel') = 该族主材质(WNFAM), 'dark' = 同色相压暗, 'wood'/'brass' = 木/铜配件。 */

  /* 圣芒长剑: 十字护手 + 细长剑身 + 柄首宝石 */
  WHEAD.holy = function (x, P, M, trim) {
    var hx = P.hx, hl = P.hl, hh = P.hh, xb = P.xb, gw = hh * 2.1;
    wMetR(x, hx - 0.05 * P.L, -gw, hx + 0.06 * P.L, gw, wnRamp('brass'), 1.5, gw);
    wMetP(x, [hx, -hh, xb - hl * 0.12, -hh * 0.62, xb, 0, xb - hl * 0.12, hh * 0.62, hx, hh], wnRamp('steel'), 1.4, hh);
    wDot(x, hx - 0.10 * P.L, 0, Math.max(1.1, hh * 0.42), trim);
    wShine(x, hx + hl * 0.24, xb - hl * 0.36, Math.max(0.9, hh * 0.18));
  };
  /* 锋刃巨剑: 宽厚刀身 + 背齿缺口 + 长护手 */
  WHEAD.greatsword = function (x, P, M, trim) {
    var hx = P.hx, hl = P.hl, hh = P.hh, xb = P.xb, i, t;
    wMetP(x, [hx, -hh, xb - hl * 0.02, -hh * 0.9, xb, -hh * 0.1, xb - hl * 0.05, hh * 0.55, xb - hl * 0.4, hh * 0.92, hx, hh * 0.84], wnRamp('steel'), 1.6, hh);
    for (i = 0; i < 3; i++) {
      t = hx + hl * (0.30 + i * 0.22);
      polyPath(x, [t, -hh * 0.96, t + hl * 0.08, -hh * 0.46, t + hl * 0.16, -hh * 0.96]);
      fillC(x, wnRamp('dark')[2]); strokeC(x, WINK, 1);
    }
    wMetR(x, hx - 0.07 * P.L, -hh * 1.46, hx + 0.03 * P.L, hh * 1.46, wnRamp('brass'), 1.5, hh * 1.4);
    wShine(x, hx + hl * 0.12, xb - hl * 0.44, Math.max(1, hh * 0.16));
  };
  /* 雷击长剑: 折线闪电刃(黄) */
  WHEAD.bolt = function (x, P, M, trim, ec) {
    var hx = P.hx, hl = P.hl, hh = P.hh, xb = P.xb, i, t, s = 1;
    x.beginPath();
    x.moveTo(hx, -hh);
    for (i = 0; i < 4; i++) { t = hx + hl * (0.2 + i * 0.2); x.lineTo(t, s > 0 ? -hh * 0.28 : -hh); s = -s; }
    x.lineTo(xb, 0);
    for (i = 3; i >= 0; i--) { t = hx + hl * (0.2 + i * 0.2); x.lineTo(t, s > 0 ? hh : hh * 0.28); s = -s; }
    x.lineTo(hx, hh);
    x.closePath();
    var g = x.createLinearGradient(0, -hh, 0, hh);
    g.addColorStop(0, wnRamp('steel')[0]); g.addColorStop(0.55, wnRamp('steel')[1]); g.addColorStop(1, wnRamp('steel')[2]);
    x.fillStyle = g; x.fill(); x.strokeStyle = WINK; x.lineWidth = 1.5; x.lineJoin = 'round'; x.stroke();
    wMetR(x, hx - 0.06 * P.L, -hh * 2.4, hx + 0.02 * P.L, hh * 2.4, wnRamp('brass'), 1.4, hh * 2.2);
    wShine(x, hx + hl * 0.3, xb - hl * 0.3, Math.max(0.9, hh * 0.28));
  };
  /* 薄刃切刀: 长薄刀身 + 斜尖 + 无护手 */
  WHEAD.knife = function (x, P, M, trim) {
    var L = P.L, hh = P.hh, x0 = 0.40 * L, x1 = P.xb;
    /* v62 厚刀格 + 直背与弧形刃口(下沿鼓出): 对称的锥形剪影与“枝干/棒”撞在 0.9+。 */
    wMetP(x, [x0, -hh * 0.98, x1 - hh * 1.6, -hh * 0.98, x1, -hh * 0.40, x1, hh * 0.18,
      x1 - hh * 1.1, hh * 1.06, x0 + hh * 1.4, hh * 0.86, x0, hh * 0.30], wnRamp('steel'), 1.6, hh);
    wMetR(x, x0 - hh * 0.30, -hh * 1.10, x0 + hh * 0.34, hh * 1.10, wnRamp('brass'), 1.4, hh);
    wMetR(x, P.xa, -hh * 0.34, x0 - hh * 0.30, hh * 0.34, wnRamp('wood'), 1.6, hh * 0.4);   /* v62 木柄(厨刀本来就是木柄): 旧 'dark' 档占了刀身一半面积而饱和度只有 0.24 */
    wShine(x, x0 + hh * 1.5, x1 - hh * 2.6, Math.max(0.9, hh * 0.20));
  };
  /* 短刃匕: 细长匕身 + 圆护手 + 柄首球 */
  WHEAD.dagger = function (x, P, M, trim) {
    var L = P.L, hh = P.hh, x0 = 0.40 * L, x1 = P.xb;
    wMetP(x, [x0, -hh, x1 - hh * 2.0, -hh * 0.44, x1, 0, x1 - hh * 2.0, hh * 0.44, x0, hh], wnRamp('steel'), 1.3, hh);
    wDot(x, x0 - hh * 1.15, 0, Math.max(1.2, hh * 1.15), wnRamp('dark')[1]);
    wShine(x, x0 + hh * 1.2, x1 - hh * 3.6, Math.max(0.8, hh * 0.26));
  };
  /* 尖牙短刃: 单枚外弯骨牙 + 根部缺口 */
  WHEAD.tooth = function (x, P, M, trim) {
    var L = P.L, hh = P.hh, hx = P.hx, xb = P.xb;
    wnMetal(x, function () {
      x.beginPath();
      x.moveTo(hx - 0.24 * L, hh * 0.55);
      x.quadraticCurveTo(hx + 0.1 * L, -hh * 1.5, xb, -hh * 0.34);
      x.quadraticCurveTo(xb - 0.34 * L, hh * 0.02, hx - 0.02 * L, hh * 0.95);
      x.closePath();
    }, wnRamp('steel'), 1.5, hh);
    wShine(x, hx + 0.04 * L, xb - 0.26 * L, Math.max(0.9, hh * 0.22));
  };
  /* 雷光短匕: 细匕 + 两枚电弧齿 */
  WHEAD.shiv = function (x, P, M, trim, ec) {
    var L = P.L, hh = P.hh, x0 = 0.38 * L, x1 = P.xb, i, n = 4, t, s = 1;
    var pts = [x0, -hh];
    for (i = 1; i <= n; i++) {
      t = x0 + (x1 - x0) * (i - 0.5) / n;
      pts.push(t, s > 0 ? -hh * 0.18 : -hh);
      s = -s;
    }
    pts.push(x1, 0);
    s = 1;
    for (i = n; i >= 1; i--) {
      t = x0 + (x1 - x0) * (i - 0.5) / n;
      pts.push(t, s > 0 ? hh * 0.18 : hh);
      s = -s;
    }
    pts.push(x0, hh);
    wMetP(x, pts, wnRamp('steel'), 1.4, hh);
    wDot(x, x0 - hh * 0.9, 0, Math.max(1, hh * 0.8), ec || wnRamp('brass')[1]);
    wShine(x, x0 + hh * 0.8, x1 - hh * 3.0, Math.max(0.8, hh * 0.2));
  };
  /* 厚背剁刀: 方头厚背菜刀 + 铆钉孔 */
  WHEAD.cleaver = function (x, P, M, trim) {
    var hx = P.hx, hl = P.hl, hh = P.hh, xb = P.xb;
    wMetP(x, [hx, -hh * 0.9, xb, -hh, xb, hh * 0.82, hx + hl * 0.1, hh], wnRamp('steel'), 1.7, hh);
    wMetR(x, xb - hl * 0.24, -hh * 1.12, xb, hh * 0.96, wnRamp('dark'), 1.5, hh * 1.1);
    wDot(x, xb - hl * 0.1, hh * 0.45, Math.max(1, hh * 0.2), wnRamp('brass')[1]);
    wShine(x, hx + hl * 0.2, xb - hl * 0.34, Math.max(1, hh * 0.13));
  };
  /* 幽影战斧: 双刃月牙斧 + 杖尾骨球 */
  WHEAD.ghostaxe = function (x, P, M, trim, ec) {
    var hx = P.hx, hl = P.hl, hh = P.hh, xb = P.xb, i, s;
    for (i = 0; i < 2; i++) {
      s = i ? 1 : -1;
      wnMetal(x, (function (sg) {
        return function () {
          x.beginPath();
          x.moveTo(hx + hl * 0.18, -hh * 0.22 * sg);
          x.quadraticCurveTo(hx + hl * 0.94, -hh * (0.5 + 0.5 * sg) * sg, xb, -hh * 0.06 * sg);
          x.quadraticCurveTo(hx + hl * 0.7, -hh * 0.1 * sg, hx + hl * 0.18, hh * 0.2 * sg);
          x.closePath();
        };
      })(s), wnRamp('steel'), 1.6, hh);
    }
    wMetR(x, hx - 0.04 * P.L, -hh * 0.26, hx + hl * 0.3, hh * 0.26, wnRamp('dark'), 1.4, hh * 0.3);
    wDot(x, hx - 0.12 * P.L, 0, Math.max(1.2, hh * 0.3), ec || trim);
    wShine(x, hx + hl * 0.34, hx + hl * 0.7, Math.max(1, hh * 0.14));
  };
  /* 碎岩重锤: 方墩锤头 + 双颊 + 楔形 */
  WHEAD.maul = function (x, P, M, trim) {
    var hx = P.hx, hl = P.hl, hh = P.hh, xb = P.xb;
    wMetR(x, hx, -hh, xb, hh, wnRamp('steel'), 1.9, hh);
    wMetR(x, hx - hl * 0.06, -hh * 0.34, xb, hh * 0.34, wnRamp('dark'), 1.4, hh * 0.4);
    wStud(x, hx + hl * 0.2, -hh * 0.62, Math.max(1, hh * 0.16));
    wStud(x, hx + hl * 0.62, -hh * 0.62, Math.max(1, hh * 0.16));
    wStud(x, hx + hl * 0.2, hh * 0.62, Math.max(1, hh * 0.16));
    wStud(x, hx + hl * 0.62, hh * 0.62, Math.max(1, hh * 0.16));
    wShine(x, hx + hl * 0.2, xb - hl * 0.2, Math.max(1, hh * 0.14));
  };
  /* 等离子重槌: 圆柱锤头 + 紫环 + 四枚棱齿 */
  WHEAD.sledge = function (x, P, M, trim, ec) {
    var hx = P.hx, hl = P.hl, hh = P.hh, xb = P.xb;
    wMetR(x, hx, -hh * 0.9, xb, hh * 0.9, wnRamp('steel'), 1.8, hh * 0.9);
    /* v62 真 bug: 这里以前把 trim(**颜色字符串**)当 ramp(三档**数组**)传给 wnMetal,
     *   于是 ramp[0] = '#', addColorStop 抛异常 -> 整只 plasma_sledgehammer 焙焙失败并被 Sprites 判死,
     *   表现为“商店/战斗里这把武器整格空白”。现在按 trim 色相现场生成三档 ramp。 */
    wMetR(x, hx + hl * 0.34, -hh, hx + hl * 0.66, hh, [shade(trim, 0.24), trim, shade(trim, -0.34)], 1.4, hh);
    wnSpikes(x, hx + hl * 0.5, 0, hh * 0.95, hh * 1.34, 6, wnRamp('steel')[0], 0.2);
    wShine(x, hx + hl * 0.12, xb - hl * 0.4, Math.max(1, hh * 0.16));
  };
  /* 三齿钢耙: 横梁 + 三枚弯齿(农具, 不是矛) */
  WHEAD.rake = function (x, P, M, trim) {
    var hx = P.hx, hl = P.hl, hh = P.hh, i, t;
    wMetR(x, hx, -hh * 0.3, hx + hl * 0.2, hh * 0.3, wnRamp('steel'), 1.5, hh * 0.35);
    for (i = 0; i < 3; i++) {
      t = -hh * 0.74 + i * hh * 0.74;
      wnMetal(x, (function (ty) {
        return function () {
          x.beginPath();
          x.moveTo(hx + hl * 0.16, ty - hh * 0.14);
          x.quadraticCurveTo(hx + hl * 0.9, ty * 1.05, hx + hl, ty * 1.1 + hh * 0.1);
          x.quadraticCurveTo(hx + hl * 0.86, ty * 1.12 + hh * 0.3, hx + hl * 0.16, ty + hh * 0.14);
          x.closePath();
        };
      })(t), wnRamp('steel'), 1.3, hh * 0.4);
    }
    wShine(x, hx + hl * 0.3, hx + hl * 0.7, Math.max(1, hh * 0.12));
  };
  /* 狼牙棒: 圆头木棒 + 环形尖刺 */
  WHEAD.spikedclub = function (x, P, M, trim) {
    var hx = P.hx, hl = P.hl, hh = P.hh, cx = hx + hl * 0.52, r = hh;
    wnSpikes(x, cx, 0, r * 0.92, r * 1.5, 8, wnRamp('steel')[1], 0.35);
    wnMetal(x, function () { circlePath(x, cx, 0, r); }, wnRamp('steel'), 1.8, r);
    wShine(x, cx - r * 0.3, cx + r * 0.1, Math.max(1, r * 0.22));
  };
  /* 枯枝棍: 疙瘩枝干 + 两截断杈 */
  WHEAD.branch = function (x, P, M, trim) {
    var L = P.L, hh = P.hh;
    wMetP(x, [-0.2 * L, -hh * 0.5, 0.2 * L, -hh * 0.62, 0.7 * L, -hh * 1.0, 1.16 * L, -hh * 0.56,
      1.16 * L, hh * 0.56, 0.7 * L, hh * 1.0, 0.2 * L, hh * 0.62, -0.2 * L, hh * 0.5], wnRamp('wood'), 1.9, hh);
    /* v62 两截断杈加长加粗: “树叉”的十字剪影才是 stick 最认得出的部分,
     *   否则它与锥形短棒(fighting_stick)/薄刃刀(knife)在剪影上分不开。 */
    wMetP(x, [0.18 * L, -hh * 0.5, 0.30 * L, -hh * 2.5, 0.52 * L, -hh * 2.3, 0.44 * L, -hh * 0.4], wnRamp('dark'), 1.3, hh * 0.6);
    wMetP(x, [0.56 * L, hh * 0.5, 0.72 * L, hh * 2.4, 0.92 * L, hh * 2.1, 0.80 * L, hh * 0.42], wnRamp('dark'), 1.3, hh * 0.6);
    wShine(x, 0.1 * L, 0.9 * L, Math.max(0.9, hh * 0.18));
  };
  /* 短棍: 缠绳短棒 + 端帽 */
  WHEAD.baton = function (x, P, M, trim) {
    var L = P.L, hh = P.hh, i, xb = P.xb;
    /* v62 锥形欄(沿杆细 -> 欄头粗) + 缠绳 + 铜尾钮。
     *   等宽直棒会把外接框填满(实测填充率 0.96 > 上界 0.95), 锥形后落在 ~0.7,
     *   而且与长杆/木板/枝干在剪影上一眼分得开。 */
    wMetP(x, [-0.30 * L, -hh * 0.46, 0.18 * L, -hh, xb - hh * 0.7, -hh * 1.12, xb, -hh * 0.45,
      xb, hh * 0.45, xb - hh * 0.7, hh * 1.12, 0.18 * L, hh, -0.30 * L, hh * 0.46], wnRamp('wood'), 2, hh);
    for (i = 0; i < 3; i++) wMetR(x, (-0.25 + i * 0.14) * L, -hh * 0.62, (-0.19 + i * 0.14) * L, hh * 0.62, wnRamp('dark'), 1.2, hh * 0.6);
    wDot(x, -0.33 * L, 0, Math.max(1, hh * 0.70), wnRamp('brass')[1]);
    wShine(x, -0.10 * L, xb - hh * 1.4, Math.max(0.8, hh * 0.14));
  };
  /* 厚木板: 直板 + 两枚铁钉 + 木纹 */
  WHEAD.plank = function (x, P, M, trim) {
    var L = P.L, hh = P.hh;
    /* v62: 板尾用 P.xb(以前硬写 1.2L 而图框 xb=1.08L -> 真烘焙时板尾被裁)。 */
    wMetR(x, -0.16 * L, -hh, P.xb, hh, wnRamp('wood'), 2, hh);
    wMetR(x, 0.06 * L, -hh * 1.08, 0.16 * L, hh * 1.08, wnRamp('dark'), 1.4, hh);
    wMetR(x, 0.86 * L, -hh * 1.08, 0.96 * L, hh * 1.08, wnRamp('dark'), 1.4, hh);
    x.fillStyle = WINK; x.fillRect(0.22 * L, hh * 0.2, 0.5 * L, Math.max(0.8, hh * 0.14));
    wShine(x, 0.2 * L, 0.8 * L, Math.max(0.9, hh * 0.16));
  };
  /* 投掷石块: 不规则石块 + 短皮绳 */
  WHEAD.stone = function (x, P, M, trim) {
    var hx = P.hx, hl = P.hl, hh = P.hh, cx = hx + hl * 0.52, r = hh * 1.22;
    /* v63 投掷石块: 块头放大到 r=1.22hh, 外缘改成**带深凹口**的碎石(不是光滑多边形)。
     *   旧版与厚块系(chopper 0.778 / power_fist 0.668 / vorpal_sword 0.690)撞在同一个"鼓包"剪影上;
     *   现在凹口把外缘切成 4 段可见的棱, 顶/底各留一处真空缺。 */
    wnMetal(x, function () {
      polyPath(x, [cx - r * 1.30, r * 0.10, cx - r * 1.02, -r * 0.78, cx - r * 0.36, -r * 1.16,
        cx + r * 0.30, -r * 0.98, cx + r * 0.86, -r * 0.44, cx + r * 1.16, r * 0.24,
        cx + r * 0.52, r * 0.72, cx + r * 0.06, r * 1.14, cx - r * 0.62, r * 0.96]);
    }, wnRamp('steel'), 1.8, r);
    x.beginPath();
    x.moveTo(cx - r * 0.86, -r * 0.52); x.lineTo(cx - r * 0.44, -r * 0.86); x.lineTo(cx - r * 0.30, -r * 0.34);
    strokeC(x, WINK, Math.max(1.1, r * 0.16));
    x.beginPath();
    x.moveTo(cx + r * 0.20, r * 0.52); x.lineTo(cx + r * 0.66, r * 0.20); x.lineTo(cx + r * 0.36, r * 0.86);
    strokeC(x, WINK, Math.max(1.1, r * 0.14));
    wStrap(x, hx - 0.08 * P.L, hx + hl * 0.06, -hh * 0.30, hh * 0.30, wnRamp('wood')[1], 1.2);
    wShine(x, cx - r * 0.62, cx - r * 0.12, Math.max(1, r * 0.18));
  };
  /* 尖刺圆盾: 圆盾 + 盾凸 + 环刺 + 背带 */
  WHEAD.shield = function (x, P, M, trim) {
    var hx = P.hx, hl = P.hl, hh = P.hh, xb = P.xb, cx = hx + hl * 0.5, r = hh * 0.94;
    wnSpikes(x, cx, 0, r * 0.98, r * 1.34, 10, wnRamp('steel')[1], 0.3);
    wnMetal(x, function () { circlePath(x, cx, 0, r); }, wnRamp('steel'), 1.9, r);
    wnMetal(x, function () { circlePath(x, cx, 0, r * 0.44); }, wnRamp('dark'), 1.5, r * 0.5);
    wMetR(x, cx - r * 0.34, -r * 0.16, cx - r * 0.05, r * 0.16, wnRamp('brass'), 1.2, r * 0.2);
    wShine(x, cx - r * 0.5, cx - r * 0.12, Math.max(1, r * 0.2));
  };
  /* 鬼火燧石: 棱角燧石 + 三簇鬼火 */
  WHEAD.flint = function (x, P, M, trim, ec) {
    var hx = P.hx, hl = P.hl, hh = P.hh, xb = P.xb, c = ec || wnRamp('brass')[1];
    wnMetal(x, function () {
      polyPath(x, [hx, -hh * 0.1, hx + hl * 0.26, -hh, hx + hl * 0.78, -hh * 0.7, xb, hh * 0.1,
        hx + hl * 0.6, hh * 0.94, hx + hl * 0.16, hh * 0.8]);
    }, wnRamp('steel'), 1.7, hh);
    wFillP(x, [hx + hl * 0.34, -hh * 1.1, hx + hl * 0.6, -hh * 2.2, hx + hl * 0.86, -hh * 1.0], c, 1.2);
    wFillP(x, [hx + hl * 0.1, -hh * 0.9, hx + hl * 0.24, -hh * 1.7, hx + hl * 0.44, -hh * 0.86], c, 1.2);
    wShine(x, hx + hl * 0.3, hx + hl * 0.6, Math.max(1, hh * 0.16));
  };
  /* 幽光权杖: 杖 + 爪托幽球 */
  WHEAD.scepter = function (x, P, M, trim, ec) {
    var hx = P.hx, hl = P.hl, hh = P.hh, xb = P.xb, cx = hx + hl * 0.62, r = hh * 0.8;
    wMetR(x, hx - 0.04 * P.L, -hh * 0.2, hx + hl * 0.4, hh * 0.2, wnRamp('brass'), 1.4, hh * 0.24);
    wDot(x, cx, 0, r, ec || wnRamp('steel')[0]);
    limb(x, cx - r * 0.9, -r * 1.5, cx - r * 0.2, -r * 0.7, 0.2, wnRamp('brass')[1], Math.max(1.1, r * 0.24));
    limb(x, cx - r * 0.9, r * 1.5, cx - r * 0.2, r * 0.7, -0.2, wnRamp('brass')[1], Math.max(1.1, r * 0.24));
    wShine(x, cx - r * 0.5, cx + r * 0.1, Math.max(1, r * 0.22));
  };
  /* 芽木法杖: 芽枝 + 顶端花苞 + 两片小叶 */
  WHEAD.wand = function (x, P, M, trim) {
    var hx = P.hx, hl = P.hl, hh = P.hh, xb = P.xb, cx = hx + hl * 0.5, r = hh * 0.62;
    wMetR(x, hx - 0.05 * P.L, -hh * 0.2, hx + hl * 0.62, hh * 0.2, wnRamp('wood'), 1.4, hh * 0.24);
    wnMetal(x, (function () { return function () { blobPath(x, cx, 0, r, 0.16, 5); }; })(), wnRamp('steel'), 1.5, r);
    /* v62: 叶片放大(法杖的“芽”必须比“杆”显眼) —— 原来与 pruner 的钩在 20px 上撞到 0.892。 */
    leafBlade(x, cx - r * 0.5, -r * 0.3, -1.75, r * 2.45, r * 0.62, wnRamp('steel')[1], 0.55);
    leafBlade(x, cx + r * 0.4, r * 0.25, -0.25, r * 2.15, r * 0.55, wnRamp('steel')[1], -0.55);
    leafBlade(x, cx - r * 0.1, -r * 0.9, -1.15, r * 1.7, r * 0.42, wnRamp('dark')[1], 0.35);
    wShine(x, cx - r * 0.4, cx + r * 0.2, Math.max(1, r * 0.26));
  };
  /* 铁指拳套: 四枚指节圆凸 + 腕带 */
  WHEAD.knuckle = function (x, P, M, trim) {
    var L = P.L, hh = P.hh, i;
    wMetR(x, 0.1 * L, -hh, 0.86 * L, hh, wnRamp('steel'), 1.9, hh);
    for (i = 0; i < 4; i++) {
      wDot(x, 0.2 * L + i * 0.18 * L, -hh * 1.05, Math.max(1.1, hh * 0.3), wnRamp('dark')[1]);
    }
    wFillR(x, 0.16 * L, hh * 0.1, 0.8 * L, hh * 0.34, acc(wnRamp('brass')[1]), 1.2);
    wShine(x, 0.14 * L, 0.82 * L, Math.max(0.9, hh * 0.2));
  };
  /* 铁砂掌: 摊开的皮掌 + 四指 + 拇指 */
  WHEAD.palm = function (x, P, M, trim) {
    var hx = P.hx, hl = P.hl, hh = P.hh, xb = P.xb, i, fw = hl * 0.36;
    wnMetal(x, function () {
      polyPath(x, [hx, -hh * 0.82, xb - hl * 0.30, -hh * 0.92, xb - hl * 0.32, hh * 0.74, hx, hh * 0.86]);
    }, wnRamp('steel'), 1.7, hh);
    /* v62: 四根张开的长手指(扇形) —— 手最认得出的部分;
     *   指缝是剪影上的负空间,与“实心拳套(power_fist)”拉开(0.832 -> 目标 <0.82)。 */
    for (i = 0; i < 4; i++) {
      wMetR(x, xb - hl * 0.36 + i * fw * 0.10, -hh * 0.66 + i * hh * 0.46,
        xb + fw * 0.92 - i * fw * 0.18, -hh * 0.32 + i * hh * 0.46, wnRamp('steel'), 1.2, hh * 0.30);
    }
    limb(x, hx + hl * 0.1, -hh * 0.7, xb - hl * 0.1, -hh * 1.5, 0.3, wnRamp('dark')[1], Math.max(1.1, hh * 0.26));
    wShine(x, hx + hl * 0.2, xb - hl * 0.3, Math.max(1, hh * 0.18));
  };
  /* 重击拳套: 厚重护手板 + 铆钉 + 双箍 */
  WHEAD.gauntlet = function (x, P, M, trim) {
    var hx = P.hx, hl = P.hl, hh = P.hh, xb = P.xb, i, fw = hh * 0.34, cy;
    /* v63 拳套: 掌背实心块 + 前端**四根分开的指节条**(条间是真空隙, 不是同色块)。
     *   旧版是一整块实心方块(填充率 0.88), 与所有"厚块"系族在剪影上撞车(实测 hand 0.804 /
     *   minigun 0.781 / chopper 0.770)。分指后正面变成梳齿, 剪影自成一类, 且**更像一只拳头**。 */
    wMetR(x, hx, -hh * 0.64, xb - hl * 0.42, hh * 0.64, wnRamp('steel'), 2, hh * 0.6);
    wMetR(x, hx + hl * 0.14, -hh * 0.50, xb - hl * 0.44, hh * 0.50, wnRamp('dark'), 1.5, hh * 0.5);
    for (i = 0; i < 4; i++) {
      cy = -hh * 0.78 + i * hh * 0.52;
      wMetR(x, xb - hl * 0.46, cy - fw * 0.5, xb, cy + fw * 0.5, wnRamp(i % 2 ? 'dark' : 'steel'), 1.4, fw);
    }
    wStrap(x, P.xa + 0.05 * P.L, hx + 0.03 * P.L, -hh * 0.52, hh * 0.52, wnRamp('wood')[1], 1.4);
    wShine(x, hx + hl * 0.3, xb - hl * 0.52, Math.max(1, hh * 0.14));
  };
  /* 烈焰拳套: 四枚火苗指节 + 皮带 */
  WHEAD.knuckles = function (x, P, M, trim, ec) {
    var hx = P.hx, hl = P.hl, hh = P.hh, xb = P.xb, i, c = ec || wnRamp('steel')[1];
    wStrap(x, hx, xb, -hh * 0.5, hh * 0.5, wnRamp('wood')[2], 1.3);
    for (i = 0; i < 4; i++) {
      polyPath(x, [hx + hl * (0.06 + i * 0.24), -hh * 0.5, hx + hl * (0.16 + i * 0.24), -hh * 2.1,
        hx + hl * (0.28 + i * 0.24), -hh * 0.5]);
      fillC(x, acc(c)); strokeC(x, WINK, 1.2);
    }
    wShine(x, hx + hl * 0.2, xb - hl * 0.3, Math.max(1, hh * 0.22));
  };
  /* 火球(爆炎弹): 火球 + 三条火舌 + 短握把 */
  WHEAD.fireball = function (x, P, M, trim, ec) {
    var hx = P.hx, hl = P.hl, hh = P.hh, cx = hx + hl * 0.5, r = hh * 0.86, i, c = ec || wnRamp('steel')[1];
    wnMetal(x, function () { circlePath(x, cx, 0, r); }, wnRamp('steel'), 1.8, r);
    for (i = 0; i < 3; i++) {
      var a = -0.9 + i * 0.9;
      wFillP(x, [cx + Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7,
        cx + Math.cos(a) * r * 2.0, Math.sin(a) * r * 2.0,
        cx + Math.cos(a + 0.5) * r * 0.7, Math.sin(a + 0.5) * r * 0.7], c, 1.2);
    }
    wShine(x, cx - r * 0.5, cx + r * 0.1, Math.max(1, r * 0.26));
  };
  /* 寒冰锥: 三根冰棱 + 冰座 */
  WHEAD.ice = function (x, P, M, trim, ec) {
    var L = P.L, hh = P.hh, x0 = 0.34 * L, x1 = 1.36 * L, i, k;
    wMetP(x, [x0, -hh, x1 - hh * 1.5, -hh * 0.28, x1, 0, x1 - hh * 1.5, hh * 0.28, x0, hh], wnRamp('steel'), 1.5, hh);
    for (i = 0; i < 3; i++) {
      k = x0 + (x1 - x0) * (0.08 + i * 0.16);
      wMetP(x, [k, -hh * 0.9, k + hh * 0.5, -hh * 1.7, k + hh * 0.72, -hh * 0.8], wnRamp('dark'), 1.2, hh * 0.6);
      wMetP(x, [k, hh * 0.9, k + hh * 0.5, hh * 1.7, k + hh * 0.72, hh * 0.8], wnRamp('dark'), 1.2, hh * 0.6);
    }
    if (ec) wnElem(x, x0 + hh * 0.6, x1 - hh * 2.4, ec, Math.max(1.4, hh * 0.34));
    wShine(x, x0 + hh * 1.2, x1 - hh * 3.2, Math.max(0.9, hh * 0.28));
  };
  /* 修枝镰(保留 v53 钩头, 换族配色) */
  /* 收割长镰 / 园圃剪刀 / 短柄手斧 / 长柄扳手 / 破土犁刀 / 穿心钻 / 飞叶镖 / 藤皮弹弓 /
   * 火把 / 肩扛投筒 沿用 v53 头型(它们本来就各不相同), 只换材质色。 */  /* 枪械公共件: 向下伸出的握把(机匣自己画在 head 里) */
  function wGunGrip(x, gx, y0, w, len, col, lw) {
    wFillR(x, gx, y0, gx + w, y0 + len, acc(col || wnRamp('wood')[1]), lw === undefined ? 1.4 : lw);
    x.beginPath(); x.moveTo(gx + w * 0.3, y0 + len * 0.2); x.lineTo(gx + w * 0.34, y0 + len * 0.8);
    strokeC(x, rgba(INK, 0.5), 1);
  }
  /* 短管手铳: 方套筒 + 短枪管 + 下握把 + 扳机护圈 */
  WHEAD.handgun = function (x, P, M, trim, ec) {
    var L = P.L, r = P.hh * 0.72;
    wMetR(x, 0.36 * L, -r, 1.24 * L, r, wnRamp('steel'), 1.8, r);
    wMetR(x, 1.18 * L, -r * 0.5, 1.34 * L, r * 0.5, wnRamp('dark'), 1.4, r * 0.45);
    wMetR(x, 0.38 * L, r * 0.9, 0.62 * L, r + 0.52 * L, wnRamp('wood'), 1.6, 0.2 * L);
    x.beginPath(); x.arc(0.74 * L, r * 1.1, r * 1.3, -0.3, Math.PI + 0.3); strokeC(x, WINK, 1.3);
    wShine(x, 0.44 * L, 1.14 * L, Math.max(1, r * 0.4));
  };
  /* 转轮手铳: 中段胖转轮 + 长管 */
  WHEAD.revolver = function (x, P, M, trim, ec) {
    var L = P.L, r = P.hh * 0.34, cx = 0.56 * L, dr = P.hh;
    wMetR(x, cx - dr * 0.5, -r, 1.46 * L, r, wnRamp('steel'), 1.6, r);
    wnMetal(x, function () { circlePath(x, cx, 0, dr); }, wnRamp('dark'), 1.7, dr);
    wDot(x, cx, 0, Math.max(1, dr * 0.34), wnRamp('brass')[1]);
    wMetR(x, 0.26 * L, -P.hh * 0.4, cx, P.hh * 0.4, wnRamp('steel'), 1.6, P.hh * 0.36);
    wMetR(x, 0.28 * L, P.hh * 0.4, 0.48 * L, P.hh * 1.5, wnRamp('wood'), 1.6, P.hh * 0.5);
    wShine(x, 0.68 * L, 1.34 * L, Math.max(1, r * 0.7));
  };
  /* 连发冲锋铳: 长弹匣 + 枪托 + 上导轨 */
  WHEAD.smg = function (x, P, M, trim, ec) {
    var L = P.L, r = P.hh * 0.62;
    wMetR(x, 0.30 * L, -r, 1.06 * L, r, wnRamp('steel'), 1.8, r);
    wMetR(x, 0.16 * L, -r * 0.55, 1.04 * L, -r * 0.95, wnRamp('dark'), 1.3, r * 0.4);
    wMetR(x, 0.02 * L, -r * 0.6, 0.32 * L, r * 0.6, wnRamp('wood'), 1.6, r * 0.7);
    wMetR(x, 0.50 * L, r, 0.68 * L, r + 0.46 * L, wnRamp('dark'), 1.5, 0.16 * L);
    wMetR(x, 0.74 * L, r * 0.7, 0.90 * L, r * 0.7 + 0.26 * L, wnRamp('wood'), 1.4, 0.13 * L);
    wShine(x, 0.34 * L, 1.00 * L, Math.max(1, r * 0.4));
  };
  /* 长管狙击铳: 细长枪管 + 大瞄准镜 + 托 */
  WHEAD.rifle = function (x, P, M, trim, ec) {
    var L = P.L, xa = P.xa, xb = P.xb, r = P.hh * 0.9;
    wMetR(x, xa + 0.1 * L, -r, xb - 0.06 * L, r, wnRamp('steel'), 1.7, r);
    wTube(x, xb - 0.34 * L, xb, r * 0.62, wnRamp('dark'), 1.4);
    wMetR(x, xa, -r * 0.66, xa + 0.24 * L, r * 1.02, wnRamp('wood'), 1.5, r * 0.8);
    wMetR(x, xa + 0.36 * L, -r * 2.5, xa + 0.74 * L, -r * 1.1, wnRamp('dark'), 1.4, r * 0.7);
    wDot(x, xa + 0.72 * L, -r * 1.8, Math.max(1, r * 0.3), ec || wnRamp('steel')[0]);
    wGunGrip(x, xa + 0.44 * L, r * 0.7, r * 1.35, 0.32 * L, wnRamp('wood')[1]);
    wShine(x, xa + 0.18 * L, xb - 0.4 * L, Math.max(1, r * 0.36));
  };
  /* 双管猎铳: 上下双管 + 前护木 + 木托 */
  WHEAD.shotgun = function (x, P, M, trim) {
    var L = P.L, xa = P.xa, xb = P.xb, r = P.hh * 0.5, gap = P.hh * 1.16;
    wMetR(x, xa + 0.26 * L, -gap - r, xb, -gap + r, wnRamp('dark'), 1.6, r);
    wMetR(x, xa + 0.26 * L, gap - r, xb, gap + r, wnRamp('steel'), 1.6, r);
    wMetR(x, xa + 0.1 * L, -r * 2.1, xa + 0.44 * L, r * 2.1, wnRamp('wood'), 1.7, r * 1.8);
    wMetR(x, xa, -r * 1.5, xa + 0.16 * L, r * 1.7, wnRamp('wood'), 1.6, r * 1.5);
    wWedge(x, xb - 0.3 * L, xb - 0.02 * L, r * 2.2, r * 1.6, wnRamp('dark'), 1.2);
    wShine(x, xa + 0.3 * L, xb - 0.16 * L, Math.max(1, r * 0.6));
  };
  /* 多管速射铳: 三根粗管 + 弹箱 + 电机块 */
  WHEAD.minigun = function (x, P, M, trim, ec) {
    var L = P.L, xa = P.xa, xb = P.xb, r = P.hh * 0.34, i;
    for (i = -1; i <= 1; i++) wTube(x, xa + 0.4 * L, xb, r * 1.5, wnRamp(i ? 'dark' : 'steel'), 1.5);
    wMetR(x, xa + 0.14 * L, -P.hh * 0.72, xa + 0.56 * L, P.hh * 0.72, wnRamp('steel'), 1.8, P.hh * 0.7);
    wMetR(x, xa + 0.5 * L, -P.hh * 1.1, xb, P.hh * 1.1, wnRamp('dark'), 1.5, P.hh);
    wFillR(x, xa + 0.62 * L, P.hh * 0.9, xa + 0.94 * L, P.hh * 1.5, acc(wnRamp('brass')[1]), 1.4);
    wGunGrip(x, xa + 0.2 * L, P.hh * 0.6, r * 2.4, 0.34 * L, wnRamp('wood')[1]);
    wShine(x, xa + 0.2 * L, xa + 0.5 * L, Math.max(1, P.hh * 0.3));
  };
  /* 连珠机铳: 短管 + 垂下的弹链 + 摇柄 */
  WHEAD.chaingun = function (x, P, M, trim) {
    var L = P.L, xa = P.xa, xb = P.xb, r = P.hh * 0.9, i;
    wMetR(x, xa + 0.08 * L, -r, xb - 0.08 * L, r, wnRamp('steel'), 1.8, r);
    wTube(x, xb - 0.26 * L, xb, r * 1.2, wnRamp('dark'), 1.5);
    for (i = 0; i < 4; i++) {
      wFillR(x, xa + (0.5 + i * 0.08) * L, r * 0.8, xa + (0.545 + i * 0.08) * L, r * 0.8 + 0.2 * L,
        acc(i % 2 ? wnRamp('brass')[1] : wnRamp('dark')[1]), 1.2);
    }
    wDot(x, xa + 0.3 * L, -r * 1.2, Math.max(1.2, r * 0.4), wnRamp('brass')[1]);
    wGunGrip(x, xa + 0.16 * L, r * 0.6, r * 1.5, 0.36 * L, wnRamp('wood')[1]);
    wShine(x, xa + 0.12 * L, xb - 0.3 * L, Math.max(1, r * 0.4));
  };
  /* 多管光铳: 四根细管 + 两道环 + 光锥口 */
  WHEAD.rotary = function (x, P, M, trim, ec) {
    var L = P.L, xa = P.xa, xb = P.xb, r = P.hh * 0.2, i, c = ec || wnRamp('steel')[0];
    wMetR(x, xa + 0.06 * L, -P.hh * 0.8, xa + 0.5 * L, P.hh * 0.8, wnRamp('steel'), 1.8, P.hh * 0.8);
    for (i = -1; i <= 1; i++) wTube(x, xa + 0.46 * L, xb - 0.06 * L, r * 1.4, wnRamp(i ? 'dark' : 'steel'), 1.3);
    wMetR(x, xa + 0.72 * L, -P.hh, xa + 0.82 * L, P.hh, wnRamp('brass'), 1.4, P.hh);
    wMetR(x, xa + 0.9 * L, -P.hh, xa + 1.0 * L, P.hh, wnRamp('brass'), 1.4, P.hh);
    wDot(x, xb - 0.04 * L, 0, Math.max(1.1, P.hh * 0.34), c);
    wGunGrip(x, xa + 0.14 * L, P.hh * 0.7, r * 2.6, 0.32 * L, wnRamp('wood')[1]);
    wShine(x, xa + 0.1 * L, xa + 0.42 * L, Math.max(1, P.hh * 0.34));
  };
  /* 聚能光铳: 方机身 + 透镜环 + 前端聚能头 */
  WHEAD.laser = function (x, P, M, trim, ec) {
    var L = P.L, xa = P.xa, xb = P.xb, r = P.hh * 0.9, c = ec || wnRamp('steel')[0];
    wMetR(x, xa + 0.06 * L, -r, xa + 0.62 * L, r, wnRamp('steel'), 1.8, r);
    wTube(x, xa + 0.58 * L, xb - 0.1 * L, r * 0.9, wnRamp('dark'), 1.5);
    wDot(x, xb - 0.12 * L, 0, Math.max(1.3, r * 0.72), c);
    wDot(x, xa + 0.3 * L, 0, Math.max(1, r * 0.4), wnRamp('brass')[1]);
    wGunGrip(x, xa + 0.16 * L, r * 0.7, r * 1.5, 0.34 * L, wnRamp('wood')[1]);
    wShine(x, xa + 0.12 * L, xa + 0.5 * L, Math.max(1, r * 0.4));
  };
  /* 药剂注射铳: 药管 + 推杆 + 针头 */
  WHEAD.syringe = function (x, P, M, trim, ec) {
    var L = P.L, xa = P.xa, xb = P.xb, r = P.hh * 0.86, c = ec || wnRamp('steel')[1];
    wMetR(x, xa, -r * 0.5, xa + 0.16 * L, r * 0.5, wnRamp('brass'), 1.5, r * 0.6);
    wMetR(x, xa + 0.14 * L, -r, xa + 0.6 * L, r, wnRamp('steel'), 1.7, r);
    wFillR(x, xa + 0.2 * L, -r * 0.62, xa + 0.54 * L, r * 0.62, acc(c), 1.2);
    wMetR(x, xa + 0.58 * L, -r * 0.9, xa + 0.66 * L, r * 0.9, wnRamp('dark'), 1.4, r * 0.9);
    wTube(x, xa + 0.66 * L, xb, Math.max(0.9, r * 0.2), wnRamp('steel'), 1.2);
    wGunGrip(x, xa + 0.3 * L, r * 0.8, r * 1.4, 0.3 * L, wnRamp('wood')[1]);
    wShine(x, xa + 0.18 * L, xa + 0.52 * L, Math.max(1, r * 0.3));
  };
  /* 喷火罐: 背罐 + 软管 + 喷嘴 + 火舌 */
  WHEAD.flamer = function (x, P, M, trim, ec) {
    var L = P.L, xa = P.xa, xb = P.xb, r = P.hh * 0.78, c = ec || wnRamp('steel')[1];
    wnMetal(x, function () { circlePath(x, xa + 0.3 * L, -P.hh * 1.5, P.hh * 0.78); }, wnRamp('steel'), 1.6, P.hh * 0.8);
    wMetR(x, xa + 0.1 * L, -r, xa + 0.2 * L, r, wnRamp('dark'), 1.4, r);
    limb(x, xa + 0.3 * L, -P.hh * 0.8, xa + 0.62 * L, r * 0.4, 0.3, wnRamp('dark')[1], Math.max(1, r * 0.4));
    wTube(x, xa + 0.5 * L, xb, r * 1.1, wnRamp('steel'), 1.6);
    wFillP(x, [xb - 0.06 * L, -r * 0.5, xb + 0.22 * L, -r * 1.5, xb + 0.16 * L, 0,
      xb + 0.22 * L, r * 1.5, xb - 0.06 * L, r * 0.5], c, 1.3);
    wGunGrip(x, xa + 0.14 * L, r * 0.6, r * 1.8, 0.34 * L, wnRamp('wood')[1]);
    wShine(x, xa + 0.56 * L, xb - 0.12 * L, Math.max(1, r * 0.4));
  };
  /* 核籽重炮: 粗管 + 三道尾翼 + 环带 */
  WHEAD.mortar = function (x, P, M, trim, ec) {
    var L = P.L, xa = P.xa, xb = P.xb, r = P.hh * 0.86, i;
    wTube(x, xa + 0.14 * L, xb - 0.05 * L, r * 2, wnRamp('steel'), 1.9);
    for (i = 0; i < 3; i++) {
      wFillP(x, [xa + (0.18 + i * 0.16) * L, -r * 0.9, xa + (0.3 + i * 0.16) * L, -r * 2.0,
        xa + (0.42 + i * 0.16) * L, -r * 0.9], acc(i === 1 ? wnRamp('brass')[1] : wnRamp('dark')[1]), 1.2);
    }
    wMetR(x, xa + 0.62 * L, -r * 1.16, xa + 0.72 * L, r * 1.16, wnRamp('brass'), 1.4, r);
    wDot(x, xb - 0.08 * L, 0, Math.max(1.2, r * 0.6), ec || wnRamp('steel')[0]);
    wGunGrip(x, xa + 0.16 * L, r * 0.8, r * 1.6, 0.36 * L, wnRamp('wood')[1]);
    wShine(x, xa + 0.26 * L, xb - 0.24 * L, Math.max(1, r * 0.5));
  };
  /* 肩扛火箭筒: 粗管 + 火箭锥头 + 尾喷 */
  WHEAD.launcher = function (x, P, M, trim, ec) {
    var L = P.L, xa = P.xa, xb = P.xb, r = P.hh * 0.8;
    wTube(x, xa + 0.12 * L, xb - 0.26 * L, r * 1.9, wnRamp('steel'), 1.9);
    wFillP(x, [xb - 0.28 * L, -r * 0.95, xb - 0.02 * L, 0, xb - 0.28 * L, r * 0.95], acc(ec || wnRamp('steel')[0]), 1.5);
    wFillP(x, [xa + 0.06 * L, -r * 1.5, xa + 0.16 * L, -r * 0.7, xa, -r * 0.7], acc(wnRamp('dark')[1]), 1.2);
    wFillP(x, [xa + 0.06 * L, r * 1.5, xa + 0.16 * L, r * 0.7, xa, r * 0.7], acc(wnRamp('dark')[1]), 1.2);
    wGunGrip(x, xa + 0.34 * L, r * 0.9, r * 1.5, 0.36 * L, wnRamp('wood')[1]);
    wShine(x, xa + 0.2 * L, xb - 0.34 * L, Math.max(1, r * 0.5));
  };
  /* 电击棍: 短棍 + 双叉 + 电弧 */
  WHEAD.taser = function (x, P, M, trim, ec) {
    var L = P.L, xa = P.xa, xb = P.xb, r = P.hh * 0.9, c = ec || wnRamp('steel')[0], i;
    wMetR(x, xa + 0.06 * L, -r, xb - 0.3 * L, r, wnRamp('steel'), 1.7, r);
    for (i = -1; i <= 1; i += 2) wTube(x, xb - 0.34 * L, xb, r * 0.5, wnRamp('dark'), 1.3);
    x.beginPath();
    x.moveTo(xb - 0.3 * L, -r * 0.4); x.lineTo(xb - 0.16 * L, 0); x.lineTo(xb - 0.3 * L, r * 0.4);
    strokeC(x, c, Math.max(1.2, r * 0.3));
    wGunGrip(x, xa + 0.12 * L, r * 0.7, r * 1.6, 0.32 * L, wnRamp('wood')[1]);
    wShine(x, xa + 0.12 * L, xb - 0.38 * L, Math.max(1, r * 0.4));
  };
  /* 碎叶铳: 顶部漏斗 + 扇叶 + 机身 */
  WHEAD.shredder = function (x, P, M, trim, ec) {
    var L = P.L, xa = P.xa, xb = P.xb, r = P.hh * 0.9, i, a;
    wMetR(x, xa + 0.1 * L, -r, xb - 0.24 * L, r, wnRamp('steel'), 1.8, r);
    wFillP(x, [xa + 0.24 * L, -r, xa + 0.34 * L, -r * 2.6, xa + 0.78 * L, -r * 2.6, xa + 0.8 * L, -r], acc(wnRamp('dark')[1]), 1.6);
    for (i = 0; i < 4; i++) {
      a = i / 4 * TAU + 0.4;
      polyPath(x, [xb - 0.2 * L, 0, xb - 0.2 * L + Math.cos(a) * r * 1.5, Math.sin(a) * r * 1.5,
        xb - 0.2 * L + Math.cos(a + 0.5) * r * 0.7, Math.sin(a + 0.5) * r * 0.7]);
      fillC(x, acc(ec || wnRamp('steel')[1])); strokeC(x, WINK, 1.2);
    }
    wGunGrip(x, xa + 0.2 * L, r * 0.7, r * 1.7, 0.34 * L, wnRamp('wood')[1]);
    wShine(x, xa + 0.16 * L, xa + 0.6 * L, Math.max(1, r * 0.4));
  };
  /* 手弩: 弩臂 + 弦 + 已装填的箭 + 托 */
  WHEAD.crossbow = function (x, P, M, trim) {
    var L = P.L, xa = P.xa, xb = P.xb, hh = P.hh, i, s;
    wMetR(x, xa + 0.1 * L, -hh * 0.34, xb - 0.1 * L, hh * 0.34, wnRamp('wood'), 1.7, hh * 0.4);
    for (i = 0; i < 2; i++) {
      s = i ? 1 : -1;
      wnMetal(x, (function (sg) {
        return function () {
          x.beginPath();
          x.moveTo(xa + 0.42 * L, hh * 0.12 * sg);
          x.quadraticCurveTo(xa + 0.24 * L, hh * 0.9 * sg, xa + 0.06 * L, hh * 0.98 * sg);
          x.quadraticCurveTo(xa + 0.3 * L, hh * 0.44 * sg, xa + 0.42 * L, -hh * 0.1 * sg);
          x.closePath();
        };
      })(s), wnRamp('steel'), 1.4, hh * 0.5);
    }
    x.beginPath();
    x.moveTo(xa + 0.06 * L, -hh * 0.92); x.lineTo(xa + 0.42 * L, 0); x.lineTo(xa + 0.06 * L, hh * 0.92);
    strokeC(x, rgba(INK, 0.85), 1.2);
    wTube(x, xa + 0.3 * L, xb, Math.max(1, hh * 0.14), wnRamp('steel'), 1.2);
    wFillP(x, [xb, -hh * 0.26, xb + 0.12 * L, 0, xb, hh * 0.26], acc(wnRamp('dark')[1]), 1.1);
    limb(x, xa + 0.44 * L, hh * 0.36, xa + 0.2 * L, hh * 0.9, 0.2, wnRamp('dark')[1], Math.max(1, hh * 0.12));
    wShine(x, xa + 0.48 * L, xb - 0.2 * L, Math.max(0.9, hh * 0.12));
  };
  /* 螺丝刀: 细杆 + 扁嘴(手柄走通用柄) */
  WHEAD.driver = function (x, P, M, trim) {
    var L = P.L, hh = P.hh, x0 = 0.52 * L, x1 = 1.32 * L;
    wMetR(x, x0, -hh * 0.34, x1 - hh * 1.1, hh * 0.34, wnRamp('steel'), 1.4, hh * 0.4);
    wMetR(x, x1 - hh * 1.25, -hh * 1.3, x1, hh * 1.3, wnRamp('dark'), 1.3, hh);
    circlePath(x, x0 - hh * 1.15, 0, hh * 1.25); fillC(x, acc(wnRamp('brass')[1])); strokeC(x, WINK, 1.5);
    wShine(x, x0 + hh * 0.6, x1 - hh * 2.8, Math.max(0.8, hh * 0.22));
  };
  /* 长杆矛: 叶形矛头 + 两道缠绳(长杆走通用柄) */
  WHEAD.spear = function (x, P, M, trim) {
    var L = P.L, hx = P.hx, xb = P.xb, hh = P.hh, hl = P.hl;
    wMetR(x, P.xa, -hh * 0.18, hx + hl * 0.1, hh * 0.18, wnRamp('dark'), 1.4, hh * 0.3);
    wMetP(x, [hx, 0, hx + hl * 0.34, -hh * 1.15, xb - hl * 0.1, -hh * 0.7, xb, 0,
      xb - hl * 0.1, hh * 0.7, hx + hl * 0.34, hh * 1.15], wnRamp('steel'), 1.5, hh);
    wMetR(x, hx + hl * 0.14, -hh * 0.5, hx + hl * 0.24, hh * 0.5, wnRamp('brass'), 1.3, hh * 0.5);
    wShine(x, hx + hl * 0.36, xb - hl * 0.22, Math.max(0.9, hh * 0.3));
  };
  /* 冲阵长枪: 重锥头 + 护盘 + 枪旗 */
  WHEAD.lance = function (x, P, M, trim, ec) {
    var hx = P.hx, hl = P.hl, hh = P.hh, xb = P.xb;
    wMetP(x, [hx, -hh * 0.5, xb - hl * 0.3, -hh * 0.62, xb, 0, xb - hl * 0.3, hh * 0.62, hx, hh * 0.5], wnRamp('steel'), 1.5, hh * 0.6);
    wDot(x, hx + 0.06 * P.L, 0, Math.max(1.6, hh * 1.5), wnRamp('brass')[1]);
    wFillP(x, [hx + 0.14 * P.L, -hh * 0.8, hx + 0.52 * P.L, -hh * 0.4, hx + 0.44 * P.L, -hh * 2.4], acc(ec || wnRamp('brass')[1]), 1.3);
    wShine(x, hx + hl * 0.4, xb - hl * 0.28, Math.max(1, hh * 0.3));
  };
  /* 圆盘锯: 齿盘 + 轴心(手柄走通用柄) */
  WHEAD.saw = function (x, P, M, trim) {
    var hx = P.hx, hl = P.hl, hh = P.hh, cx = hx + hl * 0.55, r = hh;
    wnSpikes(x, cx, 0, r * 0.88, r * 1.42, 14, wnRamp('steel')[1], 0.22);
    wnMetal(x, function () { circlePath(x, cx, 0, r * 0.88); }, wnRamp('steel'), 1.9, r);
    wnMetal(x, function () { circlePath(x, cx, 0, r * 0.3); }, wnRamp('dark'), 1.4, r * 0.4);
    wShine(x, cx - r * 0.5, cx - r * 0.1, Math.max(1, r * 0.2));
  };  /** 刃: 直刃 + 护手. s1 = 背厚(0 细剑…1 厚背刀), s2 = 尖(0 平头…1 针尖) */
  WHEAD.blade = function (x, P, M, trim) {
    var hx = P.hx, hl = P.hl, hh = P.hh, xb = P.xb, s1 = clamp(P.s1, 0, 1), s2 = clamp(P.s2, 0, 1);
    var sp = hh * (0.30 + 0.52 * s1), tp = hh * (1 - 0.72 * s2), mid = hx + hl * 0.74;
    wMetP(x, [hx, -sp, mid, -sp * 1.05, xb, -tp * 0.42, xb, tp * 0.42, mid, sp * 0.9, hx, sp * 0.58], wnRamp('steel'), 1.35, hh);
    x.strokeStyle = WN.steel[2]; x.lineWidth = Math.max(0.9, hh * 0.14);
    x.beginPath(); x.moveTo(hx + hl * 0.1, -hh * 0.13); x.lineTo(hx + hl * 0.66, -hh * 0.13); x.stroke();
    wMetR(x, hx - 0.07 * P.L, -hh * 1.45, hx + 0.02 * P.L, hh * 1.45, wnRamp('brass'), 1.4, hh * 1.5);
    x.fillStyle = wnSpec(0.45); x.fillRect(hx + hl * 0.16, -sp * 0.6, hl * 0.46, Math.max(0.9, hh * 0.13));
  };
  /** 牙: 外弯的锥形牙刃(短匕 / 尖牙) —— s1 弯度, s2 弧向 */
  WHEAD.fang = function (x, P, M, trim) {
    var hx = P.hx, hl = P.hl, hh = P.hh, c = clamp(P.s1, 0, 1) * hh * 1.5, s2 = P.s2 >= 0.5 ? 1 : -1;
    wnMetal(x, function () {
      x.beginPath();
      x.moveTo(hx, -hh * 0.72);
      x.quadraticCurveTo(hx + hl * 0.72, -hh * 0.5 - c * s2, hx + hl, hh * 0.8 * s2);
      x.quadraticCurveTo(hx + hl * 0.5, hh * 0.3 * s2 - c * 0.4, hx, hh * 0.72);
      x.closePath();
    }, wnRamp('steel'), 1.35, hh);
    x.fillStyle = wnSpec(0.4); x.fillRect(hx + hl * 0.18, -hh * 0.26, hl * 0.42, Math.max(0.9, hh * 0.15));
    wMetR(x, hx - 0.08 * P.L, -hh * 1.2, hx, hh * 1.2, wnRamp('brass'), 1.3, hh);
  };
  /** 钩: 月牙钩头(修枝镰) —— s1 钩深 */
  WHEAD.hook = function (x, P, M, trim) {
    var L = P.L, hh = P.hh, hx = P.hx, xb = P.xb;
    wMetR(x, P.xa, -hh * 0.2, hx + 0.06 * L, hh * 0.2, wnRamp('dark'), 1.4, hh * 0.3);
    wnMetal(x, function () {
      x.beginPath();
      x.moveTo(hx, -hh * 0.55);
      x.quadraticCurveTo(xb - 0.02 * L, -hh * 1.35, xb, hh * 0.5);
      x.quadraticCurveTo(xb - 0.34 * L, hh * 0.62, hx + 0.06 * L, hh * 0.3);
      x.closePath();
    }, wnRamp('steel'), 1.5, hh);
    wMetR(x, hx + 0.02 * L, -hh * 0.36, hx + 0.12 * L, hh * 0.36, wnRamp('brass'), 1.3, hh * 0.4);
    wShine(x, hx + 0.08 * L, xb - 0.12 * L, Math.max(0.9, hh * 0.26));
  };
  /** 镰: 长柄 + 横出的大月牙刃(收割长镰) —— s1 弯深, s2 刃根厚度 */
  WHEAD.scythe = function (x, P, M, trim) {
    var hx = P.hx, hl = P.hl, hh = P.hh, xb = P.xb, c = clamp(P.s1, 0, 1), r = clamp(P.s2, 0.2, 1);
    wnMetal(x, function () {
      x.beginPath();
      x.moveTo(hx, -hh * 0.1);
      x.quadraticCurveTo(hx + (xb - hx) * 0.3, -hh * (1.0 - 0.2 * c), xb, -hh * 0.34 * r);
      x.quadraticCurveTo(hx + (xb - hx) * 0.55, -hh * 0.34, hx, hh * 0.06);
      x.closePath();
    }, wnRamp('steel'), 1.9, hh * 0.6);
    x.fillStyle = wnSpec(0.4); x.fillRect(hx + hl * 0.05, -hh * 0.42, hl * 0.34, Math.max(0.9, hh * 0.12));
    wMetR(x, hx - 0.05 * P.L, -hh * 0.2, hx + 0.03 * P.L, hh * 0.2, wnRamp('brass'), 1.3, hh * 0.3);
  };
  /** 剪: 两片交错刃 + 转轴销 + 一对指环(园圃剪刀) —— s1 张口 */
  WHEAD.shears = function (x, P, M, trim) {
    var hx = P.hx, hl = P.hl, hh = P.hh, L = P.L, sp = hh * (0.35 + 0.65 * clamp(P.s1, 0, 1));
    wMetP(x, [hx, -sp, hx + hl * 0.9, -hh * 0.1, hx + hl, hh * 0.16, hx + hl * 0.86, hh * 0.34], wnRamp('steel'), 1.5, hh * 0.5);
    wMetP(x, [hx, sp, hx + hl * 0.9, hh * 0.1, hx + hl, -hh * 0.16, hx + hl * 0.86, -hh * 0.34], wnRamp('steel'), 1.5, hh * 0.5);
    wDot(x, hx + hl * 0.84, 0, Math.max(1.3, hh * 0.16), trim);
    circlePath(x, hx - 0.06 * L, -hh * 0.62, Math.max(1.6, hh * 0.3)); fillC(x, acc('#4a6b52')); strokeC(x, WINK, 1.2);
    circlePath(x, hx - 0.06 * L, hh * 0.62, Math.max(1.6, hh * 0.3)); fillC(x, acc('#4a6b52')); strokeC(x, WINK, 1.2);
  };
  /** 斧: 楔形斧头. s1 = 1 单刃(刃在上) / 0 双刃 / -1 单刃(刃在下), s2 刃口弧 */
  WHEAD.axe = function (x, P, M, trim) {
    var hx = P.hx, hl = P.hl, hh = P.hh, L = P.L, side = clamp(P.s1, -1, 1), c = clamp(P.s2, 0, 1);
    var ex = hx + hl * 0.18;
    wMetR(x, hx, -hh * 0.3, ex + hl * 0.08, hh * 0.3, wnRamp('dark'), 1.6, hh * 0.4);
    if (side >= 0) {
      wnMetal(x, function () {
        x.beginPath();
        x.moveTo(ex, -hh * 0.22);
        x.quadraticCurveTo(hx + hl * (0.58 + 0.16 * c), -hh * 1.02, hx + hl * 0.98, -hh * 0.5);
        x.quadraticCurveTo(hx + hl * 1.0, -hh * 0.02, hx + hl * 0.78, hh * 0.34);
        x.quadraticCurveTo(ex + hl * 0.18, hh * 0.2, ex, hh * 0.22);
        x.closePath();
      }, wnRamp('steel'), 1.9, hh * 0.8);
    }
    if (side <= 0) {
      wnMetal(x, function () {
        x.beginPath();
        x.moveTo(ex, hh * 0.22);
        x.quadraticCurveTo(hx + hl * (0.56 + 0.16 * c), hh * 1.02, hx + hl * 0.96, hh * 0.5);
        x.quadraticCurveTo(hx + hl * 0.98, hh * 0.02, hx + hl * 0.76, -hh * 0.34);
        x.quadraticCurveTo(ex + hl * 0.18, -hh * 0.2, ex, -hh * 0.22);
        x.closePath();
      }, wnRamp('steel'), 1.9, hh * 0.8);
    }
    x.fillStyle = wnSpec(0.42); x.fillRect(hx + hl * 0.22, -hh * 0.46, hl * 0.28, Math.max(1, hh * 0.12));
  };
  /** 方块锤 / 重槌: 方头 + 端面 + 钉(s1 ≥ 1 时是钉数) */
  WHEAD.block = function (x, P, M, trim, ec) {
    var hx = P.hx, hl = P.hl, hh = P.hh, n = P.s1 | 0;
    wMetR(x, hx, -hh, hx + hl, hh, wnRamp('steel'), 2, hh * 0.9);
    wMetR(x, hx + hl * 0.8, -hh * 1.06, hx + hl, hh * 1.06, wnRamp('dark'), 1.5, hh);
    if (n > 0) wnSpikes(x, hx + hl * 0.48, 0, hh * 0.72, hh * (1.15 + 0.3 * clamp(P.s2, 0, 1)), Math.min(9, n), WN.steel[1], -Math.PI / 4);
    x.fillStyle = wnSpec(0.4); x.fillRect(hx + hl * 0.08, -hh * 0.7, hl * 0.62, Math.max(1, hh * 0.14));
  };
  /** 开口钳头(长柄扳手) —— s1 开口大小 */
  WHEAD.jaw = function (x, P, M, trim) {
    var hx = P.hx, hl = P.hl, hh = P.hh, g = clamp(P.s1, 0.15, 0.9);
    wMetR(x, hx, -hh * 0.5, hx + hl * 0.6, hh * 0.5, wnRamp('steel'), 1.8, hh * 0.6);
    wMetP(x, [hx + hl * 0.5, -hh, hx + hl, -hh, hx + hl, -hh * g, hx + hl * 0.66, -hh * g * 0.92,
      hx + hl * 0.66, hh * g * 0.92, hx + hl, hh * g, hx + hl, hh, hx + hl * 0.5, hh], wnRamp('steel'), 1.7, hh * 0.8);
    x.fillStyle = wnSpec(0.35); x.fillRect(hx + hl * 0.08, -hh * 0.32, hl * 0.36, Math.max(0.9, hh * 0.14));
  };
  /** 犁刀: 宽三角刃片 + 两枚下伸犁齿(破土犁刀) —— s1 齿长 */
  WHEAD.plow = function (x, P, M, trim) {
    var hx = P.hx, hl = P.hl, hh = P.hh, L = P.L, c = clamp(P.s1, 0, 1), i, tw = hl / 3.2;
    wnMetal(x, function () { wnPoly(x, [hx, -hh * 0.46, hx + hl, -hh, hx + hl, hh, hx, hh * 0.46]); }, wnRamp('steel'), 1.9, hh * 0.9);
    x.fillStyle = WN.steel[2]; x.fillRect(hx + hl * 0.14, -hh * 0.1, hl * 0.72, Math.max(1, hh * 0.14));
    for (i = 0; i < 3; i++) {
      var t0 = hx + hl * (0.12 + i * 0.28);
      wMetP(x, [t0, hh * 0.62, t0 + tw * 0.55, hh * (1.05 + 0.5 * c), t0 + tw * 0.8, hh * 0.62], wnRamp('dark'), 1.2, hh * 0.5);
    }
    x.fillStyle = trim; x.fillRect(hx - 0.05 * L, -hh * 0.6, 0.05 * L, hh * 1.2);
  };
  /** 粗木棒: 越往端越粗 + 木节(枯枝棍 / 短棍) —— s1 木节数, s2 歪斜 */
  WHEAD.club = function (x, P, M, trim) {
    var hx = P.hx, hl = P.hl, hh = P.hh, n = clamp(P.s1, 0, 1), i, cw = hh;
    wnMetal(x, function () {
      wnPoly(x, [hx, -cw * 0.52, hx + hl * 0.68, -cw * (0.95 + 0.15 * n), hx + hl, -cw * 0.6,
        hx + hl, cw * 0.6, hx + hl * 0.68, cw * (0.95 + 0.15 * n), hx, cw * 0.52]);
    }, wnRamp('wood'), 1.9, cw);
    x.fillStyle = WN.wood[2];
    for (i = 0; i < 3; i++) { circlePath(x, hx + hl * (0.22 + i * 0.26), (i % 2 ? -1 : 1) * cw * (0.3 + 0.25 * n), Math.max(0.9, cw * 0.16)); x.fill(); }
    x.fillStyle = wnSpec(0.25); x.fillRect(hx + hl * 0.14, -cw * 0.5, hl * 0.6, Math.max(0.9, cw * 0.14));
  };
  /** 刺球 / 狼牙棒: 球 + 放射尖刺 —— s1 刺数, s2 刺长 */
  WHEAD.ball = function (x, P, M, trim) {
    var cx = P.hx + P.hh * 0.9, r = P.hh * 0.9, n = P.s1 | 0;
    wnMetal(x, function () { circlePath(x, cx, 0, r); }, wnRamp('dark'), 2, r);
    if (n > 0) wnSpikes(x, cx, 0, r * 0.86, r * (1.16 + 0.75 * clamp(P.s2, 0, 1)), n, WN.steel[1], 0.25);
    x.fillStyle = wnSpec(0.4); circlePath(x, cx - r * 0.3, -r * 0.34, Math.max(0.9, r * 0.22)); x.fill();
  };
  /** 石块 / 燧石: 不规则棱块(尺寸由 hl/hh 给, 形状由 s1 定死 ⇒ 每次开局一样) */
  WHEAD.chunk = function (x, P, M, trim) {
    var hx = P.hx, hl = P.hl, hh = P.hh, s = P.s1, pts = [], i, a, rr;
    for (i = 0; i < 8; i++) {
      a = i / 8 * TAU;
      rr = 0.58 + 0.42 * Math.abs(Math.sin(s * 17.3 + i * 2.1));
      pts.push(hx + hl * 0.5 + Math.cos(a) * hl * 0.5, Math.sin(a) * hh * rr);
    }
    wnMetal(x, function () { polyPath(x, pts); }, wnRamp('dark'), 1.9, hh * 0.8);
    x.strokeStyle = wnSpec(0.3); x.lineWidth = 1.2;
    x.beginPath(); x.moveTo(hx + hl * 0.22, -hh * 0.5); x.lineTo(hx + hl * 0.52, 0); x.lineTo(hx + hl * 0.88, -hh * 0.18); x.stroke();
  };
  /** 火舌: 布团 + 平涂火苗 + 焰心(不发光; 焰心是这把唯一的高光) —— s1 火高, s2 火宽 */
  WHEAD.flame = function (x, P, M, trim, ec) {
    var L = P.L, hh = P.hh, hx = P.hx, xb = P.xb, c = ec || wnRamp('orange')[1];
    wMetR(x, P.xa, -hh * 0.22, hx + 0.1 * L, hh * 0.22, wnRamp('wood'), 1.5, hh * 0.3);
    wMetR(x, hx + 0.02 * L, -hh * 0.5, hx + 0.16 * L, hh * 0.5, wnRamp('dark'), 1.4, hh * 0.4);
    wFillP(x, [hx + 0.1 * L, hh * 0.5, hx + 0.05 * L, -hh * 1.5, hx + 0.34 * L, -hh * 2.2,
      xb, -hh * 1.0, xb - 0.06 * L, hh * 0.35, hx + 0.34 * L, hh * 0.7], c, 1.6);
    wDot(x, xb - 0.16 * L, -hh * 1.0, Math.max(1.1, hh * 0.5), wnRamp('yellow')[0]);
    wShine(x, hx + 0.14 * L, hx + 0.4 * L, Math.max(0.9, hh * 0.2));
  };
  /** 拳件: s1 = 0 拳套 / 1 铁砂掌(张掌) / 2 机械重拳 / 3 指虎 */
  WHEAD.fist = function (x, P, M, trim, ec) {
    var L = P.L, xb = P.xb, hh = P.hh, st = P.s1 | 0, i, x0 = P.hx, hx0;
    if (st === 1) {                                   /* 张掌: 掌心 + 四指并排前伸 */
      var fw = Math.max(1.6, hh * 0.52), fl = (xb - x0) * 0.62;
      wMetR(x, x0, -hh, xb - fl * 0.4, hh, wnRamp('steel'), 1.8, hh * 0.6);
      for (i = 0; i < 4; i++) wMetR(x, xb - fl, -hh + i * (hh * 1.9 / 4) + hh * 0.06, xb - (i % 2 ? 0 : fl * 0.16), -hh + i * (hh * 1.9 / 4) + hh * 0.06 + fw, wnRamp('steel'), 1.4, hh * 0.3);
      wMetR(x, P.xa, -hh * 0.75, x0 + 0.06 * L, hh * 0.75, wnRamp('wood'), 1.6, hh * 0.5);
    } else if (st === 2) {                            /* 机械重拳: 大方块 + 螺帽 + 腕箍 */
      wMetR(x, x0, -hh, xb, hh, wnRamp('steel'), 2, hh * 0.7);
      x.fillStyle = WN.steel[2]; x.fillRect(x0 + (xb - x0) * 0.12, -hh * 0.42, (xb - x0) * 0.6, Math.max(1.2, hh * 0.2));
      for (i = 0; i < 3; i++) wDot(x, x0 + (xb - x0) * (0.2 + i * 0.28), hh * 0.62, Math.max(0.9, hh * 0.13), WN.brass[1]);
      wMetR(x, P.xa, -hh * 0.92, x0 + 0.08 * L, hh * 0.92, wnRamp('dark'), 1.7, hh * 0.6);
      x.fillStyle = trim; x.fillRect(x0 - 0.02 * L, -hh * 0.92, 0.05 * L, hh * 1.84);
    } else if (st === 3) {                            /* 指虎: 横杆 + 四枚尖刺 + 指孔 */
      wMetR(x, x0, -hh * 0.5, xb, hh * 0.5, wnRamp('steel'), 1.6, hh * 0.4);
      wnSpikes(x, x0 + (xb - x0) * 0.5, -hh * 0.2, hh * 0.3, hh * (0.9 + 0.5 * clamp(P.s2, 0, 1)), 4, WN.steel[0], -Math.PI / 2);
      for (i = 0; i < 3; i++) { circlePath(x, x0 + (xb - x0) * (0.28 + i * 0.22), hh * 0.75, Math.max(1.1, hh * 0.24)); fillC(x, acc(mix(WN.dark[2], WN.steel[2], 0.5))); strokeC(x, WINK, 1.1); }
      x.strokeStyle = acc(ec || '#ff8a3c'); x.lineWidth = 1.6;
      x.beginPath(); x.moveTo(x0, hh * 0.5); x.lineTo(xb, hh * 0.5); x.stroke();
    } else {                                          /* 拳套: 团起的拳 + 四指节 + 腕箍 */
      wMetR(x, x0, -hh, xb - (xb - x0) * 0.1, hh, wnRamp('steel'), 1.9, hh * 0.6);
      for (i = 0; i < 4; i++) wMetR(x, x0 + (xb - x0) * (0.16 + i * 0.2), -hh * 1.16, x0 + (xb - x0) * (0.3 + i * 0.2), -hh * 0.42, wnRamp('steel'), 1.4, hh * 0.35);
      wMetR(x, P.xa, -hh * 0.86, x0 + 0.08 * L, hh * 0.86, wnRamp('dark'), 1.7, hh * 0.6);
      x.fillStyle = trim; x.fillRect(x0 - 0.02 * L, -hh * 0.86, 0.05 * L, hh * 1.72);
    }
  };
  /** 耙 / 爪: n 枚前伸弯齿 —— s1 齿数, s2 弯度 */
  WHEAD.prongs = function (x, P, M, trim) {
    var hx = P.hx, hl = P.hl, hh = P.hh, L = P.L, n = clamp(P.s1 | 0, 2, 5), c = clamp(P.s2, 0, 1), i, yy;
    wMetR(x, hx - 0.07 * L, -hh * 0.4, hx + hl * 0.16, hh * 0.4, wnRamp('dark'), 1.6, hh * 0.4);
    for (i = 0; i < n; i++) {
      yy = (i - (n - 1) / 2) * (hh * 1.5 / Math.max(1, n - 1));
      wnMetal(x, (function (k) {
        return function () {
          x.beginPath();
          x.moveTo(hx + hl * 0.12, k - hh * 0.13);
          x.quadraticCurveTo(hx + hl * (0.55 + 0.35 * c), k * 1.2, hx + hl, k * 1.08);
          x.quadraticCurveTo(hx + hl * 0.5, k * 0.5, hx + hl * 0.12, k + hh * 0.13);
          x.closePath();
        };
      })(yy), wnRamp('steel'), 1.4, hh * 0.4);
    }
    x.fillStyle = trim; x.fillRect(hx - 0.09 * L, -hh * 0.46, 0.05 * L, hh * 0.92);
  };
  /** 法球: 托座 + 一颗圆球(s1 = 球半径) —— 芽木法杖 / 幽光权杖 / 爆炎弹 */
  WHEAD.orb = function (x, P, M, trim, ec) {
    var hx = P.hx, hl = P.hl, hh = P.hh, L = P.L, r = Math.max(0.05 * L, clamp(P.s1, 0.04, 0.7) * L), cx = hx + hl * 0.52;
    wMetP(x, [hx, -hh * 0.26, cx - r * 0.35, -hh * 0.32, cx - r * 0.35, hh * 0.32, hx, hh * 0.26], wnRamp('brass'), 1.4, hh * 0.4);
    wDot(x, cx, 0, r, ec || '#8fd66b');
    x.fillStyle = wnSpec(0.55); circlePath(x, cx - r * 0.32, -r * 0.36, Math.max(0.9, r * 0.26)); x.fill();
  };
  /** 飞叶镖: 四叶风车 + 中心销(s1 叶数) */
  WHEAD.shuriken = function (x, P, M, trim) {
    var r = P.hh, n = clamp(P.s1 | 0, 3, 6), i, a0;
    for (i = 0; i < n; i++) {
      a0 = i / n * TAU + 0.2;
      wnMetal(x, (function (k) {
        return function () {
          x.beginPath();
          x.moveTo(Math.cos(k) * r * 0.24, Math.sin(k) * r * 0.24);
          x.lineTo(Math.cos(k + 0.6) * r * 1.98, Math.sin(k + 0.6) * r * 1.98);
          x.lineTo(Math.cos(k + 1.0) * r * 0.46, Math.sin(k + 1.0) * r * 0.46);
          x.closePath();
        };
      })(a0), wnRamp('steel'), 1.4, r * 0.5);
    }
    wDot(x, 0, 0, Math.max(1.2, r * 0.22), trim);
  };
  /** 圆盘: 盘 + 齿/刺(s1 数, s2 长度) —— 尖刺圆盾 / 圆盘锯 */
  WHEAD.disc = function (x, P, M, trim) {
    var cx = P.hx + P.hh * 0.86, r = P.hh * 0.86, n = P.s1 | 0;
    if (n > 0) wnSpikes(x, cx, 0, r * 0.94, r * (1 + 0.5 * clamp(P.s2, 0, 1)), n, WN.steel[0], 0.1);
    wnMetal(x, function () { circlePath(x, cx, 0, r); }, wnRamp('steel'), 1.9, r * 0.7);
    circlePath(x, cx, 0, r * 0.34); fillC(x, acc(trim)); strokeC(x, WINK, 1.3);
    x.fillStyle = wnSpec(0.4); circlePath(x, cx - r * 0.3, -r * 0.34, Math.max(0.9, r * 0.2)); x.fill();
  };
  /** 木叉: Y 形 + 皮筋(藤皮弹弓) —— s1 叉宽, s2 叉臂长 */
  WHEAD.yoke = function (x, P, M, trim) {
    var hx = P.hx, hl = P.hl, hh = P.hh, L = P.L, sp = hh * (0.6 + 0.7 * clamp(P.s1, 0, 1)), al = hl * (0.5 + 0.5 * clamp(P.s2, 0, 1));
    wMetP(x, [hx, -P.sh * 0.55, hx + al, -sp, hx + al + hl * 0.14, -sp * 0.86, hx + hl * 0.1, -P.sh * 0.2], wnRamp('wood'), 1.5, sp * 0.6);
    wMetP(x, [hx, P.sh * 0.55, hx + al, sp, hx + al + hl * 0.14, sp * 0.86, hx + hl * 0.1, P.sh * 0.2], wnRamp('wood'), 1.5, sp * 0.6);
    x.strokeStyle = acc('#e8dcc0'); x.lineWidth = Math.max(1.1, P.sh * 0.5);
    x.beginPath(); x.moveTo(hx + al, -sp * 0.94); x.lineTo(hx + hl * 0.62, 0); x.lineTo(hx + al, sp * 0.94); x.stroke();
    x.fillStyle = acc('#7e5c31'); x.fillRect(hx + hl * 0.55, -P.sh * 0.62, P.sh * 0.9, P.sh * 1.24);
  };
  /** 钻: 一叠收窄的方台(穿心钻) —— s1 段数, s2 螺旋线 */
  WHEAD.drill = function (x, P, M, trim) {
    var hx = P.hx, hl = P.hl, hh = P.hh, n = clamp(P.s1 * 10 | 0, 3, 7), i;
    for (i = 0; i < n; i++) {
      var x0 = hx + i * hl / n, w0 = hh * (1 - i / n * 0.86), x1 = x0 + hl / n * 1.18, w1 = hh * (1 - (i + 1) / n * 0.86);
      wnMetal(x, (function (a, b, c, d) { return function () { wnPoly(x, [a, -b, c, -d, c, d, a, b]); }; })(x0, w0, x1, w1),
        wnRamp(i % 2 ? 'steel' : 'dark'), 1.3, hh * 0.5);
    }
  };
  /** 铳: 机匣 + 斜握把 + n 根枪管(s1 管数, s2 握把斜度, s3 管簇样式 0 并列/1 环形) */
  WHEAD.gun = function (x, P, M, trim, ec) {
    var L = P.L, xa = P.xa, xb = P.xb, sh = P.sh, hx = P.hx;
    var n = clamp(P.s1 | 0, 1, 6), sp = P.hh, br = n > 1 ? Math.max(0.8, P.hh * 0.36) : Math.max(1.1, P.hh);
    var lean = clamp(P.s2, 0.1, 0.8), gr = sh * (1.9 + 0.7 * lean), i, yy;
    wMetR(x, xa, -sh, hx, sh, wnRamp('dark'), 1.8, sh);
    wFillP(x, [xa + sh * 0.2, sh * 0.6, xa + sh * 1.4, sh * 0.6, xa + sh * 1.4 + gr * lean, sh * 0.6 + gr,
      xa + sh * 0.2 + gr * lean * 0.5, sh * 0.6 + gr], mix(WN.dark[1], WN.wood[2], 0.45), 1.5);
    for (i = 0; i < n; i++) {
      if (n === 1) yy = 0;
      else if (P.s3 >= 0.5 && n > 2) yy = Math.sin(i / n * TAU) * sp;          /* 环形(加特林) */
      else yy = (i - (n - 1) / 2) * (sp * 2 / Math.max(1, n - 1));             /* 并列(双管) */
      wnMetal(x, (function (k) { return function () { wnRect(x, hx - 0.02 * L, k - br, xb, k + br); }; })(yy), wnRamp('steel'), 1.5, Math.max(sh, Math.abs(yy) + br));
    }
    if (n > 2) wMetR(x, hx + (xb - hx) * 0.16, -sp - br * 1.2, hx + (xb - hx) * 0.34, sp + br * 1.2, wnRamp('dark'), 1.5, sp + br);
    wnMetal(x, function () { wnRect(x, xa - 0.02 * L, -sh * 1.1, xa + sh * 0.5, sh * 1.1); }, wnRamp('brass'), 1.3, sh);
    if (ec) { x.strokeStyle = acc(ec); x.lineWidth = 1.5; x.beginPath(); x.moveTo(hx + (xb - hx) * 0.4, -br * 0.4); x.lineTo(xb, -br * 0.4); x.stroke(); }
  };
  /** 光炮: 粗管 + 喇叭口(湮灭光炮) —— s1 喇叭张角 */
  WHEAD.railgun = function (x, P, M, trim, ec) {
    var L = P.L, hh = P.hh, hx = P.hx, xb = P.xb, i;
    wMetR(x, P.xa, -hh * 0.42, hx + 0.1 * L, hh * 0.42, wnRamp('dark'), 1.8, hh * 0.45);
    wMetR(x, hx, -hh, xb - 0.16 * L, hh, wnRamp('steel'), 1.8, hh);
    for (i = 0; i < 3; i++) wMetR(x, hx + (0.1 + i * 0.24) * L, -hh * 1.2, hx + (0.16 + i * 0.24) * L, hh * 1.2, wnRamp('brass'), 1.3, hh);
    wMetP(x, [xb - 0.18 * L, -hh * 2.0, xb, -hh * 2.0, xb, hh * 2.0, xb - 0.18 * L, hh * 2.0], wnRamp('steel'), 1.7, hh * 1.8);
    if (ec) wDot(x, xb - 0.24 * L, 0, Math.max(1.1, hh * 0.4), ec);
    wShine(x, hx + 0.06 * L, xb - 0.24 * L, Math.max(0.9, hh * 0.2));
  };
  /** 筒: 发射筒 + 尾环(肩扛火箭筒 / 核籽重炮) —— s1 筒径, s2 (备用) */
  WHEAD.tankgun = function (x, P, M, trim, ec) {
    var L = P.L, xa = P.xa, xb = P.xb, sh = P.sh, hx = P.hx, hh = P.hh, i;
    wMetR(x, xa, -sh, hx * 0.5, sh, wnRamp('dark'), 1.8, sh);
    wMetR(x, hx * 0.4, -hh, xb, hh, wnRamp('steel'), 1.8, hh);
    for (i = 0; i < 2; i++) wMetR(x, xb - (xb - hx) * (0.3 + i * 0.16), -hh * 1.12, xb - (xb - hx) * (0.24 + i * 0.16), hh * 1.12, wnRamp('brass'), 1.4, hh * 0.8);
    wnMetal(x, function () { wnPoly(x, [xb, -hh, xb + (xb - hx) * 0.06, -hh * 1.3, xb + (xb - hx) * 0.06, hh * 1.3, xb, hh]); }, wnRamp('steel'), 1.6, hh * 1.2);
    wFillP(x, [xa + sh * 0.3, sh * 0.5, xa + sh * 2.0, sh * 0.5, xa + sh * 2.0 + sh * 1.5, sh * 0.5 + sh * 2.3, xa + sh * 0.3 + sh * 0.8, sh * 0.5 + sh * 2.3], mix(WN.dark[1], WN.wood[2], 0.45), 1.5);
    if (ec) { x.strokeStyle = acc(ec); x.lineWidth = 1.6; x.beginPath(); x.moveTo(hx * 0.5, -hh * 0.5); x.lineTo(xb, -hh * 0.5); x.stroke(); }
  };
  /** 线圈炮: 长轨 + 三环线圈(粒子加速炮) —— s1 环数 */
  WHEAD.coil = function (x, P, M, trim, ec) {
    var L = P.L, hh = P.hh, n = clamp(P.s1 | 0, 3, 5), i, cx;
    wMetR(x, P.xa, -hh * 0.2, P.xb, hh * 0.2, wnRamp('dark'), 1.5, hh * 0.3);
    for (i = 0; i < n; i++) {
      cx = P.xa + (P.xb - P.xa) * (0.16 + i * (0.68 / Math.max(1, n - 1)));
      wnMetal(x, (function (q) {
        return function () { circlePath(x, q, 0, hh); };
      })(cx), i % 2 ? wnRamp('dark') : wnRamp('steel'), 1.7, hh);
      wDot(x, cx, 0, Math.max(1, hh * 0.26), ec || wnRamp('brass')[1]);
    }
    wShine(x, P.xa + 0.06 * L, P.xa + 0.34 * L, Math.max(0.9, hh * 0.24));
  };
  /** 弩: 弩臂 + 弦 + 托(手弩) —— s1 臂张角, s2 臂厚 */
  WHEAD.bow = function (x, P, M, trim, ec) {
    var L = P.L, xa = P.xa, xb = P.xb, sh = P.sh, hh = P.hh, bx = xa + (xb - xa) * 0.46, i;
    wMetR(x, xa, -sh * 0.6, bx + (xb - xa) * 0.3, sh * 0.6, wnRamp('wood'), 1.7, sh * 0.7);
    x.strokeStyle = acc(trim); x.lineWidth = Math.max(2.2, sh * 0.9); x.lineCap = 'round';
    x.beginPath(); x.moveTo(bx, -hh * (0.8 + 0.4 * clamp(P.s1, 0, 1))); x.quadraticCurveTo(bx + (xb - bx) * 0.5, 0, bx, hh * (0.8 + 0.4 * clamp(P.s1, 0, 1))); x.stroke();
    x.strokeStyle = acc('#efe6cc'); x.lineWidth = Math.max(1, sh * 0.28);
    x.beginPath(); x.moveTo(bx, -hh * 1.15); x.lineTo(bx + (xb - bx) * 0.72, 0); x.lineTo(bx, hh * 1.15); x.stroke();
    wMetR(x, bx - (xb - xa) * 0.1, -sh * 0.3, xb, sh * 0.3, wnRamp('steel'), 1.5, sh * 0.4);
  };
  /** 投筒: 机匣 + 顶部料斗(肩扛投筒) —— s1 斗高, s2 口斜度 */
  WHEAD.hopper = function (x, P, M, trim, ec) {
    var L = P.L, hh = P.hh, xa = P.xa, xb = P.xb;
    wMetR(x, xa, -hh * 0.5, xb - 0.18 * L, hh * 0.5, wnRamp('dark'), 1.8, hh * 0.5);
    wFillP(x, [xa + 0.04 * L, -hh * 0.42, xa + 0.2 * L, -hh * 2.1, xa + 0.66 * L, -hh * 2.1,
      xa + 0.6 * L, -hh * 0.42], acc(wnRamp('bark')[1]), 1.8);
    wMetP(x, [xb - 0.24 * L, -hh * 0.5, xb, -hh * 0.9, xb, hh * 0.9, xb - 0.24 * L, hh * 0.5], wnRamp('steel'), 1.5, hh * 0.7);
    wShine(x, xa + 0.06 * L, xa + 0.34 * L, Math.max(0.9, hh * 0.2));
  };
  /** 柄(通用, 非自含头型才画): 尾镡 + 缠绳握把 + 带锥度的柄身 */
  function wShaft(x, P, M, trim) {
    var L = P.L, xa = P.xa, hx = P.hx + P.hl * 0.42, sh = P.sh, wood = !!WSHOOD[P.k];
    var gw = Math.max(2.4, 0.15 * L) * P.gw;
    wnMetal(x, function () { wnPoly(x, [xa, -sh * 0.55, hx, -sh, hx, sh, xa, sh * 0.55]); }, wnRamp(wood ? 'wood' : 'dark'), 1.6, sh * 1.5);
    wnGrip(x, xa + (hx - xa) * 0.06, xa + (hx - xa) * 0.52, gw, wnRamp(wood ? 'dark' : 'wood'));
    wMetR(x, xa - sh * 0.42, -sh * 1.1, xa + sh * 0.3, sh * 1.1, wnRamp('brass'), 1.2, sh * 1.1);
  }
  /* ------------------------------ 附件(离散构件) ------------------------------ */
  var WATT = {};
  WATT.guard = function (x, P, M, B) { wMetR(x, B.x, B.y, B.x + B.w, B.y + B.h, wnRamp('brass'), 1.4, B.h * 0.5); };
  WATT.mag = function (x, P, M, B) {
    wMetR(x, B.x, B.y, B.x + B.w, B.y + B.h, wnRamp('brass'), 1.5, B.h * 0.6);
    x.fillStyle = WN.brass[2]; x.fillRect(B.x + B.w * 0.16, B.y + B.h * 0.22, B.w * 0.5, Math.max(0.8, B.h * 0.12));
  };
  WATT.drum = function (x, P, M, B) {
    var cx = B.x + B.w / 2, cy = B.y + B.h / 2, r = Math.min(B.w, B.h) / 2;
    wnMetal(x, function () { circlePath(x, cx, cy, r); }, wnRamp('dark'), 1.8, r);
    for (var i = 0; i < 6; i++) { circlePath(x, cx + Math.cos(i / 6 * TAU) * r * 0.5, cy + Math.sin(i / 6 * TAU) * r * 0.5, Math.max(0.8, r * 0.16)); fillC(x, WN.steel[2]); }
  };
  WATT.scope = function (x, P, M, B) {
    wMetR(x, B.x, B.y, B.x + B.w * 0.72, B.y + B.h, wnRamp('dark'), 1.4, B.h * 0.5);
    wMetR(x, B.x + B.w * 0.04, B.y - B.h * 0.42, B.x + B.w * 0.26, B.y + B.h * 0.6, wnRamp('steel'), 1.2, B.h * 0.4);
    x.fillStyle = wnSpec(0.4); x.fillRect(B.x + B.w * 0.36, B.y + B.h * 0.2, B.w * 0.3, Math.max(0.7, B.h * 0.22));
  };
  WATT.stock = function (x, P, M, B) {
    wFillP(x, [B.x + B.w, B.y, B.x + B.w + B.h * 0.4, B.y + B.h * 0.24, B.x + B.w + B.h * 0.26, B.y + B.h, B.x, B.y + B.h],
      mix(WN.wood[1], WN.wood[2], 0.4), 1.5);
  };
  WATT.belt = function (x, P, M, B) {
    var n = 4, i, w = B.w / n * 0.86;
    x.fillStyle = WN.brass[1]; x.strokeStyle = INK; x.lineWidth = 1;
    for (i = 0; i < n; i++) {
      wnRect(x, B.x + i * B.w / n, B.y + (i % 2) * B.h * 0.16, B.x + i * B.w / n + w, B.y + B.h * 0.66 + (i % 2) * B.h * 0.16);
      x.fill(); x.stroke();
    }
  };
  WATT.tank = function (x, P, M, B, trim, ec) {
    var rr = B.h / 2, c1 = B.x + rr, c2 = B.x + B.w - rr, cy = B.y + rr;
    wnMetal(x, function () {
      x.beginPath(); x.moveTo(c1, B.y); x.lineTo(c2, B.y); x.arc(c2, cy, rr, -Math.PI / 2, Math.PI / 2);
      x.lineTo(c1, B.y + B.h); x.arc(c1, cy, rr, Math.PI / 2, Math.PI * 1.5); x.closePath();
    }, wnRamp('dark'), 1.7, B.h * 0.7);
    x.fillStyle = acc(ec || trim); x.fillRect(c2 - B.w * 0.16, cy - rr * 0.45, B.w * 0.18, rr * 0.9);
  };
  WATT.core = function (x, P, M, B, trim, ec) {
    var col = ec || '#b98cff';
    wFillR(x, B.x, B.y, B.x + B.w, B.y + B.h, col, 1.3);
    x.fillStyle = acc(mix(col, WSHINE, 0.55)); x.fillRect(B.x + B.w * 0.18, B.y + B.h * 0.32, B.w * 0.64, Math.max(0.8, B.h * 0.2));
  };
  WATT.spikes = function (x, P, M, B) {
    var n = 6, i, w = B.w / n;
    x.fillStyle = WN.steel[0]; x.strokeStyle = WINK; x.lineWidth = 1;
    for (i = 0; i < n; i++) {
      x.beginPath();
      x.moveTo(B.x + i * w, B.y + B.h); x.lineTo(B.x + i * w + w * 0.5, B.y); x.lineTo(B.x + (i + 1) * w, B.y + B.h);
      x.closePath(); x.fill(); x.stroke();
    }
  };
  WATT.gem = function (x, P, M, B) { wDot(x, B.x + B.w / 2, B.y + B.h / 2, Math.min(B.w, B.h) / 2, '#5aa0d8'); };
  WATT.dots = function (x, P, M, B, trim, ec) {
    for (var i = 0; i < 3; i++) {
      wDot(x, B.x + B.w * (0.22 + 0.28 * i), B.y + B.h * (i % 2 ? 0.28 : 0.72), Math.max(0.9, B.h * 0.15), mix(ec || '#9de0c0', WSHINE, 0.6));
    }
  };
  WATT.flame = function (x, P, M, B, trim, ec) {
    var col = ec || '#9de0c0';
    wFillP(x, [B.x, B.y + B.h * 0.72, B.x + B.w * 0.34, B.y, B.x + B.w * 0.5, B.y + B.h * 0.3,
      B.x + B.w * 0.72, B.y + B.h * 0.06, B.x + B.w, B.y + B.h * 0.62, B.x + B.w * 0.7, B.y + B.h, B.x + B.w * 0.26, B.y + B.h], col, 1.3);
    x.fillStyle = acc(mix(col, WSHINE, 0.7)); circlePath(x, B.x + B.w * 0.44, B.y + B.h * 0.62, Math.max(0.9, B.h * 0.13)); x.fill();
  };
  WATT.vial = function (x, P, M, B, trim, ec) {
    wMetR(x, B.x, B.y + B.h * 0.1, B.x + B.w, B.y + B.h, wnRamp('steel'), 1.4, B.h * 0.5);
    wFillR(x, B.x + B.w * 0.16, B.y + B.h * 0.3, B.x + B.w * 0.84, B.y + B.h * 0.88, ec || '#7fd8ff', 0);
  };
  WATT.fan = function (x, P, M, B) {
    var n = 3, i;
    for (i = 0; i < n; i++) {
      wnMetal(x, (function (k) {
        return function () {
          wnPoly(x, [B.x + B.w * 0.1, B.y + B.h * k / n, B.x + B.w, B.y + B.h * (k + 0.28) / n,
            B.x + B.w, B.y + B.h * (k + 0.72) / n, B.x + B.w * 0.1, B.y + B.h * (k + 1) / n]);
        };
      })(i), wnRamp('steel'), 1.3, B.h * 0.4);
    }
  };
  WATT.fangs = function (x, P, M, B, trim, ec) {
    var n = 3, i;
    for (i = 0; i < n; i++) {
      wnMetal(x, (function (k) {
        return function () {
          wnPoly(x, [B.x, B.y + B.h * (k + 0.15) / n, B.x + B.w, B.y + B.h * (k + 0.5) / n, B.x, B.y + B.h * (k + 0.85) / n]);
        };
      })(i), wnRamp('steel'), 1.4, B.h * 0.4);
    }
    x.fillStyle = acc(ec || '#7fd8ff'); x.fillRect(B.x, B.y + B.h * 0.48, B.w * 0.5, Math.max(0.8, B.h * 0.06));
  };
  WATT.prong = function (x, P, M, B, trim, ec) {
    var i;
    for (i = 0; i < 2; i++) {
      wnMetal(x, (function (k) {
        return function () { wnRect(x, B.x, B.y + B.h * (0.1 + 0.55 * k), B.x + B.w * (0.7 + 0.3 * k), B.y + B.h * (0.34 + 0.55 * k)); };
      })(i), wnRamp('steel'), 1.3, B.h * 0.3);
    }
    x.strokeStyle = acc(ec || '#ffe14a'); x.lineWidth = 1.4;
    x.beginPath(); x.moveTo(B.x + B.w * 0.2, B.y + B.h * 0.5); x.lineTo(B.x + B.w, B.y + B.h * 0.5); x.stroke();
  };
  WATT.pennant = function (x, P, M, B) {
    wFillP(x, [B.x, B.y + B.h, B.x + B.w, B.y, B.x + B.w * 0.86, B.y + B.h * 0.55, B.x + B.w, B.y + B.h], '#c86a5a', 1.3);
  };
  WATT.crank = function (x, P, M, B) {
    x.strokeStyle = acc(WN.wood[1]); x.lineWidth = Math.max(1.5, B.h * 0.24); x.lineCap = 'round';
    x.beginPath(); x.moveTo(B.x, B.y); x.lineTo(B.x + B.w * 0.5, B.y + B.h * 0.7); x.lineTo(B.x + B.w, B.y); x.stroke();
  };
  WATT.grip = function (x, P, M, B) {
    wFillP(x, [B.x, B.y, B.x + B.w, B.y + B.h * 0.15, B.x + B.w * 0.8, B.y + B.h, B.x + B.w * 0.2, B.y + B.h],
      mix(WN.dark[1], WN.wood[2], 0.45), 1.4);
  };
  WATT.hopper = function (x, P, M, B) {
    wFillP(x, [B.x, B.y, B.x + B.w, B.y + B.h * 0.12, B.x + B.w * 0.72, B.y + B.h, B.x + B.w * 0.28, B.y + B.h],
      mix(WN.dark[1], WN.wood[2], 0.4), 1.5);
    x.fillStyle = acc(WN.steel[2]); x.fillRect(B.x + B.w * 0.34, B.y + B.h * 0.3, B.w * 0.32, Math.max(0.8, B.h * 0.14));
  };
  WATT.lens = function (x, P, M, B, trim, ec) {
    var cx = B.x + B.w * 0.5, cy = B.y + B.h * 0.5, r = Math.min(B.w, B.h) * 0.5;
    wnMetal(x, function () { circlePath(x, cx, cy, r); }, wnRamp('steel'), 1.8, r);
    wDot(x, cx, cy, r * 0.52, ec || '#b0d0f0');
    x.fillStyle = wnSpec(0.55); circlePath(x, cx - r * 0.22, cy - r * 0.26, Math.max(0.8, r * 0.18)); x.fill();
  };
  function wAtt(x, P, M, k, trim, ec) {
    var kind = M[k], f;
    if (!kind || kind === 'none') return;
    f = WATT[kind];
    if (!f) return;
    f(x, P, M, { x: wN(M[k + 1], 0) * P.L, y: wN(M[k + 2], 0) * P.L,
      w: Math.max(0, wN(M[k + 3], 0) * P.L), h: Math.max(0, wN(M[k + 4], 0) * P.L) }, trim, ec);
  }
  /* 头型在三个方向上的**真实到达**(表里的数是 xa/xb/hy, 这里补上"头自己伸出去的部分")
   * —— 图框必须包住它, 否则烘焙时被裁掉(实测: 飞叶镖的叶片被裁成一个小方块)。
   * 默认: 头从 hx 画到 hx+hl、高度 ±hh; 只有不走 x 的圆盘/球/风车/法球要单独给。 */
  var WREACH = {
    disc: function (P) { return P.hx + P.hh * 1.78; },
    ball: function (P) { return P.hx + P.hh * 1.82; },
    shuriken: function (P) { return P.hh * 1.99; },
    orb: function (P) { return P.hx + P.hl * 0.52 + clamp(P.s1, 0.04, 0.70) * P.L; },
    fist: function (P) { return P.xb; },
    gun: function (P) { return P.xb; },
    railgun: function (P) { return P.xb + (P.xb - P.hx) * 0.10; },
    tankgun: function (P) { return P.xb + (P.xb - P.hx) * 0.10; },
    coil: function (P) { return P.xb + (P.xb - P.xa) * 0.02; },
    bow: function (P) { return P.xb; },
    hopper: function (P) { return P.xb; },
    /* v61: 这四个头自己向右伸出去(锯盘齿/火球尖刺/喷焰舌/锤头刺),
     *   不补进表里就会在烘焙时被图框裁掉(实测 4 族右边溢出 0.7~4.2px ⇒ 武器缺一块/整格空白)。 */
    saw: function (P) { return P.hx + P.hl * 0.55 + P.hh * 1.45; },
    fireball: function (P) { return P.hx + P.hl * 0.5 + P.hh * 1.79; },
    flamer: function (P) { return P.xb + 0.22 * P.L; },
    sledge: function (P) { return P.hx + P.hl * 0.5 + P.hh * 1.40; },
    /* v62: 这两个“刺球”头用 wnSpikes 径向伸出 r*1.5 / r*1.34,
     *   旧图框只算到 hx+hl -> hh 调大后被裁(work/wframe.cjs 实测越界 2.1/2.0px)。 */
    spikedclub: function (P) { return P.hx + P.hl * 0.52 + P.hh * 1.52; },
    shield: function (P) { return P.hx + P.hl * 0.50 + P.hh * 1.28; },
    /* v63: 投掷石块的块头放大到 r=1.22hh 后伸到 cx + 1.16r, 旧图框只算到 hx+hl ⇒ 右边被裁 4.9px
     *   (work/wframe.cjs 实测)。与 saw/fireball/sledge 同一类修复。 */
    stone: function (P) { return P.hx + P.hl * 0.52 + P.hh * 1.44; }
  };
  var WHIGH = {
    disc: 1.42, ball: 1.72, shuriken: 1.99, yoke: 1.32, fist: 1.22, bow: 1.20, coil: 1.00, shears: 1.00,
    spikedclub: 1.60, shield: 1.36,  /* v62: 刺球头的纵向到达(wnSpikes r*1.5 / r*1.34) */
    stone: 1.46                      /* v63: 碎石块纵向 1.16r = 1.42hh */
  };
  /** 图框: 与画出来的东西一致(头 + 两个附件都算进去), 握把在原点 ⇒ 左右对称包住 */
  function wFrame(def) {
    var M = wM(def), P = wP(M, 1);
    var xa = wN(M[8], -0.5), xb = Math.max(wN(M[9], 1.06), (WREACH[P.k] || function (Q) { return Q.hx + Q.hl; })(P));
    if (P.k === 'shuriken') xa = Math.min(xa, -P.hh * 1.99);
    var hy = Math.max(P.hh * (WHIGH[P.k] || 1.12), P.k === 'gun' ? P.sh : P.sh * 0.9) + 0.10;
    var q, ax, ay, aw, ah, y0, y1;
    for (q = 10; q <= 15; q += 5) {
      if (!M[q] || M[q] === 'none') continue;
      ax = wN(M[q + 1], 0); ay = wN(M[q + 2], 0); aw = wN(M[q + 3], 0); ah = wN(M[q + 4], 0);
      if (ax < xa) xa = ax;
      if (ax + aw > xb) xb = ax + aw;
      y0 = Math.min(ay, ay + ah); y1 = Math.max(ay, ay + ah);
      if (Math.abs(y0) + 0.06 > hy) hy = Math.abs(y0) + 0.06;
      if (Math.abs(y1) + 0.06 > hy) hy = Math.abs(y1) + 0.06;
    }
    return [xa, xb, hy];
  }
  function weaponGeo(L, def) {
    var f = wFrame(def);
    var xa = f[0] * L, xb = f[1] * L, hy = f[2] * L;
    var hw = Math.max(-xa, xb) + 4;
    return { xa: xa, xb: xb, hy: hy, mcx: (xa + xb) / 2, w: hw * 2, h: hy * 2 + 5 };
  }
  /* ---------------------------- 每族一个模型(入口) ---------------------------- */
  function paintWeaponModel(x, key, def, tier) {
    var T = clamp(tier || 1, 1, 4);
    var L = weaponLen(T);
    var M = wM(def);
    var trim = WN.trim[T - 1];
    var ec = weaponElemCol(def);
    var P = wP(M, L);
    var m0 = WNRAMP;
    /* v61 修复: wMat() 吃的是**材质名**(bark/wood60/…), 以前把**族名**(plank/sword/…) 传进去,
     *   WN60[族名] 永远 undefined ⇒ 61 族全部静默落到 WN.steel，“按名字上色”实际从未生效。 */
    WNRAMP = wMat(WNFAM[wFamOf(def)] || 'steel');
    try {
      x.lineJoin = 'round'; x.lineCap = 'round';
      if (!WSELF[P.k]) wShaft(x, P, M, trim);
      (WHEAD[P.k] || WHEAD.blade)(x, P, M, trim, ec);
      wAtt(x, P, M, 10, trim, ec);
      wAtt(x, P, M, 15, trim, ec);
      if (ec) wnElem(x, Math.max(0.1 * L, P.hx * 0.5), Math.max(0.16 * L, P.hx + P.hl * 0.9), ec, 2.2);
    } finally { WNRAMP = m0; }
    wnTierAccents(x, L, T, trim);
  }

  /* 供门禁/工具查询: 该族的烘焙图框(改模型时用来断言"没被裁掉") */
  PS.Art.weaponSpec = function (key, def) { return weaponSpec(key, def); };
  /* 供门禁查询: 该族的**头型类**(WM 第 0 项)与**材质名**(WNFAM)。
   *   qa/verify-weapon-shape.cjs 的"同头型类必须不同色相"判决读的就是这两个。 */
  PS.Art.weaponKind = function (def) { return (wM(def) || [])[0] || ''; };
  PS.Art.weaponMat = function (def) { return WNFAM[wFamOf(def)] || 'steel'; };
  PS.Art.weaponMatRAMp = function (def) { return wMatOf(def); };
  function weaponSpec(key, def) {
    var L = weaponLen((def && def.tier) || 1);
    var g = weaponGeo(L, def);   /* v56: 图框按**族**给(每族一个模型), 不再按 22 个形状类 */
    /* v62: 画布边长**取偶**。奇数尺寸的灻焙图在被“居中落图”时中心落在 .5 像素上,
     *   浏览器会重采样 -> 生成一圈边缘/内部半透明像素(Sprites.draw 也是按 w/2 居中落图)。
     *   实测: 逆向探针 work/semi-probe2.cjs —— 同一批精灵, 半像素偏移时 slingshot 内部半透明 20.4%,
     *   整像素偏移时**全部 61 族 0.0%**。取偶后无论从哪个整数坐标居中都不会半像素重采样。 */
    return { w: Math.ceil(g.w / 2) * 2, h: Math.ceil(g.h / 2) * 2, mcx: g.mcx, L: L, hy: g.hy, tip: g.xb };
  }
  /** 角度最短弧插值(a→b, t=0..1) —— 武器"从待机转向目标"用它, 不许绕远路转 350° */
  function angMix(a, b, t) {
    var d = ((b - a + Math.PI * 3) % TAU) - Math.PI;
    return a + d * t;
  }
  /** v54 实心化: 把烘好的武器图 alpha 二值化(阈值 64)。
   * 为什么必须做(主程探针口径, 不是猜): 模型内部与边缘的半透明像素在放大落图时会被重采样
   *   混成一大片中间值像素 —— 实测「半透明像素占比 42%」就是用户截图里的「武器建模透明」。
   *   烘焙期一次性二值化之后, 缓存里只剩「实心 / 透明」两态, 热路径仍是 1 次 drawImage(0 额外调用)。
   * 失败(环境没有 getImageData / 画布被污染)只跳过这一步, 绝不让整张烘焙失败。 */
  /** 单个像素的材质整形(由 wnSolidify 调用): 把「浅而灰」的抗锯齿中间值压到中调, 并给出彩度下限。
   * 为什么只碰这类像素: 实心材质色的彩度都远在阈值之上(WINK 0.57 / 冷钢 0.73 / 黄铜 0.99), 被整形
   *   的只有「浅描边与材质混出来的边缘」—— 那批像素恰好同时满足 低饱和 + 高亮, 就是探针里的「发白」。
   *   压暗后观感是「干净的内缘」, 而不是一圈发白光晕; 彩度下限则保证材质色读起来是材质色。 */
  function wnGradePix(p, i) {
    var r = p[i] / 255, g = p[i + 1] / 255, b = p[i + 2] / 255, mx, mn, l, d, s = 0, h = 0, ch;
    mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
    mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
    l = (mx + mn) / 2; d = mx - mn;
    if (d > 1e-6) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (mx === r) h = ((g - b) / d + 6) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h *= 60;
    }
    ch = false;
    if (l > 0.5 && s < 0.26) { l = 0.5; ch = true; }        /* 浅而灰 => 中调 */
    if (s >= 0.1 && s < 0.34) { s = 0.34; ch = true; }      /* 彩度下限 */
    if (!ch) return;
    var c = (1 - Math.abs(2 * l - 1)) * s, xa = c * (1 - Math.abs((h / 60) % 2 - 1)), mm = l - c / 2, rr, gg, bb;
    if (h < 60) { rr = c; gg = xa; bb = 0; } else if (h < 120) { rr = xa; gg = c; bb = 0; }
    else if (h < 180) { rr = 0; gg = c; bb = xa; } else if (h < 240) { rr = 0; gg = xa; bb = c; }
    else if (h < 300) { rr = xa; gg = 0; bb = c; } else { rr = c; gg = 0; bb = xa; }
    p[i] = (rr + mm) * 255; p[i + 1] = (gg + mm) * 255; p[i + 2] = (bb + mm) * 255;
  }
  function wnSolidify(cc) {
    var x = cc && cc.getContext && cc.getContext('2d'), W, H, im, p, i;
    if (!x || !x.getImageData || !(cc.width > 0)) return;
    try {
      W = cc.width; H = cc.height;
      im = x.getImageData(0, 0, W, H); p = im.data;
      for (i = 3; i < p.length; i += 4) {
        if (p[i] < 64) { p[i] = 0; continue; }
        p[i] = 255;
        wnGradePix(p, i - 3);
      }
      x.putImageData(im, 0, 0);
    } catch (e) { /* 降级: 不实心化, 模型本身照常 */ }
  }
  /** 武器模型烘焙的**唯一**入口: MODE 归零 + 实心化。
   * MODE 归零修的是一个真 bug: acc() 在 MODE=1(受击白闪)时返回纯白 —— 界面与战斗都可能在某只怪
   *   白闪烘焙之后紧接着烘武器, 于是整把武器被烤成白色并永久留在缓存里(这就是用户报的「发白」的一半)。
   *   武器与怪共用同一个 MODE 变量, 所以烘武器之前必须把 MODE 钉在 0, 烘完还原。 */
  function wnBake(cc, xx, key, def, tier) {
    var m0 = MODE; MODE = 0;
    try { paintWeaponModel(xx, key, def, tier); } finally { MODE = m0; }
    wnSolidify(cc);
  }
  /** 界面用: 以 (cx,cy) 为中心画一把武器模型(1 次 drawImage)
   *  size = 模型"头长"在屏幕上的像素数(由调用方按可用空间给), rot 默认 -0.62(斜举最好读)
   *  缓存 key = 'w3:'+key+':'+tier —— 只由离散量组成(见文件头画布纪律) */
  PS.Art.drawWeaponIcon = function (ctx, key, cx, cy, size, opts) {
    if (!ctx || !key) return false;
    var o = opts || {};
    var def = o.def || weaponDef(key) || {};
    var tier = clamp(o.tier || def.tier || 1, 1, 4);
    var sp = weaponSpec(key, { tier: tier, family: def.family, targeting: def.targeting, cls: def.cls });
    var sc = Math.max(0.1, (size || 20) / sp.L);
    var rot = (o.rot === undefined ? -0.62 : o.rot);
    /* 把**模型外框中心**而不是握把摆到 (cx,cy): 斜举时握把在角落, 居中要按外框算 */
    var mx = sc * sp.mcx, ca = Math.cos(rot), sa = Math.sin(rot);
    var ax = cx - ca * mx, ay = cy - sa * mx;
    var kb = key, dd = def, tb = tier;
    /* v54 放大落图用**最近邻**: 双线性放大在 2.5x 时会把剪影边界糊成 2~3px 的半透明带
     *   (实测这占了 42% 半透明像素里的大头), 而且混出来的浅灰正好又被算成「发白」。
     *   放大时最近邻只「挑」像素、不产生中间值: 缓存既然已经二值化, 落图后依然二值。
     * 缩小时(sc < 1.2, 例如道具栏 15px / 小卡片)保留双线性 —— 那时最近邻会丢细节。 */
    var nn = sc >= 1.2, sm0 = ctx.imageSmoothingEnabled;
    if (nn) ctx.imageSmoothingEnabled = false;
    var ok = !!drawSprite(ctx, 'w3:' + key + ':' + tier, sp.w, sp.h,
      function (cc, xx) { wnBake(cc, xx, kb, dd, tb); },
      ax, ay, {
        rot: rot, scale: sc,
        fallback: function (cc) {
          cc.save(); cc.translate(ax, ay); cc.rotate(rot); cc.scale(sc, sc);
          var m0 = MODE; MODE = 0;
          try { paintWeaponModel(cc, kb, dd, tb); } finally { MODE = m0; }
          cc.restore();
        }
      });
    if (nn) ctx.imageSmoothingEnabled = sm0;
    return ok;
  };

  /* ============================ 道具图标 (v54) ============================
   * 背景: ui.js 的 itemIcon 原来把 134 件道具全画成同一个土豆腐块(只换 def.color),
   *   商店 4 张卡与道具栏 6 格看起来是同一块石头 —— 用户原话「物品没有建模」。
   * 现在按 mods 的**主题通道**分成 20 个造型族(表见 IFAM), 每族一个手绘造型:
   *   平涂实色 + INK 描边 + 1 处浅色湿点, 与武器/怪同一套纪律(零发光、零径向渐变)。
   * 分族是**纯数据推导**: 通道到族的优先顺序只写在 IFAM 一张表里, 加词条/加道具都不用改代码。
   * 优先顺序按「词条越具体越优先」排(拾取 3 件 > 经验 4 件 > ... > 伤害 28 件), 于是元素/击退/
   *   幸运这类小通道不会被伤害大类吃掉 —— 实测 134 件分成 20 族, 每族都非空(最少的族 1 件)。
   * 缓存 key = 'i2:' + (src || id): 只含身份键, **品阶不进 key**(与武器同规则) —— 阶位只额外画
   *   一枚不烘焙的小色标(见 drawItemIcon 末尾), 所以同一个 key 不会被阶位污染。
   * 尺寸: 烘焙画布固定 52 逻辑单位、主体占 ±20; 落图 scale = size / 20 ⇒ 主体宽 = 2 * size,
   *   与旧土豆块同宽(旧的 taterShape 半径就是 size), 所以版面不变、只是换成真模型。 */
  var IFAM = [
    ['magnet', ['pickup']],
    ['book', ['xpPct']],
    ['basket', ['harvest', 'harvestingGrowth']],
    ['spring', ['knockback', 'bounce']],
    ['leech', ['lifesteal']],
    ['gear', ['engDmg']],
    ['feather', ['dodge', 'dodgeCap']],
    ['bolt', ['eleDmg']],
    ['clover', ['crit']],
    ['horseshoe', ['luck']],
    ['scope', ['rangeFlat', 'pierceBonus']],
    ['plate', ['armor']],
    ['clock', ['atkSpd']],
    ['aloe', ['regen']],
    ['windmill', ['speedPct', 'speedCapCurrent']],
    ['sling', ['rangedDmg']],
    ['jug', ['maxHp', 'hpCapCurrent']],
    ['anvil', ['meleeDmg']],
    ['whet', ['dmgPct', 'dmgVsBossPct']],
    ['relic', []]
  ];
  /** 道具 -> 造型族(纯数据推导; 缺 mods 的 11 件落到 relic) */
  function itemFam(def) {
    var m = (def && def.mods) || {}, i, j, k;
    for (i = 0; i < IFAM.length; i++) {
      k = IFAM[i][1];
      for (j = 0; j < k.length; j++) if (m[k[j]] !== undefined) return IFAM[i][0];
    }
    return 'relic';
  }
  PS.Art.itemFam = itemFam;
  /** 材质整形: def.color 是每件道具的身份色, 但有 5 件接近灰白(#c8c8b0 的饱和度只有 0.18) ——
   *  直接平涂在 #0b0f0b 的凹槽里会糊成一片白, 正是用户抱怨的那类观感。这里统一把饱和度抬 1.5 倍、
   *  把明度夹进 [0.36, 0.56] 的窄带: 色相(身份)不变, 但每件都在暗槽里读得出轮廓。 */
  function itemTone(c) {
    var s = satAdj(c || '#c2a86a', 1.5), l = lum(s);
    if (l > 0.56) s = shade(s, -(l - 0.56) * 0.85);
    else if (l < 0.36) s = shade(s, (0.36 - l) * 0.8);
    return s;
  }
  var IIW = 52;                 /* 烘焙画布边长(逻辑单位) */
  function ipWhet(x, C, v) {                    /* 磨刀石 + 一道刃(伤害) */
    slab(x, function () { polyPath(x, [-19, 7, 2, -12, 19, -5, -2, 14]); }, C, 2.4);
    x.fillStyle = shade(C, 0.44); x.fillRect(-14, 1, 12, 3);
    slab(x, function () { polyPath(x, [-16, -4, 3, -18, 9, -12, -10, 2]); }, '#c9d6e2', 2);
  }
  function ipAnvil(x, C, v) {                   /* 小铁砧(近战伤害) */
    slab(x, function () { polyPath(x, [-16, -13, 11, -13, 13, -6, -15, -6]); }, C, 2.4);
    slab(x, function () { polyPath(x, [11, -13, 20, -9, 12, -6]); }, C, 2);
    slab(x, function () { polyPath(x, [-9, -6, 5, -6, 8, 11, -11, 11]); }, shade(C, -0.26), 2.2);
    slab(x, function () { polyPath(x, [-16, 11, 12, 11, 15, 18, -19, 18]); }, C, 2.2);
    x.fillStyle = shade(C, 0.45); x.fillRect(-13, -11, 17, 2.6);
  }
  function ipSling(x, C, v) {                   /* 弹弓 Y 叉 + 皮筋 + 弹丸(远程伤害) */
    limb(x, 0, 20, -12, -12, -4, C, 5.4);
    limb(x, 0, 20, 12, -12, 4, C, 5.4);
    limb(x, -12, -12, 12, -12, 7, shade(C, -0.38), 3.2);
    circlePath(x, 0, -3, 5.6); fillC(x, shade(C, 0.42)); strokeC(x, INK, 2.2);
  }
  function ipClock(x, C, v) {                   /* 发条三圈 + 蜂鸟翅(攻速) */
    var i, r;
    for (i = 0; i < 3; i++) {
      r = 5 + i * 5.4;
      x.beginPath(); x.arc(-2, 3, r, -0.5, 3.9); x.lineCap = 'round';
      x.strokeStyle = INK; x.lineWidth = 6.6 - i * 0.5; x.stroke();
      x.strokeStyle = i === 1 ? shade(C, 0.4) : C; x.lineWidth = 4.2 - i * 0.5; x.stroke();
    }
    slab(x, function () { polyPath(x, [7, -13, 20, -19, 15, -6]); }, shade(C, -0.32), 2);
    circlePath(x, 9, -12, 3.4); fillC(x, shade(C, 0.5)); strokeC(x, INK, 1.8);
  }
  function ipClover(x, C, v) {                  /* 四叶草 + 茎(暴击) */
    var i, a0 = v === 2 ? 0.9 : (v === 1 ? 0.5 : 0.2), a;
    for (i = 0; i < 4; i++) {
      a = a0 + i * Math.PI / 2;
      circlePath(x, Math.cos(a) * 8.4, Math.sin(a) * 8.4 - 3, 7.6);
      fillC(x, i === 1 ? shade(C, 0.42) : C); strokeC(x, INK, 2.2);
    }
    limb(x, 0, 3, 4, 20, 5, shade(C, -0.42), 3.6);
  }
  function ipJug(x, C, v) {                     /* 陶罐 / 水壶(生命) */
    slab(x, function () { ellPath(x, 0, 6, 12.6, 13.6); }, C, 2.4);
    slab(x, function () { polyPath(x, [-7, -18, 7, -18, 9, -6, -9, -6]); }, C, 2.2);
    slab(x, function () { polyPath(x, [-10, -20, 10, -20, 8, -16, -8, -16]); }, shade(C, -0.34), 2);
    limb(x, 12, -8, 19, 5, 7, shade(C, -0.2), 4);
    x.fillStyle = shade(C, 0.44); x.fillRect(-8, -2, 5, 11);
  }
  function ipPlate(x, C, v) {                   /* 锅盖 / 铁皮盾(护甲) */
    slab(x, function () { polyPath(x, [-17, -13, 17, -13, 17, 5, 0, 19, -17, 5]); }, C, 2.4);
    x.strokeStyle = shade(C, -0.38); x.lineWidth = 2.4;
    x.beginPath(); x.moveTo(-11, -8); x.lineTo(11, -8); x.stroke();
    var i;
    for (i = 0; i < 3; i++) { circlePath(x, -8 + i * 8, 2, 2.6); fillC(x, shade(C, 0.36)); strokeC(x, INK, 1.6); }
    x.fillStyle = shade(C, 0.5); x.fillRect(-14, -11, 8, 3);
  }
  function ipFeather(x, C, v) {                 /* 羽毛(闪避) */
    limb(x, -9, 20, 9, -16, -6, shade(C, -0.45), 3.6);
    slab(x, function () { ellPath(x, 2, -4, 8.4, 14.6, -0.5); }, C, 2.4);
    x.strokeStyle = shade(C, -0.34); x.lineWidth = 1.8;
    x.beginPath();
    var i;
    for (i = -2; i <= 2; i++) { x.moveTo(i * 3.2 - 3, -13 + i * 2.8); x.lineTo(i * 3.2 + 2, -1 + i * 3.6); }
    x.stroke();
    x.fillStyle = shade(C, 0.48); x.fillRect(-5, -12, 6, 13);
  }
  function ipWindmill(x, C, v) {                /* 风车四叶(移速) */
    var i, a0 = 0.4 + (v || 0) * 0.35, a;
    for (i = 0; i < 4; i++) {
      a = a0 + i * Math.PI / 2;
      polyPath(x, [0, 0, Math.cos(a) * 19, Math.sin(a) * 19, Math.cos(a + 0.85) * 15, Math.sin(a + 0.85) * 15]);
      fillC(x, i % 2 ? shade(C, 0.36) : C); strokeC(x, INK, 2.2);
    }
    circlePath(x, 0, 0, 4.2); fillC(x, shade(C, -0.42)); strokeC(x, INK, 2);
  }
  function ipHorseshoe(x, C, v) {               /* 马蹄铁 + 钉孔(运气) */
    x.beginPath(); x.arc(0, 0, 13, Math.PI * 0.12, Math.PI * 0.88);
    x.strokeStyle = INK; x.lineWidth = 12; x.lineCap = 'butt'; x.stroke();
    x.strokeStyle = C; x.lineWidth = 8.6; x.stroke();
    var i, a;
    x.fillStyle = shade(C, -0.5);
    for (i = 0; i < 5; i++) {
      a = Math.PI * (0.2 + i * 0.15);
      circlePath(x, Math.cos(a) * 13, Math.sin(a) * 13, 1.7); x.fill();
    }
    ellPath(x, -10.5, 7.5, 4.6, 2.6, -0.7); fillC(x, shade(C, 0.5));
  }
  function ipBasket(x, C, v) {                  /* 篮子 + 提手(收获) */
    slab(x, function () { polyPath(x, [-16, -3, 16, -3, 11, 18, -11, 18]); }, C, 2.4);
    x.strokeStyle = shade(C, -0.36); x.lineWidth = 2;
    x.beginPath();
    x.moveTo(-12, 2); x.lineTo(-9, 15); x.moveTo(-4, 2); x.lineTo(-3, 15);
    x.moveTo(4, 2); x.lineTo(3, 15); x.moveTo(12, 2); x.lineTo(9, 15);
    x.stroke();
    limb(x, -12, -4, 12, -4, -13, shade(C, -0.15), 3.8);
    x.fillStyle = shade(C, 0.45); x.fillRect(-13, 0, 7, 2.6);
  }
  function ipLeech(x, C, v) {                   /* 血瓶(吸血) */
    slab(x, function () { polyPath(x, [-11, -5, 11, -5, 13, 18, -13, 18]); }, C, 2.4);
    slab(x, function () { polyPath(x, [-5, -18, 5, -18, 6, -5, -6, -5]); }, C, 2.2);
    slab(x, function () { polyPath(x, [-8, -20, 8, -20, 7, -16, -7, -16]); }, shade(C, -0.36), 2);
    slab(x, function () { polyPath(x, [-11, 3, 11, 3, 12.4, 17, -12.4, 17]); }, palette.blood, 2);
    x.fillStyle = mix(C, WSHINE, 0.5); x.fillRect(-7, -1, 4, 5);
  }
  function ipGear(x, C, v) {                    /* 齿轮 + 轴孔(结构) */
    wnSpikes(x, 0, 0, 13, 19, 8, C, (v || 0) * 0.2);
    circlePath(x, 0, 0, 13); fillC(x, C); strokeC(x, INK, 2.4);
    circlePath(x, 0, 0, 5.4); fillC(x, shade(C, -0.42)); strokeC(x, INK, 2);
    x.fillStyle = shade(C, 0.46); x.fillRect(-9, -4, 7, 3);
  }
  function ipScope(x, C, v) {                   /* 望远镜 / 卷尺(射程) */
    slab(x, function () { polyPath(x, [-19, -7, 8, -7, 8, 7, -19, 7]); }, C, 2.4);
    slab(x, function () { polyPath(x, [6, -10, 19, -10, 19, 10, 6, 10]); }, shade(C, -0.3), 2.4);
    circlePath(x, -19, 0, 6.6); fillC(x, shade(C, 0.52)); strokeC(x, INK, 2);
    x.fillStyle = shade(C, 0.45); x.fillRect(-15, -4, 19, 3);
  }
  function ipAloe(x, C, v) {                    /* 芦荟叶(再生) */
    slab(x, function () { polyPath(x, [-3, 20, -12, -3, -6, -19, 2, -13, 5, 8]); }, C, 2.4);
    slab(x, function () { polyPath(x, [3, 20, 15, -1, 12, -16, 6, -9, 6, 8]); }, shade(C, -0.26), 2.2);
    x.strokeStyle = shade(C, 0.5); x.lineWidth = 1.8;
    x.beginPath(); x.moveTo(-2, 14); x.lineTo(-6, -11); x.stroke();
    var i;
    x.fillStyle = INK;
    for (i = 0; i < 4; i++) { circlePath(x, -12 + i * 1.7, -4 + i * 6.2, 1.5); x.fill(); }
  }
  function ipBolt(x, C, v) {                    /* 元素晶体 + 内闪电(元素) */
    slab(x, function () { polyPath(x, [-11, -3, 0, -19, 11, -3, 6, 18, -6, 18]); }, C, 2.4);
    polyPath(x, [-3, -8, 4, -8, -1, 1, 5, 1, -4, 15, -1, 4, -6, 4]);
    fillC(x, shade(C, 0.58)); strokeC(x, INK, 1.8);
    x.fillStyle = shade(C, -0.4); x.fillRect(-12, -1, 24, 2.6);
  }
  function ipSpring(x, C, v) {                  /* 木槌(击退) */
    slab(x, function () { polyPath(x, [-14, -14, 14, -14, 14, 0, -14, 0]); }, C, 2.4);
    limb(x, 0, 1, 1, 19, v === 2 ? 5 : (v === 1 ? -5 : 2), shade(C, -0.38), 5.5);
    x.strokeStyle = INK; x.lineWidth = 2;
    x.beginPath(); x.moveTo(-14, -7); x.lineTo(14, -7); x.stroke();
    x.fillStyle = shade(C, 0.45); x.fillRect(-11, -12, 19, 3);
  }
  function ipBook(x, C, v) {                    /* 书本(经验) */
    slab(x, function () { polyPath(x, [-17, -13, 12, -16, 15, 15, -14, 18]); }, C, 2.4);
    slab(x, function () { polyPath(x, [8, -15, 12, -16, 15, 15, 11, 16]); }, shade(C, -0.42), 2.2);
    x.strokeStyle = shade(C, 0.44); x.lineWidth = 1.8;
    x.beginPath(); x.moveTo(-11, -6); x.lineTo(6, -9); x.moveTo(-10, 1); x.lineTo(7, -2); x.stroke();
    x.fillStyle = shade(C, 0.5); x.fillRect(-12, 5, 9, 3);
  }
  function ipMagnet(x, C, v) {                  /* 马蹄磁铁(拾取) */
    x.beginPath(); x.arc(0, 1, 11.5, Math.PI, TAU);
    x.strokeStyle = INK; x.lineWidth = 16; x.lineCap = 'butt'; x.stroke();
    x.strokeStyle = C; x.lineWidth = 12; x.stroke();
    x.fillStyle = shade(C, -0.52);
    x.fillRect(-17.5, 1, 7, 16); x.fillRect(10.5, 1, 7, 16);
    x.fillStyle = shade(C, 0.5); x.fillRect(-13, -5, 4, 8);
  }
  function ipRelic(x, C, v) {                   /* 破陶片(无词条 / 杂项) */
    slab(x, function () { polyPath(x, [-16, 14, -18, -6, -6, -18, 12, -14, 18, 2, 6, 18]); }, C, 2.4);
    x.strokeStyle = shade(C, -0.45); x.lineWidth = 2.2;
    x.beginPath(); x.moveTo(-9, -9); x.lineTo(-1, 1); x.lineTo(-7, 7); x.stroke();
    x.fillStyle = shade(C, 0.5); x.fillRect(-12, -8, 8, 3);
  }
  var IP = {
    whet: ipWhet, anvil: ipAnvil, sling: ipSling, clock: ipClock, clover: ipClover,
    jug: ipJug, plate: ipPlate, feather: ipFeather, windmill: ipWindmill, horseshoe: ipHorseshoe,
    basket: ipBasket, leech: ipLeech, gear: ipGear, scope: ipScope, aloe: ipAloe,
    bolt: ipBolt, spring: ipSpring, book: ipBook, magnet: ipMagnet, relic: ipRelic
  };
  /** 界面用: 画一件道具的**模型**(商店卡 / 道具栏 / 结算清单共用) —— 与武器图标同一套规矩:
   *  走 drawSprite 缓存(1 次 drawImage)、key 只由身份键组成、零发光、零径向渐变。
   *  返回 true = 真的画了(ui.js 只在严格 true 时才不画兜底土豆块)。 */
  PS.Art.drawItemIcon = function (ctx, def, cx, cy, size, opts) {
    if (!ctx || !def) return false;
    var key = 'i2:' + (def.src || def.id || 'x');
    var fam = itemFam(def), paint = IP[fam] || IP.relic;
    var C = itemTone(def.color), v = variantOf('' + (def.src || def.id || 'i'), 3);
    var sz = Math.max(6, size || 20), sc = sz / 20;
    var fb = function (cc) {
      cc.save(); cc.translate(cx, cy); cc.scale(sc, sc);
      var m0 = MODE; MODE = 0;
      try { paint(cc, C, v); } finally { MODE = m0; }
      cc.restore();
    };
    drawSprite(ctx, key, IIW, IIW, function (cc, xx) {
      var m1 = MODE; MODE = 0;
      try { paint(xx, C, v); } finally { MODE = m1; }
    }, cx, cy, { scale: sc, fallback: fb });
    var rar = clamp((opts && opts.rarity) || def.rarity || 1, 1, 4);
    circlePath(ctx, cx + sz * 0.66, cy - sz * 0.66, Math.max(1.8, sz * 0.15));
    fillC(ctx, WN.trim[rar - 1]);
    strokeC(ctx, INK, Math.max(1, sz * 0.075));
    return true;
  };
  /* ============================ 战斗环绕(用户诉求: 像土豆兄弟一样绕在身边) ============================
   * 事实: 旧实现 PS.Art.drawWeapons 全工程**无调用点** ⇒ 玩家一直空手(这是"武器不见了"的另一半)。
   * 现在把 p.weapons 全部摆到角色身边:
   *   · 普通武器  —— 沿一圈均分, 静止时"朝外待机", 开火瞬间转向打出去的方向并后坐;
   *   · 环绕星    —— 走**游戏内真实轨道**(与 core 的 updateOrbits 同式同相), 画出来的就是你
   *                  实际打到人的那一圈, 视觉与判定不可能对不上;
   *   · 前后遮挡  —— 以玩家 y 为界分 'back'/'front' 两层, 上方的武器压在角色身后。
   * 只**读** slot 的字段(vAng/vAim/vFire/vRecoil/vSwing*), 绝不写回任何游戏状态。
   * 每把武器 1 次 drawImage; 元素武器与枪口闪光各多 1 次光晕图。
   */
  var _ringBuf = [];
  function ringBuf(i) { return _ringBuf[i] || (_ringBuf[i] = {}); }

  /** 环绕武器布局(握把位置 + 朝向) —— **视觉与弹道唯一的几何来源**。
   *  · 持有武器: 沿玩家朝向均分一圈, 握把落在半径 R 上、枪口朝外;
   *    开火那一瞬 vAim/vAng 把它转向目标, 抡击那一瞬 vSwing* 让它沿攻击弧扫过;
   *  · 环绕星: 走 core updateOrbits 的**同一条轨道**(同式同相) —— 画出来的就是真正打到人的那一圈。
   *  纯函数: 只读 (p.x,p.y,p.aimAng, orbitPhase, 武器表), 不写任何游戏状态。
   *  时间基准统一取 orbitPhase(游戏内时钟): 判定层(combat)与表现层(art)读的是同一个数,
   *  所以「子弹从枪口出」在两边永远一致, 不会差一帧。
   *  结果写进模块级 _ringBuf(复用对象 ⇒ 热路径零分配), 返回件数。 */
  function ringBuild(p, list, op, defOf) {
    var k = (list && list.length) || 0, i, q, cnt2 = 0, held = 0, slot = 0;
    for (i = 0; i < k; i++) {
      var w0 = list[i];
      if (!w0 || !w0.key) continue;
      if ((defOf(w0.key) || {}).targeting !== 'orbit') held++;
    }
    var base = (isFinite(p.aimAng) ? p.aimAng : 0) + Math.sin(op * 0.9) * 0.1;
    var R = (p.r || 16) + 5 + Math.min(15, held * 1.7);
    for (i = 0; i < k; i++) {
      var w = list[i];
      if (!w || !w.key) continue;
      var def = defOf(w.key) || {}, it;
      if (def.targeting === 'orbit') {
        var oc = Math.max(1, def.orbitCount || 1);
        for (q = 0; q < oc; q++) {
          var oa = op * (def.orbitSpd || 0) + q * TAU / oc + i;
          it = ringBuf(cnt2++);
          it.wi = i; it.w = w; it.def = def; it.orb = 1;
          it.gx = p.x + Math.cos(oa) * (def.orbitR || 90);
          it.gy = p.y + Math.sin(oa) * (def.orbitR || 90);
          it.rest = oa + Math.PI / 2;
        }
        continue;
      }
      var a = base + slot * TAU / Math.max(1, held);
      slot++;
      it = ringBuf(cnt2++);
      it.wi = i; it.w = w; it.def = def; it.orb = 0;
      it.gx = p.x + Math.cos(a) * R;
      it.gy = p.y + Math.sin(a) * R;
      it.rest = a;
    }
    /* 第二趟: 结算朝向/抡击/后坐, 再算出膛口(必须先数完 held 才能均分角度, 所以分两趟) */
    for (i = 0; i < cnt2; i++) {
      var e2 = _ringBuf[i], w2 = e2.w, d2 = e2.def;
      var tier2 = clamp(w2.tier || d2.tier || 1, 1, 4);
      var rot = e2.rest, off = 0;
      if (e2.orb) rot += op * 3.4;                     /* 环绕体自转: 锯片不转就不像在干活 */
      var aim = (isFinite(w2.vAim) && w2.vAim > 0 && isFinite(w2.vAng)) ? clamp(w2.vAim / 0.45, 0, 1) : 0;
      if (aim > 0 && !e2.orb) rot = angMix(e2.rest, w2.vAng, aim);
      if (isFinite(w2.vSwing) && w2.vSwing > 0) {       /* 近战: 沿攻击弧真的抡过去 */
        var dur = Math.max(0.05, w2.vSwingDur || 0.18);
        var pr = clamp(1 - w2.vSwing / dur, 0, 1);
        rot = (w2.vSwingAng || 0) + (pr - 0.5) * (w2.vSwingArc || 1.35);
        off += pr * 6;
      }
      if (isFinite(w2.vRecoil) && w2.vRecoil > 0) off -= clamp(w2.vRecoil / 0.12, 0, 1) * 4;
      var sp = weaponSpec(w2.key, { tier: tier2, family: d2.family, targeting: d2.targeting, cls: d2.cls });
      e2.rot = rot; e2.sp = sp; e2.tier = tier2;
      e2.x = e2.gx + Math.cos(rot) * off;               /* 后坐只挪画, 不挪环位 */
      e2.y = e2.gy + Math.sin(rot) * off;
      /* 出膛口 = **画出来的模型尖端**(图框 xb); 判定层开火时直接拿它当弹体出生点 */
      e2.tipX = e2.x + Math.cos(rot) * sp.tip;
      e2.tipY = e2.y + Math.sin(rot) * sp.tip;
      /* 绘制闭包只分配一次, 缓存在缓冲对象上(闭包读的是 e 的**当前**字段, 布局变了自动跟着变) */
      if (!e2.paint) {
        /* 契约: drawFn(canvas, ctx) —— 只许用第二个参画(见 sprites.js:97 的 drawFn(c, x))。
         * 写错成 cc 的话本槽烘焙必失败, 武器退回逐帧现画(视觉能看, 但白烧性能)。 */
        e2.paint = (function (e) { return function (cc, xx) { wnBake(cc, xx, e.w.key, e.def, e.tier); }; })(e2);
        e2.paintFb = (function (e) {
          return function (cc) {
            cc.save(); cc.translate(e.x, e.y); cc.rotate(e.rot);
            var m1 = MODE; MODE = 0;
            try { paintWeaponModel(cc, e.w.key, e.def, e.tier); } finally { MODE = m1; }
            cc.restore();
          };
        })(e2);
      }
    }
    return cnt2;
  }

  /** 某一把武器的**出膛口**(世界坐标) —— 判定层开火时拿它当弹体出生点。
   *  与美术层共用 ringBuild ⇒ "子弹从枪口出"是同一个函数算出来的, 不是巧合。 */
  PS.Art.ringSlot = function (g, i, opts) {
    if (!g || !g.player) return null;
    var o = opts || {};
    var list = o.weapons || g.weapons || [];
    if (!list.length) return null;
    var op = isFinite(o.orbitPhase) ? o.orbitPhase : (isFinite(g.orbitPhase) ? g.orbitPhase : 0);
    var n = ringBuild(g.player, list, op, o.defOf || weaponDef), q;
    for (q = 0; q < n; q++) if (_ringBuf[q].wi === i) return _ringBuf[q];
    return null;
  };

  /** 画环绕武器(用户诉求: 像土豆兄弟一样绕在身边)。
   *  time 参数保留只为兼容旧签名 —— 布局的时间基准是 orbitPhase(见 ringBuild), 不是界面时钟。
   *  v4.2: 武器**不再发光**。原先在武器身上叠元素底光 + 枪口光晕, 实测那两个光斑(tier1 的枪全长
   *    才 18px, 而光斑直径 30~32px)在角色身边糊成一坨脱离枪口的黄斑, 观感很脏。攻击表现交给
   *    特效层(fx.js 的 bolts/sparks: 枪口闪、光轴、拖尾、方向火花), 武器模型本身保持干净。 */
  PS.Art.drawWeaponRing = function (ctx, p, time, opts) {
    if (!ctx || !p) return 0;
    var o = opts || {}, layer = o.layer || 'all';
    var list = o.weapons || p.weapons || [];
    if (!list.length) return 0;
    var op = isFinite(o.orbitPhase) ? o.orbitPhase : 0;
    var cnt2 = ringBuild(p, list, op, o.defOf || weaponDef), i, n = 0;
    for (i = 0; i < cnt2; i++) {
      var e = _ringBuf[i];
      /* 前后遮挡: 以玩家 y 为界, 上半圈的武器压在角色身后, 下半圈盖在身上 */
      if (layer === 'back' && e.gy > p.y - 1) continue;
      if (layer === 'front' && e.gy <= p.y - 1) continue;
      drawSprite(ctx, 'w3:' + e.w.key + ':' + e.tier, e.sp.w, e.sp.h, e.paint, e.x, e.y,
        { rot: e.rot, fallback: e.paintFb });
      n++;
    }
    return n;
  };
  /** 兼容入口: tools/art-preview.html 与历史调用点按旧名字取用 */
  PS.Art.drawWeapons = PS.Art.drawWeaponRing;

  /** 掉落物(可选, 给主程替换 ui.js 里每颗材料 2 次调用): 1 次 drawImage */
  PS.Art.drawDrop = function (ctx, d, time, opts) {
    if (!ctx || !d) return;
    var t = time || 0, o = opts || {};
    var frame = ((((t * 5 + d.x * 0.05) | 0) % 2) + 2) % 2;
    var col = o.color || palette.chip;
    var r = o.r || 7;
    var w = Math.ceil(r * 3.2), h = Math.ceil(r * 3.2);
    if (o.glow !== false) glowAt(ctx, rgba(col, 0.42), 14, d.x, d.y);
    drawSprite(ctx, 'd:' + col + ':' + frame, w, h, function (cc, xx) {
      var s = 1 + Math.sin(frame * 1.4) * 0.06;
      xx.save(); xx.scale(s, s);
      xx.save(); xx.translate(0, r * 0.66); xx.scale(1, 0.34);
      xx.beginPath(); xx.arc(0, 0, r * 0.8, 0, TAU);
      xx.fillStyle = 'rgba(0,0,0,0.3)'; xx.fill(); xx.restore();
      volume(xx, r * 0.9, function () { blobPath(xx, 0, 0, r * 0.84, 0.16, 3); }, col, { lw: 1.6, gloss: 0.5 });
      xx.beginPath(); xx.ellipse(-r * 0.16, r * 0.2, r * 0.34, r * 0.2, 0.3, 0, TAU);
      xx.fillStyle = rgba(shade(col, -0.5), 0.5); xx.fill();
      xx.restore();
    }, d.x, d.y, {
      fallback: function (cc) {
        blobPath(cc, d.x, d.y, r * 0.85, 0.16, 3);
        cc.fillStyle = col; cc.fill(); cc.strokeStyle = INK; cc.lineWidth = 1.6; cc.stroke();
      }
    });
  };
  /* ============================ 战场地面 v5.0 · 吸血鬼幸存者风格 ============================
   * 用户诉求:「地图重新设计, 设计成吸血鬼幸存者那种风格」。翻译成 4 条可验收的美术纪律:
   *   1) **一整块**低饱和、低明度的底色 + 极缓慢的大尺度起伏 —— 没有硬边界、没有规则条纹;
   *   2) 细节只当**质感**: 碎点/碎石/贴地草茬, 单件对比度极低, 远看是一片均色;
   *   3) 地物(石堆/树桩/木桶/木箱/肥堆)数量极少、剪影清楚、全是暗色无脸小件 —— 只当"路标";
   *   4) 屏幕四角压一层柔和**暗角**: 视线被压到中央, 中央的怪因此更醒目。
   * 被替换的旧版(菜园三层: 土壤砖 + 4 种田带 + 地标)为什么不行: 田埂/篱笆/水沟是**规则横纹** + 亮木料,
   *   远看像地板缝、近看不出是同一块地, 还与绿怪抢色彩 —— 这与「地图要单调 / 别和怪撞色」直接冲突。
   * 性能契约(不许退化): 热路径全是 drawImage(底色砖 + 地物 + 1 张暗角图), 视口外不取;
   *   全部离屏烘焙, 且**烘焙倍率 = 画布此刻的设备倍率**(1:1 落图, 见下方 blit1to1; v5.20 实测:
   *   被缩放的砖 + 暗角合计约 20ms, 1:1 后合计约 1.6ms); 烘焙期一次性压色 gradeGround
   *   把地面摁进"暗窄带" —— 怪因此一定比地亮一档。这是"看得清"的根, 不是靠调某个颜色碰运气。
   * 降级路径(无画布工厂, 微信端不该发生): 纯 fillRect 平铺, 不建渐变、不建离屏画布。
   */
  var TILE = 512;                        /* 底色砖边长: 越大越像"一整块地", 接缝越难被看见 */
  var TILE_VARIANTS = 2;                 /* 砖的变体数: 破掉平铺重复感, 代价只是 1 张常驻图 */
  var PROP_CELL = 520;                   /* 地物散布格边长: 每格最多 1 件 */
  var PROP_HIT = 0.60;                   /* 格子有地物的比例(约 40%) */
  var SPAWN_CLEAR = 230;                 /* 出生点留白半径: 开局不许被地物压住 */
  /* 地面裁剪矩形对世界边界的**外扩量**: 舞台层在非 16:9 机型上会要求比逻辑面更宽/更高的视口
   *   (cam.w/h 含 bleed), 若仍按世界矩形硬裁, 世界边缘那一带就会露出 bgDeep 近黑色(用户实测的
   *   「有黑边」)。外扩后世界外仍是同一片砖 ⇒ 边上看到的是地。取一格(512) ≥ 任何现实 bleed。 */
  var GROUND_PAD = 512;

  /** 地面烘焙倍率: dpr 感知但封顶 1.5(内存: 地面面积大, 不跟角色抢 2 倍) */
  function groundDpr() {
    var cap = (PS.Balance && PS.Balance.FX && PS.Balance.FX.dprCap) || 2;
    var d = (typeof global.devicePixelRatio === 'number' && global.devicePixelRatio) || 1;
    return Math.max(1, Math.min(cap, d, 1.5));
  }
  /** 平铺补画: 元素靠近砖边界时在对面补一份 -> 平铺后无接缝(烘焙期一次性开销) */
  function wrapAt(T, px, py, rb, fn) {
    fn(px, py);
    var l = px < rb, r = px > T - rb, tp = py < rb, b = py > T - rb;
    if (l) fn(px + T, py);
    else if (r) fn(px - T, py);
    if (tp) fn(px, py + T);
    else if (b) fn(px, py - T);
    if (l && tp) fn(px + T, py + T);
    else if (l && b) fn(px + T, py - T);
    else if (r && tp) fn(px - T, py + T);
    else if (r && b) fn(px - T, py - T);
  }

  /* ---- 贴地细节件 ----
   * 形状纪律(v4.1 起, 继续有效): 地面细节**不许长成小生物的剪影** —— 无竖直主轴、无亮尖、无五官。
   * 起因: 旧的 3 片竖直 V 形草叶与"芽芽怪/田埂壮汉"的剪影撞车, 小绿怪站在草地上分不清是怪还是草。 */
  function pebble(x, px, py, r, sd) {
    ellPath(x, px, py + r * 0.4, r * 0.95, r * 0.4, 0); fillC(x, 'rgba(0,0,0,0.22)');
    ellPath(x, px, py, r, r * 0.74, sd * 3); fillC(x, h2(sd, 43.7) > 0.5 ? palette.stone : palette.stoneDark);
    ellPath(x, px - r * 0.24, py - r * 0.26, r * 0.42, r * 0.26, sd * 2); fillC(x, rgba(palette.stoneLite, 0.4));
  }
  /** 草茬 = 贴地残茬: 宽约 5x 高, 没有竖直主轴, 也没有亮尖 */
  function weed(x, px, py, s, sd) {
    var i, a0 = (h2(sd, 3.3) - 0.5) * 0.7;
    x.lineCap = 'round';
    for (i = 0; i < 4; i++) {
      var a = a0 + (i - 1.5) * 0.3;                  /* +-26 度: 贴着地面铺开, 不竖起来 */
      var l = s * (0.9 + h2(i, sd) * 0.5);
      x.beginPath();
      x.moveTo(px, py);
      x.lineTo(px + Math.cos(a) * l, py - s * 0.14 - Math.abs(Math.sin(a)) * l * 0.5);
      x.strokeStyle = h2(sd + i, 29.7) > 0.6 ? palette.grass : palette.grassDark;
      x.lineWidth = Math.max(1, s * 0.13);
      x.stroke();
    }
  }
  /** 细碎颗粒(质感用): 单颗 alpha <= 0.06, 数量多但对比极低 —— 远看是一片均色, 凑近才见颗粒 */
  function specks(x, T, n, sd) {
    var i, px, py, v;
    /* 两个坐标的哈希必须**去相关**: 曾经用 i*1.13 / i*1.31 这一对相邻乘子, 出来的点会连成
     *   一条条斜线(远看像划痕)。这里换成两个量级差很远的乘子, 点才真正散开。 */
    for (i = 0; i < n; i++) {
      px = h2(i * 1.13, 67.1 + sd) * T; py = h2(i * 7.91 + 0.37, 71.3 + sd) * T; v = h2(i, 73.7 + sd);
      x.fillStyle = v > 0.62 ? rgba(palette.cream, 0.05) : 'rgba(0,0,0,0.06)';
      x.fillRect(px, py, 1 + (v > 0.94 ? 1 : 0), 1);
    }
  }
  /** 作物株: kind 0 白菜心 1 叶菜束 2 胡萝卜缨 3 番茄苗 —— 只给地物当"手边的东西", 不铺满整片地 */
  function crop(x, px, py, s, kind, sd) {
    var i, a;
    if (kind === 0) {
      ellPath(x, px, py + s * 0.16, s * 0.44, s * 0.14, 0); fillC(x, 'rgba(0,0,0,0.14)');
      for (i = 0; i < 3; i++) {
        a = -2.9 + i * 0.44;
        x.beginPath();
        x.moveTo(px, py + s * 0.16);
        x.quadraticCurveTo(px + Math.cos(a) * s * 0.5, py + s * 0.08, px + Math.cos(a) * s * 0.74, py - s * 0.18);
        x.strokeStyle = i === 1 ? palette.cropGreen : palette.grassDark;
        x.lineWidth = Math.max(1, s * 0.16); x.lineCap = 'round'; x.stroke();
      }
    } else if (kind === 1) {
      for (i = 0; i < 4; i++) {
        a = -2.5 + i * 0.42;
        x.beginPath();
        x.moveTo(px, py);
        x.quadraticCurveTo(px + Math.cos(a) * s * 0.46, py - s * 0.34, px + Math.cos(a) * s * (0.66 + h2(i, sd) * 0.3), py - s * (0.44 + h2(i, sd + 1) * 0.3));
        x.strokeStyle = i % 2 ? palette.grass : palette.cropGreen;
        x.lineWidth = Math.max(1, s * 0.13); x.lineCap = 'round'; x.stroke();
      }
    } else if (kind === 2) {      for (i = 0; i < 4; i++) {
        a = -2.7 + i * 0.5;
        x.beginPath();
        x.moveTo(px, py);
        x.quadraticCurveTo(px + Math.cos(a) * s * 0.34, py - s * 0.3, px + Math.cos(a) * s * (0.5 + h2(i, sd) * 0.36), py - s * 0.52);
        x.strokeStyle = palette.grassDark; x.lineWidth = Math.max(1, s * 0.1); x.lineCap = 'round'; x.stroke();
      }
      ellPath(x, px, py, s * 0.14, s * 0.1, 0); fillC(x, palette.soilDust);
    } else {
      x.beginPath(); x.moveTo(px, py); x.lineTo(px, py - s * 0.72);
      x.strokeStyle = palette.gWoodDark; x.lineWidth = Math.max(1, s * 0.11); x.stroke();
      x.beginPath(); x.moveTo(px - s * 0.26, py - s * 0.34); x.lineTo(px + s * 0.26, py - s * 0.34);
      x.strokeStyle = palette.gWoodDark; x.lineWidth = Math.max(0.8, s * 0.08); x.stroke();
      for (i = 0; i < 3; i++) {
        ellPath(x, px - s * 0.22 + i * s * 0.22, py - s * 0.4, s * 0.11, s * 0.085, 0);
        fillC(x, i === 1 ? palette.cropGold : palette.grassDark);
      }
    }
  }
  /** 木板(地物共用的木料件; 旧"篱笆三件套"的 post/rail 随田带一起下架) */
  function plank(x, x0, y0, x1, y1, w, col) {
    x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1);
    x.strokeStyle = INK; x.lineWidth = w + 1.6; x.lineCap = 'round'; x.stroke();
    x.strokeStyle = col; x.lineWidth = w; x.stroke();
    x.strokeStyle = rgba(palette.gWoodLite, 0.5); x.lineWidth = w * 0.3; x.stroke();
  }

  /* ---- 地物(世界坐标, 每件 1 次 drawImage): 只当"路标", 不抢注意力 ----
   * 保留标准(与 v4.1 一致, 且这一版更严): 低矮、无脸、无亮色、剪影是"死物"。
   *   下架过的: 稻草人(有五官 + 250px 高, 等于地面上第二个"角色")、棚架/水井/板车/干草垛(亮色 + 大面积)。
   */
  /* 已停用(v53): 同上(0 调用点)。形制保留: 湿肥畦(平顶土垄)。 */
  function propCompost(x, hw, hh, v) {
    var i;
    ellPath(x, 0, hh * 0.82, hw * 0.94, hh * 0.16, 0); fillC(x, 'rgba(0,0,0,0.3)');
    volume(x, hh * 0.9, function () {
      x.beginPath();
      x.moveTo(-hw * 0.92, hh * 0.8);
      x.quadraticCurveTo(-hw * 0.8, hh * 0.1, -hw * 0.2, -hh * 0.34);
      x.quadraticCurveTo(hw * 0.4, -hh * 0.78, hw * 0.86, hh * 0.1);
      x.quadraticCurveTo(hw * 0.96, hh * 0.62, hw * 0.6, hh * 0.8);
      x.closePath();
    }, palette.soilDark, { lw: 2, flat: true });
    for (i = 0; i < 6; i++) {
      ellPath(x, -hw * 0.6 + i * hw * 0.24, hh * 0.3 - h2(i, v + 3) * hh * 0.5, hw * 0.16, hh * 0.1, h2(i, 7) * 1.4 - 0.7);
      fillC(x, rgba(h2(i, v) > 0.5 ? palette.soil : '#3f3a24', 0.7));
    }
    plank(x, -hw * 0.3, -hh * 0.3, hw * 0.34, -hh * 0.86, 5, palette.gWood);
    polyPath(x, [hw * 0.26, -hh * 0.7, hw * 0.44, -hh * 0.94, hw * 0.5, -hh * 0.74, hw * 0.3, -hh * 0.6]);
    slab(x, function () { polyPath(x, [hw * 0.26, -hh * 0.7, hw * 0.44, -hh * 0.94, hw * 0.5, -hh * 0.74, hw * 0.3, -hh * 0.6]); }, palette.gIronLite, 1.6);
    crop(x, -hw * 0.2, hh * 0.2, 14, 1, v);
    crop(x, hw * 0.28, hh * 0.34, 11, 2, v + 2);
  }
  /* 已停用(v53): 用户要求把地图上的木桶移走 -> PROPS 里不再有 barrel 项。
   * 函数保留(当前 0 调用点): 日后若要做「可破坏的木桶」等分支可直接复用, 不必重写。 */
  function propBarrel(x, hw, hh, v) {
    var i;
    ellPath(x, 0, hh * 0.88, hw * 0.7, hh * 0.1, 0); fillC(x, 'rgba(0,0,0,0.3)');
    x.beginPath(); x.moveTo(-hw * 0.56, -hh * 0.5); x.quadraticCurveTo(-hw * 0.76, 0, -hw * 0.56, hh * 0.84);
    x.lineTo(hw * 0.56, hh * 0.84); x.quadraticCurveTo(hw * 0.76, 0, hw * 0.56, -hh * 0.5);
    x.closePath();
    var g = x.createLinearGradient(-hw * 0.7, 0, hw * 0.7, 0);
    g.addColorStop(0, shade(palette.gWood, 0.08)); g.addColorStop(0.45, palette.gWood); g.addColorStop(1, shade(palette.gWood, -0.46));
    x.fillStyle = g; x.fill(); x.strokeStyle = inkOf(); x.lineWidth = 2; x.stroke();
    for (i = 0; i < 3; i++) {
      plank(x, -hw * 0.7, -hh * 0.34 + i * hh * 0.5, hw * 0.7, -hh * 0.34 + i * hh * 0.5, 4, palette.iron);
    }
    ellPath(x, 0, -hh * 0.5, hw * 0.56, hh * 0.2, 0);
    var g2 = x.createRadialGradient(-hw * 0.2, -hh * 0.56, 1, 0, -hh * 0.5, hw * 0.6);
    g2.addColorStop(0, palette.waterFoam); g2.addColorStop(1, palette.water);
    x.fillStyle = g2; x.fill(); x.strokeStyle = inkOf(); x.lineWidth = 2; x.stroke();
    ellPath(x, -hw * 0.16, -hh * 0.54, hw * 0.2, hh * 0.05, 0.3); fillC(x, rgba(palette.waterFoam, 0.4));
    if (v % 2) {
      ellPath(x, hw * 0.12, -hh * 0.52, hw * 0.12, hh * 0.05, 0);
      fillC(x, '#575033'); strokeC(x, inkOf(), 1.2);
    }
  }
  /* 已停用(v53): 同上(0 调用点)。形制保留: 木箱(板缝 + 铁角)。 */
  function propCrate(x, hw, hh, v) {
    var i, j;
    ellPath(x, 0, hh * 0.86, hw * 0.8, hh * 0.1, 0); fillC(x, 'rgba(0,0,0,0.3)');
    for (i = 0; i < 2; i++) {
      var bx = i ? hw * 0.06 : -hw * 0.92, byy = i ? -hh * 0.1 : hh * 0.06;
      var bw = hw * 0.86, bh = hh * 0.74;
      x.fillStyle = shade(palette.gWood, i ? 0.1 : -0.12);
      x.fillRect(bx, byy - bh, bw, bh);
      x.strokeStyle = inkOf(); x.lineWidth = 1.8; x.strokeRect(bx, byy - bh, bw, bh);
      for (j = 0; j < 3; j++) {
        x.beginPath(); x.moveTo(bx + 2, byy - bh + 4 + j * (bh - 8) / 2); x.lineTo(bx + bw - 2, byy - bh + 4 + j * (bh - 8) / 2);
        x.strokeStyle = rgba(shade(palette.gWood, -0.5), 0.45); x.lineWidth = 1.2; x.stroke();
      }
      x.beginPath(); x.moveTo(bx + 3, byy - 3); x.lineTo(bx + bw - 3, byy - bh + 3);
      x.strokeStyle = rgba(palette.gWoodLite, 0.45); x.lineWidth = 1.6; x.stroke();
    }
    for (i = 0; i < 3; i++) {
      var px = -hw * 0.7 + i * hw * 0.42;
      crop(x, px, -hh * 0.86 + i * hh * 0.1, 12, i % 2 ? 0 : 1, i + v);
    }
    if (v % 2) {
      ellPath(x, hw * 0.52, -hh * 0.62, hw * 0.24, hh * 0.2, 0);
      fillC(x, '#575033'); strokeC(x, inkOf(), 1.6);
    }
  }
  /** 石堆(已停用 v53): 用户要求把地图上的大块石头移走 -> PROPS 里不再有 rock 项。
   *  函数保留(当前 0 调用点), 理由同 propBarrel。 */
  function propRock(x, hw, hh, v) {
    var i, n = 3 + (v % 2), px, py, rr, a;
    ellPath(x, 0, hh * 0.86, hw * 0.84, hh * 0.12, 0); fillC(x, 'rgba(0,0,0,0.28)');
    for (i = 0; i < n; i++) {
      a = -2.7 + i * (2.2 / Math.max(1, n - 1));
      px = Math.cos(a) * hw * (0.30 + h2(i, v + 4) * 0.30);
      py = hh * 0.34 - h2(i, v + 6) * hh * 0.52 + Math.sin(a) * hh * 0.12;
      rr = hw * (0.28 + h2(i, v + 8) * 0.20);
      slab(x, (function (qx, qy, r2) {
        return function () { blobPath(x, qx, qy, r2, 0.13, 3); };
      })(px, py, rr), i % 2 ? palette.stone : palette.stoneDark, 2);
      ellPath(x, px - rr * 0.22, py - rr * 0.32, rr * 0.42, rr * 0.24, 0.2);
      fillC(x, rgba(palette.stoneLite, 0.34));
    }
  }
  /** 老树桩: 砍断的暗木桩 + 断口年轮 —— 与"烂心老桩"这只怪刻意拉开: 无脸、无枝、更矮更暗 */
  /* 已停用(v53): 用户要求地图零装饰 -> PROPS 为空数组, 本函数当前 0 调用点。
   * 形制保留: 树桩(断口朝上, 左倒一截枯枝, 底边与影子贴齐)。 */
  function propStump(x, hw, hh, v) {
    ellPath(x, 0, hh * 0.86, hw * 0.68, hh * 0.12, 0); fillC(x, 'rgba(0,0,0,0.3)');
    plank(x, -hw * 0.2, hh * 0.6, hw * 0.74, hh * 0.84, Math.max(3, hw * 0.12), palette.gWoodDark);
    x.beginPath();
    x.moveTo(-hw * 0.52, -hh * 0.08);
    x.quadraticCurveTo(-hw * 0.64, hh * 0.44, -hw * 0.46, hh * 0.7);
    x.lineTo(hw * 0.46, hh * 0.7);
    x.quadraticCurveTo(hw * 0.64, hh * 0.44, hw * 0.52, -hh * 0.08);
    x.closePath();
    var g = x.createLinearGradient(-hw * 0.6, 0, hw * 0.6, 0);
    g.addColorStop(0, shade(palette.gWood, 0.1)); g.addColorStop(0.5, palette.gWood); g.addColorStop(1, shade(palette.gWood, -0.5));
    x.fillStyle = g; x.fill(); x.strokeStyle = inkOf(); x.lineWidth = 2; x.stroke();
    ellPath(x, 0, -hh * 0.08, hw * 0.52, hh * 0.17, 0);
    fillC(x, shade(palette.gWoodLite, -0.06)); strokeC(x, inkOf(), 1.8);
    ellPath(x, 0, -hh * 0.08, hw * 0.31, hh * 0.10, 0); strokeC(x, rgba(palette.gWoodDark, 0.55), 1.2);
    ellPath(x, 0, -hh * 0.08, hw * 0.15, hh * 0.05, 0); strokeC(x, rgba(palette.gWoodDark, 0.55), 1.1);
    weed(x, -hw * 0.52, hh * 0.74, 7, 3 + v);
  }
  /* 地物名录(数据驱动: drawGround 按 PROPS.length 取模散点, gPropImg 按下标烘焙)。
   * v53 用户诉求「地图上的大块石头、木桶挡视线」—— 两条动作:
   *   1) 下架 rock(132x96) 与 barrel(110x120) 两项。对应 propRock / propBarrel 因此不再被调用;
   *      两个函数**保留**在下方并标注「已停用」, 不顺手删 —— 免得别的分支引用时踩空;
   *   2) 其余单件图框一律压到 max(w,h) <= 72px: stump 116->72, compost 190->72, crate 150->72。
   *      三个绘制函数全部按 hw/hh 归一 ⇒ 缩小图框 = 等比缩小落图, 形制不变。
   * 保留标准(与 v4.1 一致): 低矮、无脸、无亮色、剪影是「死物」。 */
  var PROPS = [];
  /* v53 用户诉求(第三次追加): 「地图上这些小装饰也不需要, 这个木桩, 还有浮空的木块」
   *   —— rock / barrel 先下架, 这一轮 stump / compost / crate 也全部下架, 于是名录为空。
   * 保留数组本身 + drawGround 的"抖动网格 + 哈希散布"机制(gPropImg 仍按下标烘焙):
   *   以后要放回任何地物, 只要往这里 push 一项即可, 不用改散布代码。
   * 散布循环已做 PROPS.length === 0 短路(见 drawGround 第 2 段): 不遍历格子, 也没有
   *   (h2(...) * 0) | 0 这类"取模 0"写法的 NaN 隐患(该写法本身也不会 NaN, 但短路更省)。
   * 下架不是删除实现: propStump / propCompost / propCrate / propRock / propBarrel 五个
   *   绘制函数全部保留在下方并标注「已停用」, 避免别的分支引用时踩空。 */
  /* ============================ 精灵缓存取用(全层共用) ============================
   * 把 PS.Sprites 包一层: 缓存层缺失(纯降级环境)时返回 null / 调 fallback, 绝不抛错。
   * 这是 v3.0 就有的公开契约 —— 敌怪 / 角色 / 武器 / 掉落 / 地面全部只经这两个入口,
   * 所以"微信小游戏无 document"时整层自动退化成现画, 而不是崩掉。 */
  function Sprites() { return PS.Sprites; }
  function drawSprite(ctx, key, w, h, fn, x, y, opts) {
    var S = Sprites();
    if (S && S.draw) return S.draw(ctx, key, w, h, fn, x, y, opts);
    if (opts && opts.fallback) { opts.fallback(ctx); return false; }
    return false;
  }
  /* 光晕落图(逻辑像素半径 r): **必须显式给 drawImage 的 w/h**。
   *   Sprites.get 按 dpr 烘焙(画布物理边长 = ceil(逻辑边长 × k)), 如果直接 drawImage(img,x,y),
   *   浏览器用的是物理尺寸 ⇒ 在 devicePixelRatio>1 的屏幕上光斑直径 = 2r × dpr, 白白大一倍。
   *   这里读精灵自记的逻辑边长 __sx 回落, 于是 hi-DPI 与 1x 屏上的观感一致。
   *   返回是否真的画了(调用方的图元计数要准)。 */
  function glowAt(ctx, color, r, x, y) {
    var S = Sprites();
    if (!S || !S.glow || !(r > 0)) return false;
    var g = S.glow(color, r);
    if (!g) return false;
    var lw = g.__sx || g.width;
    ctx.drawImage(g, x - lw / 2, y - lw / 2, lw, lw);
    return true;
  }
  /* ---- v5.20 地面 1:1 落图 ----
   * 为什么要"1:1": 实测(work/perfg-ground*.json)同样是 3.7M 像素的可见面积,
   *   768->1024 放大重采样的 12 张砖花掉 ~10ms, 1:1 只花 ~0.7ms; 暗角(1024x576 -> 2560x1440)
   *   花掉 ~10ms, 1:1 后与砖合计只花 ~1.6ms。**"被缩放"本身就是那 18ms 的来源**, 不是画得多。
   * 纪律: 地面件的烘焙倍率必须**等于画布此刻的设备倍率** —— 这条与"图集要按画布倍率烘"是同一条 */
  /** 画布此刻的真实设备倍率(它就是光栅化用的倍率): 优先问变换, 拿不到才回落公布口径 */
  function groundScaleOf(ctx) {
    var k = 0;
    if (ctx && typeof ctx.getTransform === 'function') {
      try { var m = ctx.getTransform(); if (m && isFinite(m.a) && m.a > 0) k = m.a; } catch (e) { k = 0; }
    }
    if (!(k > 0)) k = (PS.UI && PS.UI.ui && PS.UI.ui.dpr) || 0;
    if (!(k > 0)) k = groundDpr();
    return Math.max(0.5, Math.min(2.5, k));
  }
  /** 1:1 位块: 源按设备像素烘, 目标矩形 = 源尺寸/k(居中在原矩形上) -> 缩放恒为 1, 不吃重采样 */
  function blit1to1(ctx, img, k, x, y, w, h) {
    if (!img) return;
    var dw = img.width / k, dh = img.height / k;
    ctx.drawImage(img, 0, 0, img.width, img.height, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  var groundScaleNow = 0;                 /* 当前烘的是哪个倍率(换倍率时旧槽必须丢, 别把显存留成历史包袱) */
  function kv(k) { return Math.round((k || 0) * 1000) / 1000; }
  function noteGroundScale(k) {
    if (groundScaleNow === k) return;
    var S = Sprites();
    if (S && S.dropMatching) S.dropMatching(function (key) {
      return key.indexOf('g:ground:') === 0 || key.indexOf('g:vign:') === 0;
    });
    groundScaleNow = k;
  }
  /** 只取不画: 需要自己控制 drawImage 落点/落尺寸时用(地面砖按世界格落图, 不能走中心锚点) */
  function spriteImg(key, w, h, fn, pin, tl, k) {
    var S = Sprites();
    if (!S || !S.get) return null;
    return S.get('g:' + key, w, h, fn, { pin: pin !== false, dpr: (k > 0 ? k : groundDpr()), tl: tl === true });
  }

  /* ============================ 烘焙 / 取图 ============================ */
  /** 地面统一压色: 一件地面件烘完, 立刻用 source-atop 叠一层低饱和中性橄榄(alpha 0.18)。
   * 为什么用 source-atop: 它只落在"已经画上去的像素"上, 不动 alpha 轮廓 —— 既不把透明区涂脏,
   * 也不改任何元素的形状/剪影。作用是兜底: 把个别漏网的亮色拉回地面窄带, 顺带把色相统一到橄榄,
   * 于是地面读起来是"一整块暗地", 而不是"一堆杂物各自发亮"。
   * 归属: 烘焙期一次性开销(与 clip/渐变同档), 热路径依然是纯 drawImage —— 一个 fillRect 都没多。 */
  function gradeGround(x, w, h, tl) {
    x.save();
    x.globalCompositeOperation = 'source-atop';
    x.fillStyle = rgba(palette.groundGrade, 0.18);
    if (tl) x.fillRect(0, 0, w, h);
    else x.fillRect(-w / 2, -h / 2, w, h);
    x.restore();
  }

  /** 底色砖(严格无缝): 一块低饱和暗地 + 极缓慢的大尺度起伏 + 稀疏质感。
   * 这就是"吸血鬼幸存者式场地"的全部花纹 —— 没有田垄、没有篱笆、没有水沟, 也没有网格线。
   * 大尺度起伏用半径 120~260 的软斑(alpha <= 0.075) + 两张变体打散, 远看是一片逐渐过渡的暗色。 */
  function bakeGroundTile(x, v) {
    var T = TILE, i, px, py, pr, tint, sx, sy, sr;
    /* 变体的**底色必须完全一致**: 曾经按变体微调明度(v ? -0.05 : 0.02), 结果 512 的方格铺出来是
     *   "深浅棋盘" —— 远看就是一块块方补丁, 一眼看穿平铺。变体只许改**内容**(软斑/草茬/石子的种子),
     *   不许改底色。这条是实测踩出来的(第一版截图里能看到方格边界)。 */
    x.fillStyle = mix(palette.groundB, palette.soil, 0.45);
    x.fillRect(-2, -2, T + 4, T + 4);
    /* 软斑(低频花纹)的种子**只许与 i 有关, 不许带变体 v**: 带 v 时两张变体各长一套低频花纹,
     *   而铺砖是 (i+j)%2 轮转 ⇒ 512 逻辑像素的格界处花纹断开、格均值差 3~5 级亮度,
     *   远看就是一块块"浅色正方形"(用户 2026-10-08 实测投诉「地图上有一个浅色正方形」)。
     *   现状: 低频花纹两变体逐点相同(wrapAt 已把跨界元素补到对边 ⇒ 严格周期, 跨格无缝),
     *   变体只改**高频**质感(颗粒/草茬/石子种子) —— 高频在 1:1 落图下看不出格界。 */
    for (i = 0; i < 6; i++) {
      px = h2(i * 1.7, 3.1) * T;
      py = h2(i * 2.3, 7.7) * T;
      pr = 130 + h2(i * 0.9, 11.3) * 170;
      tint = h2(i, 5.3) > 0.5 ? palette.grassDark : palette.soil;
      wrapAt(T, px, py, pr, (function (tint2, r2) {
        return function (qx, qy) {
          var g = x.createRadialGradient(qx, qy, 0, qx, qy, r2);
          g.addColorStop(0, rgba(tint2, 0.075));
          g.addColorStop(1, 'rgba(0,0,0,0)');
          x.fillStyle = g; x.fillRect(qx - r2, qy - r2, r2 * 2, r2 * 2);
        };
      })(tint, pr));
    }
    specks(x, T, 360, v * 97);
    for (i = 0; i < 9; i++) {                     /* 贴地草茬(疏): 只做质感, 不成簇成片 */
      var gx = h2(i * 11.3 + v * 5.1, 51.7) * T, gy = h2(i * 13.9 + v * 3.3, 57.1) * T;
      var gs = 5 + h2(i + v, 59.3) * 7;
      wrapAt(T, gx, gy, gs + 4, (function (ss, sd) {
        return function (qx, qy) { weed(x, qx, qy, ss, sd); };
      })(gs, i + v));
    }
    for (i = 0; i < 11; i++) {                    /* 石子(疏) */
      sx = h2(i * 9.1 + v * 2.7, 31.3) * T; sy = h2(i * 11.7 + v * 3.9, 37.1) * T;
      sr = 2 + h2(i + v, 41.1) * 5;
      wrapAt(T, sx, sy, sr + 4, (function (rr2, sd) {
        return function (qx, qy) { pebble(x, qx, qy, rr2, sd); };
      })(sr, i));
    }
  }
  function gTileImg(v, k) {
    return spriteImg('ground:' + v + '@' + kv(k), TILE, TILE,
      (function (vv) { return function (c, x) { bakeGroundTile(x, vv); gradeGround(x, TILE, TILE, true); }; })(v),
      true, true, k);
  }
  function gPropImg(i, v) {
    var S = Sprites(), p = PROPS[i];
    if (!S || !S.get || !p) return null;
    return S.get('p:' + p.k + ':' + v, p.w, p.h,
      function (c, x) { p.fn(x, p.w / 2, p.h / 2, v); gradeGround(x, p.w, p.h, false); },
      { pin: true, dpr: groundDpr() });
  }
  /** 暗角: 屏幕四角压暗。v5.20 起**按画布设备倍率烘**(见本段顶部"1:1 落图"):
   *   它是整屏 3.7M 像素的**带 alpha 混合 + 放大重采样**, 实测占 ~10ms —— 单独一项就顶得上半个地面。
   *   渐变按逻辑坐标写(x.setTransform(k,...)), 画布尺寸 = 视口 x k, 于是落图时缩放恒为 1。 */
  function gVignetteImg(vw, vh, k) {
    var S = Sprites();
    if (!S || !S.get) return null;
    var W2 = Math.max(1, Math.round(vw * k)), H2 = Math.max(1, Math.round(vh * k));
    return S.get('g:vign:' + vw + 'x' + vh + '@' + kv(k), W2, H2,
      function (c, x) {
        x.setTransform(k, 0, 0, k, 0, 0);
        var g = x.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.30, vw / 2, vh / 2, Math.max(vw, vh) * 0.72);
        g.addColorStop(0, 'rgba(4,6,4,0)');
        g.addColorStop(0.58, 'rgba(4,6,4,0.13)');
        g.addColorStop(0.84, 'rgba(4,6,4,0.30)');
        g.addColorStop(1, 'rgba(4,6,4,0.46)');
        x.fillStyle = g; x.fillRect(0, 0, vw, vh);
      },
      { pin: true, dpr: 1, tl: true, dim: 4096 });
  }

  /** 降级路径(无画布工厂, 微信端不该发生): 平色 + 几块软斑, 不做渐变、不建离屏画布 */
  function paintGroundFlat(ctx, cx, cy, vw, vh) {
    var i;
    ctx.fillStyle = mix(palette.groundB, palette.soil, 0.45);
    ctx.fillRect(cx, cy, vw, vh);
    for (i = 0; i < 9; i++) {
      ctx.fillStyle = rgba(i % 2 ? palette.grassDark : palette.soil, 0.06);
      ctx.beginPath();
      ctx.ellipse(cx + h2(i * 3.3, 2.1) * vw, cy + h2(i * 5.7, 4.3) * vh,
        150 + h2(i, 6.1) * 160, 95 + h2(i, 8.3) * 105, 0, 0, TAU);
      ctx.fill();
    }
  }

  var groundBaked = false;                    /* 地面是否已成功烘焙(=stats().ground) */

  /** 地面: 世界外 1 次压底 + 底色砖平铺 + 地物 + 1 张暗角, 全是 drawImage; 视口外不取 */
  PS.Art.drawGround = function (ctx, cam, world, time) {
    if (!ctx) return;
    var B = PS.Balance || {};
    var w = (world && world.w) || 2240, h = (world && world.h) || 1560;
    var vw = (cam && cam.w) || (B.VIEW && B.VIEW.w) || 1280;
    var vh = (cam && cam.h) || (B.VIEW && B.VIEW.h) || 720;
    var cx = (cam && cam.x) || 0, cy = (cam && cam.y) || 0;
    var i, j, k, x, y;
    k = groundScaleOf(ctx);                         /* 画布此刻的设备倍率: 两块地面件都照它烘 */
    noteGroundScale(k);
    var tile = gTileImg(0, k);
    if (!tile) { paintGroundFlat(ctx, cx, cy, vw, vh); return; }

    /* 世界外的底色: 相机被 game.js 夹在 [0, 世界-视口] 内(见 core/game.js 的 clamp), 所以
     *   只有"世界比视口还小"时才真的露出世界外 —— 常态下一整屏 fillRect 纯属白送。 */
    if (cx < 0 || cy < 0 || cx + vw > w || cy + vh > h) {
      ctx.fillStyle = palette.bgDeep;               /* 世界外的底色(同时封住砖缝) */
      ctx.fillRect(cx, cy, vw, vh);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(-GROUND_PAD, -GROUND_PAD, w + GROUND_PAD * 2, h + GROUND_PAD * 2);
    ctx.clip();

    /* ---- 1) 底色砖(两张变体按格轮转, 破平铺重复) ---- */
    var tx0 = Math.floor(cx / TILE), tx1 = Math.floor((cx + vw) / TILE);
    var ty0 = Math.floor(cy / TILE), ty1 = Math.floor((cy + vh) / TILE);
    for (j = ty0; j <= ty1; j++) {
      y = j * TILE;
      for (i = tx0; i <= tx1; i++) {
        var tv = (((i + j) % TILE_VARIANTS) + TILE_VARIANTS) % TILE_VARIANTS;
        var tim = tv ? gTileImg(tv, k) : tile;
        blit1to1(ctx, tim || tile, k, i * TILE, y, TILE, TILE);
      }
    }

    /* ---- 2) 地物: 抖动网格 + 哈希散布, 一格最多一件, 出生点周围留白 ---- */
    var ci0 = Math.floor(cx / PROP_CELL), ci1 = Math.floor((cx + vw) / PROP_CELL);
    var cj0 = Math.floor(cy / PROP_CELL), cj1 = Math.floor((cy + vh) / PROP_CELL);
    /* v53: PROPS 已按用户要求清空 -> 名录为空时整段短路(上界 < 下界, for 体一次都不进):
     *   不做无谓的全视口哈希, 也杜绝 (h2() * 0) | 0 / 取模 0 / 除零 这类 NaN 来源。 */
    if (!PROPS.length) { cj0 = 1; cj1 = 0; }
    for (j = cj0; j <= cj1; j++) {
      for (i = ci0; i <= ci1; i++) {
        var sd = i * 131 + j * 977 + 5;
        if (h2(sd * 3.7, 1.3) > PROP_HIT) continue;
        var pi = (h2(sd * 5.1, 7.9) * PROPS.length) | 0;
        var p = PROPS[pi];
        if (!p) continue;
        var px = i * PROP_CELL + PROP_CELL * 0.5 + (h2(sd * 1.9, 3.1) - 0.5) * PROP_CELL * 0.5;
        var py = j * PROP_CELL + PROP_CELL * 0.5 + (h2(sd * 2.7, 5.7) - 0.5) * PROP_CELL * 0.5;
        if (Math.abs(px - w / 2) < SPAWN_CLEAR && Math.abs(py - h / 2) < SPAWN_CLEAR) continue;
        if (px + p.w < cx || px - p.w > cx + vw) continue;
        if (py + p.h < cy || py - p.h > cy + vh) continue;
        var pimg = gPropImg(pi, h2(sd * 1.3, 9.9) > 0.5 ? 1 : 0);
        if (!pimg) continue;
        ctx.drawImage(pimg, px - p.w / 2, py - p.h / 2, p.w, p.h);
      }
    }
    ctx.restore();

    /* ---- 3) 暗角: 在世界之外画(视口整幅, 包括世界边界外的暗底), 于是边缘不会突然亮起来 ---- */
    var vg = gVignetteImg(vw, vh, k);
    blit1to1(ctx, vg, k, cx, cy, vw, vh);
    groundBaked = true;
  };
  /* ============================ 自省 / 复位 ============================ */
  /** 统计: 精灵缓存 + 地面是否已烘焙 + 角色专用槽位数(排障/验收用, 与 v3.0 同签名) */
  PS.Art.stats = function () {
    var S = Sprites();
    var s = (S && S.stats) ? S.stats() : { hit: 0, miss: 0, slots: 0 };
    var nc = 0, m = S && S._map, kk;
    for (kk in m) if (kk.charAt(0) === 'c' && kk.charAt(1) === ':') nc++;
    return { sprite: s, ground: groundBaked, charSlots: nc, groundScale: groundScaleNow };
  };
  /** 门禁/探针用: 地面烘焙倍率与画布此刻倍率是否一致(= 落图是否真的 1:1)。
   *   只读, 不参与任何绘制与判定。 */
  PS.Art.groundInfo = function (ctx) {
    var live = ctx ? groundScaleOf(ctx) : 0;
    return {
      baked: groundScaleNow, tileW: Math.round(TILE * groundScaleNow),
      live: live, oneToOne: !!groundScaleNow && (!live || Math.abs(live - groundScaleNow) < 1e-6)
    };
  };
  /** 复位全部缓存(换局/换关卡时调用): 地面砖与角色槽一起清, 下次绘制按需重烘 */
  PS.Art.reset = function () {
    groundBaked = false;
    groundScaleNow = 0;
    var S = Sprites();
    if (S && S.reset) S.reset();
  };
  PS.Art.helpers = { h2: h2, shade: shade, rgba: rgba, clamp: clamp, meta: meta };
  /* 位图资产层(PS.Atlas)接入用: 把 paintEnemy 里"围在位图外面"的那几件(接触阴影 /
   * 精英光环 / Boss 红雾 / 冰冻霜壳 / 形体元数据)按**同一个顺序**暴露出去。
   * 为什么暴露而不是让 atlas.js 自己重画一遍: 这些是程序化美术的既有观感, 重画就会漂移。
   * 只读引用, 不改变任何现有绘制路径。 */
  PS.Art.bits = {
    shadow: groundShadow, ring: tierRing, glow: tierGlow,
    /* 结构体位图化(v6.8)之后, atlas.js 需要知道「槽位里该不该补接触阴影」——这里**显式说明不补**:
     * drawStruct/drawMine 已经把阴影画在精灵之外了, atlas.js 再补一次会长出两层影子。 */
    struct: { ext: STRUCT_EXT, spec: structSpriteSpec, paint: paintStruct, paintMine: paintMine, shadow: groundShadowAt },
    frost: frostShell, meta: meta, spec: spriteSpec, charSpec: charSpec,
    /* 武器实心化(alpha 二值化 + 材质彩度下限)。**必须**一起暴露: 位图路径命中 PS.Atlas 时
     * drawFn 被短路, wnBake 里的 wnSolidify 从来不会跑 —— 于是位图武器永远带一圈半透明软边
     * (用户投诉的「透明效果」), 而且材质彩度没有下限。2026-09-28 实测: 藏掉图集走程序化
     * 路径时半透明 0.0%, 接上位图立刻 3.9%~6.7%(verify-weapon-vis [2] 直接红)。 */
    solidify: function (ctxOrCanvas) {
      var c = (ctxOrCanvas && ctxOrCanvas.canvas) || ctxOrCanvas;
      wnSolidify(c);
    },
    gradeWeapon: wnGradePix
  };
  /** 角色建模开关(ui.js 老建模的兜底开关; 置 false 可临时回到 ui.js 的 drawCharModel) */
  PS.Art.useCharModel = true;

  /* ui.js 是下一个 <script>, 因此下一轮事件循环再接线(找不到则重试, 不阻塞加载) */
  if (typeof global.setTimeout === 'function') global.setTimeout(tryInstallCharModels, 0);

  global.PS = PS;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
