/**
 * cutout_character.js — T 设备"被指向"时的手绘纸板人偶动画（纯展示层）
 *
 * 设计原则：
 *   - 不修改、不调用 main.js 里的任何指向判定逻辑。
 *   - 只"观察" #t-status-display 的 class：
 *       main.js 在被指向时设为 't-status-display green'，
 *       停止指向时设为 't-status-display red'。
 *     本模块用 MutationObserver 监听这个变化 → 出场 / 退场。
 *   - 只"读取" window.state.deviceType（T1/T2/T3）来决定显示哪个角色，从不写入。
 *   - 删掉本文件，原有功能完全不受影响。
 *
 * 角色（每台设备一个，主色与 P 端图例颜色对应）：
 *   T1 / 设备1 → 小狐狸（红色围巾）
 *   T2 / 设备2 → 小企鹅（蓝色毛线帽）
 *   T3 / 设备3 → 小青蛙（绿色）
 *
 * 画风：牛皮纸板剪纸人偶 —— 纸板颗粒底 + 棕色马克笔描边 + 斜线排线上色
 *       + 撕/剪的不规则边缘 + 纸板厚度 + 投影 + 背后插一根纸板棍。
 *
 * 动画流程：
 *   出场：从屏幕底部外升起 → 弹性过冲 → 停在屏幕中央 → 持续轻微上下浮动（bob）
 *   退场：沉回屏幕底部 → 隐藏
 *   出场途中被打断（或退场途中又被指向）时，从当前位置平滑接续，不会跳帧。
 */
(function () {
    'use strict';

    // ============================================================
    // 一、动画引擎
    // ============================================================
    var stage = null;    // 全屏透明舞台（pointer-events: none）
    var mover = null;    // 负责升起 / 下沉（WAAPI 动画）
    var bobber = null;   // 负责持续上下浮动（CSS 动画）
    var anim = null;     // 当前正在进行的出场/退场动画
    var mode = 'hidden'; // hidden | rising | idle | leaving
    var mountedType = null;

    var reduceMotion = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // 只读：当前设备类型（T1/T2/T3），读不到时回退到 T1
    function currentDeviceType() {
        var t = (window.state && window.state.deviceType) ||
                (document.getElementById('t-my-type') || {}).textContent;
        return CHARACTERS[t] ? t : 'T1';
    }

    function mount(type) {
        var screen = document.getElementById('screen-t-device');
        if (!screen) return false;
        if (stage && mountedType === type) return true;
        if (stage) stage.remove();

        stage = document.createElement('div');
        stage.className = 'rb-stage rb-char-' + type;
        stage.setAttribute('aria-hidden', 'true');
        stage.innerHTML =
            '<div class="rb-mover">' +
                '<div class="rb-bobber">' +
                    '<div class="rb-stick"></div>' +
                    buildSvg(CHARACTERS[type]) +
                '</div>' +
            '</div>';
        screen.appendChild(stage);

        mover = stage.querySelector('.rb-mover');
        bobber = stage.querySelector('.rb-bobber');
        mountedType = type;
        return true;
    }

    // 屏幕外起始位置：角色顶部也完全在屏幕底边以下
    function offscreenY() {
        var h = mover.getBoundingClientRect().height || window.innerHeight * 0.5;
        return Math.round(window.innerHeight / 2 + h / 2 + 40);
    }

    // 读取 mover 当前实际的 Y 位移（用于打断时平滑接续）
    function currentY() {
        var t = getComputedStyle(mover).transform;
        if (!t || t === 'none') return 0;
        try { return new DOMMatrixReadOnly(t).m42; } catch (e) { return 0; }
    }

    function stopAnim() {
        if (anim) { anim.onfinish = null; anim.cancel(); anim = null; }
    }

    // ---------- 出场 ----------
    function show() {
        var type = currentDeviceType();
        if (mode === 'hidden' && !mount(type)) return;
        if (!stage) return;
        if (mode === 'rising' || mode === 'idle') return; // 幂等：重复消息不重播

        var fromY = (mode === 'leaving') ? currentY() : null;
        stopAnim();

        stage.classList.add('is-visible');
        stage.classList.remove('is-arrived');
        if (fromY === null) fromY = offscreenY();
        mode = 'rising';

        if (reduceMotion || !mover.animate) {
            mover.style.transform = 'translateY(0)';
            arrived();
            return;
        }

        bobber.classList.add('is-bobbing'); // 浮动从一开始就叠加，避免到位时"咔"一下切换
        anim = mover.animate([
            { transform: 'translateY(' + fromY + 'px) rotate(-7deg)', easing: 'cubic-bezier(.2,.75,.3,1)' },
            { transform: 'translateY(-34px) rotate(3deg)', offset: 0.62, easing: 'ease-in-out' },
            { transform: 'translateY(10px) rotate(-1.5deg) scale(1.03, .97)', offset: 0.82, easing: 'ease-out' },
            { transform: 'translateY(0) rotate(0deg) scale(1, 1)' }
        ], { duration: 1150, fill: 'forwards' });
        anim.onfinish = arrived;
    }

    function arrived() {
        anim = null;
        mode = 'idle';
        mover.style.transform = 'translateY(0)';
        bobber.classList.add('is-bobbing');
        stage.classList.add('is-arrived'); // 触发头顶"闪光"笔画 & 挥手
    }

    // ---------- 退场 ----------
    function hide() {
        if (!stage || mode === 'hidden' || mode === 'leaving') return;

        var fromY = currentY();
        stopAnim();
        mode = 'leaving';
        stage.classList.remove('is-arrived');

        if (reduceMotion || !mover.animate) { gone(); return; }

        anim = mover.animate([
            { transform: 'translateY(' + fromY + 'px) rotate(0deg)', easing: 'ease-out' },
            { transform: 'translateY(' + (fromY - 22) + 'px) rotate(-2deg)', offset: 0.22, easing: 'cubic-bezier(.5,0,.9,.45)' },
            { transform: 'translateY(' + offscreenY() + 'px) rotate(6deg)' }
        ], { duration: 700, fill: 'forwards' });
        anim.onfinish = gone;
    }

    function gone() {
        anim = null;
        mode = 'hidden';
        stage.classList.remove('is-visible', 'is-arrived');
        bobber.classList.remove('is-bobbing');
        mover.style.transform = '';
    }

    // ---------- 只观察，不干预：监听 #t-status-display 的 class ----------
    function watch() {
        var display = document.getElementById('t-status-display');
        if (!display || !window.MutationObserver) return;

        var sync = function () {
            if (display.classList.contains('green')) show();
            else hide();
        };
        new MutationObserver(sync).observe(display, { attributes: true, attributeFilter: ['class'] });
        sync();
    }

    // ============================================================
    // 二、画风公共部分（纸板材质 / 撕边 / 马克笔排线）
    // ============================================================
    var INK = '#4a3b30';        // 棕色马克笔描边
    var VB = { x: -40, y: -20, w: 380, h: 390 };
    var VB_ATTR = 'x="' + VB.x + '" y="' + VB.y + '" width="' + VB.w + '" height="' + VB.h + '"';

    // 马克笔颜色（排线色 + 底色淡涂）
    var COLORS = {
        red:    '#d9480f',
        orange: '#e8833a',
        pink:   '#e8788a',
        blue:   '#3b6fc4',
        navy:   '#3f4a5c',
        green:  '#5c9e3f',
        yellow: '#e0a526'
    };

    // 斜线排线图案：模拟马克笔一笔一笔涂色
    function hatchPatterns() {
        var s = '', angle = { red: 35, orange: 35, pink: 50, blue: -35, navy: 30, green: 40, yellow: -30 };
        Object.keys(COLORS).forEach(function (k) {
            s += '<pattern id="rb-h-' + k + '" width="7" height="7" patternUnits="userSpaceOnUse" ' +
                     'patternTransform="rotate(' + angle[k] + ')">' +
                     '<rect width="3.6" height="7" fill="' + COLORS[k] + '" opacity=".85"/>' +
                 '</pattern>';
        });
        return s;
    }

    // 上色区域 = 淡淡的底色 + 排线（纸板颗粒仍然透出来）
    function color(d, key, extra) {
        extra = extra || '';
        return '<path d="' + d + '" fill="' + COLORS[key] + '" opacity=".28" ' + extra + '/>' +
               '<path d="' + d + '" fill="url(#rb-h-' + key + ')" ' + extra + '/>';
    }
    function line(d, w, extra) {
        return '<path d="' + d + '" fill="none" stroke="' + INK + '" stroke-width="' + (w || 4.5) + '" ' + (extra || '') + '/>';
    }
    function sil(d) { return '<path d="' + d + '"/>'; }

    // 撕/剪纸边：膨胀轮廓 → 低频噪声扭曲（大撕口）→ 高频噪声扭曲（毛刺）
    function tornFilter(id, dilate, seed, lowScale, hiScale) {
        return '<filter id="' + id + '" ' + VB_ATTR + ' filterUnits="userSpaceOnUse">' +
            '<feMorphology in="SourceAlpha" operator="dilate" radius="' + dilate + '" result="d"/>' +
            '<feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="' + seed + '" result="n1"/>' +
            '<feDisplacementMap in="d" in2="n1" scale="' + lowScale + '" xChannelSelector="R" yChannelSelector="G" result="t1"/>' +
            '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="' + (seed + 20) + '" result="n2"/>' +
            '<feDisplacementMap in="t1" in2="n2" scale="' + hiScale + '" xChannelSelector="R" yChannelSelector="G" result="t2"/>' +
            '<feFlood flood-color="#fff"/>' +
            '<feComposite in2="t2" operator="in"/>' +
        '</filter>';
    }

    // 牛皮纸板材质：底色 + 低频深浅斑 + 深色颗粒 + 浅色颗粒
    function kraftFilter() {
        return '<filter id="rb-f-kraft" ' + VB_ATTR + ' filterUnits="userSpaceOnUse">' +
            '<feFlood flood-color="#c9a676" result="base"/>' +
            '<feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="5" result="blot"/>' +
            '<feColorMatrix in="blot" type="matrix" values="0 0 0 0 .62  0 0 0 0 .45  0 0 0 0 .27  1.3 0 0 0 -.55" result="blotC"/>' +
            '<feComposite in="blotC" in2="base" operator="over" result="b1"/>' +
            '<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="1" seed="9" result="sp1"/>' +
            '<feColorMatrix in="sp1" type="matrix" values="0 0 0 0 .40  0 0 0 0 .28  0 0 0 0 .16  7 0 0 0 -4.3" result="sp1C"/>' +
            '<feComposite in="sp1C" in2="b1" operator="over" result="b2"/>' +
            '<feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="1" seed="23" result="sp2"/>' +
            '<feColorMatrix in="sp2" type="matrix" values="0 0 0 0 .93  0 0 0 0 .84  0 0 0 0 .66  7 0 0 0 -4.4" result="sp2C"/>' +
            '<feComposite in="sp2C" in2="b2" operator="over"/>' +
        '</filter>';
    }

    function maskFor(id, filterId, silId) {
        return '<mask id="' + id + '" maskUnits="userSpaceOnUse" ' + VB_ATTR + '>' +
            '<use href="#' + silId + '" filter="url(#' + filterId + ')"/>' +
        '</mask>';
    }

    // 到位时的"闪光"笔画：围绕头顶
    function sparks(cx, top) {
        return '<g class="rb-sparks" fill="none" stroke="' + INK + '" stroke-width="5" stroke-linecap="round">' +
            '<path pathLength="1" d="M' + (cx - 70) + ' ' + (top + 30) + ' L ' + (cx - 90) + ' ' + (top + 8) + '"/>' +
            '<path pathLength="1" d="M' + (cx - 38) + ' ' + (top + 6) + ' L ' + (cx - 46) + ' ' + (top - 20) + '"/>' +
            '<path pathLength="1" d="M' + (cx + 74) + ' ' + (top + 26) + ' L ' + (cx + 98) + ' ' + (top + 8) + '"/>' +
            '<path pathLength="1" d="M' + (cx + 86) + ' ' + (top + 58) + ' L ' + (cx + 114) + ' ' + (top + 54) + '"/>' +
        '</g>';
    }

    // 雷达信号波纹（持续脉动），(x, y) 为波纹圆心
    function signal(x, y) {
        return '<g class="rb-signal" fill="none" stroke="' + INK + '" stroke-width="4" stroke-linecap="round">' +
            '<path d="M' + (x + 12) + ' ' + (y - 14) + ' Q ' + (x + 22) + ' ' + y + ', ' + (x + 12) + ' ' + (y + 14) + '"/>' +
            '<path d="M' + (x + 26) + ' ' + (y - 26) + ' Q ' + (x + 42) + ' ' + y + ', ' + (x + 26) + ' ' + (y + 26) + '"/>' +
        '</g>';
    }

    function buildSvg(ch) {
        return '' +
'<svg class="rb-svg" viewBox="' + VB.x + ' ' + VB.y + ' ' + VB.w + ' ' + VB.h + '" xmlns="http://www.w3.org/2000/svg">' +
'<defs>' +
    tornFilter('rb-f-edge', 15, 7, 12, 3) +   // 纸板厚度（深色那一层）
    tornFilter('rb-f-cut', 13, 7, 12, 3) +    // 正面纸板
    kraftFilter() +
    '<filter id="rb-f-pencil" ' + VB_ATTR + ' filterUnits="userSpaceOnUse">' +
        '<feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="11" result="n"/>' +
        '<feDisplacementMap in="SourceGraphic" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G"/>' +
    '</filter>' +
    hatchPatterns() +
    // 剪影：只用来生成纸板外形（实心，不显示）
    '<g id="rb-sil">' + ch.silhouette + '</g>' +
    maskFor('rb-m-edge', 'rb-f-edge', 'rb-sil') +
    maskFor('rb-m-cut', 'rb-f-cut', 'rb-sil') +
'</defs>' +

'<g class="rb-cutout">' +
    // 纸板厚度：深一点的棕色，向右下错开
    '<rect ' + VB_ATTR + ' fill="#8b6844" mask="url(#rb-m-edge)" transform="translate(4 6)"/>' +
    // 纸板正面：牛皮纸颗粒
    '<g mask="url(#rb-m-cut)"><rect ' + VB_ATTR + ' filter="url(#rb-f-kraft)"/></g>' +
    // 角色：马克笔线稿 + 排线上色（铅笔抖动）
    '<g class="rb-art" filter="url(#rb-f-pencil)" stroke-linecap="round" stroke-linejoin="round">' +
        ch.art +
    '</g>' +
'</g>' +
signal(ch.signal[0], ch.signal[1]) +
sparks(ch.sparks[0], ch.sparks[1]) +
'</svg>';
    }

    // 通用小部件
    function eyes(lx, rx, y, r) {
        r = r || 9;
        return '<g class="rb-eyes">' +
            '<ellipse cx="' + lx + '" cy="' + y + '" rx="' + r + '" ry="' + (r * 1.25) + '" fill="' + INK + '"/>' +
            '<ellipse cx="' + rx + '" cy="' + y + '" rx="' + r + '" ry="' + (r * 1.25) + '" fill="' + INK + '"/>' +
            '<circle cx="' + (lx - r * 0.35) + '" cy="' + (y - r * 0.45) + '" r="' + (r * 0.38) + '" fill="#fff8e8"/>' +
            '<circle cx="' + (rx - r * 0.35) + '" cy="' + (y - r * 0.45) + '" r="' + (r * 0.38) + '" fill="#fff8e8"/>' +
        '</g>';
    }
    function blush(lx, rx, y) {
        return color('M' + (lx - 14) + ' ' + y + ' a14 8 0 1 0 28 0 a14 8 0 1 0 -28 0 Z', 'pink') +
               color('M' + (rx - 14) + ' ' + y + ' a14 8 0 1 0 28 0 a14 8 0 1 0 -28 0 Z', 'pink');
    }
    function ellipseD(cx, cy, rx, ry) {
        return 'M' + (cx - rx) + ' ' + cy + ' a' + rx + ' ' + ry + ' 0 1 0 ' + (2 * rx) + ' 0 a' + rx + ' ' + ry + ' 0 1 0 ' + (-2 * rx) + ' 0 Z';
    }
    function wavingArm(ox, oy, d) {
        return '<g class="rb-arm-wave" style="transform-origin:' + ox + 'px ' + oy + 'px">' + d + '</g>';
    }

    // ============================================================
    // 三、三个角色（原创设计，均为纸板人偶风格）
    // ============================================================
    var CHARACTERS = {};

    // ---------- T1：小狐狸（红色系，对应 设备1 红色）----------
    (function () {
        var head  = 'M150 92 C 200 92, 236 120, 240 160 L 264 184 C 242 194, 222 214, 190 222 C 172 230, 128 230, 110 222 C 78 214, 58 194, 36 184 L 60 160 C 64 120, 100 92, 150 92 Z';
        var mask  = 'M150 92 C 200 92, 236 120, 240 160 C 212 150, 180 160, 150 190 C 120 160, 88 150, 60 160 C 64 120, 100 92, 150 92 Z';
        var earL  = 'M80 120 L 70 32 L 130 96 Z', earR = 'M220 120 L 230 32 L 170 96 Z';
        var earLi = 'M86 108 L 80 54 L 116 94 Z', earRi = 'M214 108 L 220 54 L 184 94 Z';
        var body  = 'M116 220 C 104 260, 104 300, 118 316 L 182 316 C 196 300, 196 260, 184 220 Z';
        var tail  = 'M184 300 C 236 312, 274 282, 270 236 C 268 208, 248 196, 236 212 C 248 246, 228 276, 188 280 Z';
        var tailTip = 'M270 236 C 268 208, 248 196, 236 212 C 241 224, 245 234, 270 236 Z';
        var scarf = 'M104 222 C 130 238, 170 238, 196 222 L 198 242 C 170 256, 130 256, 102 242 Z';
        var scarfEnd = 'M168 244 L 192 290 L 172 296 L 154 250 Z';
        var armL  = 'M120 250 C 98 240, 82 222, 74 202 C 70 190, 86 184, 92 196 C 100 214, 112 228, 126 236 Z';
        var armR  = 'M182 250 C 200 262, 210 278, 212 292 C 213 304, 198 306, 197 294 C 195 282, 188 270, 178 262 Z';
        var feet  = ellipseD(132, 318, 18, 10) + ellipseD(168, 318, 18, 10);

        CHARACTERS.T1 = {
            silhouette: sil(tail) + sil(earL) + sil(earR) + sil(head) + sil(body) + sil(armL) + sil(armR) + sil(feet),
            signal: [244, 52],
            sparks: [150, 40],
            art:
                color(tail, 'orange') + '<path d="' + tailTip + '" fill="#efe2c8" opacity=".8"/>' + line(tail) + line('M236 212 C 241 224, 245 234, 270 236', 3) +
                color(feet, 'red') + line(feet) +
                line(body) +
                color(earL, 'orange') + color(earR, 'orange') + color(earLi, 'pink') + color(earRi, 'pink') +
                line(earL) + line(earR) + line(earLi, 3) + line(earRi, 3) +
                color(mask, 'orange') + line(head) + line(head, 1.6, 'opacity=".4" transform="translate(2 -2)"') +
                line('M60 160 C 88 150, 120 160, 150 190 C 180 160, 212 150, 240 160', 3) +
                eyes(122, 178, 170, 8) +
                '<path d="M141 192 Q 150 186, 159 192 Q 156 202, 150 203 Q 144 202, 141 192 Z" fill="' + INK + '"/>' +
                line('M138 208 Q 144 216, 150 208 Q 156 216, 162 208', 3.5) +
                blush(104, 196, 196) +
                color(scarf, 'red') + color(scarfEnd, 'red') + line(scarfEnd) + line(scarf) +
                line('M118 240 L 124 248 M140 244 L 144 252 M160 244 L 156 252', 2.5) +
                line(armR) +
                wavingArm(122, 244, line(armL))
        };
    })();

    // ---------- T2：小企鹅（蓝色系，对应 设备2 蓝色）----------
    (function () {
        var body  = 'M150 66 C 214 66, 246 144, 244 222 C 242 292, 206 326, 150 326 C 94 326, 58 292, 56 222 C 54 144, 86 66, 150 66 Z';
        var belly = 'M150 122 C 194 122, 212 172, 210 230 C 208 288, 184 312, 150 312 C 116 312, 92 288, 90 230 C 88 172, 106 122, 150 122 Z';
        var hat   = 'M86 112 C 92 50, 208 50, 214 112 C 184 98, 116 98, 86 112 Z';
        var pom   = ellipseD(150, 40, 17, 16);
        var brim  = 'M84 112 C 116 96, 184 96, 216 112 L 214 128 C 184 114, 116 114, 86 128 Z';
        var beak  = 'M136 170 Q 150 164, 164 170 Q 158 186, 150 188 Q 142 186, 136 170 Z';
        var finL  = 'M68 192 C 42 178, 24 152, 22 128 C 22 116, 36 114, 40 126 C 48 150, 62 168, 78 176 Z';
        var finR  = 'M234 204 C 252 224, 262 248, 262 266 C 262 278, 248 278, 246 268 C 242 250, 234 232, 224 218 Z';
        var feet  = ellipseD(124, 326, 22, 10) + ellipseD(176, 326, 22, 10);

        CHARACTERS.T2 = {
            silhouette: sil(pom) + sil(hat) + sil(body) + sil(finL) + sil(finR) + sil(feet),
            signal: [222, 44],
            sparks: [150, 26],
            art:
                color(feet, 'yellow') + line(feet) +
                color(body + ' ' + belly, 'navy', 'fill-rule="evenodd"') +
                line(body) + line(body, 1.6, 'opacity=".4" transform="translate(2 -2)"') + line(belly, 3.5) +
                color(hat, 'blue') + color(brim, 'blue') + line(hat) + line(brim) +
                line('M106 108 L 104 122 M126 104 L 125 119 M150 102 L 150 117 M174 104 L 175 119 M194 108 L 196 122', 2.5) +
                color(pom, 'blue') + line(pom) +
                eyes(126, 174, 148, 8) +
                color(beak, 'yellow') + line(beak, 3.5) +
                blush(110, 190, 176) +
                color(finR, 'navy') + line(finR) +
                wavingArm(70, 184, color(finL, 'navy') + line(finL))
        };
    })();

    // ---------- T3：小青蛙（绿色系，对应 设备3 绿色）----------
    (function () {
        var head  = 'M150 112 C 210 112, 256 142, 256 184 C 256 224, 210 242, 150 242 C 90 242, 44 224, 44 184 C 44 142, 90 112, 150 112 Z';
        var bumpL = ellipseD(100, 112, 34, 32), bumpR = ellipseD(200, 112, 34, 32);
        var eyeWL = ellipseD(100, 112, 21, 20), eyeWR = ellipseD(200, 112, 21, 20);
        var body  = 'M104 232 C 92 272, 98 312, 118 324 L 182 324 C 202 312, 208 272, 196 232 Z';
        var belly = ellipseD(150, 284, 32, 28);
        var armL  = 'M110 252 C 88 240, 72 222, 64 200 C 60 188, 74 182, 80 192 C 88 210, 102 226, 118 236 Z';
        var armR  = 'M192 252 C 212 264, 222 282, 222 298 C 222 310, 206 310, 206 298 C 205 284, 198 272, 186 264 Z';
        var feet  = ellipseD(118, 324, 26, 10) + ellipseD(182, 324, 26, 10);
        var leaf  = 'M150 80 C 150 62, 162 48, 184 46 C 182 66, 168 78, 150 80 Z';

        CHARACTERS.T3 = {
            silhouette: sil(body) + sil(head) + sil(bumpL) + sil(bumpR) + sil(armL) + sil(armR) + sil(feet) + sil(leaf) +
                        sil('M146 82 L 154 82 L 154 116 L 146 116 Z'),
            signal: [234, 70],
            sparks: [150, 60],
            art:
                color(feet, 'green') + line(feet) +
                color(body + ' ' + belly, 'green', 'fill-rule="evenodd"') + line(body) + line(belly, 3) +
                color(head, 'green') + line(head) + line(head, 1.6, 'opacity=".4" transform="translate(2 -2)"') +
                // 头顶小嫩芽
                line('M150 112 C 150 98, 150 88, 152 80', 4) +
                color(leaf, 'green') + line(leaf, 3.5) +
                color(bumpL + ' ' + eyeWL, 'green', 'fill-rule="evenodd"') +
                color(bumpR + ' ' + eyeWR, 'green', 'fill-rule="evenodd"') +
                line(bumpL) + line(bumpR) + line(eyeWL, 2.5) + line(eyeWR, 2.5) +
                eyes(102, 198, 114, 10) +
                line('M96 186 Q 150 232, 204 186', 5) +
                '<path d="M140 206 Q 150 222, 162 206 Q 151 212, 140 206 Z" fill="#e8788a" stroke="' + INK + '" stroke-width="2.5"/>' +
                blush(74, 226, 196) +
                line('M132 152 L 134 156 M168 152 L 166 156', 3) +
                color(armR, 'green') + line(armR) +
                wavingArm(114, 244, color(armL, 'green') + line(armL))
        };
    })();

    // ============================================================
    // 四、启动
    // ============================================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', watch);
    } else {
        watch();
    }

    // 调试用：控制台可手动 CutoutCharacter.show() / hide()
    window.CutoutCharacter = { show: show, hide: hide };
})();
