/* PS.Sprites v3.0 —— 离屏精灵缓存(美术层 / 特效层共用的唯一离屏入口)
 * ---------------------------------------------------------------------------
 * 为什么需要它: 实测第 18 波 272 只怪时 canvas draw call 高达 **2175 次/帧**
 * (≈8 次/怪: 每个怪都要 beginPath/arc/fill/stroke/椭圆/高光...), 高分屏(dpr=2)
 * 下还要再乘 4 倍像素填充 —— 这就是「怪物一多就疯狂掉帧」的直接原因。
 * 做法: 把"每个怪每帧重复画一遍的静态外形"渲染一次到离屏 canvas, 之后每帧只
 * 做 1 次 drawImage。带受击白闪/多朝向的怪 = 2~3 个缓存槽, 仍然远低于 8 次。
 *
 * v3.0 增补(为「菜园战场」美术重做配套):
 *   - 烘焙期不再受限: 形状、渐变、clip、多层描边都放在烘焙回调里, 热路径只留 drawImage。
 *   - 槽位分级: pin=true 的槽(地面砖/角色/地标)不参与 LRU 淘汰, 避免战斗中重烘卡顿。
 *   - 内存硬上限(像素总量) + 单槽最长边 1024(地面砖/篱笆段这类大件需要)。
 *   - 通用形预烘焙: dot / ringImg / shard / star / frost / ember / glow —— 特效层每颗粒子
 *     也从"beginPath+arc+fill"降到 1 次 drawImage。
 *
 * 用法:
 *   PS.Sprites.get(key, w, h, function (c, ctx2) { ...画一次... }, { pin: true });
 *   PS.Sprites.draw(ctx, key, w, h, drawFn, x, y, { flip: true, alpha: 0.8, scale: 1, rot: 0 });
 *   PS.Sprites.stats();   // { hit, miss, slots, fail, dead, enabled, mem, pins, lastErr }
 *
 * 设计约束(与项目一贯纪律一致):
 *   - ES5, 零依赖, 无 DOM 环境下自动降级为"每帧现画"(不会崩)
 *   - 按 devicePixelRatio 渲染, 高分屏不糊(上限 dprCap)
 *   - 槽位上限 + 内存上限 + LRU 淘汰, 防止缓存无限膨胀(memory leak)
 *   - 画布尺寸上限保护(畸形参数不创建巨型画布)
 */
(function (global) {
  'use strict';
  var PS = global.PS || {};
  var MAX_SLOTS = 520;
  var MAX_DIM = 1024;
  var MEM_MAX = 56 * 1024 * 1024;   // 全部槽位像素总量上限(4B/px: ≈56MB)
  var PIN_MAX = 40;                 // 常驻槽位上限(地面砖/角色/地标; 防止 pin 被滥用成泄漏)
  var TAU = Math.PI * 2;

  function dpr() {
    var cap = (PS.Balance && PS.Balance.FX && PS.Balance.FX.dprCap) || 2;
    var d = (typeof global.devicePixelRatio === 'number' && global.devicePixelRatio) || 1;
    return Math.max(1, Math.min(cap, d));
  }
  /* 画布工厂解析顺序: 显式注入 → 平台适配层(微信 wx.createCanvas / 浏览器 document) → 无(降级现画)
   * 注: 微信小游戏里没有 document —— 早期实现只看 document, 会让微信端一点缓存加速都拿不到
   * (Plato 的审计发现)。这里改为优先用平台层暴露的 makeCanvas。 */
  function resolveFactory() {
    var S2 = PS.Sprites;
    if (S2 && typeof S2._factory === 'function') return S2._factory;
    var P = PS.PlatformWeapp || PS.PlatformWeb;
    if (P) {
      if (typeof P.makeCanvas === 'function') return P.makeCanvas;
      if (P.ui && typeof P.ui.makeCanvas === 'function') return P.ui.makeCanvas;   // web.js/weapp.js 的实际挂点
    }
    if (PS.UI && PS.UI.ui && typeof PS.UI.ui.makeCanvas === 'function') return PS.UI.ui.makeCanvas;
    if (typeof global.document !== 'undefined' && global.document.createElement) {
      return function (w, h) { var c = global.document.createElement('canvas'); c.width = w; c.height = h; return c; };
    }
    return null;
  }

  var S = PS.Sprites = {
    _map: {},
    _keys: [],      // LRU 顺序(旧 → 新)
    _pin: {},       // 常驻 key(不参与淘汰)
    _pins: [],
    _mem: 0,        // 估算字节
    _hit: 0,
    _miss: 0,
    _ok: true,
    _factory: null,     // 可注入画布工厂(测试/微信端自定义)
    _dead: {},          // 烘焙失败过的 key —— 只跳过这一个, 不影响其它精灵
    _fail: 0,
    _lastErr: null,

    setFactory: function (fn) { this._factory = fn; },

    /* ==================== bake 钩子(位图资产层接入点) ====================
     * 钩子签名: fn(key, ctx, w, h) -> boolean。返回 true = "我已经把这个槽画好了",
     * 于是跳过 drawFn(程序化绘制)。返回 false = 行为与没有钩子时**完全一致**。
     * 契约: 钩子只在**烘焙期**跑(每个 key 一次), 不参与热路径 —— 每帧仍然 1 次 drawImage。
     * 钩子抛异常只记一次 lastErr 并当作 false, 绝不让单个资产把整局缓存打掉。 */
    _hooks: [],

    addHook: function (fn) {
      if (typeof fn === 'function' && this._hooks.indexOf(fn) < 0) this._hooks.push(fn);
      return this;
    },
    _runHooks: function (key, ctx, w, h) {
      var hs = this._hooks, i;
      for (i = 0; i < hs.length; i++) {
        try { if (hs[i](key, ctx, w, h)) return true; }
        catch (e) { this._lastErr = 'hook:' + key + ':' + (e && e.message); }
      }
      return false;
    },
    /** 按谓词丢槽位(资产层在"图集刚就绪"时用它把程序化烘过的槽换掉, 下一帧自动重烘) */
    dropMatching: function (pred) {
      var ks = this._keys.slice(), ps = this._pins.slice(), i, n = 0;
      for (i = 0; i < ks.length; i++) if (pred(ks[i])) { this._drop(ks[i]); n++; }
      for (i = 0; i < ps.length; i++) if (pred(ps[i])) { this._drop(ps[i]); n++; }
      return n;
    },

    stats: function () {
      return {
        hit: this._hit, miss: this._miss, slots: this._keys.length, fail: this._fail,
        dead: this._count(this._dead), enabled: this._ok, mem: this._mem, pins: this._pins.length,
        lastErr: this._lastErr
      };
    },
    _count: function (o) { var n = 0; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) n++; return n; },
    reset: function () {
      this._dead = {};
      this._map = {}; this._keys = []; this._pin = {}; this._pins = []; this._mem = 0;
      this._hit = 0; this._miss = 0; this._dead = {}; this._fail = 0; this._lastErr = null;
    },
    /** 缓存是否可用(无画布工厂 = 走"每帧现画"降级) */
    canBake: function () { return !!resolveFactory(); },

    _size: function (c) { return (c && c.width && c.height) ? (c.width * c.height * 4) : 0; },

    /* 取(或生成)一张离屏画布。drawFn(canvas, ctx) 只在首次调用时执行。
     * opts.pin  = 常驻(地面砖/角色), 不参与 LRU 淘汰
     * opts.dim  = 该槽允许的最长边(默认 MAX_DIM)
     * opts.dpr  = 指定烘焙倍率(默认全局 dpr, 上限 dprCap)
     * 失败(无 DOM / 尺寸非法 / 创建抛异常)时返回 null, 调用方需支持"现画"路径。 */
    get: function (key, w, h, drawFn, opts) {
      if (!this._ok || !key || this._dead[key]) return null;
      var o = opts || {};
      var m = this._map[key];
      if (m) {
        this._hit++;
        if (m.__pin) this._touchPin(key);
        else this._touch(key);
        return m;
      }
      var mk = resolveFactory();
      if (!mk) { this._ok = false; return null; }
      var W = Math.ceil(w), H = Math.ceil(h);
      var dim = o.dim || MAX_DIM;
      if (!(W > 0) || !(H > 0) || W > dim || H > dim) return null;
      var k = Math.max(1, Math.min(o.dpr || dpr(), 4));
      var c, x;
      try {
        c = mk(Math.ceil(W * k), Math.ceil(H * k));
        if (!c || typeof c.getContext !== 'function') { this._ok = false; return null; }
        c.width = Math.ceil(W * k);
        c.height = Math.ceil(H * k);
        x = c.getContext('2d');
        if (!x) { this._ok = false; return null; }
        x.scale(k, k);
        /* 默认把原点挪到画布中心: 敌怪/角色/武器/掉落/地标都按"中心对称"画。
         * opts.tl === true 时保留左上角原点 —— 给"整块铺满画布"的内容用(地面砖/田带:
         * 它们按 (0,0)-(W,H) 铺满, 用中心原点就只画到右下四分之一, 其余全透明)。 */
        if (o.tl !== true) x.translate(W / 2, H / 2);
      } catch (e) { this._ok = false; this._lastErr = 'make:' + (e && e.message); return null; }
      try {
        if (!this._runHooks(key, x, W, H)) drawFn(c, x);
      } catch (e2) {
        /* 关键: 只把"这一个 key"判死并降级为现画, 绝不全局关缓存。
         * 早期实现一处烘焙异常就把 _ok 打 false, 结果是整局游戏静默退回
         * 逐帧现画(第 18 波 272 怪 × 8 次 draw call), 表现为"怪一多就疯狂掉帧"。 */
        this._dead[key] = 1;
        this._fail++;
        this._lastErr = 'paint:' + key + ':' + (e2 && e2.message);
        return null;
      }
      c.__sx = W; c.__sy = H; c.__sk = k;
      c.__pin = !!o.pin;
      this._map[key] = c;
      this._mem += this._size(c);
      if (c.__pin && this._pins.length < PIN_MAX) { this._pins.push(key); this._pin[key] = 1; }
      else { this._keys.push(key); }
      this._miss++;
      this._evict();
      return c;
    },

    _touch: function (key) {
      var i = this._keys.indexOf(key);
      if (i >= 0) { this._keys.splice(i, 1); this._keys.push(key); }
    },
    _touchPin: function (key) {
      var i = this._pins.indexOf(key);
      if (i >= 0) { this._pins.splice(i, 1); this._pins.push(key); }
    },
    _drop: function (key) {
      var c = this._map[key];
      if (!c) return;
      this._mem -= this._size(c);
      delete this._map[key];
      delete this._pin[key];
      var i = this._keys.indexOf(key); if (i >= 0) this._keys.splice(i, 1);
      i = this._pins.indexOf(key); if (i >= 0) this._pins.splice(i, 1);
    },
    _evict: function () {
      while (this._keys.length > MAX_SLOTS) this._drop(this._keys[0]);
      /* 内存超限: 先丢最旧的非常驻槽; 只剩余常驻槽还超, 就丢最旧的常驻槽
       * (宁可重烘地面砖, 也不许把内存吃穿 —— 手机上 OOM 是直接崩) */
      var guard = 0;
      while (this._mem > MEM_MAX && guard++ < 4 * (MAX_SLOTS + PIN_MAX)) {
        if (this._keys.length) this._drop(this._keys[0]);
        else if (this._pins.length) this._drop(this._pins[0]);
        else break;
      }
    },

    /* 画一张缓存精灵。取不到缓存时调用 fallback(ctx) (可选), 再不行就静默跳过。 */
    draw: function (ctx, key, w, h, drawFn, x, y, opts) {
      var o = opts || {};
      var c = this.get(key, w, h, drawFn, o);
      if (!c) { if (o.fallback) o.fallback(ctx); return false; }
      var sc = (o.scale || 1);
      var g = ctx;
      if (o.flip || o.rot || o.alpha !== undefined) {
        g.save();
        if (o.alpha !== undefined) g.globalAlpha = o.alpha;
        g.translate(x, y);
        if (o.rot) g.rotate(o.rot);
        if (o.flip) g.scale(-1, 1);
        g.drawImage(c, -w * sc / 2, -h * sc / 2, w * sc, h * sc);
        g.restore();
      } else {
        g.drawImage(c, x - w * sc / 2, y - h * sc / 2, w * sc, h * sc);
      }
      return true;
    },

    /* ==================== 预烘焙通用形(特效/光晕/掉落的高频元素) ====================
     * 每个形状第一次用到时烘焙一次, 之后每颗粒子只花 1 次 drawImage。
     * 这里全部用径向渐变做软边 —— 烘焙期可以随便用, 热路径禁止(Balance 纪律 R3.5)。 */

    /** 径向光晕(旧 API, 保留): 实心色 → 透明 */
    glow: function (color, r) {
      var key = 'glow:' + color + ':' + r;
      return this.get(key, r * 2, r * 2, function (c, x) {
        var gr = x.createRadialGradient(0, 0, 0, 0, 0, r);
        gr.addColorStop(0, color);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = gr;
        x.beginPath(); x.arc(0, 0, r, 0, TAU); x.fill();
      });
    },

    /** 软圆点粒子: 亮心 → 本色 → 透明(命中火花/拾取微光共用) */
    dot: function (color, r) {
      var key = 'dot:' + color + ':' + r;
      var rr = Math.ceil(r);
      return this.get(key, rr * 2 + 2, rr * 2 + 2, function (c, x) {
        var gr = x.createRadialGradient(0, 0, 0, 0, 0, rr);
        gr.addColorStop(0, '#ffffff');
        gr.addColorStop(0.28, color);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = gr;
        x.beginPath(); x.arc(0, 0, rr, 0, TAU); x.fill();
      });
    },

    /** 冲击环: 外圈硬边 + 内侧柔光(替换 beginPath+arc+stroke 的热路径调用) */
    ringImg: function (color, r, lw) {
      var key = 'ring:' + color + ':' + r + ':' + lw;
      var rr = Math.ceil(r) + 2;
      return this.get(key, rr * 2, rr * 2, function (c, x) {
        var gr = x.createRadialGradient(0, 0, rr * 0.55, 0, 0, rr);
        gr.addColorStop(0, 'rgba(0,0,0,0)');
        gr.addColorStop(0.62, color);
        gr.addColorStop(0.86, color);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = gr;
        x.beginPath(); x.arc(0, 0, rr, 0, TAU); x.fill();
        x.strokeStyle = color; x.lineWidth = lw || 2;
        x.beginPath(); x.arc(0, 0, rr * 0.82, 0, TAU); x.stroke();
      });
    },

    /** 尖锐碎片(击杀碎块/冰晶碎片): 三角 + 高光棱 */
    shard: function (color, len) {
      var key = 'shard:' + color + ':' + len;
      var h = Math.ceil(len);
      return this.get(key, h * 2 + 4, h * 2 + 4, function (c, x) {
        x.beginPath();
        x.moveTo(0, -len);
        x.lineTo(len * 0.52, len * 0.42);
        x.lineTo(-len * 0.34, len);
        x.lineTo(-len * 0.62, -len * 0.2);
        x.closePath();
        x.fillStyle = color; x.fill();
        x.strokeStyle = '#100c08'; x.lineWidth = 1.2; x.stroke();
        x.beginPath();
        x.moveTo(0, -len * 0.72); x.lineTo(len * 0.2, len * 0.2); x.lineTo(-len * 0.16, len * 0.5);
        x.closePath();
        x.fillStyle = 'rgba(255,255,255,0.34)'; x.fill();
      });
    },

    /** 四芒星(暴击十字星/拾取闪星) */
    star: function (color, r) {
      var key = 'star:' + color + ':' + r;
      var rr = Math.ceil(r);
      return this.get(key, rr * 2 + 2, rr * 2 + 2, function (c, x) {
        var g = x.createRadialGradient(0, 0, 0, 0, 0, rr);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.42, color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g;
        x.beginPath();
        x.moveTo(0, -rr); x.quadraticCurveTo(rr * 0.1, -rr * 0.1, rr, 0);
        x.quadraticCurveTo(rr * 0.1, rr * 0.1, 0, rr);
        x.quadraticCurveTo(-rr * 0.1, rr * 0.1, -rr, 0);
        x.quadraticCurveTo(-rr * 0.1, -rr * 0.1, 0, -rr);
        x.closePath(); x.fill();
      });
    },

    /** 六角冰晶(冰冻反馈) */
    frost: function (color, r) {
      var key = 'frost:' + color + ':' + r;
      var rr = Math.ceil(r);
      return this.get(key, rr * 2 + 2, rr * 2 + 2, function (c, x) {
        var i, a;
        x.strokeStyle = color; x.lineWidth = Math.max(1.2, rr * 0.18); x.lineCap = 'round';
        for (i = 0; i < 3; i++) {
          a = i * Math.PI / 3;
          x.beginPath();
          x.moveTo(-Math.cos(a) * rr, -Math.sin(a) * rr);
          x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
          x.stroke();
        }
        x.strokeStyle = 'rgba(255,255,255,0.75)';
        x.lineWidth = Math.max(0.8, rr * 0.1);
        x.beginPath(); x.arc(0, 0, rr * 0.22, 0, TAU); x.stroke();
      });
    },

    /** 余烬(灼烧反馈): 暖色软核 + 亮心 */
    ember: function (color, r) {
      var key = 'ember:' + color + ':' + r;
      var rr = Math.ceil(r);
      return this.get(key, rr * 2 + 2, rr * 2 + 2, function (c, x) {
        var g = x.createRadialGradient(0, -rr * 0.1, 0, 0, 0, rr);
        g.addColorStop(0, '#fff6c8');
        g.addColorStop(0.4, color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g;
        x.beginPath();
        x.moveTo(0, -rr * 1.15);
        x.quadraticCurveTo(rr * 0.78, rr * 0.1, 0, rr);
        x.quadraticCurveTo(-rr * 0.78, rr * 0.1, 0, -rr * 1.15);
        x.closePath(); x.fill();
      });
    }
  };
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));