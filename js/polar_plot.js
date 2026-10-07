/* ============================================
   极坐标图渲染器 (Canvas) — 半圆 -90° ~ +90°
   对齐 point_demo.py 的 MAX_DISPLAY_AZI=90 设计
   ============================================ */

var PolarPlot = (function() {
    function create(canvasId) {
        var canvas = document.getElementById(canvasId);
        if (!canvas) return null;
        var ctx = canvas.getContext('2d');

        /* ---- 画布尺寸（横版，适配半圆）---- */
        var W = 750, H = 500;
        canvas.width = W;
        canvas.height = H;

        /* ---- 画布几何 ---- */
        var PAD_TOP = 50;            // 顶部留给角度标注
        var PAD_BOTTOM = 40;         // 底部边距
        var PAD_LEFT = 60;           // 左侧边距
        var PAD_RIGHT = 60;          // 右侧边距
        var cx = W / 2;              // 圆心 X = 画布正中
        var cy = H - PAD_BOTTOM;     // 圆心 Y = 接近底部
        var maxR = Math.min(cy - PAD_TOP, cx - PAD_LEFT, cx - PAD_RIGHT);

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

        self.updateDevice = function(idx, dis, azi) {
            if (idx >= 0 && idx <= 2) {
                self.devices[idx] = { dis: Number(dis), azi: Number(azi) };
            }
        };

        self.clearDevices = function() {
            self.devices = [null, null, null];
        };

        self.setHighlight = function(idx) {
            self.highlightIdx = idx; // 0/1/2 or -1
        };

        self.render = function() {
            _draw(ctx);
        };

        /* ---- 绘制常量 ---- */
        var DEFAULT_MAX_DIS = 1000;
        var SCALE_MARGIN_FACTOR = 1.2;
        var SCALE_STEP = 200;
        var MAX_DISPLAY_AZI = 90;       // 显示范围 ±90°

        // 角度标注映射（原始 azi → 屏幕标签）
        var CARDINAL_LABELS = {
            '-90': '-90°', '-60': '-60°', '-30': '-30°',
            '0': '0°', '30': '30°', '60': '60°', '90': '90°'
        };

        /**
         * 将方位角 (°) 转换为 Canvas 绘图角度 (rad)
         * 0° 指向正上方，-90° 在左侧，+90° 在右侧
         */
        function aziToRad(aziDeg) {
            // azi=0 → 正上方(π/2 from +x)，azi=-90 → 左方(π)，azi=+90 → 右方(0)
            return (Math.PI / 2) - (aziDeg * Math.PI / 180);
        }

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

        function _draw(c) {
            var w = W, h = H, mr = self.maxR;
            var MAX_DIS = computeScale();

            // Build ring labels dynamically
            var RING_STEPS = [];
            for (var r = SCALE_STEP; r <= MAX_DIS; r += SCALE_STEP) {
                RING_STEPS.push(r);
            }

            // ===== 背景 =====
            c.fillStyle = '#f5f6fa';
            c.fillRect(0, 0, w, h);

            // ===== 扇形外边框（上半圆弧 + 底边）=====
            c.beginPath();
            c.arc(cx, cy, mr, Math.PI, 2 * Math.PI, false); // 从 π(左) 逆时针到 2π(右)，即上半圆
            c.strokeStyle = '#94a3b8';
            c.lineWidth = 2.5;
            c.stroke();
            // 底边
            c.beginPath();
            c.moveTo(cx - mr, cy);
            c.lineTo(cx + mr, cy);
            c.stroke();

            // ===== 同心半圆弧（距离刻度环）=====
            for (var ri = 0; ri < RING_STEPS.length; ri++) {
                var rLabel = RING_STEPS[ri];
                var radius = (rLabel / MAX_DIS) * mr;
                c.beginPath();
                c.arc(cx, cy, radius, Math.PI, 2 * Math.PI, false);
                c.strokeStyle = '#cbd5e1';
                c.lineWidth = 1.2;
                c.setLineDash([5, 5]);
                c.stroke();
                c.setLineDash([]);

                // 标签（画在右侧弧上）
                c.fillStyle = '#64748b';
                c.font = 'bold 15px sans-serif';
                c.textAlign = 'left';
                c.fillText(rLabel + 'mm', cx + radius + 8, cy - 8);
            }

            // ===== 径向线（每 30° 一条）=====
            for (var a = -MAX_DISPLAY_AZI; a <= MAX_DISPLAY_AZI; a += 30) {
                var rad = aziToRad(a);
                var ex = cx + mr * Math.cos(rad);
                var ey = cy - mr * Math.sin(rad);

                c.beginPath();
                c.moveTo(cx, cy);
                c.lineTo(ex, ey);

                if (a === -MAX_DISPLAY_AZI || a === MAX_DISPLAY_AZI) {
                    // 两侧边界线（已在扇形边框中绘制，此处跳过）
                    continue;
                } else if (a === 0) {
                    c.strokeStyle = '#94a3b8';
                    c.lineWidth = 1.5;
                    c.setLineDash([6, 6]);
                } else {
                    c.strokeStyle = '#e2e8f0';
                    c.lineWidth = 1;
                    c.setLineDash([4, 4]);
                }
                c.stroke();
                c.setLineDash([]);
            }

            // ===== 角度标注 =====
            for (var a = -MAX_DISPLAY_AZI; a <= MAX_DISPLAY_AZI; a += 30) {
                var rad = aziToRad(a);
                var label = CARDINAL_LABELS[String(a)] || (a + '°');
                var textR = mr + 28;
                var tx = cx + textR * Math.cos(rad);
                var ty = cy - textR * Math.sin(rad);

                c.fillStyle = '#334155';
                c.font = 'bold 16px sans-serif';
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.fillText(label, tx, ty);
            }

            // ===== 中心点 =====
            c.beginPath();
            c.arc(cx, cy, 6, 0, Math.PI * 2);
            c.fillStyle = '#475569';
            c.fill();

            // ===== 设备数据点 =====
            var labels = CONFIG.DEVICE_LABELS;
            for (var i = 0; i < 3; i++) {
                var dev = self.devices[i];
                if (!dev) continue;

                // 超出 ±90° 范围的点不显示
                if (Math.abs(dev.azi) > MAX_DISPLAY_AZI) continue;

                // 距离映射
                var clampedDis = Math.min(dev.dis, MAX_DIS);
                var dr = (clampedDis / MAX_DIS) * mr;
                var drad = aziToRad(dev.azi);
                var dx = cx + dr * Math.cos(drad);
                var dy = cy - dr * Math.sin(drad);

                // 连接虚线（圆心 → 数据点）
                c.beginPath();
                c.moveTo(cx, cy);
                c.lineTo(dx, dy);
                c.strokeStyle = CONFIG.DEVICE_COLORS[i] + '7F'; // 50% alpha hex
                c.lineWidth = 1.5;
                c.setLineDash([6, 4]);
                c.stroke();
                c.setLineDash([]);

                // 高亮光环
                if (i === self.highlightIdx) {
                    // 外发光
                    c.beginPath();
                    c.arc(dx, dy, 22, 0, Math.PI * 2);
                    c.fillStyle = 'rgba(0, 230, 118, 0.25)';
                    c.fill();
                    // 金色光环
                    c.beginPath();
                    c.arc(dx, dy, 26, 0, Math.PI * 2);
                    c.strokeStyle = '#ffd700';
                    c.lineWidth = 3.5;
                    c.stroke();
                }

                // 实心圆点
                c.beginPath();
                c.arc(dx, dy, 9, 0, Math.PI * 2);
                c.fillStyle = CONFIG.DEVICE_COLORS[i];
                c.fill();
                c.strokeStyle = '#fff';
                c.lineWidth = 2.5;
                c.stroke();

                // 标签
                c.fillStyle = '#1e293b';
                c.font = 'bold 16px sans-serif';
                c.textAlign = 'center';
                c.textBaseline = 'alphabetic';
                c.fillText(labels[i], dx, dy - 22);
            }
        }

        self.render();
        return self;
    }

    return { create: create };
})();
