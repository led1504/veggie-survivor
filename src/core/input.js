/* PS.Input —— 输入层(桌面鼠标 / 触屏摇杆 / 键盘 三模)
 * 桌面鼠标: 光标跟随 —— 玩家走向光标位置, 无摇杆视觉, 无需按住(桌面原生手感)
 * 触屏:     动态虚拟摇杆 —— 按下处为原点, 拖动方向即移动(仅 pointerType=touch 显示)
 * 键盘:     WASD / 方向键(优先级最高, 调试用)
 * 按钮:     pointerdown 同步结算 dispatchTap(不再延迟一帧)
 * 统一走 Pointer Events(现代浏览器全支持), 消灭 mouse+touch 双监听的时序坑。
 */
(function (global) {
  'use strict';
  var PS = global.PS || {};

  PS.Input = {
    attach: function (canvas, ui) {
      var I = this;
      I.x = 0; I.y = 0;
      I.active = false;          // 触屏摇杆是否激活
      I.mode = 'mouse';          // 当前指针类型: 'mouse' | 'touch'
      I.ox = 0; I.oy = 0; I.cx = 0; I.cy = 0;
      I.mouseIn = false;         // 光标是否在画布内(光标跟随用)
      I.keys = {};
      /* v3.8(修「第二根手指抬起 → 整波不能动」): 摇杆必须属于**某一根具体手指**。
       *   旧实现任何一次 pointerdown(touch) 都重锚摇杆原点, 且任何一次 pointerup 都 release(),
       *   于是「左拇指按着摇杆 + 右拇指点一下」→ 右拇指抬起把 active 置 false, 左拇指还按着也不恢复。
       *   微信端(weapp.js:137-151 的 pickTouch/liftedId)早就按同一思路修过, 浏览器端没同步。 */
      var joyId = null;          // 拥有摇杆的 pointerId; null = 无

      function toLogic(e) {
        var r = canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left) * (ui.W / r.width), y: (e.clientY - r.top) * (ui.H / r.height) };
      }

      canvas.addEventListener('pointerdown', function (e) {
        var p = toLogic(e);
        ui.pointer = p;
        if (e.pointerType === 'touch') {
          I.mode = 'touch';
          if (joyId === null) {          /* 只有**第一根**手指能锚定/拥有摇杆 */
            joyId = e.pointerId;
            I.active = true;
            I.ox = p.x; I.oy = p.y; I.cx = p.x; I.cy = p.y;
          }
        } else {
          I.mode = 'mouse';
        }
        I.dispatchTap(p);        // 按下即结算按钮(同步, 无 setTimeout)
        e.preventDefault();
      });
      global.addEventListener('pointermove', function (e) {
        var p = toLogic(e);
        I.mouseIn = p.x >= 0 && p.x <= ui.W && p.y >= 0 && p.y <= ui.H;
        ui.pointer = I.mouseIn ? p : null;
        /* v3.8: 鼠标只要动一次就抢回 mouse 模式 —— 否则触过屏之后 mode 永久停在 'touch',
         *   鼠标引路(光标跟随)会一直失效, 必须再点一次鼠标才恢复。 */
        if (e.pointerType === 'mouse') I.mode = 'mouse';
        if (I.active && (joyId === null || e.pointerId === joyId)) { I.cx = p.x; I.cy = p.y; }
      });
      /* 只有**拥有摇杆的那根手指**抬起才复位; 别的手指抬起不许动摇杆。 */
      function release(e) {
        if (e && typeof e.pointerId === 'number' && joyId !== null && e.pointerId !== joyId) return;
        joyId = null; I.active = false; I.x = 0; I.y = 0;
      }
      global.addEventListener('pointerup', release);
      global.addEventListener('pointercancel', release);   // 拖出窗口/系统手势中断也能复位
      /* v3.8: blur 必须**连键盘一起清**。旧实现只 release() 摇杆: 按住 D 切窗口、松手、切回来,
       *   keys.d 永远为 true 且键盘分支无条件覆盖鼠标/摇杆 ⇒ 玩家被单向推到右墙。 */
      global.addEventListener('blur', function () { I.keys = {}; release(); });

      /* v5.2: Esc / P 开关暂停 —— 用户要求「战斗过程中能设置并退回主菜单」, 键盘走同一条路。
       *   只在 PLAY ↔ PAUSE 之间切: 商店/升级/结算页各有覆盖层, 不许被键盘叠第二层。
       *   PS.State 由 game.js 提供, 而 game.js 在 index.html 里先于本文件加载。 */
      global.addEventListener('keydown', function (e) {
        I.keys[e.key] = true;
        var g = PS.Game, S = PS.State;
        if (!g || !S || !g.player) return;
        if (e.key !== 'Escape' && e.key !== 'Esc' && e.key !== 'p' && e.key !== 'P') return;
        if (g.state === S.PLAY) g.pauseGame();
        else if (g.state === S.PAUSE) g.resumeGame();
        else return;
        e.preventDefault();
      });
      global.addEventListener('keyup', function (e) { I.keys[e.key] = false; });

      /* 每帧采样: 触屏摇杆 > 光标跟随 > 键盘(覆盖前者) */
      I.sample = function () {
        I.x = 0; I.y = 0;
        /* v3.8: 摇杆只看 active, 不再看 mode —— mode 现在只决定「光标跟随是否可用」与摇杆是否显示。
         *   (否则鼠标一动把 mode 改成 'mouse' 会当场掐掉正在拖的摇杆。) */
        if (I.active) {
          var dx = I.cx - I.ox, dy = I.cy - I.oy;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d > 6) {
            var k = Math.min(1, d / 70);
            I.x = dx / d * k; I.y = dy / d * k;
          }
        }
        var g = PS.Game;
        if (!I.active && I.mode === 'mouse' && I.mouseIn && ui.pointer &&
            g && g.state === PS.State.PLAY && g.player) {
          // 光标跟随: 玩家走向光标, 36px 死区防抖, 距离越远速度越满
          var mx = ui.pointer.x - g.player.x, my = ui.pointer.y - g.player.y;
          var md = Math.sqrt(mx * mx + my * my);
          if (md > 36) {
            var mk = Math.min(1, (md - 36) / 110);
            I.x = mx / md * mk; I.y = my / md * mk;
          }
        }
        var kx = (I.keys['d'] || I.keys['D'] || I.keys['ArrowRight'] ? 1 : 0) - (I.keys['a'] || I.keys['A'] || I.keys['ArrowLeft'] ? 1 : 0);
        var ky = (I.keys['s'] || I.keys['S'] || I.keys['ArrowDown'] ? 1 : 0) - (I.keys['w'] || I.keys['W'] || I.keys['ArrowUp'] ? 1 : 0);
        if (kx || ky) {
          var m = Math.sqrt(kx * kx + ky * ky);
          I.x = kx / m; I.y = ky / m;
        }
        g.input = { x: I.x, y: I.y };
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

      /* 摇杆视觉只在触屏模式下绘制 */
      I.drawJoystick = function () {
        if (!I.active || I.mode !== 'touch') return;
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
      return I;
    }
  };
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
