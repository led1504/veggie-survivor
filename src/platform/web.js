/* PS.Platform.Web v2 —— 横屏浏览器适配层
 * 1280x720 横屏, 自适应窗口(保持比例), Web Audio 接线, rAF 主循环 + 异常保护。
 * #battle 直进战斗, #battle&ff=N 快进(开发/测试钩子)。
 */
(function (global) {
  'use strict';
  var PS = global.PS || {};
  var B = PS.Balance;

  PS.PlatformWeb = {
    boot: function (containerId) {
      var P = this;
      var W = B.VIEW.w, H = B.VIEW.h;
      var canvas = document.createElement('canvas');
      document.getElementById(containerId).appendChild(canvas);
      var baseDpr = Math.min(B.FX.dprCap, global.devicePixelRatio || 1);
      var dpr = baseDpr;
      /* v5.20 渲染预算(见 src/core/perf.js): 后备缓冲倍率 = 设备像素比 x 守门员给的可变倍率。
       *   为什么必须是变量: 实测帧耗时与像素数线性 ⇒ 弱机上唯一的杠杆就是像素数。
       *   宽度取 5 的整数倍: 512*k 与 1280*k 都成整数 ⇒ 地面件能**精确 1:1** 落图(art.js 的 blit1to1)。 */
      function canvasW(s) { return Math.max(160, Math.round(W * baseDpr * s / 5) * 5); }
      canvas.width = canvasW(1);
      canvas.height = Math.round(canvas.width * H / W);
      var ctx = canvas.getContext('2d');
      function applyScale(s) {
        var cw = canvasW(s), ch = Math.round(cw * H / W);
        if (cw === canvas.width && ch === canvas.height) return;
        canvas.width = cw; canvas.height = ch;          /* 赋值即清空后备缓冲 + 复位基变换 */
        dpr = cw / W;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ui.dpr = dpr;
      }
      ctx.scale(dpr, dpr);

      function resize() {
        var vw = global.innerWidth, vh = global.innerHeight;
        var scale = Math.min(vw / W, vh / H);
        canvas.style.width = (W * scale) + 'px';
        canvas.style.height = (H * scale) + 'px';
      }
      global.addEventListener('resize', resize);
      resize();

      // 音频: 首次交互解锁自动播放限制
      PS.Sound.init(null);
      PS.Music.init(PS.Sound.ctx);          // 复用音效总线, 音乐走独立增益
      function unlock() { PS.Sound.resume(); PS.Music.resume(); global.removeEventListener('pointerdown', unlock); global.removeEventListener('keydown', unlock); }
      global.addEventListener('pointerdown', unlock);
      global.addEventListener('keydown', unlock);

      var ui = PS.UI.init({
        canvas: canvas, ctx: ctx, W: W, H: H,
        dpr: dpr, font: '"PingFang SC","Microsoft YaHei",sans-serif',
        pointer: null,
        makeCanvas: function (w, h) {
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          return c;
        }
      });
      PS.Save.load();
      /* 帧率挡位(30/60/120): 浏览器 rAF 跟着屏幕刷新率走, 所以只能往下夹 —— 30 挡真的隔帧画
       *   (隔一帧直接 return 且不动 last ⇒ 下一帧的 dt 仍是完整间隔); 60/120 挡不夹(rAF 给多少就是多少,
       *   高刷屏自然跑满)。预算口径同步放宽, 见 core/perf.js 的 setFpsCap。 */
      var minGap = 0, fpsNow = 60;
      P.fpsCap = 60; P.probed = false;    /* 高刷能力: 探测出结果前先按 60 保守(见 probeFpsCap) */
      /* 高刷屏能力探测: 屏幕快于 60Hz 才放出 120 挡, 否则设置里**不显示** 120。
       *   取证口径 = 一段 rAF 采样的**最小**间隔(偶尔的慢帧不该把 120Hz 屏判成 60Hz);
       *   采样挂在启动闸门之后 —— 首帧/图集解码那几百毫秒不是屏幕能力的证据(与启动闸门同一教训)。
       *   阈值 15ms/帧 ≈ 66Hz: 真 60Hz 屏最小间隔 ~16.6ms, 75/90/120Hz 都 <= 13.3ms, 判得开。 */
      function probeFpsCap() {
        var n = 0, t0 = 0, min = 1e9;
        function step(ts) {
          if (t0) { var d = ts - t0; if (d > 0 && d < min) min = d; }
          t0 = ts;
          if (++n < 40) { global.requestAnimationFrame(step); return; }
          P.fpsCap = (min <= 15) ? 120 : 60;
          P.refreshHz = min < 1e9 ? Math.round(1000 / min) : 0;
          P.probed = true;
        }
        global.requestAnimationFrame(step);
      }
      P.applyFps = function (n) {
        fpsNow = (n === 30 || n === 60 || n === 120) ? n : 60;
        minGap = fpsNow >= 60 ? 0 : (1000 / fpsNow) - 1;
        return fpsNow;
      };
      if (PS.applyFps) PS.applyFps(PS.Save.data.fps);
      /* 曲目切换: 菜单/战斗/Boss —— 挂 PS.Game 现成生命周期钩子 */
      PS.Game.onState = function (s) {
        if (s === 'menu' || s === 'mode' || s === 'char') PS.Music.setTrack('menu');
        else if (s === 'play') PS.Music.setTrack(PS.Game.eliteAlive ? 'boss' : 'battle');
        else if (s === 'over') { PS.Music.setTrack('menu'); PS.Music.setIntensity(0.3); }
      };
      /* v7.3 波次切曲: 无终点模式(noWin)不许因为「波数 >= waves」把 Boss 曲焊死在后面每一波上 ——
       *   无尽本来就每 5 波才出 Boss, 判据见 B.MODES.endless.noWin 与 B.isFinalWave。
       *   注释必须留在 onWaveStart **外面**: qa/verify-audio 的 [4d] 在 onWaveStart 之后 200 字符内找 setTrack,
       *   注释写在函数体里会把驱动点挤出这个窗口(2026-09-30 实测过一次)。 */
      PS.Game.onWaveStart = function (w) {
        var m = PS.Balance.MODES[PS.Game.mode];
        PS.Music.setTrack(((!m.noWin && w >= m.waves) || (PS.Game.mode === 'endless' && w % 5 === 0)) ? 'boss' : 'battle');
      };
      PS.Music.setTrack('menu');
      /* 渲染预算装机: 判定逻辑在 core/perf.js; 这里只给它"怎么套用倍率"和调参面 */
      if (PS.Perf && PS.Perf.init) PS.Perf.init((B.FX && B.FX.perf) || {});
      var input = PS.Input.attach(canvas, ui);
      PS.FX.init();

      var last = Date.now();
      function frame() {
        var now = Date.now();
        var ivMs = now - last;                    /* 本帧真实间隔(未夹紧): 渲染预算的输入 */
        if (minGap && ivMs < minGap) { global.requestAnimationFrame(frame); return; }   /* 帧率挡位: 没到本挡的节奏就不画 */
        try {
          var dt = Math.min(0.05, ivMs / 1000);
          if (PS.Perf && PS.Perf.tick) {
            PS.Perf.tick(ivMs);
            var pend = PS.Perf.takePending();     /* 帧首换档: 绝不在半帧里改后备缓冲尺寸 */
            if (pend !== null) applyScale(pend);
          }
          input.sample();
          PS.Game.update(dt);
          PS.FX.update(dt);
          /* 音乐: 前瞻调度 + 紧张度(血量/精英/怪潮驱动) */
          PS.Music.update(dt);
          var mg = PS.Game, ms = mg.stats, mp = mg.player;
          PS.Music.setIntensity((mp && ms && ms.maxHp > 0)
            ? Math.min(1, 0.30 + (mg.eliteAlive ? 0.35 : 0) + (mg.horde ? 0.15 : 0) + 0.35 * (1 - mp.hp / ms.maxHp))
            : 0.35);
          PS.UI.draw(dt);
          input.drawJoystick();
        } catch (err) {
          if (!frame._lastErr || now - frame._lastErr > 1000) {
            console.error('[PS frame]', err);
            frame._lastErr = now;
          }
        }
        last = now;
        global.requestAnimationFrame(frame);
      }
      /* 启动闸门(理由与三条出路见 src/ui/atlas.js 的 A.pending): 图集没给定论前**不画世界** ——
       * 否则刷新后会先画一整屏程序化老美术, 图集一到再整屏换掉(用户实测的"闪老建模")。 */
      (function startWhenArtSettled() {
        if (!PS.Atlas || typeof PS.Atlas.pending !== "function" || !PS.Atlas.pending()) {
          probeFpsCap();
          global.requestAnimationFrame(frame);
          return;
        }
        (function poll() {
          if (PS.Atlas.pending()) { global.setTimeout(poll, 16); return; }
          last = Date.now();                  /* 首帧 dt 从放行那一刻算起, 不把等待时长算进去 */
          probeFpsCap();
          global.requestAnimationFrame(frame);
        })();
      })();
      P.canvas = canvas; P.ui = ui;
      return P;
    }
  };

  if (typeof document !== 'undefined') {
    PS.PlatformWeb.boot('game-root');
    if (typeof location !== 'undefined' && location.hash && location.hash.indexOf('battle') >= 0) {
      PS.Game.pendingChar = 'popo';
      PS.Game.newRun('popo', 'standard');
      var mff = /ff=(\d+)/.exec(location.hash);
      if (mff) {
        var ffSecs = parseInt(mff[1], 10) | 0;
        for (var ff = 0; ff < ffSecs * 30; ff++) {
          PS.Game.input = { x: 0.3, y: 0.2 };
          PS.Game.update(1 / 30);
          PS.FX.update(1 / 30);
          if (PS.Game.state === 'over') break;
          if (PS.Game.state === 'levelup') {
            var fch = PS.Game.levelupChoices || PS.Game.rollLevelupChoices();
            PS.Game.takeLevelup(fch[0]);
          } else if (PS.Game.state === 'shop') {
            PS.Game.nextWave();
          }
        }
      }
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
