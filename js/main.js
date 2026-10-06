/* ============================================
   主逻辑 - 设备登记 + P/T 设备行为 + BroadcastChannel 通信
   ============================================ */

var APP = (function() {
    var state = {
        deviceName: '',
        deviceType: null,     // 'P' | 'T1' | 'T2' | 'T3'
        channel: null,         // BroadcastChannel
        filteredPos: null,    // Alpha-filtered positions (mirrors Python's self.filtered_positions)
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
        polarPlot = PolarPlot.create('polar-canvas', 350);

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

        // Data callback: accumulate per-device readings (raw values, like Python's parse_and_update)
        serial.onData = function(line, addr, dis, azi) {
            if (addr === null) {
                // Unparseable line — log for debugging
                logMsg('[原始] ' + line);
                return;
            }
            logMsg('[解析] ' + line);
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

    // ---- 数据处理（严格参考 point_demo_test1.py） ----
    // Python architecture:
    //   - addr_azis[addr] = deque of raw azi values
    //   - addr_dises[addr] = deque of raw dis values
    //   - on timer tick: get_last_measurement(addr) returns (azis[-1], dises[-1])
    //   - get_current_positions(): if len >= SMOOTHING_WINDOW return mean, else None
    //   - is_valid_measurement(): outlier check on raw values vs previous mean
    function createDataProcessor() {
        var d = CONFIG.DATA;
        // Per-address raw buffers (mirrors Python's addr_azis / addr_dises deques)
        var addrAzis = {};    // addr -> [raw_azi, ...]
        var addrDises = {};   // addr -> [raw_dis, ...]

        // Initialize empty buffers for each device address
        for (var i = 0; i < CONFIG.DEVICE_ADDRS.length; i++) {
            var addr = CONFIG.DEVICE_ADDRS[i];
            addrAzis[addr] = [];
            addrDises[addr] = [];
        }

        function receive(addr, dis, azi) {
            if (!addrAzis[addr]) {
                addrAzis[addr] = [];
                addrDises[addr] = [];
            }
            addrAzis[addr].push(azi);
            addrDises[addr].push(dis);

            // Enforce max window size (same as Python's deque maxlen)
            while (addrAzis[addr].length > d.smoothingWindow) {
                addrAzis[addr].shift();
            }
            while (addrDises[addr].length > d.smoothingWindow) {
                addrDises[addr].shift();
            }
        }

        // Mirrors Python's get_last_measurement(addr): returns (azi, dis) of last reading or (null, null)
        function getLastMeasurement(addr) {
            var azis = addrAzis[addr];
            var dises = addrDises[addr];
            if (azis && azis.length > 0 && dises && dises.length > 0) {
                return { azi: azis[azis.length - 1], dis: dises[dises.length - 1] };
            }
            return { azi: null, dis: null };
        }

        // Mirrors Python's get_current_positions(): mean if enough samples, else None
        function getCurrentPositions() {
            var positions = {};
            for (var i = 0; i < CONFIG.DEVICE_ADDRS.length; i++) {
                var addr = CONFIG.DEVICE_ADDRS[i];
                var azis = addrAzis[addr];
                var dises = addrDises[addr];
                if (azis && azis.length >= d.smoothingWindow && dises && dises.length >= d.smoothingWindow) {
                    var aziSum = 0, disSum = 0;
                    for (var j = 0; j < azis.length; j++) aziSum += azis[j];
                    for (var j = 0; j < dises.length; j++) disSum += dises[j];
                    positions[addr] = { azi: aziSum / azis.length, dis: disSum / dises.length };
                } else {
                    positions[addr] = { azi: null, dis: null };
                }
            }
            return positions;
        }

        // Mirrors Python's is_valid_measurement(addr)
        function isValidMeasurement(addr) {
            var azis = addrAzis[addr];
            var dises = addrDises[addr];
            if (!azis || !dises || azis.length < d.smoothingWindow || dises.length < d.smoothingWindow) {
                return false;
            }
            var currentAzi = azis[azis.length - 1];
            var currentDis = dises[dises.length - 1];
            if (currentDis < 0) return false;

            // Mean of all but last
            var aziPrevSum = 0, disPrevSum = 0;
            for (var j = 0; j < azis.length - 1; j++) {
                aziPrevSum += azis[j];
                disPrevSum += dises[j];
            }
            var prevCount = azis.length - 1;
            if (prevCount === 0) return false;
            var aziMean = aziPrevSum / prevCount;
            var disMean = disPrevSum / prevCount;

            if (Math.abs(currentAzi - aziMean) > d.aziOutlierThreshold) return false;
            if (Math.abs(currentDis - disMean) > d.disOutlierThreshold) return false;
            return true;
        }

        // Mirrors Python's get_highlight_index() logic
        function getHighlightIndex() {
            var deviceAvgs = {};
            for (var idx = 0; idx < CONFIG.DEVICE_ADDRS.length; idx++) {
                var addr = CONFIG.DEVICE_ADDRS[idx];
                var azis = addrAzis[addr];
                var dises = addrDises[addr];
                if (azis && azis.length >= d.smoothingWindow &&
                    dises && dises.length >= d.smoothingWindow &&
                    isValidMeasurement(addr)) {
                    var sum = 0;
                    for (var j = 0; j < azis.length; j++) sum += azis[j];
                    deviceAvgs[idx] = sum / azis.length;
                } else {
                    deviceAvgs[idx] = null;
                }
            }

            // Filter valid averages
            var validAvgs = {};
            for (var k in deviceAvgs) {
                if (deviceAvgs[k] !== null) validAvgs[k] = deviceAvgs[k];
            }

            if (Object.keys(validAvgs).length < 1) return -1;

            // Find device with avg closest to 0
            var bestIdx = -1;
            var bestAbs = Infinity;
            for (var k in validAvgs) {
                var absVal = Math.abs(validAvgs[k]);
                if (absVal < bestAbs) {
                    bestAbs = absVal;
                    bestIdx = parseInt(k, 10);
                }
            }

            var bestAzi = validAvgs[bestIdx];

            // Stability check: range within window AND avg within pointing limit
            var azisList = addrAzis[CONFIG.DEVICE_ADDRS[bestIdx]];
            var maxAzi = azisList[0], minAzi = azisList[0];
            for (var j = 1; j < azisList.length; j++) {
                if (azisList[j] > maxAzi) maxAzi = azisList[j];
                if (azisList[j] < minAzi) minAzi = azisList[j];
            }
            var aziRange = maxAzi - minAzi;

            if (aziRange <= d.pointingStableRange && Math.abs(bestAzi) <= d.pointingAziLimit) {
                return bestIdx;
            }
            return -1;
        }

        // Get all last measurements as array (for display update)
        function getAllLastMeasurements() {
            var result = [];
            for (var i = 0; i < CONFIG.DEVICE_ADDRS.length; i++) {
                var m = getLastMeasurement(CONFIG.DEVICE_ADDRS[i]);
                result.push(m);
            }
            return result;
        }

        return {
            receive: receive,
            getCurrentPositions: getCurrentPositions,
            getAllLastMeasurements: getAllLastMeasurements,
            getHighlightIndex: getHighlightIndex,
            isValidMeasurement: isValidMeasurement,
        };
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

        // Get raw last measurements (mirrors Python's _all_last_measurements)
        var rawMeasurements = dataProcessor.getAllLastMeasurements();

        // Apply alpha filtering (mirrors Python's update_display alpha filter)
        var filteredPositions = [];
        for (var i = 0; i < CONFIG.DEVICE_ADDRS.length; i++) {
            var newAzi = rawMeasurements[i].azi;
            var newDis = rawMeasurements[i].dis;

            if (newAzi === null || newDis === null) {
                filteredPositions.push({ azi: null, dis: null });
            } else if (!state.filteredPos || state.filteredPos[i].azi === null || state.filteredPos[i].dis === null) {
                filteredPositions.push({ azi: newAzi, dis: newDis });
            } else {
                var oldAzi = state.filteredPos[i].azi;
                var oldDis = state.filteredPos[i].dis;
                var filtAzi = oldAzi * CONFIG.DATA.smoothAlpha + newAzi * (1 - CONFIG.DATA.smoothAlpha);
                var filtDis = oldDis * CONFIG.DATA.smoothAlpha + newDis * (1 - CONFIG.DATA.smoothAlpha);
                filteredPositions.push({ azi: filtAzi, dis: filtDis });
            }
        }
        state.filteredPos = filteredPositions;

        // Convert raw azi values to degrees for display (Python divides by AZI_TO_DEG at display time)
        var readings = {};
        for (var i = 0; i < CONFIG.DEVICE_ADDRS.length; i++) {
            var addr = CONFIG.DEVICE_ADDRS[i];
            if (filteredPositions[i].azi !== null && filteredPositions[i].dis !== null) {
                readings[addr] = {
                    dis: filteredPositions[i].dis,
                    azi: filteredPositions[i].azi / CONFIG.DATA.aziToDeg,  // raw → degrees for display
                };
            }
        }

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

        // Determine best_idx using highlight logic (mirrors Python's get_highlight_index)
        var bestIdx = dataProcessor.getHighlightIndex();
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
