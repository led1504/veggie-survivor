/* PS.SoundVeg —— 蔬菜幸存者音效库（原创 / 零音频文件 / 零依赖 / 零构建）
 * 文件: src/ui/audio-veg.js   ·   挂载: PS.Sound 的合成实现（公开字段与调用签名完全不变）
 *
 * 声学定位: 脆(crisp) · 有汁水(juicy) · 厨房油锅(kitchen-fry)。
 * 每条配方都是三层结构: 瞬态(1~6ms 高频噪声击点) + 主体(2 振荡器带失谐拍频 + 滤波扫频)
 * + 尾韵(带通噪声短嘶/钟形泛音)。**材料化**音色族让 20 条音效听感统一又彼此可辨:
 *   metal 金属(方波对 + 带通 3.6k→1.5k, 买/暴击/刷新) · wood 木质(三角波 + Q2 带通, 点击/受击)
 *   juice 汁液(三角波下滑 + 低通 1.4k→420, 击杀/受伤/霰弹) · air 空气(带通上升扫, 挥砍/闪避)
 *   spark 火花(正弦高滑 + 钟形泛音, 拾取/升级/胜利) · impact 冲击(正弦亚音 + 低通轰, 波次/精英)
 * 空间感: 每声部有等功率声像(L/R 一对增益, 不依赖 StereoPanner) + 独立混响送出(send) →
 *   共享的立体声反馈延迟"小房间"(两条不同延迟 36/47ms + 阻尼 + 反馈, 零卷积器依赖, 微信可用);
 *   战斗音效保持干(信息优先), 奖励/UI/精英音效湿(0.30~0.42) —— 空间是"设计出来的距离"。
 *
 * 性能与节流(用户硬要求: 100 只怪 + 每秒几十次受击):
 *   ① 声部池 POOL_SIZE 个一次性建好 —— 运行时零节点创建, 只重设频率/包络参数;
 *   ② 同名门限 GATE(秒) 内只发一次; ③ 20ms 窗口内最多 MAX_VOICES 个计费声部(UI/叙事类豁免);
 *   ④ 密度压制: 同窗口已发 n 个 → 增益 ×max(0.45, 1/(1+0.35n)), 并发峰值不爬升;
 *   ⑤ 池满即丢(不抢占), 只有 _playRaw 关键音效会抢占最旧声部(4ms 淡出, 不爆音);
 *   ⑥ 噪声源懒创建 + 全池共用一个 1s 噪声 buffer。
 *
 * 降级(一条都不能抛): AudioContext 缺失/创建失败 → _ok=false 全部 no-op; localStorage 静音开关
 *   (veggie_survivor_v2_sfx = 0/off/false, 兼容旧键 potato_survivor_v2_sfx, 也可 wx 存储) →
 *   enabled=false; 微信小游戏无 document / 缺 createStereoPanner/Compressor/WaveShaper/decodeAudioData
 *   等 API → 逐项能力探测后降级; 任何异常 → 捕获并降级, 绝不让游戏崩。
 */
(function (global) {
  'use strict';
  var PS = global.PS || (global.PS = {});
  var VERSION = 'veg-1.0';

  /* ================= 0. 常量 ================= */
  var MAX_VOICES = 5;                 // 20ms 窗口内计费声部上限(语义与 v3 一致)
  var WINDOW = 0.02;                  // 计费窗口(s)
  var POOL_SIZE = 10;                 // 声部池容量(每声部 6 振荡器槽 + 4 噪声槽 + 等功率声像 + 混响送出)
  var PAN = 0.45;                     // 声像随机化幅度
  var OSC_PER_VOICE = 6;              // 6 槽: 最大的配方(精英/胜利/升级)是 6 个振荡器层
  var NZ_PER_VOICE = 4;               // 4 槽: 怪潮 = 主体亚音 + 群体噪声 + 汁液 + 油锅
  var SEND_MAX = 0.55;                // 混响送出上限
  var MUTE_KEY = 'veggie_survivor_v2_sfx', MUTE_KEY_OLD = 'potato_survivor_v2_sfx';
  var MUTE_MUSIC_KEY = 'veggie_survivor_v2_bgm', MUTE_MUSIC_KEY_OLD = 'potato_survivor_v2_bgm';

  /* 类别: 0=UI 1=STING(叙事) 2=PLAYER 3=MASS; ≤1 不占计费窗口(但仍占声部池) */
  var CLASS = {
    click: 0, buy: 0, sell: 0, fuse: 0, reroll: 0,
    levelup: 1, win: 1, lose: 1, boss: 1, wave: 1, horde: 1,
    shoot: 2, shoot2: 2, melee: 2, hurt: 2, dodge: 2, crit: 2, pickup: 2,
    hit: 3, kill: 3
  };
  /* 同名门限(s): 密集战斗下防止同一种音效叠成噪音墙 */
  var GATE = {
    hit: 0.055, kill: 0.070, shoot: 0.075, shoot2: 0.075, melee: 0.070,
    crit: 0.060, pickup: 0.050, hurt: 0.120, dodge: 0.100, click: 0.030,
    buy: 0.080, sell: 0.080, reroll: 0.090, fuse: 0.120, levelup: 0.250,
    wave: 0.400, horde: 0.400, boss: 0.500, win: 0.500, lose: 0.500
  };

  /* ================= 1. 工具（能力探测: 缺 API 的上下文一律不抛） ================= */
  function vFn(o, m) { return !!o && typeof o[m] === 'function'; }
  function vSet(p, v, t) { try { if (!p) return; if (vFn(p, 'setValueAtTime')) p.setValueAtTime(v, t); else p.value = v; } catch (e) {} }
  function vExp(p, v, t) { try { if (!p) return; var x = v > 0.00002 ? v : 0.00002; if (vFn(p, 'exponentialRampToValueAtTime')) p.exponentialRampToValueAtTime(x, t); else p.value = x; } catch (e) {} }
  function vLin(p, v, t) { try { if (!p) return; if (vFn(p, 'linearRampToValueAtTime')) p.linearRampToValueAtTime(v, t); else p.value = v; } catch (e) {} }
  function vCan(p, t) { try { if (vFn(p, 'cancelScheduledValues')) p.cancelScheduledValues(t); } catch (e) {} }
  function vStop(n) { try { if (n && vFn(n, 'stop')) n.stop(0); } catch (e) {} }
  function vDisc(n) { try { if (n && vFn(n, 'disconnect')) n.disconnect(); } catch (e) {} }
  function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function cts(v, c) { return v * Math.pow(2, c / 1200); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ---------- 静音开关(存储读不到/写不进也不能抛) ---------- */
  function readMute(key, oldKey) {
    try {
      if (typeof wx !== 'undefined' && wx.getStorageSync) {
        var a = wx.getStorageSync(key);
        if (a === '' || a === undefined || a === null) a = wx.getStorageSync(oldKey);
        return muteVal(a);
      }
      if (typeof localStorage !== 'undefined' && localStorage) {
        var b = localStorage.getItem(key);
        if (b === null) b = localStorage.getItem(oldKey);
        return muteVal(b);
      }
    } catch (e) {}
    return false;
  }
  function muteVal(v) {
    if (v === 0 || v === '0' || v === false || v === 'false' || v === 'off' || v === 'mute') return true;
    if (typeof v === 'string') { var s = v.charAt(0); if (s === '0') return true; }
    return false;
  }
  function writeMute(key, off) {
    try {
      if (typeof wx !== 'undefined' && wx.setStorageSync) { wx.setStorageSync(key, off ? '0' : '1'); return; }
      if (typeof localStorage !== 'undefined' && localStorage) localStorage.setItem(key, off ? '0' : '1');
    } catch (e) {}
  }
  /* ================= 2. 材料库 =================
   * 每层 = 声源 + 音高/滤波扫频 + ADSR(ms, sus 为 sustain 相对峰值)。
   * f1mul = 主体默认下滑比(材料"性格"), fr = 滤波扫频比; 配方只给 f 也能得到一致的音色走向。
   */
  var MAT = {
    tr:     { s: 'nz', atk: 1, dur: 14, vol: 0.30, rate: 1.0, flt: { t: 'highpass', q: 0.8, f: 6000, f1: 2600 } },
    trHi:   { s: 'nz', atk: 0.6, dur: 9, vol: 0.26, rate: 1.1, flt: { t: 'highpass', q: 0.8, f: 8200, f1: 4200 } },
    metal:  { s: 'osc', w: 'square', vol: 0.16, a: 3, d: 70, sus: 0, r: 34, ct: 0, f1mul: 0.36, flt: { t: 'bandpass', q: 1.1, f: 3600, f1: 1400 } },
    wood:   { s: 'osc', w: 'triangle', vol: 0.16, a: 2, d: 64, sus: 0, r: 30, ct: 0, f1mul: 0.86, flt: { t: 'bandpass', q: 2.0, f: 1500, f1: 900 } },
    juice:  { s: 'osc', w: 'triangle', vol: 0.18, a: 3, d: 110, sus: 0, r: 40, ct: 0, f1mul: 0.30, flt: { t: 'lowpass', q: 1.2, f: 1400, f1: 420 } },
    juiceN: { s: 'nz', atk: 2, dur: 130, vol: 0.24, rate: 0.9, flt: { t: 'lowpass', q: 1.5, f: 1400, f1: 380 } },
    sub:    { s: 'osc', w: 'sine', vol: 0.30, a: 2, d: 90, sus: 0, r: 30, ct: 0, f1mul: 0.62 },
    glass:  { s: 'osc', w: 'sine', vol: 0.14, a: 2, d: 190, sus: 0.04, r: 150, ct: 1, f1mul: 1.6, flt: { t: 'highpass', q: 0.7, f: 1500, f1: 2600 } },
    bell:   { s: 'osc', w: 'triangle', vol: 0.14, a: 2, d: 260, sus: 0.05, r: 260, ct: 3, f1mul: 1.0, flt: { t: 'lowpass', q: 0.6, f: 6000, f1: 4200 } },
    air:    { s: 'nz', atk: 8, dur: 130, vol: 0.30, rate: 1.0, flt: { t: 'bandpass', q: 1.2, f: 900, f1: 4200 } },
    fry:    { s: 'nz', atk: 2, dur: 70, vol: 0.10, rate: 1.2, flt: { t: 'highpass', q: 0.8, f: 5000, f1: 7200 } },
    impact: { s: 'osc', w: 'sine', vol: 0.30, a: 3, d: 200, sus: 0, r: 60, ct: 0, f1mul: 0.35 },
    crash:  { s: 'nz', atk: 1, dur: 520, vol: 0.16, rate: 1.0, flt: { t: 'highpass', q: 0.7, f: 4000, f1: 6200 } }
  };

  /* 配方装载期展开: 材料默认值 + 配方覆盖 → 扁平层数组(运行时零分配, 只读) */
  function build(layers) {
    var out = [], i, k, o, L, M, fm, fl, f, fr;
    for (i = 0; i < layers.length; i++) {
      L = layers[i]; M = L.mat ? MAT[L.mat] : null; o = {};
      if (M) for (k in M) o[k] = M[k];
      for (k in L) if (k !== 'mat' && k !== 'flt') o[k] = L[k];
      fm = M && M.flt ? M.flt : null; fl = L.flt || null;
      if (fm || fl) {
        f = (fl && fl.f !== undefined) ? fl.f : (fm ? fm.f : 1200);
        fr = (fl && fl.f1 !== undefined) ? (fl.f1 / f) : ((fm && fm.f1) ? fm.f1 / fm.f : 1);
        o.flt = {
          t: (fl && fl.t) || (fm && fm.t) || 'lowpass',
          q: (fl && fl.q !== undefined) ? fl.q : (fm ? fm.q : 0.9),
          f: f, fr: fr, dur: (fl && fl.dur) || o.dur || 100
        };
      }
      if (o.s === 'osc' && o.f !== undefined && o.f1 === undefined) o.f1 = o.f * (o.f1mul === undefined ? 1 : o.f1mul);
      out.push(o);
    }
    return out;
  }
  function rc(g, send, pan, layers) { return { g: g, send: send, pan: pan, layers: build(layers) }; }

  /* ================= 3. 20 条配方（键名与调用签名与 v3 完全一致） =================
   * 瞬态(tr) + 主体(2 振荡器失谐) + 尾韵(噪声/钟形泛音) 三层结构; 材料统一音色族。
   */
  var RAW = {
    /* ---- 射击 ---- */
    shoot: rc(0.85, 0.16, 0.00, [
      { mat: 'tr', vol: 0.30 },
      { mat: 'metal', f: 1180, dur: 78, vol: 0.20 },
      { mat: 'metal', f: 2360, ct: 7, dur: 60, vol: 0.07 },
      { mat: 'sub', f: 180, dur: 60, vol: 0.16 }
    ]),
    shoot2: rc(0.90, 0.20, 0.02, [
      { mat: 'tr', vol: 0.22 },
      { mat: 'wood', f: 620, dur: 95, vol: 0.22 },
      { mat: 'sub', f: 155, dur: 80, vol: 0.18 },
      { mat: 'metal', f: 1240, ct: -9, dur: 70, vol: 0.06 },
      { mat: 'juiceN', dur: 70, vol: 0.16, flt: { f: 1800, f1: 600 } }
    ]),
    /* ---- 近战/命中/暴击 ---- */
    melee: rc(0.95, 0.22, -0.06, [
      { mat: 'tr', vol: 0.24 },
      { mat: 'air', dur: 130, vol: 0.34, flt: { f: 900, f1: 4200 } },
      { mat: 'wood', f: 320, dur: 70, vol: 0.10 },
      { mat: 'fry', dur: 60, vol: 0.06, at: 40 }
    ]),
    hit: rc(0.80, 0.10, 0.00, [
      { mat: 'tr', vol: 0.34 },
      { mat: 'wood', f: 1900, dur: 55, vol: 0.14 },
      { mat: 'sub', f: 190, dur: 42, vol: 0.14 }
    ]),
    crit: rc(1.00, 0.26, 0.04, [
      { mat: 'trHi', vol: 0.32 },
      { mat: 'metal', f: 1560, dur: 90, vol: 0.20 },
      { mat: 'metal', f: 1568, dur: 90, vol: 0.20 },      /* 8Hz 拍频 */
      { mat: 'sub', f: 110, dur: 90, vol: 0.26 },
      { mat: 'glass', f: 3120, dur: 110, vol: 0.06 }
    ]),
    kill: rc(0.95, 0.18, 0.05, [
      { mat: 'tr', vol: 0.26 },
      { mat: 'juiceN', dur: 130, vol: 0.30, flt: { f: 1400, f1: 380 } },
      { mat: 'juice', f: 300, dur: 95, vol: 0.16 },
      { mat: 'fry', dur: 60, vol: 0.09, at: 60 },
      { mat: 'sub', f: 150, dur: 70, vol: 0.10 }
    ]),
    /* ---- 拾取/受伤/闪避 ---- */
    pickup: rc(1.00, 0.30, -0.10, [
      { mat: 'trHi', vol: 0.20 },
      { mat: 'glass', f: 1050, f1: 1680, dur: 55, vol: 0.16 },
      { mat: 'metal', f: 2100, dur: 50, vol: 0.07 },
      { mat: 'bell', f: 2100, dur: 90, vol: 0.06, at: 20 }
    ]),
    hurt: rc(1.00, 0.10, -0.04, [
      { mat: 'tr', vol: 0.26 },
      { mat: 'metal', w: 'sawtooth', f: 210, dur: 180, vol: 0.26, flt: { t: 'lowpass', f: 2200, f1: 500 } },
      { mat: 'sub', f: 90, dur: 150, vol: 0.30 },
      { mat: 'juiceN', dur: 120, vol: 0.20, flt: { f: 900, f1: 260 } }
    ]),
    dodge: rc(0.95, 0.24, 0.10, [
      { mat: 'tr', vol: 0.16 },
      { mat: 'air', dur: 70, vol: 0.30, flt: { f: 700, f1: 3600 } },
      { mat: 'glass', f: 720, f1: 1320, dur: 70, vol: 0.12 }
    ]),
    /* ---- 升级(四音上行 + 闪光尾) ---- */
    levelup: rc(1.00, 0.42, 0.00, [
      { mat: 'impact', f: 130, dur: 90, vol: 0.12 },
      { mat: 'bell', f: hz(72), dur: 300, vol: 0.16 },
      { mat: 'bell', f: hz(76), dur: 300, vol: 0.16, at: 62 },
      { mat: 'bell', f: hz(79), dur: 320, vol: 0.16, at: 124 },
      { mat: 'bell', f: hz(84), dur: 420, vol: 0.18, at: 186 },
      { mat: 'glass', f: hz(84) * 2, f1: hz(84) * 2.2, dur: 300, vol: 0.06, at: 186 },
      { mat: 'trHi', dur: 260, vol: 0.10, at: 196, flt: { f: 9000, f1: 12000 } }
    ]),    /* ---- 商店类(金属/木质: 硬币与操作反馈) ---- */
    buy: rc(1.00, 0.34, 0.10, [
      { mat: 'tr', vol: 0.18 },
      { mat: 'metal', f: 880, dur: 120, vol: 0.16 },
      { mat: 'metal', f: 1320, dur: 140, vol: 0.16, at: 55 },
      { mat: 'bell', f: 1760, dur: 160, vol: 0.08, at: 55 },
      { mat: 'glass', f: 2640, dur: 120, vol: 0.05, at: 60 }
    ]),
    sell: rc(1.00, 0.30, -0.12, [
      { mat: 'tr', vol: 0.16 },
      { mat: 'metal', f: 1046, dur: 110, vol: 0.15 },
      { mat: 'metal', f: 698, dur: 150, vol: 0.15, at: 60 },
      { mat: 'wood', f: 1400, dur: 60, vol: 0.10, at: 30 },
      { mat: 'sub', f: 160, dur: 80, vol: 0.08 }
    ]),
    fuse: rc(1.00, 0.38, 0.00, [
      { mat: 'tr', vol: 0.16 },
      { mat: 'juice', w: 'sawtooth', f: 180, f1: 520, dur: 280, vol: 0.20, flt: { t: 'bandpass', f: 900, f1: 3600 } },
      { mat: 'metal', f: 2600, f1: 3900, dur: 200, vol: 0.10, at: 120 },
      { mat: 'glass', f: 1560, f1: 2340, dur: 220, vol: 0.10, at: 200 },
      { mat: 'fry', dur: 220, vol: 0.08, at: 180 },
      { mat: 'sub', f: 140, dur: 120, vol: 0.12 }
    ]),
    reroll: rc(0.95, 0.26, -0.08, [
      { mat: 'trHi', vol: 0.16 },
      { mat: 'wood', f: 1700, dur: 40, vol: 0.14 },
      { mat: 'wood', f: 1900, dur: 40, vol: 0.13, at: 45 },
      { mat: 'wood', f: 2100, dur: 40, vol: 0.12, at: 90 },
      { mat: 'air', dur: 140, vol: 0.16, at: 60, flt: { f: 2000, f1: 5200 } }
    ]),
    /* ---- 波次 / 怪潮 / 精英 / 胜负 ---- */
    wave: rc(1.00, 0.34, 0.00, [
      { mat: 'tr', vol: 0.20 },
      { mat: 'impact', f: 150, dur: 220, vol: 0.30 },
      { mat: 'impact', f: 120, dur: 200, vol: 0.26, at: 140 },
      { mat: 'metal', f: 392, dur: 260, vol: 0.12, at: 150 },
      { mat: 'glass', f: 784, dur: 300, vol: 0.07, at: 150 },
      { mat: 'sub', f: 98, dur: 200, vol: 0.16 }
    ]),
    horde: rc(1.00, 0.32, 0.00, [
      { mat: 'tr', vol: 0.22 },
      { mat: 'sub', f: 120, f1: 38, dur: 700, vol: 0.34 },
      { mat: 'impact', f: 90, f1: 44, dur: 640, vol: 0.24, at: 20 },
      { mat: 'air', dur: 520, vol: 0.26, flt: { f: 400, f1: 2400 } },
      { mat: 'juiceN', dur: 400, vol: 0.22, at: 80, flt: { f: 900, f1: 300 } },
      { mat: 'metal', f: 180, ct: 12, dur: 600, vol: 0.08, at: 160 },
      { mat: 'fry', dur: 300, vol: 0.07, at: 300 }
    ]),
    boss: rc(1.00, 0.36, 0.00, [
      { mat: 'tr', vol: 0.24 },
      { mat: 'sub', f: 90, f1: 32, dur: 800, vol: 0.34 },
      { mat: 'metal', w: 'sawtooth', f: 110, ct: -14, dur: 700, vol: 0.14, flt: { t: 'lowpass', f: 1400, f1: 700 } },
      { mat: 'metal', w: 'sawtooth', f: 110, ct: 16, dur: 700, vol: 0.14, flt: { t: 'lowpass', f: 1500, f1: 780 } },
      { mat: 'metal', w: 'sawtooth', f: 165, dur: 650, vol: 0.10, flt: { t: 'lowpass', f: 1800, f1: 900 } },
      { mat: 'crash', dur: 500, vol: 0.20 },
      { mat: 'impact', f: 200, f1: 80, dur: 300, vol: 0.18, at: 420 },
      { mat: 'impact', f: 200, f1: 80, dur: 300, vol: 0.16, at: 660 }
    ]),
    win: rc(1.00, 0.45, 0.00, [
      { mat: 'tr', vol: 0.18 },
      { mat: 'bell', f: hz(72), dur: 380, vol: 0.17 },
      { mat: 'bell', f: hz(76), dur: 380, vol: 0.17, at: 90 },
      { mat: 'bell', f: hz(79), dur: 400, vol: 0.17, at: 180 },
      { mat: 'bell', f: hz(84), dur: 620, vol: 0.19, at: 280 },
      { mat: 'glass', f: hz(88), f1: hz(91), dur: 420, vol: 0.08, at: 280 },
      { mat: 'crash', dur: 600, vol: 0.14, at: 280 },
      { mat: 'sub', f: 130, dur: 200, vol: 0.14 }
    ]),
    lose: rc(1.00, 0.34, 0.00, [
      { mat: 'tr', vol: 0.16 },
      { mat: 'juice', w: 'sawtooth', f: hz(69), f1: hz(69) * 0.94, dur: 260, vol: 0.18, flt: { t: 'lowpass', f: 1600, f1: 700 } },
      { mat: 'juice', w: 'sawtooth', f: hz(65), f1: hz(65) * 0.94, dur: 280, vol: 0.18, at: 180, flt: { t: 'lowpass', f: 1400, f1: 620 } },
      { mat: 'juice', w: 'sawtooth', f: hz(60), f1: hz(60) * 0.92, dur: 420, vol: 0.19, at: 380, flt: { t: 'lowpass', f: 1200, f1: 520 } },
      { mat: 'sub', f: 80, f1: 40, dur: 700, vol: 0.24, at: 380 },
      { mat: 'juiceN', dur: 300, vol: 0.14, at: 700, flt: { f: 700, f1: 260 } }
    ]),
    /* ---- UI ---- */
    click: rc(0.90, 0.10, 0.14, [
      { mat: 'trHi', vol: 0.14 },
      { mat: 'wood', f: 1150, dur: 40, vol: 0.13 },
      { mat: 'metal', f: 2300, dur: 36, vol: 0.05 },
      { mat: 'bell', f: 2300, dur: 60, vol: 0.03 }
    ])
  };

  /* ================= 4. 引擎 =================
   * 音频图: 声部池 → (L/R 等功率声像 + 混响送出) → 总线 → 混响房间 / 直通
   *         → master(0.5) → 压缩限幅 → 软削波 → destination
   */
  var E = null;                       /* 单例(install 时创建) */

  function makeEngine() {
    var self = {
      version: VERSION, ctx: null, master: null, limiter: null, clip: null,
      enabled: true, _ok: false, onEvent: null,
      MAX_VOICES: MAX_VOICES, WINDOW: WINDOW, POOL_SIZE: POOL_SIZE, PAN: PAN,
      CLASS: CLASS, GATE: GATE,
      _vlog: {}, _winT: -1, _winN: 0, _dropped: 0, _exempt: 0, _dens: 0, _densT: 0,
      _v: [], _cur: 0, _nz: null, _nodes: [], _spc: null, _spcIn: null,
      _dryL: null, _dryR: null, _built: false
    };
    return self;
  }
  /* ---------------- 4.1 音频图 / 池 ---------------- */
  var PROTO = {
    version: VERSION, RECIPES: RAW, MAT: MAT,
    /* 上下文 / 图 / 池 / 计数器 —— 字段名与 v3 保持一致(渲染器与门禁会直接读写它们) */
    ctx: null, master: null, limiter: null, clip: null,
    enabled: true, _ok: false, onEvent: null,
    MAX_VOICES: MAX_VOICES, WINDOW: WINDOW, POOL_SIZE: POOL_SIZE, PAN: PAN,
    CLASS: CLASS, GATE: GATE,
    _vlog: {}, _winT: -1, _winN: 0, _dropped: 0, _exempt: 0, _dens: 0, _densT: 0,
    _v: [], _cur: 0, _nz: null, _nodes: [], _spc: null, _spcIn: null, _dryL: null, _dryR: null,

    _now: function () { var c = this.ctx; return (c && c.currentTime) ? c.currentTime : 0; },
    _mk: function (n) { try { this._nodes.push(n); } catch (e) {} return n; },

    /* 初始化: ctx 缺失/构造失败 → _ok=false(全部 no-op), 绝不抛 */
    init: function (audioCtx) {
      if (this._ok) return;
      try {
        var c = audioCtx || null;
        if (!c && typeof AudioContext !== 'undefined') c = new AudioContext();
        if (!c || !vFn(c, 'createGain')) { this._ok = false; return; }
        this._teardown();
        this.ctx = c;
        this._nodes = [];
        /* master(0.5) → 压缩限幅 → 软削波 → destination */
        this.master = this._mk(c.createGain());
        this.master.gain.value = 0.5;
        var chain = this.master;
        if (vFn(c, 'createDynamicsCompressor')) {
          try {
            this.limiter = c.createDynamicsCompressor();
            this.limiter.threshold.value = -6; this.limiter.knee.value = 3; this.limiter.ratio.value = 12;
            this.limiter.attack.value = 0.003; this.limiter.release.value = 0.1;
            chain.connect(this.limiter); chain = this.limiter;
          } catch (e0) { this.limiter = null; }
        }
        if (vFn(c, 'createWaveShaper')) {
          try {
            this.clip = c.createWaveShaper();
            this.clip.curve = softCurve(0.87, 0.70);
            try { this.clip.oversample = '4x'; } catch (e1) {}
            chain.connect(this.clip); chain = this.clip;
          } catch (e2) { this.clip = null; }
        }
        try { chain.connect(c.destination); } catch (e3) {}
        /* 干声左右总线(L/R 由声部的等功率声像分配) */
        this._dryL = this._mk(c.createGain()); this._dryR = this._mk(c.createGain());
        this._dryL.gain.value = 1; this._dryR.gain.value = 1;
        this._dryL.connect(this.master); this._dryR.connect(this.master);
        /* 空间感: 共享的立体声反馈延迟"小房间"(无卷积器依赖) —— 缺 createDelay 时降级为无障碍直通 */
        this._spcIn = this._mk(c.createGain()); this._spcIn.gain.value = 1;
        this._spc = null;
        if (vFn(c, 'createDelay') && vFn(c, 'createBiquadFilter')) {
          try {
            var room = [];
            var spec = [[0.036, 2900, 0.34, 0.55], [0.047, 2300, 0.31, 0.50]];
            for (var ri = 0; ri < spec.length; ri++) {
              var d = this._mk(c.createDelay(0.5)), lp = this._mk(c.createBiquadFilter()), fb = this._mk(c.createGain()), rt = this._mk(c.createGain());
              d.delayTime.value = spec[ri][0];
              try { lp.type = 'lowpass'; } catch (e4) {}
              lp.frequency.value = spec[ri][1];
              try { if (lp.Q) lp.Q.value = 0.6; } catch (e5) {}
              fb.gain.value = spec[ri][2];
              rt.gain.value = spec[ri][3];
              this._spcIn.connect(d);
              d.connect(lp); lp.connect(fb); fb.connect(d);          // 反馈回路(阻尼后回灌)
              lp.connect(rt); rt.connect(this.master);                 // 混响返回
              room.push(d);
            }
            this._spc = room;
          } catch (e6) { this._spc = null; }
        }
        if (!this._spc) { this._spcIn.connect(this.master); }            // 降级: 送出直通(仍有电平贡献)
        this._nz = makeNoise(c);
        this._buildPool(c);
        this._vlog = {}; this._winT = -1; this._winN = 0; this._dropped = 0; this._exempt = 0;
        this._dens = 0; this._densT = 0;
        this._ok = true;
      } catch (e) { this._ok = false; }
    },

    /* 拆掉我们建的图(反复 init / 离线渲染必须; 源节点 stop, 其余 disconnect) */
    _teardown: function () {
      var i, n;
      try { for (i = 0; i < this._nodes.length; i++) { n = this._nodes[i]; vStop(n); vDisc(n); } } catch (e) {}
      this._nodes = []; this._v = []; this._cur = 0;
      this.master = null; this.limiter = null; this.clip = null;
      this._dryL = null; this._dryR = null; this._spcIn = null; this._spc = null;
      this._nz = null; this.ctx = null;
    },

    /* 池: 每声部 = 6 振荡器槽(各自包络 + 各自滤波) + 4 噪声槽(懒创建) + 等功率声像 + 混响送出 */
    _buildPool: function (c) {
      var i, j;
      for (i = 0; i < POOL_SIZE; i++) {
        var out = this._mk(c.createGain()), pl = this._mk(c.createGain()), pr = this._mk(c.createGain()), snd = this._mk(c.createGain());
        out.gain.value = 1;
        pl.gain.value = 0.707; pr.gain.value = 0.707; snd.gain.value = 0;
        out.connect(pl); out.connect(pr); out.connect(snd);
        pl.connect(this._dryL); pr.connect(this._dryR); snd.connect(this._spcIn);
        var osc = [];
        for (j = 0; j < OSC_PER_VOICE; j++) {
          var o = this._mk(c.createOscillator()), g = this._mk(c.createGain()), f = this._mk(c.createBiquadFilter());
          try { o.type = 'sine'; } catch (e0) {}
          o.frequency.value = 440; g.gain.value = 0.0001;
          try { f.type = 'lowpass'; } catch (e1) {}
          f.frequency.value = 4000;
          try { if (f.Q) f.Q.value = 0.8; } catch (e2) {}
          o.connect(g); g.connect(f); f.connect(out);
          try { o.start(0); } catch (e3) {}
          osc.push({ o: o, g: g, f: f });
        }
        var nz = [];
        for (j = 0; j < NZ_PER_VOICE; j++) nz.push({ b: null, f: null, g: null });
        this._v.push({ out: out, pl: pl, pr: pr, snd: snd, osc: osc, nz: nz, freeAt: 0 });
      }
      return this._v.length;
    },

    /* 噪声槽懒创建: 一个声部一生只建一次(噪声 buffer 全池共用, 逐发换 playbackRate) */
    _nzSlot: function (v, i) {
      var slot = v.nz[i];
      if (!slot || slot.b || !this._nz || !this.ctx) return (slot && slot.b) ? slot : null;
      try {
        var c = this.ctx, s = this._mk(c.createBufferSource()), f = this._mk(c.createBiquadFilter()), g = this._mk(c.createGain());
        s.buffer = this._nz; s.loop = true;
        try { f.type = 'highpass'; } catch (e0) {}
        f.frequency.value = 2400;
        try { if (f.Q) f.Q.value = 0.9; } catch (e1) {}
        g.gain.value = 0.0001;
        s.connect(f); f.connect(g); g.connect(v.out);
        try { s.start(0); } catch (e2) {}
        slot.b = s; slot.f = f; slot.g = g;
      } catch (e) { slot.b = null; }
      return slot.b ? slot : null;
    },

    /* 声部取用: 池内复用(运行时零分配); force(关键音效)才允许抢占最旧声部, 4ms 淡出不爆音 */
    _pick: function (t, force) {
      var n = this._v.length, i, v, oldest = null;
      for (i = 0; i < n; i++) {
        v = this._v[(this._cur + i) % n];
        if (v.freeAt <= t) { this._cur = (this._cur + i + 1) % n; return v; }
        if (!oldest || v.freeAt < oldest.freeAt) oldest = v;
      }
      if (!force || !oldest) return null;
      this._cutVoice(oldest, t);
      return oldest;
    },
    _cutVoice: function (v, t) {
      var i, s, j;
      try {
        for (i = 0; i < v.osc.length; i++) {
          s = v.osc[i];
          vSet(s.g.gain, Math.max(0.0001, s.g.gain.value === undefined ? 0.0001 : s.g.gain.value), t);
          vLin(s.g.gain, 0.0001, t + 0.004);
        }
        for (j = 0; j < v.nz.length; j++) {
          s = v.nz[j];
          if (s && s.g) { vSet(s.g.gain, Math.max(0.0001, s.g.gain.value === undefined ? 0.0001 : s.g.gain.value), t); vLin(s.g.gain, 0.0001, t + 0.004); }
        }
      } catch (e) {}
      v.freeAt = t;
    },
    /* 每发一次的声像 + 混响送出(等功率 + 4ms 斜坡) */
    _prep: function (v, pan, send, t) {
      var a = (clamp(pan, -1, 1) + 1) * Math.PI / 4;
      vSet(v.pl.gain, Math.max(0.0001, Math.cos(a)), t);
      vSet(v.pr.gain, Math.max(0.0001, Math.sin(a)), t);
      vSet(v.snd.gain, Math.max(0.0001, clamp(send, 0, SEND_MAX)), t);
    },

    resume: function () { if (this.ctx && this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) {} } },
    toggle: function () {
      this.enabled = !this.enabled;
      if (!this.enabled) this._stopAll();
      writeMute(MUTE_KEY, !this.enabled);
      return this.enabled;
    },
    _stopAll: function () {
      var t = this._now() + 0.004, i, v;
      for (i = 0; i < this._v.length; i++) {
        v = this._v[i];
        try {
          vLin(v.pl.gain, 0.0001, t + 0.03); vLin(v.pr.gain, 0.0001, t + 0.03); vLin(v.snd.gain, 0.0001, t + 0.03);
          this._cutVoice(v, t);
        } catch (e) {}
      }
    },    /* ---------------- 4.2 播放入口(门限 / 预算 / 密度压制) ---------------- */
    play: function (name) {
      if (!this._ok || !this.enabled) return;
      var now = this._now(), cls = CLASS[name];
      if (cls === undefined) cls = 2;
      var gate = GATE[name];
      if (gate !== undefined) {
        var last = this._vlog[name];
        if (last !== undefined && now - last < gate) { this._dropped++; return; }
        this._vlog[name] = now;
      }
      this._dens = Math.min(1, this._densNow() + 0.22); this._densT = now;
      if (cls > 1) {                                        /* UI/叙事音不占计费窗口(但仍占声部池) */
        if (now - this._winT >= WINDOW) { this._winT = now; this._winN = 0; }
        if (this._winN >= MAX_VOICES) { this._dropped++; return; }
        this._winN++;
      } else this._exempt++;
      this._playRaw(name);
    },

    /* 具名配方直发(绕开门限与窗口预算) —— 升级/Boss/胜负等关键音效必响; 也允许抢占最旧声部 */
    _playRaw: function (name, force) {
      if (!this._ok || !this.enabled) return false;
      var R = RAW[name];
      if (!R) return false;
      var n = this._winN, scale = Math.max(0.45, 1 / (1 + 0.35 * n)) * R.g;
      this._render(R, scale, this._now() + 0.006, force === undefined ? true : force);
      if (this.onEvent) { try { this.onEvent(name); } catch (e) {} }
      return true;
    },

    /* 密度(0..1, 时间常数 0.30s): 音乐侧链读它 —— 音效越密, 音乐越让位 */
    _densNow: function () {
      var now = this._now(), dt = now - this._densT;
      if (dt > 0) { this._dens *= Math.exp(-dt / 0.30); this._densT = now; }
      return this._dens;
    },
    densityNow: function () { return this._densNow(); },
    stats: function () {
      return {
        voices: this._winN, exempt: this._exempt, dropped: this._dropped,
        window: WINDOW, density: this._densNow(), active: this._active(), pool: this._v.length
      };
    },
    _active: function () {
      var now = this._now(), n = 0, i;
      for (i = 0; i < this._v.length; i++) if (this._v[i].freeAt > now) n++;
      return n;
    },

    /* 一次发声: 取声部 → 声像/送出 → 逐层(振荡器/噪声)排包络与扫频 —— 全程零节点创建 */
    _render: function (R, scale, t, force) {
      var v = this._pick(t, force);
      if (!v) { this._dropped++; return false; }
      var jit = 0.90 + Math.random() * 0.22;                       /* 每发音量 ±1dB */
      var pj = 1 + (Math.random() * 2 - 1) * 0.015;                /* 每发音高 ±1.5% */
      var dens = this._densNow();
      var pan = clamp((R.pan || 0) + (Math.random() * 2 - 1) * PAN * 0.35, -1, 1);
      var send = clamp((R.send || 0) * (1 - 0.55 * dens), 0, SEND_MAX);
      var sc = scale * jit, i, L, e, end = t, oi = 0, ni = 0;
      this._prep(v, pan, send, t);
      v.freeAt = t;
      for (i = 0; i < R.layers.length; i++) {
        L = R.layers[i];
        var at = t + (L.at || 0) / 1000;
        if (L.s === 'nz') {
          if (ni >= NZ_PER_VOICE) { this._dropped++; continue; }     /* 槽位用尽: 丢这一层, 不丢整个音效 */
          e = this._nzHit(v, ni++, L, at, sc, pj);
        } else {
          if (oi >= OSC_PER_VOICE) { this._dropped++; continue; }
          e = this._oscHit(v, oi++, L, at, sc, pj);
        }
        if (e > end) end = e;
      }
      if (end > v.freeAt) v.freeAt = end;                            /* 声部占用到最后一层尾巴 */
      return true;
    },

    /* 振荡器层: 音高(带音分失谐/滑音) + 独立滤波扫频 + ADSR(释放到尾端线性归零, 闲置真静音) */
    _oscHit: function (v, i, L, t, sc, pj) {
      var s = v.osc[i];
      if (!s || !s.o || !s.g) return t;
      var a = (L.a === undefined ? 3 : L.a) / 1000, d = (L.d === undefined ? 60 : L.d) / 1000;
      var sus = L.sus === undefined ? 0 : L.sus, r = (L.r === undefined ? 25 : L.r) / 1000;
      var dur = (L.dur === undefined ? 80 : L.dur) / 1000, end = t + dur + r;
      var vol = Math.max(0, (L.vol === undefined ? 0.16 : L.vol) * sc);
      var f0 = Math.max(20, (L.f === undefined ? 440 : L.f) * pj * (L.ct ? Math.pow(2, L.ct / 1200) : 1));
      var f1 = Math.max(20, (L.f1 === undefined ? f0 : L.f1 * pj));
      if (L.w) { try { s.o.type = L.w; } catch (e0) {} }
      vSet(s.o.frequency, f0, t);
      if (Math.abs(f1 - f0) > 0.5) vExp(s.o.frequency, f1, t + dur);
      if (L.flt && s.f) {
        try { s.f.type = L.flt.t || 'lowpass'; } catch (e1) {}
        try { if (s.f.Q) s.f.Q.value = L.flt.q === undefined ? 0.9 : L.flt.q; } catch (e2) {}
        var ff = L.flt.f, fw = L.flt.fr === undefined ? 1 : L.flt.fr;
        var fe = ff * fw, fd = (L.flt.dur || L.dur || 100) / 1000;
        vSet(s.f.frequency, Math.max(30, ff), t);
        if (Math.abs(fe - ff) > 1) vExp(s.f.frequency, Math.max(30, fe), t + fd);
      }
      var g = s.g.gain;
      vCan(g, t); vSet(g, 0.0001, t);
      vExp(g, vol, t + a);
      if (sus > 0) {
        vExp(g, Math.max(0.0002, vol * sus), t + a + d);
        if (dur - r > a + d) vSet(g, Math.max(0.0002, vol * sus), t + dur - r);
      }
      vExp(g, 0.0001, end);
      vLin(g, 0, end + 0.004);
      return end + 0.01;
    },

    /* 噪声层: 循环噪声 + 逐发随机播放速率(噪声颜色不重复) + 滤波扫频 + 包络(可慢起音=风/沙锤) */
    _nzHit: function (v, i, L, t, sc, pj) {
      var slot = this._nzSlot(v, i);
      if (!slot) return t;
      var dur = (L.dur === undefined ? 60 : L.dur) / 1000, atk = (L.atk === undefined ? 1 : L.atk) / 1000;
      var vol = Math.max(0, (L.vol === undefined ? 0.2 : L.vol) * sc), fl = L.flt;
      if (fl) {
        try { slot.f.type = fl.t || 'highpass'; } catch (e0) {}
        try { if (slot.f.Q) slot.f.Q.value = fl.q === undefined ? 0.9 : fl.q; } catch (e1) {}
        var ff = fl.f || 2000, fe = ff * (fl.fr === undefined ? 1 : fl.fr), fd = (fl.dur || L.dur || 100) / 1000;
        vSet(slot.f.frequency, Math.max(30, ff), t);
        if (Math.abs(fe - ff) > 1) vExp(slot.f.frequency, Math.max(30, fe), t + fd);
      }
      if (slot.b && slot.b.playbackRate) vSet(slot.b.playbackRate, (L.rate === undefined ? 1 : L.rate) * (0.9 + Math.random() * 0.2), t);
      var g = slot.g.gain;
      vCan(g, t); vSet(g, 0.0001, t);
      if (atk <= 0.002) vExp(g, vol, t + atk); else vLin(g, vol, t + atk);
      vExp(g, 0.0001, t + dur);
      vLin(g, 0, t + dur + 0.004);
      return t + dur + 0.01;
    },

    /* ---------------- 4.3 兼容 API(v3 的 tone/noise/arp 仍然可用) ---------------- */
    tone: function (cfg) {
      if (!this._ok || !this.enabled) return;
      cfg = cfg || {};
      this._render({ g: 1, send: 0.15, pan: 0, layers: build([
        { mat: 'metal', w: cfg.type || 'square', f: cfg.f0 || 440, f1: cfg.f1 || cfg.f0 || 440,
          vol: cfg.vol || 0.18, dur: (cfg.dur || 0.1) * 1000, flt: { t: 'lowpass', q: 0.8, f: 6000, f1: 3000 } }
      ]) }, 1, this._now() + 0.006, false);
    },
    noise: function (cfg) {
      if (!this._ok || !this.enabled) return;
      cfg = cfg || {};
      var dur = (cfg.dur || 0.15) * 1000;
      this._render({ g: 1, send: 0.15, pan: 0, layers: build([
        { mat: 'air', atk: 1, dur: dur, vol: cfg.vol || 0.2, flt: { t: cfg.filter || 'lowpass', q: 0.9, f: cfg.freq || 1200, f1: (cfg.freq || 1200) * 0.6, dur: dur } }
      ]) }, 1, this._now() + 0.006, false);
    },
    arp: function (freqs, cfg) {
      if (!this._ok || !this.enabled || !freqs || !freqs.length) return;
      cfg = cfg || {};
      var gap = (cfg.gap || 70) / 1000, t0 = this._now() + 0.006, i;
      var layers = [];
      for (i = 0; i < freqs.length; i++) {
        layers.push({
          mat: 'bell', f: freqs[i], vol: cfg.vol || 0.15, dur: (cfg.dur || 0.12) * 1000,
          w: cfg.type || 'triangle', at: i * gap * 1000
        });
      }
      this._render({ g: 1, send: 0.25, pan: 0, layers: build(layers) }, 1, t0, false);
    }
  };
  /* ================= 5. 共享工具 ================= */
  function makeNoise(c) {
    try {
      if (!vFn(c, 'createBuffer')) return null;
      var sr = c.sampleRate || 44100, len = Math.max(1, (1.0 * sr) | 0), b = c.createBuffer(1, len, sr);
      var d = b.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;    /* 白噪声: 逐发靠滤波/速率塑形 */
      return b;
    } catch (e) { return null; }
  }
  /* 软削波曲线: |x| ≤ T 段透明, 之上 tanh 压向天花板 C —— 输出恒 < C(峰值是数学保证) */
  function softCurve(C, T) {
    var n = 2048, cur, i, x, a, y;
    try { cur = new Float32Array(n); } catch (e) { return null; }
    for (i = 0; i < n; i++) {
      x = i / (n - 1) * 2 - 1;
      a = x < 0 ? -x : x;
      y = a <= T ? a : T + (C - T) * Math.tanh((a - T) / (C - T));
      cur[i] = x < 0 ? -y : y;
    }
    return cur;
  }

  /* ================= 6. 接管 PS.Sound =================
   * 两种加载顺序都要成立:
   *   ps.js → audio-veg.js : 直接接管现成对象(先拆掉它已建好的图, 避免两套图同时挂在 destination);
   *   audio-veg.js → ps.js : 用 PS.Sound 的存取器拦截后来的赋值, 同样接管。
   * 接管 = 写入本文件的合成实现, 但**保留对象上的其它字段**, 且公开 API/字段名一个不变。
   */
  function dismantle(S) {
    function kill(n) { vStop(n); vDisc(n); }
    try {
      kill(S.master); kill(S.limiter); kill(S.clip);
      var v = S._v || [], i, j, vo;
      for (i = 0; i < v.length; i++) {
        vo = v[i]; if (!vo) continue;
        kill(vo.out); kill(vo.pan); kill(vo.snd);
        if (vo.osc) for (j = 0; j < vo.osc.length; j++) { kill(vo.osc[j].src); kill(vo.osc[j].o); kill(vo.osc[j].f); kill(vo.osc[j].g); }
        if (vo.noise) for (j = 0; j < vo.noise.length; j++) { kill(vo.noise[j].src); kill(vo.noise[j].f); kill(vo.noise[j].g); }
        if (vo.nz) for (j = 0; j < vo.nz.length; j++) { kill(vo.nz[j].b); kill(vo.nz[j].f); kill(vo.nz[j].g); }
      }
    } catch (e) {}
  }

  function install(S) {
    if (!S || typeof S !== 'object') S = {};
    if (S.__veg) return S;                                  /* 幂等: 已接管 */
    try { if (S._ok && S.master) dismantle(S); } catch (e) {}
    var k;
    for (k in PROTO) S[k] = PROTO[k];                       /* 方法 + 默认字段 */
    S.__veg = VERSION;
    /* 每个实例独立的状态(绝不能与 PROTO 共享引用) */
    S._vlog = {}; S._winT = -1; S._winN = 0; S._dropped = 0; S._exempt = 0; S._dens = 0; S._densT = 0;
    S._v = []; S._cur = 0; S._nodes = []; S._nz = null;
    S.ctx = null; S.master = null; S.limiter = null; S.clip = null;
    S._dryL = null; S._dryR = null; S._spcIn = null; S._spc = null; S._ok = false;
    if (typeof S.enabled !== 'boolean') S.enabled = true;
    if (S.onEvent === undefined) S.onEvent = null;
    try { if (readMute(MUTE_KEY, MUTE_KEY_OLD)) S.enabled = false; } catch (e) {}   /* localStorage/wx 静音开关 */
    return S;
  }

  var cur = null, seed = install(PS.Sound && typeof PS.Sound === 'object' ? PS.Sound : null);
  try {
    Object.defineProperty(PS, 'Sound', {
      configurable: true, enumerable: true,
      get: function () { return cur; },
      set: function (v) { cur = install(v && typeof v === 'object' ? v : null); }
    });
    PS.Sound = seed;                                        /* 经 setter 建立引用(幂等) */
  } catch (e) { PS.Sound = seed; }                          /* defineProperty 不可用 → 直接赋值 */

  /* 诊断/自检入口(配方 / 材料 / 节流表 / 静音键) */
  PS.SoundVeg = PROTO;
  PS.SoundVeg.VERSION = VERSION;
  PS.SoundVeg.__install = install;
  PS.SoundVeg.MUTE_KEYS = { sfx: MUTE_KEY, bgm: MUTE_MUSIC_KEY };
  PS.SoundVeg.musicMuted = function () { return readMute(MUTE_MUSIC_KEY, MUTE_MUSIC_KEY_OLD); };
  PS.SoundVeg.setMusicMuted = function (off) { try { writeMute(MUTE_MUSIC_KEY, !!off); } catch (e) {} return !!off; };
  PS.SoundVeg.setSfxMuted = function (off) { try { writeMute(MUTE_KEY, !!off); } catch (e) {} return !!off; };
  PS.SoundVeg.sfxMuted = function () { return readMute(MUTE_KEY, MUTE_KEY_OLD); };

  global.PS = PS;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));