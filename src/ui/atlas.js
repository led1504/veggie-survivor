/* PS.Atlas v1.0 —— 位图资产层(程序化美术的"上位替代", 缺图自动回落)
 * ===========================================================================
 * 它解决什么: 现在整套美术是 `art.js` 用 Canvas 手绘的(零位图)。位图化之后,
 *   本模块负责"用图集里的图替换掉程序化绘制", 且**不打乱任何现有性能契约**。
 *
 * 接入方式(关键设计 —— 只挂一个钩子, 不改任何调用点):
 *   `art.js` 全部精灵都经 `PS.Sprites.draw/get(key, w, h, drawFn, ...)` 烘焙。
 *   本模块往 `PS.Sprites` 注册一个 bake 钩子: 钩子拿到 (key, ctx, w, h),
 *   若能按 key 在图集里找到对应资产, 就把位图画进**同一个槽位画布**并返回 true,
 *   于是 drawFn(程序化绘制)被跳过 —— 调用点、热路径、LRU、pin 全部原样不动。
 *   钩子返回 false 时行为与今天**逐字节相同**(缺图=继续程序化画)。
 *
 * 为什么 key 就能定位资产: art.js 的缓存 key 编码了全部身份与变体:
 *   e:<怪物key>:<r>:<tier>:<frame>:<mode>:<dmg>[:p]   怪物/精英/Boss  (mode n常态 f白闪 z冰冻)
 *   c:<角色id>:<色值>:<pose>:<r>                      主角
 *   w3:<武器key>:<tier>                               武器
 *   i2:<道具src>                                      道具
 *   s:<结构体key>:<r>                                 场上结构体(炮塔 / 菜圃 / 铁虫 / 地雷)
 *   t:<场景道具key>:<r>                               场景道具(树木 / 果实)
 *   p:<地标key>:<v>                                   地标(当前 PROPS 为空, 保留支持)
 *   所以"哪个 key 用哪张图"完全由 asset-manifest 的 spriteKeys(glob) 定义,
 *   本模块不写死任何映射, 清单改了就跟着改。
 *
 * 变体合成(受击白闪/冰冻/二阶段)在**烘焙期**做, 不进热路径:
 *   每帧每实体仍然只有 1 次 drawImage。
 *
 * 依赖注入: 只用 PS.Sprites(可选) + PS.Art.bits(可选, 画阴影/王冠/血条槽用) + 一个 image 工厂。
 * 全链零外部请求: 帧表走 PS.Atlas.data(script/require 注入) 或 XHR 兜底读 atlas.json;
 *   图只有一张 atlas.png 要加载。任何一步失败都只是"用回程序化画", 不会崩。
 *
 * ES5, 零依赖。
 */
(function (global) {
  'use strict';
  var PS = global.PS = global.PS || {};
  var A = PS.Atlas = PS.Atlas || {};
  if (A.__v) return;                       /* 幂等: 重复引入不重复挂钩子 */
  A.__v = '1.0';

  /* 变体染色: 烘焙期把整张精灵往目标色拉 —— 与 art.js 的 MODE 语义一一对应 */
  var TINT = {
    f: { c: '#ffffff', a: 0.92 },          /* 受击白闪(MODE 1) */
    z: { c: '#a8e4ff', a: 0.55 },          /* 冰冻(MODE 2) */
    p: { c: '#ff8a5a', a: 0.22 }           /* 二阶段(e.phase2) */
  };

  /* 资产目录的定位: 不能写死相对页面的路径 —— `tools/art-preview.html` 与根目录的
   * `index.html` 深度不同, 写死必然有一边取不到图。改从**本脚本自己的 URL** 反推项目根:
   *   浏览器(file:// 或 http)  → 由 document.currentScript.src 找到 "/src/ui/" 那一节
   *   微信小游戏(无 document)   → 代码包内的相对路径就是 "assets/"
   * 两步都拿不到时退回 "assets/" —— 最坏结果是取不到图, 也就是走程序化绘制。 */
  function detectBase() {
    try {
      var doc = global.document;
      var cs = doc && doc.currentScript;
      if (cs && cs.src) {
        var s = String(cs.src), i = s.indexOf('/src/ui/');
        if (i >= 0) return s.slice(0, i) + '/assets/';
        i = s.lastIndexOf('/');
        if (i >= 0) return s.slice(0, i + 1) + '../assets/';
      }
    } catch (e) {}
    return 'assets/';
  }
  A.baseUrl = detectBase();

  A.config = {
    imageUrl: A.baseUrl + 'atlas.png',     /* 唯一的网络/文件依赖: 一张图集 */
    jsonUrl: A.baseUrl + 'atlas.json',     /* 帧表兜底(http 环境; file:// 下浏览器会拦 XHR) */
    requirePath: '../../assets/atlas.js',  /* 小游戏端用 require 拿帧表(可选) */
    fitScale: 1,                           /* 全局落图微调(按画布铺满后嫌大/嫌小的总旋钮) */
    autoLoad: true,
    holdMs: 1500                           /* 启动闸门最长等待(见 A.pending): 到点还没定论就放行程序化路径 */
  };

  A.data = A.data || null;                 /* 帧表(可被 <script src="assets/atlas.js"> 预置) */
  A.img = null;
  A._ready = false;
  A._failed = false;
  A._loading = false;
  A._err = null;
  A._buckets = null;                       /* 按 key 首段分桶, 避免每次 bake 全表扫 */
  A._scratch = null;
  A._paint = 0;                            /* 成功用位图画的槽数 */
  A._miss = 0;                             /* 查过但没图的槽数 */
  A._hooked = false;
  A._holdArmed = false;                    /* 超时兜底是否已装(见 A.armHold) */
  A._holdExpired = false;                  /* 超时是否已到点 */

  /* ---------------------------- 工具 ---------------------------- */
  /** 简易 glob: 只支持 '*'(任意长度) —— 足够表达 spriteKeys, 且能一眼看懂 */
  function globMatch(pat, s) {
    if (!pat) return false;
    var star = pat.indexOf('*');
    if (star < 0) return pat === s;
    var parts = pat.split('*');
    if (s.indexOf(parts[0]) !== 0) return false;
    var i = parts[0].length, k;
    for (k = 1; k < parts.length - 1; k++) {
      if (!parts[k]) continue;
      var idx = s.indexOf(parts[k], i);
      if (idx < 0) return false;
      i = idx + parts[k].length;
    }
    var last = parts[parts.length - 1];
    if (last) { if (s.length - last.length < i) return false; if (s.indexOf(last, i) < 0) return false; }
    return true;
  }

  function headOf(key) { var i = key.indexOf(':'); return i < 0 ? key : key.slice(0, i); }

  /** 解析缓存 key → 结构化变体信息(拿不到就给安全默认值) */
  function parseKey(key) {
    var p = String(key || '').split(':');
    var v = { kind: p[0], id: p[1] || '', mode: null, tier: 0, r: 0, dmg: false, key2: p[1] || '' };
    if (p[0] === 'e') {                    /* e:<foe>:<r>:<tier>:<frame>:<mode>:<dmg>[:p] */
      v.key2 = p[1]; v.r = parseFloat(p[2]) || 0; v.tier = parseInt(p[3], 10) || 0;
      if (p[5] && p[5] !== 'n') v.mode = p[5];
      v.dmg = p[6] === 'h';
      if (p[7] === 'p') v.mode = v.mode || 'p';
    } else if (p[0] === 'w3') { v.key2 = p[1]; v.tier = parseInt(p[2], 10) || 0; }
    else if (p[0] === 'i2') { v.key2 = p[1]; }
    else if (p[0] === 'c') { v.key2 = p[1]; v.tier = 0; }
    return v;
  }

  /* ---------------------------- 帧表 / 索引 ---------------------------- */
  function buildIndex() {
    var frames = (A.data && A.data.frames) || null;
    A._buckets = {};
    if (!frames) return;
    for (var id in frames) {
      if (!Object.prototype.hasOwnProperty.call(frames, id)) continue;
      var fr = frames[id], keys = fr.keys || [];
      for (var i = 0; i < keys.length; i++) {
        var h = headOf(keys[i]);
        (A._buckets[h] = A._buckets[h] || []).push({ id: id, fr: fr, pat: keys[i] });
      }
    }
  }

  A.frame = function (id) { return (A.data && A.data.frames && A.data.frames[id]) || null; };

  /** 精灵缓存 key → 资产 id(找不到返回 null) */
  A.idFor = function (key) {
    if (!A._buckets || !key) return null;
    var b = A._buckets[headOf(key)];
    if (!b) return null;
    for (var i = 0; i < b.length; i++) if (globMatch(b[i].pat, key)) return b[i].id;
    return null;
  };

  /* ---------------------------- 加载 ---------------------------- */
  function makeImage() {
    var P = PS.PlatformWeapp || PS.PlatformWeb;
    try {
      if (P && P.wx && typeof P.wx.createImage === 'function') return P.wx.createImage();
      if (P && typeof P.makeImage === 'function') return P.makeImage();
      if (typeof global.wx !== 'undefined' && global.wx && typeof global.wx.createImage === 'function') return global.wx.createImage();
      if (typeof global.Image === 'function') return new global.Image();
    } catch (e) {}
    return null;
  }

  /** 帧表兜底获取: 小游戏 require / 浏览器 XHR。都失败就永远走程序化(安全)。 */
  function tryFetchData(syncDone) {
    if (A.data && A.data.frames) { syncDone(true); return; }
    if (typeof require === 'function') {
      try { require(A.config.requirePath); syncDone(!!(A.data && A.data.frames)); if (A.data && A.data.frames) return; }
      catch (e) {}
    }
    if (typeof global.XMLHttpRequest === 'function') {
      try {
        var x = new global.XMLHttpRequest();
        x.open('GET', A.config.jsonUrl, false);          /* 同步读: 只在启动时一次, 简单可靠 */
        x.send(null);
        var txt = x.responseText || x.response || '';
        if (txt) { A.data = JSON.parse(txt); syncDone(true); return; }
      } catch (e2) {}
    }
    syncDone(!!(A.data && A.data.frames));
  }

  /** 图集就绪后: 丢掉已经用"程序化"烘过的槽, 下一帧自动重烘成位图 */
  function invalidateProceduralSlots() {
    var S = PS.Sprites;
    if (S && S.dropMatching) S.dropMatching(function (k) { return !!A.idFor(k); });
    /* 别的层也可能自己缓存了"程序化版本"(PS.ItemArt 有自己的 CACHE, 不过 PS.Sprites)。
     * 图集晚于它们就绪时, 那些缓存必须一起作废 —— 否则那些资产永远停在手绘版。 */
    for (var i = 0; i < READY_HOOKS.length; i++) { try { READY_HOOKS[i](); } catch (e) {} }
  }
  var READY_HOOKS = [];
  /** 注册"图集就绪后请作废你的程序化缓存"的回调(幂等)。 */
  A.addReadyHook = function (fn) {
    if (typeof fn === 'function' && READY_HOOKS.indexOf(fn) < 0) READY_HOOKS.push(fn);
    return A;
  };
  /** 资源层的"这个缓存 key 归我管吗" —— 给别的美术层判断要不要让位(见 PS.ItemArt)。 */
  A.canServe = function (key) { return !!(A._ready && key && A.idFor(key)); };

  A.load = function (cb) {
    if (A._ready || A._failed || A._loading) { if (cb) cb(A._ready); return; }
    A._loading = true;
    /* 加载页要报**真实**已等待秒数(ui.js 的 this.time 从首帧才开始走, 会比真实等待少 holdMs) */
    A.t0 = (typeof Date !== "undefined" && Date.now) ? Date.now() : 0;
    tryFetchData(function (gotData) {
      if (!gotData) { A._failed = true; A._err = 'no-frame-data'; A._loading = false; if (cb) cb(false); return; }
      buildIndex();
      if (!A.img) {
        var img = makeImage();
        if (!img) { A._failed = true; A._err = 'no-image-factory'; A._loading = false; if (cb) cb(false); return; }
        var done = false, tries = 0;
        function ok() {
          if (done) return; done = true;
          A.img = img; A._ready = true; A._loading = false;
          invalidateProceduralSlots();
          if (cb) cb(true);
        }
        function bad(msg) {
          if (done) return; done = true;
          A._failed = true; A._err = 'img:' + (msg || 'error'); A._loading = false;
          if (cb) cb(false);
        }
        img.onload = ok;
        img.onerror = function () { bad('onerror'); };
        try { img.src = A.config.imageUrl; } catch (e) { bad(e && e.message); }
        /* 小游戏偶发 onload 不触发: 兜底轮询(就绪判据是 width/height 真的有值) */
        if (typeof global.setTimeout === 'function') {
          (function poll() {
            if (done) return;
            /* 尺寸已知 ≠ 可解码: 浏览器里 img.width>0 在**响应头解析后**就成立, 而此刻 drawImage 画不出像素
             *   ⇒ 这一瞬间烘出来的精灵是**全透明**的, 而图集从此 `_ready` 不会再作废程序化槽
             *   ⇒ 该资产整局空白(2026-10-15 实测: 封面主角不见了, 探针 opaquePx 恒为 0)。
             *   complete === undefined 是小游戏端(没这个字段) —— 只在"明确未完成"时才继续等。 */
            if (img.width > 0 && img.height > 0 && img.complete !== false) { ok(); return; }
            /* v1.1 慢网不是失败: 图集 1.78MB, 40KB/s 的 4G 上要 45 秒, 而这里 10 秒(100x100ms)就判死;
             *   bad() 一置 done, 后来真到货的 onload / 轮询再调 ok() 也当场返回 ⇒ 用户**整局**停在程序化
             *   老美术上, 看到的就是"建模变回最初版"(2026-10-15 实测: 手机 37KB/s, 线上慢网复现
             *   _err='img:timeout' 且加载完也不恢复)。
             *   complete === false 是浏览器专有的"确知还在下" ⇒ 只续期、不计数、不判死; 真断了会走
             *   img.onerror(仍判失败)。小游戏端没有 complete 字段, 保留次数看门狗当兜底。 */
            if (img.complete === false) { global.setTimeout(poll, 250); return; }
            if (++tries > 100) { bad('timeout'); return; }
            global.setTimeout(poll, 100);
          })();
        }
        return;
      }
      A._ready = true; A._loading = false; invalidateProceduralSlots();
      if (cb) cb(true);
    });
  };

  A.ready = function () { return !!A._ready; };
  /** 图集是否**确定**失败(onerror / 帧表缺失 / 桩环境无 image 工厂) —— 素材闸门据此决定"加载页"还是"重试页" */
  A.failed = function () { return !!A._failed; };

  /** 从发起请求到现在的秒数(加载页显示用; 没发起过 = 0) */
  A.waitSec = function () { return A.t0 ? (Date.now() - A.t0) / 1000 : 0; };

  /* ---------------------------- 启动闸门 ---------------------------- */
  /* 为什么要有它: 图集是**异步**加载的(assets/atlas.png 1840KB / 2036x3516, 光解码就要百毫秒),
   *   而真实入口的主循环在 atlas.js 之后一两帧就开跑了。于是刷新后会有 0.1~0.6 秒**先画一整屏
   *   程序化老美术**(art.js 那一版), 图集一到再整屏换掉 —— 用户实测到的"闪一下最早的建模"。
   *   这不是"新建模覆盖老建模": 两条路径各自独立(见 AGENTS.md 的 R1.3/R1.4/R1.7), 只是
   *   **老路径先被画出来了**。处置: 让真实入口的**第一帧**等图集给定论; 等的时候画布保持空,
   *   比"先画一版错的再换"好。
   * **绝不把可用性押在图集上**: 三条出路(就绪 / 失败 / 超时)哪条先到都放行, 且只放行一次。
   * 用法: 入口在主循环之前问 A.pending(); 为真就把第一帧延后。超时兜底由 pending() 自动装上,
   *   所以**没有哪种问法是裸奔的**(问了就等于装好兜底) —— 见 web.js / weapp.js 的 startWhenArtSettled。 */
  A.pending = function () {
    if (A._ready || A._failed || A._holdExpired) return false;
    if (A._loading || (A.config && A.config.autoLoad)) { A.armHold(); return true; }
    return false;                          /* 压根没打算加载(如预览页关掉 autoLoad) → 不许拦 */
  };
  /** 超时兜底(幂等): 超过 ms 还没定论, 就当"图集这条路不通", 放行程序化路径 */
  A.armHold = function (ms) {
    if (A._holdArmed) return A;
    A._holdArmed = true;
    if (typeof global.setTimeout === "function") {
      var t = (ms == null) ? ((A.config && A.config.holdMs) || 1500) : ms;
      global.setTimeout(function () { A._holdExpired = true; }, t);
    }
    return A;
  };

  /* ---------------------------- 绘制 ---------------------------- */
  /** 带染色的取图: 画到 scratch 画布上再合成, 避免 source-atop 波及先画的阴影/光环 */
  function blit(ctx, fr, dx, dy, dw, dh, tint) {
    if (!tint) { ctx.drawImage(A.img, fr.x, fr.y, fr.w, fr.h, dx, dy, dw, dh); return; }
    var pad = 2;
    var w = Math.max(1, Math.ceil(dw) + pad * 2), h = Math.max(1, Math.ceil(dh) + pad * 2);
    var P = PS.PlatformWeapp || PS.PlatformWeb;
    var mk = null;
    try {
      if (P && P.wx && typeof P.wx.createCanvas === 'function') mk = function () { return P.wx.createCanvas(); };
      else if (PS.Sprites && PS.Sprites._factory) mk = PS.Sprites._factory;
      else if (typeof global.document !== 'undefined' && global.document.createElement) mk = function () { return global.document.createElement('canvas'); };
    } catch (e) { mk = null; }
    if (!mk) { ctx.drawImage(A.img, fr.x, fr.y, fr.w, fr.h, dx, dy, dw, dh); return; }
    var sc = A._scratch;
    if (!sc || sc.width < w || sc.height < h) {
      try { sc = A._scratch = mk(); } catch (e2) { ctx.drawImage(A.img, fr.x, fr.y, fr.w, fr.h, dx, dy, dw, dh); return; }
      sc.width = w; sc.height = h;
    } else {
      var sx = sc.getContext('2d');
      if (sx) sx.clearRect(0, 0, sc.width, sc.height);
    }
    var x = sc.getContext('2d');
    if (!x) { ctx.drawImage(A.img, fr.x, fr.y, fr.w, fr.h, dx, dy, dw, dh); return; }
    x.globalCompositeOperation = 'source-over';
    x.globalAlpha = 1;
    x.clearRect(0, 0, sc.width, sc.height);
    x.drawImage(A.img, fr.x, fr.y, fr.w, fr.h, pad, pad, dw, dh);
    x.globalCompositeOperation = 'source-atop';
    x.fillStyle = tint.c;
    x.globalAlpha = tint.a;
    x.fillRect(0, 0, sc.width, sc.height);
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
    ctx.drawImage(sc, 0, 0, w, h, dx - pad, dy - pad, w, h);
  }

  /** bake 钩子: 命中资产则画位图并返回 true(跳过程序化绘制) */
  A.onBake = function (key, ctx, w, h) {
    /* 认领 = 跳过程序化绘制 ⇒ 只在"图集就绪**且此刻真能解码**"时才认领。
     *   图片未解码时 drawImage 画不出像素, 认领会烘出**全透明**精灵并被缓存整局(见 load 的轮询注释)。 */
    if (!A._ready || !A.idFor || !A.img || A.img.complete === false) return false;
    var id = A.idFor(key);
    if (!id) { A._miss++; return false; }
    var fr = A.frame(id);
    if (!fr || !A.img) { A._miss++; return false; }
    var v = parseKey(key);
    /* ---- 落图几何: 一律在**源画布坐标系**里算 ----
     * 为什么不是"把裁剪框铺满槽位": 清单规定主体占画布 70~80%、锚点按画布定义 ——
     *   画布才是资产与游戏世界之间的那把尺。按裁剪框铺满会把主体撑到槽位边缘:
     *   实测 22 只普通怪平均比程序化本体重 1.36 倍(宽), 画面立刻拥挤。
     * k: 源画布 → 槽位的统一缩放; fr.k 是清单里的每资产系数; A.config.fitScale 是全局微调。 */
    var sw = fr.sw > 0 ? fr.sw : fr.w, sh = fr.sh > 0 ? fr.sh : fr.h;
    var k = Math.min(w / sw, h / sh) * (fr.k === undefined ? 1 : fr.k)
          * (A.config.fitScale === undefined ? 1 : A.config.fitScale);
    if (!(k > 0) || !isFinite(k)) k = 1;
    var dw = fr.w * k, dh = fr.h * k;
    /* 锚点 = 主体中心对齐实体原点(与程序化绘制同口径: paintEnemy 也是把形体画在 (0,0) 上)。
     * 出图是"四边留白、主体居中"的, 所以清单里的 py(0.78 脚底线) 对这批图不成立 ——
     * 谁要改成"脚底贴地"的锚法, 就改清单 pivot 并在这里换成按画布坐标对齐。 */
    var dx = -dw / 2, dy = -dh / 2;
    var bits = PS.Art && PS.Art.bits;

    /* ---- 位图之前: 接触阴影 / 精英光环 / Boss 红雾(与 paintEnemy 同序) ---- */
    if (bits && v.kind === 'e') {
      var m = (bits.meta && bits.meta(v.key2)) || {};
      if (bits.shadow) bits.shadow(ctx, v.r, m.dir ? Math.min((m.wf || 1) * 0.62, 1.0) : 0.9, m.dir ? 0.5 : 0.33);
      if (v.tier > 0) { if (bits.ring) bits.ring(ctx, v.r, v.tier, null); if (bits.glow) bits.glow(ctx, v.r, v.tier); }
    }

    var tint = (v.mode && TINT[v.mode]) ? TINT[v.mode] : null;
    blit(ctx, fr, dx, dy, dw, dh, tint);

    /* ---- 位图之后: 武器实心化(与 paintWeaponModel 的 wnBake 同一步) ----
     * 为什么必须补这一步: 位图命中时 drawFn 被短路, wnSolidify 不会执行 —— 烘焙降采样
     * 必然糊出的 1px 半透明软边就会一直留在缓存里(verify-weapon-vis [2] 半透明超标)。
     * 复用 PS.Art.bits.solidify 而不是在 atlas.js 里重写: 这是既有观感, 重写就会漂移。 */
    if (v.kind === 'w3' && bits && bits.solidify) { try { bits.solidify(ctx); } catch (e) {} }

    /* ---- 位图之后: 冰冻霜壳 / 血条底槽(与 paintEnemy 同序) ----
     * v5.17: 王冠那一笔已删(用户逐字「不要这个王冠」) —— 与 art.js 的 paintEnemy 同步摘除。 */
    if (bits && v.kind === 'e') {
      if (v.mode === 'z' && bits.frost) bits.frost(ctx, v.r);
      if (v.dmg) {                            /* 与 paintEnemy / ui.js 完全同位置 */
        var bw = Math.max(26, v.r * 2.2);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(-bw / 2, -v.r - 11, bw, 4);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(-bw / 2, -v.r - 11, bw, 1);
      }
    }
    A._paint++;
    return true;
  };

  /* ---------------------------- 安装 ---------------------------- */
  A.install = function () {
    var S = PS.Sprites;
    if (!S || !S.addHook || A._hooked) return false;
    S.addHook(function (key, ctx, w, h) { return A.onBake(key, ctx, w, h); });
    A._hooked = true;
    return true;
  };

  A.stats = function () {
    return {
      ready: !!A._ready, failed: !!A._failed, err: A._err, hooked: !!A._hooked,
      hasData: !!(A.data && A.data.frames), frames: A._buckets ? A._buckets.length : 0,
      painted: A._paint, miss: A._miss, ids: (A.data && A.data.frames) ? Object.keys(A.data.frames).length : 0
    };
  };

  A.install();
  /* v7.8 同步开跑(不再 setTimeout 0): 两条理由, 都是可复现的时序事实 —
   *   ① 图集请求**最早**出发(不再等一个宏任务), 启动闸门(A.pending)等的就是它;
   *   ② 没有 image 工厂的环境(桩测试 / 预览页)会在这里**当场**失败 ⇒ A.pending() 立刻为假,
   *      启动闸门同步放行 —— 否则那些环境要白等一个宏任务, "首帧何时被排上"就不再是同步可观测的
   *      (qa/weapp-boot-check 的 H.frame 就是同步取的, 它因此红过)。 */
  if (A.config.autoLoad) A.load();

  global.PS = PS;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
