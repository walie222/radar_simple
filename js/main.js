/* ============================================
   主逻辑 - 设备登记 + P/T 设备行为 + BroadcastChannel 通信
   ============================================ */

var APP = (function() {
    var state = {
        deviceName: '',
        deviceType: null,     // 'P' | 'T1' | 'T2' | 'T3'
        channel: null,         // BroadcastChannel
    };

    // ---- DOM helpers ----
    function $(id) { return document.getElementById(id); }
    function showScreen(id) {
        document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
        $(id).classList.add('active');
    }

    // ---- BroadcastChannel ----
    function initChannel() {
        state.channel = new BroadcastChannel(CONFIG.CHANNEL_NAME);
        state.channel.onmessage = function(e) {
            if (!e || !e.data) return;
            handleBroadcast(e.data);
        };
    }

    function broadcast(data) {
        if (state.channel) {
            try { state.channel.postMessage(data); } catch(e) {}
        }
    }

    function handleBroadcast(data) {
        switch(data.type) {
            case 'best_idx':
                onBestIndexReceived(data.bestIdx);
                break;
            case 'reset':
                resetTDisplay();
                break;
        }
    }

    // ===================== 阶段 1: 设备登记 =====================
    function initRegister() {
        var btns = document.querySelectorAll('.device-btn');
        btns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                // Deselect all
                btns.forEach(function(b) { b.classList.remove('selected'); });
                btn.classList.add('selected');
                state.deviceType = btn.getAttribute('data-device');
                $('btn-enter').disabled = false;
            });
        });

        $('btn-enter').addEventListener('click', function() {
            if (!state.deviceType) return;
            var name = $('device-name').value.trim() || ('Device-' + state.deviceType);
            state.deviceName = name;

            // Show registered info briefly
            $('display-device-name').textContent = name;
            $('display-device-type').textContent = CONFIG.DEVICES[state.deviceType].label;
            $('registered-info').classList.remove('hidden');

            setTimeout(function() {
                enterSystem();
            }, 800);
        });
    }

    function enterSystem() {
        if (state.deviceType === 'P') {
            showScreen('screen-p-device');
            initPDevice();
        } else {
            showScreen('screen-t-device');
            initTDevice();
        }
    }

    // ===================== 阶段 2: P 设备 =====================
    var polarPlot = null;
    var serial = null;
    var dataProcessor = null;
    var pUpdateTimer = null;

    function initPDevice() {
        logMsg('主控设备已启动，等待串口连接...');

        // Init polar plot
        polarPlot = PolarPlot.create('polar-canvas', 400);

        // Init data processor
        dataProcessor = createDataProcessor();

        // Serial buttons
        $('btn-connect').addEventListener('click', connectSerial);
        $('btn-disconnect').addEventListener('click', disconnectSerial);
    }

    function connectSerial() {
        if (!navigator.serial) {
            alert('浏览器不支持 Web Serial API，请使用 Chrome/Edge');
            return;
        }

        serial = SerialReader.create();
        serial.onError = function(msg) { logMsg('[WARN] ' + msg, true); };

        // Data callback: accumulate per-device readings
        serial.onData = function(addr, dis, azi) {
            dataProcessor.receive(addr, dis, azi);
        };

        SerialReader.requestPort(serial).then(function() {
            $('status-dot').className = 'status-dot on';
            $('status-text').textContent = '已连接';
            $('btn-connect').classList.add('hidden');
            $('btn-disconnect').classList.remove('hidden');
            logMsg('串口已连接 (115200 baud)');

            SerialReader.startReading(serial);
            logMsg('开始读取串口数据...');

            // Start periodic processing at 1-second intervals
            startProcessingLoop();
        }).catch(function() {});
    }

    function disconnectSerial() {
        stopProcessingLoop();
        if (serial) {
            SerialReader.close(serial).then(function() {
                $('status-dot').className = 'status-dot off';
                $('status-text').textContent = '未连接';
                $('btn-connect').classList.remove('hidden');
                $('btn-disconnect').classList.add('hidden');
                logMsg('串口已断开');
                broadcast({ type: 'reset' });
                if (polarPlot) {
                    polarPlot.clearDevices();
                    polarPlot.setHighlight(-1);
                    polarPlot.render();
                }
                $('pointing-target').textContent = '--';
                $('pointing-status').textContent = '等待串口数据...';
            });
        }
    }

    // ---- 数据处理（参考 point_demo_test1.py） ----
    function createDataProcessor() {
        var d = CONFIG.DATA;
        // Per-address buffers
        var history = {};       // addr -> [{dis, azi}, ...]
        var smoothedAzi = {};   // addr -> smoothed azi value
        var currentReadings = {}; // addr -> {dis, azi} latest valid
        var pendingAddr = null;
        var pendingDis = null;

        function receive(addr, dis, azi) {
            // Convert azi to degrees (same as Python: azi / AZI_TO_DEG)
            var aziDeg = azi / d.aziToDeg;

            // Outlier check
            if (Math.abs(aziDeg) > d.aziOutlierThreshold) {
                return;
            }
            if (dis > d.disOutlierThreshold) {
                return;
            }

            // Normalize to [0, 360)
            while (aziDeg < 0) aziDeg += 360;
            while (aziDeg >= 360) aziDeg -= 360;

            // Clip display range
            if (aziDeg > d.maxDisplayAzi) {
                aziDeg = d.maxDisplayAzi;
            }

            // Store in history buffer
            if (!history[addr]) history[addr] = [];
            history[addr].push({ dis: dis, azi: aziDeg });
            if (history[addr].length > d.smoothingWindow) {
                history[addr].shift();
            }

            // Smooth azimuth
            if (history[addr].length >= d.smoothingWindow) {
                var sum = 0;
                for (var i = 0; i < history[addr].length; i++) {
                    sum += history[addr][i].azi;
                }
                var avgAzi = sum / history[addr].length;
                if (smoothedAzi[addr] !== undefined) {
                    avgAzi = d.smoothAlpha * avgAzi + (1 - d.smoothAlpha) * smoothedAzi[addr];
                }
                smoothedAzi[addr] = avgAzi;

                // Update current reading
                currentReadings[addr] = { dis: dis, azi: avgAzi };
            }
        }

        function processAll() {
            // Map addr to index: 01->0, 02->1, 03->2
            var bestIdx = -1;
            var minDiff = Infinity;

            for (var i = 0; i < CONFIG.DEVICE_ADDRS.length; i++) {
                var addr = CONFIG.DEVICE_ADDRS[i];
                if (!currentReadings[addr]) continue;
                var r = currentReadings[addr];

                // Check pointing criteria (same thresholds as Python)
                var aziOk = Math.abs(r.azi) <= d.pointingAziLimit;
                var disOk = r.dis <= d.pointingStableRange;

                if (aziOk && disOk) {
                    // Calculate deviation from center (0 degrees ideal)
                    var diff = Math.abs(r.azi);
                    if (diff < minDiff) {
                        minDiff = diff;
                        bestIdx = i;
                    }
                }
            }

            return { bestIdx: bestIdx, readings: Object.assign({}, currentReadings) };
        }

        function getReadings() {
            return Object.assign({}, currentReadings);
        }

        return { receive: receive, processAll: processAll, getReadings: getReadings };
    }

    function startProcessingLoop() {
        stopProcessingLoop();
        pUpdateTimer = setInterval(processTick, CONFIG.DATA.updateIntervalMs);
    }

    function stopProcessingLoop() {
        if (pUpdateTimer) {
            clearInterval(pUpdateTimer);
            pUpdateTimer = null;
        }
    }

    function processTick() {
        if (!dataProcessor) return;

        var result = dataProcessor.processAll();
        var readings = result.readings;

        // Update polar plot
        if (polarPlot) {
            for (var i = 0; i < CONFIG.DEVICE_ADDRS.length; i++) {
                var addr = CONFIG.DEVICE_ADDRS[i];
                if (readings[addr]) {
                    polarPlot.updateDevice(i, readings[addr].dis, readings[addr].azi);
                } else {
                    polarPlot.updateDevice(i, null, null);
                }
            }
        }

        // Update legend
        updateLegend(readings);

        // Determine best_idx and broadcast
        var bestIdx = result.bestIdx;
        if (bestIdx >= 0) {
            var targetNames = ['T1', 'T2', 'T3'];
            $('pointing-target').textContent = targetNames[bestIdx];
            $('pointing-status').textContent = '指向中 ✓';
            logMsg('→ 指向 ' + targetNames[bestIdx], true);

            // Highlight on polar plot
            if (polarPlot) {
                polarPlot.setHighlight(bestIdx);
            }

            // Broadcast to T devices
            broadcast({ type: 'best_idx', bestIdx: bestIdx });
        } else {
            $('pointing-target').textContent = '--';
            $('pointing-status').textContent = '无目标指向';
            if (polarPlot) {
                polarPlot.setHighlight(-1);
            }
            broadcast({ type: 'reset' });
        }

        // Re-render polar plot
        if (polarPlot) {
            polarPlot.render();
        }
    }

    function updateLegend(readings) {
        for (var i = 0; i < CONFIG.DEVICE_ADDRS.length; i++) {
            var addr = CONFIG.DEVICE_ADDRS[i];
            var el = $('legend-' + i);
            if (el && readings[addr]) {
                var r = readings[addr];
                el.querySelector('.legend-data').textContent =
                    '距离: ' + Math.round(r.dis) + 'mm  角度: ' + Math.round(r.azi) + '°';
            } else if (el) {
                el.querySelector('.legend-data').textContent = '距离: --mm  角度: --°';
            }
        }
    }

    // ===================== 阶段 3: T 设备 =====================
    function initTDevice() {
        var tIdx = getTIndex();

        $('t-device-name').textContent = state.deviceType;
        resetTDisplay();

        // The global BroadcastChannel already handles best_idx/reset messages
        // via handleBroadcast → onBestIndexReceived / resetTDisplay
    }

    function getTIndex() {
        if (state.deviceType === 'T1') return 0;
        if (state.deviceType === 'T2') return 1;
        if (state.deviceType === 'T3') return 2;
        return -1;
    }

    function onBestIndexReceived(bestIdx) {
        // Only T devices react to best_idx
        if (state.deviceType === 'P') return;

        var tIdx = getTIndex();
        if (bestIdx === tIdx) {
            setGreen();
        } else {
            setRed();
        }
    }

    function setGreen() {
        var display = $('t-status-display');
        display.className = 't-status-display green';
        $('t-status-text').textContent = '🎯 被指向！';
        $('t-status-badge').textContent = '雷达正指向你';
        $('t-device-icon').textContent = '🟢';
    }

    function setRed() {
        resetTDisplay();
    }

    function resetTDisplay() {
        var display = $('t-status-display');
        display.className = 't-status-display red';
        $('t-status-text').textContent = '等待指向...';
        $('t-status-badge').textContent = '未被指向';
        $('t-device-icon').textContent = '🔴';
    }

    // ===================== 日志 =====================
    function logMsg(text, isPoint) {
        var el = $('log-content');
        if (!el) return;
        var entry = document.createElement('div');
        entry.className = 'log-entry';
        if (isPoint) entry.classList.add('log-point');

        var now = new Date();
        var time = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
        entry.innerHTML = '<span class="log-time">[' + time + ']</span> ' + text;
        el.appendChild(entry);
        el.scrollTop = el.scrollHeight;

        // Limit entries
        while (el.children.length > 100) {
            el.removeChild(el.firstChild);
        }
    }

    function pad(n) { return n < 10 ? '0' + n : '' + n; }

    // ===================== 初始化 =====================
    function init() {
        initChannel();
        initRegister();
    }

    return { init: init };
})();

// Auto-start when DOM ready
document.addEventListener('DOMContentLoaded', APP.init);
