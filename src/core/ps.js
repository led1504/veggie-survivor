/* PS.Core v2 —— 命名空间/工具/音效引擎
 * 音效引擎(Web Audio 程序化合成, 零音频文件): 全部游戏音效由振荡器+噪声+包络实时生成。
 * 微信端由 platform/weapp.js 提供 wx.createWebAudioContext 注入; 浏览器端用 AudioContext。
 */
(function (global) {
  'use strict';
  var PS = global.PS || {};
  PS.TAU = Math.PI * 2;
  PS.VERSION = '2.0.0';

  var util = PS.util = {
    clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    dist2: function (ax, ay, bx, by) { var dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; },
    dist: function (ax, ay, bx, by) { return Math.sqrt(util.dist2(ax, ay, bx, by)); },
    angleTo: function (ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); },
    pick: function (arr, rng) { return arr[(rng ? rng() : Math.random()) * arr.length | 0]; },
    randRange: function (a, b, rng) { return a + (rng ? rng() : Math.random()) * (b - a); },
    weighted: function (items, rng) {
      var r = rng ? rng() : Math.random(), sum = 0, i;
      for (i = 0; i < items.length; i++) sum += items[i].w;
      if (sum <= 0) return items[0].v;
      r *= sum;
      for (i = 0; i < items.length; i++) { r -= items[i].w; if (r <= 0) return items[i].v; }
      return items[items.length - 1].v;
    },
    makeRng: function (seed) {
      var a = seed >>> 0;
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    Pool: function (make) { this.make = make; this.free = []; },
    clone: function (o) { return JSON.parse(JSON.stringify(o)); }
  };
  util.Pool.prototype.get = function () { return this.free.pop() || this.make(); };
  util.Pool.prototype.put = function (o) { if (this.free.length < 512) { o._dead = true; this.free.push(o); } };

    /* ================= 音效引擎 v3 (程序化合成) =================
   * 设计口径: qa/audio-design.md §1 (20 条配方) / §2 (分层与压制) / §4 (混音) / §5 (性能预算)。
   *
   * 与 v2 的本质区别:
   *   ① 每条音效是「瞬态 + 主体 + 尾韵」多层配方(2 振荡器带 ±¢ 失谐 + 扫频滤波 + 噪声塑形),
   *      而不是单一方波/单噪声脉冲;
   *   ② 运行时**零分配**: POOL_SIZE 个声部在 init() 里一次性建好 —— 每次发声只重设
   *      frequency/包络参数, 不再逐发 new Oscillator (旧版密集战斗下 GC 抖动的根因);
   *   ③ 噪声走「循环 BufferSource + 增益门」: AudioBufferSourceNode 不可重启, 因此一生只 start() 一次;
   *   ④ 静音/切层一律短淡出(≥1ms ramp, 释放到 0.0001 而非 0), 全链路无爆音;
   *   ⑤ 所有参数写入走能力探测(sndSet/sndExp/sndLin/sndCan), 微信端缺 detune/panner/compressor 时自动降级不抛。
   *
   * 对外 API 保持不变: ctx / master / enabled / _ok / init / resume / toggle / play / _playRaw /
   *                   GATE / MAX_VOICES / stats / tone / noise / arp。
   */
  function sndFn(o, m) { return !!o && typeof o[m] === 'function'; }
  function sndSet(p, v, t) {
    try { if (!p) return; if (sndFn(p, 'setValueAtTime')) p.setValueAtTime(v, t); else p.value = v; } catch (e) {}
  }
  function sndExp(p, v, t) {
    try { if (!p) return; var x = v > 0.00002 ? v : 0.00002; if (sndFn(p, 'exponentialRampToValueAtTime')) p.exponentialRampToValueAtTime(x, t); else p.value = x; } catch (e) {}
  }
  function sndLin(p, v, t) {
    try { if (!p) return; if (sndFn(p, 'linearRampToValueAtTime')) p.linearRampToValueAtTime(v, t); else p.value = v; } catch (e) {}
  }
  function sndCan(p, t) { try { if (sndFn(p, 'cancelScheduledValues')) p.cancelScheduledValues(t); } catch (e) {} }

  /* ---------- 配方: 层字段 ----------
   * s      'osc' | 'nz'                        层类型
   * w      振荡器波形 (osc)
   * f/f2   绝对起止频率 Hz (osc, 与 r0/r1 二选一)
   * r0/r1  相对音符基频的起止倍率 (osc, 用于 levelup/buy/... 这类多音琶音)
   * vol    该层峰值增益; det 失谐音分; jit 音高随机化比例(默认 0.015, 0 关闭)
   * a/d/s/r 包络(毫秒); dur = 保持段(毫秒)
   * filt   {t 类型, q 品质因数, a 起始 Hz, b 终点 Hz, c 终点后再扫到 Hz(可选)}
   */
  var R_LEVELUP = {
    gain: 1.679,
    dur: 560, noteLayers: [
      { s: 'osc', w: 'triangle', r0: 1, r1: 1, vol: 0.32, a: 6, d: 110, r: 80, dur: 150, filt: { t: 'lowpass', q: 0.8, a: 5000, b: 6500 } },
      { s: 'osc', w: 'triangle', r0: 2, r1: 2, vol: 0.15, det: 4, a: 6, d: 100, r: 70, dur: 150, filt: { t: 'lowpass', q: 0.8, a: 6000, b: 7500 } },
      { s: 'nz', vol: 0.06, a: 1, d: 20, r: 10, dur: 24, filt: { t: 'highpass', q: 0.9, a: 9000, b: 9000 } }
    ],
    notes: [{ at: 0, freq: 523 }, { at: 62, freq: 659 }, { at: 124, freq: 784 }, { at: 186, freq: 1047 }]
  };
  var R_WAVE_NOTE = [
    { s: 'osc', w: 'triangle', r0: 1, r1: 1, vol: 0.26, a: 15, d: 200, r: 150, dur: 260, filt: { t: 'lowpass', q: 0.9, a: 500, b: 4000 } },
    { s: 'osc', w: 'sawtooth', r0: 1, r1: 1, vol: 0.10, det: -6, a: 15, d: 200, r: 150, dur: 260, filt: { t: 'lowpass', q: 1.0, a: 400, b: 2600 } },
    { s: 'nz', vol: 0.10, a: 20, d: 150, r: 200, dur: 300, filt: { t: 'lowpass', q: 0.9, a: 800, b: 400 } }
  ];
  var R_WIN_NOTE = [
    { s: 'osc', w: 'triangle', r0: 1, r1: 1, vol: 0.30, a: 6, d: 200, r: 240, dur: 300, filt: { t: 'lowpass', q: 0.8, a: 4000, b: 7000 } },
    { s: 'osc', w: 'sine', r0: 2, r1: 2, vol: 0.13, a: 6, d: 220, r: 280, dur: 320, filt: { t: 'lowpass', q: 0.8, a: 6000, b: 9000 } },
    { s: 'nz', vol: 0.07, a: 2, d: 40, r: 20, dur: 60, filt: { t: 'highpass', q: 0.9, a: 9000, b: 11000 } }
  ];
  var R_LOSE_NOTE = [
    { s: 'osc', w: 'sawtooth', r0: 1, r1: 1, vol: 0.24, jit: 0.006, a: 10, d: 260, r: 300, dur: 420, filt: { t: 'lowpass', q: 1.1, a: 1200, b: 400 } },
    { s: 'osc', w: 'triangle', r0: 0.5, r1: 0.5, vol: 0.17, a: 10, d: 260, r: 320, dur: 420, filt: { t: 'lowpass', q: 0.9, a: 900, b: 300 } },
    { s: 'nz', vol: 0.07, a: 2, d: 30, r: 20, dur: 40, filt: { t: 'highpass', q: 0.9, a: 5000, b: 5000 } }
  ];
  var R_BUY_NOTE = [
    { s: 'osc', w: 'triangle', r0: 1, r1: 1, vol: 0.32, a: 3, d: 55, r: 26, dur: 80, filt: { t: 'lowpass', q: 0.8, a: 4000, b: 7000 } },
    { s: 'osc', w: 'sine', r0: 2, r1: 2, vol: 0.13, a: 3, d: 50, r: 24, dur: 70, filt: { t: 'lowpass', q: 0.7, a: 6000, b: 8000 } }
  ];
  var R_SELL_NOTE = [
    { s: 'osc', w: 'triangle', r0: 1, r1: 1, vol: 0.28, a: 3, d: 65, r: 36, dur: 90, filt: { t: 'lowpass', q: 0.8, a: 3600, b: 5200 } },
    { s: 'osc', w: 'square', r0: 2, r1: 2, vol: 0.09, det: -5, a: 3, d: 60, r: 30, dur: 80, filt: { t: 'bandpass', q: 1.1, a: 2400, b: 1200 } }
  ];
  var R_FUSE_NOTE = [
    { s: 'osc', w: 'square', r0: 1, r1: 1, vol: 0.20, a: 3, d: 55, r: 30, dur: 80, filt: { t: 'lowpass', q: 1.0, a: 2000, b: 5000 } },
    { s: 'osc', w: 'sine', r0: 2, r1: 2, vol: 0.10, a: 3, d: 55, r: 30, dur: 80, filt: { t: 'lowpass', q: 0.8, a: 3000, b: 6000 } }
  ];
  var R_HORDE_NOTE = [
    { s: 'osc', w: 'sawtooth', r0: 1, r1: 1, vol: 0.28, jit: 0.004, a: 8, d: 180, r: 120, dur: 240, filt: { t: 'lowpass', q: 1.0, a: 900, b: 300 } },
    { s: 'osc', w: 'triangle', r0: 1.414, r1: 1.414, vol: 0.10, det: 12, jit: 0, a: 8, d: 180, r: 120, dur: 240, filt: { t: 'bandpass', q: 1.3, a: 1400, b: 700 } }
  ];
  var R_REROLL_TICK = [
    { s: 'nz', vol: 0.26, a: 1, d: 14, r: 8, dur: 16, filt: { t: 'highpass', q: 0.9, a: 3400, b: 3600 } }
  ];

  PS.Sound = {
    ctx: null, master: null, limiter: null, clip: null, enabled: true, _ok: false,
    /* 事件外挂: function(name) —— PS.Music 装上它做侧链/分层, 异常一律吞掉不影响发声 */
    onEvent: null,
    /* 声部预算: 20ms 窗口内计费的声部数上限(smoke2 断言语义不变); 池容量只影响极端并发 */
    MAX_VOICES: 5, WINDOW: 0.02, POOL_SIZE: 24, PAN: 0.35,
    /* 类别: 0=UI 1=STING(叙事) 2=PLAYER 3=MASS; ≤1 不占计费窗口(但仍占声部池) */
    CLASS: {
      click: 0, buy: 0, sell: 0, fuse: 0, reroll: 0,
      levelup: 1, win: 1, lose: 1, boss: 1, wave: 1, horde: 1,
      shoot: 2, shoot2: 2, melee: 2, hurt: 2, dodge: 2, crit: 2, pickup: 2,
      hit: 3, kill: 3
    },
    /* 同名门限(s): 密集战斗下防止同一种音效叠成噪音墙 */
    GATE: { hit: 0.055, kill: 0.07, shoot: 0.075, shoot2: 0.075, melee: 0.07, crit: 0.06, pickup: 0.05, hurt: 0.12, dodge: 0.1, click: 0.03 },

    /* ---------- 内部状态 ---------- */
    _v: [], _cur: 0, _nz: null, _noiseBuf: {},
    _vlog: {}, _winT: -1, _winN: 0, _dropped: 0, _exempt: 0, _dens: 0, _densT: 0,

    init: function (audioCtx) {
      if (this._ok) return;
      try {
        this.ctx = audioCtx || (typeof AudioContext !== 'undefined' ? new AudioContext() : null);
        if (this.ctx) {
          var c = this.ctx;
          this.master = c.createGain();
          this.master.gain.value = 0.5;                    // 总音量(与 v2 一致)
          var tail = this.master;
          if (sndFn(c, 'createDynamicsCompressor')) {      // 软限幅: 并发峰值不削波
            try {
              var lim = c.createDynamicsCompressor();
              lim.threshold.value = -6; lim.knee.value = 3; lim.ratio.value = 12;
              lim.attack.value = 0.003; lim.release.value = 0.1;
              this.master.connect(lim);
              tail = lim; this.limiter = lim;
            } catch (e1) { this.limiter = null; }
          }
          if (sndFn(c, 'createWaveShaper')) {          // 软限幅尾部: 把天花板写死, 任何并发都不削波
            try {
              var ws = c.createWaveShaper();
              ws.curve = this._softCurve(0.87, 0.70);
              try { ws.oversample = '4x'; } catch (e2) {}
              tail.connect(ws);
              tail = ws; this.clip = ws;
            } catch (e3) { this.clip = null; }
          }
          tail.connect(c.destination);
          this._nz = this._loopNoise(c);                    // 循环白噪声(1s), 全体声部共用
          this._buildPool(c);                               // 声部池: 运行时零分配
          this._ok = true;
        }
      } catch (e) { this._ok = false; }
    },

    resume: function () { if (this.ctx && this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) {} } },
    toggle: function () { this.enabled = !this.enabled; return this.enabled; },

    /* 1s 循环白噪声 buffer(所有噪声声部共用一个 AudioBuffer; 逐发靠 playbackRate/滤波/增益随机化区分) */
    _loopNoise: function (c) {
      try {
        if (!sndFn(c, 'createBuffer')) return null;
        var len = Math.max(1, (1.0 * c.sampleRate) | 0), b = c.createBuffer(1, len, c.sampleRate);
        var d = b.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        return b;
      } catch (e) { return null; }
    },

    /* 声部池: 每声部 = 2 振荡器 + 2 噪声槽(懒建) + 各自滤波/增益 + 声像。全部一次性创建。 */
    _buildPool: function (c) {
      var i, j, self = this;
      this._v = [];
      function mkOsc(dst) {
        var o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
        o.type = 'sine'; o.frequency.value = 440;
        g.gain.value = 0;                             // 闲置=真静音: 池里 48 个振荡器零泄漏(旧值 0.0001 会在总线上叠出 -54dB 的 440Hz 底噪)
        o.connect(f); f.connect(g); g.connect(dst);
        try { o.start(0); } catch (e) {}
        return { k: 'osc', src: o, f: f, g: g };
      }
      for (i = 0; i < this.POOL_SIZE; i++) {
        var out = c.createGain();
        out.gain.value = 1;
        var pan = null;
        if (sndFn(c, 'createStereoPanner')) { try { pan = c.createStereoPanner(); pan.pan.value = 0; } catch (e0) { pan = null; } }
        if (pan) { out.connect(pan); pan.connect(this.master); } else { out.connect(this.master); }
        var osc = [mkOsc(out), mkOsc(out)], noise = [];
        for (j = 0; j < 2; j++) noise.push({ k: 'nz', src: null, f: null, g: null });
        this._v.push({ out: out, pan: pan, osc: osc, noise: noise, freeAt: 0 });
      }
      return this._v.length;
    },

    /* 噪声槽懒建(每槽一生只建/启动一次) —— 避免 init 时白开 48 个 BufferSource */
    _slotNoise: function (c, slot) {
      if (slot.src || !this._nz) return slot.src;
      try {
        var s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
        s.buffer = this._nz; s.loop = true;
        f.type = 'highpass'; f.frequency.value = 2000;
        g.gain.value = 0;
        s.connect(f); f.connect(g); if (slot._out) g.connect(slot._out);
        try { s.start(0); } catch (e0) {}
        slot.src = s; slot.f = f; slot.g = g;
      } catch (e) { slot.src = null; }
      return slot.src;
    },

    /* 软限幅曲线: |x| ≤ T 段逐点线性(透明), 之上按 tanh 平滑压向天花板 C。
     * WaveShaper 把曲线区间外的输入都映射到端点值, 因此输出恒 < C —— 峰值上限是数学保证, 不靠调增益。 */
    _softCurve: function (C, T) {
      var n = 2048, cur, i, x, a, y;
      try { cur = new Float32Array(n); } catch (e) { return null; }
      for (i = 0; i < n; i++) {
        x = i / (n - 1) * 2 - 1;
        a = x < 0 ? -x : x;
        y = a <= T ? a : T + (C - T) * Math.tanh((a - T) / (C - T));
        cur[i] = x < 0 ? -y : y;
      }
      return cur;
    },

    _now: function () { var c = this.ctx; return (c && c.currentTime) ? c.currentTime : 0; },

    /* 密度(0..1, 时间常数 0.30s): 音乐侧链读它 —— 音效越密, 音乐越让位 */
    _densNow: function () {
      var now = this._now(), dt = now - this._densT;
      if (dt > 0) { this._dens *= Math.exp(-dt / 0.30); this._densT = now; }
      return this._dens;
    },
    densityNow: function () { return this._densNow(); },

    stats: function () {
      return { voices: this._winN, exempt: this._exempt, dropped: this._dropped, window: this.WINDOW, density: this._densNow() };
    },

    /* ---------- 对外播放入口(带门限/预算/密度压制) ---------- */
    play: function (name) {
      if (!this._ok || !this.enabled) return;
      var now = this._now(), cls = this.CLASS[name];
      if (cls === undefined) cls = 2;
      var gate = this.GATE[name];
      if (gate !== undefined) {
        var last = this._vlog[name];
        if (last !== undefined && now - last < gate) { this._dropped++; return; }
        this._vlog[name] = now;
      }
      this._dens = Math.min(1, this._densNow() + 0.22); this._densT = now;
      if (cls > 1) {                                        // UI/叙事音不占计费窗口
        if (now - this._winT >= this.WINDOW) { this._winT = now; this._winN = 0; }
        if (this._winN >= this.MAX_VOICES) { this._dropped++; return; }
        this._winN++;
      } else { this._exempt++; }
      this._playRaw(name);
    },

    /* ---------- 具名配方发声(不节流; 关键音效可直接调) ----------
     * 密度压制: 同一窗口内已发 n 个声部 → 后续增益 ×max(0.45, 1/(1+0.35n)) */
    _playRaw: function (name) {
      if (!this._ok || !this.enabled) return;
      var R = this.RECIPES[name];
      if (!R) return;
      var n = this._winN, scale = Math.max(0.45, 1 / (1 + 0.35 * n)) * (R.gain === undefined ? 1 : R.gain);
      var t0 = this._now() + 0.006, i;
      try {
        /* 伴奏层(与多音琶音同时发声的轰鸣/瞬态) + 琶音层 + 第二声部(失谐拍频) */
        if (R.layers) this._bank(R.layers, t0, scale, 0);
        if (R.notes) {
          for (i = 0; i < R.notes.length; i++) {
            var nt = R.notes[i];
            this._bank(nt.layers || R.noteLayers, t0 + (nt.at || 0) / 1000, scale, nt.freq || 0);
          }
        }
        if (R.layers2) this._bank(R.layers2, t0, scale, 0);
      } catch (e) {}
      if (this.onEvent) { try { this.onEvent(name); } catch (e2) {} }
      return true;
    },

    /* ---------- 声部调度 ---------- */
    _pick: function (t) {
      var n = this._v.length, i, v;
      for (i = 0; i < n; i++) {
        v = this._v[(this._cur + i) % n];
        if (v.freeAt <= t) { this._cur = (this._cur + i + 1) % n; return v; }
      }
      return null;                                          // 池满 → 丢弃(不抢占, 避免截断造成爆音)
    },

    _bank: function (layers, t, scale, base) {
      if (!layers || !layers.length) return false;
      var v = this._pick(t);
      if (!v) { this._dropped++; return false; }
      var c = this.ctx, oi = 0, ni = 0, end = t, i, L, slot, e;
      var jit = 0.92 + Math.random() * 0.16;                 // 每发音量 ±0.7dB
      if (v.pan && v.pan.pan) sndSet(v.pan.pan, (Math.random() * 2 - 1) * this.PAN, t);
      for (i = 0; i < layers.length; i++) {
        L = layers[i];
        if (!L) continue;
        if (L.s === 'nz') {
          slot = v.noise[ni++];
          if (slot && !slot.src) { slot._out = v.out; this._slotNoise(c, slot); }
        } else { slot = v.osc[oi++]; }
        if (!slot || !slot.src) continue;
        e = this._slot(slot, L, t, scale * jit, base);
        if (e > end) end = e;
      }
      if (end > v.freeAt) v.freeAt = end;
      return true;
    },

    /* 单层发声: 音高/滤波扫频 + ADSR 包络, 返回该层结束时刻(供声部占用估算) */
    _slot: function (slot, L, t, scale, base) {
      var a = (L.a === undefined ? 3 : L.a) / 1000;
      var d = (L.d === undefined ? 60 : L.d) / 1000;
      var s = L.s === undefined ? 0 : L.s;
      var r = (L.r === undefined ? 25 : L.r) / 1000;
      var dur = (L.dur === undefined ? (L.a + L.d) : L.dur) / 1000;
      var end = t + dur + r, vol = Math.max(0.0004, (L.vol === undefined ? 0.2 : L.vol) * scale);
      var F = L.filt, ft = F ? (F.a || 800) : 18000, fb = F ? (F.b || ft) : ft;
      /* 滤波扫频 */
      if (slot.f) {
        try { slot.f.type = (F && F.t) || 'lowpass'; } catch (e0) {}
        try { if (slot.f.Q) slot.f.Q.value = (F && F.q) || 0.9; } catch (e1) {}
        sndSet(slot.f.frequency, ft, t);
        if (fb !== ft) sndExp(slot.f.frequency, fb, t + dur * 0.85);
        if (F && F.c) sndExp(slot.f.frequency, F.c, end);
      }
      /* 音源 */
      if (slot.k === 'osc') {
        var jp = L.jit === undefined ? 0.015 : L.jit;
        var rj = 1 + (Math.random() * 2 - 1) * jp;
        var f0 = (L.r0 ? base * L.r0 : L.f) * rj;
        var f1 = L.r1 ? base * L.r1 : (L.f2 === undefined ? f0 : L.f2 * rj);
        sndSet(slot.src.frequency, Math.max(20, f0), t);
        if (f1 !== f0) sndExp(slot.src.frequency, Math.max(20, f1), t + dur);
        if (L.w) { try { slot.src.type = L.w; } catch (e2) {} }
        if (L.det && slot.src.detune) sndSet(slot.src.detune, L.det, t);
      } else if (slot.src.playbackRate) {                   // 噪声: 每次换速率 → 噪声"颜色"不重复
        sndSet(slot.src.playbackRate, 0.88 + Math.random() * 0.24, t);
      }
      /* ADSR 包络(释放到 0.0001, 不落到 0 —— exponentialRamp 不能到 0) */
      var g = slot.g.gain;
      sndCan(g, t);
      sndSet(g, 0.0001, t);
      sndExp(g, vol, t + a);
      if (s > 0) {
        sndExp(g, Math.max(0.0002, vol * s), t + a + d);
        if (dur - r > a + d) sndSet(g, Math.max(0.0002, vol * s), t + dur - r);
      }
      sndExp(g, 0.0001, end);
      sndLin(g, 0, end + 0.004);                       // exponentialRamp 到不了 0 → 再补 4ms 线性归零, 闲置声部真静音
      return end + 0.01;
    },

    /* ---------- 兼容 API(tone / noise / arp) ---------- */
    tone: function (cfg) {
      if (!this._ok || !this.enabled) return;
      cfg = cfg || {};
      this._bank([{ s: 'osc', w: cfg.type || 'square', f: cfg.f0 || 440, f2: cfg.f1 || cfg.f0 || 440, vol: cfg.vol || 0.18, a: 3, d: 40, r: 20, dur: (cfg.dur || 0.1) * 1000, filt: { t: 'lowpass', q: 0.8, a: 6000, b: 3000 } }], this._now() + 0.006, 1, 0);
    },
    noise: function (cfg) {
      if (!this._ok || !this.enabled) return;
      cfg = cfg || {};
      this._bank([{ s: 'nz', vol: cfg.vol || 0.2, a: 1, d: (cfg.dur || 0.15) * 1000, r: 8, dur: (cfg.dur || 0.15) * 1000, filt: { t: cfg.filter || 'lowpass', q: 0.9, a: cfg.freq || 1200, b: (cfg.freq || 1200) * 0.6 } }], this._now() + 0.006, 1, 0);
    },
    /* v3: 不再用 setTimeout 逐音定时(旧版会在静音/失焦时继续发声且精度受主线程影响),
     * 改为在音频时间轴上预排 —— 与音乐引擎同一套前瞻思路 */
    arp: function (freqs, cfg) {
      if (!this._ok || !this.enabled) return;
      cfg = cfg || {};
      var t0 = this._now() + 0.006, gap = (cfg.gap || 70) / 1000, i;
      for (i = 0; i < freqs.length; i++) {
        this._bank([{ s: 'osc', w: cfg.type || 'triangle', f: freqs[i], vol: cfg.vol || 0.15, a: 4, d: 90, r: 60, dur: (cfg.dur || 0.12) * 1000, filt: { t: 'lowpass', q: 0.8, a: 5000, b: 4000 } }], t0 + i * gap, 1, 0);
      }
    },
    /* 兼容保留: 按时长分桶缓存的一次性噪声(新引擎默认走循环噪声槽 + 增益门, 这里供外部调用/诊断) */
    _noiseCache: function (dur, c) {
      var bucket = Math.max(1, Math.round(dur * 50)) / 50;
      var buf = this._noiseBuf[bucket];
      if (!buf || buf.sampleRate !== c.sampleRate) {
        var len = Math.max(1, (bucket * c.sampleRate) | 0);
        buf = c.createBuffer(1, len, c.sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
        this._noiseBuf[bucket] = buf;
      }
      return buf;
    },

    /* ================= 20 条配方 (qa/audio-design.md §1) ================= */
    RECIPES: {
      /* 1. 玩家基础射击: 干脆的"能量弹射" —— 方波主体 + 失谐副音 + 高频瞬态 */
      shoot: {
        gain: 3.301,
        layers: [
          { s: 'osc', w: 'square', f: 1180, f2: 430, vol: 0.55, a: 3, d: 42, r: 16, dur: 58, filt: { t: 'bandpass', q: 1.0, a: 4400, b: 900 } },
          { s: 'osc', w: 'triangle', f: 2360, f2: 880, vol: 0.20, det: 7, a: 3, d: 40, r: 14, dur: 58, filt: { t: 'bandpass', q: 1.0, a: 4400, b: 900 } },
          { s: 'nz', vol: 0.18, a: 1, d: 14, r: 5, dur: 16, filt: { t: 'highpass', q: 1.1, a: 3200, b: 1200 } }
        ]
      },
      /* 2. 散射/变异射击: 低频更"肉"的噗声 —— 失谐双锯齿 + 亚音 */
      shoot2: {
        gain: 3.578,
        layers: [
          { s: 'osc', w: 'sawtooth', f: 620, f2: 190, vol: 0.46, a: 4, d: 70, r: 22, dur: 95, filt: { t: 'bandpass', q: 0.9, a: 2600, b: 600 } },
          { s: 'osc', w: 'sine', f: 155, f2: 140, vol: 0.26, a: 4, d: 70, r: 22, dur: 95, filt: { t: 'lowpass', q: 0.7, a: 900, b: 400 } },
          { s: 'nz', vol: 0.15, a: 2, d: 50, r: 8, dur: 60, filt: { t: 'lowpass', q: 0.9, a: 1800, b: 600 } }
        ]
      },
      /* 3. 近战挥砍: 刀风上升扫频 + 高频击点 */
      melee: {
        gain: 8.675,
        layers: [
          { s: 'nz', vol: 0.42, a: 6, d: 110, r: 22, dur: 130, filt: { t: 'bandpass', q: 1.3, a: 900, b: 4200 } },
          { s: 'nz', vol: 0.16, a: 1, d: 12, r: 4, dur: 14, filt: { t: 'highpass', q: 1.0, a: 6000, b: 6000 } },
          { s: 'osc', w: 'triangle', f: 320, f2: 180, vol: 0.13, a: 6, d: 100, r: 18, dur: 120, filt: { t: 'lowpass', q: 0.8, a: 1200, b: 500 } }
        ]
      },
      /* 4. 普通命中: 短促"啪" + 低频 thump */
      hit: {
        gain: 5.109,
        layers: [
          { s: 'nz', vol: 0.40, a: 2, d: 44, r: 12, dur: 50, filt: { t: 'bandpass', q: 1.2, a: 1900, b: 700 } },
          { s: 'nz', vol: 0.18, a: 1, d: 8, r: 3, dur: 11, filt: { t: 'highpass', q: 1.0, a: 6000, b: 6000 } },
          { s: 'osc', w: 'sine', f: 190, f2: 120, vol: 0.28, a: 2, d: 40, r: 12, dur: 45, filt: { t: 'lowpass', q: 0.8, a: 1400, b: 600 } }
        ]
      },
      /* 5. 暴击: 8Hz 拍频金属双音 + 低频 thump(第二声部) */
      crit: {
        gain: 4.551,
        layers: [
          { s: 'osc', w: 'square', f: 1560, vol: 0.28, det: 0, jit: 0, a: 2, d: 80, r: 24, dur: 90, filt: { t: 'bandpass', q: 1.1, a: 3600, b: 1400 } },
          { s: 'osc', w: 'square', f: 1568, vol: 0.24, det: 0, jit: 0, a: 2, d: 80, r: 24, dur: 90, filt: { t: 'bandpass', q: 1.1, a: 3600, b: 1400 } },
          { s: 'nz', vol: 0.17, a: 1, d: 6, r: 3, dur: 9, filt: { t: 'highpass', q: 1.0, a: 7000, b: 7000 } },
          { s: 'nz', vol: 0.20, a: 2, d: 60, r: 14, dur: 70, filt: { t: 'bandpass', q: 1.4, a: 3600, b: 1400 } }
        ],
        layers2: [
          { s: 'osc', w: 'sine', f: 110, f2: 60, vol: 0.32, a: 3, d: 80, r: 30, dur: 100, filt: { t: 'lowpass', q: 0.7, a: 800, b: 300 } }
        ]
      },
      /* 6. 敌人死亡: 切菜的湿脆 + 油锅收尾(单滤波三段扫: 1400→380→5000) */
      kill: {
        gain: 6.283,
        layers: [
          { s: 'nz', vol: 0.40, a: 3, d: 120, r: 30, dur: 130, filt: { t: 'lowpass', q: 1.6, a: 1400, b: 380, c: 5000 } },
          { s: 'nz', vol: 0.09, a: 20, d: 60, r: 20, dur: 90, filt: { t: 'highpass', q: 0.9, a: 5000, b: 5200 } },
          { s: 'osc', w: 'triangle', f: 300, f2: 90, vol: 0.26, a: 3, d: 110, r: 26, dur: 120, filt: { t: 'lowpass', q: 0.9, a: 1200, b: 400 } }
        ]
      },
      /* 7. 拾取: 轻盈上扬双音 + 微亮点 */
      pickup: {
        gain: 2.992,
        layers: [
          { s: 'osc', w: 'sine', f: 1050, f2: 1680, vol: 0.36, a: 2, d: 40, r: 10, dur: 50, filt: { t: 'lowpass', q: 0.7, a: 6000, b: 8000 } },
          { s: 'osc', w: 'triangle', f: 2100, f2: 3360, vol: 0.18, det: 6, a: 2, d: 36, r: 10, dur: 48, filt: { t: 'lowpass', q: 0.7, a: 6000, b: 8000 } },
          { s: 'nz', vol: 0.09, a: 1, d: 6, r: 2, dur: 8, filt: { t: 'highpass', q: 1.0, a: 8000, b: 8000 } }
        ]
      },
      /* 8. 玩家受伤: 痛苦下坠 + 冲击(关键反馈, 刻意最大声) */
      hurt: {
        gain: 5.547,
        layers: [
          { s: 'osc', w: 'sawtooth', f: 210, f2: 65, vol: 0.42, a: 3, d: 120, r: 50, dur: 170, filt: { t: 'lowpass', q: 1.0, a: 2200, b: 400 } },
          { s: 'osc', w: 'sine', f: 90, f2: 45, vol: 0.30, a: 4, d: 140, r: 55, dur: 180, filt: { t: 'lowpass', q: 0.7, a: 700, b: 200 } },
          { s: 'nz', vol: 0.24, a: 2, d: 120, r: 35, dur: 140, filt: { t: 'lowpass', q: 1.2, a: 900, b: 260 } },
          { s: 'nz', vol: 0.15, a: 1, d: 7, r: 3, dur: 10, filt: { t: 'highpass', q: 1.0, a: 5200, b: 5200 } }
        ]
      },
      /* 9. 闪避: 轻快 whoosh(上升带通噪声) */
      dodge: {
        gain: 6.679,
        layers: [
          { s: 'nz', vol: 0.32, a: 5, d: 60, r: 18, dur: 70, filt: { t: 'bandpass', q: 1.0, a: 700, b: 3600 } },
          { s: 'osc', w: 'sine', f: 720, f2: 1320, vol: 0.18, a: 5, d: 55, r: 16, dur: 65, filt: { t: 'lowpass', q: 0.7, a: 3000, b: 6000 } }
        ]
      },
      /* 10. 升级: 明亮四音上行(预排在音频时间轴, 零 setTimeout) */
      levelup: R_LEVELUP,
      /* 11. 购买: 硬币"叮" + 双音上行 */
      buy: {
        gain: 1.273,
        noteLayers: R_BUY_NOTE,
        notes: [{ at: 0, freq: 880 }, { at: 55, freq: 1320 }],
        layers: [
          { s: 'nz', vol: 0.10, a: 1, d: 6, r: 2, dur: 8, filt: { t: 'highpass', q: 1.0, a: 7000, b: 7000 } }
        ]
      },
      /* 12. 出售: 下行双音 + 轻微金属 */
      sell: {
        gain: 1.167,
        noteLayers: R_SELL_NOTE,
        notes: [{ at: 0, freq: 740 }, { at: 70, freq: 466 }]
      },
      /* 13. 合成: 充能上行 + 收尾锁定咔哒 */
      fuse: {
        gain: 1.536,
        noteLayers: R_FUSE_NOTE,
        notes: [{ at: 0, freq: 440 }, { at: 50, freq: 554 }, { at: 110, freq: 659 }, { at: 180, freq: 880 }],
        layers: [
          { s: 'osc', w: 'sine', f: 110, f2: 165, vol: 0.20, a: 8, d: 200, r: 50, dur: 260, filt: { t: 'lowpass', q: 0.7, a: 700, b: 1400 } },
          { s: 'nz', vol: 0.09, a: 5, d: 260, r: 60, dur: 300, filt: { t: 'bandpass', q: 1.5, a: 600, b: 5200 } }
        ]
      },
      /* 14. 刷新商店: 洗牌 5 连轻击(幅度递减) */
      reroll: {
        gain: 1.338,
        noteLayers: R_REROLL_TICK,
        notes: [{ at: 0, freq: 0 }, { at: 22, freq: 0 }, { at: 46, freq: 0 }, { at: 72, freq: 0 }, { at: 100, freq: 0 }]
      },
      /* 15. 波次开始: 圆号味三音上行 + 长尾 */
      wave: {
        gain: 2.113,
        noteLayers: R_WAVE_NOTE,
        notes: [
          { at: 0, freq: 392, layers: R_WAVE_NOTE.concat([{ s: 'nz', vol: 0.08, a: 30, d: 400, r: 260, dur: 500, filt: { t: 'lowpass', q: 0.8, a: 900, b: 400 } }]) },
          { at: 95, freq: 523 }, { at: 190, freq: 659 }
        ]
      },
      /* 16. 怪潮警报: 四音下行 + 增四度不安层 + 低频轰鸣 */
      horde: {
        gain: 1.747,
        noteLayers: R_HORDE_NOTE,
        notes: [
          { at: 0, freq: 196, layers: R_HORDE_NOTE.concat([{ s: 'nz', vol: 0.14, a: 60, d: 600, r: 200, dur: 800, filt: { t: 'lowpass', q: 1.1, a: 400, b: 180 } }]) },
          { at: 110, freq: 185 }, { at: 220, freq: 175 }, { at: 330, freq: 165 }
        ],
        layers: [
          { s: 'osc', w: 'sine', f: 98, f2: 82, vol: 0.26, a: 20, d: 500, r: 180, dur: 700, filt: { t: 'lowpass', q: 0.7, a: 300, b: 120 } }
        ]
      },
      /* 17. Boss 登场: 低频山崩 + 长尾轰鸣(双声部 ±11¢ 制造不安拍频) */
      boss: {
        gain: 1.716,
        layers: [
          { s: 'osc', w: 'sine', f: 110, f2: 41, vol: 0.46, a: 8, d: 500, r: 280, dur: 900, filt: { t: 'lowpass', q: 0.7, a: 400, b: 180 } },
          { s: 'osc', w: 'sawtooth', f: 82, f2: 55, vol: 0.24, det: 0, jit: 0.004, a: 10, d: 520, r: 300, dur: 900, filt: { t: 'lowpass', q: 1.2, a: 180, b: 1100 } },
          { s: 'nz', vol: 0.28, a: 8, d: 480, r: 280, dur: 800, filt: { t: 'lowpass', q: 2.0, a: 500, b: 180 } },
          { s: 'nz', vol: 0.15, a: 1, d: 8, r: 4, dur: 12, filt: { t: 'highpass', q: 1.0, a: 6000, b: 6000 } }
        ],
        layers2: [
          { s: 'osc', w: 'sawtooth', f: 82, f2: 55, vol: 0.16, det: -11, jit: 0, a: 12, d: 520, r: 300, dur: 900, filt: { t: 'lowpass', q: 1.2, a: 180, b: 900 } }
        ]
      },
      /* 18. 胜利: 大调六音上行 + 钟声长尾 */
      win: {
        gain: 1.573,
        noteLayers: R_WIN_NOTE,
        notes: [
          { at: 0, freq: 523 }, { at: 105, freq: 659 }, { at: 210, freq: 784 },
          { at: 315, freq: 1047 }, { at: 420, freq: 1319 },
          { at: 525, freq: 1568, layers: R_WIN_NOTE.concat([{ s: 'nz', vol: 0.07, a: 4, d: 700, r: 400, dur: 800, filt: { t: 'highpass', q: 0.8, a: 9000, b: 12000 } }]) }
        ]
      },
      /* 19. 失败: 下行小调 + 暗色余韵 */
      lose: {
        gain: 1.763,
        noteLayers: R_LOSE_NOTE,
        notes: [{ at: 0, freq: 330 }, { at: 140, freq: 262 }, { at: 280, freq: 220 }, { at: 420, freq: 165 }],
        layers: [
          { s: 'osc', w: 'sine', f: 82, f2: 62, vol: 0.26, a: 20, d: 600, r: 400, dur: 1000, filt: { t: 'lowpass', q: 0.7, a: 300, b: 120 } },
          { s: 'nz', vol: 0.12, a: 80, d: 500, r: 400, dur: 900, filt: { t: 'lowpass', q: 0.9, a: 400, b: 180 } }
        ]
      },
      /* 20. UI 点击: 极短"嗒", 零疲劳 */
      click: {
        gain: 2.949,
        layers: [
          { s: 'osc', w: 'sine', f: 1150, vol: 0.34, a: 1, d: 30, r: 10, dur: 40, filt: { t: 'lowpass', q: 0.7, a: 6000, b: 4000 } },
          { s: 'nz', vol: 0.05, a: 1, d: 4, r: 2, dur: 6, filt: { t: 'highpass', q: 1.0, a: 8000, b: 8000 } }
        ]
      }
    }
  };

  global.PS = PS;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
