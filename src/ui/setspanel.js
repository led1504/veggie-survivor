/* PS.SetsPanel -- 武器羁绊(套装)面板 (v5.7, 主程新建)
 * =============================================================================
 * 信息架构照源 src-remote/ui/menus/shop/synergy_panel.gd:
 *   · 只列**身上已有**的套装(get_player_sets = active_sets.keys(), count >= 1 就算);
 *   · 每套: 套装名作标题 + 逐档一行, 行首是档位门槛 "(i+2)"(源逐字: value_text = "(" + str(i+2) + ") ");
 *   · 当前达成的那一档**高亮**, 其余整行置灰(源用 GRAY_COLOR_STR 包未达成行);
 *   · 效果文案按 effect.get_text() 逐条拼, 本作对应 PS.SetData.modText() —— 数值**由数据现算**。
 * 画面是本作原创(色板取自 PS.UI.TOK 的金结构线/冷绿底体系), 不搬源的任何贴图与字体。
 *
 * 为什么单独成文件: ui.js 的写权在同一时刻只属于一个执行体。本文件零依赖(自绘 roundRect 与文字),
 *   只从 PS.UI.TOK 读色板与字号; ui.js 里只需一行调用 —— 见本文件末尾的 callSite 说明。
 *
 * 对外 API:
 *   PS.SetsPanel.held(game)            -> [setId, ...]  (按 PS.SetData.order 排)
 *   PS.SetsPanel.height(w, opts)       -> 预估高度(px), 供调用方排版(与 draw() 的返回**恒等**, 断言见 qa/verify-weapon-sets.cjs [9])
 *   PS.SetsPanel.draw(px, py, w, opts) -> 实际用掉的高度(px); 返回 0 表示没画
 *   opts(可选): { game, lines:[{t,col,size,align,bold}], font, alpha }
 *     · lines: 由调用方注入的"原语"适配层(ui.js 的 text() 之类)。不传则用本文件的平文本兜底。
 */
(function (global) {
  'use strict';
  var PS = global.PS || (global.PS = {});

  var DEF = {
    title: 13.5, body: 12, gapSet: 10, headH: 20, lineH: 16, padX: 10, padY: 8,
    dot: 8
  };

  function tok() { return (PS.UI && PS.UI.TOK) || null; }
  function col(name, fb) { var T = tok(); return (T && T[name]) || fb; }
  function fs(name, fb) { var T = tok(); return (T && T.fs && T.fs[name]) || fb; }

  function rr(x, px, py, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    x.beginPath();
    x.moveTo(px + r, py);
    x.lineTo(px + w - r, py); x.quadraticCurveTo(px + w, py, px + w, py + r);
    x.lineTo(px + w, py + h - r); x.quadraticCurveTo(px + w, py + h, px + w - r, py + h);
    x.lineTo(px + r, py + h); x.quadraticCurveTo(px, py + h, px, py + h - r);
    x.lineTo(px, py + r); x.quadraticCurveTo(px, py, px + r, py);
    x.closePath();
  }

  /* 文字落点: 优先走调用方注入的原语(ui.js 的 fitText/text, 保证字体与全局一致), 否则自绘。 */
  function put(x, opts, s, px, py, size, color, align, bold) {
    if (opts && opts.lines && opts.lines.push) {
      opts.lines.push({ t: s, x: px, y: py, size: size, col: color, align: align || 'left', bold: !!bold });
      return;
    }
    var f = (opts && opts.font) || 'system-ui, sans-serif';
    x.save();
    x.font = (bold ? 'bold ' : '') + size + 'px ' + f;
    x.textAlign = align || 'left';
    x.textBaseline = 'alphabetic';
    x.fillStyle = color;
    x.fillText(s, px, py);
    x.restore();
  }

  var P = {
    DEF: DEF,
    held: function (g) {
      var SD = PS.SetData;
      if (!SD) return [];
      var state = (g && g.sets) || SD.ofWeapons((g && g.weapons) || []);
      var out = [], i;
      for (i = 0; i < SD.order.length; i++) if (state[SD.order[i]]) out.push(SD.order[i]);
      return out;
    },
    /* 高度: 面板小标题(headH) + 每套(套名行 + 档位数行) + 套间留白; 一套都没有时 = 标题 + 一行提示。
     * v5.8(主程) 修正口径: 旧版漏算了**面板自己那行小标题**(held >= 1 时少 20px), 于是调用方
     *   (ui.js 的商店属性面板) 只能在外面手补一个 SDEF.head —— 典型的「合约少报 + 调用方补偿」,
     *   换任何新调用方都会重踩。现在 height() 与 draw() 的返回值**恒等**,
     *   这条等式由 qa/verify-weapon-sets.cjs 的 [9] 段断言钉死。 */
    height: function (w, opts) {
      var SD = PS.SetData, held = P.held((opts && opts.game) || PS.Game);
      var n = DEF.headH, i;
      if (!SD) return 0;
      if (!held.length) return DEF.headH + DEF.lineH;        /* 标题 + 一行提示 */
      for (i = 0; i < held.length; i++) n += DEF.headH + SD.list[held[i]].tiers.length * DEF.lineH + (i ? DEF.gapSet : 0);
      return n;
    },
    draw: function (px, py, w, opts) {
      var x = (opts && opts.ctx) || (PS.UI && PS.UI.ctx);
      var SD = PS.SetData;
      if (!x || !SD) return 0;
      opts = opts || {};
      var g = opts.game || PS.Game;
      var held = P.held(g);
      var alpha = opts.alpha == null ? 1 : opts.alpha;
      var y = py;
      x.save();
      x.globalAlpha = alpha;

      /* 小标题(与调用方的面板标题同风格: 金色小字 + 一条横线) */
      put(x, opts, '武器羁绊', px + DEF.padX, y + 11, DEF.title, col('gold', '#d8a24a'), 'left', true);
      var tw = (opts.textW ? opts.textW('武器羁绊', DEF.title) : 66);
      x.strokeStyle = col('weak', 'rgba(255,255,255,0.10)');
      x.lineWidth = 1;
      x.beginPath();
      x.moveTo(px + DEF.padX + tw + 10, y + 7);
      x.lineTo(px + w - DEF.padX, y + 7);
      x.stroke();
      y += DEF.headH;

      if (!held.length) {
        put(x, opts, '尚未成组 · 同一套武器 ≥2 把即生效', px + DEF.padX, y + 11, DEF.body, col('low', '#6b776b'), 'left', false);
        x.restore();
        return DEF.headH + DEF.lineH;    /* 与 height() 的「标题 + 一行提示」恒等 */
      }

      for (var i = 0; i < held.length; i++) {
        var id = held[i], st = SD.list[id], e = (g && g.sets && g.sets[id]) || null;
        var cnt = e ? e.count : 0, cur = e ? e.idx : -1;
        if (i) y += DEF.gapSet;
        /* 套装名 + 计数 + 当前档位进度 */
        x.fillStyle = st.color || col('hi', '#f2ead6');
        rr(x, px + DEF.padX, y + 3, DEF.dot, DEF.dot, 2.5); x.fill();
        put(x, opts, st.name, px + DEF.padX + DEF.dot + 7, y + 12, DEF.title, st.color || col('hi', '#f2ead6'), 'left', true);
        var chip = cnt + '/' + st.tiers[st.tiers.length - 1].nb + (cur >= 0 ? '' : ' · 未激活');
        put(x, opts, chip, px + w - DEF.padX, y + 12, DEF.body, cur >= 0 ? col('pos', '#8fd66b') : col('low', '#6b776b'), 'right', cur >= 0);
        y += DEF.headH;
        /* 逐档: 行首门槛 "(i+2)", 达成的那一档高亮, 其余置灰(源 synergy_panel.gd 的口径) */
        for (var j = 0; j < st.tiers.length; j++) {
          var t = st.tiers[j];
          var done = (cur === j);                 /* 源只高亮"当前那一档", 不是所有已达标档 */
          var passed = (cur >= j);
          var c = done ? col('hi', '#f2ead6') : (passed ? col('mid', '#98a68f') : col('low', '#6b776b'));
          put(x, opts, '(' + t.nb + ') ' + SD.tierText(t), px + DEF.padX + 12, y + 12, DEF.body, c, 'left', done);
          y += DEF.lineH;
        }
      }
      x.restore();
      return y - py;
    }
  };

  PS.SetsPanel = P;
})(typeof window !== 'undefined' ? window : globalThis);