/* PS.Save v2 —— 存档（双端）
 * 字段: best/wins/totalKills/runs/endlessBest perModeWins fps(帧率挡位 30/60/120)
 */
(function (global) {
  'use strict';
  var PS = global.PS || {};
  /* v2.7 改名(土豆幸存者 → 蔬菜幸存者): 写新键, 读时回退旧键, 老存档不丢。 */
  var KEY = 'veggie_survivor_v2_save';
  var LEGACY_KEY = 'potato_survivor_v2_save';

  /* 帧率挡位(30/60/120): 三选一。旧存档没有这个字段 / 被外部改坏 ⇒ 一律回落 60(与旧行为等价)。 */
  function normFps(v) { return (v === 30 || v === 60 || v === 120) ? v : 60; }
  /* 落到运行时(唯一入口): ① 渲染预算的单帧预算随挡位放宽 —— 否则「自己选了 30fps」会被 perf 误判成
   *   机器跟不上, 一路降到最糊那一档; ② 平台层各按能力落实(微信 setPreferredFramesPerSecond 有效 1-60,
   *   浏览器 rAF 跟屏 ⇒ 只能往下夹 30 挡)。 */
  function applyFps(n) {
    var p = PS.PlatformWeApp || PS.PlatformWeb;
    if (p && p.fpsCap && n > p.fpsCap) n = p.fpsCap;   /* 本机不支持的挡位(60 上限机型上的 120)落到上限 */
    if (PS.Perf && typeof PS.Perf.setFpsCap === 'function') PS.Perf.setFpsCap(n);
    if (p && typeof p.applyFps === 'function') p.applyFps(n);
    return n;
  }
  PS.applyFps = applyFps;      /* 平台层 boot 时也调一次(读存档下发) */
  var store = null;
  if (typeof wx !== 'undefined' && wx.getStorageSync) {
    store = {
      get: function () { try { return wx.getStorageSync(KEY) || wx.getStorageSync(LEGACY_KEY) || null; } catch (e) { return null; } },
      set: function (v) { try { wx.setStorageSync(KEY, v); } catch (e) {} }
    };
  } else if (typeof localStorage !== 'undefined') {
    store = {
      get: function () { try { var r = localStorage.getItem(KEY); if (!r) r = localStorage.getItem(LEGACY_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; } },
      set: function (v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
    };
  }
  PS.Save = {
    data: null,
    load: function () {
      var d = store ? store.get() : null;
      /* v3.8(形状校验): 存档被外部写坏(裸数字 / 字符串 / 数组)时直接回落默认值。
       *   旧实现原样接受: 在数字/字符串上做属性赋值在严格模式抛 TypeError, 而 recordRun 的抛出点
       *   (game.js finish)在 setState(OVER) 之前 ⇒ 死亡后结算界面永不出现; 数组则会让 JSON.stringify
       *   丢掉自定义字段 ⇒ 进度永不落盘。两者都只在这一道校验里根治。 */
      if (d !== null && (typeof d !== 'object' || Array.isArray(d))) d = null;
      this.data = d || { best: 0, wins: 0, totalKills: 0, runs: 0, endlessBest: 0, modeWins: {}, fps: 60 };
      this.data.fps = normFps(this.data.fps);
      return this.data;
    },
    save: function () { if (store && this.data) store.set(this.data); },
    recordRun: function (wave, kills, win, mode) {
      var d = this.data;
      if (!d || typeof d !== 'object' || Array.isArray(d)) d = this.load();   /* 同 load(): 只接受对象 */
      d.runs = (d.runs || 0) + 1;
      d.totalKills = (d.totalKills || 0) + kills;
      if (mode === 'endless' && wave > (d.endlessBest || 0)) d.endlessBest = wave;
      if (wave > (d.best || 0)) d.best = wave;
      if (win) {
        d.wins = (d.wins || 0) + 1;
        d.modeWins = d.modeWins || {};
        d.modeWins[mode] = (d.modeWins[mode] || 0) + 1;
      }
      this.save();
    },

    /* 帧率挡位: 写存档 + 立刻落到运行时(设置面板点一下当场生效, 不是下次启动才生效) */
    setFps: function (n) {
      if (!this.data || typeof this.data !== 'object' || Array.isArray(this.data)) this.load();
      this.data.fps = normFps(n);
      this.save();
      applyFps(this.data.fps);
      return this.data.fps;
    }
  };
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
