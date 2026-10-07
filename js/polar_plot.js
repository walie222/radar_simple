/* ============================================
   极坐标图渲染器 (Canvas) — 半圆 -90° ~ +90°
   对齐 point_demo.py 的 MAX_DISPLAY_AZI=90 设计

   视觉版本：笔记本手绘风 · 伪 3D 透视地面 · 礼物盒节点
   - 公开 API 与旧版完全一致：
       create(canvasId) → { updateDevice, clearDevices, setHighlight, render,
                            canvas, ctx, w, h, cx, cy, maxR, devices, highlightIdx }
   - 数据逻辑（量程计算、±90° 过滤、距离截断）与旧版一致，仅改变绘制方式
   ============================================ */

var PolarPlot = (function() {

    /* ---------- 手绘风格配色 ---------- */
    var INK        = '#2d2a32';   // 墨水描边
    var INK_SOFT   = '#5b5866';
    var PENCIL     = '#9aa0ab';   // 铅笔辅助线
    var PAPER      = '#fffdf6';   // 纸面
    var PAPER_EDGE = '#efe6cf';   // 纸板侧面
    var GRID       = 'rgba(96, 150, 204, 0.22)'; // 方格纸蓝线
    var HILITE     = '#ffe066';   // 荧光笔黄
    var RIBBON     = '#fff4c9';   // 丝带
    var FONT_HAND  = '"Patrick Hand", "Kalam", "Comic Sans MS", "Microsoft YaHei", "PingFang SC", sans-serif';
    var FONT_LABEL = '"Patrick Hand", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';

    /* ---------- 稳定的伪随机（保证手绘抖动每帧一致，不闪烁）---------- */
    function hash(n) {
        var x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
        return x - Math.floor(x);
    }
    function jit(seed, amp) { return (hash(seed) - 0.5) * 2 * amp; }

    /* ---------- 颜色工具 ---------- */
    function shade(hex, amt) {
        // amt < 0 变暗，> 0 变亮
        var c = hex.replace('#', '');
        if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
        var r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
        function f(v) {
            v = amt < 0 ? v * (1 + amt) : v + (255 - v) * amt;
            return Math.max(0, Math.min(255, Math.round(v)));
        }
        return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
    }
    function alpha(hex, a) {
        var c = hex.replace('#', '');
        var r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }

    /* ---------- 缓动 ---------- */
    function easeOutBack(t) {
        var c1 = 1.70158, c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
    function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

    function create(canvasId) {
        var canvas = document.getElementById(canvasId);
        if (!canvas) return null;
        var ctx = canvas.getContext('2d');

        /* ---- 画布尺寸（横版，适配半圆）+ 高清屏适配 ---- */
        var W = 750, H = 500;
        var DPR = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
        canvas.width = W * DPR;
        canvas.height = H * DPR;

        /* ---- 伪 3D 透视参数 ----
           地面坐标：X 横向（右为正），Z 向前（0° 方向），单位 = 最大量程半径
           相机位于原点后上方，俯视地面 */
        var CAM_D   = 1.55;           // 相机到原点的水平距离
        var CAM_H   = 2.7;            // 相机高度
        var FOCAL   = 312 * CAM_D;    // 使近端半宽 ≈ 312px
        var ORIGIN_Y = 448;           // 原点（雷达）在屏幕上的 Y
        var HORIZON_Y = ORIGIN_Y - FOCAL * CAM_H / CAM_D;
        var SLAB_T  = 18;             // 纸板厚度（px）

        var cx = W / 2;
        var cy = ORIGIN_Y;
        var maxR = 300;

        function project(X, Z) {
            var k = 1 / (Z + CAM_D);
            return {
                x: cx + FOCAL * X * k,
                y: HORIZON_Y + FOCAL * CAM_H * k,
                s: k * CAM_D            // 相对近端的缩放系数 (近端=1)
            };
        }
        function projPolar(rNorm, aziDeg) {
            var a = aziDeg * Math.PI / 180;
            return project(rNorm * Math.sin(a), rNorm * Math.cos(a));
        }

        var self = {
            canvas: canvas,
            ctx: ctx,
            w: W,
            h: H,
            cx: cx,
            cy: cy,
            maxR: maxR,
            // devices[0]=T1(addr01), devices[1]=T2(addr02), devices[2]=T3(addr03)
            devices: [null, null, null],
            highlightIdx: -1,
        };

        /* ---- 动画状态（纯视觉，不影响数据）---- */
        var anim = {
            open: [0, 0, 0],          // 礼物盒开启进度 0..1
            openedAt: [0, 0, 0],      // 打开时间戳（用于粒子爆发）
            raf: null,
            last: 0,
        };

        self.updateDevice = function(idx, dis, azi) {
            if (idx >= 0 && idx <= 2) {
                self.devices[idx] = { dis: Number(dis), azi: Number(azi) };
            }
        };

        self.clearDevices = function() {
            self.devices = [null, null, null];
        };

        self.setHighlight = function(idx) {
            if (idx !== self.highlightIdx && idx >= 0 && idx <= 2) {
                anim.openedAt[idx] = performance.now();
            }
            self.highlightIdx = idx; // 0/1/2 or -1
            ensureLoop();
        };

        self.render = function() {
            _draw(ctx);
            ensureLoop();
        };

        /* ---- 动画循环：仅在有动画时运行 ---- */
        function needsAnim() {
            if (self.highlightIdx >= 0 && self.devices[self.highlightIdx]) return true;
            for (var i = 0; i < 3; i++) if (anim.open[i] > 0.001) return true;
            return false;
        }
        function ensureLoop() {
            if (anim.raf || !needsAnim()) return;
            anim.last = performance.now();
            anim.raf = requestAnimationFrame(tick);
        }
        function tick(now) {
            anim.raf = null;
            var dt = Math.min(0.1, (now - anim.last) / 1000);
            anim.last = now;
            for (var i = 0; i < 3; i++) {
                var target = (i === self.highlightIdx && self.devices[i]) ? 1 : 0;
                var speed = target ? 1.8 : 3.2;    // 打开 ~0.55s，合上 ~0.3s
                if (anim.open[i] < target) anim.open[i] = Math.min(target, anim.open[i] + dt * speed);
                else if (anim.open[i] > target) anim.open[i] = Math.max(target, anim.open[i] - dt * speed);
            }
            _draw(ctx);
            if (needsAnim()) anim.raf = requestAnimationFrame(tick);
        }

        /* ---- 绘制常量（与旧版一致）---- */
        var DEFAULT_MAX_DIS = 1000;
        var SCALE_MARGIN_FACTOR = 1.2;
        var SCALE_STEP = 200;
        var MAX_DISPLAY_AZI = 90;       // 显示范围 ±90°

        // 角度标注映射（原始 azi → 屏幕标签）
        var CARDINAL_LABELS = {
            '-90': '-90°', '-60': '-60°', '-30': '-30°',
            '0': '0°', '30': '30°', '60': '60°', '90': '90°'
        };

        function computeScale() {
            var maxDis = 0;
            for (var i = 0; i < 3; i++) {
                var dev = self.devices[i];
                if (dev && dev.dis > 0 && dev.dis > maxDis) {
                    maxDis = dev.dis;
                }
            }
            if (maxDis <= 0) return DEFAULT_MAX_DIS;
            var scaled = maxDis * SCALE_MARGIN_FACTOR;
            return Math.ceil(scaled / SCALE_STEP) * SCALE_STEP;
        }

        /* =========================================================
           手绘笔触工具
           ========================================================= */

        // 沿折线绘制带轻微抖动的平滑线（两遍：主线 + 淡色复描）
        function sketchPoly(c, pts, seed, opt) {
            opt = opt || {};
            var passes = opt.passes || 2;
            var amp = opt.amp == null ? 0.9 : opt.amp;
            for (var p = 0; p < passes; p++) {
                var q = [];
                for (var i = 0; i < pts.length; i++) {
                    q.push({
                        x: pts[i].x + jit(seed + i * 7.3 + p * 101, amp * (p ? 1.4 : 1)),
                        y: pts[i].y + jit(seed + i * 3.7 + p * 211, amp * (p ? 1.4 : 1))
                    });
                }
                c.beginPath();
                c.moveTo(q[0].x, q[0].y);
                if (q.length === 2) {
                    var mx = (q[0].x + q[1].x) / 2 + jit(seed + p * 17, amp * 1.6);
                    var my = (q[0].y + q[1].y) / 2 + jit(seed + p * 29, amp * 1.6);
                    c.quadraticCurveTo(mx, my, q[1].x, q[1].y);
                } else {
                    for (var j = 1; j < q.length - 1; j++) {
                        var xc = (q[j].x + q[j + 1].x) / 2, yc = (q[j].y + q[j + 1].y) / 2;
                        c.quadraticCurveTo(q[j].x, q[j].y, xc, yc);
                    }
                    c.lineTo(q[q.length - 1].x, q[q.length - 1].y);
                }
                if (opt.close) c.closePath();
                c.globalAlpha = p ? (opt.secondAlpha || 0.35) : (opt.alpha || 1);
                c.stroke();
                c.globalAlpha = 1;
            }
        }

        function sketchLine(c, x1, y1, x2, y2, seed, opt) {
            sketchPoly(c, [{ x: x1, y: y1 }, { x: x2, y: y2 }], seed, opt);
        }

        // 手绘多边形（填充 + 描边）
        function sketchShape(c, pts, fill, seed, lw) {
            c.beginPath();
            c.moveTo(pts[0].x, pts[0].y);
            for (var i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
            c.closePath();
            if (fill) { c.fillStyle = fill; c.fill(); }
            c.strokeStyle = INK;
            c.lineWidth = lw || 1.8;
            c.lineJoin = 'round';
            for (var k = 0; k < pts.length; k++) {
                var a = pts[k], b = pts[(k + 1) % pts.length];
                sketchLine(c, a.x, a.y, b.x, b.y, seed + k * 13, { amp: 0.55, secondAlpha: 0.25 });
            }
        }

        // 手绘标签（纸条 + 墨水边）
        function drawTag(c, text, x, y, seed, opt) {
            opt = opt || {};
            c.font = opt.font || ('bold 16px ' + FONT_LABEL);
            var tw = c.measureText(text).width;
            var pw = tw + 16, ph = 24;
            var x0 = x - pw / 2, y0 = y - ph / 2;
            var rot = jit(seed, 0.035);
            c.save();
            c.translate(x, y);
            c.rotate(rot);
            c.translate(-x, -y);
            // 投影
            c.fillStyle = 'rgba(45,42,50,0.18)';
            c.fillRect(x0 + 2.5, y0 + 2.5, pw, ph);
            sketchShape(c, [
                { x: x0, y: y0 }, { x: x0 + pw, y: y0 },
                { x: x0 + pw, y: y0 + ph }, { x: x0, y: y0 + ph }
            ], opt.fill || PAPER, seed + 3, 1.6);
            c.fillStyle = opt.color || INK;
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText(text, x, y + 1);
            c.restore();
        }

        // 四角星闪光
        function drawSparkle(c, x, y, r, color, rot) {
            c.save();
            c.translate(x, y);
            c.rotate(rot || 0);
            c.beginPath();
            for (var i = 0; i < 8; i++) {
                var ang = i * Math.PI / 4;
                var rr = (i % 2 === 0) ? r : r * 0.32;
                c.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
            }
            c.closePath();
            c.fillStyle = color;
            c.fill();
            c.strokeStyle = INK;
            c.lineWidth = 1.2;
            c.stroke();
            c.restore();
        }

        /* =========================================================
           礼物盒
           ========================================================= */
        function drawGiftBox(c, i, gx, gy, s, color, openT, now) {
            var w   = 44 * s;           // 盒宽
            var hgt = 31 * s;           // 盒高
            var dep = 24 * s;           // 纵深
            var ox = dep * 0.62, oy = -dep * 0.48;   // 纵深偏移（右上）
            var seed = 1000 + i * 97;

            // 前面左下角，使盒子底面中心落在地面点上
            var x0 = gx - w / 2 - ox / 2;
            var y0 = gy - oy / 2;

            var front = color, side = shade(color, -0.28), top = shade(color, 0.22);

            // ---- 地面阴影 ----
            c.beginPath();
            c.ellipse(gx + 3 * s, gy + 2 * s, w * 0.78, dep * 0.55, 0, 0, Math.PI * 2);
            c.fillStyle = 'rgba(45,42,50,0.16)';
            c.fill();

            // ---- 打开时：盒内光柱（画在盒体前，被盒体正面遮挡下半部）----
            var lidT = openT > 0 ? easeOutBack(Math.min(1, openT)) : 0;
            var glowT = easeInOut(Math.min(1, openT));
            var topY = y0 - hgt;
            var mouthCx = x0 + w / 2 + ox / 2, mouthCy = topY + oy / 2;

            if (glowT > 0.01) {
                // 光晕
                var g = c.createRadialGradient(mouthCx, mouthCy - 18 * s, 2, mouthCx, mouthCy - 18 * s, 70 * s);
                g.addColorStop(0, 'rgba(255, 224, 102,' + (0.75 * glowT) + ')');
                g.addColorStop(1, 'rgba(255, 224, 102, 0)');
                c.fillStyle = g;
                c.beginPath();
                c.arc(mouthCx, mouthCy - 18 * s, 70 * s, 0, Math.PI * 2);
                c.fill();

                // 手绘光束线条
                c.strokeStyle = 'rgba(232, 164, 0,' + (0.9 * glowT) + ')';
                c.lineWidth = 2;
                c.lineCap = 'round';
                var rays = 7;
                for (var r = 0; r < rays; r++) {
                    var ang = -Math.PI / 2 + (r - (rays - 1) / 2) * 0.32;
                    var wob = Math.sin(now / 260 + r * 1.7) * 3 * s;
                    var r1 = 22 * s, r2 = (40 + (r % 2) * 10) * s * glowT + wob;
                    sketchLine(c,
                        mouthCx + Math.cos(ang) * r1, mouthCy + Math.sin(ang) * r1 - 6 * s,
                        mouthCx + Math.cos(ang) * (r1 + r2), mouthCy + Math.sin(ang) * (r1 + r2) - 6 * s,
                        seed + 500 + r, { amp: 0.6, passes: 1 });
                }
            }

            // ---- 盒体：侧面 ----
            sketchShape(c, [
                { x: x0 + w, y: y0 }, { x: x0 + w + ox, y: y0 + oy },
                { x: x0 + w + ox, y: topY + oy }, { x: x0 + w, y: topY }
            ], side, seed + 1);

            // ---- 盒体：正面 ----
            sketchShape(c, [
                { x: x0, y: y0 }, { x: x0 + w, y: y0 },
                { x: x0 + w, y: topY }, { x: x0, y: topY }
            ], front, seed + 2);

            // 正面铅笔排线（手绘质感）
            c.save();
            c.beginPath();
            c.rect(x0, topY, w, hgt);
            c.clip();
            c.strokeStyle = 'rgba(255,255,255,0.22)';
            c.lineWidth = 1;
            for (var hx = -hgt; hx < w; hx += 6 * s) {
                c.beginPath();
                c.moveTo(x0 + hx, y0);
                c.lineTo(x0 + hx + hgt, topY);
                c.stroke();
            }
            c.restore();

            // ---- 丝带（正面竖带 + 侧面竖带）----
            var rb = w * 0.18;
            sketchShape(c, [
                { x: x0 + w / 2 - rb / 2, y: y0 }, { x: x0 + w / 2 + rb / 2, y: y0 },
                { x: x0 + w / 2 + rb / 2, y: topY }, { x: x0 + w / 2 - rb / 2, y: topY }
            ], RIBBON, seed + 3, 1.3);
            var sm = 0.5, sb = 0.18;
            sketchShape(c, [
                { x: x0 + w + ox * (sm - sb / 2), y: y0 + oy * (sm - sb / 2) },
                { x: x0 + w + ox * (sm + sb / 2), y: y0 + oy * (sm + sb / 2) },
                { x: x0 + w + ox * (sm + sb / 2), y: topY + oy * (sm + sb / 2) },
                { x: x0 + w + ox * (sm - sb / 2), y: topY + oy * (sm - sb / 2) }
            ], shade('#fff4c9', -0.12), seed + 4, 1.3);

            // ---- 盒口（打开时显示内部）----
            var mouth = [
                { x: x0, y: topY }, { x: x0 + w, y: topY },
                { x: x0 + w + ox, y: topY + oy }, { x: x0 + ox, y: topY + oy }
            ];
            if (openT > 0.02) {
                sketchShape(c, mouth, shade(color, -0.55), seed + 5, 1.5);
                // 内部暖光
                c.save();
                c.beginPath();
                c.moveTo(mouth[0].x, mouth[0].y);
                for (var mi = 1; mi < 4; mi++) c.lineTo(mouth[mi].x, mouth[mi].y);
                c.closePath();
                c.clip();
                var ig = c.createRadialGradient(mouthCx, mouthCy, 1, mouthCx, mouthCy, w * 0.7);
                ig.addColorStop(0, 'rgba(255, 236, 140,' + (0.95 * glowT) + ')');
                ig.addColorStop(1, 'rgba(255, 236, 140, 0)');
                c.fillStyle = ig;
                c.fillRect(x0 - 5, topY + oy - 5, w + ox + 10, -oy + 10);
                c.restore();
            } else {
                sketchShape(c, mouth, top, seed + 5);
            }

            // ---- 盖子（含蝴蝶结）----
            var oh = 3 * s;               // 盖子外沿
            var lidH = 8 * s;
            var lift = lidT * 18 * s;
            var tilt = -lidT * 0.55;      // 向左后方掀起
            var shiftX = -lidT * 6 * s;
            var lx0 = x0 - oh, lw = w + oh * 2;
            var ly0 = topY + oh * 0.6;    // 盖子前下沿

            c.save();
            // 以盖子左后角为铰链旋转
            var hingeX = lx0, hingeY = ly0 - lidH;
            c.translate(hingeX + shiftX, hingeY - lift);
            c.rotate(tilt);
            c.translate(-hingeX, -hingeY);

            // 盖子侧面
            sketchShape(c, [
                { x: lx0 + lw, y: ly0 }, { x: lx0 + lw + ox, y: ly0 + oy },
                { x: lx0 + lw + ox, y: ly0 - lidH + oy }, { x: lx0 + lw, y: ly0 - lidH }
            ], shade(color, -0.18), seed + 6, 1.6);
            // 盖子正面
            sketchShape(c, [
                { x: lx0, y: ly0 }, { x: lx0 + lw, y: ly0 },
                { x: lx0 + lw, y: ly0 - lidH }, { x: lx0, y: ly0 - lidH }
            ], shade(color, 0.08), seed + 7, 1.6);
            // 盖子顶面
            var lt = ly0 - lidH;
            sketchShape(c, [
                { x: lx0, y: lt }, { x: lx0 + lw, y: lt },
                { x: lx0 + lw + ox, y: lt + oy }, { x: lx0 + ox, y: lt + oy }
            ], top, seed + 8, 1.6);
            // 盖子上的十字丝带
            sketchShape(c, [
                { x: lx0 + lw / 2 - rb / 2, y: ly0 }, { x: lx0 + lw / 2 + rb / 2, y: ly0 },
                { x: lx0 + lw / 2 + rb / 2, y: lt }, { x: lx0 + lw / 2 - rb / 2, y: lt }
            ], RIBBON, seed + 9, 1.2);
            sketchShape(c, [
                { x: lx0 + lw / 2 - rb / 2, y: lt }, { x: lx0 + lw / 2 + rb / 2, y: lt },
                { x: lx0 + lw / 2 + rb / 2 + ox, y: lt + oy }, { x: lx0 + lw / 2 - rb / 2 + ox, y: lt + oy }
            ], RIBBON, seed + 10, 1.2);

            // 蝴蝶结
            var bx = lx0 + lw / 2 + ox / 2, by = lt + oy / 2;
            var bw = 10 * s, bh = 7 * s;
            c.lineWidth = 1.6;
            c.strokeStyle = INK;
            c.fillStyle = RIBBON;
            [-1, 1].forEach(function(dir) {
                c.beginPath();
                c.moveTo(bx, by);
                c.bezierCurveTo(bx + dir * bw * 1.3, by - bh * 1.8, bx + dir * bw * 1.6, by + bh * 0.2, bx, by);
                c.fill();
                c.stroke();
            });
            // 飘带
            c.beginPath();
            c.moveTo(bx, by);
            c.quadraticCurveTo(bx - 4 * s, by + 6 * s, bx - 7 * s, by + 9 * s);
            c.moveTo(bx, by);
            c.quadraticCurveTo(bx + 4 * s, by + 6 * s, bx + 8 * s, by + 8 * s);
            c.stroke();
            c.beginPath();
            c.arc(bx, by, 2.4 * s, 0, Math.PI * 2);
            c.fillStyle = shade('#fff4c9', -0.2);
            c.fill();
            c.stroke();
            c.restore();

            // ---- 闪光与粒子 ----
            if (glowT > 0.01) {
                // 环绕闪烁的星星
                var starColors = ['#ffd43b', '#ffffff', alpha(color.length === 7 ? color : '#ffd43b', 1)];
                for (var k = 0; k < 6; k++) {
                    var ph = now / 900 + k * (Math.PI * 2 / 6);
                    var rad = (34 + 6 * Math.sin(now / 400 + k)) * s;
                    var sx = mouthCx + Math.cos(ph) * rad * 1.15;
                    var sy = mouthCy - 22 * s + Math.sin(ph) * rad * 0.55;
                    var tw = 0.5 + 0.5 * Math.sin(now / 160 + k * 2.1);
                    drawSparkle(c, sx, sy, (3 + 4 * tw) * s * glowT, starColors[k % 3], now / 1200 + k);
                }
                // 爆发 + 循环上升的纸屑粒子
                var since = (now - anim.openedAt[i]) / 1000;
                var confetti = ['#ff6b6b', '#ffd43b', '#4dabf7', '#69db7c', '#f783ac', color];
                for (var p = 0; p < 14; p++) {
                    var life = 1.6;
                    var tt = ((since + p * (life / 14)) % life) / life;   // 0..1
                    var spread = (hash(p * 3.1 + i) - 0.5) * 2;
                    var px = mouthCx + spread * 38 * s * tt + Math.sin(tt * 6 + p) * 3 * s;
                    var py = mouthCy - 8 * s - (70 * tt - 30 * tt * tt) * s;
                    var a = (1 - tt) * glowT;
                    c.save();
                    c.globalAlpha = a;
                    c.translate(px, py);
                    c.rotate(tt * 8 + p);
                    c.fillStyle = confetti[p % confetti.length];
                    c.strokeStyle = INK;
                    c.lineWidth = 0.8;
                    if (p % 3 === 0) {
                        c.beginPath(); c.arc(0, 0, 2.6 * s, 0, Math.PI * 2); c.fill(); c.stroke();
                    } else if (p % 3 === 1) {
                        c.fillRect(-3 * s, -1.5 * s, 6 * s, 3 * s); c.strokeRect(-3 * s, -1.5 * s, 6 * s, 3 * s);
                    } else {
                        c.beginPath(); c.moveTo(-3 * s, 0); c.quadraticCurveTo(0, -3 * s, 3 * s, 0);
                        c.strokeStyle = confetti[p % confetti.length]; c.lineWidth = 2; c.stroke();
                    }
                    c.restore();
                }
            }

            // 返回标签锚点（盒子+盖子的上方）
            return { tagX: gx, tagY: topY + oy - lidH - 22 * s - lidT * 52 * s };
        }

        /* =========================================================
           主绘制
           ========================================================= */
        function _draw(c) {
            var now = performance.now();
            var MAX_DIS = computeScale();

            // Build ring labels dynamically
            var RING_STEPS = [];
            for (var r = SCALE_STEP; r <= MAX_DIS; r += SCALE_STEP) {
                RING_STEPS.push(r);
            }

            c.setTransform(DPR, 0, 0, DPR, 0, 0);
            c.lineCap = 'round';
            c.lineJoin = 'round';

            // ===== 背景：笔记本方格纸 =====
            c.fillStyle = '#fbf8ef';
            c.fillRect(0, 0, W, H);
            c.strokeStyle = 'rgba(96,150,204,0.13)';
            c.lineWidth = 1;
            for (var gx = 0; gx <= W; gx += 20) { c.beginPath(); c.moveTo(gx + 0.5, 0); c.lineTo(gx + 0.5, H); c.stroke(); }
            for (var gy = 0; gy <= H; gy += 20) { c.beginPath(); c.moveTo(0, gy + 0.5); c.lineTo(W, gy + 0.5); c.stroke(); }
            // 左侧红色页边线
            c.strokeStyle = 'rgba(230,90,90,0.35)';
            c.lineWidth = 1.5;
            c.beginPath(); c.moveTo(28.5, 0); c.lineTo(28.5, H); c.stroke();

            // ===== 扇形地面多边形（透视）=====
            var fan = [];
            for (var a = -MAX_DISPLAY_AZI; a <= MAX_DISPLAY_AZI; a += 3) fan.push(projPolar(1, a));
            var o = project(0, 0);

            // ---- 纸板厚度（底层 + 前侧面）----
            c.beginPath();
            c.moveTo(o.x, o.y + SLAB_T);
            for (var fi = 0; fi < fan.length; fi++) c.lineTo(fan[fi].x, fan[fi].y + SLAB_T);
            c.closePath();
            c.fillStyle = 'rgba(45,42,50,0.12)';
            c.save(); c.translate(6, 6); c.fill(); c.restore();     // 投影
            c.fillStyle = PAPER_EDGE;
            c.fill();
            c.strokeStyle = INK;
            c.lineWidth = 2;
            var under = [];
            for (var ui = 0; ui < fan.length; ui++) under.push({ x: fan[ui].x, y: fan[ui].y + SLAB_T });
            sketchPoly(c, under, 41, { amp: 0.5 });

            var L = project(-1, 0), R = project(1, 0);
            // 前侧面排线
            c.save();
            c.beginPath();
            c.rect(L.x, L.y, R.x - L.x, SLAB_T);
            c.clip();
            c.strokeStyle = 'rgba(45,42,50,0.12)';
            c.lineWidth = 1;
            for (var hx = L.x - SLAB_T; hx < R.x; hx += 7) {
                c.beginPath(); c.moveTo(hx, L.y + SLAB_T); c.lineTo(hx + SLAB_T, L.y); c.stroke();
            }
            c.restore();
            c.strokeStyle = INK;
            c.lineWidth = 2;
            sketchLine(c, L.x, L.y + SLAB_T, R.x, R.y + SLAB_T, 43, { amp: 0.6 });
            sketchLine(c, L.x, L.y, L.x, L.y + SLAB_T, 44, { amp: 0.4 });
            sketchLine(c, R.x, R.y, R.x, R.y + SLAB_T, 45, { amp: 0.4 });

            // ---- 地面顶层（纸面）----
            c.beginPath();
            c.moveTo(o.x, o.y);
            for (var fj = 0; fj < fan.length; fj++) c.lineTo(fan[fj].x, fan[fj].y);
            c.closePath();
            c.fillStyle = PAPER;
            c.fill();

            // 透视方格线（裁剪在扇形内）
            c.save();
            c.clip();
            c.strokeStyle = GRID;
            c.lineWidth = 1;
            var G = 0.1;
            for (var gxn = -1; gxn <= 1.0001; gxn += G) {
                var p1 = project(gxn, 0), p2 = project(gxn, 1.05);
                c.beginPath(); c.moveTo(p1.x, p1.y); c.lineTo(p2.x, p2.y); c.stroke();
            }
            for (var gzn = 0; gzn <= 1.0001; gzn += G) {
                var q1 = project(-1.05, gzn), q2 = project(1.05, gzn);
                c.beginPath(); c.moveTo(q1.x, q1.y); c.lineTo(q2.x, q2.y); c.stroke();
            }

            // 荧光笔：指向判定区（±pointingAziLimit）
            var limDeg = (CONFIG && CONFIG.DATA) ? CONFIG.DATA.pointingAziLimit / CONFIG.DATA.aziToDeg : 10;
            limDeg = Math.max(0, Math.min(MAX_DISPLAY_AZI, limDeg));
            if (limDeg > 0) {
                c.beginPath();
                c.moveTo(o.x, o.y);
                for (var la = -limDeg; la <= limDeg + 0.001; la += Math.max(0.5, limDeg / 10)) {
                    var lp = projPolar(1.02, la);
                    c.lineTo(lp.x, lp.y);
                }
                c.closePath();
                c.fillStyle = 'rgba(255, 224, 102, 0.38)';
                c.fill();
            }
            c.restore();

            // 地面外边框（手绘墨线）
            c.strokeStyle = INK;
            c.lineWidth = 2.4;
            sketchPoly(c, fan, 51, { amp: 0.7 });
            sketchLine(c, L.x, L.y, R.x, R.y, 52, { amp: 0.6 });

            // ===== 同心半圆弧（距离刻度环）=====
            for (var ri = 0; ri < RING_STEPS.length; ri++) {
                var rLabel = RING_STEPS[ri];
                var rn = rLabel / MAX_DIS;
                if (rn >= 0.999) continue;          // 最外圈即边框
                var ring = [];
                for (var aa = -MAX_DISPLAY_AZI; aa <= MAX_DISPLAY_AZI; aa += 4) ring.push(projPolar(rn, aa));
                c.strokeStyle = PENCIL;
                c.lineWidth = 1.3;
                c.setLineDash([6, 5]);
                sketchPoly(c, ring, 60 + ri * 11, { amp: 0.5, passes: 1 });
                c.setLineDash([]);
            }

            // ===== 径向线（每 30° 一条）=====
            for (var ra = -MAX_DISPLAY_AZI + 30; ra <= MAX_DISPLAY_AZI - 30; ra += 30) {
                var e = projPolar(1, ra);
                if (ra === 0) {
                    c.strokeStyle = INK_SOFT;
                    c.lineWidth = 1.8;
                    c.setLineDash([8, 6]);
                } else {
                    c.strokeStyle = 'rgba(154,160,171,0.75)';
                    c.lineWidth = 1.1;
                    c.setLineDash([4, 5]);
                }
                sketchLine(c, o.x, o.y, e.x, e.y, 80 + ra, { amp: 0.6, passes: 1 });
                c.setLineDash([]);
            }

            // ===== 距离刻度：写在纸板前侧面（mm→cm 取整，不写单位）=====
            c.font = 'bold 14px ' + FONT_HAND;
            c.textBaseline = 'middle';
            c.textAlign = 'center';
            for (var ti = 0; ti < RING_STEPS.length; ti++) {
                var tn = RING_STEPS[ti] / MAX_DIS;
                var tp = project(tn, 0);
                c.strokeStyle = INK;
                c.lineWidth = 1.5;
                sketchLine(c, tp.x, tp.y, tp.x, tp.y + 5, 90 + ti, { passes: 1, amp: 0.3 });
                c.fillStyle = INK;
                c.textAlign = tn >= 0.999 ? 'right' : 'center';
                c.fillText(Math.round(RING_STEPS[ti] / 10), tn >= 0.999 ? tp.x - 6 : tp.x, tp.y + SLAB_T / 2 + 2);
            }
            // ===== 单位标识 "cm" =====
            c.fillStyle = INK_SOFT;
            c.font = 'bold 14px ' + FONT_HAND;
            c.textAlign = 'left';
            c.fillText('cm', R.x + 8, R.y + SLAB_T / 2 + 2);

            // ===== 角度标注 =====
            for (var ka = -MAX_DISPLAY_AZI; ka <= MAX_DISPLAY_AZI; ka += 30) {
                var label = CARDINAL_LABELS[String(ka)] || (ka + '°');
                var lp2;
                if (Math.abs(ka) === 90) {
                    var edge = project(ka > 0 ? 1 : -1, 0);
                    lp2 = { x: edge.x + (ka > 0 ? 26 : -26), y: edge.y - 12 };
                } else {
                    lp2 = projPolar(1.13, ka);
                }
                c.fillStyle = ka === 0 ? INK : '#3b3845';
                c.font = 'bold 18px ' + FONT_HAND;
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.fillText(label, lp2.x, lp2.y);
            }

            // ===== 设备节点（礼物盒）— 远处先画 =====
            var labels = CONFIG.DEVICE_LABELS;
            var items = [];
            for (var i = 0; i < 3; i++) {
                var dev = self.devices[i];
                if (!dev) continue;

                // 超出 ±90° 范围的点不显示
                if (Math.abs(dev.azi) > MAX_DISPLAY_AZI) continue;

                // 距离映射
                var clampedDis = Math.min(dev.dis, MAX_DIS);
                var rr = clampedDis / MAX_DIS;
                var arad = dev.azi * Math.PI / 180;
                var X = rr * Math.sin(arad), Z = rr * Math.cos(arad);
                items.push({ i: i, X: X, Z: Z, p: project(X, Z) });
            }
            items.sort(function(a, b) { return b.Z - a.Z; });

            // 先画所有连接虚线（在盒子下方）
            for (var li = 0; li < items.length; li++) {
                var it = items[li];
                var hl = it.i === self.highlightIdx;
                if (hl) {
                    // 荧光笔指向光束
                    c.strokeStyle = 'rgba(255, 212, 59, 0.55)';
                    c.lineWidth = 12;
                    c.lineCap = 'round';
                    sketchLine(c, o.x, o.y, it.p.x, it.p.y, 300 + it.i, { passes: 1, amp: 0.8 });
                }
                c.strokeStyle = alpha(CONFIG.DEVICE_COLORS[it.i], hl ? 0.95 : 0.6);
                c.lineWidth = hl ? 2.2 : 1.6;
                c.setLineDash([7, 5]);
                sketchLine(c, o.x, o.y, it.p.x, it.p.y, 200 + it.i, { passes: 1, amp: 0.6 });
                c.setLineDash([]);
                // 地面落点小十字
                c.strokeStyle = INK;
                c.lineWidth = 1.4;
                sketchLine(c, it.p.x - 5, it.p.y, it.p.x + 5, it.p.y, 220 + it.i, { passes: 1, amp: 0.3 });
            }

            // ===== 原点：手绘雷达 =====
            drawRadar(c, o.x, o.y);

            var tags = [];
            for (var bi = 0; bi < items.length; bi++) {
                var b = items[bi];
                var openT = anim.open[b.i];
                var anchor = drawGiftBox(c, b.i, b.p.x, b.p.y, Math.max(0.7, b.p.s), CONFIG.DEVICE_COLORS[b.i], openT, now);
                tags.push({ i: b.i, x: anchor.tagX, y: anchor.tagY });
            }

            // 标签最后画，保证不被遮挡
            for (var tg = 0; tg < tags.length; tg++) {
                var t = tags[tg];
                var isHL = t.i === self.highlightIdx;
                drawTag(c, labels[t.i], t.x, Math.max(16, t.y), 700 + t.i, {
                    fill: isHL ? HILITE : PAPER,
                    font: 'bold 16px ' + FONT_LABEL,
                });
            }
        }

        // 手绘雷达（原点）
        function drawRadar(c, x, y) {
            // 底座
            c.beginPath();
            c.ellipse(x, y + 2, 20, 8, 0, 0, Math.PI * 2);
            c.fillStyle = 'rgba(45,42,50,0.15)';
            c.fill();
            sketchShape(c, [
                { x: x - 11, y: y + 2 }, { x: x + 11, y: y + 2 },
                { x: x + 6, y: y - 10 }, { x: x - 6, y: y - 10 }
            ], '#d9d4c7', 31, 1.8);
            // 天线盘（朝向 0°，即屏幕上方）
            c.beginPath();
            c.ellipse(x, y - 16, 16, 7, 0, Math.PI, 0, false);
            c.closePath();
            c.fillStyle = '#ffffff';
            c.fill();
            c.strokeStyle = INK;
            c.lineWidth = 2;
            c.stroke();
            c.beginPath();
            c.moveTo(x, y - 10); c.lineTo(x, y - 18);
            c.stroke();
            c.beginPath();
            c.arc(x, y - 22, 3, 0, Math.PI * 2);
            c.fillStyle = '#ff6b6b';
            c.fill();
            c.stroke();
            // 信号波纹
            c.strokeStyle = INK_SOFT;
            c.lineWidth = 1.6;
            for (var k = 1; k <= 2; k++) {
                c.beginPath();
                c.arc(x, y - 22, 6 + k * 5, -Math.PI * 0.75, -Math.PI * 0.25);
                c.stroke();
            }
        }

        // 手绘字体加载完成后重绘一次
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function() { _draw(ctx); });
        }

        self.render();
        return self;
    }

    return { create: create };
})();
