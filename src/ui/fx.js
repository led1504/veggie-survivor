/* PS.FX v4.0 —— 特效系统(世界坐标, 由 UI 层负责镜头变换)
 * ===========================================================================
 * 落地 qa/art-direction.md §5「VFX 语言」的反馈族: 命中 / 暴击 / 灼烧 / 冰冻 / 拾取 / 升级 /
 * 击杀 / 受击, 每一条都要**一眼看出发生了什么**, 而不是一团彩色圆点。
 *
 * 性能契约(v4.0 的核心改动): 热路径**禁止** beginPath+arc+fill 逐颗粒子现画。
 *   所有粒子形状(dot/star/ember/frost/shard/ring/slash/dash)在第一次用到时经
 *   PS.Sprites 烘焙成离屏画布, 之后每颗粒子只花 1 次 drawImage。形状 key 只由
 *   **颜色 + 形状类**组成(半径走 drawImage 缩放, 不进 key) —— 槽位有界, 不会 key 爆炸。
 *   预算以 src/data/balance.js 的 PS.Balance.FX 为权威(particlesMax 300 / dmgNumMax 70 /
 *   hitStop 0.05 / shakeMax 12 / corpseFade 0.55), 本文件不硬编码第二套数字。
 *
 * 职责边界(别越界): 本文件只决定 **数量 / 时长 / 物理 / 颜色 / 形状类**; 数组名与元素字段名
 *   一律保持不变(ui.js 与 platform/weapp.js 都直接读):
 *   parts     {x,y,vx,vy,life,maxLife,r,color}    + 本文件新增 k(形状类, 见 KIND)
 *   shards    {x,y,vx,vy,rot,vr,life,maxLife,size,color}   击杀碎片(带重力 240px/s^2)
 *   nums      {x,y,vy,life,text,color,crit,size}   伤害飘字
 *   swings    {x,y,ang,arc,range,life,maxLife,color}
 *     + v5.19 附加: style(招式名, 见五·A 的 MEL) · kind(6 个几何族) · family/shape(身份) · tier
 *       旧画法读到未知字段会忽略, 所以缺这四个字段时画面照样正确(只是退回通用斩击)。
 *   rings     {x,y,r,maxR,life,maxLife,color}
 *   dashLines {x,y,ang,life,maxLife}
 *   corpses   {x,y,r,color,life}
 *   bolts     {x,y,ang,len,w,vx,vy,vr,grow,a0,life,maxLife,color,k,sk}  武器开火侧朝向图元
 *   sparks    {x,y,ang,len,w,vx,vy,vr,grow,a0,life,maxLife,color,k,sk}  武器命中侧朝向图元
 *     ↑ v4.1「武器攻击特效层」新增的两条: len/w = 长短边(落图时拉伸, **不进 key**); sk = 预算好的缓存 key;
 *       grow/a0/vr = 随寿命张开 / 基础透明度 / 自转。字段同样是"附加"性质, 老画法读到会忽略。
 *   k 是**附加**字段: 老渲染方(ui.js 的逐帧 arc 路径)读到未知字段会直接忽略, 所以
 *   即使本文件的离屏渲染没接上, 画面照样正确 —— 只是慢一点。
 *
 * 渲染接线(install): ui.js 归 UI 设计智能体所有, 本文件不改它。做法是**运行期包装**:
 *   UI.drawWorld 进入时把 8 个几何数组(含新增的 bolts/sparks)换成空数组(ui.js 的逐帧现画因此空转 0 次),
 *   然后在 UI.drawPlayer 里(与 ui.js 原有顺序一致: 敌人/弹幕之后, 玩家之前)调用
 *   PS.FX.render(ctx) 用缓存精灵补画。任何异常都会**自动卸载包装**并退回 ui.js 原生画法,
 *   不允许出现"特效整层消失"。
 *   若 ui.js 之后愿意直接调用 PS.FX.render(this.ctx), 本文件同样工作(install 检测到已接管就跳过)。
 *
 * 性能: 全部走对象池 —— 数组里放的是复用对象, 生命周期结束时回收进 _spare, 热路径上几乎
 *   不再 new 短命对象(旧实现每次命中 new 5 个 + 每次击杀 new 18 个, 一局几十万次 GC 压力)。
 *   单帧活跃图元总数(parts + bolts + sparks)上限 = B.FX.particlesMax, 超出直接丢弃(R5.1)。
 *   三张表**共用**这一份预算: 各自计数会让总图元数突破上限(实测 303/300)。
 */
(function (global) {
  'use strict';
  var PS = global.PS || {};
  var B = PS.Balance;
  var TAU = Math.PI * 2;
  var SPARE_KEEP = 96;      /* 每种池最多留多少空壳备用, 防静默涨内存 */
  var SHARD_MAX = 144;      /* 击杀碎片同屏上限(碎片与粒子分开计数, 但不许无限涨) */
  /* 形状类: 决定这一颗粒子用哪张烘焙图 */
  var K_DOT = 0, K_STAR = 1, K_EMBER = 2, K_FROST = 3, K_SHARD = 4, K_SPARK = 5;
  /* 朝向性图元的形状类(独立命名空间, 与上面的 K_* 粒子形状无关)。
   * 为什么另起一套: 粒子是"圆点物理", 表达不了有方向的图元(光轴/拖尾/锥/刀痕), 必须带 ang + 长宽。 */
  var D_FLASH = 0, D_LANCE = 1, D_BEAM = 2, D_TRAIL = 3, D_CONE = 4, D_BURST = 5, D_SPARKD = 6, D_SLASH = 7, D_SAW = 8;
  /* 每个 kind 的烘焙盒: 尺寸固定 → 长度/宽度全靠 drawImage 拉伸, 因此**不进 key**(key 只有 kind+color)。
   * tl=左上角原点(方向图元在 x∈[0,w] 内展开) · ax: 0=中心锚点 1=起点锚点 */
  var D_KIND = [
    { w: 32, h: 32, tl: false, ax: 0 },   /* 0 FLASH  枪口星芒 */
    { w: 56, h: 16, tl: true, ax: 1 },    /* 1 LANCE  单发细长闪光 */
    { w: 64, h: 20, tl: true, ax: 1 },    /* 2 BEAM   光轴 */
    { w: 44, h: 12, tl: true, ax: 1 },    /* 3 TRAIL  拖尾短线 */
    { w: 44, h: 32, tl: true, ax: 1 },    /* 4 CONE   锥形余烬 */
    { w: 44, h: 44, tl: false, ax: 0 },   /* 5 BURST  大团余烬 */
    { w: 32, h: 14, tl: true, ax: 1 },    /* 6 SPARKD 方向性火花 */
    { w: 48, h: 22, tl: true, ax: 1 },    /* 7 SLASH  刀痕 */
    { w: 36, h: 26, tl: true, ax: 1 }     /* 8 SAW    锯齿弧 */
  ];
  var O_TL = { tl: true };   /* 共享只读 opts: 避免每个图元每帧 new 一个字面量对象 */
  /* 色板(唯一真源): 元素 4 色 + 金属 3 色 + 白/金。色值全部收敛到这里 → 烘焙 key 才有界 */
  var ELEM_COLORS = ['#ff8a3a', '#8fd8ff', '#ffe86a', '#a8e06a'];   /* 火 / 冰 / 雷 / 毒 */
  var ELEM_OF = { flamer: 0, launcher: 0, axe: 0, hammer: 0, wand: 3, mace: 3, saw: 2, spear: 2, pistol: 2, rifle: 2, shotgun: 2, blade: 1, machete: 1 };
  var METAL_HI = '#ffe9a8', METAL_MID = '#e8c76a', METAL_DEEP = '#e8b45a';
  var WHITE = '#ffffff', GOLD = '#ffd24a', FIRE = '#ff8a3a';
  var NOINFO = {};   /* 共享默认 info: 兜底路径不分配对象(热路径 discipline) */

  function rnd(a, b) { return a + Math.random() * (b - a); }
  /* 颜色串 → rgba 串(本文件只做这一件颜色加工, 避免依赖 art.js 的 helper) */
  function fade(hex, a) {
    var s = String(hex || '#000').replace('#', ''), n, r, g, b;
    if (s.length === 3) s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
    n = parseInt(s, 16);
    if (!isFinite(n)) n = 0xffffff;
    r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  function bucket(v, step) { return Math.max(1, Math.round(v / step)) * step; }
  /* v5.19d(Codex, 2026-09-29): 视口裁剪判据 —— 与 src/ui/ui.js 的 UI.inCull 同一口径
   *   (实体保守包围盒 与「视口 + B.FX.cullMargin」不相交才算在画外)。
   *   C 为 null(没有视口信息)时**一律不裁**: 直接调 PS.FX.render 的探针/门禁自己摆场景,
   *   它们因此完全不受影响(像素/张数断言口径不变)。 */
  function cullOut(C, x, y, r) {
    return !!C && (x + r < C.x0 || x - r > C.x1 || y + r < C.y0 || y - r > C.y1);
  }
  /* tier 只允许 1..4; 未知/缺失一律当 1 —— 绝不让 NaN/undefined 渗进尺寸与寿命数学 */
  function tierOf(t) { t = t | 0; return (t >= 1 && t <= 4) ? t : 1; }
  /* shape → 元素色。表里没有的形状(含 undefined)统一走火色 —— 色板封闭, key 才不涨 */
  function elemColor(shape) {
    var i = Object.prototype.hasOwnProperty.call(ELEM_OF, shape) ? ELEM_OF[shape] : 0;
    return ELEM_COLORS[i];
  }
  /* ==================== 五·A 近战挥击招式层(v5.19, 2026-09-29) ====================
   * 事故(用户逐字): 「所有近战武器攻击特效重新设计，现有的完全不合理」。
   * 根因(实读代码, 不是猜): combat.js 只调 g.fx.swing(x, y, ang, range, arc, color), 而 bakeSlash
   *   **只有一种几何** —— 内外半径 0.52r/1.0r 的对称扇环 + 一圈白线。于是 36 个近战家族(锤 / 矛 /
   *   拳套 / 镰 / 钻 / 剪刀 / 木板 / 火把 …)打出来的是**同一道金色月牙**, 只有半径(range)与
   *   张角(arc)不同。与 09-28 那次「61 族武器全长成一把铲子」是同一个病: 拿一个形状套所有身份。
   * 修法: 招式走**家族表** MEL_FAMILY(36 族逐族一条); 家族缺项才退到形状表 MEL_SHAPE;
   *   两张表都没有 → 记一次 _melMiss 并退 'cleave', 同时 meleeAudit() 如实报出缺项(不静默)。
   * 招式 = 一条参数(MEL), 由 6 个烘焙器之一画: arc 扇环 / fan 近身冲击 / lance 突刺 /
   *   claw 爪痕 / snip 剪 / spin 齿弧。剂量与旧实现同级: 每道挥击仍是 1 次 drawImage。
   */
  var MEL = {
    /* r0 内径 · r1 外径(以射程为单位) · a0 内缘透明度 · a1 外缘透明度 · edge 刃口白线宽(0=无)
     * spin 这道招式会挥过的角度(rad) · tint 本色 · w 侧向半宽(突刺/冲击类用)
     * 附加: blunt 外缘钝头(不渐隐) · wedge 浓度沿挥过方向拉斜(劈砍) · chord 外缘拉平成直边(平板)
     *       fringe 外缘齿数(钝器/尖刺) · ember 带余烬点(火) · teeth 爪/齿条数 · tw 齿的半宽(claw)
     *       tn 根部半宽/头部半宽(lance: 接近 1 = 等宽细锋, 很小 = 尾细头宽的骑枪) · edgeCol 冲击弧线色
     * 改招式参数前先看 qa/verify-melee-fx.cjs 的 EXPECT 表 —— 那里把 36 族的招式**钉死**了。 */
    slash:    { k:'arc',   r0:0.64, r1:1.00, a0:0.04, a1:0.95, edge:1.8, spin:0.66, tint:'#f4f8ff' },
    holy:     { k:'arc',   r0:0.42, r1:1.00, a0:0.05, a1:0.92, edge:2.2, spin:0.80, tint:'#ffe9a8' },
    cleave:   { k:'arc',   r0:0.48, r1:1.00, a0:0.10, a1:0.88, edge:1.5, spin:0.52, tint:'#f0d79a', wedge:1 },
    hook:     { k:'arc',   r0:0.56, r1:1.00, a0:0.08, a1:0.88, edge:1.5, spin:0.74, tint:'#e6ecd4', wedge:1 },
    reap:     { k:'arc',   r0:0.24, r1:1.00, a0:0.03, a1:0.78, edge:1.9, spin:1.00, tint:'#dcecc6' },
    chop:     { k:'arc',   r0:0.56, r1:0.94, a0:0.10, a1:0.96, edge:1.5, spin:0.34, tint:'#f2cf9a', wedge:1, chord:1 },
    smash:    { k:'arc',   r0:0.64, r1:1.00, a0:0.34, a1:0.86, edge:0,   spin:0.30, tint:'#d8c08a', blunt:1 },
    plow:     { k:'arc',   r0:0.74, r1:1.00, a0:0.05, a1:0.90, edge:2.6, spin:0.44, tint:'#d6c49c', wedge:1 },
    bludgeon: { k:'arc',   r0:0.46, r1:1.00, a0:0.14, a1:0.62, edge:0,  spin:0.44, tint:'#c9b283', fringe:9, blunt:1 },
    bash:     { k:'arc',   r0:0.30, r1:1.00, a0:0.40, a1:0.78, edge:1.2, spin:0.30, tint:'#c9b283', fringe:6, blunt:1 },
    club:     { k:'arc',   r0:0.30, r1:1.00, a0:0.06, a1:0.42, edge:0.7, spin:0.48, tint:'#c9b283', blunt:1 },
    board:    { k:'arc',   r0:0.60, r1:1.00, a0:0.10, a1:0.72, edge:1.0, spin:0.30, tint:'#cbb189', chord:1 },
    brand:    { k:'arc',   r0:0.62, r1:1.00, a0:0.18, a1:0.96, edge:0,   spin:0.40, tint:'#ff9a3a', wedge:1, ember:1, fringe:5 },
    hurl:     { k:'fan',   r1:1.00, a1:0.80, spin:0.18, tint:'#c9b283', w:0.18 },
    punch:    { k:'fan',   r1:0.74, a1:0.95, spin:0.12, tint:'#ffe0a0', w:0.20, edgeCol:'#fff6d8' },
    palm:     { k:'fan',   r1:0.92, a1:0.90, spin:0.26, tint:'#ffe8b8', w:0.24, edgeCol:'#fff6d8' },
    thrust:   { k:'lance', r1:1.00, a1:0.95, spin:0.06, tint:'#f4f8ff', w:0.078, tn:0.20 },
    joust:    { k:'lance', r1:1.00, a1:0.95, spin:0.06, tint:'#f2e6c4', w:0.046, tn:0.86 },
    rake:     { k:'claw',  r1:1.00, a1:0.92, spin:0.50, tint:'#e8dcc0', teeth:3, tw:0.030 },
    fang:     { k:'claw',  r1:0.64, a1:0.95, spin:0.34, tint:'#f4ead2', teeth:2, tw:0.060 },
    snip:     { k:'snip',  r1:0.70, a1:0.95, spin:0.22, tint:'#e2ecd2' },
    spin:     { k:'spin',  r1:1.00, a1:0.80, spin:0.30, tint:'#e8c76a', teeth:10 }
  };
  /* 家族 → 招式。36 个近战家族逐族一条 —— 这是常规路径 */
  var MEL_FAMILY = {
    sword:'slash', knife:'slash', dagger:'slash',
    excalibur:'holy', vorpal_sword:'holy', thunder_sword:'holy',
    sharp_tooth:'fang',
    chopper:'cleave', pruner:'hook', scythe:'reap', scissors:'snip',
    hatchet:'chop', ghost_axe:'chop',
    hammer:'smash', plasma_sledgehammer:'smash', wrench:'smash', dextroyer:'plow',
    stick:'bludgeon', cactus_mace:'bludgeon', spiky_shield:'bash', rock:'hurl',
    torch:'brand', ghost_flint:'brand', fighting_stick:'club', plank:'board',
    fist:'punch', power_fist:'punch', flaming_knuckles:'punch', hand:'palm',
    spear:'thrust', screwdriver:'thrust', lightning_shiv:'thrust', jousting_lance:'joust',
    claw:'rake', circular_saw:'spin', drill:'spin'
  };
  /* 形状 → 招式: 只在家族表缺项时兜底(形状来自 art.js 的 weaponShape, 是特效语言) */
  var MEL_SHAPE = {
    blade:'slash', fang:'fang', machete:'cleave', axe:'chop', hammer:'smash',
    mace:'bludgeon', club:'club', board:'board', torch:'brand', fist:'punch',
    spear:'thrust', saw:'spin'
  };
  var MEL_FALLBACK = 'cleave';
  var _melMiss = 0, _melMissList = [];
  /** 一族用哪招: 家族表 → 形状表 → 兜底(并记 miss, meleeAudit 会报出来) */
  function melOf(o) {
    var st = o && o.family ? MEL_FAMILY[o.family] : null;
    if (!st && o) st = MEL_SHAPE[o.shape];
    if (!st) {
      /* 只有带家族名的调用才计入缺项: 旧 swing(x,y,ang,range,arc,color) 不带身份, 不该污染审计 */
      if (o && o.family) {
        _melMiss++;
        if (_melMissList.indexOf(o.family) < 0 && _melMissList.length < 24) _melMissList.push(o.family);
      }
      st = MEL_FALLBACK;
    }
    return st;
  }

  /* ---- 6 个挥击烘焙器: 只在首次用到时画一次, 之后每道挥击 1 次 drawImage ---- */
  /** 扇环: 斩 / 劈 / 抡 / 横扫 / 镰 / 剪之外的绝大多数近战 */
  function melArc(st, color, arc, range) {
    return function (c, x) {
      var r0 = Math.max(4, range * st.r0), r1 = Math.max(9, range * st.r1), h = arc / 2, i;
      var gg;
      if (st.wedge) {
        /* 劈砍: 浓度沿**挥过方向**拉斜 → 起手淡、收手亮, 一眼看出是「劈下去」而不是「亮了个圈」 */
        gg = x.createLinearGradient(Math.cos(-h) * r1, Math.sin(-h) * r1, Math.cos(h) * r1, Math.sin(h) * r1);
        gg.addColorStop(0, fade(color, st.a0 * 0.35));
        gg.addColorStop(0.55, fade(color, st.a1 * 0.72));
        gg.addColorStop(1, fade(color, st.a1));
      } else {
        gg = x.createRadialGradient(0, 0, r0, 0, 0, r1);
        gg.addColorStop(0, fade(color, st.a0));
        gg.addColorStop(0.62, fade(color, st.a1 * (st.blunt ? 0.9 : 0.8)));
        gg.addColorStop(1, st.blunt ? fade(color, st.a1) : 'rgba(0,0,0,0)');
      }
      x.beginPath();
      if (st.chord) {
        /* 平板: 外缘拉成直边(厚木板扫过去是一条板, 不是一段弧) */
        x.arc(0, 0, r0, h, -h, true);
        x.lineTo(Math.cos(-h) * r1, Math.sin(-h) * r1);
        x.lineTo(Math.cos(h) * r1, Math.sin(h) * r1);
      } else {
        x.arc(0, 0, r1, -h, h);
        x.arc(0, 0, r0, h, -h, true);
      }
      x.closePath();
      x.fillStyle = gg; x.fill();
      if (st.edge > 0) {
        x.strokeStyle = fade('#ffffff', 0.5); x.lineWidth = st.edge;
        x.beginPath(); x.arc(0, 0, r1 * 0.95, -h * 0.96, h * 0.96); x.stroke();
      }
      if (st.fringe) {
        x.fillStyle = fade(color, Math.min(1, st.a1 + 0.08));
        for (i = 0; i < st.fringe; i++) {
          var a = -h + (i + 0.5) / st.fringe * arc;
          x.beginPath();
          x.moveTo(Math.cos(a - 0.10) * r1 * 0.99, Math.sin(a - 0.10) * r1 * 0.99);
          x.lineTo(Math.cos(a) * r1 * 1.30, Math.sin(a) * r1 * 1.30);
          x.lineTo(Math.cos(a + 0.10) * r1 * 0.99, Math.sin(a + 0.10) * r1 * 0.99);
          x.closePath(); x.fill();
        }
      }
      if (st.ember) {
        x.fillStyle = fade('#ffd88a', 0.9);
        for (i = 0; i < 5; i++) {
          var ae = rnd(-h, h), re = rnd(r0, r1 * 1.12);
          x.beginPath(); x.arc(Math.cos(ae) * re, Math.sin(ae) * re, 1.2 + (i % 3) * 0.7, 0, TAU); x.fill();
        }
      }
    };
  }
  /** 突刺: 沿瞄准线的一根锥形枪锋(长杆矛 / 冲阵长枪 / 螺丝刀) */
  function melLance(st, color, arc, range) {
    return function (c, x) {
      var L = Math.max(14, range * st.r1), W = Math.max(3.2, range * (st.w || 0.05));
      var g = x.createLinearGradient(0, 0, L, 0);
      g.addColorStop(0, fade(color, 0.06));
      g.addColorStop(0.5, fade(color, st.a1 * 0.55));
      g.addColorStop(0.86, fade(color, st.a1));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.beginPath();
      var tn = st.tn || 0.30;   /* 根部半宽 / 头部半宽: 长杆矛接近 1(等宽细锋), 冲阵长枪很小(尾细头宽的骑枪) */
      x.moveTo(L * 0.10, -W * tn);
      x.lineTo(L * 0.84, -W);
      x.lineTo(L, 0);
      x.lineTo(L * 0.84, W);
      x.lineTo(L * 0.10, W * tn);
      x.closePath(); x.fill();
      x.strokeStyle = fade('#ffffff', 0.55); x.lineWidth = Math.max(1, W * 0.24);
      x.beginPath(); x.moveTo(L * 0.18, 0); x.lineTo(L * 0.98, 0); x.stroke();
    };
  }
  /** 近身冲击: 拳套 / 铁砂掌 / 投掷 / 钝器的「顶住」感 —— 不做月牙 */
  function melFan(st, color, arc, range) {
    return function (c, x) {
      var R = Math.max(10, range * st.r1);
      var h = Math.max(0.32, Math.min(1.05, arc * 0.5));
      var g = x.createRadialGradient(0, 0, 0, 0, 0, R);
      g.addColorStop(0, fade(color, st.a1 * 0.95));
      g.addColorStop(0.42, fade(color, st.a1 * 0.42));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, R, -h, h); x.closePath(); x.fill();
      x.strokeStyle = fade(st.edgeCol || '#ffffff', 0.42); x.lineWidth = Math.max(1.5, R * 0.075);
      x.beginPath(); x.arc(0, 0, R * 0.82, -h * 0.78, h * 0.78); x.stroke();
    };
  }
  /** 爪痕: n 道并行锥痕(三齿钢耙 / 尖牙短刃) */
  function melClaw(st, color, arc, range) {
    return function (c, x) {
      var L = Math.max(12, range * st.r1), n = st.teeth || 3, i, a;
      var h = Math.max(0.5, arc * 0.5);
      for (i = 0; i < n; i++) {
        a = (n === 1) ? 0 : (i / (n - 1) - 0.5) * h * 2;
        x.save(); x.rotate(a);
        var g = x.createLinearGradient(0, 0, L, 0);
        g.addColorStop(0, fade(color, 0.10));
        g.addColorStop(0.7, fade(color, st.a1 * 0.8));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g;
        var tw = st.tw || 0.030;   /* 齿的半宽(以射程为单位): 钢耙细 / 尖牙粗 */
        x.beginPath();
        x.moveTo(L * 0.14, -L * tw);
        x.lineTo(L * 0.96, -L * tw * 0.53);
        x.lineTo(L, 0);
        x.lineTo(L * 0.96, L * tw * 0.53);
        x.lineTo(L * 0.14, L * tw);
        x.closePath(); x.fill();
        x.restore();
      }
    };
  }
  /** 剪: 两片短刃从张到合 —— 一眼看出是「剪」而不是「砍」 */
  function melSnip(st, color, arc, range) {
    return function (c, x) {
      var L = Math.max(10, range * st.r1), i;
      for (i = 0; i < 2; i++) {
        var sg = i ? 1 : -1;
        var g = x.createLinearGradient(0, 0, L, 0);
        g.addColorStop(0, fade(color, 0.12));
        g.addColorStop(1, fade(color, st.a1));
        x.fillStyle = g;
        x.beginPath();
        x.moveTo(L * 0.16, sg * L * 0.34 + sg * 0.6);
        x.lineTo(L * 0.92, sg * L * 0.10);
        x.lineTo(L * 0.92, sg * L * 0.20);
        x.lineTo(L * 0.16, sg * L * 0.46);
        x.closePath(); x.fill();
      }
    };
  }
  /** 齿弧: 环绕武器(圆盘锯 / 穿心钻)蹭过去的一排齿 */
  function melSpin(st, color, arc, range) {
    return function (c, x) {
      var R = Math.max(9, range * st.r1), n = st.teeth || 10, i, a;
      var h = Math.max(0.5, Math.min(1.6, arc));
      x.fillStyle = fade(color, st.a1);
      for (i = 0; i < n; i++) {
        a = -h + (i + 0.5) / n * h * 2;
        x.beginPath();
        x.moveTo(Math.cos(a - 0.16) * 0.62 * R, Math.sin(a - 0.16) * 0.62 * R);
        x.lineTo(Math.cos(a) * R, Math.sin(a) * R);
        x.lineTo(Math.cos(a + 0.16) * 0.62 * R, Math.sin(a + 0.16) * 0.62 * R);
        x.closePath(); x.fill();
      }
      x.strokeStyle = fade('#ffffff', 0.35); x.lineWidth = 1.2;
      x.beginPath(); x.arc(0, 0, R * 0.74, -h, h); x.stroke();
    };
  }
  function melFn(st, color, arc, range) {
    if (st.k === 'lance') return melLance(st, color, arc, range);
    if (st.k === 'fan') return melFan(st, color, arc, range);
    if (st.k === 'claw') return melClaw(st, color, arc, range);
    if (st.k === 'snip') return melSnip(st, color, arc, range);
    if (st.k === 'spin') return melSpin(st, color, arc, range);
    return melArc(st, color, arc, range);
  }
  /** 现画兜底(烘焙拿不到时才走): 与 6 个烘焙器**同一套参数**, 保证「降级只掉画质不掉语义」。
   * 为什么必须有: 精灵烘焙有画布尺寸上限(sprites.js MAX_DIM=1024), 烘焙边长 2*rb+24 > 1024 时
   *   S.get 直接返回 null。射程 >= 498px 的近战会命中这条分支 —— 长杆尖矛 IV 本体射程就是 500;
   *   而任何 400 射程的近战吃了射程道具(射程 +80/件, 见 items.js 的 rangeFlat)也会越界。
   *   旧写法 if (!img) continue 让**整条挥击弧静默消失** ⇒ 近战玩家看到的就是「近战没有攻击特效」。
   * 代价只在极端射程上: 几次 path 操作, 不参与每帧热路径(常规射程全走 1 次 drawImage)。 */
  function melDrawFree(ctx, st, color, arc, range) {
    var r0 = Math.max(4, range * (st.r0 || 0.5)), r1 = Math.max(9, range * (st.r1 || 1)), h = arc / 2;
    if (st.k === 'lance') {
      ctx.strokeStyle = fade(color, 0.8); ctx.lineWidth = Math.max(3, range * (st.w || 0.05) * 1.6);
      ctx.beginPath(); ctx.moveTo(range * 0.12, 0); ctx.lineTo(r1 * 0.96, 0); ctx.stroke();
      ctx.strokeStyle = fade('#ffffff', 0.5); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(range * 0.2, 0); ctx.lineTo(r1 * 0.98, 0); ctx.stroke();
      return;
    }
    if (st.k === 'fan' || st.k === 'spin') {
      ctx.strokeStyle = fade(color, 0.7); ctx.lineWidth = Math.max(3, r1 * 0.14);
      ctx.beginPath(); ctx.arc(0, 0, r1 * 0.8, -h, h); ctx.stroke();
      return;
    }
    if (st.k === 'claw') {
      /* n 道并行锥痕: 齿数与粗细都从招式表读, 兜底也认得出是爪不是刀 */
      var cn = st.teeth || 3, ctw = st.tw || 0.030, ci, ca, ch = Math.max(0.5, arc * 0.5);
      ctx.strokeStyle = fade(color, 0.8);
      for (ci = 0; ci < cn; ci++) {
        ca = (cn === 1) ? 0 : (ci / (cn - 1) - 0.5) * ch * 2;
        ctx.save(); ctx.rotate(ca);
        ctx.lineWidth = Math.max(1.5, r1 * ctw * 1.5);
        ctx.beginPath(); ctx.moveTo(r1 * 0.14, 0); ctx.lineTo(r1 * 0.96, 0); ctx.stroke();
        ctx.restore();
      }
      return;
    }
    if (st.k === 'snip') {
      /* 两片短刃从张到合: 兜底也要有两条, 不能塌成一条 */
      var sl = Math.max(10, r1), sj, sg;
      ctx.strokeStyle = fade(color, 0.85);
      for (sj = 0; sj < 2; sj++) {
        sg = sj ? 1 : -1;
        ctx.lineWidth = Math.max(2, sl * 0.09);
        ctx.beginPath();
        ctx.moveTo(sl * 0.16, sg * sl * 0.34);
        ctx.lineTo(sl * 0.92, sg * sl * 0.14);
        ctx.stroke();
      }
      return;
    }
    ctx.beginPath();
    ctx.arc(0, 0, (r0 + r1) * 0.5, -h, h);
    ctx.strokeStyle = fade(color, 0.72);
    ctx.lineWidth = Math.max(2, r1 - r0);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r1 * 0.95, -h, h);
    ctx.strokeStyle = fade('#ffffff', 0.5); ctx.lineWidth = 2; ctx.stroke();
  }

  PS.FX = {
    _live: null,        /* 包装期内指向"真正的数组"(见 install) */
    _err: null,
    installed: false,

    init: function () {
      this.parts = [];
      this.nums = [];
      this.swings = [];
      this.rings = [];
      this.dashLines = [];
      this.corpses = [];
      this.shards = [];
      this.bolts = [];     /* 开火侧朝向图元(枪口闪光 / 光轴 / 拖尾 / 锥形余烬) */
      this.sparks = [];    /* 命中侧朝向图元(方向火花 / 刀痕 / 锯齿弧) */
      this._spare = { parts: [], nums: [], swings: [], rings: [], dashLines: [], corpses: [], shards: [], bolts: [], sparks: [] };
    },
    clear: function () { this.init(); },
    /* 兼容旧接线/旧存档: 缺数组时补一次 init。空数组是 truthy, 所以 install 换空数组期间不会误触发 */
    _ready: function () { if (!this.parts || !this.bolts || !this.sparks) this.init(); },

    /* ---- 对象池 ---- */
    _take: function (kind) {
      var sp = this._spare[kind];
      return sp.length ? sp.pop() : {};
    },
    _free: function (kind, o) {
      var sp = this._spare[kind];
      if (sp.length < SPARE_KEEP) sp.push(o);
    },
    /** 通用粒子: 到达上限直接丢弃(不是排队, 保证单帧有界) */
    _part: function (x, y, vx, vy, life, r, color, k) {
      /* 预算必须与朝向图元合在一起数, 否则 parts 能独占满 300 再叠 bolts/sparks → 总数超上限 */
      if (this._fxTotal() >= B.FX.particlesMax) return null;
      var o = this._take('parts');
      o.x = x; o.y = y; o.vx = vx; o.vy = vy;
      o.life = life; o.maxLife = life; o.r = r; o.color = color;
      o.k = k || K_DOT;
      this.parts.push(o);
      return o;
    },
    /** 单帧总图元预算: parts + bolts + sparks 一起数。
     * 为什么一起数: 各自计数 = 命中粒子与武器特效各吃满一份 particlesMax, 总图元会翻倍(旧版隐患)。 */
    _fxTotal: function () { return this.parts.length + this.bolts.length + this.sparks.length; },
    /** 有朝向的图元工厂(arr 只能是 'bolts'/'sparks'); 预算满直接丢弃 —— 小剂量靠调用频率堆持续感。
     * 缓存 key 在这里算好挂在元素上, 渲染期不再拼字符串(与粒子 k 同一套"附加字段"纪律, 老画法会忽略)。 */
    _dir: function (arr, x, y, ang, len, w, life, color, kind) {
      if (this._fxTotal() >= B.FX.particlesMax) return null;
      var o = this._take(arr);
      o.x = x; o.y = y; o.ang = ang; o.len = len; o.w = w;
      o.life = life; o.maxLife = life; o.color = color; o.k = kind;
      o.vx = 0; o.vy = 0; o.vr = 0; o.grow = 0; o.a0 = 1;
      o.sk = 'wf:' + kind + ':' + color;
      this[arr].push(o);
      return o;
    },
    /** 节拍器: 给"偶尔一个环"这类低频装饰用(比 Math.random 规律, 也便于 QA 复算) */
    _tick: function () { this._seq = (this._seq || 0) + 1; return this._seq; },

    /* ==================== 一、命中反馈 hit ====================
     * 4 颗本色迸溅 + 1 颗纯白核心(白心是深色底上的对比锚点, R5.4)。合计 <= 5 粒子。
     * 用颜色造层次而不是加粒子数 —— 颜色翻倍比粒子数量翻倍便宜。 */
    hitSpark: function (x, y, color) {
      this._ready();
      var i, a, s, c = color || '#ffe9a8';
      for (i = 0; i < 4; i++) {
        a = Math.random() * TAU; s = rnd(80, 210);
        this._part(x, y, Math.cos(a) * s, Math.sin(a) * s, rnd(0.14, 0.20), rnd(2, 3.4),
          i % 2 ? c : '#ffe9a8', K_SPARK);
      }
      this._part(x, y, 0, 0, 0.12, 2.2, '#ffffff', K_STAR);
    },

    /* ==================== 二、击杀反馈 kill ====================
     * 8~12 片带重力的碎块(大怪多给几片) + 一层本色余烬 + 尸体淡出。
     * 碎片里掺 1/3 的 ink 色 → 既有体积感又不至于糊成一团亮斑。 */
    death: function (x, y, color, r) {
      this._ready();
      var rr = r || 12, n = rr >= 24 ? 12 : 8, i, a, s, o;
      if (this.corpses.length < 48) {
        o = this._take('corpses');
        o.x = x; o.y = y; o.r = rr * 0.9; o.color = color; o.life = B.FX.corpseFade;
        this.corpses.push(o);
      }
      for (i = 0; i < n; i++) {
        if (this.shards.length >= SHARD_MAX) break;
        a = i / n * TAU + rnd(-0.25, 0.25);
        s = rnd(110, 250);
        o = this._take('shards');
        o.x = x; o.y = y;
        o.vx = Math.cos(a) * s; o.vy = Math.sin(a) * s - 70;
        o.rot = Math.random() * TAU; o.vr = rnd(-9, 9);
        o.life = 0.35; o.maxLife = 0.35;
        o.size = rnd(3, Math.max(3.4, rr * 0.32));
        o.color = (i % 3 === 2) ? '#100c08' : color;
        this.shards.push(o);
      }
      for (i = 0; i < 4; i++) {
        a = Math.random() * TAU; s = rnd(80, 220);
        this._part(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.3, rnd(2, 4.4), color, K_SPARK);
      }
    },

    muzzle: function (x, y, ang, color) {
      this._ready();
      this._part(x + Math.cos(ang) * 16, y + Math.sin(ang) * 16,
        Math.cos(ang) * 150, Math.sin(ang) * 150, 0.12, 3, color || '#e8b45a', K_EMBER);
    },

    /* ==================== 三、暴击反馈 crit ====================
     * 暴击 = 命中反馈 + 冲击环 + 十字星。字号 17 → 24(×1.41, R5.3), 颜色走 accentGoldHi。
     * 由 game.js 的 onDamage(e,dmg,crit) 直接触发, 不需要额外接线。 */
    dmgNum: function (x, y, v, crit) {
      this._ready();
      if (this.nums.length >= B.FX.dmgNumMax) return;
      var o = this._take('nums');
      o.x = x + rnd(-8, 8); o.y = y; o.vy = crit ? -96 : -75;
      o.life = crit ? 0.7 : 0.55; o.maxLife = o.life;
      o.text = '' + v; o.crit = !!crit;
      o.size = crit ? 24 : 17;
      o.color = crit ? '#ffd24a' : '#fff2c0';
      this.nums.push(o);
      if (crit) {
        this.ring(x, y, '#ffd24a', 62, 0.28);
        var i, a;
        for (i = 0; i < 3; i++) {
          a = rnd(0, TAU);
          this._part(x, y, Math.cos(a) * rnd(150, 210), Math.sin(a) * rnd(150, 210), 0.22, 2.8, '#fff4c8', K_STAR);
        }
      }
    },

    /* v5.19(Codex, 2026-09-29) 近战挥击: 每族一个招式(见五·A 的 MEL_FAMILY)。
     * 参数 info = {shape, family, elem, tier, color} —— family 决定招式, shape 只在缺族名时兜底。
     * 元素武器用元素色, 其余用招式本色(MEL[].tint); info.color 仍可整体覆盖(旧调用方兼容)。
     * 存进 o 的字段是**附加**的: ui.js 的降级画法读到 family/style 不认识也不会崩。 */
    strike: function (x, y, ang, range, arc, info) {
      this._ready();
      var inf = info || NOINFO;
      var o = this._take('swings');
      var style = melOf(inf);
      o.x = x; o.y = y; o.ang = ang;
      o.arc = Math.max(0.35, Math.min(3.4, arc || 1.4));
      o.range = Math.max(12, Math.min(640, range || 90));
      o.family = inf.family || null; o.shape = inf.shape || null;
      o.style = style;
      o.tier = tierOf(inf.tier);
      o.kind = MEL[style].k;
      o.color = inf.color || (inf.elem ? elemColor(inf.shape) : (MEL[style].tint || METAL_MID));
      /* 招式寿命: 突刺/冲击短促(0.12), 大镰这种大范围慢(0.22) —— 手感跟着动作走 */
      var L = o.kind === 'lance' ? 0.13 : (o.kind === 'fan' ? 0.11 : (style === 'reap' ? 0.22 : 0.18));
      o.life = L; o.maxLife = L;
      this.swings.push(o);
    },
    /** 旧接口保留: 不传 info 时等价于"无身份的通用斩击"(任何遗留调用方都不会开天窗) */
    swing: function (x, y, ang, range, arc, color) {
      return this.strike(x, y, ang, range, arc, { color: color });
    },
    /** 36 个近战家族逐个过招式表: 缺项在这里如实报出来(供 qa/verify-melee-fx.cjs 断言) */
    meleeAudit: function () {
      var W = PS.WeaponData && PS.WeaponData.list, seen = {}, out = [], k, d, st;
      for (k in W) {
        d = W[k];
        if (!d || d.cls !== 'melee' || !d.family || seen[d.family]) continue;
        seen[d.family] = 1;
        st = MEL_FAMILY[d.family] || MEL_SHAPE[(PS.Art && PS.Art.weaponShape) ? PS.Art.weaponShape(d) : null] || null;
        out.push({ family: d.family, name: d.name, style: st, kind: st ? MEL[st].k : null, ok: !!st, tier1: !!MEL_FAMILY[d.family] });
      }
      out.sort(function (a, b) { return a.family < b.family ? -1 : 1; });
      var nUncov = 0, i2;
      for (i2 = 0; i2 < out.length; i2++) if (!out[i2].ok) nUncov++;
      var tbl = {}, sk;
      for (sk in MEL) if (Object.prototype.hasOwnProperty.call(MEL, sk)) tbl[sk] = { k: MEL[sk].k, spin: MEL[sk].spin };
      return { rows: out, families: out.length, uncov: nUncov, miss: _melMiss,
        missFamilies: _melMissList.slice(), styleN: Object.keys(MEL).length, styles: tbl };
    },
    /** 自检/QA 用: 把一个招式按**真烘焙几何**画进任意 ctx(绕开精灵缓存, 也不受画布尺寸上限约束)。
     * 存在理由: 「36 族每族一个形状」必须能被门禁**量**出来 —— 否则又会退回「一道弧套所有武器」。
     * 调用方自己把 ctx 原点移到落点(与 sprites 烘焙同一约定)。未知招式名返回 null: **不静默兜底**,
     * 否则「表里漏了一族」看起来会和一切正常一模一样 —— 那正是这次事故的形态。 */
    meleeProbe: function (ctx, style, color, arc, range) {
      var st = Object.prototype.hasOwnProperty.call(MEL, style) ? MEL[style] : null;
      if (!ctx || !st) return null;
      ctx.save();
      melFn(st, color || st.tint || METAL_MID, arc || 1.4, range || 90)(null, ctx);
      ctx.restore();
      return st.k;
    },
    /** 降级路径共用同一套几何: ui.js 的逐帧现画在 FX 未接管时调它 */
    drawSwingFree: function (ctx, o, alpha) {
      if (!ctx || !o) return false;
      var st = (typeof o.style === 'string' && MEL[o.style]) ? MEL[o.style] : MEL[MEL_FALLBACK];
      ctx.save();
      ctx.globalAlpha = alpha === undefined ? 1 : alpha;
      ctx.translate(o.x, o.y);
      var t = 1 - (o.life / Math.max(1e-6, o.maxLife));
      ctx.rotate(o.ang + (st.spin || 0) * (t - 0.5));
      melDrawFree(ctx, st, o.color || st.tint || METAL_MID, Math.max(0.35, o.arc || 1.4), Math.max(12, o.range || 90));
      ctx.restore();
      return true;
    },
    /** 冲击环; maxR / life 可选(默认沿用旧值 95 / 0.42), 暴击环与 Boss 死环共用 */
    ring: function (x, y, color, maxR, life) {
      this._ready();
      if (this.rings.length >= 48) return;
      var o = this._take('rings');
      o.x = x; o.y = y; o.r = 10; o.maxR = Math.max(12, maxR || 95);
      o.life = life || 0.42; o.maxLife = o.life; o.color = color || '#ffd24a';
      this.rings.push(o);
    },
    dashLine: function (x, y, ang) {
      this._ready();
      var o = this._take('dashLines');
      o.x = x; o.y = y; o.ang = ang; o.life = 0.3; o.maxLife = 0.3;
      this.dashLines.push(o);
    },

    /* ==================== 三·B 状态反馈族(灼烧 / 冰冻 / 拾取 / 升级) ====================
     * 这四条是"状态"而不是"单次事件", 因此接口设计成**幂等的小剂量**:
     *   灼烧/冰冻每帧或每次 tick 调一次, 单次只出 1~3 颗粒子 + 极少调用次数的环,
     *   靠调用频率堆出持续感, 而不是一次喷 40 颗把 particlesMax 吃光。
     * 接线点(需要 core 侧配合, 本文件不读游戏全局):
     *   灼烧  game.js 在 dot tick 时 g.fx.burn(e.x, e.y, e.r)
     *   冰冻  game.js 在减速/冻结生效时 g.fx.freeze(e.x, e.y, e.r)
     *   拾取  game.js 已有 g.fx.pickup(d.x, d.y) —— pickupRing 是它的加强版(环 + 星)
     *   升级  ui.js/game.js 在进入 levelup 状态时 g.fx.levelup(p.x, p.y)
     * 未接线时这些方法不会被调用, 不产生任何开销。 */
    hitFlash: function (x, y, r) {
      this._ready();
      this._part(x, y, 0, 0, 0.13, Math.max(4, (r || 12) * 0.6), '#ffffff', K_STAR);
    },
    burn: function (x, y, r) {
      this._ready();
      var rr = r || 12, i, a;
      for (i = 0; i < 2; i++) {
        a = rnd(0, TAU);
        this._part(x + Math.cos(a) * rr * 0.5, y + Math.sin(a) * rr * 0.4,
          Math.cos(a) * 18, -rnd(60, 120), rnd(0.3, 0.5), rnd(2.4, 4), i ? '#ff8a3a' : '#ffc04a', K_EMBER);
      }
      if ((this.parts.length & 3) === 0) this.ring(x, y + rr * 0.2, fade('#ff8a3a', 0.55), rr * 1.5, 0.3);
    },
    freeze: function (x, y, r) {
      this._ready();
      var rr = r || 12, i, a;
      for (i = 0; i < 3; i++) {
        a = rnd(0, TAU);
        this._part(x, y, Math.cos(a) * 26, Math.sin(a) * 26 - 18, rnd(0.26, 0.42), rnd(2.6, 4.2), '#a8e4ff', K_FROST);
      }
      this.ring(x, y, fade('#a8e4ff', 0.7), rr * 1.35, 0.28);
    },
    pickupRing: function (x, y, color) {
      this._ready();
      this.ring(x, y, color || '#8fd66b', 34, 0.24);
      this._part(x, y, 0, -60, 0.24, 3.4, color || '#c8ff9a', K_STAR);
    },
    /** 升级: 双层金环 + 8 道放射星(每环 1 次绘制, 全部画在同一个环对象上) */
    levelup: function (x, y) {
      this._ready();
      this.ring(x, y, '#ffd24a', 150, 0.62);
      this.ring(x, y, '#fff4c8', 96, 0.44);
      var i, a;
      for (i = 0; i < 8; i++) {
        a = i / 8 * TAU;
        this._part(x + Math.cos(a) * 16, y + Math.sin(a) * 16,
          Math.cos(a) * 150, Math.sin(a) * 150 - 20, 0.42, 3.6, '#ffd24a', K_STAR);
      }
    },

    /* ==================== 四、受击反馈 hurt(玩家) ====================
     * 红边 vignette 由 ui.js 的屏幕层负责; 这里出红色飘字 + 红环 + 3 颗暗红迸溅。
     * 震屏峰值由 game.js 钳在 B.FX.shakeMax(12) 以内, 本文件不重复设 shake。 */
    hurt: function (x, y, dmg) {
      this._ready();
      this.dmgNum(x, y - 20, dmg, false);
      if (this.nums.length) this.nums[this.nums.length - 1].color = '#ff6a5a';
      this.ring(x, y, '#ff5a5a', 74, 0.35);
      var i, a;
      for (i = 0; i < 3; i++) {
        a = rnd(0, TAU);
        this._part(x, y, Math.cos(a) * rnd(60, 140), Math.sin(a) * rnd(60, 140) - 40, 0.35, rnd(2, 3.6), '#ff6a5a', K_SPARK);
      }
    },
    heal: function (x, y, v) {
      this._ready();
      if (this.nums.length >= B.FX.dmgNumMax) return;
      var o = this._take('nums');
      o.x = x; o.y = y - 24; o.vy = -52; o.life = 0.6; o.maxLife = 0.6;
      o.text = '+' + v; o.color = '#8fd66b'; o.crit = false; o.size = 15;
      this.nums.push(o);
      this._part(x, y, 0, -46, 0.34, 3, '#c8ff9a', K_STAR);
    },
    dodge: function (x, y) {
      this._ready();
      if (this.nums.length >= B.FX.dmgNumMax) return;
      var o = this._take('nums');
      o.x = x; o.y = y - 24; o.vy = -62; o.life = 0.5; o.maxLife = 0.5;
      o.text = 'MISS'; o.color = '#c8cfd6'; o.crit = false; o.size = 15;
      this.nums.push(o);
    },
    pickup: function (x, y) {
      this._ready();
      this._part(x, y, 0, -70, 0.2, 3, '#8fd66b', K_STAR);
    },

    /* ==================== 五、武器攻击特效层 weapon FX ====================
     * 用户诉求「作出攻击特效」: 旧版所有武器开火/命中都复用同一团本色圆点, 12 个武器家族长得
     *   一模一样, 玩家看不出自己拿的是什么武器。这里给每个 shape 家族**专属的几何语言**:
     *   shotgun 扇面 / rifle 细长 / launcher 大团余烬+冲击环 / flamer 锥形 / wand 元素光点 /
     *   saw 锯齿弧 / blade·machete 刀痕 / hammer 重击环。
     * 剂量纪律: 每次调用只出 1~3 个图元, 靠调用频率堆持续感 —— 不是一次喷 40 颗。
     * 入口参数 info = {shape, elem, tier, crit, cls}, 可整体缺省; shape 未知一律有兜底表现。
     * 上限由 B.FX.particlesMax 统一兜底(见 _fxTotal), 本文件不硬编码第二套数字。
     * cls('melee'|'ranged') 只在兜底分支里起作用: 缺 shape 但 class 是近战时走挥击弧, 而不是枪口闪光
     *   (别把刀画成枪)。剂量与 cls 无关。 */

    /** ① 远程开火: 枪口闪光(家族差异在这里最明显) */
    weaponShot: function (x, y, ang, info) {
      this._ready();
      var inf = info || NOINFO, shape = inf.shape;
      var tier = tierOf(inf.tier), elem = !!inf.elem, crit = !!inf.crit;
      var mc = elem ? elemColor(shape) : METAL_HI;
      var ca = Math.cos(ang), sa = Math.sin(ang);
      var mx = x + ca * 14, my = y + sa * 14;      /* 枪口: 沿瞄准方向前移一点, 贴住出膛口 */
      var s1 = 0.85 + 0.15 * tier;                 /* 尺寸系数 1.0~1.45×: "更强"要看见, 但不许爆炸式增长 */
      var i, a, o;
      this._tick();
      if (shape === 'shotgun') {
        /* 扇面: 3~5 枚细火花铺开 ±0.2rad —— 一眼看出"散弹"而不是"一发" */
        var n = (tier >= 3 ? 5 : 3), half = (n - 1) / 2;
        for (i = 0; i < n; i++) {
          a = ang + (i - half) * 0.2 + rnd(-0.035, 0.035);
          o = this._dir('bolts', mx, my, a, rnd(18, 26) * s1, 7 * s1, rnd(0.10, 0.15), mc, D_SPARKD);
          if (o) { o.vx = Math.cos(a) * rnd(170, 250); o.vy = Math.sin(a) * rnd(170, 250); }
        }
        this._dir('bolts', mx, my, ang, 22 * s1, 22 * s1, 0.08, elem ? mc : WHITE, D_FLASH);
      } else if (shape === 'rifle') {
        /* 单发细长闪光: 靠"长而窄"区别于手枪的"圆而短" */
        var rl = 34 * s1;
        o = this._dir('bolts', mx, my, ang, rl, 9 * s1, 0.10, mc, D_LANCE);
        if (o) o.grow = 0.18;
        this._dir('bolts', mx - ca * 8, my - sa * 8, ang, rl * 1.5, 4.5 * s1, 0.09, METAL_DEEP, D_TRAIL);
        this._part(mx, my, ca * 120, sa * 120, 0.1, 2.2, WHITE, K_STAR);
      } else if (shape === 'launcher') {
        /* 大团余烬 + 冲击环: 发射器要"重"。这里允许出环是因为它射速低(0.75~1.83s), 不会堆满屏 */
        this._dir('bolts', mx, my, ang, 44 * s1, 44 * s1, 0.16, elem ? mc : FIRE, D_BURST);
        for (i = 0; i < 2; i++) {
          a = rnd(0, TAU);
          this._part(mx, my, Math.cos(a) * rnd(40, 90) + ca * 60, Math.sin(a) * rnd(40, 90) + sa * 60,
            0.3, rnd(2.6, 3.8), i ? FIRE : '#ffc04a', K_EMBER);
        }
        this.ring(mx, my, fade(elem ? mc : FIRE, 0.8), 34 + tier * 4, 0.26);
      } else if (shape === 'flamer') {
        /* 锥形余烬: 锥体本身表达"持续喷射", 再补 1 颗上飘余烬 */
        o = this._dir('bolts', mx, my, ang, 42 * s1, 30 * s1, 0.16, elem ? mc : FIRE, D_CONE);
        if (o) o.grow = 0.3;
        a = ang + rnd(-0.25, 0.25);
        this._part(mx, my, Math.cos(a) * rnd(60, 110), Math.sin(a) * rnd(60, 110) - 30,
          0.34, rnd(2.4, 3.4), '#ffc04a', K_EMBER);
      } else if (shape === 'wand') {
        /* 元素光点: 小圆闪 + 一颗本色星 —— 法术系不做"火花", 做"发光" */
        this._dir('bolts', mx, my, ang, 20 * s1, 20 * s1, 0.12, mc, D_FLASH);
        this._part(mx, my, ca * 90, sa * 90, 0.2, 3.2 * s1, mc, K_STAR);
      } else if (shape === 'saw') {
        /* 锯齿弧: 两段反向错开的锯齿, 自带"在转"的暗示 */
        for (i = 0; i < 2; i++) {
          o = this._dir('bolts', mx, my, ang + (i ? 0.5 : -0.5), 28 * s1, 22 * s1, 0.12, i ? mc : METAL_HI, D_SAW);
          if (o) o.vr = i ? -9 : 9;
        }
      } else if (shape === 'blade' || shape === 'machete' || shape === 'axe' || shape === 'hammer' ||
                 shape === 'mace' || shape === 'spear') {
        /* 近战若接到统一开火入口: 给一道随方向甩出的挥击痕 + 1 颗火星, 不留空窗 */
        o = this._dir('bolts', mx, my, ang + Math.PI * 0.5, 26 * s1, 14 * s1, 0.11, mc, D_SLASH);
        if (o) o.grow = 0.4;
        a = ang + rnd(-0.3, 0.3);
          o = this._dir('bolts', mx, my, a, 16 * s1, 7 * s1, 0.12, METAL_HI, D_SPARKD);
        if (o) { o.vx = Math.cos(a) * 150; o.vy = Math.sin(a) * 150; }
      } else if (inf.cls === 'melee') {
        /* 已知是近战但没给具体 shape: 一道挥击弧 + 1 颗火星 —— 兜底也不能把刀画成枪 */
        o = this._dir('bolts', mx, my, ang + Math.PI * 0.5, 26 * s1, 14 * s1, 0.11, mc, D_SLASH);
        if (o) o.grow = 0.4;
        o = this._dir('bolts', mx, my, ang, 14 * s1, 7 * s1, 0.11, METAL_HI, D_SPARKD);
        if (o) { o.vx = ca * 140; o.vy = sa * 140; }
      } else {
        /* 兜底(shape 缺失/未知): 手枪式通用枪口 —— 小圆闪 + 一颗前冲火星 */
        this._dir('bolts', mx, my, ang, 18 * s1, 18 * s1, 0.09, mc, D_FLASH);
        o = this._dir('bolts', mx, my, ang, 16 * s1, 7 * s1, 0.11, METAL_HI, D_SPARKD);
        if (o) { o.vx = ca * 160; o.vy = sa * 160; }
      }
      /* 暴击强调: 只补一颗小金闪。**不叠环** —— 环留给 dmgNum 的暴击环, 免得两层金环糊成一坨 */
      if (crit) this._dir('bolts', mx, my, ang, 14, 14, 0.1, GOLD, D_FLASH);
    },

    /** ② 光束/激光: 明亮光轴 + 端点亮斑(长度靠 drawImage 拉伸, 不进 key) */
    weaponBeam: function (x, y, ang, len, info) {
      this._ready();
      var inf = info || NOINFO, shape = inf.shape;
      var tier = tierOf(inf.tier), elem = !!inf.elem, crit = !!inf.crit;
      var mc = elem ? elemColor(shape) : (crit ? GOLD : METAL_HI);
      var L = Math.max(24, Math.min(900, len || 200));   /* 畸形长度钳住: 不创建荒唐的缩放/画布 */
      var w = (3.4 + 1.3 * tier) * (elem ? 1.25 : 1);
      var ca = Math.cos(ang), sa = Math.sin(ang);
      this._tick();
      var b = this._dir('bolts', x, y, ang, L, w, 0.16, mc, D_BEAM);
      if (b) { b.a0 = 0.95; b.grow = 0.12; }             /* 略张口: 光轴在扩散, 不是一根死棍 */
      var ex = x + ca * L, ey = y + sa * L;
      this._part(ex, ey, ca * 40, sa * 40, 0.18, 3.4 + tier * 0.4, WHITE, K_STAR);   /* 端点亮斑 */
      if (tier >= 3) this._part(ex, ey, -ca * 30, -sa * 30, 0.22, 3, mc, K_STAR);
      if (crit) this._dir('bolts', x, y, ang, L * 0.72, w * 0.6, 0.1, GOLD, D_BEAM);
    },

    /** ③ 高速弹体拖尾: 一条短而亮的线段(尾端渐隐) —— 靠每帧调用堆出速度感 */
    weaponTrail: function (x, y, ang, len, info) {
      this._ready();
      var inf = info || NOINFO, shape = inf.shape;
      var tier = tierOf(inf.tier), elem = !!inf.elem;
      var mc = elem ? elemColor(shape) : METAL_MID;   /* 拖尾用中金: 比光轴暗一档, 才不抢主体 */
      var L = Math.max(10, Math.min(220, len || 30));
      if (this._tick() % 4 === 0) this._part(x, y, 0, 0, 0.1, 2.4, mc, K_DOT);   /* 1/4 频率才补一颗微光 */
      this._dir('bolts', x, y, ang, L, 5.2 + tier * 0.6, 0.12, mc, D_TRAIL);
    },

    /** ④ 命中点: 方向性火花(近战出刀痕 / 锤子出重击环 / 远程出扇形迸溅) */
    weaponHit: function (x, y, ang, info) {
      this._ready();
      var inf = info || NOINFO, shape = inf.shape;
      var tier = tierOf(inf.tier), elem = !!inf.elem, crit = !!inf.crit;
      var mc = elem ? elemColor(shape) : METAL_HI;
      var s1 = 0.9 + 0.13 * tier;
      var ca = Math.cos(ang), sa = Math.sin(ang);
      var i, a, o;
      this._tick();
      if (shape === 'hammer') {
        /* 重击环: 全文件唯一在命中处出整环的形状 —— 锤子的辨识度就是"砸下去那一下" */
        this.ring(x, y, elem ? mc : fade(GOLD, 0.85), 42 + tier * 7, 0.3);
        for (i = 0; i < 2; i++) {
          a = ang + rnd(-0.6, 0.6);
          this._part(x, y, Math.cos(a) * rnd(90, 170), Math.sin(a) * rnd(90, 170), 0.24, rnd(2.6, 3.6), mc, K_SPARK);
        }
      } else if (shape === 'blade' || shape === 'machete' || shape === 'axe') {
        /* 刀痕: 划痕与攻击方向**垂直**(刀锋切过去的印子), 再沿攻击方向甩火星 */
        var na = shape === 'axe' ? 2 : 1;
        for (i = 0; i < na; i++) {
          a = ang + Math.PI * 0.5 + rnd(-0.45, 0.45);
          o = this._dir('sparks', x, y, a, (18 + tier * 4) * s1, (12 + tier * 2) * s1, rnd(0.13, 0.19), mc, D_SLASH);
          if (o) o.grow = 0.35;
        }
        for (i = 0; i < 2; i++) {
          a = ang + rnd(-0.35, 0.35);
          o = this._dir('sparks', x, y, a, (14 + tier * 3) * s1, 8 * s1, 0.15, METAL_HI, D_SPARKD);
          if (o) { o.vx = Math.cos(a) * rnd(130, 200); o.vy = Math.sin(a) * rnd(130, 200); }
        }
      } else if (shape === 'spear') {
        /* 贯穿: 细长火花沿攻击方向冲出去(细长=穿刺感, 不靠数量) */
        o = this._dir('sparks', x, y, ang, 34 * s1, 8 * s1, 0.16, mc, D_SPARKD);
        if (o) { o.vx = ca * 220; o.vy = sa * 220; o.grow = 0.5; }
        this._part(x, y, 0, 0, 0.1, 2.6, WHITE, K_STAR);
      } else if (shape === 'mace') {
        /* 刺球: 三根倒刺方向的短火花 —— 与刀的"一道痕"明显区分 */
        for (i = 0; i < 3; i++) {
          a = ang + (i - 1) * 0.55;
          o = this._dir('sparks', x, y, a, 16 * s1, 7 * s1, 0.14, METAL_HI, D_SPARKD);
          if (o) { o.vx = Math.cos(a) * rnd(120, 190); o.vy = Math.sin(a) * rnd(120, 190); }
        }
        this._part(x, y, 0, 0, 0.11, 2.4, WHITE, K_STAR);
      } else if (shape === 'shotgun') {
        for (i = 0; i < 3; i++) {
          a = ang + (i - 1) * 0.42 + rnd(-0.08, 0.08);
          o = this._dir('sparks', x, y, a, 15 * s1, 7 * s1, 0.14, mc, D_SPARKD);
          if (o) { o.vx = Math.cos(a) * rnd(140, 220); o.vy = Math.sin(a) * rnd(140, 220); }
        }
        this._part(x, y, 0, 0, 0.1, 2.4, WHITE, K_STAR);
      } else if (shape === 'launcher') {
        /* 爆炸型命中: 大团余烬 + 环, 再补两颗上飘余烬 */
        this.ring(x, y, fade(elem ? mc : FIRE, 0.85), 46 + tier * 6, 0.32);
        this._dir('sparks', x, y, ang, 30 * s1, 26 * s1, 0.2, elem ? mc : FIRE, D_BURST);
        for (i = 0; i < 2; i++) {
          a = rnd(0, TAU);
          this._part(x, y, Math.cos(a) * rnd(50, 120), Math.sin(a) * rnd(50, 120) - 30, 0.3, rnd(2.4, 3.4), i ? FIRE : '#ffc04a', K_EMBER);
        }
      } else if (shape === 'flamer') {
        o = this._dir('sparks', x, y, ang, 34 * s1, 24 * s1, 0.18, elem ? mc : FIRE, D_CONE);
        if (o) o.grow = 0.35;
        for (i = 0; i < 2; i++) {
          this._part(x, y, rnd(-30, 30), -rnd(50, 110), 0.3, rnd(2.2, 3.2), i ? FIRE : '#ffc04a', K_EMBER);
        }
      } else if (shape === 'wand') {
        /* 法术命中: 元素星 + 每 5 次一颗小环(靠频率堆, 不用每次都出环) */
        this._part(x, y, ca * 34, sa * 34, 0.22, 3.4 * s1, mc, K_STAR);
        if (this._seq % 5 === 0) this.ring(x, y, fade(mc, 0.7), 26 + tier * 3, 0.2);
      } else if (shape === 'saw') {
        for (i = 0; i < 2; i++) {
          o = this._dir('sparks', x, y, ang + (i ? 0.7 : -0.7), 22 * s1, 18 * s1, 0.14, i ? mc : METAL_HI, D_SAW);
          if (o) o.vr = i ? -12 : 12;      /* 自转: 锯片蹭过身体的"刮"感 */
        }
      } else if (shape === 'rifle') {
        o = this._dir('sparks', x, y, ang, 30 * s1, 7 * s1, 0.13, mc, D_SPARKD);
        if (o) { o.vx = ca * 200; o.vy = sa * 200; }
        this._part(x, y, 0, 0, 0.09, 2.2, WHITE, K_STAR);
      } else if (shape === 'pistol') {
        for (i = 0; i < 2; i++) {
          a = ang + (i ? 0.4 : -0.4);
          o = this._dir('sparks', x, y, a, 15 * s1, 7 * s1, 0.13, mc, D_SPARKD);
          if (o) { o.vx = Math.cos(a) * rnd(130, 190); o.vy = Math.sin(a) * rnd(130, 190); }
        }
        this._part(x, y, 0, 0, 0.1, 2.4, WHITE, K_STAR);
      } else {
        /* 兜底: 通用的"方向性 2 颗 + 白心"(仍比旧版的全向圆点更贴攻击方向) */
        for (i = 0; i < 2; i++) {
          a = ang + rnd(-0.5, 0.5);
          o = this._dir('sparks', x, y, a, 15 * s1, 7 * s1, 0.14, mc, D_SPARKD);
          if (o) { o.vx = Math.cos(a) * rnd(120, 190); o.vy = Math.sin(a) * rnd(120, 190); }
        }
        this._part(x, y, 0, 0, 0.1, 2.4, WHITE, K_STAR);
      }
      if (crit) {
        o = this._dir('sparks', x, y, ang + rnd(-0.4, 0.4), 22 * s1, 8 * s1, 0.15, GOLD, D_SPARKD);
        if (o) { o.vx = ca * 180; o.vy = sa * 180; }
        this._part(x, y, 0, 0, 0.1, 2.6, GOLD, K_STAR);   /* 金色强调: 只有一点, 不叠环 */
      }
    },

    /** ⑤ 环绕武器接触火花: 调用极频繁(每帧每个接触点), 剂量压到最小(1~2 个图元) */
    weaponOrbit: function (x, y, ang, info) {
      this._ready();
      var inf = info || NOINFO, shape = inf.shape;
      var tier = tierOf(inf.tier), elem = !!inf.elem, crit = !!inf.crit;
      var mc = elem ? elemColor(shape) : METAL_HI;
      var s1 = 0.9 + 0.12 * tier;
      var o;
      this._tick();
      if (shape === 'saw') {
        o = this._dir('sparks', x, y, ang + Math.PI * 0.5, 22 * s1, 18 * s1, 0.13, mc, D_SAW);
        if (o) o.vr = rnd(-14, 14);
      } else if (shape === 'blade' || shape === 'machete') {
        o = this._dir('sparks', x, y, ang + Math.PI * 0.5 + rnd(-0.4, 0.4), 16 * s1, 10 * s1, 0.12, mc, D_SLASH);
        if (o) o.grow = 0.35;
      } else if (shape === 'axe' || shape === 'mace' || shape === 'hammer') {
        o = this._dir('sparks', x, y, ang, 16 * s1, 9 * s1, 0.12, METAL_HI, D_SPARKD);
        if (o) { o.vx = Math.cos(ang) * 90; o.vy = Math.sin(ang) * 90; }
        this._part(x, y, 0, 0, 0.1, 2.2, WHITE, K_STAR);
      } else {
        o = this._dir('sparks', x, y, ang, 14 * s1, 7 * s1, 0.12, mc, D_SPARKD);
        if (o) { o.vx = Math.cos(ang) * rnd(80, 140); o.vy = Math.sin(ang) * rnd(80, 140); }
      }
      /* 环必须稀(每 12 次才 1 个): 环绕体每秒接触几十次, 每次都出环会把整屏糊住 */
      if (this._seq % 12 === 0) this.ring(x, y, fade(mc, 0.55), 22 + tier * 3, 0.18);
      if (crit) {
        o = this._dir('sparks', x, y, ang + rnd(-0.5, 0.5), 14, 7, 0.12, GOLD, D_SPARKD);
        if (o) { o.vx = Math.cos(ang) * 120; o.vy = Math.sin(ang) * 120; }
      }
    },

    update: function (dt) {
      this._ready();
      var i, o, drag = Math.pow(0.02, dt), drag2 = Math.pow(0.01, dt), dDrag = Math.pow(0.06, dt);
      for (i = this.parts.length - 1; i >= 0; i--) {
        o = this.parts[i];
        o.life -= dt;
        if (o.life <= 0) { this._free('parts', o); this.parts.splice(i, 1); continue; }
        o.x += o.vx * dt; o.y += o.vy * dt;
        o.vx *= drag; o.vy *= drag;
      }
      for (i = this.shards.length - 1; i >= 0; i--) {
        o = this.shards[i];
        o.life -= dt;
        if (o.life <= 0) { this._free('shards', o); this.shards.splice(i, 1); continue; }
        o.vy += 240 * dt;                 /* 重力: 碎片下坠, 不再原地均匀散开 */
        o.x += o.vx * dt; o.y += o.vy * dt;
        o.rot += o.vr * dt;
        o.vx *= drag2; o.vy *= drag2;
      }
      for (i = this.nums.length - 1; i >= 0; i--) {
        o = this.nums[i];
        o.life -= dt;
        if (o.life <= 0) { this._free('nums', o); this.nums.splice(i, 1); continue; }
        o.y += o.vy * dt;
        o.vy *= Math.pow(0.1, dt);
      }
      for (i = this.swings.length - 1; i >= 0; i--) {
        o = this.swings[i]; o.life -= dt;
        if (o.life <= 0) { this._free('swings', o); this.swings.splice(i, 1); }
      }
      for (i = this.rings.length - 1; i >= 0; i--) {
        o = this.rings[i];
        o.life -= dt;
        if (o.life <= 0) { this._free('rings', o); this.rings.splice(i, 1); continue; }
        o.r = PS.util.lerp(o.maxR, 10, o.life / o.maxLife);
      }
      for (i = this.dashLines.length - 1; i >= 0; i--) {
        o = this.dashLines[i]; o.life -= dt;
        if (o.life <= 0) { this._free('dashLines', o); this.dashLines.splice(i, 1); }
      }
      for (i = this.corpses.length - 1; i >= 0; i--) {
        o = this.corpses[i]; o.life -= dt;
        if (o.life <= 0) { this._free('corpses', o); this.corpses.splice(i, 1); }
      }
      /* 朝向图元: 有初速就漂移, 带 vr 就自转(锯片/星芒); 光轴与枪口闪的 vx/vy=0 → 原地衰减 */
      for (i = this.bolts.length - 1; i >= 0; i--) {
        o = this.bolts[i];
        o.life -= dt;
        if (o.life <= 0) { this._free('bolts', o); this.bolts.splice(i, 1); continue; }
        o.x += o.vx * dt; o.y += o.vy * dt;
        if (o.vr) o.ang += o.vr * dt;
        o.vx *= dDrag; o.vy *= dDrag;
      }
      for (i = this.sparks.length - 1; i >= 0; i--) {
        o = this.sparks[i];
        o.life -= dt;
        if (o.life <= 0) { this._free('sparks', o); this.sparks.splice(i, 1); continue; }
        o.x += o.vx * dt; o.y += o.vy * dt;
        if (o.vr) o.ang += o.vr * dt;
        o.vx *= dDrag; o.vy *= dDrag;
      }
    },

    /* ==================== 离屏渲染(用缓存精灵补画上面这些数组) ====================
     * 每颗粒子 1 次 drawImage; 环 = 1 次 drawImage(缩放单位环); 挥击弧/冲刺虚线各 1 次。
     * 返回本帧画出的图元数(自检/QA 用)。缓存不可用时退回现画(不黑屏)。 */
    render: function (ctx, time) {
      var F = this._live || this, S = PS.Sprites, n = 0, i, o, img, k;
      if (!ctx || !F.parts) return 0;
      /* v5.19d(Codex, 2026-09-29) 视口裁剪: **只有**被 ui.js 的世界通道调用时才裁(this._live 非空)。
       *   这 8 个数组在 drawWorld 期间被换空(见本文件 install), 真正画它们的就是这一次调用 ——
       *   也就是「视口外约 2/3 的特效也在逐帧光栅化」的那 2/3(详见 ui.js drawWorld 顶部说明)。 */
      var C = (this._live && PS.UI && PS.UI.cullNow) ? PS.UI.cullNow() : null;
      var cut = 0;

      /* --- 尸体(在实体之下) --- */
      for (i = 0; i < F.corpses.length; i++) {
        o = F.corpses[i];
        if (cullOut(C, o.x, o.y, o.r * 1.2 + 6)) { cut++; continue; }
        ctx.globalAlpha = Math.max(0, o.life / B.FX.corpseFade) * 0.5;
        img = S && S.glow ? S.glow(fade(o.color, 0.9), 16) : null;
        if (img) { k = o.r * 1.15; ctx.drawImage(img, o.x - k, o.y + o.r * 0.3 - k * 0.5, k * 2, k); n++; }
        else { ctx.fillStyle = o.color; ctx.beginPath(); ctx.ellipse(o.x, o.y + o.r * 0.3, o.r, o.r * 0.5, 0, 0, TAU); ctx.fill(); n++; }
      }
      ctx.globalAlpha = 1;

      /* --- 击杀碎片(方块带旋转; fillRect 不计入 5 个记账方法, 且本来就便宜) --- */
      for (i = 0; i < F.shards.length; i++) {
        o = F.shards[i];
        if (cullOut(C, o.x, o.y, o.size)) { cut++; continue; }
        ctx.save();
        ctx.translate(o.x, o.y);
        ctx.rotate(o.rot);
        ctx.globalAlpha = Math.max(0, o.life / o.maxLife);
        ctx.fillStyle = o.color;
        ctx.fillRect(-o.size / 2, -o.size / 2, o.size, o.size);
        ctx.restore();
        n++;
      }
      ctx.globalAlpha = 1;

      /* --- 近战挥击(五·A 招式层: 每族一个形状; 单位招式烘焙 + 旋转/缩放落图) --- */
      for (i = 0; i < F.swings.length; i++) {
        o = F.swings[i];
        if (cullOut(C, o.x, o.y, o.range * 1.2 + 24)) { cut++; continue; }
        var t2 = o.life / o.maxLife, ab = bucket(o.arc, 0.2), rb = bucket(o.range, 12);
        var sq = rb * 2 + 24;
        var mst = (typeof o.style === 'string' && MEL[o.style]) ? MEL[o.style] : MEL[MEL_FALLBACK];
        /* 缓存 key 必须带 **style(招式名)**: 形状不进 key 就会出现「锤子借用了刀的月牙」——
         *   这正是旧实现 'sl:' + color + ':' + ab + ':' + rb 的漏洞(36 个家族共用一张图)。
         *   几何参数 arc/range 仍走 bucket, 所以槽位依然有界。 */
        img = S && S.get ? S.get('ml:' + (o.style || MEL_FALLBACK) + ':' + o.color + ':' + ab + ':' + rb, sq, sq, melFn(mst, o.color, ab, rb)) : null;
        ctx.save();
        ctx.globalAlpha = t2 * 0.85;
        ctx.translate(o.x, o.y);
        /* 招式自带的挥过角度: 起手偏一侧、收手偏另一侧 —— 一次挥击是**扫过去**, 不是亮一下。
         *   旧实现 rotate(o.ang) 是死的, 加上对称月牙 ⇒ 36 个家族出来是同一张图。 */
        ctx.rotate(o.ang + (mst.spin || 0) * (0.5 - t2));
        /* 落图必须**显式给 w/h**: 精灵是按 dpr 烘焙的(sprites.js get: Math.ceil(W*k)), 漏掉尺寸时
         *   浏览器按**物理边长**落图 ⇒ devicePixelRatio>1 的屏幕上挥击弧被放大 k 倍, 并且整体平移
         *   (rb+12)*(k-1)。实测 dpr=2 / 射程 135: 弧到角色 453.6 逻辑px(真实射程只有 135)、
         *   包围盒中心偏移 (203.5, 143.8) 逻辑px —— 玩家看到的不是「绕在身上的挥击弧」。
         *   同一约定 art.js 的 glowAt 已经写明(那边注释就叫「必须显式给 drawImage 的 w/h」)。 */
        if (img) ctx.drawImage(img, -rb - 12, -rb - 12, sq, sq);
        else melDrawFree(ctx, mst, o.color, ab, rb);
        ctx.restore();
        n++;
      }
      ctx.globalAlpha = 1;

      /* --- 冲刺预警虚线(单位虚线带缓存 + 旋转) --- */
      for (i = 0; i < F.dashLines.length; i++) {
        o = F.dashLines[i];
        if (cullOut(C, o.x + Math.cos(o.ang) * 180, o.y + Math.sin(o.ang) * 180, 200)) { cut++; continue; }
        img = S && S.get ? S.get('dl', 360, 14, bakeDash()) : null;
        if (!img) continue;
        ctx.save();
        ctx.globalAlpha = (o.life / o.maxLife) * 0.5;
        ctx.translate(o.x, o.y);
        ctx.rotate(o.ang);
        ctx.drawImage(img, 0, -7, 360, 14);   /* 同上: 必须显式尺寸, 否则 dpr>1 时虚线整体拉长 k 倍 */
        ctx.restore();
        n++;
      }
      ctx.globalAlpha = 1;

      /* --- 开火侧朝向图元: 枪口闪光 / 光轴 / 拖尾 / 锥形余烬(每图元 1 次 drawImage) --- */
      for (i = 0; i < F.bolts.length; i++) {
        o = F.bolts[i];
        if (cullOut(C, o.x, o.y, o.len * (1 + (o.grow || 0)) + (o.w || 0) + 8)) { cut++; continue; }
        var kd = D_KIND[o.k] || D_KIND[D_FLASH];
        var tb = Math.max(0, o.life / o.maxLife);
        var sb = 1 + (o.grow || 0) * (1 - tb), wb = o.len * sb, hb = o.w * sb;
        img = (S && S.get) ? S.get(o.sk, kd.w, kd.h, bakeFnOf(o.k, o.color), kd.tl ? O_TL : null) : null;
        if (img) {
          ctx.save();
          ctx.globalAlpha = tb * o.a0;
          ctx.translate(o.x, o.y);
          ctx.rotate(o.ang);
          if (kd.ax === 1) ctx.drawImage(img, 0, -hb * 0.5, wb, hb);      /* 起点锚: 沿 +x 展开 */
          else ctx.drawImage(img, -wb * 0.5, -hb * 0.5, wb, hb);         /* 中心锚: 星芒/余烬团 */
          ctx.restore();
        } else {
          drawFreeform(ctx, o);      /* 缓存不可用 → 退回现画(不黑屏, 不抛错) */
        }
        n++;
      }
      ctx.globalAlpha = 1;

      /* --- 冲击环 --- */
      for (i = 0; i < F.rings.length; i++) {
        o = F.rings[i];
        if (cullOut(C, o.x, o.y, o.r + 6)) { cut++; continue; }
        var a2 = Math.max(0, o.life / o.maxLife);
        img = S && S.ringImg ? S.ringImg(o.color, 48, 4) : null;
        if (img) {
          ctx.globalAlpha = a2;
          k = o.r + 3;
          ctx.drawImage(img, o.x - k, o.y - k, k * 2, k * 2);
          n++;
        } else {
          ctx.globalAlpha = a2; ctx.strokeStyle = o.color; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, TAU); ctx.stroke(); n++;
        }
      }
      ctx.globalAlpha = 1;

      /* --- 命中侧朝向图元: 方向火花 / 刀痕 / 锯齿弧(压在冲击环之上, "打中了"才一眼可见) --- */
      for (i = 0; i < F.sparks.length; i++) {
        o = F.sparks[i];
        if (cullOut(C, o.x, o.y, o.len * (1 + (o.grow || 0)) + (o.w || 0) + 8)) { cut++; continue; }
        var ks = D_KIND[o.k] || D_KIND[D_SPARKD];
        var ts = Math.max(0, o.life / o.maxLife);
        var ss = 1 + (o.grow || 0) * (1 - ts), ws = o.len * ss, hs = o.w * ss;
        img = (S && S.get) ? S.get(o.sk, ks.w, ks.h, bakeFnOf(o.k, o.color), ks.tl ? O_TL : null) : null;
        if (img) {
          ctx.save();
          ctx.globalAlpha = ts * o.a0;
          ctx.translate(o.x, o.y);
          ctx.rotate(o.ang);
          if (ks.ax === 1) ctx.drawImage(img, 0, -hs * 0.5, ws, hs);
          else ctx.drawImage(img, -ws * 0.5, -hs * 0.5, ws, hs);
          ctx.restore();
        } else {
          drawFreeform(ctx, o);
        }
        n++;
      }
      ctx.globalAlpha = 1;

      /* --- 粒子 --- */
      var dCache = {}, fCache = {}, eCache = {}, sCache = {};
      for (i = 0; i < F.parts.length; i++) {
        o = F.parts[i];
        if (cullOut(C, o.x, o.y, o.r * 1.45 + 4)) { cut++; continue; }
        var la = Math.max(0, o.life / o.maxLife);
        var kk = o.k || 0, c = o.color;
        img = null;
        if (S) {
          if (kk === K_STAR) { img = fCache[c] || (fCache[c] = (S.star ? S.star(c, 12) : null)); }
          else if (kk === K_EMBER) { img = eCache[c] || (eCache[c] = (S.ember ? S.ember(c, 10) : null)); }
          else if (kk === K_FROST) { img = sCache[c] || (sCache[c] = (S.frost ? S.frost(c, 9) : null)); }
          else { img = dCache[c] || (dCache[c] = (S.dot ? S.dot(c, 8) : null)); }
        }
        if (img) {
          var k2 = o.r * 1.45;
          ctx.globalAlpha = la;
          ctx.drawImage(img, o.x - k2, o.y - k2, k2 * 2, k2 * 2);
        } else {
          ctx.globalAlpha = la;
          ctx.fillStyle = c;
          ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, TAU); ctx.fill();
        }
        n++;
      }
      ctx.globalAlpha = 1;
      this.culledLast = cut;   /* v5.19d: 本次 render 裁掉的图元数(只读统计, 供门禁核对) */
      return n;
    },

    /* ---- 单位图元烘焙回调(只在首次调用时执行) ---- */
    /* ==================== 接线: 让 ui.js 走缓存渲染(不改 ui.js 源码) ====================
     * 顺序与 ui.js drawWorld 完全一致: 尸体/碎片 → (敌人/弹幕/环绕) → 挥击/虚线/环/粒子 → 玩家。
     * 实现: 进入 drawWorld 前把几何数组换空, 在 drawPlayer 里补画 → 落点就在玩家之前。
     * 任何异常都自动卸载包装, 退回 ui.js 原生画法(不接受"特效消失"这种降级)。 */
    install: function () {
      var UI = PS.UI, F = this;
      if (!UI || typeof UI.drawWorld !== 'function' || typeof UI.drawPlayer !== 'function') return false;
      if (UI.drawWorld.__fxCached) return true;
      /* 白名单必须覆盖**所有**绘制数组: 漏一个, 那条数组就会在 drawWorld 期间被 ui.js 现画 + 本文件补画两次 */
      var KEYS = ['corpses', 'shards', 'swings', 'dashLines', 'bolts', 'rings', 'sparks', 'parts'];
      var origWorld = UI.drawWorld, origPlayer = UI.drawPlayer;
      var wPlayer = function () {
        if (F._live) {
          try { F.render(this.ctx, this.time); }
          catch (e) { F._err = 'render:' + (e && e.message); F.uninstall(); }
        }
        return origPlayer.apply(this, arguments);
      };
      wPlayer.__fxCached = true; wPlayer.__orig = origPlayer;
      var wWorld = function () {
        var i, saved = [];
        for (i = 0; i < KEYS.length; i++) { saved[i] = F[KEYS[i]]; F[KEYS[i]] = EMPTY; }
        F._live = {};
        for (i = 0; i < KEYS.length; i++) F._live[KEYS[i]] = saved[i];
        try { return origWorld.apply(this, arguments); }
        finally {
          F._live = null;
          for (i = 0; i < KEYS.length; i++) if (saved[i]) F[KEYS[i]] = saved[i];
        }
      };
      wWorld.__fxCached = true; wWorld.__orig = origWorld;
      UI.drawWorld = wWorld;
      UI.drawPlayer = wPlayer;
      this.installed = true;
      return true;
    },
    /** 还原 ui.js 原生特效画法(排障/负向对照用) */
    uninstall: function () {
      var UI = PS.UI;
      if (UI && UI.drawWorld && UI.drawWorld.__fxCached) UI.drawWorld = UI.drawWorld.__orig;
      if (UI && UI.drawPlayer && UI.drawPlayer.__fxCached) UI.drawPlayer = UI.drawPlayer.__orig;
      this._live = null;
      this.installed = false;
    },

    /** 自检/QA 用: 当前活跃量与池占用 */
    stats: function () {
      this._ready();
      var s = this._spare;
      return {
        parts: this.parts.length, nums: this.nums.length, shards: this.shards.length,
        rings: this.rings.length, swings: this.swings.length, corpses: this.corpses.length,
        bolts: this.bolts.length, sparks: this.sparks.length,
        spare: s.parts.length + s.nums.length + s.shards.length + s.rings.length + s.swings.length + s.corpses.length + s.dashLines.length + s.bolts.length + s.sparks.length,
        partsMax: B.FX.particlesMax,
        installed: !!this.installed, lastErr: this._err
      };
    }
  };
  var EMPTY = [];
  /* 旧 bakeSlash() / drawSlashFree() 已随 v5.19 的近战招式层删除 —— 它们就是「一道通用金色月牙套 36 个
   * 家族」的唯一实现, 留着等于给这个事故留一条回来的路。挥击的几何现在只有一个真源: 五·A 的 6 个
   * mel*() 烘焙器, 以及与之同参数的现画兜底 melDrawFree()。 */

  /** 冲刺预警: 单位虚线带(0..360 长), 沿 +x 方向 */
  function bakeDash() {
    return function (c, x) {
      var g = x.createLinearGradient(0, 0, 360, 0), i;
      g.addColorStop(0, fade('#ff8a5a', 0.0));
      g.addColorStop(0.25, fade('#ff8a5a', 0.85));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      for (i = 0; i < 18; i++) x.fillRect(i * 20, -3, 11, 6);
    };
  }

  /* ==================== 武器特效的单位图元烘焙 ====================
   * 每个函数返回一个 Sprites.get 的 drawFn(只在该 (kind,color) 首次用到时执行一次)。
   * 锚点约定(与 D_KIND 的 tl/ax 必须一致):
   *   tl=true  → 内容画在 x∈[0,W] / y∈[0,H](左上角原点), 落图时 drawImage(img,0,-h/2,w,h) 沿 +x 展开;
   *   tl=false → 径向对称图元, 用中心原点, 落图时以中心对齐。
   * 渐变/路径/clip 都只在烘焙期跑 —— 热路径只有 1 次 drawImage(Balance 纪律 R3.5)。 */

  /* 0 枪口星芒: 白炽软核 + 十字芒(比粒子"炸", 一眼认出是枪口而不是命中) */
  function bakeFlash(color) {
    return function (c, x) {
      var R = 16;
      var g = x.createRadialGradient(0, 0, 0, 0, 0, R);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.34, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(0, 0, R, 0, TAU); x.fill();
      x.fillStyle = fade(color, 0.9);
      x.beginPath(); x.moveTo(-R, 0); x.lineTo(0, -3.4); x.lineTo(R, 0); x.lineTo(0, 3.4); x.closePath(); x.fill();
      x.beginPath(); x.moveTo(0, -R); x.lineTo(3.4, 0); x.lineTo(0, R); x.lineTo(-3.4, 0); x.closePath(); x.fill();
    };
  }

  /* 1 单发细长闪光: 左端渐隐、右端收尖 —— "长而窄"就是步枪的辨识度 */
  function bakeLance(color) {
    return function (c, x) {
      var W = 56, H = 16, cy = H * 0.5;
      var g = x.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, fade(color, 0));
      g.addColorStop(0.32, fade(color, 0.8));
      g.addColorStop(0.82, '#ffffff');
      g.addColorStop(1, fade(color, 0.9));
      x.fillStyle = g;
      x.beginPath();
      x.moveTo(0, cy - 1.4); x.lineTo(W * 0.72, cy - 3.2); x.lineTo(W, cy);
      x.lineTo(W * 0.72, cy + 3.2); x.lineTo(0, cy + 1.4);
      x.closePath(); x.fill();
      x.fillStyle = 'rgba(255,255,255,0.85)';
      x.fillRect(W * 0.66, cy - 1.1, W * 0.3, 2.2);
    };
  }

  /* 2 光轴: 两端渐隐的粗光带 + 中间白炽亮芯(粗细/长度全靠落图拉伸, 不进 key) */
  function bakeBeam(color) {
    return function (c, x) {
      var W = 64, H = 20, cy = H * 0.5, a = H * 0.4;
      var g = x.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.14, fade(color, 0.55));
      g.addColorStop(0.5, fade(color, 1));
      g.addColorStop(0.86, fade(color, 0.55));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.strokeStyle = g; x.lineCap = 'round'; x.lineWidth = a * 1.9;
      x.beginPath(); x.moveTo(a * 0.9, cy); x.lineTo(W - a * 0.9, cy); x.stroke();
      var g2 = x.createLinearGradient(0, 0, W, 0);
      g2.addColorStop(0, 'rgba(0,0,0,0)');
      g2.addColorStop(0.5, 'rgba(255,255,255,0.95)');
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      x.strokeStyle = g2; x.lineWidth = a * 0.5;
      x.beginPath(); x.moveTo(a * 0.9, cy); x.lineTo(W - a * 0.9, cy); x.stroke();
    };
  }

  /* 3 拖尾短线: 尾端全透明、前端白炽 —— 方向感来自"头亮尾暗" */
  function bakeTrail(color) {
    return function (c, x) {
      var W = 44, H = 12, cy = H * 0.5;
      var g = x.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.55, fade(color, 0.7));
      g.addColorStop(1, '#ffffff');
      x.strokeStyle = g; x.lineCap = 'round'; x.lineWidth = H * 0.6;
      x.beginPath(); x.moveTo(H * 0.32, cy); x.lineTo(W - H * 0.3, cy); x.stroke();
    };
  }

  /* 4 锥形余烬: 左端收成一点、右端张开 + 内层亮芯 —— 火焰的"持续喷射"由锥体表达 */
  function bakeCone(color) {
    return function (c, x) {
      var W = 44, H = 32, cy = H * 0.5;
      var g = x.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, fade(color, 0.95));
      g.addColorStop(0.6, fade(color, 0.6));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.beginPath();
      x.moveTo(0, cy);
      x.quadraticCurveTo(W * 0.55, cy - H * 0.5, W, cy - H * 0.32);
      x.lineTo(W, cy + H * 0.32);
      x.quadraticCurveTo(W * 0.55, cy + H * 0.5, 0, cy);
      x.closePath(); x.fill();
      var g2 = x.createLinearGradient(0, 0, W, 0);
      g2.addColorStop(0, '#fff6c8');
      g2.addColorStop(0.5, fade(color, 0.8));
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g2;
      x.beginPath();
      x.moveTo(0, cy);
      x.quadraticCurveTo(W * 0.5, cy - H * 0.2, W * 0.88, cy - H * 0.11);
      x.lineTo(W * 0.88, cy + H * 0.11);
      x.quadraticCurveTo(W * 0.5, cy + H * 0.2, 0, cy);
      x.closePath(); x.fill();
    };
  }

  /* 5 大团余烬: 软球 + 内部碎块(发射器/爆炸的"一团", 与火花的"一条"对比) */
  function bakeBurst(color) {
    return function (c, x) {
      var R = 22, i, a;
      var g = x.createRadialGradient(0, 0, 0, 0, 0, R);
      g.addColorStop(0, '#fff2c0');
      g.addColorStop(0.3, color);
      g.addColorStop(0.68, fade(color, 0.35));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(0, 0, R, 0, TAU); x.fill();
      x.fillStyle = 'rgba(255,246,200,0.85)';
      for (i = 0; i < 5; i++) {
        a = i / 5 * TAU + 0.4;
        x.beginPath(); x.arc(Math.cos(a) * R * 0.42, Math.sin(a) * R * 0.42, 2.6, 0, TAU); x.fill();
      }
    };
  }

  /* 6 方向性火花: 尾端渐隐的细尖锥(近战火星 / 散弹散布轨共用) */
  function bakeSparkD(color) {
    return function (c, x) {
      var W = 32, H = 14, cy = H * 0.5;
      var g = x.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.6, fade(color, 0.8));
      g.addColorStop(1, '#ffffff');
      x.fillStyle = g;
      x.beginPath();
      x.moveTo(0, cy - 1.3); x.lineTo(W * 0.8, cy - 3); x.lineTo(W, cy);
      x.lineTo(W * 0.8, cy + 3); x.lineTo(0, cy + 1.3);
      x.closePath(); x.fill();
    };
  }

  /* 7 刀痕: 一道带亮边的细弧(横向) —— 调用方把它旋转成"垂直于攻击方向"的切口 */
  function bakeSlashMark(color) {
    return function (c, x) {
      var W = 48, H = 22, cy = H * 0.5;
      var g = x.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.38, '#ffffff');
      g.addColorStop(0.66, fade(color, 0.9));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.strokeStyle = g; x.lineCap = 'round'; x.lineWidth = 3.4;
      x.beginPath(); x.moveTo(2, cy + 2.2); x.quadraticCurveTo(W * 0.5, cy - 3.6, W - 2, cy - 1.6); x.stroke();
      x.strokeStyle = 'rgba(255,255,255,0.7)'; x.lineWidth = 1.3;
      x.beginPath(); x.moveTo(4, cy + 1.4); x.quadraticCurveTo(W * 0.5, cy - 4.2, W - 4, cy - 2.2); x.stroke();
    };
  }

  /* 8 锯齿弧: 一段圆弧 + 齿点 —— 静止图上也能读出"在转" */
  function bakeSaw(color) {
    return function (c, x) {
      var W = 36, H = 26, cy = H * 0.5, R = 10.5, i, a;
      x.strokeStyle = fade(color, 0.95); x.lineWidth = 2.6; x.lineCap = 'round';
      x.beginPath(); x.arc(W * 0.5, cy, R, -1.15, 1.15); x.stroke();
      x.fillStyle = '#fff4c8';
      for (i = 0; i < 5; i++) {
        a = -1.05 + i * 0.52;
        x.beginPath(); x.arc(W * 0.5 + Math.cos(a) * (R + 2), cy + Math.sin(a) * (R + 2), 2, 0, TAU); x.fill();
      }
    };
  }

  /* 每个 kind 的烘焙器(下标 = kind); 它们的 W/H 必须与 D_KIND 一致, 否则内容会被画布裁掉 */
  var D_BAKE = [bakeFlash, bakeLance, bakeBeam, bakeTrail, bakeCone, bakeBurst, bakeSparkD, bakeSlashMark, bakeSaw];
  var _bakeC = {};   /* (kind:color) → drawFn: 闭包只建一次, 不让热路径每帧 new function */
  function bakeFnOf(kind, color) {
    var i = D_KIND[kind] ? kind : D_FLASH;
    var k = i + ':' + color, f = _bakeC[k];
    if (!f) { f = D_BAKE[i](color); _bakeC[k] = f; }
    return f;
  }

  /** 缓存不可用时的现画兜底: 按 kind 给最省的 1~2 步路径(与烘焙图同锚点/同旋转), 不抛错不黑屏 */
  function drawFreeform(ctx, o) {
    var t = Math.max(0, o.life / o.maxLife);
    var sc = 1 + (o.grow || 0) * (1 - t), w = o.len * sc, h = o.w * sc, k = o.k;
    ctx.save();
    ctx.globalAlpha = t * o.a0;
    ctx.translate(o.x, o.y);
    ctx.rotate(o.ang);
    ctx.fillStyle = o.color;
    if (k === D_FLASH || k === D_BURST) {
      ctx.beginPath(); ctx.arc(0, 0, w * 0.5, 0, TAU); ctx.fill();
    } else if (k === D_CONE) {
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, -h * 0.5); ctx.lineTo(w, h * 0.5); ctx.closePath(); ctx.fill();
    } else if (k === D_SLASH || k === D_SAW) {
      ctx.fillRect(-w * 0.4, -h * 0.16, w * 0.8, h * 0.32);
    } else {
      ctx.fillRect(0, -h * 0.5, w, h);
    }
    ctx.restore();
  }

  /* UI 是下一个 script, 因此下一轮事件循环再接线(找不到则重试, 不阻塞加载) */
  function tryInstall() {
    if (PS.FX.install()) return;
    if (PS.FX._tries === undefined) PS.FX._tries = 0;
    if (++PS.FX._tries < 250 && typeof global.setTimeout === 'function') global.setTimeout(tryInstall, 20);
  }
  if (typeof global.setTimeout === 'function') global.setTimeout(tryInstall, 0);
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
