/* PS.Music v4 —— 自适应程序化配乐引擎（原创 / 零音频文件 / 零依赖 / 零构建）
 * 设计口径: qa/audio-design.md §3 (音乐) / §4 (混音与侧链) / §5 (性能预算)。
 *
 * 与 v3 的本质区别（v3 = 每小节同一组和弦琶音循环 4 遍 → 听感"小学生"的根因）:
 *   ① 四个段落各自成曲: prep 备战 / battle 战斗 / shop 波末商店 / boss 精英，各有独立
 *      BPM、调式、和声进行、鼓型与动机; 商店段落走摇摆(swing)律动 + 走低音(walking bass) +
 *      音盒音色主旋律 —— 和战斗段完全不同的"性格"，不是同一首曲子的减层版。
 *   ② 和声: 每段 4~8 小节功能进行(i-VI-III-VII / i-iv-VII-III / ii-V-I 等), 铺底和弦
 *      **做声部连接**(取最近转位, 相邻和弦共同音保持), 而不是固定三和弦平行移动。
 *   ③ 低音线: 根音/五度/八度切分型 + 半音趋近(approach) —— 不是每小节一个根音。
 *   ④ 主旋律: 每段 3 个动机细胞(cell) + 4 小节乐句计划 [A, A', B, A'']，动机经
 *      加花/移调/换音区/收束变奏, 强拍音吸附到当拍和弦音, 音区间 [root+12, root+33]。
 *   ⑤ 鼓组: 踢/军鼓/闭镲/开镲/吊镲/菜刀剁板(woodblock)/沙锤/嗵鼓/锣九件, 按强度档换型,
 *      每 4 小节末拍加 fill —— 保留"厨房"身份(剁菜板 + 油锅嘶声床)。
 *   ⑥ 自适应: intensity 0..1 平滑映射「调性亮度/编曲层/鼓型档/BPM」; 波次(教学档)、
 *      怪潮、精英、濒死各自加层或换型; 段落随游戏状态自动切换(商店/升级/菜单)。
 *   ⑦ 运行时零分配: 20 个音符槽(3 振荡器) / 8 个音体打击槽 / 8 个噪声打击槽 一次建好，
 *      逐音符只重设频率与包络; 声部池满即丢该音符(不抢占 → 无截断爆音)。
 *   ⑧ 侧链: 读 PS.Sound.densityNow() 与 PS.Sound.onEvent 的 hurt/boss/win/lose/horde ——
 *      音乐永远让位给音效(音效是信息, 音乐是可预期的)。
 *
 * 兼容/降级: 只复用 PS.Sound 的 ctx(绝不新建 AudioContext); ctx 缺失或微信端未解锁时全部
 *          API 静默 no-op; 任何异常 → _fail(e) 记 _lastErr + warn 一次 + 降级, 绝不让游戏崩。
 * 公开 API 不变: init/resume/setTrack/setIntensity/toggle/enabled/track/update/state/voices。
 */
(function (global) {
  'use strict';
  var PS = global.PS || (global.PS = {});

  /* ================= 0. 常量 ================= */
  var LOOKAHEAD = 0.22;            // 前瞻调度窗口(s)
  var MAX_STEPS = 24;              // 单帧最多排步数(防 dt 抖动死循环)
  var NOTE_SLOTS = 20;             // 音符槽(贝斯/铺底/琶音/主旋律/刺音)，每槽 3 振荡器
  var TONE_SLOTS = 8;              // 音体打击槽(踢/军鼓体/嗵鼓/锣体)
  var NOISE_SLOTS = 8;             // 噪声打击槽(军鼓噪声/镲/剁板/沙锤/油锅)
  var MAX_VOICES = 44;             // 同时活跃音源上限(结构性: 池容量 36 < 44)
  var BUS_BASE = 0.50;             // 音乐总线基础增益(相对 PS.Sound.master 0.5)
  var LAYER_UP = 1.0, LAYER_DOWN = 0.45;   // 加层(小节线渐入) / 减层(立即淡出) 时长(s)
  var DEF_INTENSITY = 0.40;
  var MIX = { perc: 0.90, bass: 1.00, pad: 0.40, arp: 0.46, lead: 0.58, fx: 0.46 };
  var LAYERS = ['perc', 'bass', 'pad', 'arp', 'lead', 'fx'];
  var FILT_LO = 1100, FILT_HI = 8200;      // 强度 0..1 → 总线低通扫频(暗 → 亮)
  var RATE_MIN = 0.96, RATE_MAX = 1.04;    // 强度 → BPM 微调(±4%)
  var BED_LVL = 0.013;                     // 油锅嘶声床(战斗时)
  var TUT_IN = 0.32, TUT_OUT = 0.40;       // 教学档滞回阈值
  var HORDE_S = 0.50, DYING_S = 0.82;      // 怪潮 / 濒死 强度门限

  /* ================= 1. 参数工具（能力探测: 微信端/桩上下文缺 API 时不抛） ================= */
  function mFn(o, m) { return !!o && typeof o[m] === 'function'; }
  function mSet(p, v, t) { try { if (!p) return; if (mFn(p, 'setValueAtTime')) p.setValueAtTime(v, t); else p.value = v; } catch (e) {} }
  function mExp(p, v, t) { try { if (!p) return; var x = v > 0.00002 ? v : 0.00002; if (mFn(p, 'exponentialRampToValueAtTime')) p.exponentialRampToValueAtTime(x, t); else p.value = x; } catch (e) {} }
  function mLin(p, v, t) { try { if (!p) return; if (mFn(p, 'linearRampToValueAtTime')) p.linearRampToValueAtTime(v, t); else p.value = v; } catch (e) {} }
  function mCan(p, t) { try { if (mFn(p, 'cancelScheduledValues')) p.cancelScheduledValues(t); } catch (e) {} }
  function mStop(n) { try { if (n && mFn(n, 'stop')) n.stop(0); } catch (e) {} }
  function mDisc(n) { try { if (n && mFn(n, 'disconnect')) n.disconnect(); } catch (e) {} }
  function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function hzc(m, cents) { return 440 * Math.pow(2, (m - 69) / 12 + cents / 1200); }   // MIDI+音分
  function mask(s) { var a = [], i; for (i = 0; i < 16; i++) a.push(s && s.charAt(i) === 'x' ? 1 : 0); return a; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ================= 2. 乐理表 =================
   * 和弦用**音级集合(pitch class)**声明 —— 铺底具体转位由 _voiceLead() 按"最近移动"现算,
   * 相邻和弦共同音保持、内声部级进, 而不是三和弦平行搬移。
   * 低音根 = 36 + 根音级; < 38 时升八度(C2→C3), 落在 ~73~147Hz 的"有肉"区间。
   */
  var SCALES = {
    aeolian: [0, 2, 3, 5, 7, 8, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    major: [0, 2, 4, 5, 7, 9, 11],
    dorian: [0, 2, 3, 5, 7, 9, 10]
  };
  var CHORDS = {
    /* 标准远征 (A 小调) */
    Am: [9, 0, 4], F: [5, 9, 0], C: [0, 4, 7], G: [7, 11, 2], Dm: [2, 5, 9], E: [4, 8, 11],
    /* 商店色彩 (七和弦 ii-V-I) */
    Am7: [9, 0, 4, 7], Dm7: [2, 5, 9, 0], G7: [7, 11, 2, 5], Cmaj7: [0, 4, 7, 11],
    /* 无尽浪潮 (D 弗里吉亚 + 那不勒斯 ♭II) */
    Eb: [3, 7, 10], Bb: [10, 2, 5], Gm: [7, 10, 2], A: [9, 1, 4],
    /* 疾速突袭 (E 小调) */
    Em: [4, 7, 11], B: [11, 3, 6], Cm7: [0, 3, 7, 10], Ebmaj7: [3, 7, 10, 2],
    /* 备战 (G 大调) */
    Em7: [4, 7, 11, 2], Cmaj: [0, 4, 7], D: [2, 6, 9], D7: [2, 6, 9, 0], Bm7: [11, 2, 6, 9]
  };

  /* 段落表: bpm / 调式 / 和声进行 / 鼓型 / 动机集 / 摇摆量 / 性格。
   * prog 每项 = 和弦名(每小节一个; halfBar 段落每半小节一个)。 */
  var SECTIONS = {
    /* ---- 备战(菜单 / 模式 / 选人 / 波间升级): 慢、暖、留白; 无主旋律(层 lead 关闭) ---- */
    prep: {
      key: 'prep', kind: 'prep', label: '备战 · G 大调 I-vi-IV-V',
      bpm: 84, root: 55, scale: 'major', bars: 4, swing: 0,
      prog: ['G', 'Em', 'C', 'D'], drums: 'prep', motif: 'prep'
    },
    standard: {
      label: '标准远征 · A 小调 Aeolian',
      battle: {
        key: 'standard:battle', kind: 'battle', label: '战斗 · Am-F-C-G-Am-F-Dm-E',
        bpm: 120, root: 57, scale: 'aeolian', bars: 8, swing: 0,
        prog: ['Am', 'F', 'C', 'G', 'Am', 'F', 'Dm', 'E'], drums: 'battle', motif: 'minor'
      },
      shop: {
        key: 'standard:shop', kind: 'shop', label: '波末商店 · Am7-Dm7-G7-Cmaj7 (摇摆)',
        bpm: 96, root: 57, scale: 'aeolian', bars: 4, swing: 0.62,
        prog: ['Am7', 'Dm7', 'G7', 'Cmaj7'], drums: 'shop', motif: 'lounge'
      },
      boss: {
        key: 'standard:boss', kind: 'boss', label: '精英 · Am-Bb-Am-E-Am-Bb-Dm-E (♭II 那不勒斯)',
        bpm: 132, root: 57, scale: 'aeolian', bars: 8, swing: 0, bassShift: -12, tension: true,
        prog: ['Am', 'Bb', 'Am', 'E', 'Am', 'Bb', 'Dm', 'E'], drums: 'boss', motif: 'minor'
      }
    },
    endless: {
      label: '无尽浪潮 · D 弗里吉亚',
      battle: {
        key: 'endless:battle', kind: 'battle', label: '战斗 · Dm-Eb-C-Dm-Bb-Gm-A-Eb',
        bpm: 132, root: 62, scale: 'phrygian', bars: 8, swing: 0,
        prog: ['Dm', 'Eb', 'C', 'Dm', 'Bb', 'Gm', 'A', 'Eb'], drums: 'battle', motif: 'phryg'
      },
      shop: {
        key: 'endless:shop', kind: 'shop', label: '波末商店 · Dm7-Ebmaj7-Cm7-Dm7 (摇摆)',
        bpm: 100, root: 62, scale: 'phrygian', bars: 4, swing: 0.62,
        prog: ['Dm7', 'Ebmaj7', 'Cm7', 'Dm7'], drums: 'shop', motif: 'lounge'
      },
      boss: {
        key: 'endless:boss', kind: 'boss', label: '精英 · Dm-Eb-Dm-A-Dm-Eb-Bb-A',
        bpm: 144, root: 62, scale: 'phrygian', bars: 8, swing: 0, bassShift: -12, tension: true,
        prog: ['Dm', 'Eb', 'Dm', 'A', 'Dm', 'Eb', 'Bb', 'A'], drums: 'boss', motif: 'phryg'
      }
    },
    rush: {
      label: '疾速突袭 · E 小调(半小节换和弦)',
      battle: {
        key: 'rush:battle', kind: 'battle', label: '战斗 · Em-C-G-D 半小节',
        bpm: 146, root: 64, scale: 'aeolian', bars: 4, swing: 0, halfBar: true,
        prog: ['Em', 'C', 'G', 'D', 'Em', 'C', 'Am', 'B'], drums: 'rush', motif: 'rush'
      },
      shop: {
        key: 'rush:shop', kind: 'shop', label: '波末商店 · Em7-Am7-D7-G (摇摆)',
        bpm: 104, root: 64, scale: 'aeolian', bars: 4, swing: 0.58,
        prog: ['Em7', 'Am7', 'D7', 'G'], drums: 'shop', motif: 'lounge'
      },
      boss: {
        key: 'rush:boss', kind: 'boss', label: '精英 · Em-F-Em-B-Em-C-Am-B',
        bpm: 158, root: 64, scale: 'aeolian', bars: 8, swing: 0, bassShift: -12, tension: true,
        prog: ['Em', 'F', 'Em', 'B', 'Em', 'C', 'Am', 'B'], drums: 'boss', motif: 'rush'
      }
    }
  };
  /* ================= 3. 鼓组 / 低音型 / 动机细胞 =================
   * 鼓型: 16 步字符串(x = 击), 九个音色 ——
   *   k 踢  s 军鼓  h 闭镲  o 开镲  c 吊镲  w 剁菜板  sh 沙锤  t 嗵鼓  g 锣
   * 按强度档换型(t0 教学 / t1 常态 / t2 怪潮 / t3 精英), 每 4 小节末加 fill。
   * 低音型: 字符 r 根 / 5 五度 / 8 八度 / 3 三音 / 7 七音 / a 半音趋近下一根音。
   */
  var DRUMS = {
    prep: {
      t0: { k: 'x...............', s: '................', h: '....x.......x...', w: '......x.......x.', sh: '.x.x.x.x.x.x.x.x' },
      t1: { k: 'x...............', s: '................', h: '....x.......x...', w: '......x.......x.', sh: '.x.x.x.x.x.x.x.x' },
      t2: { k: 'x.......x.......', s: '................', h: '....x.......x...', w: '..x...x...x...x.', sh: '.x.x.x.x.x.x.x.x' },
      t3: { k: 'x.......x.......', s: '........x.......', h: '....x.......x...', w: '..x...x...x...x.', sh: '.x.x.x.x.x.x.x.x' }
    },
    battle: {
      t0: { k: 'x...............', s: '................', h: '........x.......', w: '..x...x...x...x.' },
      t1: { k: 'x.....x.x.....x.', s: '....x.......x...', h: '..x...x...x...x.', w: '......x.......x.', sh: '..............x.' },
      t2: { k: 'x.....x.x...x.x.', s: '....x.......x...', h: '.x.x.x.x.x.x.x.x', o: '..............x.', w: '..x...x...x...x.', sh: 'x.x.x.x.x.x.x.x.' },
      t3: { k: 'x.........x.....', s: '........x.......', h: '....x.......x...', c: 'x...............', g: 'x...............', t: '..............x.', w: '......x.........' }
    },
    rush: {
      t0: { k: 'x...............', s: '................', h: '....x.......x...', w: '..x...x...x...x.' },
      t1: { k: 'x...x...x...x..x', s: '....x.......x...', h: '..x...x...x...x.', w: '......x.......x.' },
      t2: { k: 'x..xx...x...x..x', s: '....x.......x...', h: '.x.x.x.x.x.x.x.x', o: '..............x.', w: '..x...x...x...x.', sh: 'x.x.x.x.x.x.x.x.' },
      t3: { k: 'x.......x...x...', s: '....x.......x...', h: '..x...x...x...x.', c: 'x...............', g: 'x...............', t: '..............x.' }
    },
    /* 商店: 只走偶数步(摇摆律动由调度器给"后半拍"加 0.667 步延迟), 轻、碎、带沙锤 */
    shop: {
      t0: { k: 'x.......x.......', s: '................', h: '.x.x.x.x.x.x.x.x', w: '....x.......x...', sh: 'x...x...x...x...' },
      t1: { k: 'x.......x.......', s: '....x.......x...', h: '.x.x.x.x.x.x.x.x', o: '..............x.', w: '....x.......x...', sh: '.x.x.x.x.x.x.x.x' },
      t2: { k: 'x.......x.....x.', s: '....x.......x...', h: '.x.x.x.x.x.x.x.x', o: '..............x.', w: '....x.......x...', sh: '.x.x.x.x.x.x.x.x' },
      t3: { k: 'x.......x.....x.', s: '....x...x...x...', h: '.x.x.x.x.x.x.x.x', o: '..............x.', w: '....x.......x...', sh: '.x.x.x.x.x.x.x.x' }
    },
    /* 精英: 半速重击 + 锣 */
    boss: {
      t0: { k: 'x...............', s: '................', h: '........x.......', w: '......x.........' },
      t1: { k: 'x.......x.......', s: '........x.......', h: '....x.......x...', g: 'x...............', w: '......x.........' },
      t2: { k: 'x.....x.x.......', s: '....x...x.......', h: '..x...x...x...x.', g: 'x...............', t: '..............x.' },
      t3: { k: 'x.........x.....', s: '........x.......', h: '....x.......x...', c: 'x...............', g: 'x.......x.......', t: '..............xx' }
    }
  };
  var BASS_LINE = {
    prep: 'r.......5.......',
    battle: ['r.......5.......', 'r.....r.5...r...', 'r.r.5.r.r.8.5.r.', 'r.......r.8.....'],
    rush: ['r.r.5.r.r.8.5.r.', 'r.r.5.r.r.8.5.r.', 'r.r.5.r.5.8.5.r.', 'r.......r.8.....'],
    shop: ['r...3...5...a...', 'r...3...5...a...', 'r...a...3...5...', 'r...3...5...a...'],
    boss: ['r.......r.8.....', 'r.......r.8.....', 'r.....r.r.8.r...', 'r.......r.8.....']
  };
  /* 动机细胞 [步, 音级索引, 时长(步)] —— 索引按当拍和弦音向上数(t%n 换八度),
   * 因此旋律永远落在和弦音上; 加花(orn)填音阶邻音。 */
  var MOTIFS = {
    minor: [
      [[0, 0, 3], [3, 3, 1], [4, 2, 2], [8, 1, 2], [10, 2, 2], [12, 3, 4]],
      [[0, 3, 2], [2, 4, 2], [4, 3, 2], [6, 2, 2], [8, 4, 3], [11, 5, 1], [12, 4, 4]],
      [[0, 2, 4], [4, 4, 4], [8, 5, 3], [11, 4, 1], [12, 2, 4]],
      [[0, 0, 3], [3, 2, 1], [4, 1, 2], [8, 3, 2], [10, 2, 2], [12, 0, 4]]
    ],
    phryg: [
      [[0, 0, 3], [3, 1, 1], [4, 0, 2], [8, 2, 2], [10, 1, 2], [12, 0, 4]],
      [[0, 3, 2], [2, 4, 2], [4, 3, 2], [6, 2, 2], [8, 4, 2], [10, 3, 2], [12, 5, 4]],
      [[0, 2, 4], [4, 4, 4], [8, 5, 3], [11, 4, 1], [12, 2, 4]],
      [[0, 1, 3], [3, 2, 1], [4, 1, 2], [8, 0, 2], [10, 2, 2], [12, 1, 4]]
    ],
    rush: [
      [[0, 0, 2], [2, 1, 2], [4, 2, 2], [6, 1, 2], [8, 3, 2], [10, 2, 2], [12, 1, 2], [14, 0, 2]],
      [[0, 3, 2], [2, 4, 2], [4, 3, 2], [6, 2, 2], [8, 4, 3], [11, 5, 1], [12, 4, 4]],
      [[0, 2, 4], [4, 4, 4], [8, 6, 3], [11, 4, 1], [12, 2, 4]],
      [[0, 0, 2], [2, 2, 2], [4, 1, 2], [6, 0, 2], [8, 3, 2], [10, 2, 2], [12, 0, 4]]
    ],
    /* 商店: 摇摆里的小句子, 留白多(爵士的"少即是多") */
    lounge: [
      [[0, 2, 2], [2, 3, 2], [4, 2, 2], [6, 1, 2], [8, 0, 4], [12, 2, 4]],
      [[0, 4, 2], [2, 3, 2], [4, 2, 2], [6, 1, 2], [8, 2, 2], [10, 3, 2], [12, 4, 4]],
      [[0, 3, 4], [4, 2, 2], [6, 3, 2], [8, 4, 4], [12, 2, 4]],
      [[0, 1, 4], [4, 2, 2], [6, 1, 2], [8, 0, 4], [12, 1, 4]]
    ],
    /* 备战: 音盒式分解和弦(琶音层演奏, 层 lead 保持关闭) */
    prep: [
      [[0, 0, 2], [2, 1, 2], [4, 2, 2], [6, 1, 2], [8, 3, 2], [10, 2, 2], [12, 1, 2], [14, 0, 2]],
      [[0, 3, 2], [2, 2, 2], [4, 1, 2], [6, 0, 2], [8, 1, 2], [10, 2, 2], [12, 3, 4]],
      [[0, 0, 4], [4, 2, 4], [8, 3, 4], [12, 2, 4]],
      [[0, 2, 2], [2, 3, 2], [4, 2, 2], [6, 1, 2], [8, 0, 6], [14, 1, 2]]
    ]
  };
  /* 4 小节乐句计划: A(陈述) → A'(高八度加花) → B(对比) → A''(收束) */
  var PLAN = [0, 1, 2, 3];

  /* ================= 4. 乐理工具 ================= */
  function pcsOf(name) { return CHORDS[name] || CHORDS.Am; }
  function bassRootOf(name) {
    var pc = pcsOf(name)[0], b = 36 + pc;
    if (b < 38) b += 12;                                  // C2/D♭2 → 升八度, 低音不糊
    return b;
  }
  /* 铺底转位: 在和弦音集合里挑一组音, 使其到上一个转位(pre)的总位移最小 —— 声部连接 */
  function voiceLead(pcs, lo, hi, pre) {
    var cands = [], i, k, m, n = pcs.length;
    for (i = 0; i < n; i++) {
      var list = [];
      for (m = lo - 12; m <= hi + 12; m++) if (((m % 12) + 12) % 12 === pcs[i]) list.push(m);
      cands.push(list);
    }
    var pick = [], cost = 0;
    for (i = 0; i < n; i++) pick.push(0);
    for (i = 0; i < n; i++) {                              // 贪心: 逐音挑最接近 (或中间音区) 的音高
      var cl = cands[i], bt = cl[0], bc = 1e9;
      for (k = 0; k < cl.length; k++) {
        var tgt = pre && pre[i] !== undefined ? pre[i] : (lo + hi) / 2 + i * 2;
        var c2 = Math.abs(cl[k] - tgt) + Math.abs(cl[k] - (lo + hi) / 2) * 0.18;
        if (c2 < bc) { bc = c2; bt = cl[k]; }
      }
      pick[i] = bt; cost += bc;
    }
    /* 去重(不同音级可能落到同音高) 并排序, 至少 3 音 */
    pick.sort(function (a, b) { return a - b; });
    var out = [];
    for (i = 0; i < pick.length; i++) if (i === 0 || pick[i] !== pick[i - 1]) out.push(pick[i]);
    while (out.length < 3) out.push(out[out.length - 1] + 12);
    return { notes: out, cost: cost };
  }
  /* 音级索引 → MIDI: idx 按和弦音向上数(t%n 换八度); 再按需吸附到音阶 */
  function toneToMidi(tones, idx) {
    var n = tones.length;
    return tones[idx % n] + 12 * Math.floor(idx / n);
  }
  function scaleToMidi(root, scale, deg) {
    var n = scale.length;
    return root + 12 * Math.floor(deg / n) + scale[((deg % n) + n) % n];
  }
  /* ================= 5. 引擎 ================= */
  PS.Music = {
    /* --- 音频图 --- */
    _ctx: null, _bus: null, _duck: null, _filter: null, _compNode: null, _clip: null,
    _parent: null, _tail: null, _nz: null, _merger: null, _busL: null, _busR: null,
    _lay: {}, _layL: {}, _layR: {},
    _bed: null, _bedG: null, _nodes: [],
    /* --- 声部池 --- */
    _np: [], _tp: [], _zp: [],
    /* --- 状态 --- */
    _ok: false, _enabled: true, _paused: false, _visBound: false, _tries: 0,
    _lastErr: null, _warned: false,
    _song: null, _name: 'none', _want: 'none', _req: 'none', _pending: null, _auto: true,
    _step: 0, _bar: 0, _barSeq: 0, _plan: null, nextT: null, _motif: null, _mPrev: 0,
    _intensity: DEF_INTENSITY, _intS: DEF_INTENSITY, _seed: 1,
    _layOn: { perc: 0, bass: 0, pad: 0, arp: 0, lead: 0, fx: 0 },
    _layWant: { perc: 0, bass: 0, pad: 0, arp: 0, lead: 0, fx: 0 },
    _chordPre: null,
    _drumsLvl: 1, _tutorial: false, _horde: false, _dying: false, _tension: false, _bedWant: false,
    _evtDuck: 0, _duckV: 1, _hpDuck: false,

    get enabled() { return !!this._enabled; },
    get track() { return this._name; },

    /* ---------- 初始化: 只复用传入/PS.Sound 的 ctx, 绝不新建 AudioContext ---------- */
    init: function (audioCtxOrNull) {
      if (this._ok) return true;
      try {
        var c = audioCtxOrNull || (PS.Sound && PS.Sound.ctx) || null;
        if (!c || !mFn(c, 'createGain')) { this._ok = false; return false; }
        this._teardown();
        this._ctx = c;
        this._seed = ((Math.random() * 0x7fffffff) | 0) || 1;
        this._nz = this._makeNoise(c);
        var i, self = this;
        /* 立体声汇流: 层 L/R → 总线L/R → [合并] → 淡入淡出 → 侧链 → 低通 → 压缩 → 软限幅 → 父节点 */
        this._busL = this._mk(c, c.createGain()); this._busR = this._mk(c, c.createGain());
        this._busL.gain.value = 1; this._busR.gain.value = 1;
        this._bus = this._mk(c, c.createGain()); this._bus.gain.value = 0.0001;
        if (mFn(c, 'createChannelMerger')) {
          try {
            this._merger = c.createChannelMerger(2);
            this._busL.connect(this._merger, 0, 0); this._busR.connect(this._merger, 0, 1);
            this._merger.connect(this._bus);
          } catch (e0) { this._merger = null; }
        }
        if (!this._merger) { this._busL.connect(this._bus); this._busR.connect(this._bus); }
        this._duck = this._mk(c, c.createGain()); this._duck.gain.value = 1;
        this._bus.connect(this._duck);
        var chain = this._duck;
        if (mFn(c, 'createBiquadFilter')) {                    // 强度 → 总线亮度(暗→亮)
          this._filter = this._mk(c, c.createBiquadFilter());
          try { this._filter.type = 'lowpass'; } catch (e1) {}
          try { if (this._filter.Q) this._filter.Q.value = 0.7; } catch (e2) {}
          this._filter.frequency.value = FILT_LO;
          chain.connect(this._filter); chain = this._filter;
        }
        if (mFn(c, 'createDynamicsCompressor')) {              // 音乐软限幅: 密集 16 分不削波
          try {
            this._compNode = c.createDynamicsCompressor();
            this._compNode.threshold.value = -14; this._compNode.knee.value = 6; this._compNode.ratio.value = 4;
            this._compNode.attack.value = 0.004; this._compNode.release.value = 0.14;
            chain.connect(this._compNode); chain = this._compNode;
          } catch (e3) { this._compNode = null; }
        }
        if (mFn(c, 'createWaveShaper')) {                      // 软限幅尾部: 峰值天花板写死
          try {
            var ws = this._mk(c, c.createWaveShaper());
            ws.curve = this._softCurve(0.84, 0.62);
            try { ws.oversample = '4x'; } catch (e4) {}
            chain.connect(ws); chain = ws; this._clip = ws;
          } catch (e5) { this._clip = null; }
        }
        var parent = (PS.Sound && PS.Sound.master) || c.destination;
        chain.connect(parent);
        this._tail = chain; this._parent = parent;
        /* 六个编曲层: 各一对 L/R 增益(声像由音符槽分配到 L/R, 因此立体声宽度是"演奏出来的") */
        this._lay = {}; this._layL = {}; this._layR = {};
        for (i = 0; i < LAYERS.length; i++) {
          var nm = LAYERS[i], gL = this._mk(c, c.createGain()), gR = this._mk(c, c.createGain());
          gL.gain.value = 0.0001; gR.gain.value = 0.0001;
          gL.connect(this._busL); gR.connect(this._busR);
          this._layL[nm] = gL; this._layR[nm] = gR; this._lay[nm] = { L: gL, R: gR };
        }
        this._buildVoices(c);
        this._resetRun();
        this._bindVisibility();
        this._hookSound();
        this._ok = true;
        this.resume();
        /* localStorage / wx 静音开关(键与音效独立; 读不到也绝不抛) */
        try {
          if (PS.SoundVeg && PS.SoundVeg.musicMuted && PS.SoundVeg.musicMuted()) {
            this._enabled = false;
            this._applyGain(0.0001, 0.02);
          }
        } catch (e6) {}
        if (this._want && this._want !== 'none') {
          this._name = this._want;
          this._pending = { name: this._want, at: (c.currentTime || 0) + 0.05 };
        }
        return true;
      } catch (e) { this._fail(e); return false; }
    },

    /* 一次运行期的状态复位(init 后 / 换曲前): 池与图不动, 只清时间轴与层 */
    _resetRun: function () {
      this._song = null; this._pending = null; this._plan = null; this._motif = null;
      this._step = 0; this._bar = 0; this._barSeq = 0; this._mPrev = 0; this.nextT = null;
      this._layOn = { perc: 0, bass: 0, pad: 0, arp: 0, lead: 0, fx: 0 };
      this._chordPre = null;
    },

    _mk: function (c, n) { try { this._nodes.push(n); } catch (e) {} return n; },

    /* 拆旧图(离线渲染反复 init / 微信端换 ctx 自愈): 源节点 stop + 全部 disconnect, 不抛 */
    _teardown: function () {
      var i, n;
      try {
        for (i = 0; i < this._nodes.length; i++) { n = this._nodes[i]; mStop(n); mDisc(n); }
      } catch (e) {}
      this._nodes = []; this._np = []; this._tp = []; this._zp = [];
      this._ctx = null; this._bus = null; this._duck = null; this._filter = null; this._compNode = null;
      this._clip = null; this._tail = null; this._parent = null; this._merger = null;
      this._busL = null; this._busR = null; this._bed = null; this._bedG = null;
      this._lay = {}; this._layL = {}; this._layR = {};
      this._song = null; this._pending = null; this._plan = null; this._motif = null;
      this.nextT = null; this._step = 0; this._bar = 0; this._barSeq = 0;
      this._layOn = { perc: 0, bass: 0, pad: 0, arp: 0, lead: 0, fx: 0 };
      this._chordPre = null;
    },

    /* 1s 循环白噪声(所有噪声声部共用一个 buffer; 逐发靠 playbackRate/滤波/增益随机化区分) */
    _makeNoise: function (c) {
      try {
        if (!mFn(c, 'createBuffer')) return null;
        var len = Math.max(1, (1.0 * c.sampleRate) | 0), b = c.createBuffer(1, len, c.sampleRate);
        var d = b.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        return b;
      } catch (e) { return null; }
    },

    /* 软限幅曲线: |x| ≤ T 段透明, 之上按 tanh 压向天花板 C(输出恒 < C, 峰值是数学保证) */
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

    /* 声部池: 音符槽 = 3 振荡器 + 各自包络 + 1 滤波 + 声像对; 打击槽 = 音体(振荡器) 与 噪声各一 */
    _buildVoices: function (c) {
      var i, j, self = this;
      function panPair(dstL, dstR) {
        var pl = self._mk(c, c.createGain()), pr = self._mk(c, c.createGain());
        pl.gain.value = 0.707; pr.gain.value = 0.707;
        pl.connect(dstL); pr.connect(dstR);
        return [pl, pr];
      }
      for (i = 0; i < NOTE_SLOTS; i++) {
        var f = this._mk(c, c.createBiquadFilter()), out = this._mk(c, c.createGain()), o = [], g = [];
        try { f.type = 'lowpass'; } catch (e0) {}
        f.frequency.value = 1600;
        try { if (f.Q) f.Q.value = 0.8; } catch (e1) {}
        out.gain.value = 1;
        f.connect(out);
        var pp = panPair(this._layL.bass, this._layR.bass);
        out.connect(pp[0]); out.connect(pp[1]);
        for (j = 0; j < 3; j++) {
          var os = this._mk(c, c.createOscillator()), gs = this._mk(c, c.createGain());
          try { os.type = 'triangle'; } catch (e2) {}
          os.frequency.value = 220; gs.gain.value = 0.0001;
          os.connect(gs); gs.connect(f);
          try { os.start(0); } catch (e3) {}
          o.push(os); g.push(gs);
        }
        this._np.push({ o: o, g: g, f: f, out: out, pl: pp[0], pr: pp[1], freeAt: 0, _layer: 'bass' });
      }
      for (i = 0; i < TONE_SLOTS; i++) {
        var to = this._mk(c, c.createOscillator()), tg = this._mk(c, c.createGain());
        try { to.type = 'sine'; } catch (e4) {}
        to.frequency.value = 120; tg.gain.value = 0.0001;
        to.connect(tg);
        var pt = panPair(this._layL.perc, this._layR.perc);
        tg.connect(pt[0]); tg.connect(pt[1]);
        try { to.start(0); } catch (e5) {}
        this._tp.push({ o: to, g: tg, pl: pt[0], pr: pt[1], freeAt: 0 });
      }
      for (i = 0; i < NOISE_SLOTS; i++) {
        var nf = this._mk(c, c.createBiquadFilter()), ng = this._mk(c, c.createGain());
        try { nf.type = 'highpass'; } catch (e6) {}
        nf.frequency.value = 6000;
        try { if (nf.Q) nf.Q.value = 0.9; } catch (e7) {}
        ng.gain.value = 0.0001;
        nf.connect(ng);
        var pn = panPair(this._layL.perc, this._layR.perc);
        ng.connect(pn[0]); ng.connect(pn[1]);
        var src = null;
        if (this._nz && mFn(c, 'createBufferSource')) {
          try {
            src = this._mk(c, c.createBufferSource());
            src.buffer = this._nz; src.loop = true;
            src.connect(nf);
            try { src.start(0); } catch (e8) {}
          } catch (e9) { src = null; }
        }
        this._zp.push({ b: src, f: nf, g: ng, pl: pn[0], pr: pn[1], freeAt: 0 });
      }
      /* 油锅嘶声床: 常驻低电平带通噪声(战斗/怪潮抬起) —— 厨房身份 */
      if (this._nz && mFn(c, 'createBufferSource')) {
        try {
          var bs = this._mk(c, c.createBufferSource()), bf = this._mk(c, c.createBiquadFilter()), bg = this._mk(c, c.createGain());
          bs.buffer = this._nz; bs.loop = true;
          try { bf.type = 'bandpass'; } catch (e10) {}
          bf.frequency.value = 2600;
          try { if (bf.Q) bf.Q.value = 0.8; } catch (e11) {}
          bg.gain.value = 0.0001;
          bs.connect(bf); bf.connect(bg); bg.connect(this._busL); bg.connect(this._busR);
          bs.start(0);
          this._bed = bs; this._bedG = bg;
        } catch (e12) { this._bed = null; }
      }
      return this._np.length + this._tp.length + this._zp.length;
    },

    /* 音符槽挂到所属层的 L/R 增益(层开关/换层才有效) */
    _route: function (slot, layer) {
      if (slot._layer === layer || !this._layL[layer]) return true;
      try {
        mDisc(slot.pl); mDisc(slot.pr);
        slot.pl.connect(this._layL[layer]); slot.pr.connect(this._layR[layer]);
        slot._layer = layer;
        return true;
      } catch (e) { return false; }
    },

    /* 侧链回调: 音效大事件 → 音乐让位(PS.Sound.onEvent 只有一个订阅者, 由音乐占用) */
    _hookSound: function () {
      var self = this;
      if (!PS.Sound || PS.Sound._musicTap) return;
      PS.Sound._musicTap = true;
      PS.Sound.onEvent = function (n) {
        if (n === 'hurt' || n === 'boss' || n === 'win' || n === 'lose' || n === 'horde' || n === 'crit') self._evtDuck = 1;
      };
    },

    resume: function () {
      try { if (this._ctx && this._ctx.state === 'suspended' && this._ctx.resume) this._ctx.resume(); } catch (e) {}
      return this;
    },

    /* ---------- 换曲: 0.13s 淡出 → 复位到第 0 步 → 0.35s 淡入; 同名重复调用不重启 ---------- */
    setTrack: function (name) {
      try {
        if (name !== 'menu' && name !== 'battle' && name !== 'boss' && name !== 'none' && name !== 'shop' && name !== 'prep') return false;
        this._want = name; this._req = name;
        if (!this._ok) return false;
        return this._switchTo(this._autoTrack(), 0.13, 0.35);
      } catch (e) { return false; }
    },
    /* 真实切换(内部): 淡出 → 排一个挂起项, 到点换曲/复位/淡入 */
    _switchTo: function (name, out, inn) {
      if (!this._ok) return false;
      if (name === this._name) return false;
      var c = this._ctx;
      this._applyGain(0.0001, out || 0.12);
      this._name = name;
      this._pending = { name: name, at: (c && c.currentTime ? c.currentTime : 0) + (out || 0.12), fade: inn || 0.35 };
      return true;
    },

    /* ---------- 强度 0..1(血量/波次/Boss 驱动): 平滑后映射到亮度/层次/鼓型/BPM ---------- */
    setIntensity: function (v) {
      try {
        v = Number(v);
        if (!isFinite(v)) return this._intensity;
        this._intensity = v < 0 ? 0 : (v > 1 ? 1 : v);
      } catch (e) {}
      return this._intensity;
    },

    /* ---------- 开关(与 PS.Sound.enabled 完全独立) ---------- */
    toggle: function () {
      this._enabled = !this._enabled;
      try {
        if (this._ok) { this._applyGain(this._enabled ? this._busTarget() : 0.0001, 0.06); this.nextT = null; }
      } catch (e) {}
      try { if (PS.SoundVeg && PS.SoundVeg.setMusicMuted) PS.SoundVeg.setMusicMuted(!this._enabled); } catch (e2) {}
      return this._enabled;
    },

    voices: function () {
      var now = this._now(), n = 0, i;
      for (i = 0; i < this._np.length; i++) if (this._np[i].freeAt > now) n++;
      for (i = 0; i < this._tp.length; i++) if (this._tp[i].freeAt > now) n++;
      for (i = 0; i < this._zp.length; i++) if (this._zp[i].freeAt > now) n++;
      return n;
    },
    state: function () {
      var L = {};
      for (var i = 0; i < LAYERS.length; i++) L[LAYERS[i]] = !!this._layOn[LAYERS[i]];
      return {
        track: this._name, song: this._song ? this._song.key : null, mode: this._song ? this._song.label : null,
        bpm: this._song ? Math.round(this._bpm()) : 0, intensity: this._intensity, intS: this._intS,
        layers: L, tier: this._drumsLvl, voices: this.voices(), max: MAX_VOICES,
        cut: Math.round(this._cutoff()), swing: this._song ? this._song.swing || 0 : 0
      };
    },
    /* ---------- 主循环驱动: 前瞻调度(每帧排未来 LOOKAHEAD 秒的音符) ---------- */
    update: function (dt) {
      try {
        if (!this._ok) { this._ensure(); if (!this._ok) return; }
        var c = this._ctx;
        if (!c) { this._ok = false; return; }
        if (c.state !== 'running') { this.nextT = null; return; }   // 未解锁/被挂起: 不调度, 复位时间轴
        if (typeof dt !== 'number' || !isFinite(dt) || dt < 0) dt = 1 / 60;
        if (dt > 0.25) dt = 0.25;
        var now = c.currentTime;

        this._syncParent();
        this._intS += (this._intensity - this._intS) * (1 - Math.exp(-dt * 3.0));
        this._tier();
        this._applyFilter(this._cutoff());
        this._duckTick(dt);

        /* 换曲挂起项到点执行(不用 setTimeout) */
        if (this._pending && now >= this._pending.at) {
          var fade = this._pending.fade || 0.35;
          this._song = this._resolve(this._pending.name);
          this._name = this._pending.name;
          this._pending = null;
          this._step = 0; this._bar = 0; this._barSeq = 0; this._mPrev = 0; this._plan = null;
          this._layOn = { perc: 0, bass: 0, pad: 0, arp: 0, lead: 0, fx: 0 };
          this._chordPre = null;
          this._tier();
          this._commitLayers(now, true);
          this.nextT = now + 0.05;
          this._applyGain(this._busTarget(), fade);
          if (this._bedG) mLin(this._bedG.gain, 0.0001, now + 0.1);
        }
        /* 段落随游戏状态自适应(商店/波间升级/菜单) —— 显式 setTrack 的曲种仍是主口径 */
        var auto = this._autoTrack();
        if (auto !== this._name && auto !== 'none') this._switchTo(auto, 0.30, 0.45);
        if (this._paused || !this._enabled || !this._song) return;

        if (this.nextT === null) { this.nextT = now + 0.06; return; }    // 复位: 重新对齐
        if (this.nextT < now) this.nextT = now + 0.02;                   // 失焦/卡顿后不补发积压音符

        var guard = 0;
        while (this.nextT < now + LOOKAHEAD && guard < MAX_STEPS) {
          if (this._step === 0) { this._planBar(); this._commitLayers(this.nextT, false); }
          this._emit(this._step, this.nextT);
          this.nextT += this._stepDur();
          this._step++;
          if (this._step >= 16) {
            this._step = 0;
            this._bar = (this._bar + 1) % (this._song.bars || 4);
          }
          guard++;
        }
      } catch (e) { this._fail(e); }
    },

    /* ================= 调度内部 ================= */
    _now: function () { var c = this._ctx; return c ? (c.currentTime || 0) : 0; },
    _ensure: function () {
      if (this._ok) return true;
      if (this._tries > 0) { this._tries--; return false; }
      this._tries = 90;                       // 每 90 帧才重试一次懒初始化
      return this.init(null);
    },
    _fail: function (e) {                       // 任何音频异常 → 降级为 no-op, 绝不让游戏崩
      var msg = e ? String((e && e.message) || e) : null;
      if (msg) this._lastErr = msg;
      if (!this._warned && typeof console !== 'undefined' && console.warn) {
        this._warned = true;
        console.warn('[PS.Music] 音频异常, 已降级为静默:', this._lastErr || '(未知)');
      }
      this._ok = false; this._song = null; this.nextT = null;
    },
    _syncParent: function () {                  // PS.Sound.master 晚于我们初始化时, 补挂父节点
      var p = PS.Sound && PS.Sound.master;
      if (!this._tail || !p || p === this._parent) return;
      try {
        mDisc(this._tail);
        this._tail.connect(p);
        this._parent = p;
      } catch (e) {}
    },

    /* ---------- 曲目解析: 曲种(prep/battle/shop/boss) × 模式(PS.Game.mode) ---------- */
    _resolve: function (name) {
      if (name === 'none') return null;
      if (name === 'menu' || name === 'prep') return SECTIONS.prep;
      var G = PS.Game, mode = 'standard', i;
      if (G && typeof G.mode === 'string' && SECTIONS[G.mode] && G.mode !== 'prep') mode = G.mode;
      var fam = SECTIONS[mode] || SECTIONS.standard;
      var kind = (name === 'boss' || name === 'shop') ? name : 'battle';
      return fam[kind] || fam.battle;
    },
    /* 段落自适应: 商店/升级/菜单这些"低强度态"由游戏状态决定(平台层只切 battle/boss) */
    _autoTrack: function () {
      if (!this._auto) return this._req;
      var n = this._req;
      if (n === 'none') return n;
      var G = PS.Game, st = (G && typeof G.state === 'string') ? G.state : '';
      if (st === 'shop') return 'shop';
      if (st === 'levelup' || st === 'menu' || st === 'mode' || st === 'char' || st === 'over') return 'menu';
      return (n === 'menu' || n === 'prep') ? 'menu' : n;
    },

    /* ---------- 强度分层(教学/常态/怪潮/精英/濒死) —— 只读游戏状态 ---------- */
    _tier: function () {
      var G = PS.Game || null, s = this._intS;
      var wave = (G && typeof G.wave === 'number') ? G.wave : 0;
      var hpR = 1;
      if (G && G.player && G.stats && G.stats.maxHp > 0) hpR = clamp(G.player.hp / G.stats.maxHp, 0, 1);
      var battle = (this._name === 'battle');
      /* 教学档带滞回(0.32 进 / 0.40 出), 避免强度在阈值附近抖动导致层反复开关 */
      if (this._tutorial) this._tutorial = battle && wave <= 1 && s < TUT_OUT;
      else this._tutorial = battle && wave <= 1 && s < TUT_IN;
      this._dying = s >= DYING_S || hpR < 0.25;
      var boss = (this._name === 'boss') || !!(G && G.eliteAlive);
      this._horde = !!(G && G.horde) || s >= HORDE_S;
      this._hpDuck = hpR < 0.25;
      this._drumsLvl = this._tutorial ? 0 : (boss ? 3 : (this._horde ? 2 : 1));
      this._tension = boss || (this._song && this._song.tension) || false;
      this._bedWant = (this._name !== 'menu' && this._name !== 'none') && (this._horde || boss || this._dying);
      /* 编曲层: 备战段不用主旋律层(旋律交给琶音层的音盒音色) */
      var prep = (this._song && this._song.kind === 'prep') || this._name === 'menu';
      var none = (this._name === 'none' || !this._song);
      this._layWant = {
        perc: none ? 0 : 1,
        bass: none ? 0 : 1,
        pad: none ? 0 : 1,
        arp: none ? 0 : 1,
        lead: (none || prep || this._tutorial) ? 0 : 1,
        fx: (none || prep) ? 0 : 1
      };
      /* 减层立即淡出(不必等小节线) */
      for (var k in this._layWant) {
        if (!this._layWant[k] && this._layOn[k]) {
          this._layOn[k] = 0;
          this._applyLayer(k, 0.0001, LAYER_DOWN);
        }
      }
    },

    /* 加层在小节线渐入(1.0s) —— 音乐"只增不减"的升级感, 且绝不硬切 */
    _commitLayers: function (t, force) {
      for (var k in this._layWant) {
        if (this._layWant[k] && !this._layOn[k]) {
          this._layOn[k] = 1;
          this._applyLayer(k, MIX[k] || 1, force ? 0.5 : LAYER_UP, t);
        }
      }
      if (this._bedG) mLin(this._bedG.gain, this._bedWant ? BED_LVL : 0.0001, t + 0.8);
    },
    _applyLayer: function (name, target, ramp, t) {
      var g = this._lay[name];
      if (!g) return;
      try {
        var at = (t === undefined) ? this._now() : t, v = Math.max(0.0001, target);
        var nodes = [g.L, g.R], i, p;
        for (i = 0; i < nodes.length; i++) {
          p = nodes[i].gain;
          mCan(p, at);
          mSet(p, Math.max(0.0001, p.value === undefined ? 0.0001 : p.value), at);
          mLin(p, v, at + (ramp || 0.6));
        }
      } catch (e) {}
    },
    _applyGain: function (target, ramp) {
      try {
        var t = this._now(), g = this._bus.gain;
        mCan(g, t);
        mSet(g, Math.max(0.0001, g.value === undefined ? 0.0001 : g.value), t);
        mLin(g, Math.max(0.0001, target), t + (ramp || 0.12));
      } catch (e) {}
    },
    _applyFilter: function (cut) {
      if (!this._filter) return;
      try {
        var t = this._now(), p = this._filter.frequency;
        mCan(p, t);
        mSet(p, cut, t);
      } catch (e) {}
    },
    /* 侧链: 音效密度 + 大事件(hurt/boss/win/lose/horde) + 濒死常驻让位 */
    _duckTick: function (dt) {
      var t = 1, dens = 0;
      if (PS.Sound && PS.Sound.densityNow) { try { dens = PS.Sound.densityNow(); } catch (e) {} }
      if (dens > 0.6) t *= 0.79;                                   // -2.0dB
      if (this._hpDuck) t *= 0.845;                                // -1.5dB 常驻
      if (this._evtDuck > 0) {
        this._evtDuck = Math.max(0, this._evtDuck - dt / 0.25);
        t *= (1 - 0.35 * this._evtDuck);                           // 峰值 -3.5dB, 250ms 恢复
      }
      if (Math.abs(t - this._duckV) > 0.004) {
        this._duckV = t;
        try {
          var p = this._duck.gain, now = this._now();
          mCan(p, now);
          mLin(p, t, now + 0.06);
        } catch (e2) {}
      }
    },
    _bpm: function () { return (this._song ? this._song.bpm : 100) * (RATE_MIN + (RATE_MAX - RATE_MIN) * this._intS); },
    _stepDur: function () { return 60 / this._bpm() / 4; },                    // 16 分音符时长(s)
    _cutoff: function () { return FILT_LO * Math.pow(FILT_HI / FILT_LO, this._intS); },
    _busTarget: function () { return this._song ? BUS_BASE : 0.0001; },
    /* 摇摆: 每拍后半拍推迟 swing×2/3 步(2:1 摇摆) —— 商店段落的"人味" */
    _swingOff: function (i, sd) {
      var S = this._song;
      if (!S || !S.swing) return 0;
      return (i % 4 === 2) ? S.swing * 0.667 * sd : 0;
    },

    /* ---------- 逐小节计划: 和声 / 鼓型 / 低音 / 动机 / 琶音 ---------- */
    _rng: function (seq) {
      var seed = ((this._seed || 1) + seq * 7919) >>> 0;
      if (PS.util && PS.util.makeRng) return PS.util.makeRng(seed);
      var a = seed >>> 0;
      return function () {
        a = (a + 0x6D2B79F5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    _planBar: function () {
      var S = this._song;
      if (!S) return;
      var rng = this._rng(this._barSeq), i, h, bar = this._bar, sd = this._stepDur();
      var halves = S.halfBar ? 2 : 1, names = [], tones = [];
      for (i = 0; i < halves; i++) {
        var cname = S.prog[(bar * halves + i) % S.prog.length];
        names.push(cname);
        tones.push(voiceLead(pcsOf(cname), S.root - 2, S.root + 14, this._chordPre).notes);
      }
      if (tones.length) this._chordPre = tones[tones.length - 1];
      var fam = DRUMS[S.drums] || DRUMS.battle;
      var dl = fam['t' + clamp(this._drumsLvl, 0, 3)] || fam.t1;
      var P = {
        names: names, tones: tones,
        kick: mask(dl.k), snare: mask(dl.s), hat: mask(dl.h), open: mask(dl.o || ''),
        crash: mask(dl.c || ''), wood: mask(dl.w || ''), shaker: mask(dl.sh || ''),
        tom: mask(dl.t || ''), gong: mask(dl.g || ''), bass: {}, mel: {}, melOct: {},
        padAt: {}, tens: {}, arp: {}, arpKind: null
      };
      /* 吊镲只在 4 小节循环的第 1 小节; 锣在精英段每 2 小节一次 */
      if (bar % 4 !== 0) P.crash[0] = 0;
      if (bar % 2 !== 0) P.gong[0] = 0;
      /* fill: 每 4 小节末拍加花(嗵鼓 + 军鼓滚), 档位越高越密 */
      if (bar % 4 === 3 && this._drumsLvl >= 1) {
        if (this._drumsLvl >= 2) { P.tom[13] = 1; P.snare[15] = 1; P.tom[15] = 1; }
        else { P.tom[14] = 1; }
        if (rng() < 0.5) P.tom[11] = 1;
      }
      /* 低音线: 段落低音型 × 档位/小节变化; 字符 → 半音/和弦音/半音趋近 */
      var lineSrc = BASS_LINE[S.drums] || BASS_LINE.battle;
      var line = (typeof lineSrc === 'string') ? lineSrc : lineSrc[Math.min(lineSrc.length - 1, (S.drums === 'shop') ? (bar % lineSrc.length) : this._drumsLvl)];
      var nextName = S.prog[((bar + 1) * halves) % S.prog.length];
      for (i = 0; i < 16; i++) {
        var ch = line.charAt(i);
        if (!ch || ch === '.') continue;
        var hf = (S.halfBar && i >= 8) ? 1 : 0, cn = names[hf], pcs = pcsOf(cn), base = bassRootOf(cn);
        var mm = null, third = ((pcs[1] - pcs[0]) % 12 + 12) % 12;
        if (ch === 'r') mm = base;
        else if (ch === '5') mm = base + 7;
        else if (ch === '8') mm = base + 12;
        else if (ch === '3') mm = base + (third || 3);
        else if (ch === '7') mm = base + (pcs.length > 3 ? (((pcs[3] - pcs[0]) % 12 + 12) % 12) : 10);
        else if (ch === 'a') {
          var nb = bassRootOf(nextName), ap = nb - 1;
          mm = (ap === base) ? nb + 1 : ap;                 // 半音从下方趋近下一根音
        }
        if (mm === null) continue;
        if (S.bassShift) mm += S.bassShift;
        P.bass[i] = clamp(mm, 26, 60);
      }
      /* 主旋律: 4 小节乐句 [A, A', B, A''] —— 细胞 + 变奏(高八度/加花/收束) */
      var cells = MOTIFS[S.motif] || MOTIFS.minor;
      var idx = PLAN[bar % PLAN.length], cell = cells[idx % cells.length], j;
      if (!cell) cell = cells[0];
      var octLift = (idx === 1) ? 1 : 0;                  // A': 高八度陈述
      var orn = (idx === 1 || idx === 2) ? 0.45 : 0.2;    // 加花概率
      for (j = 0; j < cell.length; j++) {
        var e = cell[j], st = e[0], tone = e[1], len = e[2];
        if (idx === 3 && j === cell.length - 1) { len = Math.max(len, 6); tone = 2; }   // 收束: 拖长落在和弦音
        P.mel[st] = tone; P.melOct[st] = octLift;
        if (rng() < orn && st > 0) P.mel[st - 1] = tone + 1;                            // 倚音/邻音(短)
      }
      for (h = 0; h < halves; h++) P.padAt[h * 8] = 1;
      if (this._tension) { P.tens[4] = 1; P.tens[12] = 1; }   // 精英: ♭5 张力刺音
      /* 琶音层内容: 备战=音盒旋律 / 商店=后半拍铺和声(comp) / 战斗=八度分解微光 */
      if (S.kind === 'prep') P.arpKind = 'mel';
      else if (S.kind === 'shop') {
        P.arpKind = 'comp';
        var comp = [2, 6, 10, 14];
        for (j = 0; j < comp.length; j++) if (rng() < 0.72) P.arp[comp[j]] = 1;
      } else {
        P.arpKind = 'broken';
        if (this._drumsLvl >= 1) for (j = 0; j < 16; j += 2) P.arp[j] = 1;
      }
      this._plan = P;
      this._barSeq++;
    },
    /* ---------- 单步发声 ---------- */
    _emit: function (i, t) {
      var S = this._song, P = this._plan, sd = this._stepDur();
      if (!S || !P) return;
      var half = (S.halfBar && i >= 8) ? 1 : 0, lvl = this._drumsLvl;
      var tt = t + this._swingOff(i, sd);
      if (this._layOn.perc) {
        if (P.kick[i]) this._kick(tt, lvl >= 3 ? 0.50 : (lvl >= 2 ? 0.44 : 0.38));
        if (P.snare[i]) this._snare(tt, lvl >= 3 ? 0.21 : 0.17);
        if (P.hat[i]) this._hat(tt, (i & 2) ? 0.040 : 0.052, sd, (i & 2) ? -0.24 : 0.24);
        if (P.open[i]) this._open(tt, 0.075);
        if (P.crash[i]) this._crash(tt, 0.13);
        if (P.wood[i]) this._wood(tt, 0.15);
        if (P.shaker[i]) this._shaker(tt, (i & 2) ? 0.050 : 0.034);
        if (P.tom[i]) this._tom(tt, 0.20);
        if (P.gong[i]) this._gong(tt, 0.15);
      }
      if (this._layOn.bass && P.bass[i] !== undefined) this._bass(tt, P.bass[i], sd);
      if (this._layOn.pad && P.padAt[i]) this._pad(tt, P.tones[half], sd * (S.halfBar ? 8 : 16));
      if (P.mel[i] !== undefined) {
        var midi = toneToMidi(P.tones[half], P.mel[i]) + (P.melOct[i] ? 12 : 0);
        midi = clamp(midi, S.root + 12, S.root + 33);
        if (S.kind === 'prep') { if (this._layOn.arp) this._arpMel(tt, midi, sd, i); }
        else if (this._layOn.lead) this._lead(tt, midi, sd, 1, 0);
      }
      if (this._layOn.arp && P.arp[i]) {
        if (P.arpKind === 'comp') this._comp(tt, P.tones[half], sd);
        else this._arpBroken(tt, P.tones[half], sd, i);
      }
      if (this._layOn.fx && this._tension && P.tens[i]) this._stab(tt, S.root + 6, sd);
    },

    /* ---------- 声部取用(池内复用, 运行时零分配; 池满即丢这一个音符, 不抢占 → 无截断爆音) ---------- */
    _pickSlot: function (pool, t) {
      for (var i = 0, n = pool.length; i < n; i++) if (pool[i].freeAt <= t) return pool[i];
      return null;
    },
    /* 声像(等功率): 每个打击/音符槽都有 L/R 一对增益 —— 立体声宽度来自演奏而不是后处理 */
    _pan: function (slot, p, t, ramp) {
      p = clamp(p, -1, 1);
      var a = (p + 1) * Math.PI / 4, ga = Math.cos(a), gb = Math.sin(a);
      mLin(slot.pl.gain, Math.max(0.0001, ga), t + (ramp || 0));
      mLin(slot.pr.gain, Math.max(0.0001, gb), t + (ramp || 0));
    },
    /* 音符槽滤波器扫频 */
    _flt: function (s, t, a, b, q, dur) {
      if (!s.f) return;
      try { s.f.type = 'lowpass'; } catch (e) {}
      try { if (s.f.Q) s.f.Q.value = q; } catch (e1) {}
      mSet(s.f.frequency, a, t);
      if (b !== a) mExp(s.f.frequency, b, t + dur);
    },
    /* 音符槽的单振荡器发声: 音高/滑音 + ADSR(释放到 0.0001, 绝不落到 0) */
    _osc: function (s, idx, t, c) {
      var o = s.o[idx], g = s.g[idx];
      if (!o || !g) return;
      var a = (c.a === undefined ? 6 : c.a) / 1000, d = (c.d === undefined ? 120 : c.d) / 1000;
      var sus = c.s === undefined ? 0.4 : c.s, r = (c.r === undefined ? 100 : c.r) / 1000;
      var dur = (c.dur === undefined ? 200 : c.dur) / 1000, end = t + dur + r;
      var vol = Math.max(0, c.vol === undefined ? 0.1 : c.vol);
      if (c.w) { try { o.type = c.w; } catch (e) {} }
      if (c.slide) { mSet(o.frequency, Math.max(20, c.f * c.slide), t); mExp(o.frequency, Math.max(20, c.f), t + 0.022); }
      else mSet(o.frequency, Math.max(20, c.f), t);
      if (c.f1 && c.f1 !== c.f) mExp(o.frequency, Math.max(20, c.f1), t + dur);
      if (c.vib && dur > 0.18) {                                   // 颤音(±7¢) —— 无 LFO 节点, 直接排频
        var vf = t + 0.12, sp = 0.055, k;
        for (k = 0; k < 3 && vf + sp < end; k++) {
          mLin(o.frequency, Math.max(20, c.f * (1 + (k % 2 ? -0.004 : 0.004))), vf + sp);
          vf += sp;
        }
      }
      mCan(g.gain, t);
      if (vol <= 0.0004) { mSet(g.gain, 0.0001, t); return; }      // 该振荡器本次不用
      mSet(g.gain, 0.0001, t);
      mExp(g.gain, vol, t + a);
      if (sus > 0) {
        mExp(g.gain, Math.max(0.0002, vol * sus), t + a + d);
        if (dur - r > a + d) mSet(g.gain, Math.max(0.0002, vol * sus), t + dur - r);
      }
      mExp(g.gain, 0.0001, end);
    },
    /* 噪声槽发声: 循环噪声 + 每次随机播放速率(噪声"颜色"不重复) + 滤波 + 增益包络 */
    _noiseAt: function (z, t, dur, vol, type, freq, q, rate, atk, pan) {
      if (!z || !z.f || !z.g) return;
      try { z.f.type = type; } catch (e) {}
      try { if (z.f.Q) z.f.Q.value = q; } catch (e1) {}
      mSet(z.f.frequency, freq, t);
      if (z.b && z.b.playbackRate) mSet(z.b.playbackRate, (rate || 1) * (0.9 + Math.random() * 0.2), t);
      if (pan !== undefined) this._pan(z, pan, t, 0);
      var g = z.g.gain, a = atk || 0.002;
      mCan(g, t); mSet(g, 0.0001, t);
      if (a <= 0.002) mExp(g, vol, t + a); else mLin(g, vol, t + a);
      mExp(g, 0.0001, t + dur);
      z.freeAt = t + dur + 0.01;
    },

    /* ---------- 打击乐九件 ---------- */
    _kick: function (t, level) {
      var z = this._pickSlot(this._zp, t), s = this._pickSlot(this._tp, t);
      if (z) this._noiseAt(z, t, 0.012, level * 0.30, 'highpass', 5200, 0.8, 1.0, 0, 0);
      if (!s) return;
      s.freeAt = t + 0.22;
      this._pan(s, 0, t, 0);
      mSet(s.o.frequency, 138, t); mExp(s.o.frequency, 45, t + 0.17);
      var g = s.g.gain;
      mCan(g, t); mSet(g, 0.0001, t);
      mExp(g, level, t + 0.006);
      mExp(g, 0.0001, t + 0.21);
    },
    _snare: function (t, level) {
      var z = this._pickSlot(this._zp, t), s = this._pickSlot(this._tp, t);
      if (z) this._noiseAt(z, t, 0.075, level * 1.7, 'bandpass', 1800, 1.1, 0.9, 0.001, 0.06);
      if (!s) return;
      s.freeAt = t + 0.07;
      this._pan(s, 0.04, t, 0);
      mSet(s.o.frequency, 196, t); mExp(s.o.frequency, 152, t + 0.05);
      var g = s.g.gain;
      mCan(g, t); mSet(g, 0.0001, t);
      mExp(g, level * 0.85, t + 0.004);
      mExp(g, 0.0001, t + 0.06);
    },
    _hat: function (t, level, sd, pan) {
      var z = this._pickSlot(this._zp, t);
      if (!z) return;
      this._noiseAt(z, t, Math.min(0.038, sd * 0.5), level, 'highpass', 8200, 0.8, 1.05, 0, pan);
    },
    _open: function (t, level) {
      var z = this._pickSlot(this._zp, t);
      if (!z) return;
      this._noiseAt(z, t, 0.17, level, 'highpass', 6500, 0.8, 1.0, 0.001, 0.18);
    },
    _crash: function (t, level) {
      var z = this._pickSlot(this._zp, t);
      if (!z) return;
      this._noiseAt(z, t, 0.46, level, 'highpass', 3800, 0.7, 1.1, 0.001, -0.1);
    },
    /* 剁菜板(木质): 8ms 带通瞬态 + 1200Hz 短音体 —— 本作的"厨房"标识音色 */
    _wood: function (t, level) {
      var z = this._pickSlot(this._zp, t), s = this._pickSlot(this._tp, t);
      if (z) this._noiseAt(z, t, 0.020, level * 1.4, 'bandpass', 1450, 2.4, 1.15, 0.001, 0.3);
      if (!s) return;
      s.freeAt = t + 0.10;
      this._pan(s, 0.3, t, 0);
      mSet(s.o.frequency, 1260, t); mExp(s.o.frequency, 1080, t + 0.05);
      var g = s.g.gain;
      mCan(g, t); mSet(g, 0.0001, t);
      mExp(g, level, t + 0.002);
      mExp(g, 0.0001, t + 0.07);
    },
    _shaker: function (t, level) {
      var z = this._pickSlot(this._zp, t);
      if (!z) return;
      this._noiseAt(z, t, 0.055, level, 'highpass', 7200, 0.7, 1.2, 0.010, (Math.random() * 2 - 1) * 0.35);
    },
    _tom: function (t, level) {
      var s = this._pickSlot(this._tp, t), z = this._pickSlot(this._zp, t);
      if (z) this._noiseAt(z, t, 0.03, level * 0.25, 'lowpass', 600, 0.9, 1.0, 0.001, 0);
      if (!s) return;
      s.freeAt = t + 0.30;
      this._pan(s, 0, t, 0);
      mSet(s.o.frequency, 232, t); mExp(s.o.frequency, 106, t + 0.22);
      var g = s.g.gain;
      mCan(g, t); mSet(g, 0.0001, t);
      mExp(g, level, t + 0.005);
      mExp(g, 0.0001, t + 0.28);
    },
    /* 锣/大镲: 低频三音 + 噪声爆 —— 精英段每 2 小节的"压迫"标记 */
    _gong: function (t, level) {
      var s1 = this._pickSlot(this._tp, t), s2 = this._pickSlot(this._tp, t), z = this._pickSlot(this._zp, t);
      if (z) this._noiseAt(z, t, 0.55, level * 0.9, 'bandpass', 900, 0.7, 0.9, 0.004, 0);
      var i, pair = [[s1, 94, 70, 1.15, 0.9], [s2, 187, 152, 0.72, 0.45]];
      for (i = 0; i < pair.length; i++) {
        var s = pair[i][0];
        if (!s) continue;
        s.freeAt = t + pair[i][3];
        this._pan(s, 0, t, 0);
        mSet(s.o.frequency, pair[i][1], t); mExp(s.o.frequency, pair[i][2], t + pair[i][3] * 0.8);
        var g = s.g.gain;
        mCan(g, t); mSet(g, 0.0001, t);
        mExp(g, level * pair[i][4], t + 0.010);
        mExp(g, 0.0001, t + pair[i][3]);
      }
    },
    /* ---------- 编曲层音色 ---------- */
    /* 低音: 方波主体 + 正弦亚音 + 八度锯齿微亮; 18ms 起音滑音(演奏感) + 滤波包络 */
    _bass: function (t, midi, sd) {
      var s = this._pickSlot(this._np, t);
      if (!s) return;
      var dur = Math.min(sd * 1.7, 0.34), f = hz(midi), fs = hz(Math.max(26, midi - 12));
      this._route(s, 'bass');
      s.freeAt = t + dur + 0.06;
      this._pan(s, 0, t, 0);
      this._flt(s, t, Math.max(220, f * 5.6), Math.max(120, f * 1.8), 1.0, dur + 0.05);
      this._osc(s, 0, t, { w: 'square', f: f, vol: 0.180, slide: 0.965, a: 6, d: 90, s: 0.38, r: 45, dur: dur * 1000 });
      this._osc(s, 1, t, { w: 'sine', f: fs, vol: 0.150, a: 4, d: 80, s: 0.48, r: 45, dur: dur * 1000 });
      this._osc(s, 2, t, { w: 'sawtooth', f: f * 2, vol: 0.042, a: 8, d: 70, s: 0.20, r: 35, dur: dur * 1000 });
    },
    /* 铺底: 三层失谐锯齿, 慢起音长释放; 七和弦取"根-三-七"省略五度(爵士口径) */
    _pad: function (t, tones, sd) {
      var s = this._pickSlot(this._np, t);
      if (!s || !tones || !tones.length) return;
      var pick = tones.length > 3 ? [tones[0], tones[1], tones[tones.length - 1]] : tones;
      var dur = Math.max(0.55, sd * 0.94), det = [0.9959, 1.0, 1.0041], i;
      this._route(s, 'pad');
      s.freeAt = t + dur + 0.85;
      this._pan(s, 0, t, 0);
      this._flt(s, t, 620, this._drumsLvl >= 2 ? 1580 : 1020, 0.7, dur * 0.8);
      for (i = 0; i < 3; i++) {
        this._osc(s, i, t, {
          w: 'sawtooth', f: hz(pick[i % pick.length]) * det[i], vol: 0.074,
          a: 205, d: 520, s: 0.86, r: 720, dur: dur * 1000
        });
      }
    },
    /* 战斗段琶音层: 高八度分解微光(不抢主旋律) */
    _arpBroken: function (t, tones, sd, i) {
      var s = this._pickSlot(this._np, t);
      if (!s || !tones) return;
      var midi = tones[((i >> 1) % tones.length)] + 24, f = hz(midi), dur = Math.min(sd * 1.1, 0.2);
      this._route(s, 'arp');
      s.freeAt = t + dur + 0.16;
      this._pan(s, (i & 2) ? 0.34 : -0.34, t, 0.02);
      this._flt(s, t, 5200, 3200, 0.8, dur + 0.06);
      this._osc(s, 0, t, { w: 'triangle', f: f, vol: 0.050, a: 4, d: 130, s: 0.18, r: 180, dur: dur * 1000 });
      this._osc(s, 1, t, { w: 'sine', f: f * 2, vol: 0.020, a: 4, d: 110, s: 0.12, r: 160, dur: dur * 1000 });
      this._osc(s, 2, t, { w: 'sine', f: f * 1.5, vol: 0.012, a: 6, d: 100, s: 0.1, r: 140, dur: dur * 1000 });
    },
    /* 商店段琶音层: 后半拍的和声 comp(短促和弦, 摇摆律动里最出味的一层) */
    _comp: function (t, tones, sd) {
      var s = this._pickSlot(this._np, t);
      if (!s || !tones || !tones.length) return;
      var pick = tones.length > 3 ? [tones[0], tones[1], tones[tones.length - 1]] : tones;
      var dur = Math.min(sd * 1.3, 0.22), i;
      this._route(s, 'arp');
      s.freeAt = t + dur + 0.22;
      this._pan(s, -0.16, t, 0.02);
      this._flt(s, t, 2400, 1050, 0.8, dur + 0.1);
      for (i = 0; i < 3; i++) {
        this._osc(s, i, t, {
          w: 'triangle', f: hz(pick[i % pick.length] + 12), vol: 0.062,
          a: 5, d: 130, s: 0.14, r: 190, dur: dur * 1000
        });
      }
    },
    /* 备战段琶音层: 音盒(三角波 + 八度正弦 + 4.02× 钟形泛音) */
    _arpMel: function (t, midi, sd, i) {
      var s = this._pickSlot(this._np, t);
      if (!s) return;
      var f = hz(midi), dur = Math.min(sd * 1.9, 0.36);
      this._route(s, 'arp');
      s.freeAt = t + dur + 0.5;
      this._pan(s, (i & 2) ? 0.22 : -0.20, t, 0.03);
      this._flt(s, t, 6000, 3800, 0.7, dur + 0.1);
      this._osc(s, 0, t, { w: 'triangle', f: f, vol: 0.115, a: 4, d: 240, s: 0.16, r: 430, dur: dur * 1000 });
      this._osc(s, 1, t, { w: 'sine', f: f * 2, vol: 0.044, a: 4, d: 200, s: 0.12, r: 380, dur: dur * 1000 });
      this._osc(s, 2, t, { w: 'sine', f: f * 4.02, vol: 0.020, a: 3, d: 150, s: 0.08, r: 300, dur: dur * 1000 });
    },
    /* 主旋律: 三角波 + 高八度正弦 + 低八度锯齿垫; 长音带 ±7¢ 颤音 */
    _lead: function (t, midi, sd, lvl, cents) {
      var s = this._pickSlot(this._np, t);
      if (!s) return;
      var k = Math.pow(2, (cents || 0) / 1200), f = hz(midi) * k, dur = Math.min(sd * 2.3, 0.52);
      this._route(s, 'lead');
      s.freeAt = t + dur + 0.34;
      this._pan(s, (Math.random() * 2 - 1) * 0.16, t, 0.03);
      this._flt(s, t, 4800, 2100, 0.9, dur + 0.1);
      this._osc(s, 0, t, { w: 'triangle', f: f, vol: 0.108 * lvl, vib: true, a: 8, d: 150, s: 0.46, r: 200, dur: dur * 1000 });
      this._osc(s, 1, t, { w: 'sine', f: f * 2, vol: 0.040 * lvl, a: 8, d: 140, s: 0.36, r: 190, dur: dur * 1000 });
      this._osc(s, 2, t, { w: 'sawtooth', f: f * 0.5, vol: 0.030 * lvl, a: 10, d: 130, s: 0.3, r: 180, dur: dur * 1000 });
    },
    /* 精英段张力刺音(♭5): 双方波 + 亚音, 短促尖锐 */
    _stab: function (t, midi, sd) {
      var s = this._pickSlot(this._np, t);
      if (!s) return;
      var dur = Math.min(sd * 1.1, 0.17), f = hz(midi);
      this._route(s, 'fx');
      s.freeAt = t + dur + 0.1;
      this._pan(s, (Math.random() * 2 - 1) * 0.45, t, 0.02);
      this._flt(s, t, 3000, 1200, 1.5, dur + 0.06);
      this._osc(s, 0, t, { w: 'square', f: f, vol: 0.060, a: 4, d: 80, s: 0.20, r: 70, dur: dur * 1000 });
      this._osc(s, 1, t, { w: 'square', f: f * 1.5, vol: 0.028, a: 4, d: 70, s: 0.18, r: 60, dur: dur * 1000 });
      this._osc(s, 2, t, { w: 'sine', f: f * 0.5, vol: 0.034, a: 4, d: 60, s: 0.2, r: 50, dur: dur * 1000 });
    },

    /* ---------- 失焦/微信前后台: 暂停调度 + 静音, 恢复时重新对齐(不补发积压) ---------- */
    _bindVisibility: function () {
      if (this._visBound) return;
      var self = this;
      function setPaused(p) {
        try {
          self._paused = !!p;
          self.nextT = null;
          if (self._ok) self._applyGain(p ? 0.0001 : (self._enabled ? self._busTarget() : 0.0001), p ? 0.05 : 0.20);
        } catch (e) {}
      }
      try {
        var d = (typeof document !== 'undefined') ? document : null;      // 微信小游戏无 document
        if (d && d.addEventListener) {
          d.addEventListener('visibilitychange', function () {
            setPaused(!!(d.hidden || d.visibilityState === 'hidden'));
          }, false);
          this._visBound = true;
        }
        var wx = global.wx;
        if (wx && wx.onHide) {
          wx.onHide(function () { setPaused(true); });
          if (wx.onShow) wx.onShow(function () { setPaused(false); });
          this._visBound = true;
        }
      } catch (e) {}
    }
  };

  global.PS = PS;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));