/* PS.Perf v5.20 —— 渲染预算(按实测帧时自动降采样)
 * 存在理由(用户逐字): 「还有一个严重影响游戏体验的问题, 我现在才无尽第19波, 有非常严重的卡顿掉帧」。
 * 实测取证(work/perfg-*.json · 真 Edge + 软件光栅, 等价弱显卡/关硬件加速):
 *   无尽第 19 波 dpr=2 → 帧间隔 p50 = 36.0ms(27.7fps), 而**同一帧的 JS 只占 1.7ms**;
 *   dpr=1.5 → 18.4ms(54.5fps) · dpr=1 → 7.9ms(125fps) —— 帧耗时与像素数**完全线性**。
 *   判据: 瓶颈是**像素填充率**(Canvas2D 光栅), 不是逻辑/draw call 数/GC。
 * 于是唯一能把「弱机掉帧」从"这次修好"变成"机制上不再可能"的杠杆, 就是按实测帧时动态降采样:
 *   逻辑分辨率(1280x720)、全部绘制代码、判定与手感**一律不变**; 只有后备缓冲的像素数变。
 * 三条纪律:
 *   ① 只信帧间隔, 不猜机器: 跟不上就降, 稳得住才升; **升上去又掉回来的档位本局不再尝试**(防震荡);
 *   ② 换档只发生在**帧首**(平台层在画之前套用), 绝不在半帧里改后备缓冲尺寸;
 *   ③ enabled=false 时对绘制路径**零影响**(不改任何变换) —— 门禁的负向对照靠这条。
 * 判定口径: 窗内**中位数**(p50)。一次 GC / 一次系统调度不该触发降档, 均值会。
 * 目标: 60fps = 16.7ms; targetMs 取 20(容忍 vsync 抖动), 低于它就认为这台机器跟得上。
 */
(function (global) {
  'use strict';
  var PS = global.PS || {};
  var P = PS.Perf = {};

  P.defaults = {
    enabled: true,
    ladder: [1, 0.82, 0.67, 0.55],   /* 渲染倍率(相对设备像素比), 单调递减 */
    window: 40,                      /* 判定窗(帧) */
    targetMs: 20,                    /* 窗内 p50 高于它 = 跟不上 -> 降一档 */
    recoverMs: 14,                   /* 窗内 p50 低于它 = 有余量 -> 考虑升一档 */
    recoverHold: 3,                  /* 连续几个窗达标才升(慢升快降) */
    warmupMs: 2500,                  /* 开场/换局先不判定: 首帧、首次烘焙、图集落地都慢 */
    minHoldMs: 1200                  /* 两次换档的最小间隔 */
  };

  var cfg = null, ladder = null, idx = 0, failed = {}, held = 0;
var fpsTier = 60, baseTarget = 20, baseRecover = 14;   /* 帧率挡位(见 setFpsCap) + 单帧预算基准 */
  var win = [], clock = 0, readyAt = 0, lastChange = 0, stat = null;

  P.scale = 1;      /* 当前渲染倍率(平台层据此分配后备缓冲) */
  P.dirty = false;  /* true = 平台层应在**本帧画之前**套用新倍率 */

  function zeroStats() { stat = { down: 0, up: 0, p50: 0, frames: 0, applied: 0 }; }
  function quantile(arr, q) {
    var a = arr.slice().sort(function (x, y) { return x - y; });
    return a[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * q)))];
  }
  function markFailed() { for (var k in failed) delete failed[k]; }  /** 当前档位对应的渲染倍率 */
  function scaleAt(i) { return ladder[Math.min(ladder.length - 1, Math.max(0, i))]; }

/* 单帧预算随帧率挡位放宽。理由: 用户主动选 30fps 时帧间隔本来就是 33ms, 拿 60fps 的 targetMs(20)
 *   去比, 每个判定窗都会判「跟不上」并一路降到最糊那一档 —— 那不是机器不行, 是挡位本身。
 *   60/120 挡 = 基准值原样(与改动前逐值一致)。 */
function applyBudget() {
  if (!cfg) return;
  var fr = (fpsTier < 60) ? 1000 / fpsTier : 0;
  cfg.targetMs = fr ? Math.max(baseTarget, fr * 1.25) : baseTarget;
  cfg.recoverMs = fr ? Math.max(baseRecover, fr * 1.05) : baseRecover;
}

  /** 换档(唯一入口): 档位 -> 倍率 -> 打脏标记。平台层下一帧首套用。 */
  function goLevel(i) {
    idx = Math.min(ladder.length - 1, Math.max(0, i));
    P.scale = scaleAt(idx);
    P.dirty = true;
    lastChange = clock;
    held = 0;
    stat.applied++;
  }

  /** 装机/换局: 复位判定窗与预热。warmupMs 缺省用 cfg.warmupMs。 */
  P.init = function (o) {
    var k;
    cfg = {};
    for (k in P.defaults) cfg[k] = (o && o[k] !== undefined) ? o[k] : P.defaults[k];
    var L = (cfg.ladder && cfg.ladder.length) ? cfg.ladder.slice() : P.defaults.ladder.slice();
    L = L.filter(function (s) { return typeof s === 'number' && isFinite(s) && s > 0 && s <= 1; });
    if (!L.length) L = P.defaults.ladder.slice();
    L.sort(function (x, y) { return y - x; });          /* 单调递减: 档 0 最清, 末档最省 */
    ladder = L;
    idx = 0; P.scale = scaleAt(0);
    markFailed();
    zeroStats();
    baseTarget = cfg.targetMs; baseRecover = cfg.recoverMs;   /* 挡位预算是相对本次配置的基准叠加 */
    applyBudget();
    return P.reset(cfg.warmupMs);
  };

  /** 清判定窗 + 重新预热(开场/换局/切场景调用: 那一刻的慢不是"机器不行") */
  P.reset = function (warmupMs) {
    win.length = 0; held = 0;
    readyAt = clock + (typeof warmupMs === 'number' && isFinite(warmupMs) ? warmupMs : (cfg ? cfg.warmupMs : 0));
    lastChange = clock;
    return P;
  };

  /** 平台层在**帧首**取一次: 非 null 就是把后备缓冲改成这个倍率 */
  P.takePending = function () {
    if (!P.dirty) return null;
    P.dirty = false;
    return P.scale;
  };

  /** 一帧一次: 喂进本帧的**真实帧间隔**(ms)。enabled=false 时它什么都不做。 */
  P.tick = function (ms) {
    if (!cfg || !cfg.enabled) return;
    if (stat) stat.frames++;
    if (typeof ms !== 'number' || !isFinite(ms) || ms <= 0) return;
    /* 切后台/断点/拖走窗口回来: 那一帧的间隔不是"渲染跟不上"的证据, 直接丢弃这段窗 */
    if (ms > 250) { win.length = 0; return; }
    clock += ms;
    win.push(ms);
    if (clock < readyAt) { win.length = 0; return; }
    if (win.length < cfg.window) return;
    var p50 = quantile(win, 0.5);
    win.length = 0;
    if (stat) stat.p50 = Math.round(p50 * 100) / 100;
    if (clock - lastChange < cfg.minHoldMs) return;
    if (p50 > cfg.targetMs && idx < ladder.length - 1) {
      failed[idx] = 1;                     /* 这一档本局判死: 升回去必然再掉一次 */
      if (stat) stat.down++;
      goLevel(idx + 1);
      return;
    }
    if (p50 < cfg.recoverMs && idx > 0 && !failed[idx - 1]) {
      held++;
      if (held >= cfg.recoverHold) { if (stat) stat.up++; goLevel(idx - 1); }
      return;
    }
    held = 0;
  };

  /** 帧率挡位(30/60/120) -> 单帧预算。平台层 / 设置面板的唯一入口; 非法值回落 60。 */
  P.setFpsCap = function (n) {
    fpsTier = (n === 30 || n === 60 || n === 120) ? n : 60;
    applyBudget();
    return cfg ? cfg.targetMs : null;
  };

  /* ---------- 只读自省(门禁/探针用; 不参与任何判定) ---------- */
  P.stats = function () {
    var f = [], k;
    for (k in failed) f.push(k);
    return {
      ready: !!cfg, enabled: !!(cfg && cfg.enabled), level: idx, scale: P.scale, fpsTier: fpsTier,
      ladder: ladder ? ladder.slice() : [], failed: f,
      frames: stat ? stat.frames : 0, down: stat ? stat.down : 0, up: stat ? stat.up : 0,
      applied: stat ? stat.applied : 0, p50: stat ? stat.p50 : 0,
      clock: Math.round(clock), sinceChange: Math.round(clock - lastChange)
    };
  };
  /** 门禁/探针用: 直接置档(不写 failed、不受 minHold 限制) —— 用来做确定性的 A/B */
  P.setLevel = function (i) { if (cfg) goLevel(i); return P.scale; };
  P.setEnabled = function (v) { if (cfg) cfg.enabled = !!v; return !!(cfg && cfg.enabled); };
})(typeof window !== 'undefined' ? window : globalThis);
