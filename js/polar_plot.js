/* ============================================
   极坐标图渲染器 (Canvas)
   ============================================ */

var PolarPlot = (function() {
    function create(canvasId, size) {
        var canvas = document.getElementById(canvasId);
        if (!canvas) return null;
        var ctx = canvas.getContext('2d');
        size = size || 400;
        canvas.width = size;
        canvas.height = size;

        var self = {
            canvas: canvas,
            ctx: ctx,
            size: size,
            cx: size / 2,
            cy: size / 2,
            maxR: size / 2 - 40,
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

        function _draw(c) {
            var s = size, cx = self.cx, cy = self.cy, mr = self.maxR;

            // Background
            c.fillStyle = '#f5f6fa';
            c.fillRect(0, 0, s, s);

            // Concentric circles (distance rings: 50mm, 100mm, 150mm)
            for (var r = 50; r <= 150; r += 50) {
                var radius = (r / 150) * mr;
                c.beginPath();
                c.arc(cx, cy, radius, 0, Math.PI * 2);
                c.strokeStyle = '#dfe6e9';
                c.lineWidth = 1;
                c.stroke();
                c.fillStyle = '#b2bec3';
                c.font = '10px sans-serif';
                c.fillText(r + 'mm', cx + radius + 3, cy - 3);
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

                var lx = cx + Math.cos(rad) * (mr + 18);
                var ly = cy + Math.sin(rad) * (mr + 18);
                c.fillStyle = '#636e72';
                c.font = '11px sans-serif';
                c.textAlign = 'center';
                c.fillText(a + '\u00b0', lx, ly + 4);
            }

            // Device dots
            var labels = ['T1', 'T2', 'T3'];
            for (var i = 0; i < 3; i++) {
                var dev = self.devices[i];
                if (!dev) continue;

                var dr = (dev.dis / 150) * mr;
                var drad = (dev.azi - 90) * Math.PI / 180;
                var dx = cx + Math.cos(drad) * dr;
                var dy = cy + Math.sin(drad) * dr;

                // Highlight ring when this device is pointed at
                if (i === self.highlightIdx) {
                    c.beginPath();
                    c.arc(dx, dy, 18, 0, Math.PI * 2);
                    c.fillStyle = 'rgba(255,215,0,0.3)';
                    c.fill();
                    c.strokeStyle = '#ffd700';
                    c.lineWidth = 3;
                    c.stroke();
                }

                // Dot
                c.beginPath();
                c.arc(dx, dy, 8, 0, Math.PI * 2);
                c.fillStyle = CONFIG.DEVICE_COLORS[i];
                c.fill();
                c.strokeStyle = '#fff';
                c.lineWidth = 2;
                c.stroke();

                // Label
                c.fillStyle = '#2d3436';
                c.font = 'bold 12px sans-serif';
                c.textAlign = 'center';
                c.fillText(labels[i], dx, dy - 14);
            }

            // Center dot
            c.beginPath();
            c.arc(cx, cy, 4, 0, Math.PI * 2);
            c.fillStyle = '#2d3436';
            c.fill();
        }

        self.render();
        return self;
    }

    return { create: create };
})();
