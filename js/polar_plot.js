/* ============================================
   极坐标图渲染器 (Canvas)
   ============================================ */

var PolarPlot = (function() {
    function create(canvasId, size) {
        var canvas = document.getElementById(canvasId);
        if (!canvas) return null;
        var ctx = canvas.getContext('2d');
        size = size || 900;
        canvas.width = size;
        canvas.height = size;

        var self = {
            canvas: canvas,
            ctx: ctx,
            size: size,
            cx: size / 2,
            cy: size / 2,
            maxR: size / 2 - 60,
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

        /* ---- Drawing constants ---- */
        // Auto-scale distance based on actual data (mirrors Python's adaptive scale)
        var DEFAULT_MAX_DIS = 1000;   // default max distance when no data
        var SCALE_MARGIN_FACTOR = 1.2; // 20% margin above max reading
        var SCALE_STEP = 200;         // ring step in mm

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
            // Round up to next SCALE_STEP
            return Math.ceil(scaled / SCALE_STEP) * SCALE_STEP;
        }

        function _draw(c) {
            var s = size, cx = self.cx, cy = self.cy, mr = self.maxR;
            var MAX_DIS = computeScale();
            // Build ring labels dynamically
            var RING_STEPS = [];
            for (var r = SCALE_STEP; r <= MAX_DIS; r += SCALE_STEP) {
                RING_STEPS.push(r);
            }

            // Background
            c.fillStyle = '#f5f6fa';
            c.fillRect(0, 0, s, s);

            // Concentric circles (distance rings)
            for (var ri = 0; ri < RING_STEPS.length; ri++) {
                var rLabel = RING_STEPS[ri];
                var radius = (rLabel / MAX_DIS) * mr;
                c.beginPath();
                c.arc(cx, cy, radius, 0, Math.PI * 2);
                c.strokeStyle = '#dfe6e9';
                c.lineWidth = 1;
                c.stroke();
                c.fillStyle = '#b2bec3';
                c.font = '13px sans-serif';
                c.textAlign = 'left';
                c.fillText(rLabel + 'mm', cx + radius + 5, cy - 5);
            }

            // Azimuth lines (every 30 degrees)
            for (var a = 0; a < 360; a += 30) {
                var rad = (a - 90) * Math.PI / 180;
                c.beginPath();
                c.moveTo(cx, cy);
                c.lineTo(cx + Math.cos(rad) * mr, cy + Math.sin(rad) * mr);
                c.strokeStyle = a % 90 === 0 ? '#b2bec3' : '#ecf0f1';
                c.lineWidth = a % 90 === 0 ? 1.5 : 0.5;
                c.stroke();

                var lx = cx + Math.cos(rad) * (mr + 25);
                var ly = cy + Math.sin(rad) * (mr + 25);
                c.fillStyle = '#636e72';
                c.font = '14px sans-serif';
                c.textAlign = 'center';
                c.fillText(a + '\u00b0', lx, ly + 4);
            }

            // Device dots
            var labels = ['T1', 'T2', 'T3'];
            for (var i = 0; i < 3; i++) {
                var dev = self.devices[i];
                if (!dev) continue;

                // Clamp distance to max display range so dot stays on chart
                var clampedDis = Math.min(dev.dis, MAX_DIS);
                var dr = (clampedDis / MAX_DIS) * mr;
                var drad = (dev.azi - 90) * Math.PI / 180;
                var dx = cx + Math.cos(drad) * dr;
                var dy = cy + Math.sin(drad) * dr;

                // Highlight ring when this device is pointed at
                if (i === self.highlightIdx) {
                    c.beginPath();
                    c.arc(dx, dy, 24, 0, Math.PI * 2);
                    c.fillStyle = 'rgba(255,215,0,0.3)';
                    c.fill();
                    c.strokeStyle = '#ffd700';
                    c.lineWidth = 3;
                    c.stroke();
                }

                // Dot
                c.beginPath();
                c.arc(dx, dy, 9, 0, Math.PI * 2);
                c.fillStyle = CONFIG.DEVICE_COLORS[i];
                c.fill();
                c.strokeStyle = '#fff';
                c.lineWidth = 2;
                c.stroke();

                // Label
                c.fillStyle = '#2d3436';
                c.font = 'bold 13px sans-serif';
                c.textAlign = 'center';
                c.fillText(labels[i], dx, dy - 16);
            }

            // Center dot
            c.beginPath();
            c.arc(cx, cy, 5, 0, Math.PI * 2);
            c.fillStyle = '#2d3436';
            c.fill();
        }

        self.render();
        return self;
    }

    return { create: create };
})();
