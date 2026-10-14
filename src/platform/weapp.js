/* PS.Platform.WeApp v2.1 —— 微信小游戏适配层（横屏）
 * 横屏: game.json deviceOrientation=landscape; 逻辑面 16:9 居中, 两侧空档交给世界铺满(无黑边)。
 * 音频: wx.createWebAudioContext 注入 PS.Sound / PS.Music; 触摸摇杆 + 按下即结算点击。
 *
 * v2.1 修复(仅本文件, 逐条见 qa/wechat-audit.md):
 *  1) 生命周期补全 wx.onShow/onHide/onMemoryWarning/onError; 后台冻结时间轴, 回前台复位 last(不 dt 爆冲) + 音频 resume
 *  2) dt 下限夹紧(Math.max(0, ...)): 时钟回拨/同毫秒不再产生负 dt
 *  3) 触摸 identifier 跟踪: 多指时移动跟错手指、抬错手指导致摇杆松开 两个缺陷
 *  4) 画布按屏幕物理像素分配 + 16:9 逻辑面居中缩放(不拉伸变形); 非 16:9 机型的两侧空档由**世界**铺满
 *     (bleed, 见 ui.js fillScreen/drawWorld), 并且只按 safeArea 平移避让 ⇒ 既不露黑边, HUD 也不压刘海
 *  5) 系统信息读取加兜底(windowWidth||screenWidth, pixelRatio 校验) + 新接口 getWindowInfo 优先
 *  6) 音乐接线(与 web.js 同构): init/resume/update + setIntensity + onState/onWaveStart 切曲
 */
(function (global) {
  'use strict';
  var PS = global.PS || {};
  var B = PS.Balance;

  PS.PlatformWeApp = {
    running: true,
    launchQuery: null,
    lastError: null,
    /* 帧率挡位能力: WeChat 的 setPreferredFramesPerSecond **有效范围 1-60**(超出会被静默换成默认 16ms = 60fps),
     *   所以本平台 fpsCap = 60 —— 设置面板据此**连 120 挡都不显示**(不画玩家用不了的选项);
     *   存档里万一带了 120(比如在浏览器上选的), 也在这里落到 60。 */
    fpsCap: 60,
    applyFps: function (n) {
      var wxa = this.wx;
      var v = Math.min((n === 30 || n === 60 || n === 120) ? n : 60, this.fpsCap);
      if (wxa && typeof wxa.setPreferredFramesPerSecond === 'function') {
        try { wxa.setPreferredFramesPerSecond(v); } catch (e) {}
      }
      return v;
    },

    boot: function () {
      var P = this;
      var wxa = global.wx || (typeof wx !== 'undefined' ? wx : null);
      if (!wxa) { console.error('[PS weapp] wx 运行时缺失, 适配层未启动'); return P; }
      P.wx = wxa;
      var W = B.VIEW.w, H = B.VIEW.h;

      /* ---------- 屏幕信息: getWindowInfo 优先(新基础库), 旧库回落 getSystemInfoSync ---------- */
      function readInfo() {
        var o = null, s, k;
        try { if (typeof wxa.getWindowInfo === 'function') o = wxa.getWindowInfo(); } catch (e) { o = null; }
        try {
          s = wxa.getSystemInfoSync();
          if (s) {
            if (!o) o = s;
            else for (k in s) if (o[k] === undefined) o[k] = s[k];   // safeArea/statusBarHeight 等字段补齐
          }
        } catch (e2) {}
        return o || {};
      }
      function num(v, d) { return (typeof v === 'number' && isFinite(v) && v > 0) ? v : d; }
      var info = readInfo();
      var winW = num(info.windowWidth, num(info.screenWidth, W));   // windowWidth 缺失时回落 screenWidth(旧库)
      var winH = num(info.windowHeight, num(info.screenHeight, H));
      var baseDpr = Math.min(B.FX.dprCap, num(info.pixelRatio, 2));
      var dpr = baseDpr;

      /* ---------- 画布: 后备缓冲 = 屏幕物理像素; 16:9 逻辑面居中缩放, 两侧溢出带交给世界铺(bleed) ---------- */
      var canvas = wxa.createCanvas();
      var devW = Math.round(winW * dpr), devH = Math.round(winH * dpr);
      canvas.width = devW; canvas.height = devH;
      var ctx = canvas.getContext('2d');
      /* v5.20 渲染预算(判定逻辑见 src/core/perf.js): 后备缓冲倍率 = 设备像素比 x 守门员给的可变倍率。
       *   手机端尤其重要 —— 小游戏是软件/弱 GPU 光栅, 实测帧耗时与像素数**线性**。
       *   主画布被微信拉伸到整屏, 所以缩小后备缓冲 = 降采样; 逻辑坐标/判定/手感一律不动。 */
      function applyRenderScale(s2) {
        var nd = baseDpr * s2;
        if (Math.abs(nd - dpr) < 1e-6) return;
        dpr = nd;
        devW = Math.round(winW * dpr); devH = Math.round(winH * dpr);
        canvas.width = devW; canvas.height = devH;
        ui.dpr = dpr;
        applyView();
      }

      /* ---------- 缩放 / 安全区 / 两侧溢出(bleed) ----------
       * 逻辑面固定 1280x720(UI 的排版基准), 等比缩放后居中 —— 非 16:9 机型两侧必然空出一条。
       * v8.x(2026-10-08 用户实测「比例不对有黑边」): 这条**不再涂 #0a0f0a**, 而是让世界铺过去:
       *   见 bleed(交给 PS.UI) —— ui.js 的 drawWorld/fillScreen 按"逻辑面 + 溢出"画, 于是边上
       *   看到的是地面而不是黑条。缩放仍是 16:9, 所以既不拉伸, 也不裁 HUD。
       * safeArea 只用来**平移**(压到刘海/圆角下就整体内移), 不用来缩放 —— 缩放又会留黑边。
       * 旧版那段 safeArea 判定是死代码: num(sa.top,-1) 对合法值 0 返回 -1 ⇒ 条件恒 false, 从没生效过。 */
      function zero(v) { return (typeof v === 'number' && isFinite(v) && v >= 0) ? v : 0; }
      var fit = Math.min(winW / W, winH / H);
      if (!(fit > 0) || !isFinite(fit)) fit = 1;
      var spanX = winW - W * fit, spanY = winH - H * fit;
      /* 安全区内边距(设备像素)。拿不到 safeArea / 字段缺失 ⇒ 0 = 整屏可用;
       *   right/bottom 缺失时按 left/top + width/height 推(旧基础库只给宽高)。 */
      var sa = info.safeArea || {};
      var saL = Math.max(0, Math.min(zero(sa.left), winW));
      var saT = Math.max(0, Math.min(zero(sa.top), winH));
      var saR0 = zero(sa.right) || (zero(sa.left) + zero(sa.width));
      var saB0 = zero(sa.bottom) || (zero(sa.top) + zero(sa.height));
      var saR = saR0 > 0 ? Math.max(0, winW - Math.min(saR0, winW)) : 0;
      var saB = saB0 > 0 ? Math.max(0, winH - Math.min(saB0, winH)) : 0;
      /* 居中; 居中后若压进安全区就往里挪(左右/上下独立)。挪动**不露黑边** —— 溢出面由世界铺满。 */
      var offX = spanX / 2, offY = spanY / 2;
      if (spanX > 0 && saL + saR < spanX) offX = Math.max(saL, Math.min(spanX - saR, offX));
      if (spanY > 0 && saT + saB < spanY) offY = Math.max(saT, Math.min(spanY - saB, offY));
      /* 溢出量(逻辑像素): 逻辑面之外那两条边, 全部交给世界铺(ui.js 的 bleed) */
      function q2(v) { return Math.round(v * 100) / 100; }
      var bleed = {
        l: q2(Math.max(0, offX) / fit), r: q2(Math.max(0, winW - offX - W * fit) / fit),
        t: q2(Math.max(0, offY) / fit), b: q2(Math.max(0, winH - offY - H * fit) / fit)
      };

      /* 每帧基变换(UI/FX 都在逻辑坐标下绘制, ui.js 内部只做 save/restore, 不会覆盖基变换) */
      function applyView() { ctx.setTransform(dpr * fit, 0, 0, dpr * fit, dpr * offX, dpr * offY); }
      /* 只填溢出区(世界会紧跟着盖过去; 这一层只防"世界还没画"的第一帧露底) */
      function clearBars() {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        var l = Math.round(dpr * offX), t = Math.round(dpr * offY);
        var r = Math.round(dpr * (offX + W * fit)), b = Math.round(dpr * (offY + H * fit));
        ctx.fillStyle = '#0a0f0a';
        if (t > 0) ctx.fillRect(0, 0, devW, t);
        if (b < devH) ctx.fillRect(0, b, devW, devH - b);
        if (l > 0) ctx.fillRect(0, 0, l, devH);
        if (r < devW) ctx.fillRect(r, 0, devW - r, devH);
      }
      applyView();

      /* ---------- 音频: 音效总线 + 音乐(与 web.js 同构) ---------- */
      if (typeof wxa.createWebAudioContext === 'function') {
        try { PS.Sound.init(wxa.createWebAudioContext()); }
        catch (e) { PS.Sound.init(null); }            // 注入失败 → _ok=false, 静音运行(不抛)
      } else {
        PS.Sound._ok = false;                        // 无 WebAudio: 音效降级为 no-op
      }
      function unlockAudio() {
        PS.Sound.resume();
        if (PS.Music && PS.Music.resume) PS.Music.resume();
      }
      if (PS.Music && PS.Music.init) {
        try { PS.Music.init(PS.Sound.ctx || null); } catch (e) {}   // 无 ctx → false, 引擎每 90 帧自愈重试
      }
      function musicIntensity() {
        var g = PS.Game, s = g.stats, p = g.player;
        return (p && s && s.maxHp > 0)
          ? Math.min(1, 0.30 + (g.eliteAlive ? 0.35 : 0) + (g.horde ? 0.15 : 0) + 0.35 * (1 - p.hp / s.maxHp))
          : 0.35;
      }

      var ui = PS.UI.init({
        canvas: canvas, ctx: ctx, W: W, H: H, bleed: bleed,
        dpr: dpr, font: '"PingFang SC","Microsoft YaHei",sans-serif',
        pointer: null,
        makeCanvas: function (w, h) {
          var c = wxa.createCanvas();
          c.width = w; c.height = h;
          return c;
        }
      });
      PS.Save.load();
      PS.FX.init();
      /* 渲染预算装机: 判定在 core/perf.js, 这里只提供"怎么套用倍率" + 调参面 */
      if (PS.Perf && PS.Perf.init) PS.Perf.init((B.FX && B.FX.perf) || {});

      /* 曲目切换: 菜单/战斗/Boss —— 与 web.js 同一套钩子 */
      if (PS.Music && PS.Music.setTrack) {
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
          var m = B.MODES[PS.Game.mode];
          PS.Music.setTrack(((!m.noWin && w >= m.waves) || (PS.Game.mode === 'endless' && w % 5 === 0)) ? 'boss' : 'battle');
        };
        PS.Music.setTrack('menu');
      }

      /* 触摸坐标 → 逻辑坐标: 基变换的逆(屏幕逻辑 px → 1280x720 逻辑面) */
      function toLogic(t) {
        return { x: (t.clientX - offX) / fit, y: (t.clientY - offY) / fit };
      }
      function pickTouch(list, id) {
        var i;
        if (!list || !list.length) return null;
        if (id !== null && id !== undefined) {
          for (i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
        }
        return list[0] || null;
      }
      function liftedId(e, id) {                                   // 抬起的触点里是否有当前摇杆手指
        var c = e && e.changedTouches, i;
        if (id === null || id === undefined) return true;
        if (!c || !c.length) return (e && e.touches && e.touches.length === 0);   // 旧库无 changedTouches: 看剩余触点
        for (i = 0; i < c.length; i++) if (c[i].identifier === id) return true;
        return false;
      }

      var I = PS.Input;
      I.x = 0; I.y = 0; I.active = false; I.mode = 'touch'; I.keys = {};
      I.ox = 0; I.oy = 0; I.cx = 0; I.cy = 0; I.touchId = null;
      I.sample = function () {
        if (I.active) {
          var dx = I.cx - I.ox, dy = I.cy - I.oy;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d > 6) {
            var k = Math.min(1, d / 70);
            I.x = dx / d * k; I.y = dy / d * k;
          } else { I.x = 0; I.y = 0; }
        } else { I.x = 0; I.y = 0; }
        PS.Game.input = { x: I.x, y: I.y };
      };
      I.dispatchTap = function (p) {
        var bs = ui.buttons;
        for (var i = bs.length - 1; i >= 0; i--) {
          var b = bs[i];
          if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
            if (b.cb) b.cb();
            return true;
          }
        }
        return false;
      };
      I.drawJoystick = function () {
        if (!I.active) return;
        var x = ui.ctx;
        x.save();
        x.globalAlpha = 0.25;
        x.strokeStyle = '#fff';
        x.lineWidth = 2;
        x.beginPath(); x.arc(I.ox, I.oy, 44, 0, PS.TAU); x.stroke();
        var dx = I.cx - I.ox, dy = I.cy - I.oy;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d > 44) { dx = dx / d * 44; dy = dy / d * 44; }
        x.globalAlpha = 0.4;
        x.fillStyle = '#fff';
        x.beginPath(); x.arc(I.ox + dx, I.oy + dy, 20, 0, PS.TAU); x.fill();
        x.restore();
      };

      wxa.onTouchStart(function (e) {
        var t = pickTouch((e && e.changedTouches) || (e && e.touches), null);
        if (!t) return;
        var p = toLogic(t);
        ui.pointer = p;
        I.dispatchTap(p);                       // 按下即结算按钮(与浏览器端 pointerdown 同步结算一致)
        unlockAudio();
        /* 摇杆锚点: 与浏览器端一致 —— 每次按下重新锚定, 并记录该手指 identifier */
        I.touchId = (t.identifier === undefined ? null : t.identifier);
        I.active = true;
        I.ox = p.x; I.oy = p.y; I.cx = p.x; I.cy = p.y;
      });
      wxa.onTouchMove(function (e) {
        var t = pickTouch(e && e.touches, I.touchId);      // 跟锚定手指, 不再盲取 touches[0]
        if (!t) return;
        var p = toLogic(t);
        ui.pointer = p;
        if (I.active) { I.cx = p.x; I.cy = p.y; }
      });
      function touchRelease(e) {
        if (!I.active) return;
        if (!liftedId(e, I.touchId)) return;               // 抬的是别的指头 → 摇杆继续
        I.active = false; I.x = 0; I.y = 0; I.touchId = null;
      }
      wxa.onTouchEnd(touchRelease);
      wxa.onTouchCancel(touchRelease);

      /* ---------- 生命周期: 后台冻结时间轴 + 音频, 回前台复位 dt ---------- */
      var last = Date.now();
      P.running = true;
      if (wxa.onHide) wxa.onHide(function () { P.running = false; });
      if (wxa.onShow) wxa.onShow(function (res) {
        P.running = true;
        last = Date.now();                                  // 复位时间轴: 回来第一帧 dt=0, 不补算后台时长
        if (res && res.query) P.launchQuery = res.query;    // 分享/场景启动参数(建议项, 暂不改变流程)
        unlockAudio();
      });
      if (wxa.onError) wxa.onError(function (err) {
        P.lastError = String(err);
        console.error('[PS wx.onError]', err);
      });
      if (wxa.onMemoryWarning) wxa.onMemoryWarning(function (res) {
        console.warn('[PS wx.onMemoryWarning] level=' + ((res && res.level) || '?'));
        try {                                               // 只回收纯视觉池, 不动对局状态
          if (PS.FX && PS.FX.parts) {
            PS.FX.parts.length = 0; PS.FX.shards.length = 0; PS.FX.nums.length = 0;
            PS.FX.rings.length = 0; PS.FX.swings.length = 0; PS.FX.dashLines.length = 0;
          }
        } catch (e) {}
      });
      try {                                                 // 启动参数(首次 onShow 可能早于本注册)
        if (typeof wxa.getLaunchOptionsSync === 'function') {
          var lo = wxa.getLaunchOptionsSync();
          if (lo && lo.query) P.launchQuery = lo.query;
        }
      } catch (e) {}
      /* 帧率挡位: 读存档下发(默认 60 —— 与 WeChat 默认、浏览器端预算同档) */
      if (PS.applyFps) PS.applyFps((PS.Save.data && PS.Save.data.fps) || 60);

      /* rAF: 全局优先, 其次主画布(部分基础库挂在 canvas 上), 最后 setTimeout 兜底 */
      var raf = (typeof global.requestAnimationFrame === 'function') ? global.requestAnimationFrame
        : ((canvas && typeof canvas.requestAnimationFrame === 'function') ? function (cb) { canvas.requestAnimationFrame(cb); }
          : function (cb) { setTimeout(cb, 16); });

      function frame() {
        var now = Date.now();
        var ivMs = now - last;                                // 本帧真实间隔(未夹紧): 渲染预算的输入
        if (!P.running) { last = now; raf(frame); return; }   // 后台: 不推进时间轴(回来由 onShow 复位)
        var dt = (now - last) / 1000;
        if (!(dt > 0)) dt = 0;                               // 时钟回拨/同毫秒 → 0, 绝不给负 dt
        else if (dt > 0.05) dt = 0.05;                       // 长卡顿/切回台 → 夹到 50ms
        last = now;
        if (PS.Perf && PS.Perf.tick) {
          PS.Perf.tick(ivMs);
          var pend = PS.Perf.takePending();                  // 帧首换档: 在任何绘制之前
          if (pend !== null) applyRenderScale(pend);
        }
        try {
          clearBars();
          applyView();
          I.sample();
          PS.Game.update(dt);
          PS.FX.update(dt);
          if (PS.Music && PS.Music.update) {          // 音乐: 前瞻调度 + 紧张度(与 web.js 同构)
            PS.Music.update(dt);
            PS.Music.setIntensity(musicIntensity());
          }
          PS.UI.draw(dt);
          I.drawJoystick();
        } catch (err) {
          if (!frame._lastErr || now - frame._lastErr > 1000) { console.error('[PS frame]', err); frame._lastErr = now; }
        }
        raf(frame);
      }
      /* 启动闸门(与 web.js 同一口径; 理由与三条出路见 src/ui/atlas.js 的 A.pending) */
      (function startWhenArtSettled() {
        if (!PS.Atlas || typeof PS.Atlas.pending !== "function" || !PS.Atlas.pending()) { raf(frame); return; }
        (function poll() {
          if (PS.Atlas.pending()) { setTimeout(poll, 16); return; }
          last = Date.now();                  /* 首帧 dt 从放行那一刻算起 */
          raf(frame);
        })();
      })();
      P.canvas = canvas; P.ui = ui;
      return P;
    }
  };

  if (typeof GameGlobal !== 'undefined' && typeof wx !== 'undefined') {
    PS.PlatformWeApp.boot();
  }
})(GameGlobal);

