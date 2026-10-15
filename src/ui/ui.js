/* PS.UI v2 —— 渲染层（横屏 1280x720，世界坐标 + 镜头）
 * 美术 v2: 双层上色(底色+亮面) + 描边 + 行走弹跳(squash&stretch) + 受击白闪 +
 *   波次横幅 + 稀有度缎带商店 + 模式选择页。全部 Canvas 矢量, 零位图。
 */
(function (global) {
  'use strict';
  var PS = global.PS || {};
  var B = PS.Balance;
  /* ===== UI 设计 token v3.0 ===== 源码口径见 qa/ui-design-spec.md §2/§3
   * 8pt 栅格 / 金结构线 / 冷绿深底; 纯渲染层常量, 不含任何游戏数值。
   * T 是全部界面的唯一色板与字号来源(旧版散落的 rgba 字面量一律收口到这里)。 */
  var T = {
    bg: '#070b07', scrim: 'rgba(4,7,4,0.90)',
    plate: '#0d130d', plateA: 0.88, inset: '#070b07',
    gold: '#d8a24a', goldA: 'rgba(216,162,74,0.55)',
    weak: 'rgba(255,255,255,0.10)', ink: 'rgba(8,12,8,0.55)',
    /* v7.4 结构性块面一律用中性描边, 金色只留给焦点/CTA/选中 —— spec §4 的状态矩阵本来就是这么定的,
       旧版把 plate/panel/button 的默认描边写成 T.goldA ⇒ 全屏 10 处整屏金框, 视觉优先级全被拉平。
       faceHi/faceLo = 块面的顶高光与底暗影(1~2px 硬边矩形, 不建渐变): 战斗内每帧都画的地方禁止渐变。 */
    edge: 'rgba(242,234,214,0.13)', faceHi: 'rgba(255,255,255,0.055)', faceLo: 'rgba(0,0,0,0.34)',
    swOn: '#5c8a55',   /* 开关开态: 苔绿(旧版直接用 T.pos 的霓虹亮绿, 在主菜单上是全屏唯一霓虹) */
    hi: '#f2ead6', mid: '#98a68f', low: '#6b776b', onGold: '#10150c',
    pos: '#8fd66b', neg: '#e06c5a', danger: '#ff5a4a',
    info: '#7ea8d8', coin: '#ffd24a', luck: '#7ee0a3',
    r: ['#9aa3ad', '#5a9ad8', '#b48fe8', '#ffa04a'],
    fs: { micro: 11, small: 12.5, body: 14, lead: 16.5, num: 20, title: 26, numLg: 30, hero: 44, brand: 52 }
  };
  var RARITY = { 1: { c: T.r[0], n: '普通' }, 2: { c: T.r[1], n: '稀有' }, 3: { c: T.r[2], n: '史诗' }, 4: { c: T.r[3], n: '传说' } };

  /* 「属性 + 武器羁绊」同处商店右侧一块 520 高的面板 —— 这两个数是分地的尺子:
     属性行密排下限 / 属性区与羁绊区之间的留白。羁绊自己的行高·字号·色点一律由
     src/ui/setspanel.js 的 DEF 说了算(下面 setsDef() 只兜底模块缺失时的那份默认值)。 */
  var SETS_GAP = 12, SETS_MIN_ROW = 20;  /* 20 = 两套满配(=166px)刚放得下; 再放不下就退化紧凑档 */
  /* 封面覆盖层(图鉴/制作人名单)的满屏遮蔽色 —— 比 T.scrim(0.90) 更实: 0.90 的 scrim 再叠 0.88 的面板,
     仍有约 1.2% 穿过, 封面那行 52px 奶油字会在面板头上透成鬼影(实测截图可见)。 */
  var OVL = 'rgba(4,7,4,0.97)';
  function setsDef() {
    var D = (PS.SetsPanel && PS.SetsPanel.DEF) || null;
    return {
      head: (D && D.headH) || 20, row: ((D && D.body) || 12) + 8,
      body: (D && D.body) || 12, title: (D && D.title) || 13.5, padX: (D && D.padX) || 10, dot: (D && D.dot) || 8
    };
  }

  PS.UI = {
    TOK: T,
    init: function (ui) {
      this.ui = ui;
      this.ctx = ui.ctx;
      /* 两侧溢出量(逻辑像素): 非 16:9 机型上逻辑面居中后左右各空出一条, 平台层(weapp.js)
       *   把这段溢出量算好交给这里 —— 世界层按"逻辑面 + 溢出"绘制, 于是边上看到的是地面/剪影墙,
       *   而不是黑条。浏览器端画布本身按 16:9 分配、不存在黑边, 不传 bleed ⇒ 逐像素与旧版一致。 */
      this.bleed = this.normBleed(ui && ui.bleed);
      this.time = 0;
      this.buttons = ui.buttons = [];     // 单一共享引用(输入层同读)
      this.bannerRect = null;             /* 本帧波次横幅矩形(门禁断言 ≤520×56, spec §10) */
      this.wallCache = null;              /* 封面「怪物剪影墙」的离屏烘焙(见 menuWall): 稳态每帧只多 1 次 drawImage */
      this.dex = { open: false, tab: 'item', page: 0 };   /* 图鉴(封面入口, 只读)的界面状态; 与游戏状态无关 */
      this.dexCache = null;               /* 图鉴条目表缓存(键含数据表规模, 表变了自动重建) */
      this.credits = { open: false };     /* 制作人名单(只读信息板) */
      this.btnRects = [];                 /* 本帧画出来的按钮形状(含 disabled/sold): 门禁据此判「文字不得压按钮」 */
      return ui;
    },

    /* ================= 手机端 UI 缩放(v5.21, 2026-10-15) =================
     * 背景(实测): 逻辑面恒为 1280x720, 手机上只映射到 693x390 CSS ⇒ 每逻辑像素 0.542 CSS px,
     *   正文 14px 落成 **7.6 CSS px**(可读下限约 11~12)。放大只有一条路: 让界面在**更小的逻辑空间**里排版。
     * 口径: setFit(s) 由平台层给「每个逻辑像素占多少 CSS 像素」(web 的 fitScale / 微信的 fit);
     *   UI 倍率 = 0.85 / s, 夹在 [1, 1.6] —— 桌面 s=1 ⇒ 恒为 1(整条绘制路径逐像素不变);
     *   手机 s=0.542 ⇒ 1.57 ⇒ 界面的逻辑空间从 1280x720 变成约 815x459。
     * 为什么不是「调大字号」: 字号大了框也得大, 框一大会撞车。缩放坐标系 = 整套几何按同比例挪进小空间,
     *   **框与字的关系逐像素不变**(不会撑破板子、不会压按钮), 只有「边上留多少空、一行放不下怎么办」要重排。
     * 缩放是**绕原点**的均匀缩放 ⇒ UI 空间的 (0,0) 落在画布 (0,0), 贴着屏幕角的排版仍贴着屏幕角
     *   (若绕中心缩放, HUD 会缩到屏幕中间去)。
     * 本轮只作用于战斗内 HUD(常驻、看得最久); 覆盖页(菜单/商店/强化/结算)各自重排之后才能跟着放大。
     * 指针: 按钮热区在缩放空间里画, 但指针来自 input.js 的 toLogic(未缩放) ⇒ 出这层时必须把热区
     *   **换算回画布坐标**(见 drawHUD 的 rescaleRects), 这是唯一会点不中的地方。 */
    setFit: function (s) { this.fitScale = (s > 0 && isFinite(s)) ? s : 1; return this.uiScale(); },
    uiScale: function () {
      var s = this.fitScale || 1;
      /* UI_ZOOM = 1.1: 1 UI 单位 = 1.1 CSS px ⇒ 正文 14 -> 15.4 · 小字 12.5 -> 13.8 · 次级 11 -> 12.1 CSS px。
       * 上限 1280/612: **612 是手机版式底行的硬约束**(见 hudLayout): 16 + 材料 268 + 12 + 胶囊 300 + 16;
       *   再往上放两件就重叠。到顶的机型(短边 <= 344 CSS px)只是少赚一点, 不会压坏版式。 */
      if (s >= 1) return 1;   /* 逻辑面已经 1:1 铺满(桌面): 一个像素都不改 */
      return Math.max(1, Math.min(1280 / 612, 1.1 / s));
    },
    uiW: function () { return this.ui.W / this.uiScale(); },
    /* HUD 版式 —— **唯一实现**(drawHUDInner / drawHUDPhone / drawSettingsButton / hudBandH 都读它)。
     * 桌面(S=1): 顶行三件(血板 16..408 · 齿轮 · 材料 996..1264) + 波次胶囊也顶行居中, 逐像素与旧版一致。
     * 手机(v9.0, 2026-10-15 用户: 「你把 ui 放大它反而挡住屏幕了」+「就按着(土豆兄弟手游)这个标准来」):
     *   常驻 UI 全部退回三个角 —— 左上一块板(头像/血/经验/等级/材料) + 顶中央波次 + 右上齿轮 + 左下武器条,
     *   **屏幕正中那条横带全空**。常驻 UI 面积 = 11.3% 的逻辑层(旧版 31.9%), 顶/底两条带合计 29%(旧版 51%)。
     *   字号一个都没动(用户 2026-10-15 说过字号小得眼睛难受) —— 这是 Brotato 同款口径: **小框 + 大字**。
     *   量出来的对照(Brotato 手游截图 3136x1440): 血条 = 屏宽 12.8% x 屏高 2.8%, 常驻 UI 只占左上角一块(约屏高 15%), 底部全空。 */
    hudLayout: function () {
      var W = this.uiW(), H = this.uiH();
      if (this.uiScale() === 1) {
        var dp = { x: 16, y: 12, w: 392, h: 76 };                 /* 血板(桌面) */
        var dm = { x: W - 16 - 268, y: 12, w: 268, h: 76 };       /* 材料/武器托盘 */
        var dc = { x: W / 2 - 150, y: 12, w: 300, h: 64 };        /* 波次胶囊 */
        var dg = { x: W - 16 - 268 - 52, y: 12, s: 44 };          /* 设置齿轮 */
        return {
          phone: false, plate: dp, mat: dm, cap: dc, gear: dg,
          capW: dc.w, capX: dc.x, capY: dc.y, matX: dm.x, matY: dm.y,
          gearX: dg.x, gearY: dg.y, gearS: dg.s, upY: 84
        };
      }
      var pp = { x: 10, y: 8, w: 214, h: 54 };                    /* 左上: 头像 + 血 + 经验 + 等级 + 材料 */
      var pm = { x: 10, y: H - 8 - 34, w: 200, h: 34 };           /* 左下: 武器槽(6 格 x 26) */
      var pc = { x: Math.round(W / 2 - 58), y: 6, w: 116, h: 46 };/* 顶中: 波次 + 倒计时(半透明小底, 不再是 300x64 胶囊) */
      var pg = { x: W - 8 - 40, y: 8, s: 40 };                    /* 右上: 暂停/设置(40 UI = 44 CSS px, 不小于触控下限) */
      return {
        phone: true, plate: pp, mat: pm, cap: pc, gear: pg,
        capW: pc.w, capX: pc.x, capY: pc.y, matX: pm.x, matY: pm.y,
        gearX: pg.x, gearY: pg.y, gearS: pg.s, upY: pm.y - 30
      };
    },
    /* 顶部 HUD 带在**逻辑画布**里占掉的高度。屏幕空间的东西(波次横幅)必须落在它下面。
     *   桌面 = 62(S=1) -> 横幅仍在 max(114, 62+14) = 114, 逐像素与旧版一致;
     *   手机 = (8+54) x S -> 横幅让到紧凑版下面(v5.21 的 88 x S 是两行版的代价, 现已不需要)。 */
    hudBandH: function () {
      return (this.uiScale() === 1 ? 62 : 62) * this.uiScale();
    },
    uiH: function () { return this.ui.H / this.uiScale(); },
    rescaleRects: function (arr, from, S) {
      for (var i = from; i < arr.length; i++) { var b = arr[i]; b.x *= S; b.y *= S; b.w *= S; b.h *= S; }
    },

    /* 溢出量的唯一入口: 缺省/非法一律 0 —— 任何没有 bleed 的调用方(浏览器端、探针)因此逐像素不变 */
    normBleed: function (b) {
      function n(v) { return (typeof v === 'number' && isFinite(v) && v > 0) ? v : 0; }
      return b ? { l: n(b.l), r: n(b.r), t: n(b.t), b: n(b.b) } : { l: 0, r: 0, t: 0, b: 0 };
    },

    /* 满屏底: 用**当前** fillStyle 填"逻辑面 + 溢出"那块矩形。
     * 所有整屏底色/遮罩/渐变盖面都必须走这里 —— 直接 fillRect(0,0,u.W,u.H) 在非 16:9 机型上
     * 会在两侧各留一条没被覆掉的边(就是用户截图里那两条)。 */
    fillScreenRect: function () {
      var x = this.ctx, u = this.ui, b = this.bleed;
      x.fillRect(-b.l, -b.t, u.W + b.l + b.r, u.H + b.t + b.b);
    },
    fillScreen: function (color) { this.ctx.fillStyle = color; this.fillScreenRect(); },

    /* ---------- 世界背景 ----------
     * 地面整幅交给 PS.Art.drawGround(src/ui/art.js 无条件定义, 且 art.js 先于 ui.js 加载)。
     * 旧版曾在此烘焙 2x2 共 4 张 1120x780 离屏 tile(草地/灌木/耕地/碎石)做平铺缓存,
     *   但该缓存只在「PS.Art.drawGround 缺失」的兜底分支里才会被画到 —— 实际永不绘制。
     * v3.6: 烘焙与缓存整体删除(每次开局省下约 13.3 MB 画布 + 4656 次绘制调用),
     *   兜底改为世界基色 fillRect(零烘焙、零离屏内存)。
     * 原「中央祭坛地标」已按用户要求删除(纯装饰, 不参与碰撞/增益), 见下方 v3.5 说明。 */

    /* v3.5(用户要求): 原「中央祭坛地标」已删除。
     *   它曾画在世界正中: 两个同心石环(半径 120/96) + 8 个旋转符文点 + 中央三角形图腾,
     *   即用户反馈的「地图中间那个圆圈套着三角形」。
     *   该地标是**纯装饰**: 不生成敌人、不参与碰撞、不提供增益/减益,
     *   删除后只影响观感, 故按用户要求移除; 同时呼应「单一场景 / 不要复杂」的诉求。 */

    /* ---------- 每帧 ---------- */
    draw: function (dt) {
      this.time += dt;
      var u = this.ui, x = this.ctx, g = PS.Game;
      this.buttons.length = 0;
      this.btnRects.length = 0;
      x.save();
      this.fillScreen('#0a0f0a');
      if (g.state === PS.State.MENU) this.drawMenu();
      else if (g.state === PS.State.MODE) this.drawModeSelect();
      else if (g.state === PS.State.CHAR) this.drawCharSelect();
      else {
        this.drawWorld();
        this.drawHUD();
        if (g.state === PS.State.PAUSE) this.drawPause();
        if (g.state === PS.State.LEVELUP) this.drawPageScaled(T.scrim, this.drawLevelup);
        if (g.state === PS.State.SHOP) this.drawShop();
        if (g.state === PS.State.OVER) this.drawOver();
      }
      x.restore();
      this.drawPress(dt);
    },

    /* 覆盖页(升级/商店/结算)是否正压着 scrim。
       用途: 决定"世界层"的哪些东西允许画 —— 飘字属于"文字", 覆盖页期间一律不画,
       否则会从 0.90 的 scrim 底下透成半透明鬼影(与旧版幽灵 HUD 同族)。
       独立成方法而不是内联判断: 门禁可以覆盖它做负向对照(VERIFY_UI_BREAK=fxbleed)。 */
    overlayUp: function () {
      var st = PS.Game && PS.Game.state;
      return st === PS.State.LEVELUP || st === PS.State.SHOP || st === PS.State.OVER;
    },

    /* v5.19d(Codex, 2026-09-29): 当前帧的**视口裁剪矩形**(世界坐标)。
       FX.render 靠它裁自己的那批数组(见 src/ui/fx.js 的 cullOut); null = 没有视口信息 = 一律不裁。 */
    cullNow: function () { return this._cull; },
    /* 保守判据: 实体包围盒(中心 x,y + 半径 r)与视口矩形相交才允许画。
       C 为 null(非世界通道 / 探针直接调)时恒真 —— 视觉断言与测量口径因此完全不变。 */
    inCull: function (C, x, y, r) {
      return !C || (x + r >= C.x0 && x - r <= C.x1 && y + r >= C.y0 && y - r <= C.y1);
    },

    /* ---------- 世界渲染(镜头变换) ---------- */
    drawWorld: function () {
      var x = this.ctx, u = this.ui, g = PS.Game;
      var cam = g.cam;
      x.save();
      // 屏震
      if (g.shake > 0) x.translate(PS.util.randRange(-g.shake, g.shake), PS.util.randRange(-g.shake, g.shake));
      x.translate(-cam.x, -cam.y);
      var i;   /* 特效循环计数: 旧背景平铺循环曾在此声明, 删除后仍需函数内声明(下方各特效循环复用) */
      /* ==================== v5.19d(Codex, 2026-09-29) 视口裁剪 ====================
       * 存在理由(用户逐字): 「还有一个严重影响游戏体验的问题, 我现在才无尽第19波, 有非常严重的卡顿掉帧」。
       *   把 Canvas2D 压成软件光栅(等价于弱显卡 / 浏览器关掉硬件加速)后实测: 无尽第 19 波
       *   帧间隔 p50 = 36.2ms(27.7fps)、99% 的帧 > 33ms; 而**同一帧的 JS 只占 1.7ms**
       *   (work/perfg-base.json) ⇒ 瓶颈是**光栅**: 每帧 1200+ 次 draw call 的像素填充。
       *   而 drawWorld 一直是「有多少实体就画多少」: 竞技场 2160x1480、视口只有 1280x720
       *   ⇒ 视口外约 2/3 的掉落/怪物/弹丸/飘字也在逐帧光栅化, 玩家一个像素都看不到。
       * 口径: 实体**保守包围盒**(中心 + 半径)与「视口 + cullMargin」不相交才跳过; 半径由每个
       *   调用点按该实体真实绘制范围给(见下方各循环), 宁可多画一个也不许在屏幕边缘凭空消失。
       *   它不参与任何数值判定 —— 与 combat.js 的视觉态契约同一条纪律。
       * 统计: this.culled = 本帧被裁掉的实体数(只读, 供门禁/探针核对)。 */
      var cullM = (B.FX && B.FX.cullMargin) || 96;
      var cullShake = (g.shake > 0 ? g.shake : 0);
      var bl = this.bleed;
      /* 溢出带里的实体是**看得见**的, 裁剪矩形必须一起外扩, 否则它们会在屏幕边上凭空消失。 */
      var C = this._cull = {
        x0: cam.x - bl.l - cullM - cullShake, y0: cam.y - bl.t - cullM - cullShake,
        x1: cam.x + u.W + bl.r + cullM + cullShake, y1: cam.y + u.H + bl.b + cullM + cullShake
      };
      this.culled = 0;
      /* 背景: 地面整幅交给 PS.Art.drawGround(art.js 无条件定义, 每帧 1 次离屏图 drawImage + 视口裁剪)。
         兜底分支只在 art.js 缺失时才会走到: 世界基色铺满视口 —— 零烘焙、零离屏画布内存。 */
      if (PS.Art && PS.Art.drawGround) {
        PS.Art.drawGround(x, { x: cam.x - bl.l, y: cam.y - bl.t, w: u.W + bl.l + bl.r, h: u.H + bl.t + bl.b },
          B.WORLD, this.time);
      } else {
        x.fillStyle = '#33441f';                     /* 世界基色, 同 art.js palette.groundB */
        x.fillRect(cam.x - bl.l, cam.y - bl.t, u.W + bl.l + bl.r, u.H + bl.t + bl.b);
      }
      /* v9.0: 场地外圈压暗 —— 竞技场不再铺满视口后, 场外那圈必须一眼读成「墙」,
         否则玩家分不清哪块能走。纯 fillRect(+奇偶填充, 零烘焙) —— 与 Brotato 手游左右两道黑岩壁同一个作用。 */
      x.beginPath();
      x.rect(cam.x - bl.l, cam.y - bl.t, u.W + bl.l + bl.r, u.H + bl.t + bl.b);
      x.rect(B.ARENA.x, B.ARENA.y, B.ARENA.w, B.ARENA.h);
      x.fillStyle = 'rgba(6,10,6,0.74)';
      x.fill('evenodd');
      // 世界边界
      x.strokeStyle = 'rgba(216,162,74,0.42)';
      x.lineWidth = 5;
      x.strokeRect(B.ARENA.x, B.ARENA.y, B.ARENA.w, B.ARENA.h);
      var fx = PS.FX;
      // 尸体
      for (i = 0; i < fx.corpses.length; i++) {
        var cp = fx.corpses[i];
        if (!this.inCull(C, cp.x, cp.y, cp.r + 4)) { this.culled++; continue; }
        x.globalAlpha = Math.max(0, cp.life / B.FX.corpseFade) * 0.5;
        x.fillStyle = cp.color;
        x.beginPath(); x.ellipse(cp.x, cp.y + cp.r * 0.3, cp.r, cp.r * 0.5, 0, 0, PS.TAU); x.fill();
      }
      x.globalAlpha = 1;
      // 爆裂碎片(小方块带旋转)
      for (i = 0; i < fx.shards.length; i++) {
        var sh = fx.shards[i];
        if (!this.inCull(C, sh.x, sh.y, sh.size)) { this.culled++; continue; }
        x.save();
        x.translate(sh.x, sh.y);
        x.rotate(sh.rot);
        x.globalAlpha = sh.life / sh.maxLife;
        x.fillStyle = sh.color;
        x.fillRect(-sh.size / 2, -sh.size / 2, sh.size, sh.size);
        x.restore();
      }
      x.globalAlpha = 1;
      // 掉落材料: v2.3 走 PS.Art(微光用预渲染光晕, 不再每帧 createRadialGradient)
      for (i = 0; i < g.drops.length; i++) {
        var d = g.drops[i];
        /* 半径 24 = art.js drawDrop 的实测绘制范围(光晕 14 + 精灵 r*3.2/2 ~= 10) + 余量 */
        if (!this.inCull(C, d.x, d.y, 24)) { this.culled++; continue; }
        /* v8.0(W24, 2026-10-01) 果实**必须**与材料粒分开画: 取证实测两者此前逐像素相同(剪影余弦 1.000),
         *   而果实吃掉是回血、材料吃掉是材料/经验 —— 玩家没有任何办法分辨。
         *   裁剪半径沿用 24: drawFruit 的实绘范围(光晕 r*1.8=13 + 精灵 r*3.2/2≈11 + 浮动)仍在 24 以内。 */
        if (d.kind === 'fruit' && PS.Art && PS.Art.drawFruit) {
          PS.Art.drawFruit(x, d, this.time);
          continue;
        }
        if (PS.Art && PS.Art.drawDrop) {
          /* v7.0(源对齐): 源 main.gd:706-710 的"同屏金粒满 50 就往已有粒子上加量"会同时把 scale +0.05(上限 2.0); */
          /*   本作把该缩放落在 d.scale 上, 这里兑现 —— 否则合过量的金粒看起来和普通粒一样。 */
          PS.Art.drawDrop(x, d, this.time, { r: 6 * (d.scale || 1) });
        } else {
          var pulse = 1 + Math.sin(this.time * 6 + d.x) * 0.12;
          x.fillStyle = 'rgba(143,214,107,0.25)';
          x.beginPath(); x.arc(d.x, d.y, 8 * pulse, 0, PS.TAU); x.fill();
          x.fillStyle = '#8fd66b';
          this.taterShape(d.x, d.y, 5.5, 0.4);
          x.fill();
        }
      }
      /* v6.7(Wave 3, 2026-09-29) 结构体与地雷 —— 这两类一直是「只有逻辑没有画面」:
       *   game.js 的 spawnStructures / updateStructures 会真的在场上生成哨戒炮/菜圃/游走铁虫/地雷,
       *   而 drawWorld 从来没画过 g.structs / g.mines ⇒ 玩家买了这些道具, 场上什么都看不到。
       * 画在**敌人之前**: 怪压在炮台上, 与掉落同层。半径取各自真实绘制范围(台座 1.0r + 炮管 1.8r
       *   + 影子)再留余量, 宁可多画一个也不许在屏幕边缘凭空消失(与 v5.19d 的裁剪口径一致)。 */
      if (g.mines) for (i = 0; i < g.mines.length; i++) {
        var mn = g.mines[i];
        if (!this.inCull(C, mn.x, mn.y, (mn.r || 10) + 14)) { this.culled++; continue; }
        if (PS.Art && PS.Art.drawMine) PS.Art.drawMine(x, mn, this.time);
      }
      if (g.structs) for (i = 0; i < g.structs.length; i++) {
        var st0 = g.structs[i];
        if (!this.inCull(C, st0.x, st0.y, (st0.r || 11) * 2.2 + 12)) { this.culled++; continue; }
        if (PS.Art && PS.Art.drawStruct) PS.Art.drawStruct(x, st0, this.time);
      }
      // 敌人
      for (i = 0; i < g.enemies.length; i++) {
        var en = g.enemies[i];
        /* 半径 en.r*3+32: 怪身(体尺寸门禁要求 >= 判定圈 x1.2) + 影子 + 精英/Boss 名条都在内 */
        if (!this.inCull(C, en.x, en.y, en.r * 3 + 32)) { this.culled++; continue; }
        this.drawEnemy(en);
      }
      // 敌方弹幕
      for (i = 0; i < g.enemyProj.length; i++) {
        var ep = g.enemyProj[i];
        if (!this.inCull(C, ep.x, ep.y, ep.r + 2)) { this.culled++; continue; }
        x.fillStyle = ep.color;
        x.beginPath(); x.arc(ep.x, ep.y, ep.r, 0, PS.TAU); x.fill();
        x.fillStyle = 'rgba(255,255,255,0.5)';
        x.beginPath(); x.arc(ep.x - ep.r * 0.25, ep.y - ep.r * 0.25, ep.r * 0.4, 0, PS.TAU); x.fill();
      }
      // 我方弹道
      for (i = 0; i < g.projectiles.length; i++) {
        var pr0 = g.projectiles[i];
        /* 拖尾: 光束 34px / 普通 14px(见 drawProjectile), 按它取半径 */
        if (!this.inCull(C, pr0.x, pr0.y, pr0.r + (pr0.beam ? 40 : 18))) { this.culled++; continue; }
        this.drawProjectile(pr0);
      }
      // 环绕星常驻体
      this.drawOrbits();
      // 近战挥击 —— 招式层(fx.js 五·A): 每族一个形状(斩/劈/突刺/爪痕/剪/齿弧/近身冲击…)。
      // FX 未 install 时(见 fx.js 的 install 包装)这段就是**唯一**的挥击画法, 因此必须与烘焙器
      // **同一几何** —— 直接调 fx.drawSwingFree, 而不是旧的那道「一道圆弧套所有武器」。
      for (i = 0; i < fx.swings.length; i++) {
        var sw = fx.swings[i];
        if (!this.inCull(C, sw.x, sw.y, sw.range * 1.2 + 24)) { this.culled++; continue; }
        var t2 = sw.life / sw.maxLife;
        if (fx.drawSwingFree) {
          fx.drawSwingFree(x, sw, t2 * 0.85);
        } else {
          // 连 PS.FX.drawSwingFree 都没有时的最后兜底: 至少不黑屏
          x.globalAlpha = t2 * 0.85;
          x.strokeStyle = sw.color;
          x.lineWidth = 8 + 10 * (1 - t2);
          x.beginPath();
          x.arc(sw.x, sw.y, sw.range * (0.72 + 0.28 * (1 - t2)), sw.ang - sw.arc / 2, sw.ang + sw.arc / 2);
          x.stroke();
        }
      }
      // 冲刺预警
      for (i = 0; i < fx.dashLines.length; i++) {
        var dl = fx.dashLines[i];
        /* 虚线从 (dl.x,dl.y) 沿 ang 伸 340px ⇒ 按中段 + 半长取包围盒 */
        if (!this.inCull(C, dl.x + Math.cos(dl.ang) * 170, dl.y + Math.sin(dl.ang) * 170, 200)) { this.culled++; continue; }
        x.globalAlpha = dl.life / dl.maxLife * 0.5;
        x.strokeStyle = '#ff8a5a';
        x.lineWidth = 3;
        x.setLineDash([10, 10]);
        x.beginPath(); x.moveTo(dl.x, dl.y); x.lineTo(dl.x + Math.cos(dl.ang) * 340, dl.y + Math.sin(dl.ang) * 340); x.stroke();
        x.setLineDash([]);
      }
      // 环
      for (i = 0; i < fx.rings.length; i++) {
        var rg = fx.rings[i];
        if (!this.inCull(C, rg.x, rg.y, rg.r + 6)) { this.culled++; continue; }
        x.globalAlpha = Math.max(0, rg.life / rg.maxLife);
        x.strokeStyle = rg.color;
        x.lineWidth = 4;
        x.beginPath(); x.arc(rg.x, rg.y, rg.r, 0, PS.TAU); x.stroke();
      }
      // 粒子
      for (i = 0; i < fx.parts.length; i++) {
        var pa = fx.parts[i];
        if (!this.inCull(C, pa.x, pa.y, pa.r + 4)) { this.culled++; continue; }
        x.globalAlpha = Math.max(0, pa.life / pa.maxLife);
        x.fillStyle = pa.color;
        x.beginPath(); x.arc(pa.x, pa.y, pa.r, 0, PS.TAU); x.fill();
      }
      x.globalAlpha = 1;
      // 玩家
      this.drawPlayer();
      // 飘字: 覆盖页期间不画(否则从 scrim 底下透成鬼影, 见 overlayUp)
      if (fx.nums.length && !this.overlayUp()) {
        for (i = 0; i < fx.nums.length; i++) {
          var nm = fx.nums[i];
          /* 飘字是文字(宽约字号 x2~3), 按字号 x4 取半径, 免得边缘的伤害数字被裁掉 */
          if (!this.inCull(C, nm.x, nm.y, nm.size * 4 + 8)) { this.culled++; continue; }
          x.globalAlpha = Math.min(1, nm.life * 4);
          x.font = (nm.crit ? 'bold ' : '') + nm.size + 'px ' + u.font;
          x.textAlign = 'center';
          if (nm.crit) { x.fillStyle = '#7a5a00'; x.fillText(nm.text, nm.x + 2, nm.y + 2); }
          x.fillStyle = nm.color;
          x.fillText(nm.text, nm.x, nm.y);
        }
      }
      x.globalAlpha = 1;
      x.restore();
      this.drawWaveBanner(g);
    },

    /* ---------- 波次横幅 v3.1: 紧凑居中牌匾(≤520×56) ----------
     * 旧版是通栏黑条(y 96..188 全宽), 把半个战场糊掉, 看着像渲染故障; 且横幅里的
     * "存活 60 秒"与 HUD 胶囊的剩余秒重复播报 —— 这里只留事件名, 秒数交给 HUD。
     * 5 种形态(普通/怪潮/精英/Boss/波末冲刺)走同一块牌匾, 一律 ≤520 宽 / ≤56 高。 */
    bannerInfo: function (g) {
      var elite = PS.EnemyData.eliteAt(g.wave, g.mode);
      if (g.waveBanner > 0) {
        if (elite === 'kingTuber' || elite === 'elderBlight') {
          var bd = PS.EnemyData.list[elite];
          return { kind: 'boss', title: '魔 王 降 临', sub: 'BOSS · ' + ((bd && bd.name) || elite), color: T.danger };
        }
        if (g.horde) return { kind: 'horde', title: '怪 潮 来 袭', sub: '敌人成群涌来', color: T.neg };
        if (elite) {
          var ed = PS.EnemyData.list[elite];
          return { kind: 'elite', title: '第 ' + g.wave + ' 波', sub: '精英 · ' + ((ed && ed.name) || elite), color: T.r[2] };
        }
        return { kind: 'wave', title: '第 ' + g.wave + ' 波', sub: '', color: T.coin };
      }
      var left = Math.max(0, (g.waveDuration || 0) - g.timeInWave);
      if (left > 0 && left <= 6) return { kind: 'sprint', title: '波 末 冲 刺', sub: '', color: T.r[3] };
      return null;
    },
    drawWaveBanner: function (g) {
      var x = this.ctx, u = this.ui;
      this.bannerRect = null;
      /* 与 drawHUD 同一口径: 非 PLAY 一律不画屏幕空间 UI(否则会从 scrim 底下透成幽灵文字) */
      if (g.state !== PS.State.PLAY || g.waveState !== 'fighting') return;
      var bn = this.bannerInfo(g);
      if (!bn) return;
      var left = Math.max(0, (g.waveDuration || 0) - g.timeInWave);
      var a = bn.kind === 'sprint' ? PS.util.clamp((6 - left) / 0.6, 0, 1)
        : Math.min(1, g.waveBanner / 0.4) * (g.waveBanner > 1.8 ? PS.util.clamp((2.2 - g.waveBanner) / 0.4, 0, 1) : 1);
      if (a <= 0) return;
      var tw = Math.max(this.textW(bn.title, T.fs.num), bn.sub ? this.textW(bn.sub, T.fs.small, false) : 0);
      var pw = Math.min(520, Math.ceil(tw + 64)), ph = bn.sub ? 56 : 40;
      /* by: 桌面 114(逐像素不变); 手机 HUD 换两行后必须让开那条带, 否则被放大的板子压住。 */
      var bx = Math.round(u.W / 2 - pw / 2), by = Math.max(114, Math.round(this.hudBandH()) + 14);
      x.save();
      x.globalAlpha = a * 0.94;
      x.fillStyle = 'rgba(7,11,7,0.86)';
      this.rr(bx, by, pw, ph, 14); x.fill();
      x.strokeStyle = bn.color; x.lineWidth = 2;
      this.rr(bx, by, pw, ph, 14); x.stroke();
      x.globalAlpha = a;
      this.fitText(bn.title, u.W / 2, by + 26, pw - 40, T.fs.num, bn.color);
      if (bn.sub) this.fitText(bn.sub, u.W / 2, by + 45, pw - 40, T.fs.small, T.mid, 'center', false);
      x.restore();
      this.bannerRect = { x: bx, y: by, w: pw, h: ph, kind: bn.kind };
    },

    /* 菜块形(双层上色在 drawPlayer/drawEnemy 内做) */
    taterShape: function (cx, cy, r, wob) {
      var x = this.ctx;
      x.beginPath();
      for (var i = 0; i <= 9; i++) {
        var a = i / 9 * PS.TAU;
        var rr = r * (1 + wob * Math.sin(a * 2.5 + cx * 0.05 + cy * 0.03));
        var px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
        if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
      }
      x.closePath();
    },

    /* 环绕武器(战斗): 分前后两层夹住角色 —— 上半圈的武器压在身后, 下半圈盖在身上,
     * 于是武器读起来是"绕在人身边", 而不是"糊在人身上"。环绕星的轨道直接取 core 的
     * orbitPhase, 所以画出来的就是实际打到人的那一圈(视觉与判定同源, 不可能对不上)。
     * 美术层抛错时静默跳过: 一次建模异常绝不允许让整块战斗画面消失。 */
    drawWeaponRing: function (layer) {
      var g = PS.Game;
      if (!PS.Art || !PS.Art.drawWeaponRing || !g.player) return 0;
      try {
        return PS.Art.drawWeaponRing(this.ctx, g.player, this.time, {
          r: 16, layer: layer, orbitPhase: g.orbitPhase,
          weapons: g.weapons,   /* 战斗中武器挂在 Game 上, 不在 player 上(见 art.js 注释) */
          defOf: function (k) { return PS.WeaponData.list[k]; }
        });
      } catch (e) { return 0; }
    },

    drawPlayer: function () {
      var x = this.ctx, g = PS.Game, p = g.player;
      this.drawWeaponRing('back');
      /* v2.3: 美术层交给 PS.Art(离屏精灵缓存 + 分角色造型)。PS.Art 缺失时整体回退旧建模,
       * 保证任何加载顺序/降级场景都不会黑屏。 */
      if (PS.Art && PS.Art.drawPlayer) {
        var blinkA = g.iframesT > 0 && ((this.time * 20) | 0) % 2 === 0;
        if (blinkA) x.globalAlpha = 0.45;
        PS.Art.drawPlayer(x, p, { r: 16, moving: p.moving }, this.time);
        x.globalAlpha = 1;
        this.drawWeaponRing('front');
        if (p.hp < g.stats.maxHp) {
          var pw = 44, pratio = p.hp / g.stats.maxHp;
          x.fillStyle = 'rgba(0,0,0,0.55)';
          x.fillRect(p.x - pw / 2, p.y - 30, pw, 5);
          x.fillStyle = pratio > 0.35 ? '#8fd66b' : '#e05a5a';
          x.fillRect(p.x - pw / 2, p.y - 30, pw * pratio, 5);
        }
        return;
      }
      x.fillStyle = 'rgba(0,0,0,0.32)';
      x.beginPath(); x.ellipse(p.x, p.y + 14, 13, 5, 0, 0, PS.TAU); x.fill();
      var blink = g.iframesT > 0 && ((this.time * 20) | 0) % 2 === 0;
      if (blink) x.globalAlpha = 0.45;
      // v2.1: 分部位装配建模(每角色独立造型)
      this.drawCharModel(g.char, p.x, p.y, 1, {
        walk: p.walkT, moving: p.moving,
        eyeDx: Math.cos(p.aimAng || 0) * 3, eyeDy: Math.sin(p.aimAng || 0) * 2
      });
      x.globalAlpha = 1;
      this.drawWeaponRing('front');
      // 头顶血条
      if (p.hp < g.stats.maxHp) {
        var w = 44, ratio = p.hp / g.stats.maxHp;
        x.fillStyle = 'rgba(0,0,0,0.55)';
        x.fillRect(p.x - w / 2, p.y - 30, w, 5);
        x.fillStyle = ratio > 0.35 ? '#8fd66b' : '#e05a5a';
        x.fillRect(p.x - w / 2, p.y - 30, w * ratio, 5);
      }
    },

    /* ================= 建模 v2.1: 分部位矢量装配 =================
     * 角色: 每个角色一套部件组合(体型/头饰/背饰/面部/配色), 不再是单色圆块。
     * 怪物: 每种怪一套轮廓语言(尖刺/翼膜/甲壳/触须/巨口), 剪影可辨识。 */

    /* 角色装配绘制: ch = characters 条目, 用分部位 path 组合 */
    drawCharModel: function (ch, px, py, scale, opts) {
      opts = opts || {};
      var x = this.ctx;
      var walk = opts.walk || 0;
      var bob = opts.moving ? Math.abs(Math.sin(walk)) * 3 : Math.sin(this.time * 2.4) * 1.5;
      var squash = opts.moving ? 1 + Math.sin(walk * 2) * 0.05 : 1;
      x.save();
      x.translate(px, py - bob);
      x.scale(scale / squash, scale * squash);
      var C = ch.color;
      var dark = this.shade(C, -0.32);
      var lite = this.shade(C, 0.28);
      var id = ch.id;
      // 影子由调用方画, 这里只画身体
      if (id === 'brick') {
        // 碎砖: 方阔体+矿工帽+护目镜
        this.body(26, 20, C, dark, lite, 0.22);
        x.fillStyle = '#e8b45a';
        this.rr(-14, -34, 28, 10, 4); x.fill();            // 帽壳
        x.fillStyle = '#5a4632';
        x.fillRect(-14, -25, 28, 3);                        // 帽檐
        x.strokeStyle = '#d8d0c0'; x.lineWidth = 2.5;
        x.beginPath(); x.arc(-8, -8, 5, 0, PS.TAU); x.stroke();   // 护目镜
        x.beginPath(); x.arc(8, -8, 5, 0, PS.TAU); x.stroke();
      } else if (id === 'wren') {
        // 苇莺: 修长体+风帽+背箭袋
        this.body(17, 24, C, dark, lite, 0.26);
        x.fillStyle = dark;
        x.beginPath(); x.moveTo(-12, -20); x.quadraticCurveTo(0, -34, 12, -20); x.quadraticCurveTo(0, -26, -12, -20); x.fill();
        x.strokeStyle = '#7a5a32'; x.lineWidth = 2.5;
        x.beginPath(); x.moveTo(16, 2); x.lineTo(22, -26); x.stroke();
        x.beginPath(); x.moveTo(19, 3); x.lineTo(26, -22); x.stroke();      // 箭袋双箭
      } else if (id === 'comfrey') {
        // 聚合草: 圆叶斗笠+腰间药瓶
        this.body(20, 22, C, dark, lite, 0.24);
        x.fillStyle = '#6a9a44';
        x.beginPath(); x.ellipse(0, -30, 20, 7, 0, 0, PS.TAU); x.fill();   // 斗笠
        x.fillStyle = '#8fb86a';
        x.beginPath(); x.ellipse(0, -30, 13, 4.5, 0, 0, PS.TAU); x.fill();
        x.fillStyle = '#a04a6a';
        this.rr(12, -2, 9, 13, 3); x.fill();                               // 药瓶
        x.fillStyle = '#c8bfa0';
        x.fillRect(14, -5, 5, 4);
      } else if (id === 'mandrake') {
        // 风铃草根: 头顶风铃草+根须脚
        this.body(19, 23, C, dark, lite, 0.28);
        x.strokeStyle = '#5a8a3a'; x.lineWidth = 3;
        x.beginPath(); x.moveTo(0, -22); x.lineTo(-3, -34); x.stroke();
        x.beginPath(); x.moveTo(0, -22); x.lineTo(5, -33); x.stroke();
        x.fillStyle = '#b48fe8';
        x.beginPath(); x.ellipse(-3, -37, 5, 7, -0.3, 0, PS.TAU); x.fill();
        x.beginPath(); x.ellipse(5, -36, 5, 7, 0.3, 0, PS.TAU); x.fill();  // 双铃花
      } else if (id === 'nightshade') {
        // 夜影茄: 暗紫斗篷+单目镜
        this.body(19, 24, '#5a4a7a', '#3a2f52', '#7a68a0', 0.2);
        x.fillStyle = '#2a2340';
        x.beginPath(); x.moveTo(-16, -18); x.lineTo(-22, 14); x.lineTo(22, 14); x.lineTo(16, -18); x.closePath(); x.fill(); // 斗篷
        x.fillStyle = '#ffd24a';
        x.beginPath(); x.arc(10, -8, 6, 0, PS.TAU); x.fill();              // 单目镜
        x.strokeStyle = '#0a0f0a'; x.lineWidth = 2;
        x.beginPath(); x.arc(10, -8, 6, 0, PS.TAU); x.stroke();
        x.fillStyle = '#7ea8d8';
        x.beginPath(); x.arc(10, -8, 2.4, 0, PS.TAU); x.fill();
      } else if (id === 'pumpkin') {
        // 老南瓜: 瓜棱体+草帽+火爆胡
        x.fillStyle = C;
        x.beginPath();
        for (var pi2 = 0; pi2 < 8; pi2++) {
          var pa3 = pi2 / 8 * PS.TAU;
          var pr2 = 22 - (pi2 % 2) * 3;
          var px3 = Math.cos(pa3) * pr2 * 1.05, py3 = Math.sin(pa3) * pr2 * 0.92;
          if (pi2 === 0) x.moveTo(px3, py3); else x.lineTo(px3, py3);
        }
        x.closePath(); x.fill();
        x.strokeStyle = dark; x.lineWidth = 2; x.stroke();
        x.strokeStyle = 'rgba(0,0,0,0.22)'; x.lineWidth = 2;
        for (pi2 = -2; pi2 <= 2; pi2++) { x.beginPath(); x.ellipse(pi2 * 6, 0, 4, 20, 0, 0, PS.TAU); x.stroke(); }  // 瓜棱
        x.fillStyle = '#c9a227';
        x.beginPath(); x.ellipse(0, -26, 17, 5.5, 0, 0, PS.TAU); x.fill();  // 草帽
        x.fillRect(-3, -34, 6, 9);
      } else if (id === 'clover') {
        // 四叶: 头顶四叶草+腮红
        this.body(18, 22, C, dark, lite, 0.24);
        x.strokeStyle = '#5a8a3a'; x.lineWidth = 2.5;
        x.beginPath(); x.moveTo(0, -21); x.quadraticCurveTo(2, -30, 0, -36); x.stroke();
        x.fillStyle = '#7ee0a3';
        for (var li = 0; li < 4; li++) {
          var la = li / 4 * PS.TAU + Math.PI / 4;
          x.beginPath(); x.ellipse(Math.cos(la) * 5, -38 + Math.sin(la) * 5, 4.5, 3, la, 0, PS.TAU); x.fill();
        }
        x.fillStyle = 'rgba(224,106,90,0.4)';
        x.beginPath(); x.arc(-11, 4, 3.5, 0, PS.TAU); x.fill();
        x.beginPath(); x.arc(11, 4, 3.5, 0, PS.TAU); x.fill();
      } else {
        // popo 远行者: 围巾+行囊(默认)
        this.body(20, 22, C, dark, lite, 0.24);
        x.fillStyle = '#b0553a';
        this.rr(-13, -14, 26, 7, 3); x.fill();                              // 围巾
        x.fillStyle = '#7a5a32';
        this.rr(14, -4, 12, 16, 4); x.fill();                               // 行囊
        x.strokeStyle = '#5a4632'; x.lineWidth = 2;
        x.beginPath(); x.moveTo(14, 0); x.lineTo(20, -2); x.stroke();
      }
      // 通用眼睛(id 覆盖者除外)
      if (id !== 'nightshade') {
        var ex2 = opts.eyeDx || 0, ey2 = opts.eyeDy || 0;
        x.fillStyle = '#fff';
        x.beginPath(); x.arc(-6 + ex2, -5 + ey2, 4, 0, PS.TAU); x.fill();
        x.beginPath(); x.arc(6 + ex2, -5 + ey2, 4, 0, PS.TAU); x.fill();
        x.fillStyle = '#241d10';
        x.beginPath(); x.arc(-6 + ex2 * 1.7, -5 + ey2 * 1.7, 1.9, 0, PS.TAU); x.fill();
        x.beginPath(); x.arc(6 + ex2 * 1.7, -5 + ey2 * 1.7, 1.9, 0, PS.TAU); x.fill();
      }
      x.restore();
    },
    body: function (rx, ry, C, dark, lite, liteA) {
      var x = this.ctx;
      x.fillStyle = C;
      x.beginPath(); x.ellipse(0, 0, rx, ry, 0, 0, PS.TAU); x.fill();
      x.strokeStyle = dark; x.lineWidth = 2.5; x.stroke();
      x.fillStyle = 'rgba(255,255,255,' + (liteA || 0.2) + ')';
      x.beginPath(); x.ellipse(-rx * 0.22, -ry * 0.28, rx * 0.5, ry * 0.4, 0, 0, PS.TAU); x.fill();
    },
    shade: function (hex, amt) {
      var n = parseInt(hex.slice(1), 16);
      var r = PS.util.clamp(((n >> 16) & 255) * (1 + amt), 0, 255) | 0;
      var gg = PS.util.clamp(((n >> 8) & 255) * (1 + amt), 0, 255) | 0;
      var b = PS.util.clamp((n & 255) * (1 + amt), 0, 255) | 0;
      return 'rgb(' + r + ',' + gg + ',' + b + ')';
    },

    /* 怪物装配绘制: 按 key 差异化轮廓 */
    drawMonsterModel: function (e) {
      var x = this.ctx;
      var k = e.key, y = e.y + (e.def.hop ? Math.sin(this.time * 10 + e.x) * 4 : 0);
      var flash = e.hitT > 0;
      var C = flash ? '#ffffff' : e.def.color;
      var dark = flash ? '#dddddd' : this.shade(e.def.color, -0.35);
      var lite = flash ? '#ffffff' : this.shade(e.def.color, 0.3);
      var r = e.r;
      // 基础体(多数怪共用, 特殊轮廓单独画)
      if (k === 'thug' || k === 'elBrute') {
        // 壮汉: 宽肩倒梯形+双拳
        x.fillStyle = C;
        x.beginPath();
        /* BUGFIX(主程): 这一支原来用的是"相对 X 坐标"(缺 e.x), 会把整个躯干画在世界 x≈0 处
         * —— 田埂壮汉/田霸 实际只看得见飘在空中的眼睛+血条, 这就是"某些怪像贴图没加载"的来源。 */
        x.moveTo(e.x - r * 1.25, y + r * 0.7); x.lineTo(e.x - r * 0.7, y - r); x.lineTo(e.x + r * 0.7, y - r); x.lineTo(e.x + r * 1.25, y + r * 0.7);
        x.closePath(); x.fill();
        x.strokeStyle = dark; x.lineWidth = 2.5; x.stroke();
        x.fillStyle = dark;
        x.beginPath(); x.arc(e.x - r * 1.1, y + r * 0.4, r * 0.38, 0, PS.TAU); x.fill();
        x.beginPath(); x.arc(e.x + r * 1.1, y + r * 0.4, r * 0.38, 0, PS.TAU); x.fill();   // 双拳
        x.fillStyle = lite;
        x.fillRect(e.x - r * 0.35, y - r * 0.5, r * 0.7, r * 0.35);                         // 护具带
      } else if (k === 'spitweed' || k === 'elWeaver') {
        // 喷吐植物: 大口花苞+摇头触须
        x.fillStyle = C;
        x.beginPath(); x.arc(e.x, y, r, 0, PS.TAU); x.fill();
        x.strokeStyle = dark; x.lineWidth = 2.5; x.stroke();
        var ma = Math.sin(this.time * 3 + e.x) * 0.25;
        x.fillStyle = '#3a2a1a';
        x.beginPath(); x.ellipse(e.x, y + r * 0.3, r * 0.5, r * (0.3 + ma), 0, 0, PS.TAU); x.fill();  // 大口
        x.strokeStyle = dark; x.lineWidth = 3;
        for (var ti = 0; ti < 5; ti++) {
          var ta = ti / 5 * PS.TAU + this.time * 1.5;
          x.beginPath();
          x.moveTo(e.x + Math.cos(ta) * r * 0.9, y + Math.sin(ta) * r * 0.9);
          x.quadraticCurveTo(e.x + Math.cos(ta) * r * 1.5, y + Math.sin(ta) * r * 1.5 - 6, e.x + Math.cos(ta) * r * 1.7, y + Math.sin(ta) * r * 1.7);
          x.stroke();
        }
      } else if (k === 'ram' || k === 'stalker' || k === 'elReaper') {
        // 冲锋型: 前倾三角+冲角
        var fa = (e.dashVX || e.dashVY) ? Math.atan2(e.dashVY, e.dashVX) : PS.util.angleTo(e.x, e.y, PS.Game.player.x, PS.Game.player.y);
        x.save();
        x.translate(e.x, y); x.rotate(fa);
        x.fillStyle = C;
        x.beginPath();
        x.moveTo(r * 1.5, 0); x.lineTo(-r * 0.8, -r * 0.95); x.lineTo(-r * 0.45, 0); x.lineTo(-r * 0.8, r * 0.95);
        x.closePath(); x.fill();
        x.strokeStyle = dark; x.lineWidth = 2.5; x.stroke();
        x.fillStyle = '#e8dcc0';
        x.beginPath(); x.moveTo(r * 1.5, 0); x.lineTo(r * 0.6, -r * 0.5); x.lineTo(r * 0.6, r * 0.5); x.closePath(); x.fill();  // 冲角色浅色
        x.restore();
      } else if (k === 'buzzling' || k === 'splitseed') {
        // 虫型: 圆身+振翅(高频闪烁)
        var wf = Math.sin(this.time * 40 + e.x) * 0.5 + 0.5;
        x.fillStyle = 'rgba(255,255,255,0.5)';
        x.beginPath(); x.ellipse(e.x - r * 0.7, y - r * 0.7, r * 0.75, r * 0.32, -0.7 - wf * 0.4, 0, PS.TAU); x.fill();
        x.beginPath(); x.ellipse(e.x + r * 0.7, y - r * 0.7, r * 0.75, r * 0.32, 0.7 + wf * 0.4, 0, PS.TAU); x.fill();
        x.fillStyle = C;
        x.beginPath(); x.arc(e.x, y, r, 0, PS.TAU); x.fill();
        x.strokeStyle = dark; x.lineWidth = 2; x.stroke();
      } else if (k === 'rockling' || k === 'bonehead') {
        // 甲壳/骨傀: 六边甲壳+铆钉
        x.fillStyle = C;
        x.beginPath();
        for (var hi = 0; hi < 6; hi++) {
          var ha = hi / 6 * PS.TAU + 0.3;
          var hx = e.x + Math.cos(ha) * r, hy = y + Math.sin(ha) * r * 0.92;
          if (hi === 0) x.moveTo(hx, hy); else x.lineTo(hx, hy);
        }
        x.closePath(); x.fill();
        x.strokeStyle = dark; x.lineWidth = 3; x.stroke();
        x.fillStyle = dark;
        for (hi = 0; hi < 3; hi++) {
          x.beginPath(); x.arc(e.x + (hi - 1) * r * 0.45, y - r * 0.25, r * 0.12, 0, PS.TAU); x.fill();
        }
        if (k === 'bonehead') {
          x.strokeStyle = '#8a8278'; x.lineWidth = 2;
          x.beginPath(); x.moveTo(e.x - r * 0.5, y + r * 0.5); x.lineTo(e.x - r * 0.2, y + r * 0.55); x.moveTo(e.x + r * 0.2, y + r * 0.55); x.lineTo(e.x + r * 0.5, y + r * 0.5); x.stroke();  // 骨缝
        }
      } else if (k === 'splitpod') {
        // 裂荚: 豆荚两瓣微张
        x.save();
        x.translate(e.x, y); x.rotate(Math.sin(this.time * 2 + e.x) * 0.12);
        x.fillStyle = C;
        x.beginPath(); x.ellipse(-r * 0.3, 0, r * 0.75, r * 0.9, -0.3, 0, PS.TAU); x.fill();
        x.fillStyle = lite;
        x.beginPath(); x.ellipse(r * 0.3, 0, r * 0.75, r * 0.9, 0.3, 0, PS.TAU); x.fill();
        x.strokeStyle = dark; x.lineWidth = 2.5;
        x.beginPath(); x.ellipse(-r * 0.3, 0, r * 0.75, r * 0.9, -0.3, 0, PS.TAU); x.stroke();
        x.beginPath(); x.ellipse(r * 0.3, 0, r * 0.75, r * 0.9, 0.3, 0, PS.TAU); x.stroke();
        x.restore();
      } else if (k === 'cackler') {
        // 夜笑枭: 竖瞳+翼刃
        x.fillStyle = C;
        x.beginPath(); x.arc(e.x, y, r, 0, PS.TAU); x.fill();
        x.strokeStyle = dark; x.lineWidth = 2.5; x.stroke();
        x.fillStyle = dark;
        x.beginPath(); x.ellipse(e.x - r * 1.05, y + r * 0.2, r * 0.4, r * 0.16, -0.5, 0, PS.TAU); x.fill();
        x.beginPath(); x.ellipse(e.x + r * 1.05, y + r * 0.2, r * 0.4, r * 0.16, 0.5, 0, PS.TAU); x.fill();
      } else if (k === 'kingTuber' || k === 'elderBlight') {
        // Boss: 巨型块茎+王冠棘冠+多眼
        x.fillStyle = C;
        x.beginPath();
        for (var bi = 0; bi <= 14; bi++) {
          var ba = bi / 14 * PS.TAU;
          var br = r * (1 + 0.16 * Math.sin(ba * 5 + this.time));
          var bx = e.x + Math.cos(ba) * br, by = y + Math.sin(ba) * br;
          if (bi === 0) x.moveTo(bx, by); else x.lineTo(bx, by);
        }
        x.closePath(); x.fill();
        x.strokeStyle = '#ffd24a'; x.lineWidth = 4; x.stroke();
        x.fillStyle = '#ffd24a';
        for (bi = 0; bi < 5; bi++) {
          var ca = -Math.PI / 2 + (bi - 2) * 0.34;
          x.beginPath();
          x.moveTo(e.x + Math.cos(ca) * r * 0.8, y + Math.sin(ca) * r * 0.8);
          x.lineTo(e.x + Math.cos(ca) * r * 1.25, y + Math.sin(ca) * r * 1.25);
          x.lineTo(e.x + Math.cos(ca + 0.2) * r * 0.8, y + Math.sin(ca + 0.2) * r * 0.8);
          x.closePath(); x.fill();
        }
      } else {
        // 默认: 芽芽怪/杂型 — 圆块形双层
        x.fillStyle = C;
        this.taterShape(e.x, y, r, 0.16); x.fill();
        x.strokeStyle = dark; x.lineWidth = 2.5; x.stroke();
        x.fillStyle = 'rgba(255,255,255,0.16)';
        this.taterShape(e.x - r * 0.2, y - r * 0.28, r * 0.55, 0.16); x.fill();
      }
      // 通用面部(触须/植物已自带, 虫型小眼)
      if (k !== 'spitweed' && k !== 'elWeaver' && k !== 'kingTuber' && k !== 'elderBlight') {
        var p = PS.Game.player;
        var ea = PS.util.angleTo(e.x, y, p.x, p.y);
        var er = Math.max(2.4, r * 0.2);
        if (k === 'cackler') {
          x.fillStyle = '#ffd24a';
          x.fillRect(e.x - r * 0.32, y - r * 0.3, er * 0.5, er * 2.2);
          x.fillRect(e.x + r * 0.32 - er * 0.5, y - r * 0.3, er * 0.5, er * 2.2);   // 竖瞳
        } else {
          x.fillStyle = '#fff';
          x.beginPath(); x.arc(e.x - r * 0.3, y - r * 0.22, er, 0, PS.TAU); x.fill();
          x.beginPath(); x.arc(e.x + r * 0.3, y - r * 0.22, er, 0, PS.TAU); x.fill();
          x.fillStyle = '#8a1010';
          x.beginPath(); x.arc(e.x - r * 0.3 + Math.cos(ea) * er * 0.4, y - r * 0.22 + Math.sin(ea) * er * 0.4, er * 0.5, 0, PS.TAU); x.fill();
          x.beginPath(); x.arc(e.x + r * 0.3 + Math.cos(ea) * er * 0.4, y - r * 0.22 + Math.sin(ea) * er * 0.4, er * 0.5, 0, PS.TAU); x.fill();
        }
      }
    },

    /* 敌人绘制入口: 入场预警圈 + 委托 drawMonsterModel */
    drawEnemy: function (e) {
      var x = this.ctx;
      if (e.spawnT > 0) {
        x.globalAlpha = 1 - e.spawnT / 0.4;
        x.strokeStyle = e.def.color;
        x.lineWidth = 2.5;
        x.beginPath(); x.arc(e.x, e.y, e.r * (0.5 + e.spawnT * 1.4), 0, PS.TAU); x.stroke();
        x.globalAlpha = 1;
        return;
      }
      /* v7.0(2026-09-30) 中性物(树): 它没有朝向/血条底槽/受击白闪那一套, 剪影也不同
       *   ⇒ 走 PS.Art.drawTree(位图优先 t:tree:<r>, 缺图回落程序化; 见 art.js)。
       *   放在阴影之前: drawTree 自己画接地阴影与"还能挨几下"的进度条。 */
      if (e.neutral && PS.Art && PS.Art.drawTree) { PS.Art.drawTree(x, e, this.time); return; }
      x.fillStyle = 'rgba(0,0,0,0.28)';
      x.beginPath(); x.ellipse(e.x, e.y + e.r * 0.72, e.r * 0.85, e.r * 0.34, 0, 0, PS.TAU); x.fill();
      /* v2.3: 敌人绘制切到 PS.Art —— 每只怪 1 次 drawImage(带受击闪/朝向/血量底槽, 全部烘焙进缓存),
       * 改前是每帧 8~15 条 path(实测第 18 波 272 只怪 = 2175 次 draw call/帧, 卡顿主因)。
       * 血条实心/冻结圈由 art.js 内部画; 这里只补文字(精英/Boss 名称), 文字无法烘焙进精灵。 */
      if (PS.Art && PS.Art.drawEnemy) {
        if (e.elite || e.boss) PS.Art.drawElite(x, e, e.def, this.time);
        else PS.Art.drawEnemy(x, e, e.def, this.time);
        if (e.elite) {
          x.fillStyle = '#ffd24a';
          x.font = 'bold 13px ' + this.ui.font;
          x.textAlign = 'center';
          x.fillText('★ ' + e.def.name, e.x, e.y - e.r - 16);
        } else if (e.boss) {
          x.fillStyle = '#ff5a5a';
          x.font = 'bold 16px ' + this.ui.font;
          x.textAlign = 'center';
          x.fillText(e.def.name, e.x, e.y - e.r - 18);
        }
        return;
      }
      // v2.1 回退路径: 分部位装配建模(每种怪独立轮廓语言), 血条/标记在外层统一画
      this.drawMonsterModel(e);
      var y = e.y;
      // 血条
      if (e.hp < e.maxHp) {
        var w = Math.max(26, e.r * 2.2);
        x.fillStyle = 'rgba(0,0,0,0.5)';
        x.fillRect(e.x - w / 2, y - e.r - 11, w, 4);
        x.fillStyle = e.boss ? '#ffd24a' : (e.elite ? '#ffab4a' : '#e06c5a');
        x.fillRect(e.x - w / 2, y - e.r - 11, w * Math.max(0, e.hp / e.maxHp), 4);
      }
      if (e.elite) {
        x.fillStyle = '#ffd24a';
        x.font = 'bold 13px ' + this.ui.font;
        x.textAlign = 'center';
        x.fillText('★ ' + e.def.name, e.x, y - e.r - 16);
      }
      if (e.boss) {
        x.fillStyle = '#ff5a5a';
        x.font = 'bold 16px ' + this.ui.font;
        x.textAlign = 'center';
        x.fillText(e.def.name, e.x, y - e.r - 18);
        var bw = 120;
        x.fillStyle = 'rgba(0,0,0,0.6)';
        x.fillRect(e.x - bw / 2, y - e.r - 30, bw, 7);
        x.fillStyle = '#ff5a5a';
        x.fillRect(e.x - bw / 2, y - e.r - 30, bw * Math.max(0, e.hp / e.maxHp), 7);
      }
    },

    drawProjectile: function (pr) {
      var x = this.ctx;
      if (pr.boomerang) {
        x.save();
        x.translate(pr.x, pr.y);
        x.rotate(this.time * 16);
        x.strokeStyle = '#a5e67b';
        x.lineWidth = 4.5;
        x.beginPath();
        x.moveTo(-9, -7); x.lineTo(9, 0); x.lineTo(-9, 7);
        x.closePath(); x.stroke();
        x.restore();
        return;
      }
      x.strokeStyle = pr.color;
      x.globalAlpha = 0.45;
      x.lineWidth = pr.beam ? 3 : pr.r;
      x.beginPath();
      x.moveTo(pr.x - Math.cos(pr.ang) * (pr.beam ? 34 : 14), pr.y - Math.sin(pr.ang) * (pr.beam ? 34 : 14));
      x.lineTo(pr.x, pr.y);
      x.stroke();
      x.globalAlpha = 1;
      x.fillStyle = pr.color;
      x.beginPath(); x.arc(pr.x, pr.y, pr.r, 0, PS.TAU); x.fill();
      x.fillStyle = 'rgba(255,255,255,0.65)';
      x.beginPath(); x.arc(pr.x, pr.y, pr.r * 0.4, 0, PS.TAU); x.fill();
    },

    drawOrbits: function () {
      var x = this.ctx, g = PS.Game;
      for (var wi = 0; wi < g.weapons.length; wi++) {
        var slot = g.weapons[wi];
        var def = PS.WeaponData.list[slot.key];
        if (!def || def.targeting !== 'orbit') continue;
        for (var k = 0; k < def.orbitCount; k++) {
          var a = g.orbitPhase * def.orbitSpd + k * PS.TAU / def.orbitCount + wi;
          var ox = g.player.x + Math.cos(a) * def.orbitR;
          var oy = g.player.y + Math.sin(a) * def.orbitR;
          x.save();
          x.translate(ox, oy);
          x.rotate(this.time * 6 + k);
          x.fillStyle = '#c8d8a0';
          x.beginPath();
          for (var si = 0; si < 4; si++) {
            var sa = si / 4 * PS.TAU;
            var px = Math.cos(sa) * 9, py = Math.sin(sa) * 9;
            if (si === 0) x.moveTo(px, py); else x.lineTo(px, py);
          }
          x.closePath(); x.fill();
          x.strokeStyle = 'rgba(20,16,8,0.6)';
          x.lineWidth = 2;
          x.stroke();
          x.restore();
        }
      }
    },

    /* ================= UI 通用(几何 / 文本 / 组件) =================
     * 视觉口径见 qa/ui-design-spec.md: 8pt 栅格 + token + 状态矩阵。
     * 本层不含任何游戏数值 —— 数字一律现算自 g.stats / PS.Balance / 数据表。 */
    rr: function (px, py, w, h, r) {
      var x = this.ctx;
      r = Math.min(r, w / 2, h / 2);
      if (r < 0) r = 0;
      x.beginPath();
      x.moveTo(px + r, py);
      x.arcTo(px + w, py, px + w, py + h, r);
      x.arcTo(px + w, py + h, px, py + h, r);
      x.arcTo(px, py + h, px, py, r);
      x.arcTo(px, py, px + w, py, r);
      x.closePath();
    },
    hot: function (px, py, w, h) {
      var m = this.ui.pointer, S = this.spaceScale || 1;
      if (m && S !== 1) m = { x: m.x / S, y: m.y / S };   /* HUD 是缩放绘制的, 指针做同样的逆变换 */
      return !!(m && m.x >= px && m.x <= px + w && m.y >= py && m.y <= py + h);
    },

    /* ---------- 按下反馈: 触屏没有 hover, 用 140ms 金环补上(spec §4) ---------- */
    press: function (px, py, w, h, opts) {
      var self = this;
      /* 缩放空间(HUD)里创建的按钮, 按下环要回到画布坐标 —— 环是在变换之外画的(见 drawPress)。
       *   必须**创建时**捕获空间: 回调是点击那一刻跑的, 那时 spaceScale 已经复位。 */
      var sp = this.spaceScale || 1;
      return function () {
        if (!self.pressFx) self.pressFx = [];
        self.pressFx.push({ x: px * sp, y: py * sp, w: w * sp, h: h * sp, t: 0 });
        if (self.pressFx.length > 4) self.pressFx.shift();
        if (opts && opts.cb) opts.cb();
      };
    },
    drawPress: function (dt) {
      var x = this.ctx;
      if (!this.pressFx || !this.pressFx.length) return;
      for (var i = this.pressFx.length - 1; i >= 0; i--) {
        var f = this.pressFx[i];
        f.t += dt;
        var k = f.t / 0.14;
        if (k >= 1) { this.pressFx.splice(i, 1); continue; }
        x.globalAlpha = (1 - k) * 0.85;
        x.strokeStyle = T.gold;
        x.lineWidth = 3;
        this.rr(f.x, f.y, f.w, f.h, 10); x.stroke();
        x.globalAlpha = (1 - k) * 0.14;
        x.fillStyle = T.coin;
        this.rr(f.x, f.y, f.w, f.h, 10); x.fill();
        x.globalAlpha = 1;
      }
    },

    /* ---------- 组件: 按钮(spec §4 状态矩阵) ----------
     * opts = { size, sub, subColor, bg, hoverBg, border, hoverBorder, color, disabled, sold, noHit, id, cb, bold, radius }
     * 禁用/已售 不入热区表(点击穿透到整卡热区); 入表时包一层 press → 触屏也有按下反馈。 */
    button: function (px, py, w, h, text, opts) {
      opts = opts || {};
      var x = this.ctx, u = this.ui;
      var on = !opts.disabled && !opts.sold && this.hot(px, py, w, h);
      var size = opts.size || T.fs.body, rad = opts.radius === undefined ? 10 : opts.radius;
      x.fillStyle = opts.sold ? 'rgba(7,11,7,0.60)'
        : opts.disabled ? 'rgba(13,19,13,0.50)'
          : (on ? (opts.hoverBg || this.withA(T.gold, 0.30)) : (opts.bg || this.withA(T.gold, 0.16)));
      this.rr(px, py, w, h, rad); x.fill();
      x.strokeStyle = opts.sold ? 'rgba(255,255,255,0.08)'
        : opts.disabled ? T.weak
          : (on ? (opts.hoverBorder || opts.border || T.gold) : (opts.border || T.edge));
      x.lineWidth = opts.lw ? (on ? Math.max(opts.lw, 2.5) : opts.lw) : (on ? 2.5 : 1.5);
      this.rr(px, py, w, h, rad); x.stroke();
      if (!opts.disabled && !opts.sold && w > 4 && h > 4) {
        var biw = Math.max(0, w - rad * 2);
        x.fillStyle = T.faceHi; x.fillRect(px + rad, py + 1, biw, 1);
        x.fillStyle = T.faceLo; x.fillRect(px + rad, py + h - 2.5, biw, 2);
      }
      x.fillStyle = opts.sold ? this.withA(T.mid, 0.55)
        : opts.disabled ? this.withA(T.hi, 0.55)
          : (opts.color || T.hi);
      x.font = (opts.bold === false ? '' : 'bold ') + size + 'px ' + u.font;
      /* align:'left' 是 v6.0 新增的**可选**分支(默认 'center' 与旧版逐字一致):
         封面左列要的是原版那种"竖排列表"(文本左对齐 + 行内左内边距), 商店/暂停那些按钮仍然居中。 */
      var leftAligned = opts.align === 'left';
      var tx = leftAligned ? px + (opts.padX === undefined ? 18 : opts.padX) : px + w / 2;
      x.textAlign = leftAligned ? 'left' : 'center';
      x.fillText(text, tx, py + h / 2 + size * 0.36 - (opts.sub ? 5 : 0));
      if (opts.sub) {
        x.font = T.fs.micro + 'px ' + u.font;
        x.fillStyle = opts.subColor || (opts.disabled ? this.withA(T.mid, 0.6) : T.mid);
        x.fillText(opts.sub, tx, py + h - 9);
      }
      this.btnRects.push({ x: px, y: py, w: w, h: h, label: text,
        disabled: !!opts.disabled, sold: !!opts.sold });
      if (!opts.noHit && !opts.disabled && !opts.sold) {
        this.buttons.push({
          x: px, y: py, w: w, h: h, id: opts.id, label: text,
          cb: this.press(px, py, w, h, opts)
        });
      }
      return on;
    },
    wrapText: function (text, px, py, maxW, lh, maxLines, center) {
      var x = this.ctx;
      var lines = [''], cur = 0, i;
      for (i = 0; i < text.length; i++) {
        if (x.measureText(lines[cur] + text[i]).width > maxW) {
          cur++;
          if (cur >= maxLines) { lines[maxLines - 1] += '…'; break; }
          lines.push('');
        }
        lines[cur] += text[i];
      }
      /* v8.3(BUG, 用户第 3 张图「角色描述卡出界面」): 居中分支原先写 px + maxW / 2 ——
       *   而 fitLines 传进来的 px **就是中心**(它已把 textAlign 置成 'center') ⇒ 每一行都被再推右
        *   maxW / 2(角色/道具详情 = +260px), 于是描述整段跑到面板右边缘之外。口径统一为
        *   「px 是绘制原点, 居不居中由调用方的 textAlign 决定」—— 见下面的 drawModeSelect 调用点。 */
      for (i = 0; i < lines.length; i++) x.fillText(lines[i], px, py + i * lh);
      return lines.length;
    },
    /* 武器图标 —— 交给 PS.Art.drawWeaponIcon 画**程序化模型**(与战斗里环绕在身边的是同一批)。
     * 历史缺陷(已实测, 不是推测): 旧版本在这里按 def.family 分 8 支画矢量线条, 而 family 是武器的
     *   **身份族名**(源武器表 61 个: sword / chopper / pruner / circular_saw / chain_gun …), 与那 8 个
     *   分支毫不相交 ⇒ 203 把武器里只有 3 把碰巧画得出来, 其余一律空白。这就是用户报的
     *   「商店武器建模不见了」。现在形状判定收在 art.js 的 weaponShape 一处(按数据推导出 13 类),
     *   界面与战斗共用同一批模型 —— "有没有模型"只取决于数据, 不再取决于谁记得调哪个函数。
     * 下面的 weaponIconGlyph 是**矢量兜底**: 即使美术层整个缺失也绝不会再出现"什么都没有"。 */
    weaponIcon: function (key, cx, cy, size, opts) {
      var def = PS.WeaponData.list[key];
      var o = opts || {};
      if (PS.Art && PS.Art.drawWeaponIcon) {
        try {
          if (PS.Art.drawWeaponIcon(this.ctx, key, cx, cy, size, {
            def: def, tier: o.tier, rot: o.rot
          })) return;
        } catch (e) { /* 落到矢量兜底 */ }
      }
      this.weaponIconGlyph(def, cx, cy, size, o.tier);
    },
    weaponIconGlyph: function (def, cx, cy, size, tierIn) {
      var x = this.ctx;
      var fam = (PS.Art && PS.Art.weaponShape) ? PS.Art.weaponShape(def) : 'mace';
      var color = def ? (def.beam ? T.info : (def.cls === 'melee' ? '#e8c76a' : '#e0a05a')) : T.low;
      x.save();
      x.translate(cx, cy);
      x.strokeStyle = color; x.fillStyle = color;
      x.lineWidth = 2.4; x.lineCap = 'round';
      var S = size || 20;
      if (fam === 'blade') { x.beginPath(); x.moveTo(-S * 0.1, 0); x.lineTo(S * 0.9, -S * 0.12); x.lineTo(S * 0.9, S * 0.12); x.closePath(); x.fill(); x.fillRect(-S * 0.5, -S * 0.12, S * 0.5, S * 0.06); x.fillRect(-S * 0.2, -S * 0.3, S * 0.12, S * 0.6); }
      else if (fam === 'machete') { x.beginPath(); x.moveTo(-S * 0.5, S * 0.16); x.quadraticCurveTo(S * 0.4, -S * 0.5, S * 0.9, -S * 0.1); x.quadraticCurveTo(S * 0.3, S * 0.05, -S * 0.2, S * 0.24); x.closePath(); x.fill(); }
      else if (fam === 'axe') { x.fillRect(-S * 0.6, -S * 0.04, S * 1.2, S * 0.08); x.beginPath(); x.moveTo(S * 0.25, -S * 0.4); x.quadraticCurveTo(S * 0.85, -S * 0.1, S * 0.25, S * 0.4); x.closePath(); x.fill(); }
      else if (fam === 'hammer') { x.fillRect(-S * 0.6, -S * 0.05, S * 1.0, S * 0.1); x.fillRect(S * 0.3, -S * 0.42, S * 0.36, S * 0.84); }
      else if (fam === 'mace') { x.fillRect(-S * 0.6, -S * 0.06, S * 0.9, S * 0.12); x.beginPath(); x.arc(S * 0.42, 0, S * 0.3, 0, PS.TAU); x.fill(); }
      else if (fam === 'spear') { x.fillRect(-S * 0.6, -S * 0.04, S * 1.1, S * 0.08); x.beginPath(); x.moveTo(S * 0.5, -S * 0.26); x.lineTo(S * 1.0, 0); x.lineTo(S * 0.5, S * 0.26); x.closePath(); x.fill(); }
      else if (fam === 'pistol') { x.fillRect(-S * 0.3, -S * 0.14, S * 0.8, S * 0.22); x.fillRect(-S * 0.3, S * 0.06, S * 0.22, S * 0.44); x.fillRect(S * 0.3, -S * 0.24, S * 0.7, S * 0.1); }
      else if (fam === 'rifle') { x.fillRect(-S * 0.62, -S * 0.05, S * 1.5, S * 0.16); x.fillRect(-S * 0.62, S * 0.1, S * 0.34, S * 0.3); x.fillRect(S * 0.1, -S * 0.26, S * 0.4, S * 0.16); }
      else if (fam === 'shotgun') { x.fillRect(-S * 0.34, -S * 0.06, S * 1.24, S * 0.14); x.fillRect(-S * 0.34, S * 0.12, S * 1.0, S * 0.13); x.fillRect(-S * 0.58, -S * 0.04, S * 0.28, S * 0.3); }
      else if (fam === 'launcher') { x.fillRect(-S * 0.5, -S * 0.2, S * 1.3, S * 0.4); x.beginPath(); x.moveTo(S * 0.8, -S * 0.3); x.lineTo(S * 1.1, -S * 0.5); x.lineTo(S * 1.1, S * 0.5); x.lineTo(S * 0.8, S * 0.3); x.closePath(); x.fill(); }
      else if (fam === 'flamer') { x.fillRect(-S * 0.5, -S * 0.1, S * 1.2, S * 0.2); x.fillRect(-S * 0.3, -S * 0.44, S * 0.4, S * 0.3); x.beginPath(); x.arc(S * 0.86, 0, S * 0.24, 0, PS.TAU); x.fill(); }
      else if (fam === 'wand') { x.fillRect(-S * 0.6, -S * 0.05, S * 1.1, S * 0.1); x.beginPath(); x.arc(S * 0.66, 0, S * 0.3, 0, PS.TAU); x.fill(); }
      else if (fam === 'saw') { x.beginPath(); x.arc(0, 0, S * 0.62, 0, PS.TAU); x.fill(); x.fillStyle = this.withA('#070b07', 0.95); x.beginPath(); x.arc(0, 0, S * 0.24, 0, PS.TAU); x.fill(); }
      else { x.fillRect(-S * 0.6, -S * 0.06, S * 0.9, S * 0.12); x.beginPath(); x.arc(S * 0.42, 0, S * 0.3, 0, PS.TAU); x.fill(); }
      if (tierIn >= 3) { x.strokeStyle = this.withA(T.info, 0.85); x.lineWidth = 1.2; x.beginPath(); x.arc(0, 0, S * 0.86, 0, PS.TAU); x.stroke(); }
      x.restore();
    },

    /* ================= 色板 / 底板 / 徽章 ================= */
    /* 十六进制色 → rgba(): 不用 8 位 hex, 兼容小游戏 canvas */
    withA: function (hex, a) {
      if (!hex || hex.charAt(0) !== '#') return hex;
      var n = parseInt(hex.slice(1), 16);
      return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
    },
    /* 深色底板: 把文字从战场背景里抬出来(alpha/border 可覆盖) */
    plate: function (px, py, w, h, r, alpha, border) {
      var x = this.ctx;
      x.fillStyle = 'rgba(13,19,13,' + (alpha === undefined ? 0.88 : alpha) + ')';
      this.rr(px, py, w, h, r); x.fill();
      if (w > 4 && h > 4) {
        var piw = Math.max(0, w - r * 2);
        x.fillStyle = T.faceHi; x.fillRect(px + r, py + 1, piw, 1);
        x.fillStyle = T.faceLo; x.fillRect(px + r, py + h - 2, piw, 1);
      }
      if (border !== false) {
        x.strokeStyle = border || T.edge;
        x.lineWidth = 1.5;
        this.rr(px, py, w, h, r); x.stroke();
      }
    },
    /* 卡片缎带(模式 / 角色 / 商店稀有度共用): 整卡顶部那条色带。
       旧版是**纯色平板**贴上去 —— 满饱和的色块压在夜菜园的低饱和底上, 实测截图读成「贴纸」。
       现在三件事: 色相压暗 16%(去掉荧光感) + 顶边 1px 高光(有厚度) + 底边 2px 墨线(与卡面分开)。
       **几何与文字落点一律不变**。
       ⚠ 升级卡的缎带**不许走这里**: qa/verify-drop-reroll.cjs 在 y+15 处做真像素对拍,
         期望色 = RARITY 原色(压暗就红)。这里只服务模式/角色/商店三处。 */
    ribbon: function (px, py, w, h, color, r) {
      var x = this.ctx;
      x.save();
      this.rr(px, py, w, h, r === undefined ? 16 : r); x.clip();
      x.fillStyle = this.shade(color, -0.16);
      x.fillRect(px, py, w, h);
      x.fillStyle = 'rgba(255,255,255,0.13)'; x.fillRect(px, py + 1, w, 1);
      x.fillStyle = 'rgba(5,8,5,0.55)'; x.fillRect(px, py + h - 2, w, 2);
      x.restore();
    },
    /* 带标题的面板(标题下一条 1px 分隔线) */
    panel: function (px, py, w, h, o) {
      o = o || {};
      var x = this.ctx, rad = o.r === undefined ? 14 : o.r;
      x.fillStyle = o.fill || 'rgba(13,19,13,0.88)';
      this.rr(px, py, w, h, rad); x.fill();
      x.strokeStyle = o.border || T.edge;
      x.lineWidth = o.lw || 1.5;
      this.rr(px, py, w, h, rad); x.stroke();
      if (w > 4 && h > 4) {
        var piw = Math.max(0, w - rad * 2);
        x.fillStyle = T.faceHi; x.fillRect(px + rad, py + 1, piw, 1);
        x.fillStyle = T.faceLo; x.fillRect(px + rad, py + h - 2, piw, 1);
      }
      if (o.title) {
        this.text(o.title, px + 14, py + 24, T.fs.body, o.titleColor || T.gold, 'left');
        if (o.note) this.text(o.note, px + w - 14, py + 24, T.fs.micro, T.low, 'right', false);
        x.strokeStyle = T.weak; x.lineWidth = 1;
        x.beginPath(); x.moveTo(px + 12, py + 32); x.lineTo(px + w - 12, py + 32); x.stroke();
      }
    },
    /* 小徽章(类别/标签) — 返回宽度便于横向排列 */
    chip: function (px, py, label, color, size, alpha) {
      var x = this.ctx, u = this.ui;
      size = size || 11;
      x.font = 'bold ' + size + 'px ' + u.font;
      var w = x.measureText(label).width + size * 1.6, h = size + 10;
      x.fillStyle = this.withA(color, alpha === undefined ? 0.18 : alpha);
      this.rr(px, py, w, h, h / 2); x.fill();
      x.strokeStyle = this.withA(color, 0.6);
      x.lineWidth = 1;
      this.rr(px, py, w, h, h / 2); x.stroke();
      x.fillStyle = color;
      x.textAlign = 'center';
      x.fillText(label, px + w / 2, py + h / 2 + size * 0.36);
      return w;
    },
    /* 词条 chip 行: 在 maxW 内尽量多放; 放不下的用「…」收尾(绝不越出卡边/面板边)。
     * 旧版角色卡无上界 —— 4 条长词条(如「材料面值波次提前 +1」)会顶出卡外。 */
    chipRow: function (px, py, maxW, items, size) {
      var self = this, sz = size || 10.5, n = items.length, i, tot = px, used = 0;
      var wOf = function (arr, k) {
        var t = 0;
        for (var q = 0; q < k; q++) t += self.textW(arr[q].t, sz) + sz * 1.6 + 6;
        return t;
      };
      var fit = n;
      while (fit > 1 && wOf(items, fit) > maxW) fit--;
      if (fit < n) while (fit > 0 && wOf(items, fit) + self.textW('…', sz) + sz * 1.6 > maxW) fit--;
      used = wOf(items, fit);
      for (i = 0; i < fit; i++) tot += this.chip(tot, py, items[i].t, items[i].color, sz) + 6;
      if (fit < n) this.chip(tot, py, '…', T.low, sz);
      return used;
    },
    /* 居中/左对齐绘制多段异色文字: segs = [[文本, 颜色], ...]; 返回总宽 */
    richText: function (segs, cx, py, size, align) {
      var x = this.ctx, u = this.ui, i, tot = 0, ws = [];
      x.font = 'bold ' + size + 'px ' + u.font;
      for (i = 0; i < segs.length; i++) { ws[i] = x.measureText(segs[i][0]).width; tot += ws[i]; }
      var sx = (align === 'left') ? cx : cx - tot / 2;
      x.textAlign = 'left';
      for (i = 0; i < segs.length; i++) {
        x.fillStyle = segs[i][1];
        x.fillText(segs[i][0], sx, py);
        sx += ws[i];
      }
      return tot;
    },
    /* 单色文字快捷方式 */
    text: function (str, px, py, size, color, align, bold) {
      var x = this.ctx, u = this.ui;
      x.font = (bold === false ? '' : 'bold ') + size + 'px ' + u.font;
      x.fillStyle = color;
      x.textAlign = align || 'center';
      x.fillText(str, px, py);
    },
    /* ---------- 动态文本自适应(spec §10 唯一口径) ----------
     * 背景: 道具池 163 件, 其中 6 件 desc 达 33~54 汉字, 角色 desc 26~34 字 —— 卡片上一切
     * "外来文本"都必须走这里, 否则会溢出卡边、压住按钮, 或被压扁到变形。
     * 优先级: 原字号单行 → 缩字号(下限 minSize) → 省略号截断。
     * 严禁 ctx.fillText 的 maxWidth 参数: 那是横向压扁, 长文本会糊成不可读的一条。 */
    textW: function (str, size, bold) {
      var x = this.ctx;
      x.font = (bold === false ? '' : 'bold ') + size + 'px ' + this.ui.font;
      return x.measureText(String(str)).width;
    },
    /* 单行省略号截断(始终保留结尾「…」) */
    ellip: function (str, maxW, size, bold) {
      var t = String(str), x = this.ctx, cut = t.length;
      x.font = (bold === false ? '' : 'bold ') + size + 'px ' + this.ui.font;
      if (x.measureText(t).width <= maxW) return t;
      while (cut > 1 && x.measureText(t.slice(0, cut) + '…').width > maxW) cut--;
      return t.slice(0, cut) + '…';
    },
    /* 能放下就保留原字号, 否则步进缩小到下限 */
    fitSize: function (str, maxW, size, minSize, bold) {
      var s = size, floor = Math.max(T.fs.micro, minSize || T.fs.micro);
      while (s > floor + 0.01 && this.textW(str, s, bold) > maxW) s -= 0.5;
      return s;
    },
    /* 单行自适应绘制: 先缩字号, 再省略号; 返回实际字号 */
    fitText: function (str, px, py, maxW, size, color, align, bold, minSize) {
      var sz = this.fitSize(str, maxW, size, minSize, bold);
      this.text(this.ellip(str, maxW, sz, bold), px, py, sz, color, align, bold);
      return sz;
    },
    /* 多段异色文字自适应(增量预览那类): 先整体缩字号, 再对末段省略 */
    fitRich: function (segs, cx, py, size, maxW, minSize) {
      var self = this, s = size, floor = Math.max(T.fs.micro, minSize || T.fs.micro), tot;
      var sum = function (arr, sz) { var t = 0; for (var q = 0; q < arr.length; q++) t += self.textW(arr[q][0], sz); return t; };
      tot = sum(segs, s);
      while (s > floor + 0.01 && tot > maxW) { s -= 0.5; tot = sum(segs, s); }
      if (tot > maxW && segs.length) {
        var last = segs[segs.length - 1], head = segs.slice(0, segs.length - 1);
        segs = head.concat([[this.ellip(last[0], Math.max(10, maxW - sum(head, s)), s), last[1]]]);
      }
      this.richText(segs, cx, py, s);
      return s;
    },
    /* 多行自适应: 最多 maxLines 行, 末行省略号截断(绝不横向压扁); 返回末行基线 */
    fitLines: function (str, px, py, maxW, lh, maxLines, size, color, center) {
      var x = this.ctx, n = Math.max(1, maxLines);
      x.font = (size || T.fs.micro) + 'px ' + this.ui.font;
      x.fillStyle = color;
      x.textAlign = center ? 'center' : 'left';
      this.wrapText(str, px, py, maxW, lh, n, !!center);
      return py + (n - 1) * lh;
    },
    /* 信息格: 标签 + 数值(面板里的最小单元) */
    cell: function (px, py, w, h, label, value, color, o) {
      o = o || {};
      var x = this.ctx;
      x.fillStyle = 'rgba(7,11,7,0.55)';
      this.rr(px, py, w, h, 10); x.fill();
      if (o.border !== false) {
        x.strokeStyle = o.border || T.weak; x.lineWidth = 1;
        this.rr(px, py, w, h, 10); x.stroke();
      }
      this.text(label, px + 10, py + 19, T.fs.micro, o.labelColor || T.mid, 'left', false);
      this.text(value, px + 10, py + h - 12, o.size || T.fs.num, color || T.hi, 'left');
    },
    /* 纯几何挂锁(不依赖字形): on=false 画"已开锁"的开口 */
    lockIcon: function (cx, cy, size, on, color) {
      var x = this.ctx;
      x.save();
      x.translate(cx, cy);
      x.strokeStyle = color || T.luck;
      x.fillStyle = color || T.luck;
      x.lineWidth = Math.max(1.6, size * 0.18);
      x.beginPath();
      if (on) x.arc(0, -size * 0.22, size * 0.42, Math.PI, 0);
      else x.arc(-size * 0.18, -size * 0.22, size * 0.42, Math.PI, Math.PI * 1.7);
      x.stroke();
      x.fillRect(-size * 0.62, -size * 0.06, size * 1.24, size * 0.88);
      x.fillStyle = 'rgba(7,11,7,0.85)';
      x.beginPath(); x.arc(0, size * 0.3, size * 0.14, 0, PS.TAU); x.fill();
      x.fillRect(-size * 0.06, size * 0.3, size * 0.12, size * 0.28);
      x.restore();
    },
    /* 音符图标(纯几何: 符头 + 符干 + 符尾旗) */
    musicIcon: function (cx, cy, size, color) {
      var x = this.ctx;
      x.save();
      x.translate(cx, cy);
      x.fillStyle = color || T.hi;
      x.strokeStyle = color || T.hi;
      x.lineWidth = Math.max(1.4, size * 0.16);
      if (x.ellipse) x.beginPath(), x.ellipse(-size * 0.28, size * 0.52, size * 0.44, size * 0.33, -0.35, 0, PS.TAU);
      else x.beginPath(), x.arc(-size * 0.28, size * 0.52, size * 0.38, 0, PS.TAU);
      x.fill();
      x.beginPath();
      x.moveTo(size * 0.1, size * 0.52);
      x.lineTo(size * 0.1, -size * 0.78);
      x.stroke();
      x.beginPath();
      x.moveTo(size * 0.1, -size * 0.78);
      x.lineTo(size * 0.82, -size * 0.42);
      x.lineTo(size * 0.1, -size * 0.08);
      x.closePath();
      x.fill();
      x.restore();
    },
    /* 道具图标(商店卡片/道具栏/结算清单共用)
     * v5.4(主程): 优先走美术层的**道具模型** —— PS.Art.drawItemIcon 按 mods 的主题通道分族
     *   (伤害/攻速/暴击/生命/护甲/闪避/移速/运气/收获/吸血/结构/射程/再生/元素/击退/经验/拾取/杂项),
     *   ≥16 种造型, 每件不再是同一个土豆腐块。
     *   旧实现把 **134 件道具**全画成同一个 taterShape + 白高光, 只换 def.color —— 用户截图原话「物品没有建模」。
     *   下面这段土豆块**保留为兜底**: art.js 还没提供模型(或它返回 false)时不开天窗, 也不会抛。 */
    itemIcon: function (def, cx, cy, size) {
      var x = this.ctx;
      if (PS.Art && PS.Art.drawItemIcon && def
        && PS.Art.drawItemIcon(x, def, cx, cy, size, { rarity: def.rarity }) === true) return;
      x.fillStyle = def ? def.color : T.low;
      this.taterShape(cx, cy, size, 0.15); x.fill();
      x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 2; x.stroke();
      x.fillStyle = 'rgba(255,255,255,0.22)';
      this.taterShape(cx - size * 0.2, cy - size * 0.24, size * 0.42, 0.15); x.fill();
    },
    /* 喇叭图标: on=false 时右侧画叉 */
    speakerIcon: function (cx, cy, size, on, color) {
      var x = this.ctx;
      x.save();
      x.translate(cx, cy);
      x.strokeStyle = color || T.hi;
      x.fillStyle = color || T.hi;
      x.lineWidth = Math.max(1.5, size * 0.16);
      x.beginPath();
      x.moveTo(-size * 0.85, -size * 0.28);
      x.lineTo(-size * 0.38, -size * 0.28);
      x.lineTo(size * 0.06, -size * 0.72);
      x.lineTo(size * 0.06, size * 0.72);
      x.lineTo(-size * 0.38, size * 0.28);
      x.lineTo(-size * 0.85, size * 0.28);
      x.closePath();
      x.fill();
      if (on) {
        x.beginPath(); x.arc(size * 0.18, 0, size * 0.46, -0.9, 0.9); x.stroke();
        x.beginPath(); x.arc(size * 0.18, 0, size * 0.86, -0.8, 0.8); x.stroke();
      } else {
        x.beginPath(); x.moveTo(size * 0.34, -size * 0.5); x.lineTo(size * 0.92, size * 0.5); x.stroke();
        x.beginPath(); x.moveTo(size * 0.92, -size * 0.5); x.lineTo(size * 0.34, size * 0.5); x.stroke();
      }
      x.restore();
    },
    /* 开关滑块(位置本身表达状态, 不只靠颜色) */
    switchBox: function (px, py, on, hovered) {
      var x = this.ctx;
      x.fillStyle = on ? T.swOn : (hovered ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.16)');
      this.rr(px, py, 40, 22, 11); x.fill();
      if (on) { x.strokeStyle = T.ink; x.lineWidth = 1.5; this.rr(px, py, 40, 22, 11); x.stroke(); }
      x.fillStyle = on ? T.bg : T.mid;
      x.beginPath(); x.arc(on ? px + 29 : px + 11, py + 11, 8, 0, PS.TAU); x.fill();
    },

    /* ================= 属性展示口径(数值全部现算) ================= */
    /* v3.5(主程) 这张表是**卡面词条能否显示**的总开关 modKeys() 的白名单 ——
     *   旧表还留着 v3.4 已下架的 meleePct / rangedPct 与已固定化的 critDmg, 却缺了现行通道
     *   meleeDmg / rangedDmg / eleDmg / engDmg / rangeFlat / knockback / accuracy / weaponSlot …
     *   后果是**道具的整条效果在卡面上根本不显示**(例: 铐手锁链只有 meleeDmg/rangedDmg/eleDmg,
     *   旧表一个都不认 ⇒ 卡面写不出任何词条, 玩家只能盲买)。现在按 stats.js 的 FLAT / PCT 逐条对齐。 */
    STAT_NAME: {
      maxHp: '生命上限', dmgFlat: '固定伤害', armor: '护甲', dodge: '闪避', crit: '暴击率',
      luck: '运气', harvest: '采集', lifesteal: '吸血', regen: '生命恢复', pickup: '拾取',
      thorns: '反伤', dmgPct: '伤害', atkSpd: '攻速', speedPct: '移速', rangePct: '射程',
      maxHpPct: '生命上限',
      meleeDmg: '近战伤害', rangedDmg: '远程伤害', eleDmg: '元素伤害', engDmg: '结构伤害',
      rangeFlat: '射程', knockback: '击退', accuracy: '精准', weaponSlot: '武器槽位',
      xpPct: '经验获取', shopPricePct: '商店价格', harvestingGrowth: '采集成长', dmgVsBossPct: '对精英伤害',
      enemySpdPct: '敌人移速', hpStartNextWave: '下波生命', hpStartNextWavePct: '下波生命',
      enemyHpPct: '敌人生命', enemyDmgPct: '敌人伤害', dodgeCap: '闪避上限',
      consumableHeal: '果实回复', fruitDrops: '果实掉落', freeRerolls: '免费刷新',
      bounce: '弹射', pierceBonus: '穿透',
      /* v6.4(Wave 2) 七条新通道的卡面名（缺一条 = 那条词条在卡面上显示成英文 key）。 */
      enemyCountPct: '敌人数量', hpStartWavePct: '开波生命', hpLossPerSec: '每秒失血',
      goldAttractPct: '材料吸附', doubleGoldPct: '双倍材料', healOnGoldPct: '拾金回血', healOnCritPct: '暴击回血',
      /* v6.7(Wave 3) —— 本批 45 件道具带来的通道。**缺一条 = 那条词条在卡面上显示成英文 key**
       *   (verify-item-card 的 [C1]/[B] 会当场变红), 所以这张表与 stats.js 的 FLAT/PCT 必须同步。 */
      burnChancePct: '燃烧几率', burnDmg: '燃烧伤害', burnDur: '燃烧持续', burnSpread: '燃烧扩散',
      burnCdPct: '燃烧提速', burnHpPct: '燃烧按血比', burnScalePct: '燃烧缩放',
      structTurret: '哨戒炮', structTurretFlame: '喷火哨座', structTurretHealing: '医疗哨座',
      structTurretLaser: '激光哨座', structTurretRocket: '火箭哨座', structTyler: '散射哨座',
      structGarden: '菜圃', structBot: '游走铁虫', structLandmines: '地雷',
      structAtkSpdPct: '结构攻速', structCrit: '结构暴击',
      trees: '树苗', oneShotTrees: '一触即倒', treeTurrets: '伐木成炮',
      explodeDmgPct: '爆炸伤害', explodeSizePct: '爆炸范围',
      explodeOnDeathPct: '死亡爆炸', explodeOnConsumablePct: '进食爆炸',
      goldOnCritPct: '暴击杀敌得金', goldStartWavePct: '开波得金',
      recycleGainPct: '回收比例', minWeaponCd: '最短攻击间隔',
      hitProtection: '受击保护', torture: '苦修回血', eyes: '环身眼豆',
      extraEnemiesNextWave: '下波额外怪', extraLootNextWave: '下波额外材料', extraEliteChancePct: '下波额外精英',
      randomPrimaryOnWave: '开波随机属性', hourglassFlag: '时光倒流',
      pierceDmgPct: '穿透伤害', giantCritPct: '巨力暴击', slowOnHit: '命中减速', slowOnHitMax: '减速下限',
      regenLowHpPct: '残血回复',
      /* 死通道（本作没有箱子 / 玩家倒下即终局）—— 持有件已 pool:false, 名字只为让数据键有归宿。 */
      crateGold: '开箱材料', projOnDeath: '倒下吐弹'
    },
    /* 只是"数值后面要不要加 %"的判断(百分比通道以 <key>Sum 存储; crit/dodge 是整数百分点, 同样带 %) */
    STAT_PCT: { dmgPct: 1, atkSpd: 1, speedPct: 1, rangePct: 1, maxHpPct: 1, crit: 1, dodge: 1,
      xpPct: 1, shopPricePct: 1, harvestingGrowth: 1, dmgVsBossPct: 1, enemySpdPct: 1,
      hpStartNextWave: 1, hpStartNextWavePct: 1, accuracy: 1, enemyHpPct: 1, enemyDmgPct: 1,
      hpStartWavePct: 1, enemyCountPct: 1, goldAttractPct: 1, doubleGoldPct: 1, healOnGoldPct: 1, healOnCritPct: 1,
      /* v6.7(Wave 3): 以下 18 条在源里就是百分数（消费方自己 /100），故带 % 号。 */
      burnChancePct: 1, burnCdPct: 1, burnHpPct: 1, burnScalePct: 1,
      structAtkSpdPct: 1, explodeDmgPct: 1, explodeSizePct: 1,
      explodeOnDeathPct: 1, explodeOnConsumablePct: 1, goldOnCritPct: 1, goldStartWavePct: 1,
      recycleGainPct: 1, extraEliteChancePct: 1, pierceDmgPct: 1, giantCritPct: 1,
      slowOnHit: 1, slowOnHitMax: 1, regenLowHpPct: 1 },
    /* v3.5: 标记型 key —— 出现在 mods 里但不是属性(见 stats.js MARKER), 卡面不显示。
     *   critDmg 同理: 它已固定为武器自带 critMul, 不再是玩家侧通道。 */
    /* v6.7(Wave 3): fogVisPct 与 stats.js 的 MARKER 同口径 —— 本作**没有雾/视野机制**,
     *   无消费点(见 stats.js:87-90), 所以绝不许当属性画在卡面上。 */
    STAT_SKIP: { hpCapCurrent: 1, speedCapCurrent: 1, critDmg: 1, fogVisPct: 1 },
    statLabel: function (k) { return this.STAT_NAME[k] || k; },
    /* v6.1: 「每升一级」那行的短标签 —— 卡片宽度只有一列 126px, 全名放不下(会缩到最小字号)。
     *   只覆盖 perLevel 会出现的通道; 缺项自动退回 statLabel。 */
    STAT_SHORT: {
      meleeDmg: '近战', rangedDmg: '远程', eleDmg: '元素', engDmg: '结构',
      maxHp: '生命上限', dmgPct: '伤害', armor: '护甲', speedPct: '移速', regen: '生命恢复'
    },
    statUnit: function (k) { return this.STAT_PCT[k] ? '%' : ''; },
    /* 暴击倍率 = 源武器表里**逐武器自带**的固定属性(critMul 1.25~4.0), 玩家侧没有成长项。
       所以它只可能出现在"武器卡"上; 数据缺失(移植中)一律返回 null -> 卡面不画, 绝不硬编码假数值。
       兼容两种写法: 展平后的 list[key].critMul, 或 family 级 families[f].critMul。 */
    critMulOf: function (def) {
      if (!def) return null;
      var m = def.critMul;
      if (m === undefined && def.family && PS.WeaponData && PS.WeaponData.families) {
        var f = PS.WeaponData.families[def.family];
        if (f) m = f.critMul;
      }
      if (typeof m !== 'number' || !isFinite(m) || m <= 0) return null;
      if (m >= 10) m = m / 100;            /* 万一数据表用百分数(200)表达, 归一到 2.0 */
      return m;
    },
    fmtMul: function (v) { return (Math.round(v * 10) / 10).toFixed(1); },
    /* 道具/武器 def.mods 里可展示的条目(critDmg 已被引擎固定, 不入列表) */
    modKeys: function (mods) {
      var out = [], k;
      for (k in (mods || {})) if (!this.STAT_SKIP[k] && this.STAT_NAME[k]) out.push(k);
      return out;
    },

    /* v5.12 主程: **道具效果行的唯一出口** —— mods / 标记键 / trig / scale / cond 五路一起出行。
     * 事故背景(用户逐字):「又发现了，无效果的道具」「有很高品质多无用道具，几乎没有加成」「为什么会有纯负面道具」。
     * 实测根因(work/audit-unseen2.cjs, 131 件在售): 老卡面只走 modKeys(def.mods) 一条路 ⇒
     *   ① 9 件效果**全在** trig/scale ⇒ 卡面一行不画(其中 8 件连 desc 里都没有数字) = 用户眼里的「无效果道具」;
     *   ② 17 件的 trig/scale/cond 不在卡面;
     *   ③ 2 件(alien_baby 的 enemyHpPct / ghost_outfit 的 dodgeCap)**有值但通道在 STAT_NAME 里没名字**
     *      ⇒ modKeys() 直接过滤掉, 值凭空消失;
     *   ④ 10 件卡面全是负号, 其中 8 件的正收益恰好就是被 ①②③ 吃掉的那部分 ⇒ 用户眼里的「纯负面道具」。
     * 纪律: 文案里**不许出现 def 之外的数字**(门禁 qa/verify-item-card.cjs 逐件核对每个数值都出现在行里);
     *   未知家族/未知 drive 也**必须出行**(显示名字), 绝不允许退化成"没有这一条"。
     * 家族语义逐条对齐 src/core/game.js 的 PS.ItemTriggers(源派发点见该文件 :22-43 台账),
     * 通道语义对齐 src/core/stats.js 的 compute(:306-353 的 scale/cond 消费点)。 */
    /* v6.4(Wave 2): enemyCountPct 加入这一族 —— 源 number_of_enemies 的正值是「更多敌人」= 代价
     *   （candle -10 / white_flag -5 为负值 ⇒ 收益）, 与 enemySpdPct 同类。 */
    STAT_INVERT: { shopPricePct: 1, enemySpdPct: 1, enemyHpPct: 1, enemyDmgPct: 1, enemyCountPct: 1,
      /* v6.7(Wave 3): 三条「越大越是代价」的通道。
       *   minWeaponCd          —— 最短攻击间隔被抬高 = 打得更慢, 是代价（源 ball_and_chain 的负面面）。
       *   extraEnemiesNextWave —— 下波多刷怪 = 代价（源 bait: 换来的是 dmgPct +8）。
       *   extraEliteChancePct  —— 下波多出精英 = 代价。 */
      minWeaponCd: 1, extraEnemiesNextWave: 1, extraEliteChancePct: 1 },
    STAT_MARKTXT: { hpCapCurrent: '生命上限锁定为当前值', speedCapCurrent: '移速锁定为当前值' },
    DRIVE_NOUN: { commonItem: '件普通道具', legendaryItem: '件传说道具', differentItem: '种不同道具',
      duplicateItem: '件重复道具', freeWeaponSlots: '个空武器槽', livingEnemy: '只场上敌人',
      burningEnemy: '只燃烧敌人', gold: '点金币' },
    statSign: function (v) { return v > 0 ? '+' : ''; },
    /* 数值 → 颜色。**不是"负号即红"**: 4 个反向通道越小越赚(商店价格/敌人移速/敌人生命/敌人伤害),
     *   所以「敌人移速 -8%」是绿的、「敌人生命 +10%」是红的 —— 老实现一律按正负上色, 玩家把收益读成代价。 */
    signColor: function (ch, mv) {
      if (!mv) return T.mid;
      return (this.STAT_INVERT[ch] ? mv < 0 : mv > 0) ? T.pos : T.neg;
    },
    /* 触发族一行。tg 的字段由 tools/port-source.cjs 从源 .tres 逐字落成(见 items.js 头注释)。 */
    /* 机制行的取色: 有数值就按"这个数对玩家是好是坏"上色(反向通道自动反向), 无数值才退回机制色。
     * 为什么不能一律机制色: celery_tea 的「仅下一波 敌人生命 +100%」是**代价**, 画成中性色等于没提示。 */
    fxColor: function (ch, v) { return v ? this.signColor(ch, v) : T.luck; },
    trigTxt: function (tg) {
      if (!tg || !tg.fam) return '';
      var L = this.statLabel(tg.ch), U = this.statUnit(tg.ch), S = this.statSign;
      switch (tg.fam) {
        case 'stats_end_of_wave': return '每波结束 ' + L + ' ' + S(tg.v) + tg.v + U;
        case 'stats_on_level_up': return '每升 1 级 ' + L + ' ' + S(tg.v) + tg.v + U;
        case 'stats_next_wave': return '仅下一波 ' + L + ' ' + S(tg.v) + tg.v + U;
        case 'temp_stats_on_hit': return '每次受击 ' + L + ' ' + S(tg.v) + tg.v + U + '（每波清）';
        case 'gain_stat_for_equipped_item_with_stat':
          return '每件带' + this.statLabel(tg.stat) + '的道具 ' + L + ' +' + tg.per + U;
        case 'dmg_when_pickup_gold': return '拾到材料时 ' + tg.chance + '%概率 ' + L + '×' + tg.pct + '%伤害';
        case 'dmg_when_death': return '倒下时 ' + tg.chance + '%概率 ' + L + '×' + tg.pct + '%伤害';
        case 'dmg_on_dodge': return '闪避时 ' + tg.chance + '%概率 ' + L + '×' + tg.pct + '%伤害';
        /* v6.7(Wave 3) 两条此前**没有出口**的家族（它们的持有件已在售, 不补就是卡面空白）。
         *   heal_on_dodge 源 player.gd:459-466: 每次闪避 randf() < chance/100 ⇒ 回 v 点。
         *   另一条见 game.js 的 onBurnKill（源 main.gd:536-544）。 */
        case 'heal_on_dodge': return '闪避时 ' + tg.chance + '%概率 回复 ' + tg.v + ' 点生命';
        case 'gain_stat_for_killed_enemies_while_burning':
          return '烧死对手时 ' + L + ' +' + tg.v + U + (tg.maxProcs != null ? '（每波最多 ' + tg.maxProcs + ' 次）' : '');
        case 'enemy_percent_damage_taken':
          return L + '命中后 敌人承伤 +' + tg.pct + '% ' + tg.dur + '秒' + (tg.maxStacks > 1 ? ' 最多' + tg.maxStacks + '层' : '');
      }
      return '触发 ' + tg.fam + ' ' + L + ' ' + S(tg.v) + tg.v;
    },
    /* 缩放族一行: 源 run_data.gd:1257 起的 counters 口径, per * (actual / nb)。 */
    scaleTxt: function (d) {
      if (!d || !d.ch) return '';
      var nb = (typeof d.nb === 'number' && d.nb) ? d.nb : 1;
      var L = this.statLabel(d.ch), U = this.statUnit(d.ch), tail = ' ' + L + ' ' + this.statSign(d.per) + d.per + U;
      if (typeof d.drive === 'string' && d.drive.indexOf('stat:') === 0)
        return '每 ' + nb + ' 点' + this.statLabel(d.drive.slice(5)) + tail;
      var noun = this.DRIVE_NOUN[d.drive];
      if (!noun) return '缩放 ' + d.drive + tail;
      return (nb === 1 ? '每' : '每 ' + nb + ' ') + noun + tail;
    },
    /* 条件族一行(stats.js:337-349 的 cond 消费点: notMoving / interval)。 */
    condTxt: function (d) {
      if (!d || !d.ch) return '';
      var tail = ' ' + this.statLabel(d.ch) + ' ' + this.statSign(d.v) + d.v + this.statUnit(d.ch);
      if (d.kind === 'notMoving') return '站定不动时' + tail;
      if (d.kind === 'interval') return '每 ' + d.every + ' 秒' + tail;
      return '条件 ' + d.kind + tail;
    },
    /* 五路合并成卡面行。keys 可传(卡面外面还要用), 不传就现算。 */
    itemEffectRows: function (def, keys) {
      var rows = [], i, k, mv, tg, d, s;
      if (!def) return rows;
      keys = keys || this.modKeys(def.mods);
      for (i = 0; i < keys.length; i++) {
        k = keys[i];
        mv = def.mods[k];
        rows.push({ t: this.statLabel(k) + ' ' + this.statSign(mv) + mv + this.statUnit(k), c: this.signColor(k, mv) });
      }
      for (k in (def.mods || {})) if (this.STAT_MARKTXT[k]) rows.push({ t: this.STAT_MARKTXT[k], c: T.luck });
      for (i = 0; (tg = (def.trig || [])[i]); i++) {
        s = this.trigTxt(tg);
        if (s) rows.push({ t: s, c: this.fxColor(tg.ch, (tg.v !== undefined ? tg.v : (tg.per !== undefined ? tg.per : tg.pct))) });
      }
      for (i = 0; (d = (def.scale || [])[i]); i++) { s = this.scaleTxt(d); if (s) rows.push({ t: s, c: this.fxColor(d.ch, d.per) }); }
      for (i = 0; (d = (def.cond || [])[i]); i++) { s = this.condTxt(d); if (s) rows.push({ t: s, c: this.fxColor(d.ch, d.v) }); }
      return rows;
    },
    /* v7.11: 商店卡的词条装配(唯一一份)。返回 { rows, keys } —— rows 给卡面(过 rowLayout 截断)
     *   与详情页(不截断)共用; keys 给 firstDelta 判断"这张卡改了哪些通道"。
     *   武器 = 武器表自己的 dmg/atkCd/range/knock/projCount/lifesteal + 逐件的 mods;
     *   道具 = itemEffectRows 的五路合并(数值词条 / 标记 / 触发 / 缩放 / 条件)。 */
    cardRows: function (c, def, isW) {
      var rows = [], keys = this.modKeys(def.mods), i, mv;
      if (isW) {
        var cm = this.critMulOf(def);
        if (cm !== null) rows.push({ t: '暴击 ×' + this.fmtMul(cm), c: T.coin });
        if (typeof def.dmg === 'number') rows.push({ t: '伤害 ' + def.dmg, c: T.pos });
        if (def.atkCd) rows.push({ t: '冷却 ' + (Math.round(def.atkCd * 1000) / 1000) + 's', c: T.mid });
        if (def.range) rows.push({ t: '射程 ' + def.range, c: T.mid });
        if (def.knock) rows.push({ t: '击退 ' + def.knock, c: T.mid });
        if (def.projCount > 1) rows.push({ t: '弹数 ' + def.projCount, c: T.mid });
        if (def.lifesteal > 0) rows.push({ t: '生命窃取 ' + def.lifesteal + '%', c: T.pos });
        for (i = 0; i < keys.length; i++) {
          mv = def.mods[keys[i]];
          rows.push({ t: this.statLabel(keys[i]) + ' ' + (mv > 0 ? '+' : '') + mv + this.statUnit(keys[i]), c: mv < 0 ? T.neg : T.pos });
        }
      } else {
        rows = this.itemEffectRows(def, keys);
      }
      return { rows: rows, keys: keys };
    },
    /* 卡面**行容量契约** —— 一次能画几行、超出的怎么告知。
     * 为什么要有这个函数而不是散在绘制里: 旧实现是 4 个槽、超出时只画 3 行再补一句「… 共 N 条效果」,
     *   两个数字(画 3 / 共 N)分别写死在不同行上, 谁改一个都会让玩家看到自相矛盾的卡面。
     *   现在**画出的 + 告知的 == 总条数**成了一条可断言的等式(门禁 qa/verify-item-card.cjs [B3])。
     * 5 个槽的几何依据: 首行 py+182, 行距 15 ⇒ 第 5 行基线 py+242, 预览行在 py+256(留 14px), 不重叠。 */
    ITEM_ROW_CAP: 5,
    /* v5.17: cap 变成**入参** —— 图鉴那一格只有 4 个槽(几何见 DEX_ITEM_ROW_CAP), 同一条等式复用。 */
    rowLayout: function (rows, cap) {
      cap = cap || this.ITEM_ROW_CAP;
      var total = rows.length;
      var shown = Math.min(total, cap), cut = total > shown;
      if (cut) shown = cap - 1;            /* 让出最后一个槽给那句「… 共 N 条效果」 */
      return { total: total, shown: shown, hidden: total - shown,
               announcement: cut ? ('… 共 ' + total + ' 条效果') : '' };
    },
    /* 图鉴(道具)一格的槽数 —— 首行 +47、行距 17, 4 个槽 ⇒ 第 5 行基线 +115 < 134.7(道具页一格高)。
     * 4 不是随手定的: 131 件在售里 123 件效果 <= 4 条(分布见 work/dex-item-probe.json), 剩下 8 件
     *   (medal/alloy/big_arms/cape/exoskeleton/heavy_bullets/mammoth/potato)才用得上那句「… 共 N 条效果」。 */
    DEX_ITEM_ROW_CAP: 4,
    /* 给门禁用的整体入口(效果行 + 排版一起算) */
    itemRowLayout: function (def, keys) { return this.rowLayout(this.itemEffectRows(def, keys)); },
    ownedItems: function (id) {
      var g = PS.Game, n = 0, i;
      for (i = 0; i < g.items.length; i++) if ((g.items[i].id || g.items[i]) === id) n++;
      return n;
    },
    ownedWeapons: function (key, tier) {
      var g = PS.Game, n = 0, sameTier = 0, i;
      var canonOf = (PS.WeaponData && PS.WeaponData.canon) || function (k) { return k; };
      for (i = 0; i < g.weapons.length; i++) {
        /* 按 canon(key) 数: 起始武器可能带旧别名 key(swift1), 商店件是正典 key(smg_t1), 二者是同一把武器。
         *   不过 canon 就会出现「栏里明明有两件同名同阶, 「合」按钮却说缺同名」的实测 bug。 */
        if (canonOf(g.weapons[i].key) === canonOf(key)) { n++; if (g.weapons[i].tier === tier) sameTier++; }
      }
      return { total: n, sameTier: sameTier };
    },
    /* 同名武器是否已持有 —— 按 **family(族)** 数, 不是按 key。
     *   key 自带阶数(cactus_mace_t1), 所以 key 相同 ⟺ 同族**且**同阶; 而玩家嘴里的"同名"是族级别的。
     *   商店的"决策提示"必须按族判: 否则"已有同名(异阶)"永远不显示(那时 own.total 也是 0),
     *   卡片上一条提示都没有 —— 用户实测反馈「购买同名武器还是无法合成」正是撞在这里。 */
    ownedFamily: function (key) {
      var g = PS.Game, d = PS.WeaponData.list[key], n = 0, i;
      if (!d || !d.family) return 0;
      for (i = 0; i < g.weapons.length; i++) {
        var wd = PS.WeaponData.list[g.weapons[i].key];
        if (wd && wd.family === d.family) n++;
      }
      return n;
    },

    /* ---------- 数值预览: 一律走 PS.Game.statsWith() —— 面板聚合的唯一真源 ----------
     * 事故(用户逐字): 「这个伤害78%-58%显示不对, 但不会有实际影响」。
     *   旧实现这三个函数**自己又拼了一遍** PS.Stats.compute 的入参, 只传前 4 个, 漏掉武器羁绊
     *   (第 5 参)与 condCtx(第 6 参) ⇒ 身上有羁绊生效时, 每个 "→" 预览比真值凭空少一截。
     *   注意 weapons 传的是"买下之后"的整表: 新武器可能激活/升档羁绊, 只补一把不够。
     * 死规矩: 本文件不许再出现 PS.Stats.compute —— qa/verify-stat-preview.cjs 会断言。
     *   (预览与真值必须同源: 一旦再手拼一次参数, 这类"显示错/手感对"就会复发, 而且没人看得出来。)
     */
    statsAfterUpgrade: function (choice) {
      var g = PS.Game;
      return g.statsWith(g.items, g.weapons, (g.levelups || []).concat([choice]));
    },
    statsAfterItem: function (itemId) {
      var g = PS.Game;
      return g.statsWith((g.items || []).concat([{ id: itemId }]), g.weapons, g.levelups);
    },
    statsAfterWeapon: function (key, tier) {
      var g = PS.Game;
      return g.statsWith(g.items || [],
        (g.weapons || []).concat([{ key: key, tier: tier, cd: 0.2, angle: 0 }]), g.levelups);
    },
    /* 百分比类属性在 PS.Stats 里的累加字段名 */
    pctSumKey: function (stat) {
      var PCT = { dmgPct: 1, meleePct: 1, rangedPct: 1, atkSpd: 1, speedPct: 1, rangePct: 1, maxHpPct: 1 };
      return PCT[stat] ? stat + 'Sum' : stat;
    },
    /* 当前值 / 新值。critDmg 恒返回 null: 引擎里它是固定值(0.5), 展示绝对值会误导 */
    deltaOf: function (cur, next, stat, pct) {
      if (stat === 'critDmg') return null;
      var k = this.pctSumKey(stat);
      var a = cur[k], b = next[k];
      if (typeof a !== 'number' || typeof b !== 'number') return null;
      return { cur: a, next: b, changed: b !== a, pct: !!pct };
    },
    fmtStat: function (stat, v, pct) {
      if (stat === 'regen' || stat === 'lifesteal') return '' + (Math.round(v * 10) / 10);
      if (pct || stat === 'crit' || stat === 'dodge' || stat === 'maxHpPct') return Math.round(v) + '%';
      return Math.round(v) + '';
    },
    /* 画「当前 → 新值」。数值没有真正变化时返回 0 且不画(避免「3% → 3%」假对比) */
    drawDelta: function (stat, d, cx, py, size, align) {
      var x = this.ctx, u = this.ui;
      if (!d || !d.changed) return 0;
      size = size || T.fs.small;
      x.font = 'bold ' + size + 'px ' + u.font;
      var a = this.fmtStat(stat, d.cur, d.pct), b = this.fmtStat(stat, d.next, d.pct), ar = ' → ';
      var wa = x.measureText(a).width, wr = x.measureText(ar).width, wb = x.measureText(b).width;
      var total = wa + wr + wb;
      var sx = (align === 'left') ? cx : cx - total / 2;
      x.textAlign = 'left';
      x.fillStyle = T.mid; x.fillText(a, sx, py);
      x.fillStyle = T.low; x.fillText(ar, sx + wa, py);
      x.fillStyle = T.pos; x.fillText(b, sx + wa + wr, py);
      return total;
    },
    /* 「当前 → 选它之后」的整行(属性名 + 对比), 无变化时画「当前 X」 */
    deltaLine: function (stat, after, px, py, size, maxW) {
      var g = PS.Game;
      var lbl = this.statLabel(stat);
      var d = this.deltaOf(g.stats, after, stat, !!this.STAT_PCT[stat]);
      var segs = (d && d.changed)
        ? [[lbl + ' ', T.mid], [this.fmtStat(stat, d.cur, d.pct), T.low], [' → ', T.low],
           [this.fmtStat(stat, d.next, d.pct), T.pos]]
        : [[lbl + ' ', T.mid], [d ? this.fmtStat(stat, d.cur, d.pct) : '—', T.low]];
      if (maxW) return this.fitRich(segs, px, py, size || T.fs.small, maxW);
      return this.richText(segs, px, py, size || T.fs.small);
    },

    /* ---------- 幸运收益(唯一口径: balance.js 的 rarityWeights / itemChance) ----------
     * v7.1(源对齐): 掉落那一格不再是旧的 6%+0.3pp 自定形状, 而是源 main.gd:627 的 item_chance
     *   (B.luckDropChance = B.itemChance(luck, 0.2, 本波已白送件数)) —— 因此它**随已送出件数递减**,
     *   界面上把「这一件」与「再中一件」并排给出。 */
    luckInfo: function () {
      var g = PS.Game, luckN = Math.round((g.stats && g.stats.luck) || 0);
      var out = { luck: luckN, pct: 0, chance: 0, nextChance: 0 };
      if (typeof B.rarityWeights === 'function') {
        var w = B.rarityWeights(g.wave, luckN), tot = w[0] + w[1] + w[2] + w[3];
        if (tot > 0) out.pct = Math.round((w[2] + w[3]) / tot * 100);
      }
      if (typeof B.luckDropChance === 'function') {
        var sp = g.itemsSpawnedThisWave || 0;
        out.chance = Math.round(B.luckDropChance(g.wave, luckN, sp) * 100);
        out.nextChance = Math.round(B.luckDropChance(g.wave, luckN, sp + 1) * 100);
      }
      return out;
    },    /* ================= 通用背景(菜单/模式/结算页) ================= */
    backdrop: function (cx, cy) {
      var x = this.ctx, u = this.ui;
      this.fillScreen(T.bg);
      var grad = x.createRadialGradient(cx, cy, 60, cx, cy, Math.max(u.W, u.H) * 0.78);
      grad.addColorStop(0, this.withA(T.gold, 0.16));
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = grad;
      this.fillScreenRect();
    },

    /* ================= 音频开关面板(主菜单 / 结算页 / 暂停页共用) =================
     * v5.2: 暂停页(State.PAUSE)也用它。进入暂停后模拟已冻结, 点面板不会顺带把角色拽走;
     *   战斗中(State.PLAY)**唯一**的可点元素是右上角那枚「设置」齿轮。
     * id 固定 audio-sfx / audio-bgm —— verify-ui 与微信自检按 id 断言。 */
    audioPanel: function (px, py, w, opts) {
      var x = this.ctx;
      var plain = !!(opts && opts.plain);
      var MUSIC = PS.Music;
      var rows = [{ id: 'sfx', label: '音效', on: !!PS.Sound.enabled }];
      if (MUSIC && typeof MUSIC.toggle === 'function') rows.push({ id: 'bgm', label: '音乐', on: !!MUSIC.enabled });
      if (plain) return this.audioRows(px, py, w, rows);
      var fpsH = this.fpsRowH(w - 16, this.fpsChoices().length);   /* 末行固定是帧率挡位(见 fpsRow) */
      var h = 36 + rows.length * 44 + fpsH + 6;
      this.panel(px, py, w, h, { title: '设置', fill: 'rgba(13,19,13,0.92)' });
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i], rx = px + 8, ry = py + 38 + i * 44, rw = w - 16;
        var hot = this.hot(rx, ry, rw, 44);
        if (hot) { x.fillStyle = 'rgba(255,255,255,0.07)'; this.rr(rx, ry, rw, 44, 8); x.fill(); }
        var col = r.on ? T.hi : T.low;
        if (r.id === 'sfx') this.speakerIcon(rx + 20, ry + 22, 8.5, r.on, col);
        else this.musicIcon(rx + 20, ry + 22, 8.5, col);
        this.text(r.label, rx + 38, ry + 27, T.fs.body, col, 'left', false);
        this.text(r.on ? '开' : '关', rx + rw - 52, ry + 27, T.fs.small, r.on ? T.pos : T.low, 'right', false);
        this.switchBox(rx + rw - 44, ry + 11, r.on, hot);
        this.btnRects.push({ x: rx, y: ry, w: rw, h: 44, label: r.label });
        this.buttons.push({
          x: rx, y: ry, w: rw, h: 44, id: 'audio-' + r.id,
          label: r.label + (r.on ? ' 开' : ' 关'),
          cb: this.press(rx, ry, rw, 44, { cb: (function (rid) {
            return function () {
              if (rid === 'bgm') { if (PS.Music && PS.Music.toggle) PS.Music.toggle(); }
              else PS.Sound.toggle();
            };
          })(r.id) })
        });
      }
      this.fpsRow(px + 8, py + 38 + rows.length * 44, w - 16);
      return h;
    },

    /* ================= 帧率挡位行(30 / 60 / 120) =================
     * 布尔用开关, 枚举用分段选择 —— 上面两行是开关, 帧率这一行是 30/60/120 的分段选择, 形态不同所以不复用 switchBox。
     * **只列本机支持的挡位**(用户口径: 手机不支持 120 帧率就不显示 120): 能力真源 = 平台 fpsCap
     *   (微信 setPreferredFramesPerSecond 有效范围 1-60 ⇒ 60; 浏览器由实测屏幕刷新率决定, 见 web.js probeFpsCap)。
     * 布局宽度自适应(见 fpsRowH): 面板够宽 -> 标签与挡位同排; 太窄 -> 标签另起一行。
     * 热区恒 44 高(触控下限), id 固定 fps-30 / fps-60 / fps-120。 */
    FPS_CHOICES: [30, 60, 120],
    /* 本机帧率上限(挡位白名单里最高的可用值) */
    fpsMax: function () {
      var p = PS.PlatformWeApp || PS.PlatformWeb;
      var c = (p && p.fpsCap) || 60;
      return (c === 30 || c === 60 || c === 120) ? c : 60;
    },
    fpsChoices: function () {
      var cap = this.fpsMax();
      return this.FPS_CHOICES.filter(function (v) { return v <= cap; });
    },
    /* 帧率行高: 每个挡位至少 44 宽(触控下限) + 左侧标签 74 —— 放不下就换行, 不把触控做小。
     *   暂停页 560 宽(rw=472)永远同排; 结算页右角那块 200 宽(rw=184)只在两挡(30/60)时同排。 */
    fpsRowH: function (rw, n) { return (rw - 8 - 74 - (n - 1) * 6 >= n * 44) ? 44 : 70; },
    fpsRow: function (rx, ry, rw) {
      var x = this.ctx;
      var vals = this.fpsChoices(), n = vals.length, cap = this.fpsMax();
      /* 存档可能带本机不支持的挡位(在别处选的 120): 显示上夹到上限, 不许出现"哪个都没选中"的空态 */
      var cur = Math.min((PS.Save && PS.Save.data && PS.Save.data.fps) || 60, cap);
      var GAP = 6, stacked = this.fpsRowH(rw, n) !== 44;
      var CW = stacked ? Math.floor((rw - 8 - GAP * (n - 1)) / n)
        : Math.min(64, Math.floor((rw - 8 - 74 - GAP * (n - 1)) / n));
      var c0 = stacked ? rx : (rx + rw - 8 - (CW * n + GAP * (n - 1)));
      var cy = stacked ? ry + 26 : ry;                       /* 胶囊热区顶(恒 44 高) */
      this.text('帧率', rx + 38, stacked ? ry + 18 : ry + 27, T.fs.body, T.hi, 'left', false);
      for (var i = 0; i < n; i++) {
        var v = vals[i], bx = c0 + i * (CW + GAP);
        var on = (cur === v), hot = this.hot(bx, cy, CW, 44);
        x.fillStyle = on ? this.withA(T.gold, 0.32) : (hot ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.05)');
        this.rr(bx, cy + 7, CW, 30, 8); x.fill();
        x.strokeStyle = on ? T.gold : T.weak; x.lineWidth = on ? 2 : 1;
        this.rr(bx, cy + 7, CW, 30, 8); x.stroke();
        this.text(String(v), bx + CW / 2, cy + 27, T.fs.small, on ? T.coin : T.mid, 'center', false);
        this.btnRects.push({ x: bx, y: cy + 7, w: CW, h: 30, label: '帧率 ' + v });
        this.buttons.push({
          x: bx, y: cy, w: CW, h: 44, id: 'fps-' + v, label: '帧率 ' + v,
          cb: this.press(bx, cy, CW, 44, { cb: (function (val) {
            return function () { PS.Save.setFps(val); PS.Sound.play('click'); };
          })(v) })
        });
      }
    },


    /* ================= 音频开关(封面右列: 无边框变体) =================
     * 原版封面右列是**无边框、右对齐的竖排文字项**(它们那侧是 MOD / DLC / 社区 / 制作人名单)。
     * 本作能真接线的次要项只有「音效 / 音乐」两项 —— 于是右列就是这两行的右对齐文本 + 右侧小开关,
     *   不再套那块描边大卡片: 封面右下角一块描边面板会和左列的按钮列表争夺视觉重量。
     * 热区仍是整行 200x44(≥44 触控下限), id 照旧 audio-sfx / audio-bgm —— 门禁与微信自检按 id 断言。
     * 开/关只由**开关本身**表达(绿=开 / 灰=关 + 滑块位置); 文字恒用亮色,
     *   免得"关"态在深紫灰剪影墙上掉到 3:1 以下读不清。 */
    audioRows: function (px, py, w, rows) {
      var x = this.ctx;
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i], ry = py + i * 44;
        var hot = this.hot(px, ry, w, 44);
        /* 每行一块**无描边**的半透明深底(对齐原版右列那种圆角"片"):
           它只是把文字从剪影墙上"垫"起来, 不是面板 —— 描边大卡片才会和左列争重量。
           底色下去后, 奶油字在上面约 6.4:1, 远离 AA 线。 */
        x.fillStyle = hot ? 'rgba(255,255,255,0.14)' : 'rgba(6,10,6,0.46)';
        this.rr(px, ry, w, 44, 10); x.fill();
        var col = hot ? T.coin : T.hi;
        this.text(r.label, px + w - 56, ry + 27, T.fs.body, col, 'right', false);
        this.switchBox(px + w - 44, ry + 11, r.on, hot);
        this.btnRects.push({ x: px, y: ry, w: w, h: 44, label: r.label });
        this.buttons.push({
          x: px, y: ry, w: w, h: 44, id: 'audio-' + r.id,
          label: r.label + (r.on ? ' 开' : ' 关'),
          cb: this.press(px, ry, w, 44, { cb: (function (rid) {
            return function () {
              if (rid === 'bgm') { if (PS.Music && PS.Music.toggle) PS.Music.toggle(); }
              else PS.Sound.toggle();
            };
          })(r.id) })
        });
      }
      return rows.length * 44;
    },

    /* ================= 主菜单 ================= */

    /* ================= 菜单站台的小件(v5.2) ================= */

    /* ================= 封面底: 怪物剪影墙 =================
     * 用户诉求「封面照原版设计」里唯一被借鉴的东西是**信息架构**: 背景铺满一整层本作怪物的暗色剪影。
     * 三条纪律:
     *   1) 形状只从真入口 PS.Art.drawEnemy 来(与战斗里同一批烘焙精灵) —— 美术侧重做怪物时封面自动跟着变;
     *      ui.js 不另画一套怪物造型, 也就不存在"菜单是另一个游戏"。
     *   2) 只在离屏画布上**烘一次**: 画完就地用 source-atop 把整面墙**抹成同一个色号**(单色剪影),
     *      再用 destination-out 抹两条全局淡出带 ⇒ 热路径只剩 1 次 drawImage, 不是每帧 56 次。
     *   3) 一个 fillText 都没有 ⇒ 结构上不可能进入 verify-ui 的文字溢出/重叠/压按钮审计面。
     * 纵深只用两个手段: **尺寸**(上远下近 —— 由 ctx 变换缩放**同一张**精灵 ⇒ r 恒定,
     *   PS.Sprites 每只怪只占一个槽) + 整图上下两条暗角;
     *   颜色与透明度**全墙统一**, 怪物之间只靠轮廓区分(墙纸感)。
     * 不改 PS.Art / PS.Sprites 的任何全局开关; 缓存键含 **W/H/dpr + 图集就绪度**, 任一变化自动重烘。 */
    menuWall: function () {
      var x = this.ctx, u = this.ui, W = u.W, H = u.H, bl = this.bleed;
      /* 这面墙要盖满"逻辑面 + 溢出": 只烘 W×H 的话, 两侧溢出带就没东西盖(旧版就是黑条)。
       *   墙按 bw×bh 排版(怪物横向铺得更开), 落图时整体左移 bl.l / 上移 bl.t 对齐逻辑面。 */
      var bw = W + bl.l + bl.r, bh = H + bl.t + bl.b;
      var A = PS.Art, FD = PS.EnemyData && PS.EnemyData.list;
      if (!A || !A.drawEnemy || !FD || typeof u.makeCanvas !== 'function') return;
      var dpr = Math.max(1, Math.min(2, u.dpr || 1));
      /* v7.3(2026-09-30 审计) 缓存键必须含**决定画什么**的全部状态。旧键只有 W/H/dpr,
       *   而这块墙在 ~512ms 就烘好了、图集 ~543ms 才 ready(件内探针 work/audit-wall3.cjs),
       *   于是封面**永久**停在「用程序化形体画的那一版」, 与「美术侧重做怪物时封面自动跟着变」直接矛盾。
       *   把图集就绪度并进键: 就绪那一刻自动重烘一次(只多烘一次, 之后稳态仍是每帧 1 次 drawImage)。
       *   为什么不做成「等图集就绪再画」: 加载失败/慢网时封面会空着 —— 那是把可用性押在图集上。 */
      var atlReady = !!(PS.Atlas && PS.Atlas.ready && PS.Atlas.ready());
      var ck = bw + 'x' + bh + '@' + dpr + '|' + (atlReady ? 'atl' : 'pro');
      if (!this.wallCache || this.wallCache.k !== ck) {
        var c = null, wc = null;
        try { c = u.makeCanvas(Math.round(bw * dpr), Math.round(bh * dpr)); } catch (e0) { c = null; }
        wc = (c && c.getContext) ? c.getContext('2d') : null;
        if (!wc) { this.wallCache = null; return; }
        wc.scale(dpr, dpr);
        try { this.paintWall(wc, bw, bh, FD); } catch (e1) { this.wallCache = null; return; }
        this.wallCache = { k: ck, c: c };
      }
      x.drawImage(this.wallCache.c, -bl.l, -bl.t, bw, bh);
    },

    /* 剪影墙的烘焙内容(只在 menuWall 里调用一次)。
     * 排布**确定性**(按 roster 下标取, 不用 Math.random) —— 截图与门禁可复现。
     * 只用普通怪: 精英/Boss 是战斗里的"波次事件", 铺满封面会把它们的稀缺感打没。 */
    paintWall: function (wc, W, H, FD) {
      var A = PS.Art;
      var keys = [], R = A.roster || [], i, k, d;
      for (i = 0; i < R.length; i++) {
        k = R[i]; d = FD[k];
        if (!d || d.boss || d.elite || d.endlessOnly || !d.name) continue;
        keys.push(k);
      }
      if (!keys.length) { for (k in FD) { d = FD[k]; if (d && d.name && !d.boss && !d.elite) keys.push(k); } }
      if (!keys.length) return;
      /* [基线 y, 缩放, 每排只数] —— 只有**大小**随排数变(上小下大 = 纵深)。
       * 不再有"逐排 alpha": 原版那面墙是**同一个色号、同一个透明度**的剪影, 靠轮廓读。
       *   "每只怪保留自己的物种配色再整体调暗" 会让颜色互相打架、糊成色块(用户实测截图的原话)。
       * 只数是**故意的密**(每排 15~20 只): 首版 8~12 只在实测截图里读成"几颗零散光斑", 不是"墙"。
       * 加密几乎不要钱 —— 精灵按 (key,r) 缓存, 多出来的只是烘焙期的 drawImage 次数, 稳态每帧仍是 1 次。 */
      var SIL = '#221d2b';   /* 剪影墙的**唯一色号**(深紫灰): 全墙同色同透明度, 只靠轮廓分辨 */
      var ROWS = [
        [48, 0.80, 20], [104, 0.88, 19], [164, 0.96, 18],
        [228, 1.06, 17], [296, 1.16, 16], [366, 1.28, 15]
      ];
      var BASE_R = 15, n = 0, r, row, cnt, sc, y, span, step, j, kk, xx;
      for (r = 0; r < ROWS.length; r++) {
        row = ROWS[r]; y = row[0]; sc = row[1]; cnt = row[2];
        span = W - 120; step = cnt > 1 ? span / (cnt - 1) : 0;
        for (j = 0; j < cnt; j++) {
          kk = keys[(n * 7 + r * 3 + j * 5) % keys.length];
          n++;
          xx = 60 + j * step + ((j % 2) ? 12 : -12);
          wc.save();
          wc.translate(xx, y); wc.scale(sc, sc); wc.translate(-xx, -y);
          wc.globalAlpha = 1;                 /* 每只都**全不透明**画上去, 颜色下一步统一抹掉 */
          A.drawEnemy(wc, { x: xx, y: y, r: BASE_R, hp: 1, maxHp: 1, key: kk,
            ang: (j % 2) ? 0 : Math.PI }, FD[kk], 0);
          wc.restore();
        }
      }
      wc.globalAlpha = 1;
      /* 单色化: source-atop 只落在"已经画上去的像素"上 —— 于是一整面墙被抹成**同一个色号**,
       *   只留 alpha 轮廓(抗锯齿边照旧)。这是"墙纸感"的关键: 原版靠轮廓分辨怪物, 不靠配色。
       * 色号 #2a2436 的挑法: 与夜底 (#070b07) 亮度比 ≈2.3 —— 看得出来, 但抢不走大标题;
       *   同时它让奶油字 (T.hi #f2ead6) 压在上面仍有 4.8:1, 右列那两行无边框文字才立得住。 */
      wc.globalCompositeOperation = 'source-atop';
      wc.fillStyle = SIL;
      wc.fillRect(0, 0, W, H);
      /* 全局渐隐(图上的一层, 不是"逐只改透明度"): 顶端让给大标题, 底端让给打光地面。
       * 剪影本身仍是同色同 alpha —— 这里只是整张图上下各压一条暗角, 轮廓边缘照旧清晰。 */
      wc.globalCompositeOperation = 'destination-out';
      var top = wc.createLinearGradient(0, 0, 0, 150);
      top.addColorStop(0, 'rgba(0,0,0,0.34)');
      top.addColorStop(1, 'rgba(0,0,0,0)');
      wc.fillStyle = top; wc.fillRect(0, 0, W, 150);
      var bot = wc.createLinearGradient(0, 358, 0, 500);
      bot.addColorStop(0, 'rgba(0,0,0,0)');
      bot.addColorStop(1, 'rgba(0,0,0,1)');
      wc.fillStyle = bot; wc.fillRect(0, 358, W, 142);
      /* 四周暗角: 原版剪影墙的亮区是"中间一团、四角没入黑" —— 没这层的话,
       *   墙会均匀铺满整屏, 读起来像贴图平铺, 而不是"夜雾里的一片墙"; 它也顺手
       *   把左右两列文字与大标题的底增到足够黑。同样烘进离屏图, 热路径仍然只有 1 次 drawImage。 */
      var vg = wc.createRadialGradient(W / 2, 300, 120, W / 2, 300, 760);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(0.62, 'rgba(0,0,0,0.18)');
      vg.addColorStop(1, 'rgba(0,0,0,0.92)');
      wc.fillStyle = vg; wc.fillRect(0, 0, W, H);
      /* 标题底座: 大标题脚下那块更暗的雾, 让 52px 奶油字在任何剪影上都读得出来。
         一起烘进来 ⇒ 热路径仍然只有 1 次 drawImage。 */
      wc.globalCompositeOperation = 'source-over';
      var tp = wc.createRadialGradient(W / 2, 124, 20, W / 2, 124, 480);
      tp.addColorStop(0, 'rgba(7,11,7,0.74)');
      tp.addColorStop(0.58, 'rgba(7,11,7,0.44)');
      tp.addColorStop(1, 'rgba(7,11,7,0)');
      /* 落图矩形必须**整个包住**渐变圆(半径 480 ⇒ 中心 y=124 的圆覆盖 y=0..604):
         否则矩形下缘落在 alpha 还有 0.6 的地方, 就是一条能看见的横缝(首版实测就是这样)。 */
      wc.fillStyle = tp; wc.fillRect(W / 2 - 480, 0, 960, 604);
    },

    /* 菜单背景: 深底 + 中心一团金雾。与 backdrop() 的区别是这一层不画 gold 环, 只给"夜的菜园"打光。 */
    menuBackdrop: function (cx, cy) {
      var x = this.ctx, u = this.ui, W = u.W, H = u.H;
      this.fillScreen(T.bg);
      var g = x.createRadialGradient(cx, cy - 60, 40, cx, cy - 60, Math.max(W, H) * 0.74);
      g.addColorStop(0, this.withA(T.gold, 0.15));
      g.addColorStop(0.55, this.withA(T.gold, 0.05));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      this.fillScreenRect();
    },

    /* 菜单站台: 真地形 + 真角色 + 各自的起始武器 + 对面两只真怪。
     * 全部读数据表与 PS.Art(不在这里自绘任何专属素材) —— 这就是用户那句「完全不符合游戏内容」的结构性解法:
     * 菜单里画的东西与战斗里会看到的东西永远是同一批, 不存在"菜单是另一个游戏"。
     * 性能: 地面 1 次 drawGround(内含平铺 drawImage + 地物 + 暗角), 角色/武器/怪各 1 次 drawImage。
     * 关键几何: ground 的视口矩形必须**恰好等于**这条地面带 —— drawGround 的暗角是按它自己的视口烘的,
     *   视口与带子错位就会出现一条"暗度突变"的横痕。 */

    /* 菜单站台: 一场"真的打起来了"的取景 —— 主角 + 环绕武器 + 一圈围上来的怪, 全部来自数据表与 PS.Art。
     * 为什么不摆一排立绘: 立绘排排站是"角色一览", 而这是**幸存者**类游戏 —— 首屏该给出的信息是
     *   「你的蔬菜被一群怪围着打」, 这正是战斗里每秒都在发生的事。
     * 复用而非重画:
     *   · 地面   PS.Art.drawGround(与战斗同一份烘焙贴图 + 同一份地物散布)
     *   · 主角   PS.Art.drawPlayer(r=20, 与战斗内同一个渲染器与同一套立绘)
     *   · 武器   PS.Art.drawWeaponRing(与战斗内同一条环绕轨道), 用 PS.Characters 前 4 名的**起始武器**
     *   · 怪     PS.Art.drawEnemy(同一批烘焙精灵), 只用 spawnWave <= 4 的早期怪, 半径一律取数据真值
     * 关键几何: ground 的视口矩形必须**恰好等于**这条地面带 —— drawGround 的暗角按它自己的视口烘,
     *   视口与带子错位就会出现一条暗度突变的横痕。
     * 性能: 地面 1 次 drawGround + 主角 1 次 + 武器 4 次 + 怪 8×(影子+精灵) —— 都在同一帧里, 无烘焙抖动。 */
    menuStage: function (cx, gy) {
      var x = this.ctx, u = this.ui, W = u.W, H = u.H, A = PS.Art, i;
      var band = H - gy, bl = this.bleed, bw = W + bl.l + bl.r, bh = band + bl.t + bl.b;
      /* ---- 1) 地面带(只露一张地砖的内部: band < TILE=512, 不会出现平铺接缝) ---- */
      x.save();
      x.beginPath(); x.rect(-bl.l, gy - bl.t, bw, bh); x.clip();
      if (A && A.drawGround) {
        x.translate(0, gy);
        A.drawGround(x, { x: -bl.l, y: -bl.t, w: bw, h: bh }, B.WORLD, this.time);
        x.translate(0, -gy);
      } else {
        x.fillStyle = '#33441f';                 /* 兜底: 同 art.js palette.groundB */
        x.fillRect(-bl.l, gy - bl.t, bw, bh);
      }
      x.restore();
      /* ---- 2) 地平线雾: 上下**两头都淡出**(0 -> 0.82 -> 0), 峰值压在天地交接线上。
       *   第一版写成「上黑不透 -> 下透明」, 结果雾带自己成了一条新的硬边(它的上缘就是一条 alpha 突变的
       *   矩形边), 首屏截图里能直接看到那条横线。现在雾带上缘 alpha = 0(露出原背景, 不产生矩形边),
       *   在 gy 处最浓, 再向下 140px 化开 —— 读起来是「远处的地在阴影里」, 而不是「地被人切了一刀」。 */
      /* 峰值必须是"几乎全黑"(0.95), 不是 0.82: 地平线两侧的底色差异是**数量级**的(夜底 L 个位数 vs
       *   地面 L 20+), 留 18% 亮度差照样看得见一条台阶 —— 首屏实测截图就是这么发现的。 */
      var fog = x.createLinearGradient(0, gy - 80, 0, gy + 150);
      fog.addColorStop(0, 'rgba(7,11,7,0)');
      fog.addColorStop(0.20, 'rgba(7,11,7,0.52)');
      fog.addColorStop(0.35, 'rgba(7,11,7,0.95)');
      fog.addColorStop(0.62, 'rgba(7,11,7,0.34)');
      fog.addColorStop(1, 'rgba(7,11,7,0)');
      x.fillStyle = fog;
      x.fillRect(-bl.l, gy - 80 - bl.t, bw, 230 + bl.t);
      /* ---- 3) 站台光池: 只罩住主角脚下那一小块 ----
       * 旧版半径 470 + 一排怪 ⇒ 整条地面被"大聚光"照亮, 十几只怪在光里排成一列像舞台布景。
       * 现在怪全部退回背景墙, 光池收成主角脚下的一盏灯(半径 300), 中央只有一个视觉主体。 */
      var pool = x.createRadialGradient(cx, gy + 132, 24, cx, gy + 132, 300);
      pool.addColorStop(0, this.withA(T.gold, 0.16));
      pool.addColorStop(0.62, this.withA(T.gold, 0.05));
      pool.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = pool;
      x.fillRect(-bl.l, gy - 60 - bl.t, bw, bh + 60);
      /* 站台圆盘: 主角脚下那块**被照亮的圆形地面**。
         用椭圆裁切 + 径向渐变 ⇒ 读起来是"地面上一个光斑", 而不是"贴在屏幕上的一枚圆盘"
         (正圆的水平直径在斜俯视场景里会立刻出戏)。 */
      var disc = x.createRadialGradient(cx, gy + 132, 8, cx, gy + 132, 220);
      disc.addColorStop(0, this.withA(T.gold, 0.30));
      disc.addColorStop(0.5, this.withA(T.gold, 0.14));
      disc.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = disc;
      x.beginPath(); x.ellipse(cx, gy + 132, 300, 124, 0, 0, PS.TAU); x.fill();
      if (!A) return;
      var chars = (PS.Characters && PS.Characters.list) || [];
      var hero = chars[0] || null;
      var hx = cx, hy = gy + 132;
      /* ---- 4) 边缘探进来的怪: 左右**各一只**, 半身**被画布裁掉** ----
       * 原版地面上只站主角一个人, 怪只活在背景墙里。旧版把十只怪排成一列横带站在聚光中,
       *   读起来是"舞台布景", 而且它们和主角同层抢注意力 —— 这里只留画框边缘的两截剪影,
       *   作用是"怪物正从边上围过来", 不是"怪物在台上展览"。
       * [key, x(负数/超屏就会被画布自然裁掉), 相对主角的 dy, r]
       *   dy 取值让它们的**脚落在主角同一条地平线上**(不然看起来是漂在半空)。 */
      var FD = PS.EnemyData && PS.EnemyData.list;
      if (A.drawEnemy && FD) {
        /* 两只"从画框边缘探进来"的怪: 画框边缘现在是 -bl.l / W+bl.r(逻辑面之外还有溢出带), 
           所以它们必须跟着挪 —— 否则会从屏幕边上飘到溢出带中间, "半身被裁掉"的意图就没了。 */
        var EDGE_M = [['rockling', -bl.l - 6, 3, 24], ['soilheap', W + bl.r + 6, 5, 22]];
        for (i = 0; i < EDGE_M.length; i++) {
          var fd = FD[EDGE_M[i][0]];
          if (!fd) continue;
          var fx = EDGE_M[i][1], fy = hy + EDGE_M[i][2], fr = EDGE_M[i][3];
          x.fillStyle = 'rgba(0,0,0,0.30)';
          x.beginPath(); x.ellipse(fx, fy + fr * 0.9, fr * 0.92, fr * 0.32, 0, 0, PS.TAU); x.fill();
          A.drawEnemy(x, { x: fx, y: fy, r: fr, hp: 1, maxHp: 1, key: EDGE_M[i][0],
            ang: EDGE_M[i][1] > W / 2 ? Math.PI : 0 }, fd, this.time);
        }
      }
      /* ---- 5) 主角 + 环绕武器(与战斗内同一条轨道: 布局只取决于 p.x/p.y/p.r/p.aimAng) ---- */
      if (hero && A.drawPlayer) {
        var fp = { x: hx, y: hy, r: 28, moving: false, walkT: 0, aimAng: -0.55, char: hero };
        A.drawPlayer(x, fp, { char: hero }, this.time);
        if (A.drawWeaponRing) {
          var wl = [];
          for (i = 0; i < 4 && i < chars.length; i++) {
            var kk = chars[i].weapon;
            if (PS.WeaponData.list[kk]) wl.push({ key: kk, tier: (PS.WeaponData.list[kk].tier) || 1 });
          }
          A.drawWeaponRing(x, fp, this.time, { weapons: wl, orbitPhase: this.time * 0.55 });
        }
      }
    },

    /* 齿轮图标(纯矢量): 一个环 + 8 枚齿。
     * 刻意**不用**字体里的 U+2699 —— 小游戏端的字体缺字会画成豆腐块, 而这是战斗中唯一的退出入口。 */
    gearIcon: function (cx, cy, r, color) {
      var x = this.ctx, i;
      x.save();
      x.translate(cx, cy);
      x.fillStyle = color;
      for (i = 0; i < 8; i++) {
        x.save();
        x.rotate(i / 8 * PS.TAU);
        x.fillRect(-r * 0.15, -r, r * 0.30, r * 0.40);
        x.restore();
      }
      x.strokeStyle = color;
      x.lineWidth = Math.max(1.8, r * 0.32);
      x.beginPath(); x.arc(0, 0, r * 0.56, 0, PS.TAU); x.stroke();
      x.restore();
    },

    /* ---------- 设置按钮(战斗中, 右上角齿轮) ----------
     * 用户诉求: 「战斗过程中应该加入设置按钮, 方便退出到主菜单」。旧版没有任何暂停途径, 只能等死或刷新页面。
     * 位置: 中央胶囊(490..790)与右侧材料板(996..1264)之间的空档 944..988。
     * 纪律: 这里**只画矢量不写文字** —— HUD 那几条断言(文字不出板/不压按钮/位数改基线)全部基于 fillText
     *   的包围盒, 齿轮不 fillText 就不可能踩到它们。只在 PLAY 画并入表(暂停页自己有继续/退出)。 */
    drawSettingsButton: function () {
      var x = this.ctx, u = this.ui;   /* 与 HUD 同一坐标系(缩放的) */
      var L = this.hudLayout();
      var w = L.gearS || 44, h = L.gearS || 44, px = L.gearX, py = L.gearY;   /* 手机 40 / 桌面 44 */
      var on = this.hot(px, py, w, h);
      x.fillStyle = on ? this.withA(T.gold, 0.34) : 'rgba(13,19,13,0.90)';
      this.rr(px, py, w, h, 12); x.fill();
      x.strokeStyle = on ? T.gold : T.goldA;
      x.lineWidth = on ? 2.5 : 1.5;
      this.rr(px, py, w, h, 12); x.stroke();
      this.gearIcon(px + w / 2, py + h / 2, 10.5, on ? T.coin : T.hi);
      this.btnRects.push({ x: px, y: py, w: w, h: h, label: '设置' });
      this.buttons.push({
        x: px, y: py, w: w, h: h, id: 'hud-settings', label: '设置',
        cb: this.press(px, py, w, h, { cb: function () { PS.Game.pauseGame(); PS.Sound.play('click'); } })
      });
    },

    /* ================= 暂停页(战斗中按 Esc/P 或点右上角齿轮) =================
     * v6.0(UI 重做) 信息架构: 一条竖排的"你现在能做什么"——
     *   战绩摘要行(模式·波次·等级·击杀·材料) -> 「继 续 战 斗」 -> 「设 置」(声音开关, 常驻展开) ->
     *   「重新开始」 -> 「返回主菜单」。
     * 三条纪律(都不许动):
     *   ① 真冻结: 页面本身只画不推 —— 冻结由 core 的 `if (g.state !== PLAY) return` 保证;
     *   ② 返回主菜单必须**点得通**: id 固定 'pause-quit'(两步确认), 第一次点只切确认态 + 出现 'pause-cancel',
     *      第二次点才 quitToMenu —— qa/verify-pause.cjs 按 id 反查热区并真鼠标点两遍;
     *   ③ 「继续」id 固定 'pause-resume', 「重新开始」id 固定 'pause-restart'。 */
    drawPause: function () {
      var x = this.ctx, W = this.ui.W, H = this.ui.H, g = PS.Game;
      this.fillScreen('rgba(4,7,4,0.80)');
      var pw = 560, phh = 552, px = (W - pw) / 2, py = (H - phh) / 2;   /* 552: 设置面板多了一行帧率挡位 */
      this.plate(px, py, pw, phh, 18, 0.95, T.edge);
      this.text('暂 停', W / 2, py + 58, T.fs.hero, T.coin);
      var mo = B.MODES[g.mode] || { name: '远征' };
      this.fitText(mo.name + ' · ' + B.diffOf(g.diff).name + ' · 第 ' + g.wave + ' 波 · LV ' + g.level + ' · 击杀 ' + g.kills
        + ' · 材料 ★ ' + g.material, W / 2, py + 94, pw - 72, T.fs.small, T.mid, 'center', false, 10.5);
      this.button(px + 36, py + 114, pw - 72, 62, '继 续 战 斗', {
        size: T.fs.lead, bg: this.withA(T.pos, 0.22), hoverBg: this.withA(T.pos, 0.34),
        border: this.withA(T.pos, 0.7), hoverBorder: T.pos, id: 'pause-resume',
        sub: '回到第 ' + g.wave + ' 波(Esc / P 同效)',
        cb: function () { PS.Game.resumeGame(); PS.Sound.play('click'); }
      });
      /* 「设 置」: 声音开关常驻展开 —— 不做折叠, 免得按钮位置随开合跳动(触屏最烦这个) */
      this.gearIcon(px + 44, py + 186, 8, T.gold);
      this.text('设 置 · 声音 / 帧率', px + 60, py + 190, T.fs.small, T.gold, 'left');
      this.audioPanel(px + 36, py + 200, pw - 72);
      this.button(px + 36, py + 390, 236, 56, '重新开始', {
        size: T.fs.lead, bg: 'rgba(255,255,255,0.06)', hoverBg: 'rgba(255,255,255,0.14)',
        border: T.weak, hoverBorder: T.gold, id: 'pause-restart',
        cb: function () {
          var cid = (g.char && g.char.id) || g.pendingChar || 'popo';
          PS.Game.newRun(cid, g.mode || 'standard');
          PS.Sound.play('click');
        }
      });
      this.fitText('同角色同模式从第 1 波重开(本局进度作废)',
        px + 288, py + 422, 236, T.fs.micro, T.low, 'left', false, 9.5);
      if (g.pauseConfirm) {
        this.button(px + 36, py + 454, 236, 56, '确认退出', {
          size: T.fs.lead, bg: this.withA(T.danger, 0.26), hoverBg: this.withA(T.danger, 0.40),
          border: this.withA(T.danger, 0.8), hoverBorder: T.danger, id: 'pause-quit',
          cb: function () { PS.Game.quitToMenu(); }
        });
        this.button(px + 288, py + 454, 236, 56, '取 消', {
          size: T.fs.lead, bg: 'rgba(255,255,255,0.06)', hoverBg: 'rgba(255,255,255,0.14)',
          border: T.weak, hoverBorder: T.gold, id: 'pause-cancel',
          cb: function () { PS.Game.pauseConfirm = false; PS.Sound.play('click'); }
        });
        this.text('退出后本局作废, 不计入战绩', W / 2, py + 534, T.fs.micro, T.low, 'center', false);
      } else {
        this.button(px + 36, py + 454, pw - 72, 56, '返回主菜单', {
          size: T.fs.lead, bg: 'rgba(255,255,255,0.06)', hoverBg: 'rgba(255,255,255,0.14)',
          border: T.weak, hoverBorder: T.gold, id: 'pause-quit',
          cb: function () { PS.Game.pauseConfirm = true; PS.Sound.play('click'); }
        });
        this.text('战斗中按 Esc / P 也可随时暂停或继续', W / 2, py + 534, T.fs.micro, T.low, 'center', false);
      }
    },

    /* ================= 主菜单 / 封面 =================
     * v6.0(用户原话「封面照原版设计」): 只借鉴**信息架构与构图**, 不复制任何美术/字体/文案:
     *   · 大标题居中偏上(本作自有字形与配色);
     *   · 背景一整层**本作怪物**的暗色剪影墙(见 menuWall: 形状全部来自 PS.Art.drawEnemy 的真精灵);
     *   · 中央站着本作主角(番茄 popo)和被照亮的地面(见 menuStage: 真地形 + 真武器环);
     *   · 左侧竖排主菜单 / 右侧竖排次要项 / 右下角版本号;
     *   · **只画能真接线的入口**: 启程 / 图鉴 / 制作人名单 / 音效 / 音乐。
     *     原版右侧那些 MOD / DLC / 社区 / 新消息在本作不存在, 一律不做(假按钮比没有按钮更糟)。
     *     原版的「继续」也不做 —— src/core/save.js 只存战绩(best/wins/runs/…), 没有任何"进行中一局"的
     *     快照, 接不了线; 要真做得先在 core 侧加快照存档(不在本文件写权内)。
     * 门禁依赖(不许改): 「启 程」按钮的 label 与**中心点**必须可点 —— tools/verify-ui.cjs M1 按 label
     *   反查热区后点它的中心, 断言状态推进到 MODE。位置/尺寸可改, label 与可点性不可改。 */

    drawMenu: function () {
      var x = this.ctx, u = this.ui, W = u.W, H = u.H, cx = W / 2;
      var sv = PS.Save.data || {};
      /* 三层底: 夜底 + 金雾 → 满屏怪物剪影墙 → 打光地面 + 主角 + 环绕武器(全部来自 PS.Art 与数据表) */
      this.menuBackdrop(cx, 250);
      this.menuWall();
      this.menuStage(cx, 470);
      /* 大标题: 居中偏上 */
      this.text('蔬 菜 幸 存 者', cx, 112, T.fs.brand, T.hi);
      x.fillStyle = this.withA(T.gold, 0.85);
      x.fillRect(cx - 150, 132, 300, 3);
      /* 图鉴 / 制作人名单一开就**整块替换菜单体**: 覆盖层底下不许再留可点热区,
         否则点在遮罩上会顺带把「启 程」触发掉(点了没反应 / 点错地方的同类病灶)。 */
      if (this.dex && this.dex.open) { this.drawDex(); return; }
      if (this.credits && this.credits.open) { this.drawCredits(); return; }
      /* 左列: 主菜单(竖排) */
      /* 左列: 主菜单**竖排列表**(对齐原版封面的信息架构: 等高行 + 当前项浅色块高亮)。
         宽度收到 200 —— 原版那一列只占屏宽 ~12%, 用宽卡片会把"列表"读成"卡片阵列"。
         只放 3 项: 本作真的只有这三个入口; 为了凑满一列去造假按钮是另一张脸的同一种错。 */
      var LX = 48, LW = 200, RH = 52, GAP = 6, LY = 292;
      this.button(LX, LY, LW, RH, '启 程', {
        size: 18, align: 'left', padX: 22, lw: 2.5,
        bg: T.hi, hoverBg: '#fffaee',
        border: 'rgba(8,12,8,0.80)', hoverBorder: T.gold, color: T.onGold,
        cb: function () { PS.Game.setState(PS.State.MODE); PS.Sound.play('click'); }
      });
      this.button(LX, LY + (RH + GAP), LW, RH, '图 鉴', {
        size: 17, align: 'left', padX: 22,
        bg: 'rgba(9,14,9,0.74)', hoverBg: this.withA(T.gold, 0.20),
        border: T.edge, hoverBorder: T.gold,
        cb: function () { PS.UI.dex.open = true; PS.UI.dex.page = 0; PS.Sound.play('click'); }
      });
      this.button(LX, LY + 2 * (RH + GAP), LW, RH, '制 作 人 名 单', {
        size: 17, align: 'left', padX: 22,
        bg: 'rgba(9,14,9,0.74)', hoverBg: this.withA(T.gold, 0.20),
        border: T.edge, hoverBorder: T.gold,
        cb: function () { PS.UI.credits.open = true; PS.Sound.play('click'); }
      });
      /* 右列: 次要项 = 声音开关(无边框竖排文字 + 小开关, 见 audioRows)。
         id 固定 audio-sfx / audio-bgm, 门禁与微信自检按 id 断言。 */
      this.audioPanel(W - 48 - 200, 292, 200, { plain: true });
      /* 右下: 存档战绩 + 版本号。真数据 + 只读 —— 不是按钮就不入热区表(没热区的文字不会骗人点它) */
      this.text('最佳 第 ' + (sv.best || 0) + ' 波 · 通关 ' + (sv.wins || 0) + ' 次 · 出战 ' + (sv.runs || 0) + ' 局',
        W - 40, 676, T.fs.small, T.hi, 'right', false);
      this.text('v' + (PS.VERSION || '2.0.0'), W - 40, 700, T.fs.small, T.low, 'right', false);
    },

    /* ================= 封面入口: 图鉴(只读) =================
     * 三个页签(道具 / 武器 / 怪物) + 翻页 + 返回 —— 六颗按钮**全部真接线**;
     * 面板里没有"看着像按钮"的东西, 网格格也**不调 hot()**(有高亮却不入热区表 = 看着能点实际点不到,
     *   正是 qa/hitmap-probe.cjs 的 Q1)。
     * 每格内容现算自真数据表, 一个数字都不编: 武器 = 近战/远程 + 阶 + 伤害 + 冷却 + 自带暴击倍率;
     *   道具 = 稀有度 + 真实词条(与商店卡共用 STAT_NAME / STAT_PCT 同一张表);
     *   怪物 = 出场档位/波次 + 生命成长 + 伤害 + 速度, 图标走 PS.Art.drawEnemy 的真精灵。
     * 状态在 PS.UI.dex 里 —— 仍然是 MENU 状态, 不碰 core, 也不新增任何游戏数值。 */
    DEX_TAB: [['item', '道具'], ['weapon', '武器'], ['enemy', '怪物']],
    DEX_ROWS: 4,
    /* v5.17(Codex, 2026-09-28): **道具页单独用 3 行** —— 一格的可用高度由 99px 变成 134.7px,
     *   才装得下「标题行 + 4 条效果行」(首行 +47、行距 17 ⇒ 第 5 行基线 +115 < 134.7)。
     *   为什么非要加高: 见 dexFact 的事故注释 —— 5 行容量是「任何一格都至少能显示一条收益」的几何前提。
     *   武器/怪物仍是 4 行(它们各只有 3 行事实, 不需要更高)。 */
    dexRows: function (tab) { return tab === 'item' ? 3 : this.DEX_ROWS; },
    DEX_GRID_H: 420,          /* 网格区高度(drawDex 用) —— 门禁据此复算一格高度, 不许两处各写一个数 */
    DEX_GAP_Y: 8,
    /* 怪物页要写「生命 +N/波 / 伤害 +N/波 / 速度」三行事实, 格子放宽到 4 列; 道具/武器仍 5 列 */
    dexCols: function (tab) { return tab === 'enemy' ? 4 : 5; },
    dexPageSize: function (tab) { return this.dexCols(tab) * this.dexRows(tab); },

    /* 图鉴条目表(按页签现算, 排序确定)。缓存键含**数据表规模** —— verify-ui 注入压测道具时自动重建。 */
    dexList: function (tab) {
      var WL = PS.WeaponData && PS.WeaponData.list, IL = PS.ItemData && PS.ItemData.list;
      var EL = PS.EnemyData && PS.EnemyData.list;
      var sig = tab + '|' + (IL ? IL.length : 0) + '|' + (WL ? Object.keys(WL).length : 0);
      if (this.dexCache && this.dexCache.sig === sig) return this.dexCache.list;
      var out = [], k, d, i;
      if (tab === 'weapon') {
        for (k in WL) { d = WL[k]; if (!d || d.aux || !d.name) continue; out.push({ key: k, def: d, name: d.name }); }
        out.sort(function (a, b) { return (a.def.tier || 1) - (b.def.tier || 1) || (a.name < b.name ? -1 : 1); });
      } else if (tab === 'enemy') {
        for (k in EL) { d = EL[k]; if (!d || !d.name) continue; out.push({ key: k, def: d, name: d.name }); }
        out.sort(function (a, b) { return (a.def.spawnWave || 0) - (b.def.spawnWave || 0) || (a.name < b.name ? -1 : 1); });
      } else {
        for (i = 0; IL && i < IL.length; i++) {
          d = IL[i];
          /* pool:false = 源里没有永久词条、本作未上架(见 src/data/items.js 勘误) —— 商店买不到的不进图鉴 */
          if (!d || !d.name || d.pool === false) continue;
          out.push({ key: d.id, def: d, name: d.name });
        }
        out.sort(function (a, b) { return (a.def.rarity || 0) - (b.def.rarity || 0) || (a.name < b.name ? -1 : 1); });
      }
      this.dexCache = { sig: sig, list: out };
      return out;
    },

    /* 图鉴条目总数。dexList 会顺手刷新缓存 —— 这里取完数就把缓存还原, 免得外部调用(制作人名单)打乱图鉴当前页签 */
    dexTotal: function (tab) {
      var keep = this.dexCache, n = this.dexList(tab).length;
      this.dexCache = keep;
      return n;
    },

    /* 图鉴一格的强调色(底板描边 + 首行文字用同一个色 —— 两处不许各算一遍) */
    dexAccent: function (tab, d) {
      if (tab === 'item') return (RARITY[d.rarity] || RARITY[1]).c;
      if (tab === 'enemy') return d.boss ? T.r[3] : (d.elite ? T.r[2] : T.r[0]);
      return T.r[(d.tier || 1) - 1] || T.r[0];
    },

    /* 图鉴一格的事实行(现算, 返回 [{t: 文本, c: 颜色}]) —— 缺字段一律显「—」, 绝不印 undefined / NaN。
     * v5.17(Codex, 2026-09-28) 事故(用户第 4 次投诉, 逐字「还有道具，我又发现了纯负面道具」, 附第 5/7 页图鉴截图):
     *   商店卡在 v5.12 就走 itemEffectRows 的五路出口了, 而**图鉴这一格**还停在更早的口径 ——
     *   ① 只列 mods, trig/scale/cond 一条不画(怪书 / 智囊书 / 石皮 / 邻里帮工 / 石像 / 小仙灵 的收益**全在**那三路);
     *   ② 只画前 2 条、且按字段顺序 —— 礼帽的 mods 顺序恰好把两条负词条排在最前, 「运气 +15 / 采集 +18」被截掉。
     *   131 件在售里 **65 件**因此被截, 其中 6 件在格子里读起来就是纯负面(测量: work/dex-item-probe.json)。
     * 修法与卡面**同源**: 效果行一律取 itemEffectRows(唯一出口), 容量走 rowLayout 同一条等式
     *   (画出的 + 告知的 == 总条数) —— 于是「纯负面」在机制上不再可能, 除非这件道具真的零收益,
     *   而那件事由 qa/verify-item-sign.cjs 判死(在售件必须有 >= 1 条正收益)。
     * 判据由 qa/verify-item-card.cjs 的 [F] 组守(逐件断言 + 负向对照 --break=dex)。 */
    dexFact: function (tab, d) {
      var out = [], i, rc = this.dexAccent(tab, d);
      var num = function (v) { return (typeof v === 'number' && isFinite(v)) ? v : '—'; };
      if (tab === 'weapon') {
        var TIERN = (PS.WeaponData && PS.WeaponData.tierName) || ['I', 'II', 'III', 'IV'];
        var cm = this.critMulOf(d);
        out.push({ t: (d.cls === 'melee' ? '近战' : '远程') + ' ' + (TIERN[(d.tier || 1) - 1] || '') +
          (cm !== null ? ' · 暴击 ×' + this.fmtMul(cm) : ''), c: rc });
        var cd = (typeof d.atkCd === 'number' && isFinite(d.atkCd)) ? (Math.round(d.atkCd * 100) / 100) + 's' : '—';
        out.push({ t: '伤害 ' + num(d.dmg) + ' · 冷却 ' + cd, c: T.mid });
        out.push({ t: '射程 ' + num(d.range) + ' · 击退 ' + num(d.knock), c: T.mid });
      } else if (tab === 'enemy') {
        out.push({ t: (d.boss ? 'Boss' : (d.elite ? '精英' : '普通')) + ' · 第 ' + num(d.spawnWave) + ' 波起' +
          (d.endlessOnly ? ' · 仅无尽' : ''), c: rc });
        /* 生命/伤害都按源公式 base + W*(波次-1) 的**两个参数**原样给 —— 面板里不出现"随波次变的那个数" */
        out.push({ t: '生命 ' + num(d.hp) + ' +' + num(d.hpW) + '/波', c: T.mid });
        out.push({ t: '伤害 ' + num(d.dmg) + ' +' + num(d.dmgW) + '/波 · 速度 ' + num(d.spd), c: T.mid });
      } else {
        var rows = this.itemEffectRows(d), lay = this.rowLayout(rows, this.DEX_ITEM_ROW_CAP);
        out.push({ t: ((RARITY[d.rarity] || RARITY[1]).n) + ' · 效果 ' + lay.total + ' 条', c: rc });
        for (i = 0; i < lay.shown; i++) out.push({ t: rows[i].t, c: rows[i].c });
        if (lay.announcement) out.push({ t: lay.announcement, c: T.low });
        return out;              /* 已按容量裁好(且带告知), 不再 slice —— slice 会静默吃掉那句告知 */
      }
      return out.slice(0, 3);
    },

    /* 图鉴的一格(底板 + 图标 + 名称 + 两行事实)。纯只读: 不调 hot(), 不入热区表。 */
    /* 图鉴的一格(底板 + 图标 + 名称 + 最多三行事实)。纯只读: 不调 hot(), 不入热区表。 */
    dexCell: function (px, py, w, h, tab, e) {
      var x = this.ctx, d = e.def, f = this.dexFact(tab, d), i;
      var rc = this.dexAccent(tab, d);
      this.plate(px, py, w, h, 10, 0.42, this.withA(rc, 0.55));
      /* 图标位: 三样都走既有接口 —— 武器真模型 / 道具族模型 / 怪物真精灵 */
      if (tab === 'weapon') this.weaponIcon(e.key, px + 30, py + h / 2, 18, { tier: d.tier, def: d, rot: -0.3 });
      else if (tab === 'item') this.itemIcon(d, px + 30, py + h / 2, 18);
      else if (PS.Art && PS.Art.drawEnemy) {
        PS.Art.drawEnemy(x, { x: px + 30, y: py + h / 2 + 4, r: 13, hp: 1, maxHp: 1, key: e.key, ang: 0 }, d, this.time);
      }
      var tx = px + 54, tw = w - 62;
      this.fitText(e.name, tx, py + 28, tw, T.fs.body, T.hi, 'left', true, T.fs.small);
      for (i = 0; i < f.length; i++) {
        this.fitText(f[i].t, tx, py + 47 + i * 17, tw, T.fs.micro, f[i].c || rc, 'left', false, 9);
      }
    },

    drawDex: function () {
      var x = this.ctx, u = this.ui, W = u.W, H = u.H, i;
      var px = 40, py = 30, pw = W - 80, ph = H - 60;
      this.fillScreen(OVL);
      var list = this.dexList(this.dex.tab);
      var per = this.dexPageSize(this.dex.tab);
      var pages = Math.max(1, Math.ceil(list.length / per));
      if (this.dex.page > pages - 1) this.dex.page = pages - 1;
      if (this.dex.page < 0) this.dex.page = 0;
      /* 规模统计放在**面板内** —— 用户口径「菜单只留按钮文字」, 原版封面按钮下方也没有副标题 */
      this.panel(px, py, pw, ph, { fill: 'rgba(11,16,11,0.99)', title: '图 鉴',
        note: '道具 ' + this.dexTotal('item') + ' · 武器 ' + this.dexTotal('weapon') +
          ' · 怪物 ' + this.dexTotal('enemy') + ' · 全部取自本作数据表' });
      /* 页签 */
      var tabs = this.DEX_TAB, tp;
      for (i = 0; i < tabs.length; i++) {
        tp = tabs[i];
        var on = this.dex.tab === tp[0];
        this.button(px + 16 + i * 152, py + 44, 140, 44, tp[1], {
          size: T.fs.lead, id: 'dex-tab-' + tp[0],
          bg: on ? this.withA(T.gold, 0.30) : 'rgba(255,255,255,0.05)',
          hoverBg: on ? this.withA(T.gold, 0.38) : 'rgba(255,255,255,0.13)',
          border: on ? T.gold : T.weak, hoverBorder: T.gold,
          cb: (function (tid) {
            return function () {
              if (PS.UI.dex.tab !== tid) { PS.UI.dex.tab = tid; PS.UI.dex.page = 0; }
              PS.Sound.play('click');
            };
          })(tp[0])
        });
      }
      this.text('共 ' + list.length + ' 项', px + pw - 16, py + 72, T.fs.small, T.mid, 'right', false);
      /* 网格: 只读格不调 hot() */
      var gx = px + 20, gym = py + 130, gw = pw - 40, gh = this.DEX_GRID_H;
      var cols = this.dexCols(this.dex.tab), rows = this.dexRows(this.dex.tab), gapx = 14, gapy = this.DEX_GAP_Y;
      var cw = (gw - (cols - 1) * gapx) / cols, chh = (gh - (rows - 1) * gapy) / rows;
      var from = this.dex.page * per;
      for (i = 0; i < per; i++) {
        var e = list[from + i];
        if (!e) break;
        var col = i % cols, rowi = (i / cols) | 0;
        this.dexCell(gx + col * (cw + gapx), gym + rowi * (chh + gapy), cw, chh, this.dex.tab, e);
      }
      /* 翻页 + 返回 */
      var canPrev = this.dex.page > 0, canNext = this.dex.page < pages - 1;
      var byy = py + ph - 60;
      this.button(px + 20, byy, 130, 44, '上一页', {
        id: 'dex-prev', size: T.fs.body, disabled: !canPrev,
        bg: 'rgba(255,255,255,0.05)', hoverBg: 'rgba(255,255,255,0.13)',
        border: T.weak, hoverBorder: T.gold,
        cb: function () { if (PS.UI.dex.page > 0) { PS.UI.dex.page--; PS.Sound.play('click'); } }
      });
      this.button(px + 160, byy, 130, 44, '下一页', {
        id: 'dex-next', size: T.fs.body, disabled: !canNext,
        bg: 'rgba(255,255,255,0.05)', hoverBg: 'rgba(255,255,255,0.13)',
        border: T.weak, hoverBorder: T.gold,
        cb: function () { PS.UI.dex.page++; PS.Sound.play('click'); }
      });
      this.text('第 ' + (this.dex.page + 1) + ' / ' + pages + ' 页', px + 310, byy + 27, T.fs.body, T.mid, 'left', false);
      this.button(px + pw - 150, byy, 130, 44, '返 回', {
        id: 'dex-close', size: T.fs.lead,
        bg: this.withA(T.gold, 0.20), hoverBg: this.withA(T.gold, 0.34),
        cb: function () { PS.UI.dex.open = false; PS.Sound.play('click'); }
      });
    },

    /* ================= 封面入口: 制作人名单(只读信息板) =================
     * 按用户口径「只做能真接线的按钮」: 这里只有一块只读信息板 + 一颗返回。
     * 文案全部原创且**可核对**: 内容规模现算自数据表; 美术是程序化矢量(art.js, 仓库零位图素材);
     *   音效/音乐是运行时 createOscillator 程序合成(src/ui/audio-veg.js / music.js, 无采样文件)。 */
    drawCredits: function () {
      var x = this.ctx, u = this.ui, W = u.W, H = u.H;
      this.fillScreen(OVL);
      var pw = 720, ph = 470, px = (W - pw) / 2, py = (H - ph) / 2;
      this.panel(px, py, pw, ph, { fill: 'rgba(11,16,11,0.99)', title: '制 作 人 名 单' });
      var CW = pw - 64, cx = px + 32, y = py + 62, i;
      /* 与图鉴同口径(dexTotal): 同一份数据不能在两块面板里报出两个数 */
      var nW = this.dexTotal('weapon');
      var nI = this.dexTotal('item');
      var nE = this.dexTotal('enemy');
      var nC = PS.Characters && PS.Characters.list ? PS.Characters.list.length : 0;
      var nS = PS.SetData && PS.SetData.list ? Object.keys(PS.SetData.list).length : 0;
      var LINES = [
        ['蔬菜幸存者 v' + (PS.VERSION || '2.0.0'), T.hi, true],
        ['一个非营利的个人练手项目 · HTML5 Canvas, 浏览器与微信小游戏双端', T.mid, false],
        ['', T.low, false],
        ['设计 · 程序 · 美术', T.gold, true],
        ['全部为程序化矢量绘制(零外部位图素材): 怪物 / 武器 / 道具的造型都由几何图元现画。', T.mid, false],
        ['音效 · 音乐', T.gold, true],
        ['运行时用振荡器程序合成, 不含任何采样文件; 曲目随菜单 / 战斗 / Boss 切换。', T.mid, false],
        ['内容规模', T.gold, true],
        ['武器 ' + nW + ' · 道具 ' + nI + ' · 怪物 ' + nE + ' · 角色 ' + nC + ' · 武器羁绊 ' + nS, T.pos, false],
        ['玩法传统', T.gold, true],
        ['属幸存者类(自动攻击 · 波次生存 · 波间购物); 玩法类型是公共传统, 本作的美术 / 文案 / 代码全部原创。', T.mid, false],
        ['', T.low, false],
        ['感谢每一位试玩并留下意见的玩家。', T.hi, true]
      ];
      for (i = 0; i < LINES.length; i++) {
        if (!LINES[i][0]) { y += 10; continue; }
        this.fitText(LINES[i][0], cx, y, CW, LINES[i][2] ? T.fs.body : T.fs.small, LINES[i][1], 'left', LINES[i][2], 10);
        y += LINES[i][2] ? 26 : 19;
      }
      this.button(px + pw / 2 - 90, py + ph - 62, 180, 44, '返 回', {
        id: 'credits-close', size: T.fs.lead,
        bg: this.withA(T.gold, 0.20), hoverBg: this.withA(T.gold, 0.34),
        cb: function () { PS.UI.credits.open = false; PS.Sound.play('click'); }
      });
    },

    /* ================= 模式选择 ================= */
    drawModeSelect: function () {
      var x = this.ctx, u = this.ui, W = u.W, g = PS.Game;
      var save = PS.Save.data || {};
      this.backdrop(W / 2, 200);
      this.text('选择远征模式', W / 2, 40, T.fs.title, T.coin);
      /* v8.3(用户 2026-10-08「和原版游戏一样有好多种难度挡位 ... 做3挡, 简单, 中等, 困难」):
       *   这一行是**挡位**, 下面三张卡是**模式** —— 3x3 = 9 种开局。挡位只乘敌人 hp/dmg/spd
       *   (balance.js::B.DIFFS), 刷怪量与掉落一个字都不改 => 不会把「卡顿/材料爆」按原样引回来。 */
      var dkeys = B.DIFFS_ORDER, dk;
      if (!B.DIFFS[g.pendingDiff]) g.pendingDiff = 'easy';
      var DCOL = { easy: T.pos, normal: T.luck, hard: T.neg };
      var dh = 34, dgap = 12, dw = 180, dy = 62;
      var dsx = (W - (dkeys.length * dw + (dkeys.length - 1) * dgap)) / 2;
      for (dk = 0; dk < dkeys.length; dk++) {
        var dkey = dkeys[dk], dsel = g.pendingDiff === dkey, dcol = DCOL[dkey] || T.gold;
        /* 挡位是**选择**不是**进入** —— 点了只换选中的那一挡, 不跳页(与三张模式卡分工明确)。 */
        this.button(dsx + dk * (dw + dgap), dy, dw, dh, B.DIFFS[dkey].name, {
          size: T.fs.body, id: 'diff-' + dkey,
          bg: dsel ? this.withA(dcol, 0.26) : 'rgba(13,19,13,0.72)',
          hoverBg: this.withA(dcol, 0.34),
          border: dsel ? dcol : T.weak, hoverBorder: dcol,
          color: dsel ? T.hi : T.mid,
          cb: (function (k) { return function () { PS.Game.pendingDiff = k; PS.Sound.play('click'); }; })(dkey)
        });
      }
      var dcur = B.diffOf(g.pendingDiff);
      this.fitText('难度 ' + dcur.name + ' · ' + dcur.desc, W / 2, dy + dh + 22, W - 240, T.fs.small,
        DCOL[g.pendingDiff] || T.gold, 'center', false, 10);
      var keys = Object.keys(B.MODES);
      var MODE_COL = { standard: T.gold, endless: T.r[2], rush: T.neg };
      /* 卡区下移 30 给挡位让位(chh 500->470 把底边钉回原来的 604, 所有卡内锚点相对 chh, 一个都不用改) */
      var cw = 340, chh = 470, gap = 26, py = 134;
      var sx = (W - (keys.length * cw + (keys.length - 1) * gap)) / 2;
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i], m = B.MODES[key];
        var col = MODE_COL[key] || T.gold;
        var px = sx + i * (cw + gap);
        var hot = this.hot(px, py, cw, chh);
        var enter = (function (mk) {
          return function () { PS.Game.pendingMode = mk; PS.Game.setState(PS.State.CHAR); PS.Sound.play('click'); };
        })(key);
        /* 整卡热区先入 → 卡内按钮后入(dispatchTap 从后往前取, 按钮优先) */
        this.buttons.push({ x: px, y: py, w: cw, h: chh, label: '模式:' + m.name, cb: this.press(px, py, cw, chh, { cb: enter }) });
        x.fillStyle = hot ? this.withA(col, 0.14) : 'rgba(13,19,13,0.88)';
        this.rr(px, py, cw, chh, 16); x.fill();
        x.strokeStyle = hot ? col : T.edge;
        x.lineWidth = hot ? 3 : 1.5;
        this.rr(px, py, cw, chh, 16); x.stroke();
        /* 顶部色带 + 名称 */
        this.ribbon(px, py, cw, 34, col, 16);
        this.text(m.name, px + cw / 2, py + 22, T.fs.body, T.onGold);
        this.text(m.noWin ? '无 尽 波 次' : (m.waves + ' 波 远 征'), px + cw / 2, py + 92, T.fs.num, T.hi);
        x.fillStyle = T.mid;
        x.font = T.fs.small + 'px ' + u.font;
        x.textAlign = 'center';
        /* v8.3: wrapText 的新口径是「px = 绘制原点」(居中由上面的 textAlign 决定) => 传卡心。 */
        this.wrapText(m.desc, px + cw / 2, py + 122, cw - 52, 20, 2, true);
        var dur = B.waveDuration(1, key);
        var rows = [
          ['波  数', m.noWin ? '无 限' : m.waves + ' 波', T.hi],
          ['每波时长', dur + ' 秒', dur <= 36 ? col : T.mid],
          ['材料倍率', '×' + m.matMul.toFixed(2), m.matMul > 1 ? col : T.mid],
          ['敌人成长', key === 'rush' ? '每波按 2 波推进' : '标准曲线', key === 'rush' ? col : T.low]
        ];
        var ty = py + 186;
        for (var r = 0; r < rows.length; r++) {
          var ry = ty + r * 38;
          x.fillStyle = 'rgba(7,11,7,0.55)';
          this.rr(px + 22, ry - 15, cw - 44, 30, 8); x.fill();
          this.text(rows[r][0], px + 34, ry + 5, T.fs.small, T.mid, 'left', false);
          this.text(rows[r][1], px + cw - 34, ry + 5, T.fs.body, rows[r][2], 'right');
        }
        var rec = key === 'endless'
          ? ('最深纪录 ' + (save.endlessBest || 0) + ' 波')
          : ('通关 ' + (((save.modeWins || {})[key]) || 0) + ' 次');
        this.text(rec, px + cw / 2, py + chh - 104, T.fs.small, T.low, 'center', false);
        /* CTA 走块面口径: 深底板 + 模式色描边(旧版是模式色 22% 填充, 金色那档会糊成芥末酱) */
        this.button(px + 40, py + chh - 76, cw - 80, 52, '进 入', {
          size: 17, bg: 'rgba(9,14,9,0.80)', hoverBg: this.withA(col, 0.26),
          border: this.withA(col, 0.85), hoverBorder: col, cb: enter
        });
      }
      this.button(24, 24, 112, 48, '‹ 返回', {
        size: T.fs.body, bg: 'rgba(255,255,255,0.06)', hoverBg: 'rgba(255,255,255,0.14)',
        border: T.weak, hoverBorder: T.gold,
        cb: function () { PS.Game.setState(PS.State.MENU); PS.Sound.play('click'); }
      });
    },

    /* ================= 初始武器候选池(源 startingWeapons) =================
     * 用户 2026-09-30 报:「选择学徒葱开局, 初始武器会随机变化, 试了几次每次武器都不一样」。
     * 根因(实读源码, 不是猜测): core/game.js 的 newRun 里写的是**无条件抽签**
     *   `var iwKey = iwPool[(Math.random() * iwPool.length) | 0];`。
     * 而源里 startingWeapons 是**候选池**, 选哪一把由**玩家点**: ui/menus/run/weapon_selection.gd 的
     *   _on_element_pressed 取玩家点中的那一格; 池里另有一枚 is_random 的「?」格子
     *   (`element.is_random → Utils.get_rand_element`) —— 「随机」在源里是玩家**显式选中**的一项,
     *   而不是默认行为。本作把那个界面收进这一条底栏: 池 > 1 件时才出现「初始武器 ‹ … ›」,
     默认 = 池里的**默认档**(PS.Characters.defaultStartIdx, 不选时实际到手的那件);
     「随机」是玩家自己按到最后一档才会发生的事。
     v7.5: 有池的是 engineer(4) / apprentice(22) / cyborg(8), 其余 17 名是单件(选择器整条不画)。
     engineer 与 cyborg 另外还有角色 effect 给的**保底起手武器**(startWeapons, 开局必在武器栏里):
     那时卡面画的是**保底那一件**(与源角色面板 character_panel_ui.gd:174-191 同口径), 这条选择器
     选的是**额外那一件**, 所以改叫「另选武器」—— 两件并列叠加, 谁也不冒充谁。
     * 选择按角色分开记(charId -> 选项下标), 翻页/换卡都不会互相串。 */
    /* v7.5: 角色 effect 给的**保底起手武器**(开局必在武器栏里, 与源角色面板展示的是同一件); 没有则 null。
     *   只认数据表里真实存在的 key(canon 归一后再查), 查不到就当没有 —— 不许在卡面上画一件发不出来的武器。 */
    startGuarKey: function (chd) {
      var g0 = (chd && chd.startWeapons && chd.startWeapons.length) ? chd.startWeapons[0] : null;
      if (!g0) return null;
      var k = PS.WeaponData.canon ? PS.WeaponData.canon(g0) : g0;
      return PS.WeaponData.list[k] ? k : null;
    },
    _startOptN: function (chd) {
      return (chd && chd.weaponPool && chd.weaponPool.length > 1) ? chd.weaponPool.length + 1 : 0;
    },
    _startPickOf: function (chd) {
      if (!this._startPick) this._startPick = {};
      var n = this._startOptN(chd), i = this._startPick[chd.id];
      /* v7.6: 首次落到这一档时, 默认 = **池里的默认档**(与 core 的兜底档同一个函数) ——
       *   不再是死板的 0 号格。19 名角色上两者相同, 只有铁皮冬瓜会跳到第一件远程:
       *   它的池首 3 件是近战而它自己 gain 把 meleeDmg 归零, 不碰选择器直接出发就是拿到一个永远不长的格子。 */
      if (typeof i !== 'number' || i < 0 || i >= n) {
        i = PS.Characters.defaultStartIdx ? PS.Characters.defaultStartIdx(chd) : 0;
        if (i < 0) i = 0;
        this._startPick[chd.id] = i;
      }
      return i;
    },
    /* 这一档实际会用到的武器 key; null = 选中了末档「随机」 */
    startWeaponKey: function (chd) {
      if (!this._startOptN(chd)) return chd.weapon;
      var i = this._startPickOf(chd);
      return i >= chd.weaponPool.length ? null : chd.weaponPool[i];
    },
    startWeaponName: function (chd) {
      var k = this.startWeaponKey(chd);
      if (k === null) return '随机一件';
      var d = PS.WeaponData.list[k];
      return (d && d.name) || k;
    },
    /* 「出 发」递给 newRun 的第三参; 单件角色给 null(= 用 characters.js 的 weapon) */
    startWeaponOpt: function (chd) {
      if (!this._startOptN(chd)) return null;
      var k = this.startWeaponKey(chd);
      return k === null ? { randomStart: true } : { weapon: k };
    },
    cycleStartWeapon: function (chd, dir) {
      var n = this._startOptN(chd);
      if (!n) return;
      this._startPick[chd.id] = (this._startPickOf(chd) + dir + n) % n;
    },

    /* ================= 选人(横屏 4×2) =================
     * v6.0(UI 重做) 信息架构: 「一屏横比 8 名蔬菜」——
     *   每张卡自上而下 = 名字带(角色色) / 立绘 + 生命 + 初始武器 / 一句描述 / 「特 性」逐条列表 / 选择按钮。
     *   为什么把特性写进卡里、不做"选中才展开的详情栏": 4×2 网格已经占满 1280×720, 再切一栏详情就必须
     *     把卡宽压到 1/5 屏以下, 一屏可见角色从 8 掉到 4 —— 比较 8 个人的代价反而变高。
     *     现在 8 名角色的词条全部同屏逐条可读(正绿负红), 选中的那张金边 + 角标 + 按钮变体三重反馈。
     * 门禁契约(不许改):
     *   · 整卡热区 label='卡:'+name(w>=100; 未解锁的不入表) —— verify-ui 按它反查并点卡面顶部 34px;
     *   · 「出 发」按钮 label 必须以 '出 发' 开头 —— verify-ui C2 按前缀反查;
     *   · 每张**已解锁**卡里必须有一个画出来的按钮落在 py+206..250(btnRects 口径)。
     *     VERIFY_UI_BREAK=chardesc 会把旧版 2 行 desc 画回 py+192/py+208; 若卡内那个位置没有按钮,
     *     这个负向对照就抓不到东西 -> 审计形同虚设(exit 2)。
     * 数值一律现算: 生命取 chd.hp, 词条取 chd.mods + chd.passive.desc(名字走 STAT_NAME), 不写死任何一条。 */
    /* v7.11(用户「很多道具, 武器, 包括角色, 它的属性由于太多, 在一张卡片上显示不出来, 我要求你做成点按卡片,
     *   他能完整显示出来」): 角色卡的全部词条装配(**唯一一份**)。
     *   drawCharSelect 过 4 条上限截断, drawCharDetail 不截断 —— 两边必须同源, 否则详情页会和卡面说不一样的话。
     *   顺序 = 属性修正 -> 收益修正 -> 每级 -> 转化 -> 特长(与卡面逐字一致)。 */
    charRows: function (chd) {
      var tr = [], keys = this.modKeys(chd.mods), ki;
      var PL_SHORT = this.STAT_SHORT;
      for (ki = 0; ki < keys.length; ki++) {
        var mv = chd.mods[keys[ki]];
        tr.push({ t: this.statLabel(keys[ki]) + ' ' + (mv > 0 ? '+' : '') + mv + this.statUnit(keys[ki]),
          c: this.signColor(keys[ki], mv) });
      }
      if (chd.gain) {
        for (ki = 0; ki < chd.gain.length; ki++) {
          var gv = chd.gain[ki].v;
          tr.push({ t: chd.gain[ki].label + '收益 ' + (gv > 0 ? '+' : '') + gv + '%', c: gv < 0 ? T.neg : T.pos });
        }
      }
      if (chd.perLevel) {
        var pls = [], pk;
        for (pk in chd.perLevel) pls.push((PL_SHORT[pk] || this.statLabel(pk)) + ' ' + (chd.perLevel[pk] > 0 ? '+' : '') + chd.perLevel[pk]);
        tr.push({ t: '每升一级 ' + pls.join(' · '), c: T.pos });
      }
      if (chd.convertDesc) tr.push({ t: chd.convertDesc, c: T.luck });
      if (!tr.length) tr.push({ t: '全属性均衡', c: T.mid });
      var pas = chd.passive;
      if (pas && pas.desc) tr.push({ t: '特长 · ' + pas.desc, c: T.luck });
      return tr;
    },

    /* v7.11: 角色详情页 —— 与 drawShopDetail 同构(整屏遮罩先入表吃掉穿透 -> 面板挡板 -> 按钮)。
     *   存在的理由与商店那一层完全一样: 卡面只有 2 列 x 2 行 = 4 个词条槽, 而角色最多 3+1+1+1+1 条。
     *   与商店详情页唯一的差别: 这里**不花钱**, 所以「选 择」按钮在未解锁时 disabled 而不是缺货。 */
    drawCharDetail: function () {
      var x = this.ctx, u = this.ui, W = u.W, H = u.H, g = PS.Game;
      var id = g.charDetail;
      if (id == null) return;
      var list = PS.Characters.list, chd = null, i;
      for (i = 0; i < list.length; i++) if (list[i].id === id) chd = list[i];
      if (!chd) { g.charDetail = null; return; }
      var save = PS.Save.data || PS.Save.load();
      var ok = PS.Characters.isUnlocked(chd, save);
      var accent = chd.color || T.gold;
      var rows = this.charRows(chd);
      this.fillScreen('rgba(4,7,4,0.90)');
      var pw = 640, ph = 560, px = Math.round((W - pw) / 2), py = Math.round((H - ph) / 2);
      this.plate(px, py, pw, ph, 18, 0.97, T.edge);
      x.save(); this.rr(px + 12, py + 14, pw - 24, 30, 12); x.clip();
      x.fillStyle = accent; x.fillRect(px, py + 14, pw, 30); x.restore();
      this.fitText('角色 · 完整属性' + (ok ? '' : ' · 未解锁'), px + pw / 2, py + 35, pw - 50, T.fs.small, T.onGold, 'center', true, 10);
      this.plate(px + 24, py + 56, 92, 84, 12, 0.42, this.withA(accent, 0.55));
      /* v8.3(用户「角色展框有这么大, 角色展示模型太小, 给他加大」): 模型本体约 56x64 世界单位
       *   (体 rx<=26/ry<=24 + 头饰最高到 y=-40) —— 0.5 只占了 92x84 框的 ~38% 高。
       *   0.95 => 61px 高 / 53px 宽, 框内留 ~11px 呼吸位; 平移点从 py+120 提到 py+106
       *   (模型重心在 -8, 抬 8px 才是真居中)。 */
      x.save(); x.translate(px + 70, py + 106); x.scale(0.95, 0.95);
      this.drawCharModel(chd, 0, 0, 1, { walk: 0, moving: false, eyeDx: 0, eyeDy: 0 });
      x.restore();
      this.fitText(chd.name, px + 132, py + 84, pw - 180, T.fs.lead, T.hi, 'left', true, T.fs.body);
      this.fitText('生命 ' + chd.hp, px + 132, py + 110, pw - 180, T.fs.micro, T.low, 'left', false, 9.5);
      var spk = this.startGuarKey(chd) || this.startWeaponKey(chd);
      this.fitText('初始武器 ' + (spk === null ? '随机一件' : this.startWeaponName(chd)) +
        (this.startGuarKey(chd) ? ' (必带)' : (this._startOptN(chd) ? ' (可选)' : (spk === null ? '' : ' (固定)'))),
        px + 132, py + 130, pw - 180, T.fs.micro, T.coin, 'left', false, 9.5);
      x.strokeStyle = T.weak; x.lineWidth = 1;
      x.beginPath(); x.moveTo(px + 24, py + 152); x.lineTo(px + pw - 24, py + 152); x.stroke();
      /* 全部词条(不截断): 行高 22, 面板高 560 => 至多 13 行, 实际最长的角色 8 行 */
      var ry = py + 176;
      for (i = 0; i < rows.length; i++) {
        this.fitText('· ' + rows[i].t, px + 36, ry, pw - 72, T.fs.body, rows[i].c, 'left', true, 10.5);
        ry += 22;
      }
      if (chd.desc) { ry += 4; ry = this.fitLines(chd.desc, px + pw / 2, ry, pw - 120, 16, 3, T.fs.micro, T.mid, true) + 16; }
      if (!ok) this.fitText('未解锁 · ' + ((chd.unlock && chd.unlock.text) || '未达成条件'),
        px + pw / 2, ry + 4, pw - 90, T.fs.small, T.neg, 'center', false, 10);
      /* 热区: 遮罩 -> 面板挡板 -> 按钮(逆序扫描, 后入的先命中) */
      this.buttons.push({ x: 0, y: 0, w: W, h: H, label: '角色遮罩', cb: function () { PS.Game.closeCharDetail(); } });
      this.buttons.push({ x: px, y: py, w: pw, h: ph, label: '角色面板', cb: function () {} });
      var by = py + ph - 92, bw = 250;
      this.button(px + 32, by, bw, 60, ok ? (g.pendingChar === chd.id ? '已 选' : '选 择') : '未解锁', {
        size: T.fs.lead, id: 'pick-detail', disabled: !ok,
        bg: ok ? this.withA(T.pos, 0.22) : 'rgba(13,19,13,0.5)',
        hoverBg: ok ? this.withA(T.pos, 0.34) : 'rgba(13,19,13,0.5)',
        border: ok ? this.withA(T.pos, 0.7) : T.weak,
        color: ok ? T.coin : this.withA(T.hi, 0.55),
        sub: ok ? '开局就用这一位' : '先解锁再来选',
        cb: function () { PS.Game.pendingChar = chd.id; PS.Sound.play('click'); PS.Game.closeCharDetail(); }
      });
      this.button(px + 32 + bw + 12, by, 120, 60, '关闭', {
        size: T.fs.body, id: 'char-detail-close', bold: false,
        bg: 'rgba(13,19,13,0.55)', hoverBg: 'rgba(255,255,255,0.10)',
        border: T.weak, hoverBorder: T.gold, color: T.mid,
        cb: function () { PS.Game.closeCharDetail(); }
      });
      this.fitText('点「关闭」回到选人页', px + pw - 40, by + 36, 200, T.fs.micro, T.low, 'right', false, 9.5);
    },
    drawCharSelect: function () {
      var x = this.ctx, u = this.ui, W = u.W, H = u.H, g = PS.Game, self = this;
      var save = PS.Save.data || PS.Save.load();
      this.backdrop(W / 2, 150);
      var list = PS.Characters.list;
      var mname = (B.MODES[g.pendingMode] || B.MODES.standard).name;
      this.text('选择你的蔬菜 — ' + mname + ' · ' + B.diffOf(g.pendingDiff).name, W / 2, 44, T.fs.title, T.coin);
      this.fitText('卡上每一条都是开局即生效的真实词条(取自角色表) · 正向绿 / 负向红 · 选中的那张金边加粗',
        W / 2, 70, 960, T.fs.small, T.mid, 'center', false, 10.5);
      /* ---- v6.2: 4×2 **分页**网格(卡 272×262 · 间距 12 · 行距 272 · 8 张/页) ----
       * 为什么必须分页: 单页最多 2 行(第 3 行 py=634 已经压住 y=630 起的底栏), 而把卡片压到
       *   能塞下 20 张(4 列 × 5 行 ⇒ 卡高 101px)连"立绘 + 生命 + 初始武器 + 描述 + 4 条词条"
       *   这五段都装不下 —— 那会变成"名字看得见、词条全被切掉"。分页是唯一不丢信息的方案。
       * 卡片收窄 288→272 是为了给右侧留一列分页器(4×272 + 3×12 = 1124, 两侧各留 78px):
       *   把箭头画在卡片网格之外, 就不会和任何卡内元素争位置(见 qa 的文字审计)。 */
      var PER = 8, cw = 272, chh = 262, gap = 12, sx = (W - (4 * cw + 3 * gap)) / 2;
      var pages = Math.max(1, Math.ceil(list.length / PER));
      /* 打开选人页时自动翻到"当前已选角色"所在那一页, 否则记忆里的选择可能在别的页上看不见;
       *   只在 pendingChar **变化**时跳一次, 不然玩家一点箭头就会被弹回来。 */
      var selIdx = 0;
      for (var si = 0; si < list.length; si++) if (list[si].id === g.pendingChar) selIdx = si;
      if (this._charPageFor !== g.pendingChar) {
        this._charPageFor = g.pendingChar;
        this.charPage = Math.floor(selIdx / PER);
      }
      var page = Math.min(Math.max(0, this.charPage | 0), pages - 1);
      this.charPage = page;
      var first = page * PER;
      for (var i = first; i < list.length && i < first + PER; i++) {
        var chd = list[i];
        var px = sx + ((i - first) % 4) * (cw + gap);
        var py = 90 + Math.floor((i - first) / 4) * (chh + 10);
        var ok = PS.Characters.isUnlocked(chd, save);
        var sel = g.pendingChar === chd.id;
        var accent = chd.color || T.gold;
        var hotCard = ok && this.hot(px, py, cw, chh);
        var pickFn = (function (cid) { return function () { PS.Game.pendingChar = cid; PS.Sound.play('click'); }; })(chd.id);
        /* v7.11(用户「点按卡片, 他能完整显示出来」—— 角色也在内): 点整卡 = **选中 + 打开详情页**。
         *   选中语义原样保留(verify-ui C1 钉的就是「点卡面能选中」), 详情页补上被 4 行上限切掉的那几条。 */
        var cardFn = (function (cid) { return function () { PS.Game.pendingChar = cid; PS.Game.openCharDetail(cid); }; })(chd.id);
        /* 整卡热区先入 -> 卡内「选 择」按钮后入(dispatchTap 从后往前取, 按钮优先) */
        if (ok) this.buttons.push({ x: px, y: py, w: cw, h: chh, label: '卡:' + chd.name, cb: this.press(px, py, cw, chh, { cb: cardFn }) });
        x.fillStyle = !ok ? 'rgba(7,11,7,0.62)'
          : sel ? this.withA(T.gold, 0.20)
            : hotCard ? 'rgba(15,22,15,0.96)' : 'rgba(13,19,13,0.90)';
        this.rr(px, py, cw, chh, 12); x.fill();
        x.strokeStyle = !ok ? T.weak : (sel ? T.gold : (hotCard ? this.withA(T.gold, 0.5) : T.weak));
        x.lineWidth = sel ? 3 : (hotCard ? 2 : 1.5);
        this.rr(px, py, cw, chh, 12); x.stroke();
        /* 名字带(角色自身的颜色; 未解锁灰掉) —— 走统一缎带口径 */
        if (ok) this.ribbon(px, py, cw, 28, accent, 12);
        else {
          x.save();
          this.rr(px, py, cw, 28, 12); x.clip();
          x.fillStyle = 'rgba(120,120,120,0.40)';
          x.fillRect(px, py, cw, 28);
          x.restore();
        }
        this.text(chd.name, px + cw / 2, py + 19, T.fs.body, ok ? T.onGold : this.withA(T.hi, 0.55));
        if (sel) {
          x.fillStyle = T.gold;
          this.rr(px + cw - 62, py + 33, 54, 20, 10); x.fill();
          this.text('已 选', px + cw - 35, py + 47, T.fs.micro, T.onGold);
        }
        /* 立绘 + 生命 + 初始武器(未解锁整体降透明: 仍然看得见"能解锁出什么") */
        x.save();
        if (!ok) x.globalAlpha = 0.45;
        x.translate(px + 52, py + 80);
        x.scale(0.52, 0.52);
        this.drawCharModel(chd, 0, 0, 1, { walk: 0, moving: false, eyeDx: 0, eyeDy: 0 });
        x.restore();
        x.textAlign = 'left';
        x.fillStyle = ok ? T.hi : this.withA(T.hi, 0.45);
        x.font = 'bold ' + T.fs.lead + 'px ' + u.font;
        x.fillText('生命 ' + chd.hp, px + 92, py + 68);
        x.fillStyle = T.low;
        x.font = T.fs.micro + 'px ' + u.font;
        x.fillText(this.startGuarKey(chd) ? '初始武器 必带'
          : (this._startOptN(chd) ? '初始武器 可选' : '初始武器'), px + 92, py + 88);
        /* v7.4: 有池的角色显示的是**当前选中的那一件**(默认 = 池里第一件), 于是卡面与开局一致;
          * v7.5: 有**保底起手武器**的角色(engineer/cyborg)画保底那一件 —— 它开局必定到手, 不存在「选不选」的问题。
        var shownKey = this.startGuarKey(chd) || this.startWeaponKey(chd);
        if (shownKey === null) {
          x.globalAlpha = ok ? 1 : 0.45;
          x.strokeStyle = T.coin; x.lineWidth = 1.6;
          x.beginPath(); x.arc(px + 102, py + 106, 8, 0, PS.TAU); x.stroke();
          x.fillStyle = T.coin; x.font = 'bold 11px ' + u.font; x.textAlign = 'center';
          x.fillText('?', px + 102, py + 107);
          x.globalAlpha = 1;
          this.fitText('随机一件', px + 116, py + 110, cw - 128, T.fs.small,
            ok ? T.coin : this.withA(T.coin, 0.5), 'left', true, 10);
        } else {
          var wdef = PS.WeaponData.list[shownKey];
          if (wdef) {
            x.globalAlpha = ok ? 1 : 0.45;
            this.weaponIcon(shownKey, px + 102, py + 106, 11, { def: wdef });
            x.globalAlpha = 1;
            this.fitText(wdef.name, px + 116, py + 110, cw - 128, T.fs.small,
              ok ? T.coin : this.withA(T.coin, 0.5), 'left', true, 10);
          }
        }
        /* 一句描述(单行省略号) —— 版式上它属于"名字带"那一段, 与下面的词条区用一条分隔线断开 */
        this.fitText(chd.desc, px + 16, py + 134, cw - 32, T.fs.micro,
          ok ? T.mid : this.withA(T.mid, 0.5), 'left', false, 9.5);
        x.strokeStyle = T.weak; x.lineWidth = 1;
        x.beginPath(); x.moveTo(px + 14, py + 152); x.lineTo(px + cw - 14, py + 152); x.stroke();
        x.fillStyle = 'rgba(13,19,13,0.94)';
        x.fillRect(px + cw / 2 - 24, py + 144, 48, 16);
        this.text('特 性', px + cw / 2, py + 157, T.fs.micro, T.low, 'center', false);
        /* 词条逐条: 两列 × 两行(最多 4 条) —— 恰好装得下"3 条属性修正 + 1 条被动特长"。
           颜色即符号: 正绿 / 负红 / 中性灰; 被动特长用幸运色区分(它不是属性加减, 是机制)。 */
        var tr = this.charRows(chd), ki;      /* ki 仍归 drawCharSelect 用(下面 4 条上限的循环) */
        for (ki = 0; ki < tr.length && ki < 4; ki++) {
          var tx = px + 16 + (ki % 2) * 128, ty = py + 176 + Math.floor(ki / 2) * 18;
          x.globalAlpha = ok ? 1 : 0.55;
          this.fitText('· ' + tr[ki].t, tx, ty, 120, T.fs.micro, tr[ki].c, 'left', true, 9.5);
          x.globalAlpha = 1;
        }
        /* 底行: 已解锁 -> 「选 择」按钮; 未解锁 -> 解锁条件的红条(不给按钮: 点了也不会有事发生) */
        if (!ok) {
          x.fillStyle = this.withA(T.neg, 0.16);
          this.rr(px + 14, py + 206, cw - 28, 44, 10); x.fill();
          this.fitText('未解锁 · ' + ((chd.unlock && chd.unlock.text) || '未达成条件'),
            px + cw / 2, py + 233, cw - 44, T.fs.small, T.neg, 'center', false, 10);
        } else {
          this.button(px + 14, py + 206, cw - 28, 44, sel ? '✓ 已 选' : '选 择', {
            size: T.fs.body, cb: pickFn,
            bg: sel ? this.withA(T.gold, 0.34) : undefined,
            hoverBg: sel ? this.withA(T.gold, 0.44) : undefined,
            border: sel ? T.gold : undefined,
            color: sel ? T.coin : undefined
          });
        }
      }
      /* ---- v6.2 分页器: 只有一页时整段不画(不让"永远点不动的箭头"出现在屏幕上) ---- */
      if (pages > 1) {
        var arm = function (ay, dir, on) {
          self.button(1212, ay, 56, 60, dir < 0 ? '‹' : '›', {
            size: T.fs.title, disabled: !on,
            bg: 'rgba(255,255,255,0.06)', hoverBg: 'rgba(255,255,255,0.16)',
            border: T.weak, hoverBorder: T.gold,
            cb: function () { self.charPage = Math.min(pages - 1, Math.max(0, self.charPage + dir)); PS.Sound.play('click'); }
          });
        };
        arm(300, -1, page > 0);
        arm(372, 1, page < pages - 1);
        this.text((page + 1) + ' / ' + pages, 1240, 270, T.fs.body, T.hi);
        this.text('共 ' + list.length + ' 名', 1240, 286, T.fs.micro, T.low);
      }
      /* ---- 底栏: 返回 / 已选 / 出发 / 运行选项(每个开关都真生效) ---- */
      this.plate(16, 630, 1248, 76, 16, 0.92, T.edge);
      var selChd = null;
      for (var s2 = 0; s2 < list.length; s2++) if (list[s2].id === g.pendingChar) selChd = list[s2];
      this.fitText(selChd ? ('已选 · ' + selChd.name) : '还没选蔬菜 — 点一张卡',
        158, 660, 320, T.fs.body, selChd ? T.pos : T.neg, 'left', true, 11);
      if (selChd && this._startOptN(selChd)) {
        /* 池 > 1 件才画: 「初始武器 n/N ‹ [图标] 当前那件 ›」。
         *   整条都在底栏 x=158..478 内(「出 发」从 x=510 起, 中间还留着 32px 的余量);
         *   文案一律走 text/fitText(缩字号 + 省略号), 不用 fillText 的 maxWidth —— 那是横向压扁。 */
        var spn = this._startOptN(selChd), spi = this._startPickOf(selChd);
        /* v7.5: 有保底件的角色这条选的是**额外那件** => 前缀「另选武器」; 没有保底件时它本身就是初始武器。 */
        this.text((this.startGuarKey(selChd) ? '另选武器 ' : '初始武器 ') + (spi + 1) + '/' + spn,
          158, 689, T.fs.micro, T.low, 'left', false);
        var step = function (d) { return function () { self.cycleStartWeapon(selChd, d); PS.Sound.play('click'); }; };
        this.button(244, 672, 26, 26, '‹', {
          size: T.fs.body, radius: 7, id: 'startwp-prev',
          bg: 'rgba(255,255,255,0.06)', hoverBg: 'rgba(255,255,255,0.16)',
          border: T.weak, hoverBorder: T.gold, cb: step(-1)
        });
        var spk = this.startWeaponKey(selChd);
        if (spk === null) {
          this.text('?', 284, 690, 15, T.coin);
        } else {
          this.weaponIcon(spk, 284, 685, 10, { def: PS.WeaponData.list[spk] });
        }
        this.fitText(this.startWeaponName(selChd), 296, 689, 150, T.fs.small, T.hi, 'left', true, 9.5);
        this.button(452, 672, 26, 26, '›', {
          size: T.fs.body, radius: 7, id: 'startwp-next',
          bg: 'rgba(255,255,255,0.06)', hoverBg: 'rgba(255,255,255,0.16)',
          border: T.weak, hoverBorder: T.gold, cb: step(1)
        });
      } else {
        this.fitText(selChd ? selChd.desc : '选中后「出 发」才会亮起',
          158, 684, 320, T.fs.micro, T.low, 'left', false, 9.5);
      }
      this.button(28, 646, 116, 48, '‹ 模式', {
        size: T.fs.body, bg: 'rgba(255,255,255,0.06)', hoverBg: 'rgba(255,255,255,0.14)',
        border: T.weak, hoverBorder: T.gold,
        cb: function () { PS.Game.setState(PS.State.MODE); PS.Sound.play('click'); }
      });
      this.button(W / 2 - 130, 640, 260, 56, '出 发 !', {
        size: 20, disabled: !g.pendingChar,
        /* v7.4: 必须把「初始武器」那一档一起递下去 —— 不传就是新的静默随机(用户报的 bug)。
         *   单件角色 startWeaponOpt 返回 null, newRun 回落 characters.js 的 weapon。 */
        cb: function () {
          if (!g.pendingChar) return;
          PS.Game.newRun(g.pendingChar, g.pendingMode || 'standard', self.startWeaponOpt(selChd));
        }
      });
      /* 运行选项: 三个开关都是真接线(不是装饰) ——
         · 无尽: 切 pendingMode(标准 <-> 无尽), 关掉时回到切换前的模式, 不做静默降级;
         · 音效 / 音乐: PS.Sound.toggle / PS.Music.toggle(与主菜单/暂停页同一套)。
         为什么没有「禁用物品」: 引擎里根本没有这条通道 —— newRun(charId, mode, opts) 的第三参只认
         「起始武器」(opts.weapon 指定 / opts.randomStart 显式随机, v7.4 起), 商店/掉落全在 core 层,
         ui.js 造一个开关只能骗玩家(点了不生效)。要真做必须由 core 侧**再加一条** newRun 选项,
         那超出本次 UI 独占写权, 已在报告里列为待办。 */
      var opt = function (ox, ow, id, label, on, cb) {
        var hot = self.hot(ox, 644, ow, 48);
        x.fillStyle = on ? self.withA(T.pos, 0.16) : (hot ? 'rgba(255,255,255,0.12)' : 'rgba(7,11,7,0.55)');
        self.rr(ox, 644, ow, 48, 10); x.fill();
        x.strokeStyle = on ? self.withA(T.pos, 0.7) : T.weak; x.lineWidth = 1.5;
        self.rr(ox, 644, ow, 48, 10); x.stroke();
        x.textAlign = 'left';
        x.fillStyle = on ? T.hi : T.mid;
        x.font = (on ? 'bold ' : '') + T.fs.small + 'px ' + u.font;
        x.fillText(label, ox + 12, 673);
        self.switchBox(ox + ow - 52, 657, on, hot);
        self.btnRects.push({ x: ox, y: 644, w: ow, h: 48, label: label });
        self.buttons.push({ x: ox, y: 644, w: ow, h: 48, id: id, label: label + (on ? ' 开' : ' 关'),
          cb: self.press(ox, 644, ow, 48, { cb: cb }) });
      };
      var endless = (g.pendingMode || 'standard') === 'endless';
      opt(790, 140, 'charopt-endless', '无尽', endless, function () {
        if (endless) { PS.Game.pendingMode = self._prevMode || 'standard'; }
        else { if (g.pendingMode !== 'endless') self._prevMode = g.pendingMode || 'standard'; PS.Game.pendingMode = 'endless'; }
        PS.Sound.play('click');
      });
      opt(940, 140, 'charopt-sfx', '音效', !!PS.Sound.enabled, function () { PS.Sound.toggle(); });
      if (PS.Music && typeof PS.Music.toggle === 'function') {
        opt(1090, 148, 'charopt-bgm', '音乐', !!PS.Music.enabled, function () { PS.Music.toggle(); });
      }
      /* 详情页必须**最后**画: 它的遮罩热区在表尾, dispatchTap 的逆序扫描才会先命中它。 */
      if (g.charDetail) this.drawCharDetail();
    },

    /* ================= 战斗 HUD(横屏) =================
     * 白名单(spec §5): 生命 / 等级+经验 / 波次+剩余秒 / 材料 / 武器槽 / 强化预告。
     * 其余数字一律只在商店与结算显示; 任何全屏叠层下都不画(不做"幽灵 HUD")。 */
    /* HUD 顶栏三块的分组色条(4px 左色条 + 圆角裁切)。
       spec §11 要求三块同顶同高 ⇒ 旧版三块长得一模一样, 读不出「这块在回答什么」。
       用色相把 生存/进度/资源 分开, **几何零位移**(色条画在面板内, 不占热区、不碰门禁几何)。 */
    groupTag: function (px, py, h, color) {
      var x = this.ctx;
      x.save();
      this.rr(px, py, 30, h, 14); x.clip();
      x.fillStyle = color;
      x.fillRect(px, py + 1, 4.5, h - 2);
      x.restore();
    },
    /* HUD = 唯一常驻、看得最久的界面 ⇒ 手机端第一个放大它(见 setFit)。
     *   桌面 uiScale()=1 ⇒ 直接走 drawHUDInner, 一个像素都不变。
     *   S!==1 时: 绕原点均匀缩放(屏幕角仍是屏幕角) → 内部排版在小空间里重排 → 热区换算回画布坐标。 */
    /* 覆盖页(强化/商店/暂停/结算…)的手机放大 —— 与 drawHUD 同一口径: 绕原点均匀缩放, 出栈时把热区
     *   **换算回画布坐标**(指针来自 toLogic, 未缩放)。页内排版由各页自己在缩放空间里重排。
     * 整屏遮罩必须画在缩放**之外**: 缩放空间只有 W/S x H/S 大, 在里面 fillScreen 会在边上留一条没盖住的边。
     * 桌面 S=1 时**直接原样调用** —— 一个像素、一个热区都不动。 */
    drawPageScaled: function (scrim, fn) {
      var x = this.ctx, S = this.uiScale();
      if (S === 1) { this.spaceScale = 1; fn.call(this); return; }
      if (scrim) this.fillScreen(scrim);
      x.save();
      x.scale(S, S);
      this.spaceScale = S;
      var n0 = this.buttons.length, r0 = this.btnRects.length;
      fn.call(this);
      this.rescaleRects(this.buttons, n0, S);
      this.rescaleRects(this.btnRects, r0, S);
      this.spaceScale = 1;
      x.restore();
    },
    drawHUD: function () {
      var x = this.ctx, S = this.uiScale();
      if (S === 1) { this.spaceScale = 1; this.drawHUDInner(); return; }
      x.save();
      x.scale(S, S);
      this.spaceScale = S;
      var n0 = this.buttons.length, r0 = this.btnRects.length;
      this.drawHUDInner();
      /* 热区回到画布坐标: 指针来自 input.js 的 toLogic(未缩放), 不同坐标就点不中(与旋转那次同一类坑) */
      this.rescaleRects(this.buttons, n0, S);
      this.rescaleRects(this.btnRects, r0, S);
      this.spaceScale = 1;
      x.restore();
    },
    /* 血条填充 + 掉血残影 + 低血脉冲 —— 桌面血板与手机血板**共用这一份**。
     *   抽出来的理由: 里面每一个数都影响观感(残影速度 0.55/s · 脉冲 8Hz · 高光 2px),
     *   抄第二份就一定会漂移。调用方只负责给矩形与 ratio, 返回值 = 是否激活「危」态(文字用色)。 */
    hpBarFill: function (bx, by, bw, bh, ratio, dt) {
      var x = this.ctx;
      var low = ratio <= 0.3, veryLow = ratio <= 0.15;
      if (this._hpGhost === undefined) this._hpGhost = ratio;
      this._hpGhost = Math.max(ratio, this._hpGhost - dt * 0.55);
      x.fillStyle = 'rgba(255,255,255,0.10)';
      this.rr(bx, by, bw, bh, 9); x.fill();
      if (this._hpGhost > ratio + 0.003) {
        x.fillStyle = 'rgba(255,150,150,0.5)';
        this.rr(bx + bw * ratio, by, Math.max(3, bw * (this._hpGhost - ratio)), bh, 9); x.fill();
      }
      if (ratio > 0) {
        var hfw = Math.max(16, bw * ratio);
        x.globalAlpha = low ? (0.78 + 0.22 * Math.sin(this.time * 8)) : 1;
        x.fillStyle = veryLow ? T.danger : (low ? T.neg : T.pos);
        this.rr(bx, by, hfw, bh, 9); x.fill();
        x.globalAlpha = 1;
        if (hfw > 14) { x.fillStyle = 'rgba(255,255,255,0.16)'; x.fillRect(bx + 4, by + 2.5, hfw - 8, 2); }
      }
      x.strokeStyle = veryLow ? this.withA(T.danger, 0.9) : T.ink;
      x.lineWidth = veryLow ? 2 : 1.5;
      this.rr(bx, by, bw, bh, 9); x.stroke();
      x.strokeStyle = T.ink; x.lineWidth = 1.5;
      for (var tk = 1; tk < 4; tk++) {
        x.beginPath(); x.moveTo(bx + bw / 4 * tk, by + 1); x.lineTo(bx + bw / 4 * tk, by + bh - 1); x.stroke();
      }
      return veryLow;
    },

    drawHUDInner: function () {

      var x = this.ctx, u = this.ui, g = PS.Game, W = this.uiW();
      if (!g.player || !g.stats) return;
      if (g.state === PS.State.OVER || g.state === PS.State.LEVELUP || g.state === PS.State.SHOP) return;
      var s = g.stats;
      var dt = this.time - (this._hudT === undefined ? this.time : this._hudT);
      this._hudT = this.time;
      var L = this.hudLayout();              /* 版式唯一来源(见 hudLayout) */
      if (L.phone) return this.drawHUDPhone(L, dt);   /* 手机走紧凑版(v9.0): 桌面那条路径一个字节都不碰 */
      /* ---- 左上: 头像 + 生命 + 经验 + 等级 ---- */
      var px = 16, py = 12, pw = 392, ph = 76;
      this.plate(px, py, pw, ph, 14, 0.90, T.edge);
      this.groupTag(px, py, ph, T.neg);      /* 生存 */
      x.save();
      x.beginPath(); x.arc(px + 42, py + 38, 25, 0, PS.TAU);
      x.fillStyle = this.withA(T.gold, 0.14); x.fill();
      x.strokeStyle = this.withA(T.gold, 0.6); x.lineWidth = 2; x.stroke();
      x.clip();
      this.drawCharModel(g.char, px + 42, py + 46, 0.8, { walk: 0, moving: false, eyeDx: 0, eyeDy: 0 });
      x.restore();
      var bx = px + 78, bw = 300, by = py + 14, bh = 18;
      var ratio = PS.util.clamp(s.maxHp > 0 ? g.player.hp / s.maxHp : 0, 0, 1);
      /* 填充 + 掉血残影 + 低血脉冲全在 hpBarFill(与手机血板共用同一份表达式) */
      var veryLow = this.hpBarFill(bx, by, bw, bh, ratio, dt);
      var hpTxt = Math.max(0, Math.ceil(g.player.hp)) + ' / ' + s.maxHp;
      x.font = 'bold ' + T.fs.small + 'px ' + u.font;
      var htw = x.measureText(hpTxt).width;
      x.fillStyle = 'rgba(5,8,5,0.66)';
      this.rr(bx + 6, by + 1, Math.min(bw - 12, htw + 12), bh - 2, 6); x.fill();
      /* 刻度回到源原生量级(maxHp 10 量级, 后期 40~60): 1~3 位读数都必须留在血条里;
         基线固定 by+bh-5, 位数变化只改宽不改高 —— 否则就是"跳字"。 */
      this.fitText(hpTxt, bx + 12, by + bh - 5, bw - 26, T.fs.small,
        veryLow ? '#ffd2cb' : '#ffffff', 'left', true, 10);
      var need = B.xpNeed(g.level);
      var xy = py + 40, xh = 12, xbw = bw - 36;
      x.fillStyle = 'rgba(255,255,255,0.08)';
      this.rr(bx, xy, xbw, xh, 6); x.fill();
      var xr = PS.util.clamp(need > 0 ? g.xp / need : 0, 0, 1);
      if (xr > 0) {
        var xfw = Math.max(6, xbw * xr);
        x.fillStyle = T.info; this.rr(bx, xy, xfw, xh, 6); x.fill();
        if (xfw > 12) { x.fillStyle = 'rgba(255,255,255,0.16)'; x.fillRect(bx + 3, xy + 2, xfw - 6, 1.5); }
      }
      x.strokeStyle = this.withA(T.info, 0.5); x.lineWidth = 1.2;
      this.rr(bx, xy, xbw, xh, 6); x.stroke();
      x.fillStyle = T.info;
      x.beginPath(); x.arc(bx + bw - 15, xy + xh / 2, 15, 0, PS.TAU); x.fill();
      x.strokeStyle = T.ink; x.lineWidth = 1.5; x.stroke();
      x.fillStyle = T.onGold;
      x.font = 'bold ' + (g.level >= 100 ? 11 : (g.level >= 10 ? 13 : 14)) + 'px ' + u.font;
      x.textAlign = 'center';
      x.fillText('' + g.level, bx + bw - 15, xy + xh / 2 + 5);
      x.font = T.fs.micro + 'px ' + u.font;
      x.fillStyle = T.low;
      x.textAlign = 'right';
      x.fillText('LV ' + g.level + ' · ' + Math.floor(g.xp) + '/' + need, bx + xbw, py + 68);
      /* ---- 中央胶囊: 波次 + 剩余秒 + 进度 ---- */
      /* 手机端(UI 空间约 815 宽)左板占到 408, 胶囊居中后左缘只有 257 ⇒ 必然撞车, 换第二行。
       *   桌面 1280: 640-150 = 490 > 420 ⇒ 恒为一行, 逐像素与旧版一致。 */
      var capW = L.capW, capX = L.capX, capY = L.capY, capCX = capX + capW / 2;
      /* 胶囊在手机端被挪到底行右对齐(capX 不再是 W/2-150) ⇒ 里面的文字必须跟着 capCX 走,
         沿用 W/2 会把标题画到板子左缘外面去(2026-10-15 实测截图)。 */
      this.plate(capX, capY, capW, 64, 14, 0.90, T.edge);
      this.groupTag(capX, capY, 64, T.coin);  /* 进度 */
      var mo = B.MODES[g.mode] || { name: '远征', waves: 0 };
      this.fitText(mo.name + ' · ' + B.diffOf(g.diff).name + ' · 第 ' + g.wave + ' 波' + (mo.noWin ? '' : ' / ' + mo.waves),
        capCX, capY + 26, capW - 24, T.fs.lead, T.coin, 'center', true, 12);
      var left = Math.max(0, g.waveDuration - g.timeInWave);
      this.fitText(Math.ceil(left) + ' 秒' + (g.horde ? ' · 怪潮!' : ''), capCX, capY + 48, capW - 24, T.fs.body,
        left < 5 ? T.danger : (g.horde ? T.neg : T.mid), 'center', true, 11);
      var wpr = g.waveDuration > 0 ? PS.util.clamp(g.timeInWave / g.waveDuration, 0, 1) : 0;
      x.fillStyle = 'rgba(255,255,255,0.12)';
      this.rr(capX + 16, capY + 54, capW - 32, 6, 3); x.fill();
      if (wpr > 0) {
        var wfw = Math.max(4, (capW - 32) * wpr);
        x.fillStyle = left < 5 ? T.danger : T.coin;
        this.rr(capX + 16, capY + 54, wfw, 6, 3); x.fill();
        if (wfw > 10) { x.fillStyle = 'rgba(255,255,255,0.18)'; x.fillRect(capX + 18, capY + 55.5, wfw - 4, 1.2); }
      }
      /* ---- 强化预告(战斗中只预告, 绝不弹窗) ---- */
      if (g.pendingLevelups > 0) {
        var upTxt = '★ 本波获得 ' + g.pendingLevelups + ' 次强化 · 波末结算';
        x.font = 'bold ' + T.fs.small + 'px ' + u.font;
        var upw = x.measureText(upTxt).width + 28;
        /* 换行时让位到胶囊下面(桌面恒 84, 与旧版一致) */
        var upY = L.upY;
        this.plate(W / 2 - upw / 2, upY, upw, 26, 8, 0.86, this.withA(T.coin, 0.55));
        x.fillStyle = T.coin;
        x.textAlign = 'center';
        x.fillText(upTxt, W / 2, upY + 18);
      }
      /* ---- 右上: 材料 + 武器槽 ---- */
      var rw2 = 268, rx2 = L.matX, ry2 = L.matY;
      this.plate(rx2, ry2, rw2, 76, 14, 0.90, T.edge);
      this.groupTag(rx2, ry2, 76, T.pos);     /* 资源 */
      x.fillStyle = T.pos;
      /* 位数兜底: 数值最多占到右侧面板宽度减 76(给左侧「材料」标签留位), 放不下就缩字号 */
      this.fitText('★ ' + g.material, rx2 + rw2 - 14, ry2 + 30, rw2 - 76, T.fs.num, T.pos, 'right', true, 13);
      x.font = T.fs.micro + 'px ' + u.font;
      x.fillStyle = T.low;
      x.textAlign = 'left';
      x.fillText('材料', rx2 + 14, ry2 + 30);
      var slotW = 34, sgap = 5;
      var slotN = (g.stats && g.stats.weaponSlot) || B.WEAPON_SLOTS;   /* v3.5: 源 weapon_slot 词条通道 */
      var total = slotN * slotW + (slotN - 1) * sgap;
      var sx0 = rx2 + rw2 - 14 - total, sy0 = ry2 + 36;
      for (var i = 0; i < slotN; i++) {
        var wx = sx0 + i * (slotW + sgap);
        x.fillStyle = g.weapons[i] ? 'rgba(7,11,7,0.9)' : 'rgba(7,11,7,0.55)';
        this.rr(wx, sy0, slotW, slotW, 7); x.fill();
        /* 槽位描边用**该武器的阶位色**(RARITY[tier]): 满槽一眼看出带的什么档位。
           旧版 6 格一律同一支淡金 ⇒ 有武器和没武器、I 阶和 IV 阶长得一样。 */
        x.strokeStyle = g.weapons[i] ? this.withA((RARITY[g.weapons[i].tier] || RARITY[1]).c, 0.8) : T.weak;
        x.lineWidth = 1.2;
        this.rr(wx, sy0, slotW, slotW, 7); x.stroke();
        if (g.weapons[i]) { x.fillStyle = 'rgba(255,255,255,0.07)'; x.fillRect(wx + 4, sy0 + 1.5, slotW - 8, 1); }
        if (g.weapons[i]) {
          this.weaponIcon(g.weapons[i].key, wx + slotW / 2, sy0 + slotW / 2 - 3, 13,
            { def: PS.WeaponData.list[g.weapons[i].key], tier: g.weapons[i].tier });
          x.fillStyle = 'rgba(5,8,5,0.78)';
          this.rr(wx + slotW - 17, sy0 + slotW - 14, 15, 11, 3); x.fill();
          x.fillStyle = T.coin;
          x.font = 'bold 9px ' + u.font;
          x.textAlign = 'center';
          x.fillText('T' + g.weapons[i].tier, wx + slotW - 9.5, sy0 + slotW - 5.5);
        }
      }
      x.textAlign = 'left';
      /* 设置(暂停)入口: 只在真实战斗中画, 暂停页自己有一整套按钮 */
      if (g.state === PS.State.PLAY) this.drawSettingsButton();
    },

    /* ================= 手机端战斗 HUD(v9.0, 2026-10-15) =================
     * 版式见 hudLayout(); 这里只负责画。与 drawHUDInner 的分工:
     *   桌面那条路径**一个字节不碰**(qa/verify-ui 的桌面像素审计照旧), 手机这条只读 L 的四个矩形。
     * 三块: 左上一板(血/经验/等级/材料) · 顶中波次 · 左下武器槽; 齿轮仍走 drawSettingsButton。
     * 为什么单开一条而不把 drawHUDInner 加上一堆 if(phone): 桌面那份是审计基准(逐像素), 把两套排版揉进同一函数就等于每改一边都要重验另一边。 */
    drawHUDPhone: function (L, dt) {
      var x = this.ctx, u = this.ui, g = PS.Game, s = g.stats;
      var i;
      /* ---- 左上板: 头像 + 血条 + 经验条 + 等级徽 + LV/材料一行 ---- */
      var P = L.plate;
      this.plate(P.x, P.y, P.w, P.h, 12, 0.90, T.edge);
      this.groupTag(P.x, P.y, P.h, T.neg);
      x.save();
      x.beginPath(); x.arc(P.x + 24, P.y + 27, 16, 0, PS.TAU);
      x.fillStyle = this.withA(T.gold, 0.14); x.fill();
      x.strokeStyle = this.withA(T.gold, 0.6); x.lineWidth = 1.5; x.stroke();
      x.clip();
      this.drawCharModel(g.char, P.x + 24, P.y + 31, 0.52, { walk: 0, moving: false, eyeDx: 0, eyeDy: 0 });
      x.restore();
      var bx = P.x + 46, bw = P.w - 46 - 8, by = P.y + 7, bh = 15;
      var ratio = PS.util.clamp(s.maxHp > 0 ? g.player.hp / s.maxHp : 0, 0, 1);
      var veryLow = this.hpBarFill(bx, by, bw, bh, ratio, dt);
      var hpTxt = Math.max(0, Math.ceil(g.player.hp)) + ' / ' + s.maxHp;
      x.font = 'bold ' + T.fs.small + 'px ' + u.font;
      x.fillStyle = 'rgba(5,8,5,0.66)';
      this.rr(bx + 4, by + 1, Math.min(bw - 8, x.measureText(hpTxt).width + 10), bh - 2, 5); x.fill();
      this.fitText(hpTxt, bx + 9, by + bh - 4, bw - 16, T.fs.small, veryLow ? '#ffd2cb' : '#ffffff', 'left', true, 10);
      /* 经验条 + 等级圆徽 */
      var need = B.xpNeed(g.level), xbw = bw - 26, xy = P.y + 27, xh = 7;
      x.fillStyle = 'rgba(255,255,255,0.08)';
      this.rr(bx, xy, xbw, xh, 4); x.fill();
      var xr = PS.util.clamp(need > 0 ? g.xp / need : 0, 0, 1);
      if (xr > 0) { x.fillStyle = T.info; this.rr(bx, xy, Math.max(4, xbw * xr), xh, 4); x.fill(); }
      x.strokeStyle = this.withA(T.info, 0.5); x.lineWidth = 1;
      this.rr(bx, xy, xbw, xh, 4); x.stroke();
      x.fillStyle = T.info;
      x.beginPath(); x.arc(bx + bw - 8, xy + xh / 2, 9, 0, PS.TAU); x.fill();
      x.strokeStyle = T.ink; x.lineWidth = 1.2; x.stroke();
      x.fillStyle = T.onGold;
      x.font = 'bold ' + (g.level >= 100 ? 9 : (g.level >= 10 ? 10 : 11)) + 'px ' + u.font;
      x.textAlign = 'center';
      x.fillText('' + g.level, bx + bw - 8, xy + xh / 2 + 4);
      x.textAlign = 'left';
      this.fitText('LV ' + g.level + ' · ' + Math.floor(g.xp) + '/' + need, bx, P.y + P.h - 5, bw - 62,
        T.fs.micro, T.low, 'left', false, 9);
      this.fitText('★ ' + g.material, P.x + P.w - 8, P.y + P.h - 4, 66, T.fs.small, T.pos, 'right', true, 10);
      /* ---- 顶中: 波次 + 倒计时 + 进度(半透明小底, 无描边) ---- */
      var C = L.cap, cx = C.x + C.w / 2;
      this.plate(C.x, C.y, C.w, C.h, 12, 0.62, false);
      var left = Math.max(0, (g.waveDuration || 0) - g.timeInWave);
      this.fitText('第 ' + g.wave + ' 波', cx, C.y + 20, C.w - 12, T.fs.lead, T.coin, 'center', true, 12);
      this.fitText(Math.ceil(left) + ' 秒' + (g.horde ? ' · 怪潮!' : ''), cx, C.y + 35, C.w - 12, T.fs.small,
        left < 5 ? T.danger : (g.horde ? T.neg : T.mid), 'center', true, 9);
      var wpr = g.waveDuration > 0 ? PS.util.clamp(g.timeInWave / g.waveDuration, 0, 1) : 0;
      x.fillStyle = 'rgba(255,255,255,0.14)';
      this.rr(C.x + 8, C.y + 39, C.w - 16, 4, 2); x.fill();
      if (wpr > 0) {
        x.fillStyle = left < 5 ? T.danger : T.coin;
        this.rr(C.x + 8, C.y + 39, Math.max(3, (C.w - 16) * wpr), 4, 2); x.fill();
      }
      /* ---- 左下: 武器槽 ---- */
      var M = L.mat;
      this.plate(M.x, M.y, M.w, M.h, 12, 0.90, T.edge);
      this.groupTag(M.x, M.y, M.h, T.pos);
      var slotN = (s && s.weaponSlot) || B.WEAPON_SLOTS;
      var sgap = 4, slotW = Math.min(26, Math.floor((M.w - 24 - (slotN - 1) * sgap) / slotN));
      var sx0 = M.x + 12, sy0 = M.y + Math.round((M.h - slotW) / 2);
      for (i = 0; i < slotN; i++) {
        var wx = sx0 + i * (slotW + sgap);
        x.fillStyle = g.weapons[i] ? 'rgba(7,11,7,0.9)' : 'rgba(7,11,7,0.55)';
        this.rr(wx, sy0, slotW, slotW, 6); x.fill();
        x.strokeStyle = g.weapons[i] ? this.withA((RARITY[g.weapons[i].tier] || RARITY[1]).c, 0.8) : T.weak;
        x.lineWidth = 1.2;
        this.rr(wx, sy0, slotW, slotW, 6); x.stroke();
        if (g.weapons[i]) {
          this.weaponIcon(g.weapons[i].key, wx + slotW / 2, sy0 + slotW / 2 - 3, 12,
            { def: PS.WeaponData.list[g.weapons[i].key], tier: g.weapons[i].tier });
          x.fillStyle = 'rgba(5,8,5,0.78)';
          this.rr(wx + slotW - 15, sy0 + slotW - 12, 13, 10, 3); x.fill();
          x.fillStyle = T.coin;
          x.font = 'bold 8px ' + u.font;
          x.textAlign = 'center';
          x.fillText('T' + g.weapons[i].tier, wx + slotW - 8.5, sy0 + slotW - 4.5);
        }
      }
      x.textAlign = 'left';
      /* ---- 强化预告(战斗中只预告, 绝不弹窗) ---- */
      if (g.pendingLevelups > 0) {
        var upTxt = '★ 本波获得 ' + g.pendingLevelups + ' 次强化 · 波末结算';
        x.font = 'bold ' + T.fs.small + 'px ' + u.font;
        var upw = Math.round(x.measureText(upTxt).width) + 24;
        this.plate(M.x, L.upY, upw, 24, 8, 0.86, this.withA(T.coin, 0.55));
        x.fillStyle = T.coin;
        x.textAlign = 'center';
        x.fillText(upTxt, M.x + upw / 2, L.upY + 17);
        x.textAlign = 'left';
      }
      if (g.state === PS.State.PLAY) this.drawSettingsButton();
    },

    /* ================= 波末强化(4 选 1) ================= */
    /* v7.2(源对齐) 卡面品质缎带 = 这张卡**真的**属于哪一档(源 get_upgrade_data 的 tier), 与 stat 名无关。
     *   独立成方法只为**可测**: 门禁用它算期望色, 再用真像素对拍。
     *   旧口径是模块内一张按 stat 名硬编码的 LV_RARITY 表 ⇒ 会把 tier0 的暴击率/吸血画成史诗/传说,
     *   那正是用户说的「出现高品质选项概率太高」—— 卡的档位没错, 是**标签在说谎**。 */
    levelupRarity: function (card) {
      return RARITY[(((card && card.tier) | 0) + 1)] || RARITY[1];
    },
    drawLevelup: function () {
      var x = this.ctx, u = this.ui, g = PS.Game;
      /* 手机(S>1)下本页是在**缩放后的**空间里排版的 ⇒ W/H 必须是 uiW/uiH(630x355), 不是 1280x720;
         沿用 u.W 会让 1280 空间的版式再乘一次 S, 内容直接溢出屏幕(实测截图: 只看得见两张卡)。 */
      var PH = this.uiScale() > 1;
      var W = PH ? this.uiW() : u.W, H = PH ? this.uiH() : u.H;
      if (this.uiScale() === 1) this.fillScreen(T.scrim);   /* 缩放时遮罩由 drawPageScaled 铺(见 draw) */
      /* 空池也必须给出出口: 旧写法只看 null, 不查长度 ⇒ choices=[] 时下面 `|| 1` 会读 [0].stat 抛 TypeError,
       *   而且玩家一张卡都点不到(死锁)。引擎侧已保底(rollLevelupChoices 恒非空), 这里是第二道防线。 */
      if (!g.levelupChoices || !g.levelupChoices.length) {
        g.levelupChoices = g.rollLevelupChoices();
        if (!g.levelupChoices || !g.levelupChoices.length) { this.drawLevelupEmpty(); return; }
      }
      var CAT_OF = {
        maxHp: 'sur', maxHpPct: 'sur', armor: 'sur', dodge: 'sur', regen: 'sur', lifesteal: 'sur', speedPct: 'sur',
        dmgFlat: 'out', dmgPct: 'out', meleePct: 'out', rangedPct: 'out', atkSpd: 'out', crit: 'out', critDmg: 'out', rangePct: 'out',
        luck: 'eco', harvest: 'eco', pickup: 'eco'
      };
      var CAT_NAME = { sur: '生存', out: '输出', eco: '经济' };
      var CAT_COL = { sur: T.info, out: T.neg, eco: T.pos };
      var CAT_HINT = { sur: '活得久才有输出', out: '直接抬高每秒伤害', eco: '影响商店品质与波末掉落' };
      var phase = g.levelupPhase, leftN = (g.pendingLevelups || 0) + 1;
      if (phase === 'waveEnd') {
        if (this._lvChain !== 'waveEnd') { this._lvChain = 'waveEnd'; this._lvTotal = leftN; }
      } else {
        this._lvChain = phase || 'none';
        this._lvTotal = phase === 'prewave' ? 1 : 0;
      }
      /* ---- 标题带 ---- */
      /* ---- 标题带 ----
       * 手机: 整条摊到 W-32, 矮一半(84)。桌面: 1160x132 原样, 逐像素不变。 */
      var bw = PH ? (W - 32) : 1160, bx0 = (W - bw) / 2;
      var bH = PH ? 84 : 132, bY = PH ? 12 : 20;
      this.plate(bx0, bY, bw, bH, 16, 0.92, T.edge);
      var title = phase === 'waveEnd' ? ('第 ' + g.wave + ' 波结束的强化') : (phase === 'prewave' ? '开局强化' : '强化');
      /* 刷新钮在标题带右侧: 手机上标题必须让开它, 否则「第 13 波结束的强化」会被压住 */
      var rbW = PH ? 160 : 196, rbH = PH ? 52 : 56;
      var rbX = PH ? (bx0 + bw - 16 - rbW) : 1004, rbY = PH ? (bY + 16) : 52;
      var titleMaxW = PH ? (rbX - bx0 - 24) : (W - 40);
      this.fitText(title + ' · LV ' + g.level, PH ? (bx0 + titleMaxW / 2 + 8) : W / 2, PH ? 44 : 66,
        titleMaxW, T.fs.title, T.coin, 'center', false);
      var sub = phase === 'waveEnd'
        ? ('本波共可强化 ' + this._lvTotal + ' 次 · ' + (leftN > 1 ? ('还剩 ' + leftN + ' 次(含本次)') : '这是最后一次'))
        : (phase === 'prewave' ? '开局赠送强化 · 免费 1 次' : '四选一 · 波末结算');
      this.fitText(sub, PH ? (bx0 + titleMaxW / 2 + 8) : W / 2, PH ? 74 : 96, titleMaxW, T.fs.body, T.hi, 'center', false);
      if (!PH) this.text('数值为「当前 → 选它之后」 · 点卡片任意位置即可选择(触屏同样)', W / 2, 122, T.fs.small, T.mid, 'center', false);
      /* ---- v7.0 刷新(用户逐字「升级选项，添加刷新按钮，可以花材料刷新」) ----
       * 与商店顶栏那枚「刷新」逐字同形: label = '刷新', 费用按**引擎口径**现算(卡面写的必须是要扣的数),
       *   钱不够时 disabled ⇒ 按钮不进热区表 ⇒ 点击不生效(引擎侧 rerollLevelup 的内部守卫再兜一道)。
       * 注意: 升级刷新**不吃 free_rerolls**(那是"每波商店免费刷新"的词条), 见 game.js::rerollLevelup。 */
      var lvCnt = g.levelupRerolls || 0;
      var lvCost = Math.max(0, B.rerollPrice(g.wave, lvCnt) - (g.stats.rerollDiscount || 0));
      var lvAff = lvCost <= g.material;
      this.button(rbX, rbY, rbW, rbH, '刷新', {
        size: T.fs.lead,
        sub: lvAff ? ('★' + lvCost + ' · 已刷 ' + lvCnt + ' 次') : ('还差 ★' + (lvCost - g.material)),
        subColor: lvAff ? T.mid : T.neg,
        disabled: !lvAff, id: 'lvreroll',
        cb: function () { PS.Game.rerollLevelup(); }
      });
      var n = g.levelupChoices.length;   /* 空池不再伪装成 1(旧 `|| 1` 会读 [0].stat 抛错); 空池出口见本函数顶部守卫 */
      /* ---- 四张卡 ----
       * 手机: 四张摊满全宽 —— 693 CSS px / 4 ≈ 173 CSS px(正常手机卡宽), 卡内节奏整体压缩;
       *         丢掉「分类口味」那行小字(手机上一行放不下 8 个字, 而且它只是风味文案)。
       * 桌面: 272x356 + 24 间距 + y=190 原样, 逐像素不变。 */
      var gap = PH ? 12 : 24;
      var cw = PH ? Math.floor((W - 32 - (n - 1) * gap) / n) : 272;
      var chh = PH ? 224 : 356, py = PH ? 104 : 190;
      var RB = PH ? 24 : 30, CHIPY = PH ? 30 : 38;
      var ICY = PH ? 70 : 108, ICR = PH ? 19 : 30;
      var NAMY = PH ? 112 : 168, VALY = PH ? 142 : 202, DELY = PH ? 166 : 232;
      var INW = cw - (PH ? 16 : 24);
      var BTNH = PH ? 44 : 48, BTNOFF = PH ? 48 : 72, BTNPAD = PH ? 12 : 24;
      var sx = (W - (n * cw + (n - 1) * gap)) / 2;
      var hueMap = {
        maxHp: '#e05a7a', dmgPct: T.neg, meleePct: '#c96b3f', rangedPct: T.info, atkSpd: '#e8b45a',
        crit: T.coin, critDmg: '#ff9a4a', armor: '#7f8ea3', dodge: T.info, speedPct: T.pos,
        regen: '#5ad0a0', lifesteal: '#e05a5a', luck: T.luck, harvest: T.pos, rangePct: T.r[2], dmgFlat: '#c96b3f'
      };
      for (var i = 0; i < n; i++) {
        var c = g.levelupChoices[i];
        var px = sx + i * (cw + gap);
        var hot = this.hot(px, py, cw, chh);
        /* v7.2(源对齐) 缎带取这张卡**真的**是哪一档 —— 不再按 stat 名猜 */
        var rar = this.levelupRarity(c);
        var cat = CAT_OF[c.stat] || 'out';
        var pick = (function (choice) {
          return function () { PS.Game.takeLevelup(choice); PS.Game.levelupChoices = null; };
        })(c);
        /* 整卡热区先入 → 卡内「选 它」后入(门禁按 label 前缀 '卡:' 与含 '选' 定位) */
        this.buttons.push({ x: px, y: py, w: cw, h: chh, label: '卡:' + c.name, cb: this.press(px, py, cw, chh, { cb: pick }) });
        x.fillStyle = hot ? this.withA(rar.c, 0.18) : 'rgba(13,19,13,0.90)';
        this.rr(px, py, cw, chh, 16); x.fill();
        x.strokeStyle = hot ? rar.c : this.withA(rar.c, 0.55);
        x.lineWidth = hot ? 3 : 2;
        this.rr(px, py, cw, chh, 16); x.stroke();
        x.save();
        this.rr(px, py, cw, RB, 16); x.clip();
        x.fillStyle = rar.c;
        x.fillRect(px, py, cw, RB);
        x.restore();
        this.text(rar.n, px + cw / 2, py + (PH ? 17 : 20), T.fs.small, T.onGold);
        this.chip(px + (PH ? 10 : 16), py + CHIPY, CAT_NAME[cat], CAT_COL[cat], PH ? 10 : 11);
        var hue = hueMap[c.stat] || T.gold;
        x.fillStyle = hue;
        x.beginPath(); x.arc(px + cw / 2, py + ICY, ICR, 0, PS.TAU); x.fill();
        x.fillStyle = 'rgba(0,0,0,0.4)';
        x.font = 'bold ' + (PH ? 17 : 25) + 'px ' + u.font;
        x.textAlign = 'center';
        x.fillText(c.name.charAt(0), px + cw / 2, py + ICY + (PH ? 6 : 10));
        this.fitText(c.name, px + cw / 2, py + NAMY, INW, T.fs.lead, T.hi, 'center', true, T.fs.body);
        /* critDmg 兜底: 引擎已固定 150%, 池里也过滤 —— 数据表若回流也只写"固定" */
        this.text(c.stat === 'critDmg' ? '按武器' : ('+' + c.v + (c.pct ? '%' : '')),
          px + cw / 2, py + VALY, PH ? T.fs.lead : T.fs.num, T.pos);
        if (c.stat === 'critDmg') {
          /* 源口径: 暴击倍率逐武器自带(critMul), 玩家侧不存在"暴击伤害"成长项 —— 只说明去向 */
          this.fitRich([[this.statLabel(c.stat) + ' ', T.mid], ['由武器决定', T.hi], ['(不进强化池)', T.low]],
            px + cw / 2, py + (PH ? 166 : 232), T.fs.small, INW);
        } else {
          this.deltaLine(c.stat, this.statsAfterUpgrade(c), px + cw / 2, py + DELY, T.fs.small, INW);
        }
        if (!PH) this.fitText(CAT_HINT[cat] || '', px + cw / 2, py + 262, cw - 24, T.fs.micro, T.low, 'center', false);
        this.button(px + BTNPAD, py + chh - BTNOFF, cw - 2 * BTNPAD, BTNH, '选 它', {
          size: PH ? T.fs.small : T.fs.body, cb: pick,
          bg: this.withA(rar.c, 0.20), hoverBg: this.withA(rar.c, 0.32),
          border: this.withA(rar.c, 0.65), hoverBorder: rar.c
        });
      }
      /* ---- 页脚: 波末口径 + 固定暴击伤害 + 幸运收益 ----
       * 手机只留一行(两行在 354 高的版式空间里放不下), 桌面两行原样。 */
      var lk = this.luckInfo();
      if (PH) {
        this.fitText('第 ' + g.wave + ' 波 · 已强化 ' + ((g.levelups || []).length) + ' 项 · 运气 ' + lk.luck
          + ' · 商店高品质(稀有+) ' + lk.pct + '%', W / 2, 344, W - 32, T.fs.small, T.luck, 'center', false);
      } else {
        this.fitText('第 ' + g.wave + ' 波 · 本局已强化 ' + ((g.levelups || []).length) + ' 项 · 暴击倍率由武器自带(逐武器固定, 不进强化池)',
          W / 2, 586, W - 160, T.fs.small, T.mid, 'center', false);
        this.text('运气 ' + lk.luck + ' · 商店高品质(稀有+) ' + lk.pct + '% · 白送道具 ' + lk.chance
          + '%(本波已出 ' + ((g.itemsSpawnedThisWave || 0)) + ' 件, 再中一件 ' + lk.nextChance + '%)',
          W / 2, 612, T.fs.small, T.luck, 'center', false);
      }
    },

    /* ================= 商店(波间) =================
     * 3 秒口径(spec §5): 名称/稀有度/阶数 → 词条 → 一句 desc → 面板增量 → 价格与差额。
     * 热区: 整卡(先入, 可买) + 价格钮 + 锁定钮(后入 ⇒ 优先, 绝不误触整卡)。 */
    /* drawLevelup 的出口保底: 只有升级池为空(数据表异常)时才会走到这里 —— 给一个明确可点的「继续」。 */
    drawLevelupEmpty: function () {
      var x = this.ctx, u = this.ui;
      var PH = this.uiScale() > 1;
      var W = PH ? this.uiW() : u.W, H = PH ? this.uiH() : u.H;
      if (this.uiScale() === 1) this.fillScreen(T.scrim);
      this.plate((W - 760) / 2, 236, 760, 208, 16, 0.94, T.edge);
      this.text('本次强化没有可选卡片', W / 2, 300, T.fs.title, T.coin);
      this.text('升级池数据异常(池为空)。点下面继续, 不会丢进度。', W / 2, 342, T.fs.body, T.mid, 'center', false);
      this.button(W / 2 - 130, 370, 260, 52, '继续', {
        size: T.fs.lead, cb: function () { PS.Game.skipLevelup(); },
        bg: this.withA(T.pos, 0.22), hoverBg: this.withA(T.pos, 0.34),
        border: this.withA(T.pos, 0.7), hoverBorder: T.pos
      });
    },

    /* ================= 商店 =================
     * v6.0(UI 重做) 信息架构: 顶栏一条(标题 · 材料 · 刷新) / 左上 4 张商品卡 / 左下已持有道具行 /
     *   中下武器槽(N/6) / 右侧一列到底的常驻属性面板(主要 · 次要 两档) / 右下显式「出发」。
     * 门禁契约(来自 tools/shop-click-check.cjs 与 tools/verify-ui.cjs, 不许改):
     *   · 每张未售出的卡都有整卡热区 label='卡:'+def.name —— 门禁按它反查卡面矩形与"卡面空位"点击点;
     *   · 卡内必须有 '★' 开头的价格钮与含「锁定」的钮, 且两者都完整落在卡面矩形内;
     *   · 卡面中轴 py+120 处不许被任何卡内按钮覆盖(那是门禁点名的"名称区"), 点它必须买到卡 ——
     *     负向对照正是抽掉整卡热区后验证这一点失效;
     *   · 买不起时价格钮必须 disabled(按钮不入热区表): 点击穿透到整卡热区, 由 buyCard 的内部守卫拒单。 */
    drawShop: function () {
      var x = this.ctx, u = this.ui, W = u.W, H = u.H, g = PS.Game, i;
      this.fillScreen(T.scrim);
      var TIERN = PS.WeaponData.tierName;
      var cards = g.shopCards || [];
      var lk = this.luckInfo();

      /* ---------- 顶栏 16..1264 × 12..96 ---------- */
      this.plate(16, 12, 1248, 84, 16, 0.92, T.edge);
      this.text('商店(第 ' + g.wave + ' 波)', 40, 48, T.fs.title, T.coin, 'left');
      this.fitText('等级 ' + g.level + ' · 已强化 ' + ((g.levelups || []).length) + ' 项 · 生命 '
        + Math.ceil(g.player ? g.player.hp : 0) + '/' + g.stats.maxHp + ' · 运气 ' + lk.luck
        + ' · 商店高品质(稀有+) ' + lk.pct + '%', 40, 84, 930, T.fs.small, T.mid, 'left', false, 10.5);
      /* 材料(唯一货币): 图标 + 大字, 顶栏正中 */
      var numTxt = '' + g.material;
      var lw = this.textW('材料', T.fs.micro), nw = this.textW(numTxt, T.fs.numLg);
      var gx = Math.round(620 - (lw + 8 + 26 + 8 + nw) / 2);
      this.text('材料', gx, 62, T.fs.micro, T.low, 'left', false);
      this.coinIcon(gx + lw + 21, 52, 12);
      this.text(numTxt, gx + lw + 42, 62, T.fs.numLg, T.pos, 'left');
      /* 刷新: 费用按**引擎口径**现算(免费次数优先, 再减 rerollDiscount) —— 卡面写的必须是要扣的那个数 */
      var rcost = g.freeRerolls > 0 ? 0 : Math.max(0, B.rerollPrice(g.wave, g.rerolls) - (g.stats.rerollDiscount || 0));
      var rAff = rcost <= g.material;
      this.button(1012, 26, 228, 56, '刷新', {
        size: T.fs.lead,
        sub: g.freeRerolls > 0 ? ('免费 ×' + g.freeRerolls)
          : (rAff ? ('★' + rcost + ' · 已刷 ' + g.rerolls + ' 次') : ('还差 ★' + (rcost - g.material))),
        subColor: rAff ? T.mid : T.neg,
        disabled: !rAff, id: 'reroll',
        cb: function () { PS.Game.rerollShop(); }
      });

      /* ---------- 4 张商品卡(左上) ---------- */
      var cgap = 14, ctop = 100, chh = 352;
      var nCards = Math.max(1, cards.length);
      var cw = Math.max(176, Math.floor((968 - cgap * (nCards - 1)) / nCards));
      for (i = 0; i < cards.length; i++) {
        var c = cards[i];
        /* 空槽位(工具/调试路径会把某几位留成 null): 保留格子坐标, 不把后面的卡往前挤, 也不许读 c.kind */
        if (!c) continue;
        var px = 16 + i * (cw + cgap), py = ctop;
        var isW = c.kind === 'weapon';
        var def = isW ? (PS.WeaponData.list[c.key] || {}) : (PS.ItemData.byId(c.id) || {});
        var name = def.name || (isW ? c.key : c.id) || '?';
        var rar = RARITY[c.tier] || RARITY[1];
        var locked = !!(g.lockedCards && g.lockedCards[i]) && !c.sold;
        var afford = g.material >= c.price;
        var hot = !c.sold && this.hot(px, py, cw, chh);
        var buyFn = (function (idx) { return function () { PS.Game.buyCard(idx); }; })(i);
        /* 整卡热区先入 -> 卡内按钮后入(dispatchTap 从后往前取, 按钮优先) */
        /* v7.11(用户「只要材料够按到道具或武器就直接购买了」): 整卡热区 = 打开详情页,
           购买只剩卡内那颗「★ 价格」按钮(下方 buypb)与详情页里的「购买」。 */
        if (!c.sold) this.buttons.push({ x: px, y: py, w: cw, h: chh, label: '卡:' + name,
          cb: this.press(px, py, cw, chh, { cb: (function (idx) { return function () { PS.Game.openShopDetail(idx); }; })(i) }) });
        x.fillStyle = c.sold ? 'rgba(7,11,7,0.55)'
          : locked ? this.withA(T.luck, 0.10)
            : hot ? this.withA(rar.c, 0.16) : 'rgba(13,19,13,0.90)';
        this.rr(px, py, cw, chh, 14); x.fill();
        /* 稀有度色**只在悬停时满值**: 4 张卡并排时 2px 满值描边会四条边一起喊(实测截图读成灰格子阵),
           而稀有度已由顶部缎带承担; 静态降到 0.5 只是让卡「立得住」, 不抢缎带。 */
        x.strokeStyle = c.sold ? T.weak : (locked ? T.luck : this.withA(rar.c, hot ? 1 : 0.5));
        x.lineWidth = hot ? 2.5 : 2;
        this.rr(px, py, cw, chh, 14); x.stroke();
        if (locked) {
          x.strokeStyle = T.luck; x.lineWidth = 2;
          this.rr(px + 4, py + 4, cw - 8, chh - 8, 11); x.stroke();
        }
        if (c.sold) {
          x.fillStyle = this.withA(T.mid, 0.75);
          x.font = 'bold ' + T.fs.num + 'px ' + u.font;
          x.textAlign = 'center';
          x.fillText('已 售', px + cw / 2, py + 156);
          continue;
        }
        /* 色带: 稀有度 + 类别(道具 / 近战 II) —— 走统一缎带口径。
           ⚠ 升级卡的缎带**不在此处**(drawLevelup 自己画, 且被真像素门禁钉住)。 */
        this.ribbon(px, py, cw, 28, rar.c, 14);
        this.fitText(rar.n + ' · ' + (isW ? ((def.cls === 'melee' ? '近战 ' : '远程 ') + (TIERN[c.tier - 1] || '')) : '道具'),
          px + cw / 2, py + 19, cw - 20, T.fs.small, T.onGold, 'center', true, 10);
        /* 决策提示条: 买下/合掉之后会发生什么(源口径见 game.js buyCard) */
        var hint = '', hintCol = T.pos;
        if (isW) {
          var up = PS.WeaponData.tierUp[c.key];
          var own = this.ownedWeapons(c.key, c.tier);
          var fam = this.ownedFamily(c.key);            /* 同**族**件数(含异阶) —— 玩家眼里的"同名" */
          var full = g.weapons.length >= ((g.stats && g.stats.weaponSlot) || B.WEAPON_SLOTS);
          if (own.sameTier && up) hint = '✓ 同名同阶 · 买入即「合」升 ' + TIERN[c.tier] + ' 阶';
          else if (fam > 0 && !up) { hint = '同名已满阶 · 无提升'; hintCol = T.mid; }
          else if (fam > 0) { hint = '已有同名(异阶) · 需 2 把同阶才能「合」'; hintCol = T.mid; }
          else if (full) { hint = '武器栏已满 · 先「卖」一把'; hintCol = T.neg; }
          else { hint = '未持有 · 买下即上阵'; }
        } else {
          var ownI = this.ownedItems(c.id);
          if (ownI > 0) { hint = '已持有 ' + ownI + ' 件 · 可叠加'; hintCol = T.mid; }
          else { hint = '未持有 · 买下立即生效'; hintCol = T.pos; }
        }
        if (hint) {
          x.fillStyle = this.withA(hintCol, 0.14);
          this.rr(px + 8, py + 32, cw - 16, 22, 8); x.fill();
          this.fitText(hint, px + cw / 2, py + 47, cw - 24, T.fs.micro, hintCol, 'center', true, 9.5);
        }
        /* 图标台: 武器画真模型(与战斗里同一批), 道具走 PS.Art.drawItemIcon 的族模型 */
        if (isW) {
          this.plate(px + 20, py + 60, cw - 40, 56, 10, 0.42, this.withA(rar.c, 0.5));
          this.weaponIcon(c.key, px + cw / 2, py + 88, 24, { tier: c.tier, def: def, rot: -0.3 });
        } else this.itemIcon(def, px + cw / 2, py + 88, 24);
        /* 名称 */
        this.fitText(name, px + cw / 2, py + 138, cw - 24, T.fs.lead, T.hi, 'center', true, T.fs.body);
        /* 类别行: 武器给"系"标签(元素/结构/穿透…), 道具给持有数 */
        var idTxt;
        if (isW) {
          var tags = (def.cls === 'melee' ? '近战' : '远程');
          if (def.elem) tags += ' · 元素系';
          if (def.structure) tags += ' · 结构体';
          if (def.pierce >= 3) tags += ' · 穿透';
          if (def.aoe) tags += ' · 溅射';
          if (def.orbitCount) tags += ' · 环绕';
          if (def.boomerang) tags += ' · 回旋';
          idTxt = tags;
        } else {
          var ownN = this.ownedItems(c.id);
          idTxt = '道具 · ' + (ownN > 0 ? ('已持有 ' + ownN + ' 件') : '未持有');
        }
        this.fitText(idTxt, px + cw / 2, py + 158, cw - 24, T.fs.micro, T.mid, 'center', false, 9.5);
        x.strokeStyle = T.weak; x.lineWidth = 1;
        x.beginPath(); x.moveTo(px + 12, py + 168); x.lineTo(px + cw - 12, py + 168); x.stroke();
        /* 效果明细: 逐条列**全部**真实数值。
           道具 = 它的 mods 词条; 武器 = 武器表自己的 dmg/atkCd/range/knock + 逐武器自带的暴击倍率。
           行数按卡内可用高度现算(末行硬上限 py+170 之下 4 行), 超出让最后一行给「… 共 N 条效果」。 */
        /* v7.11: 词条装配抽成 this.cardRows —— 商店卡(有行上限)与详情页(不截断)必须
           是**同一份**数据, 否则"完整属性"会与卡面写的不一致。 */
        var cr = this.cardRows(c, def, isW), rows = cr.rows, keys = cr.keys, ki;
        var lay = this.rowLayout(rows), cut = !!lay.announcement;
        var my = py + 182;
        for (ki = 0; ki < lay.shown; ki++) {
          this.fitText(rows[ki].t, px + cw / 2, my, cw - 24, T.fs.micro, rows[ki].c, 'center', true, 9.5);
          my += 15;
        }
        if (lay.announcement) this.fitText(lay.announcement, px + cw / 2, my, cw - 24, T.fs.micro, T.low, 'center', false, 9.5);
        /* 买下之后**第一个真正变化**的词条(现算自引擎聚合; 卡面没写的通道也认 —— 见 firstDelta) */
        var after = isW ? this.statsAfterWeapon(c.key, c.tier) : this.statsAfterItem(c.id);
        var dl = this.firstDelta(after, isW ? [] : keys);
        if (dl) {
          this.fitRich([[this.statLabel(dl.stat) + ' ', T.mid],
            [this.fmtStat(dl.stat, dl.cur, dl.pct), T.low], [' → ', T.low],
            [this.fmtStat(dl.stat, dl.next, dl.pct), this.signColor(dl.stat, dl.next - dl.cur)]], px + cw / 2, py + 256, T.fs.small, cw - 24);
        } else {
          this.fitText(isW ? '装上即上阵 · 占 1 个武器槽' : '买下立即生效 · 不占武器槽',
            px + cw / 2, py + 256, cw - 24, T.fs.micro, T.low, 'center', false, 9.5);
        }
        /* 一句描述: 道具恒画; 武器只在词条被「… 共 N 条效果」截断时画 —— 这一行正好补回被吃掉的那几条数值 */
        if (def.desc && (!isW || cut)) {
          this.fitText(def.desc, px + cw / 2, py + 274, cw - 24, T.fs.micro, T.mid, 'center', false, 9.5);
        }
        /* 底行: 价格(带余额走势) + 锁定 */
        var lockW = 76, priceW = cw - 24 - lockW - 6;
        var sub, subCol;
        if (afford) { sub = g.material + ' → ' + (g.material - c.price); subCol = T.mid; }
        else { sub = '还差 ★' + (c.price - g.material); subCol = T.neg; }
        this.button(px + 12, py + 296, priceW, 44, '★ ' + c.price, {
          size: T.fs.body, sub: sub, subColor: subCol,
          bg: afford ? undefined : 'rgba(13,19,13,0.5)',
          border: afford ? undefined : T.weak,
          color: afford ? T.coin : this.withA(T.hi, 0.55),
          disabled: !afford, id: 'buypb' + i, cb: buyFn
        });
        this.button(px + 18 + priceW, py + 296, lockW, 44, locked ? '已锁定' : '锁定', {
          size: T.fs.small, bold: false,
          bg: locked ? this.withA(T.luck, 0.18) : 'rgba(13,19,13,0.55)',
          hoverBg: locked ? this.withA(T.luck, 0.28) : 'rgba(255,255,255,0.10)',
          border: locked ? T.luck : T.weak, hoverBorder: locked ? T.luck : T.gold,
          color: locked ? T.luck : T.mid,
          cb: (function (idx2) { return function () { PS.Game.toggleLock(idx2); }; })(i)
        });
        if (locked) this.lockIcon(px + cw - 16, py + 318, 7, true, T.luck);
      }

      /* ---------- 左下: 已持有道具行 / 中下: 武器槽 ---------- */
      this.drawShopItems(16, 460, 540, 228);
      this.drawShopWeapons(568, 460, 416, 228);

      /* ---------- 右侧一列到底: 常驻属性面板 ---------- */
      var foot = '波末收入 ★+' + (g.harvestBonus || 0);
      /* v7.9: 待裁决的掉落必须写在这一行 —— 裁决遮罩正盖着商店, 玩家一眼能看到"哪一件还没处理"。 */
      if (g.boxItem) {
        var bxd = PS.ItemData.byId(g.boxItem.id);
        foot = '★ 波末掉落待裁决「' + (bxd ? bxd.name : g.boxItem.id) + '」'
          + ((g.pendingBoxes || []).length > 1 ? (' ×' + g.pendingBoxes.length) : '');
      } else if (g.luckDropItem) {
        var ld = PS.ItemData.byId(g.luckDropItem);
        foot = '幸运掉落「' + (ld ? ld.name : g.luckDropItem) + '」';
      } else foot += ' · 下波掉落率 ' + lk.nextChance + '%';
      this.drawShopStats(1000, 100, 264, 520, { foot: foot });

      /* ---------- 右下: 显式出发(波次推进会怎样写在这里, 不藏在角落) ---------- */
      this.button(1000, 632, 264, 64, '出发 · 下一波', {
        size: T.fs.lead, bg: this.withA(T.pos, 0.22), hoverBg: this.withA(T.pos, 0.34),
        border: this.withA(T.pos, 0.7), hoverBorder: T.pos, id: 'shop-depart',
        sub: '进入第 ' + (g.wave + 1) + ' 波',
        cb: function () { PS.Game.nextWave(); }
      });
      /* v7.9(用户「把原版道具掉落可自行选择拾取或丢弃机制加进来」): 裁决层是商店页之上的一层遮罩 ——
       *   本帧**最后**画, 所以它的热区在表尾, dispatchTap 的逆序扫描先命中它(不会被底下的商店卡抢走)。 */
      if (g.boxItem) this.drawBoxOverlay();
      else this.drawShopDetail();
      x.textAlign = 'center';
    },
    /* ---------- 材料币(纯矢量, 不用字形) ----------
     * 商店顶栏唯一的货币读数用它替掉「★」: 一眼看出"这是钱", 且不依赖字体里有没有 ★
     *   (小游戏端缺字会把特殊符号画成豆腐块 —— 齿轮图标当初就是为同一个理由改成矢量的)。 */
    coinIcon: function (cx, cy, r, color) {
      var x = this.ctx;
      x.save();
      x.translate(cx, cy);
      x.fillStyle = color || T.coin;
      x.beginPath(); x.arc(0, 0, r, 0, PS.TAU); x.fill();
      x.fillStyle = 'rgba(8,12,8,0.45)';
      x.beginPath();
      x.moveTo(-r * 0.46, r * 0.06);
      x.quadraticCurveTo(0, -r * 0.8, r * 0.46, r * 0.06);
      x.quadraticCurveTo(0, r * 0.5, -r * 0.46, r * 0.06);
      x.closePath(); x.fill();
      x.strokeStyle = 'rgba(8,12,8,0.45)';
      x.lineWidth = Math.max(1, r * 0.13);
      x.beginPath(); x.moveTo(0, -r * 0.52); x.lineTo(0, r * 0.28); x.stroke();
      x.restore();
    },

    /* ---------- 右侧常驻属性面板(商店 / 暂停 / 结算共用一块) ----------
     * 信息架构: 「主要 / 次要」两档 × 每档 10 行; 行 = 词条名(左) + 现值(右, 按正负着色)。
     * 三条口径:
     *   ① 名字一律取 STAT_NAME —— 同一通道在卡面词条与面板里必须同名, 不许出现两套译名;
     *   ② 数值一律**现算自 g.stats**(引擎聚合), 面板不缓存任何派生值 —— 商店买完下一帧就该变;
     *   ③ 认不出的通道整行不画 —— 绝不把 undefined / NaN 印到屏幕上(verify-ui 的数值泄漏审计口径)。
     * 百分比通道读 `<key>Sum`: stats.js 把 dmgPct 落盘成"小数"(12% → 0.12), 原始百分点在 Sum 里 ——
     *   pctSumKey() 已封装这条规则, 这里只调用、不另写一份。 */
    STAT_TABS: [
      { id: 'main', name: '主要',
        rows: ['level', 'maxHp', 'regen', 'lifesteal', 'dmgPct', 'meleeDmg', 'rangedDmg', 'eleDmg', 'atkSpd', 'crit'] },
      { id: 'alt', name: '次要',
        rows: ['engDmg', 'rangeFlat', 'armor', 'dodge', 'speedPct', 'luck', 'harvest', 'pickup', 'thorns', 'dmgFlat'] }
    ],
    /* level 不是 stats 通道(它是波内经验等级), 单独给名字; 其余走 STAT_NAME */
    STAT_PANEL_NAME: { level: '目前等级' },
    statPanelName: function (k) { return this.STAT_PANEL_NAME[k] || this.STAT_NAME[k] || k; },
    /* 面板行的现值 { t: 文本, c: 颜色 }; 通道在 stats 里不存在 -> null(整行不画) */
    statPanelValue: function (k) {
      var g = PS.Game, s = g.stats || {};
      var num = function (v) { return (typeof v === 'number' && isFinite(v)) ? v : 0; };
      if (k === 'level') return { t: 'LV ' + g.level, c: T.info };
      if (k === 'maxHp') return { t: Math.max(0, Math.ceil(g.player ? g.player.hp : 0)) + ' / ' + num(s.maxHp), c: T.pos };
      var v = s[this.pctSumKey(k)];
      if (typeof v !== 'number' || !isFinite(v)) return null;
      var txt;
      if (k === 'regen') txt = '' + (Math.round(v * 10) / 10);
      else if (k === 'lifesteal') txt = (Math.round(v * 10) / 10) + '%';   /* 源口径: 每次命中回血的概率 */
      else if (this.STAT_PCT[k]) txt = Math.round(v) + '%';
      else txt = '' + Math.round(v);
      return { t: txt, c: v > 0 ? T.pos : (v < 0 ? T.neg : T.mid) };
    },
    /* 一行属性: 左色标 + 词条名 + 右现值 + 一条极淡的行线(往下扫不串行) */
    statRow: function (px, py, w, label, value, col) {
      var x = this.ctx;
      x.fillStyle = this.withA(T.gold, 0.55);
      this.rr(px, py - 5, 3, 11, 1.5); x.fill();
      this.fitText(label, px + 12, py, w - 104, T.fs.small, T.hi, 'left', false, 10);
      this.fitText(value, px + w, py, 78, T.fs.lead, col, 'right', true, 11);
      x.strokeStyle = T.weak; x.lineWidth = 1;
      x.beginPath(); x.moveTo(px, py + 9); x.lineTo(px + w, py + 9); x.stroke();
    },
    /* 面板用的候选通道(顺序 = 展示优先级): 只用来找"买下后第一个变化的词条" */
    PANEL_CHAN: ['maxHp', 'regen', 'lifesteal', 'dmgPct', 'meleeDmg', 'rangedDmg', 'eleDmg', 'engDmg',
      'atkSpd', 'crit', 'armor', 'dodge', 'speedPct', 'rangeFlat', 'luck', 'harvest', 'dmgFlat', 'pickup', 'thorns'],
    /* 买下这张卡之后**第一个真正变化**的词条(现算): 先扫卡面自己的词条, 再扫候选通道; 都没变返回 null。
     * 为什么扫全通道: 道具的 scale/cond(如「每件普通道具 +1 生命恢复」)会让卡面没写的通道也变 ——
     *   旧实现只看 keys[0], 那类卡永远显示不出"买完会变什么"。 */
    firstDelta: function (after, keys) {
      var g = PS.Game, i, k, d, seen = {};
      var scan = function (arr) {
        for (var q = 0; q < arr.length; q++) {
          k = arr[q];
          if (seen[k]) continue;
          seen[k] = 1;
          d = this.deltaOf(g.stats, after, k, !!this.STAT_PCT[k]);
          if (d && d.changed) return { stat: k, cur: d.cur, next: d.next, pct: d.pct };
        }
        return null;
      };
      return scan.call(this, keys || []) || scan.call(this, this.PANEL_CHAN);
    },
    /* ================= v7.9 波末掉落裁决(源 item_box 的波末二选一) =================
     * 用户逐字:「把原版道具掉落可自行选择拾取或丢弃机制加进来」。源链路 = Brotato 的 item_box:
     *   掉一个箱子 → 捡起来时因 to_be_processed_at_end_of_wave 攒着 → 波末 upgrades_ui 弹卡 →
     *   Take(入包) / Recycle(回收折价) 二选一(main.gd:1139-1157, 引擎侧见 game.js::takeBox/discardBox)。
     * 本作把这张卡画在**商店页之上**(同一个 SHOP 状态, 不新增 State ⇒ 世界照样冻结, 机器侧不用改):
     *   · 先铺 scrim 压暗底下的商店;
     *   · 再画一张道具卡(缎带 / 图标 / 名称 / 逐条词条 / 一句描述) —— 件是 PS.ItemData 的真件, 图标与
     *     词条装配与商店卡走**同一套**件(itemIcon / itemEffectRows / rowLayout), 不另建一份;
     *   · 最后两颗按钮「拾取」「丢弃 ★+N」。
     * 第一条入表的是**整屏遮罩**(空 cb): dispatchTap 逆序扫描 ⇒ 两颗按钮永远优先, 其余点击被遮罩吃掉,
     *   裁决期间点不到底下的商店卡 / 锁定 / 出发(即"必须裁决才能继续")。
     * 遮罩**不进 btnRects**: verify-ui 的「文字不得压按钮」是以 btnRects 为准的, 整屏矩形会把每一行字
     *   都判成压按钮(假红)。btnRects 只登记 button() 画出来的真按钮, 与它的既有语义一致。
     * 按钮题字用「拾取」「丢弃」而不是「取」「丢」: 门禁按 label 反查热区, 真人也一眼看明白。 */
    drawBoxOverlay: function () {
      var x = this.ctx, u = this.ui, W = u.W, H = u.H, g = PS.Game;
      var box = g.boxItem; if (!box) return;
      var def = PS.ItemData.byId(box.id) || { id: box.id, name: box.id, mods: {}, desc: '' };
      var rar = RARITY[box.tier] || RARITY[1];
      var left = (g.pendingBoxes || []).length;
      this.fillScreen('rgba(4,7,4,0.86)');
      var pw = 640, ph = 460, px = Math.round((W - pw) / 2), py = Math.round((H - ph) / 2);
      this.plate(px, py, pw, ph, 18, 0.97, T.edge);
      /* 缎带: 与商店卡同形(稀有度色 + 一行标题) */
      x.save(); this.rr(px + 12, py + 14, pw - 24, 30, 12); x.clip();
      x.fillStyle = rar.c; x.fillRect(px, py + 14, pw, 30); x.restore();
      this.fitText('第 ' + g.wave + ' 波结束 · 掉落裁决 · ' + rar.n + ' · 道具'
        + (left > 1 ? (' · 本波还有 ' + (left - 1) + ' 件待裁决') : ''),
        px + pw / 2, py + 35, pw - 50, T.fs.small, T.onGold, 'center', true, 10);
      /* 图标台 + 名称 */
      this.plate(px + pw / 2 - 48, py + 56, 96, 78, 12, 0.42, this.withA(rar.c, 0.55));
      this.itemIcon(def, px + pw / 2, py + 95, 30);
      this.fitText(def.name || box.id, px + pw / 2, py + 160, pw - 60, T.fs.title, T.hi, 'center', true, T.fs.lead);
      var ownN = this.ownedItems(def.id || box.id);
      this.fitText('道具 · ' + rar.n + ' · ' + (ownN > 0 ? ('已持有 ' + ownN + ' 件 · 可叠加') : '未持有'),
        px + pw / 2, py + 186, pw - 60, T.fs.micro, T.mid, 'center', false, 9.5);
      /* 逐条词条(与商店卡同一份装配: 数据算得对 == 玩家看得见) */
      var irows = this.itemEffectRows(def, this.modKeys(def.mods || {}));
      var lay = this.rowLayout(irows);          /* rowLayout 只回 {total, shown, announcement} —— 行本身取自 irows */
      var ry = py + 212, ki;
      for (ki = 0; ki < lay.shown; ki++) {
        this.fitText(irows[ki].t, px + pw / 2, ry, pw - 90, T.fs.body, irows[ki].c, 'center', true, 10.5);
        ry += 19;
      }
      if (lay.announcement) this.fitText(lay.announcement, px + pw / 2, ry, pw - 90, T.fs.micro, T.low, 'center', false, 9.5);
      if (def.desc) this.fitText(def.desc, px + pw / 2, py + 318, pw - 90, T.fs.small, T.mid, 'center', false, 10);
      /* 整屏遮罩: 必须**先于**两颗按钮入表(逆序扫描 ⇒ 后入的先命中) */
      this.buttons.push({ x: 0, y: 0, w: W, h: H, label: '裁决遮罩', cb: function () {} });
      var val = g.boxRecycleValue();
      var bw = 262, bh = 64, by = py + ph - 92;
      this.button(px + 32, by, bw, bh, '拾取', {
        size: T.fs.lead, id: 'box-take',
        sub: '进背包 · 立刻生效',
        bg: this.withA(T.pos, 0.22), hoverBg: this.withA(T.pos, 0.34),
        border: this.withA(T.pos, 0.7), hoverBorder: T.pos,
        cb: function () { PS.Game.takeBox(); }
      });
      this.button(px + pw - 32 - bw, by, bw, bh, '丢弃 ★+' + val, {
        size: T.fs.lead, id: 'box-discard',
        sub: '不拿这件 · 换回 ' + val + ' 材料',
        subColor: T.coin,
        bg: this.withA(T.coin, 0.18), hoverBg: this.withA(T.coin, 0.30),
        border: this.withA(T.coin, 0.7), hoverBorder: T.coin,
        cb: function () { PS.Game.discardBox(); }
      });
      this.fitText('拾取 = 立刻进背包 · 丢弃 = 不拿, 按源 item_service.gd:732-742 折价换回材料',
        px + pw / 2, py + ph - 14, pw - 60, T.fs.micro, T.low, 'center', false, 9.5);
    },


    /* v7.11(用户: ① 点按卡片要能看全属性 ② 只有点「购买」按钮才能购买):
     *   商店卡面热区现在只**打开**这一层 —— 卡面被 rowLayout 的 5 行上限吃掉的那几条,
     *   在这里全部画出来; 购买只剩这一层的一颗「购买 ★N」(与卡内价格钮走同一个 buyCard)。
     *   与 drawBoxOverlay 同构: 整屏遮罩先入表(吃掉穿透点击) -> 面板挡板(点面板不关) -> 按钮。 */
    drawShopDetail: function () {
      var x = this.ctx, u = this.ui, W = u.W, H = u.H, g = PS.Game;
      var idx = g.shopDetail;
      if (idx == null) return;
      var c = (g.shopCards || [])[idx];
      if (!c || c.sold) { g.shopDetail = null; return; }
      var isW = c.kind === 'weapon';
      var def = isW ? (PS.WeaponData.list[c.key] || {}) : (PS.ItemData.byId(c.id) || {});
      var name = def.name || c.key || c.id || '?';
      var rar = RARITY[c.tier] || RARITY[1];
      var rows = this.cardRows(c, def, isW).rows;
      var afford = g.material >= c.price;
      this.fillScreen('rgba(4,7,4,0.88)');
      var pw = 620, ph = 560, px = Math.round((W - pw) / 2), py = Math.round((H - ph) / 2);
      this.plate(px, py, pw, ph, 18, 0.97, T.edge);
      x.save(); this.rr(px + 12, py + 14, pw - 24, 30, 12); x.clip();
      x.fillStyle = rar.c; x.fillRect(px, py + 14, pw, 30); x.restore();
      this.fitText(rar.n + ' · ' + (isW ? ((def.cls === 'melee' ? '近战 ' : '远程 ') + (PS.WeaponData.tierName[c.tier - 1] || '')) : '道具')
        + ' · 完整属性', px + pw / 2, py + 35, pw - 50, T.fs.small, T.onGold, 'center', true, 10);
      this.plate(px + 24, py + 56, 76, 66, 12, 0.42, this.withA(rar.c, 0.55));
      if (isW) this.weaponIcon(c.key, px + 62, py + 88, 21, { tier: c.tier, def: def, rot: -0.3 });
      else this.itemIcon(def, px + 62, py + 88, 21);
      /* v8.3(BUG, 用户第 1/2/4 张图「名称卡进物品框中」): 图标框是 (px+24, 宽 76) => 右边缘 px+100,
       *   而这两行从 px+84 起笔 ⇒ 名字的头 16px 画在框上。移到 px+116(与 drawCharDetail 的 px+132 同口径:
       *   框右 + 16 的呼吸位), 右边距同步收 24 保持右边缘不动。 */
      this.fitText(name, px + 116, py + 82, pw - 164, T.fs.lead, T.hi, 'left', true, T.fs.body);
      this.fitText(isW ? ('武器 · 占 1 个武器槽 · ' + (def.desc || '')) : '道具 · 不占武器槽',
        px + 116, py + 106, pw - 164, T.fs.micro, T.mid, 'left', false, 9.5);
      x.strokeStyle = T.weak; x.lineWidth = 1;
      x.beginPath(); x.moveTo(px + 24, py + 132); x.lineTo(px + pw - 24, py + 132); x.stroke();
      /* 全部词条(不截断): 行高 22, 面板高 560 => 至多 12 行, 实际最长的一条 9 行 */
      var ry = py + 156, i;
      for (i = 0; i < rows.length; i++) {
        this.fitText(rows[i].t, px + 44, ry, pw - 88, T.fs.body, rows[i].c, 'left', true, 10.5);
        ry += 22;
      }
      if (!rows.length) { this.fitText('(无词条)', px + 44, ry, pw - 88, T.fs.body, T.mid, 'left', false, 10.5); ry += 22; }
      if (def.desc && !isW) { ry += 4; ry = this.fitLines(def.desc, px + pw / 2, ry, pw - 120, 16, 3, T.fs.micro, T.mid, true) + 18; }
      /* 热区: 遮罩 -> 面板挡板 -> 按钮(逆序扫描, 后入的先命中) */
      this.buttons.push({ x: 0, y: 0, w: W, h: H, label: '详情遮罩', cb: function () { PS.Game.closeShopDetail(); } });
      this.buttons.push({ x: px, y: py, w: pw, h: ph, label: '详情面板', cb: function () {} });
      var by = py + ph - 92, bw = 250;
      var buyFn = (function (ii) { return function () { PS.Game.buyCard(ii); }; })(idx);
      this.button(px + 32, by, bw, 60, '购买 ★' + c.price, {
        size: T.fs.lead, id: 'buy-detail',
        sub: afford ? ('材料 ' + g.material + ' → ' + (g.material - c.price)) : ('还差 ★' + (c.price - g.material)),
        subColor: afford ? T.mid : T.neg,
        bg: afford ? this.withA(T.pos, 0.22) : 'rgba(13,19,13,0.5)',
        hoverBg: afford ? this.withA(T.pos, 0.34) : 'rgba(13,19,13,0.5)',
        border: afford ? this.withA(T.pos, 0.7) : T.weak,
        color: afford ? T.coin : this.withA(T.hi, 0.55),
        disabled: !afford, cb: buyFn
      });
      this.button(px + 32 + bw + 12, by, 120, 60, '关闭', {
        size: T.fs.body, id: 'detail-close', bold: false,
        bg: 'rgba(13,19,13,0.55)', hoverBg: 'rgba(255,255,255,0.10)',
        border: T.weak, hoverBorder: T.gold, color: T.mid,
        cb: function () { PS.Game.closeShopDetail(); }
      });
      this.fitText(afford ? '点「购买」才会扣材料' : '材料不足 · 点「关闭」返回', px + pw - 40, by + 36, 200, T.fs.micro, T.low, 'right', false, 9.5);
    },

    /* 面板本体: opts = { foot, title } —— foot 是底部一行小字(商店给波末收入/掉落, 其它页留空) */
    drawShopStats: function (px, py, w, h, opts) {
      var x = this.ctx, self = this, g = PS.Game;
      opts = opts || {};
      var tabs = this.STAT_TABS;
      var cur = (this._statTab | 0) === 1 ? 1 : 0;
      this.panel(px, py, w, h, { title: opts.title || '属性' });
      /* 两档切换(44 高: 触屏热区达标) */
      var tw = Math.floor((w - 24 - 8) / 2), ty = py + 42;
      for (var t = 0; t < tabs.length; t++) {
        var on = t === cur;
        this.button(px + 12 + t * (tw + 8), ty, tw, 44, tabs[t].name, {
          size: T.fs.body, id: 'stab-' + tabs[t].id,
          bg: on ? this.withA(T.gold, 0.32) : 'rgba(7,11,7,0.55)',
          hoverBg: on ? this.withA(T.gold, 0.40) : 'rgba(255,255,255,0.10)',
          border: on ? T.gold : T.weak, hoverBorder: T.gold,
          color: on ? T.coin : T.mid,
          cb: (function (idx) { return function () { self._statTab = idx; }; })(t)
        });
      }
      /* 行: 间距按面板高度分摊 —— 两档都是 10 行, 所以切档时行位置完全一致(不"跳行");
       * 下方若有「武器羁绊」, 行距还会按上面那套尺子主动让位(见下)。 */
      var rows = tabs[cur].rows, n = rows.length;
      var top = ty + 58, footH = opts.foot ? 26 : 14;
      var pitch = Math.min(40, (h - (top - py) - footH) / Math.max(1, n));
      /* ---------- 武器羁绊(PS.SetsPanel, 独立模块 src/ui/setspanel.js) ----------
       * 本文件只管三件事: 给它量高度、给它一块地、把 u.font 递给它; 套装/档位/计数口径全在模块里(含「只列身上有的」)。
       * 空间冲突: 「属性」两档各 10 行 + 羁绊逐档列表 都要这块 520 高的面板。
       *   先按满配(每套 = 名 + 逐档)分地; 若属性行会被压到密排下限(SETS_MIN_ROW)以下,
       *   就退成「一行一套」的紧凑档 —— 宁可少列档位, 也绝不越界压页脚、压右下角的出发按钮。 */
      var SP = PS.SetsPanel, SDEF = setsDef(), heldSets = [], setsTop = 0, setsRows = 0;
      if (SP && SP.held && SP.height && SP.draw) {
        heldSets = SP.held(g) || [];
        if (heldSets.length) {
          var setsRoom = (py + h - footH - 8) - top - SETS_GAP;      /* 属性行 + 羁绊 合计可用高 */
          /* v5.8(主程) 此处原先写 + SDEF.head —— 那是给 setspanel.js 旧口径(漏算自己那行小标题)打的补丁。
             模块现已自洽(height() 与 draw() 恒等, 见 qa/verify-weapon-sets.cjs [9]), 补偿**必须撤掉**:
             再补一次会让羁绊多占 20px、把属性行挤密到 SETS_MIN_ROW 下限以下。 */
          var setsFull = SP.height(w - 20, { game: g });
          if (setsFull <= setsRoom - n * SETS_MIN_ROW) {             /* 满配放得下: 属性行只让该让的 */
            pitch = Math.max(SETS_MIN_ROW, Math.min(40, (setsRoom - setsFull) / Math.max(1, n)));
          } else {                                                   /* 放不下: 一行一套 + 末行「另有 N 套」 */
            setsRows = Math.max(1, Math.floor((setsRoom - n * SETS_MIN_ROW - SDEF.head) / SDEF.row));
            var setsCompact = SDEF.head + Math.min(heldSets.length, setsRows) * SDEF.row;
            pitch = Math.max(SETS_MIN_ROW, Math.min(40, (setsRoom - setsCompact) / Math.max(1, n)));
          }
          setsTop = top + Math.round(pitch * n) + SETS_GAP;
        }
      }
      for (var i = 0; i < n; i++) {
        var k = rows[i], v = this.statPanelValue(k);
        if (!v) continue;
        this.statRow(px + 14, Math.round(top + i * pitch + pitch * 0.62), w - 28, this.statPanelName(k), v.t, v.c);
      }
      if (setsTop) {                                                 /* 羁绊本体: 文本一律由本文件的文字层落地 */
        if (setsRows) {
          this.drawSetsCompact(px, setsTop, w, setsRows, heldSets);
        } else {
          var setsBuf = [];
          SP.draw(px, setsTop, w - 20, {
            game: g, ctx: x, font: this.ui.font, lines: setsBuf,
            textW: function (s, size, bold) { return self.textW(s, size, bold); }
          });
          this.drawSetsLines(setsBuf, px, w);
        }
      }
      if (opts.foot) {
        x.textAlign = 'left';
        this.fitText(opts.foot, px + 14, py + h - 16, w - 28, T.fs.micro, T.luck, 'left', false, 9.5);
      }
    },
    /* 羁绊满配的文本落地: 模块(lines 模式)只 push {t,x,y,size,col,align,bold}, 字由本文件的 fitText 画
     * —— 字体与全局完全一致, 长套名会自动缩字号/省略号, 也让 verify-ui 的文本审计看得见这一块。 */
    drawSetsLines: function (buf, px, w) {
      for (var i = 0; i < buf.length; i++) {
        var L2 = buf[i];
        var maxW = L2.align === 'right' ? (L2.x - px - 8) : (px + w - L2.x - 8);
        this.fitText(L2.t, L2.x, L2.y, Math.max(24, maxW), L2.size, L2.col, L2.align, L2.bold, 9.5);
      }
    },
    /* 羁绊紧凑档(满配放不下时的退化): 一行一套 = 色点 + 套名 + 「已凑/需凑」计数。
     * 口径与 setspanel.js 一字不差(只列身上有的、达成的那档才标绿, 未激活置灰), 少的只是逐档明细;
     * 放不下的套数由末行「另有 N 套」交代 —— 少列明细, 但不静默丢套装, 也不越界。 */
    drawSetsCompact: function (px, py, w, maxRows, held) {
      var x = this.ctx, g = PS.Game, SD = PS.SetData, D = setsDef(), i;
      if (!SD) return;
      this.text('武器羁绊', px + D.padX, py + 11, D.title, T.gold, 'left', true);
      x.strokeStyle = T.weak; x.lineWidth = 1;
      x.beginPath();
      x.moveTo(px + D.padX * 2 + this.textW('武器羁绊', D.title), py + 7);
      x.lineTo(px + w - D.padX, py + 7);
      x.stroke();
      var total = held.length, show = Math.min(total, total > maxRows ? maxRows - 1 : total);
      for (i = 0; i < show; i++) {
        var id = held[i], st = SD.list[id] || {}, e = (g.sets && g.sets[id]) || null;
        var cnt = e ? e.count : 0, cur = e ? e.idx : -1, yy = py + D.head + i * D.row + 12;
        x.fillStyle = st.color || T.hi;
        this.rr(px + D.padX, yy - 9, D.dot, D.dot, 2.5); x.fill();
        this.fitText(st.name, px + D.padX + D.dot + 7, yy, w - 104, D.title, st.color || T.hi, 'left', true, 10);
        this.fitText(cnt + '/' + (st.tiers ? st.tiers[st.tiers.length - 1].nb : '?') + (cur >= 0 ? '' : ' · 未激活'),
          px + w - D.padX, yy, 84, D.body, cur >= 0 ? T.pos : T.low, 'right', cur >= 0, 9.5);
      }
      if (total > show) {
        this.fitText('另有 ' + (total - show) + ' 套(空间不足未列)', px + D.padX + D.dot + 7,
          py + D.head + show * D.row + 12, w - 40, D.body, T.low, 'left', false, 9.5);
      }
    },
    /* 道具栏 —— 量级承载: 池子已 163 件, 一局手上的件数上限远超 12。
     * v6.0: 12 格/页(6 列 × 2 行) + 页码 + 「最近 6 件」名字行(图标认不出是哪件时, 这行能读出来)。
     * 热区: 只有两个 44×44 翻页钮(首/末页自动 disabled 不入热区), 与商店整卡热区零交集。 */
    ITEMS_PER_PAGE: 12,
    drawShopItems: function (px, py, w, h) {
      var x = this.ctx, self = this, g = PS.Game;
      var per = this.ITEMS_PER_PAGE;
      var pages = Math.max(1, Math.ceil(g.items.length / per));
      var page = Math.min(Math.max(0, this._itemPage || 0), pages - 1);
      this._itemPage = page;
      this.panel(px, py, w, h, {
        title: '道具 ' + g.items.length + ' 件',
        note: pages > 1 ? ('第 ' + (page + 1) + '/' + pages + ' 页') : '已持有'
      });
      if (!g.items.length) {
        this.text('还没有道具 —— 买一件就能立刻变强', px + w / 2, py + h / 2 + 4, T.fs.small, T.low, 'center', false);
        return;
      }
      var from = page * per, i, idef, j;
      for (i = from; i < g.items.length && i < from + per; i++) {
        var k = i - from;
        idef = PS.ItemData.byId(g.items[i].id || g.items[i]);
        if (!idef) continue;
        var icx = px + 34 + (k % 6) * 74, icy = py + 66 + Math.floor(k / 6) * 62;
        this.plate(icx - 24, icy - 24, 48, 48, 8, 0.5, this.withA((RARITY[idef.rarity] || RARITY[1]).c, 0.55));
        this.itemIcon(idef, icx, icy, 16);
      }
      /* 最近 6 件的**名字**: 图标之外给一份可读的清单(道具池 163 件, 图标不可能全认得出) */
      var names = [];
      for (j = Math.max(0, g.items.length - 6); j < g.items.length; j++) {
        var nd = PS.ItemData.byId(g.items[j].id || g.items[j]);
        if (nd) names.push(nd.name);
      }
      if (names.length) {
        this.fitText('最近: ' + names.join(' · '), px + 14, py + h - 44, w - 28, T.fs.micro, T.low, 'left', false, 9.5);
      }
      if (pages > 1) {
        var bx2 = px + w - 56;
        this.button(bx2, py + 54, 44, 44, '‹', {
          size: T.fs.lead, disabled: page <= 0, id: 'itemprev',
          cb: function () { self._itemPage = page - 1; }
        });
        this.button(bx2, py + 106, 44, 44, '›', {
          size: T.fs.lead, disabled: page >= pages - 1, id: 'itemnext',
          cb: function () { self._itemPage = page + 1; }
        });
      }
    },
    /* 武器槽(卖 / 合; 热区全部 ≥44×44)
     * v6.0: 标题给出 **槽位计数 N/6**(上限来自 weapon_slot 升级卡, 不是写死的 6), 每页 4 格(2×2),
     *   格内保留"模型舱"(真比例模型) —— 一眼看得出栏里是把什么武器; 分页保证所有槽位可操作。
     * 门禁契约(不许改):
     *   · 「卖」label 恰为 '卖'、「合」label 恰为 '合' —— verify-fuse / probe-fuse-play 按 label 反查,
     *     并按**绘制顺序**把第 k 个「合」当成第 k 个槽位(所以槽位必须按 index 顺序画);
     *   · 异阶不可合: 「合」必须 disabled(不入热区表), 且点下去什么都不发生;
     *   · 满阶 T4 不画「合」;未知 key / 越界 tier 的卖价显示「★—」, 绝不印 NaN。 */
    drawShopWeapons: function (px, py, w, h) {
      var x = this.ctx, self = this, u = this.ui, g = PS.Game;
      var per = 4, pages = Math.max(1, Math.ceil(g.weapons.length / per));
      var page = Math.min(Math.max(0, this._weaponPage || 0), pages - 1);
      this._weaponPage = page;
      var capW = (g.stats && g.stats.weaponSlot) || B.WEAPON_SLOTS;
      this.panel(px, py, w, h, {
        title: '武器槽 ' + g.weapons.length + '/' + capW,
        note: (pages > 1 ? ('第 ' + (page + 1) + '/' + pages + ' 页 · ') : '') + '同名同阶 ×2 →「合」升阶'
      });
      if (!g.weapons.length) {
        this.text('空手上阵 —— 商店的武器卡买下就装在这里', px + w / 2, py + h / 2 + 4, T.fs.small, T.low, 'center', false);
        return;
      }
      var sw = 168, shh = 70;
      var from = page * per;
      for (var i = from; i < g.weapons.length && i < from + per; i++) {
        var slot = g.weapons[i], wdef = PS.WeaponData.list[slot.key] || {};
        /* 兜底: key 查不到(移植期改名 / 旧存档残留)时价格会算成 NaN —— 先夹紧 tier, 算不出来就返回 null,
           按钮显示「★—」, 绝不让非数值漏到屏幕上(verify-ui 的元数据泄漏断言)。 */
        var tier = PS.util.clamp(slot.tier | 0, 1, 4);
        var tmul = PS.WeaponData.tierPrice[tier - 1];
        var sellV = (typeof wdef.price === 'number' && isFinite(wdef.price) && typeof tmul === 'number' && isFinite(tmul))
          ? Math.max(3, Math.round(wdef.price * tmul * B.sellRatio)) : null;
        var k = i - from;
        var cx = px + 12 + (k % 2) * (sw + 8), cy = py + 46 + Math.floor(k / 2) * (shh + 8);
        x.fillStyle = 'rgba(7,11,7,0.55)';
        this.rr(cx, cy, sw, shh, 10); x.fill();
        x.strokeStyle = T.weak; x.lineWidth = 1;
        this.rr(cx, cy, sw, shh, 10); x.stroke();
        /* 模型舱(右端): 真比例模型 */
        this.plate(cx + 104, cy + 4, 60, shh - 8, 8, 0.45, this.withA(T.weak, 0.9));
        this.weaponIcon(slot.key, cx + 134, cy + shh / 2, 17, { tier: tier, def: wdef, rot: -0.34 });
        /* 名字 + 阶 */
        x.textAlign = 'left';
        x.fillStyle = T.hi;
        x.font = 'bold 10px ' + u.font;
        var wname = ((wdef.name || '').split(' ')[0] || '未知');
        x.fillText(this.ellip(wname, 62, 10), cx + 8, cy + 18);
        x.fillStyle = T.coin;
        x.fillText('T' + tier, cx + 76, cy + 18);
        this.button(cx + 6, cy + 24, 44, 44, '卖', {
          size: T.fs.small, sub: sellV === null ? '★—' : '★' + sellV, subColor: T.mid,
          disabled: g.weapons.length <= 1,
          cb: (function (idx3) { return function () { PS.Game.sellWeapon(idx3); }; })(i)
        });
        var canFuse = PS.WeaponData.tierUp[slot.key] && tier < 4;
        if (canFuse) {
          var pair = this.ownedWeapons(slot.key, tier).total > 1;
          this.button(cx + 54, cy + 24, 44, 44, '合', {
            size: T.fs.small, sub: pair ? '可升阶' : '缺同名',
            subColor: pair ? T.pos : this.withA(T.mid, 0.6),
            disabled: !pair, color: pair ? T.pos : this.withA(T.hi, 0.55),
            border: pair ? this.withA(T.pos, 0.7) : T.weak,
            cb: (function (idx4) { return function () { PS.Game.tryFuse(idx4); }; })(i)
          });
        }
      }
      if (pages > 1) {
        var bxp = px + w - 48;
        this.button(bxp, py + 50, 44, 44, '‹', {
          size: T.fs.lead, disabled: page <= 0, id: 'weaponprev',
          cb: function () { self._weaponPage = page - 1; }
        });
        this.button(bxp, py + 112, 44, 44, '›', {
          size: T.fs.lead, disabled: page >= pages - 1, id: 'weaponnext',
          cb: function () { self._weaponPage = page + 1; }
        });
      }
      x.textAlign = 'left';
      this.fitText('买入同名同阶件会自动合成(武器栏满也能买)', px + 14, py + h - 14, w - 70, T.fs.micro, T.low, 'left', false, 9.5);
    },

    /* ================= 结算(胜 / 负) =================
     * v6.0(UI 重做) 信息架构: 左「成绩」(波次/击杀/等级/存活时长/材料, 逐行标签+数值) /
     *   右「本局收获」(武器 6 格 + 道具 10 格 + 最近 6 件的名字) / 底部幸运口径 + 三个出口。
     * 门禁契约(不许改):
     *   · 文本必须**恰好**是 '本局道具 N 件'(verify-ui 按此正则反查真实件数) —— 所以走 text(), 不走 fitText
     *     (fitText 长文本会加省略号, 字符串就变了);
     *   · 道具图标上限恒为 10, 超出给**恰好** '+'+(N-10) 的角标(旧版静默丢掉第 11 件起);
     *   · 武器/道具 id 查不到的兜底: 直接跳过, 绝不把 undefined 印上去(数值泄漏审计)。 */
    drawOver: function () {
      var x = this.ctx, u = this.ui, W = u.W, H = u.H, g = PS.Game;
      this.fillScreen(T.scrim);
      var win = !!g.win;
      var accent = win ? T.coin : T.neg;
      var mo = B.MODES[g.mode] || { name: '远征', waves: 20 };
      var dur = B.waveDuration(1, g.mode);
      var secs = Math.max(0, (g.wave - 1) * dur + Math.min(g.timeInWave, dur));
      var timeStr = Math.floor(secs / 60) + ' 分 ' + ((Math.floor(secs % 60) < 10 ? '0' : '') + Math.floor(secs % 60)) + ' 秒';
      this.plate(180, 30, 860, 660, 18, 0.92, T.edge);
      this.text(win ? '远征成功!' : '倒在了第 ' + g.wave + ' 波…', W / 2, 92, T.fs.hero, accent);
      this.text(mo.name + ' · ' + B.diffOf(g.diff).name + ' · 本局推进到第 ' + g.wave + ' 波' + (win ? ' (通关)' : ''),
        W / 2, 128, T.fs.body, T.mid, 'center', false);
      /* ---------- 左: 成绩(逐行, 标签左 / 数值右) ---------- */
      this.panel(200, 150, 380, 300, { title: '成绩' });
      var rows = [
        ['波  次', g.wave + (mo.noWin ? '' : ' / ' + mo.waves), T.hi],
        ['击  杀', '' + g.kills, T.hi],
        ['等  级', 'LV ' + g.level, T.info],
        ['存活时长', timeStr, T.pos],
        ['材  料', '★ ' + g.material, T.coin]
      ];
      for (var i = 0; i < rows.length; i++) {
        var ry = 214 + i * 46;
        x.fillStyle = 'rgba(7,11,7,0.55)';
        this.rr(216, ry - 23, 348, 38, 8); x.fill();
        this.text(rows[i][0], 232, ry, T.fs.small, T.mid, 'left', false);
        this.text(rows[i][1], 548, ry, T.fs.lead, rows[i][2], 'right');
      }
      /* ---------- 右: 本局收获(武器 + 道具 + 名字) ---------- */
      this.panel(600, 150, 420, 300, { title: '本局收获' });
      this.text('本局武器 ' + g.weapons.length + ' 件', 616, 214, T.fs.body, T.mid, 'left');
      if (!g.weapons.length) {
        this.text('(空手上阵)', 616, 254, T.fs.small, T.low, 'left', false);
      }
      var wmax = Math.min(g.weapons.length, 6);
      for (var wi = 0; wi < wmax; wi++) {
        var wsl = g.weapons[wi], wbx = 616 + wi * 66;
        this.plate(wbx, 226, 58, 58, 8, 0.5, this.withA((RARITY[wsl.tier] || RARITY[1]).c, 0.6));
        this.weaponIcon(wsl.key, wbx + 29, 226 + 29, 14, { def: PS.WeaponData.list[wsl.key], tier: wsl.tier });
        this.text('T' + wsl.tier, wbx + 52, 276, 9.5, T.coin, 'right');
      }
      if (g.weapons.length > 6) this.text('另 ' + (g.weapons.length - 6) + ' 把', 1002, 254, T.fs.small, T.low, 'right', false);
      this.text('本局道具 ' + g.items.length + ' 件', 616, 312, T.fs.body, T.mid, 'left');
      /* 图标上限恒为 10(与门禁的 '+'+(N-10) 角标口径绑定, 别改这个数) */
      var ICON_MAX = 10;
      if (!g.items.length) {
        this.text('(一件都没捡)', 616, 350, T.fs.small, T.low, 'left', false);
      }
      for (var ii = 0; ii < g.items.length && ii < ICON_MAX; ii++) {
        var idef = PS.ItemData.byId(g.items[ii].id || g.items[ii]);
        if (!idef) continue;
        var ibx = 616 + (ii % 5) * 78, iby = 320 + Math.floor(ii / 5) * 46;
        this.plate(ibx, iby, 44, 44, 8, 0.5, this.withA((RARITY[idef.rarity] || RARITY[1]).c, 0.6));
        this.itemIcon(idef, ibx + 22, iby + 22, 15);
      }
      if (g.items.length > ICON_MAX) {
        this.text('+' + (g.items.length - ICON_MAX), 1002, 368, T.fs.body, T.coin, 'right');
      }
      var names = [];
      for (var j = Math.max(0, g.items.length - 6); j < g.items.length; j++) {
        var nd = PS.ItemData.byId(g.items[j].id || g.items[j]);
        if (nd) names.push(nd.name);
      }
      if (names.length) this.fitText('最近: ' + names.join(' · '), 616, 440, 390, T.fs.micro, T.low, 'left', false, 9.5);
      /* ---------- 幸运口径(全体现算) ---------- */
      var lk = this.luckInfo();
      /* 结算页只有"本局"口径: 波末那句(本波已出 / 再中一件)是**下一波**的预期值, 死亡后没有意义。 */
      var luckTxt = '运气 ' + lk.luck + ' · 商店高品质(稀有+) ' + lk.pct + '%';
      if (g.luckDropItem) {
        var ld = PS.ItemData.byId(g.luckDropItem);
        luckTxt += ' · 幸运掉落「' + (ld ? ld.name : g.luckDropItem) + '」';
      }
      var dropTxt = '';
      if (g.luckDropItem) {
        var ld2 = PS.ItemData.byId(g.luckDropItem);
        dropTxt = '★ 本局幸运掉落「' + (ld2 ? ld2.name : g.luckDropItem) + '」';
      }
      this.plate(200, 466, 820, 76, 12, 0.60, this.withA(T.luck, 0.5));
      this.fitText(luckTxt, 216, 508, 520, T.fs.small, T.luck, 'left', false, 10);
      this.fitText(dropTxt || '本局未触发幸运掉落', 1004, 508, 300, T.fs.small,
        dropTxt ? T.coin : T.low, 'right', false, 10);
      /* ---------- 出口(三个, 等宽一排) ---------- */
      this.button(310, 566, 200, 56, '再来一局', {
        size: T.fs.lead, bg: this.withA(T.pos, 0.22), hoverBg: this.withA(T.pos, 0.34),
        border: this.withA(T.pos, 0.7), hoverBorder: T.pos,
        cb: function () {
          var cid = (PS.Game.char && PS.Game.char.id) || PS.Game.pendingChar || 'popo';
          PS.Game.newRun(cid, PS.Game.mode || 'standard');
        }
      });
      this.button(540, 566, 200, 56, '换个蔬菜', {
        size: T.fs.lead, bg: 'rgba(255,255,255,0.06)', hoverBg: 'rgba(255,255,255,0.14)',
        border: T.weak, hoverBorder: T.gold,
        cb: function () { PS.Game.setState(PS.State.CHAR); PS.Sound.play('click'); }
      });
      this.button(770, 566, 200, 56, '回主菜单', {
        size: T.fs.lead, bg: 'rgba(255,255,255,0.06)', hoverBg: 'rgba(255,255,255,0.14)',
        border: T.weak, hoverBorder: T.gold,
        cb: function () { PS.Game.setState(PS.State.MENU); PS.Sound.play('click'); }
      });
      this.audioPanel(W - 24 - 200, 24, 200);
    }
  };
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
