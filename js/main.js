/* ============================================
   主逻辑 — 对齐当前 index.html 结构
   指向逻辑严格对齐 D:\radar-demo\point_demo_test1.py
   ============================================ */

// ========== Global State ==========
var state = {
    deviceId: generateDeviceId(),
    deviceType: null,       // 'P' or 'T1'/'T2'/'T3'
    serialReader: null,
    polarPlot: null,
    devices: [null, null, null],
    currentBestIdx: -1,     // 当前被指向的设备索引 (-1=无)
    isMaster: false,
    pubnub: null,
};

// ========== DOM References (aligned with current index.html) ==========
var screens = {
    register: document.getElementById('screen-register'),
    pDevice:  document.getElementById('screen-p-device'),
    tDevice:  document.getElementById('screen-t-device'),
};

var pUI = {
    statusDot:      document.getElementById('status-dot'),
    statusText:     document.getElementById('status-text'),
    btnConnect:     document.getElementById('btn-connect'),
    btnDisconnect:  document.getElementById('btn-disconnect'),
    polarCanvas:    document.getElementById('polar-canvas'),
    logContent:     document.getElementById('log-content'),
    pointingTarget: document.getElementById('pointing-target'),
    pointingStatus: document.getElementById('pointing-status'),
};

var tUI = {
    statusDisplay: document.getElementById('t-status-display'),
    deviceIcon:    document.getElementById('t-device-icon'),
    deviceName:    document.getElementById('t-device-name'),
    statusText:    document.getElementById('t-status-text'),
    statusBadge:   document.getElementById('t-status-badge'),
};

// Registration form elements
var regUI = {
    deviceNameInput: document.getElementById('device-name'),
    deviceButtons:   document.querySelectorAll('.device-btn'),
    btnEnter:        document.getElementById('btn-enter'),
    registeredInfo:  document.getElementById('registered-info'),
    displayName:     document.getElementById('display-device-name'),
    displayType:     document.getElementById('display-device-type'),
};

// ========== Init ==========
// Scripts load at end of <body>, DOMContentLoaded may have already fired.
// Run init immediately if DOM is ready, otherwise wait for the event.
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    // Small delay to ensure all scripts are parsed
    setTimeout(initRegistration, 0);
} else {
    document.addEventListener('DOMContentLoaded', function () {
        initRegistration();
    });
}

// ========== Registration ==========
function initRegistration() {
    console.log('[Init] Found', regUI.deviceButtons.length, 'device buttons');
    console.log('[Init] btnEnter element:', regUI.btnEnter);
    // Device type selection
    for (var i = 0; i < regUI.deviceButtons.length; i++) {
        (function (btn) {
            btn.addEventListener('click', function () {
                console.log('[Click] Selected device:', btn.dataset.device);
                selectDevice(btn);
            });
        })(regUI.deviceButtons[i]);
    }

    // Enter button
    regUI.btnEnter.addEventListener('click', function () {
        if (state.deviceType) {
            showRoomInfo(state.deviceType);
        }
    });
}

function selectDevice(btn) {
    // Deselect all
    for (var i = 0; i < regUI.deviceButtons.length; i++) {
        regUI.deviceButtons[i].classList.remove('selected');
    }
    // Select this one
    btn.classList.add('selected');
    state.deviceType = btn.dataset.device;

    // Enable enter button
    regUI.btnEnter.disabled = false;
}

function showRoomInfo(role) {
    // Hide registration screen
    screens.register.classList.remove('active');
    screens.register.style.display = 'none';

    // Show room info overlay
    var roomOverlay = document.createElement('div');
    roomOverlay.id = 'room-overlay';
    roomOverlay.className = 'overlay';
    roomOverlay.innerHTML =
        '<div class="room-info-box">' +
            '<h2>' + CONFIG.DEVICES[role].icon + ' ' + CONFIG.DEVICES[role].label + '</h2>' +
            '<p class="room-code-label">房间号</p>' +
            '<p class="room-code-value">' + CONFIG.ROOM_CODE + '</p>' +
            '<p class="room-hint">所有设备自动加入同一房间，无需手动输入</p>' +
            '<button id="btn-enter-room" class="btn-primary">进入系统</button>' +
        '</div>';
    document.body.appendChild(roomOverlay);

    document.getElementById('btn-enter-room').addEventListener('click', function () {
        document.body.removeChild(roomOverlay);
        enterSystem(state.deviceType);
    });
}

function enterSystem(deviceType) {
    if (deviceType === 'P') {
        screens.pDevice.style.display = 'block';
        screens.pDevice.classList.add('active');
        initPScreen();
    } else {
        screens.tDevice.style.display = 'block';
        screens.tDevice.classList.add('active');
        initTScreen(deviceType);
    }
}

// ========== PubNub Setup ==========
function initPubNub() {
    state.pubnub = new PubNub({
        publishKey: CONFIG.PUBNUB.publishKey,
        subscribeKey: CONFIG.PUBNUB.subscribeKey,
        uuid: state.deviceId,
    });

    state.pubnub.subscribe({ channels: [CONFIG.CHANNEL_NAME] });

    state.pubnub.addListener({
        message: function (m) {
            onPubNubMessage(m.message, m.publisher);
        },
        status: function (statusEvent) {
            if (statusEvent.category === 'PNConnectedCategory') {
                logMsg('[PubNub] 已连接到房间 ' + CONFIG.ROOM_CODE);
                broadcastPresence();
            }
            if (statusEvent.category === 'PNDisconnectedCategory') {
                logMsg('[PubNub] 连接断开，正在重连...');
            }
        },
    });
}

function broadcastMessage(msg) {
    if (!state.pubnub) return;
    msg.timestamp = Date.now();
    msg.sender = state.deviceId;
    state.pubnub.publish({
        channel: CONFIG.CHANNEL_NAME,
        message: msg,
    });
}

function broadcastPresence() {
    broadcastMessage({
        type: 'presence',
        deviceType: state.deviceType,
        deviceId: state.deviceId,
    });
}

// ========== P Screen ==========
function initPScreen() {
    logMsg('主控设备已启动，等待串口连接...');
    pUI.statusText.textContent = '未连接';
    pUI.pointingTarget.textContent = '--';
    pUI.pointingStatus.textContent = '等待串口数据...';

    // Initialize PubNub
    initPubNub();

    // Initialize polar plot
    state.polarPlot = PolarPlot.create('polar-canvas');

    // Connect/disconnect buttons
    pUI.btnConnect.addEventListener('click', startSerialConnection);
    pUI.btnDisconnect.addEventListener('click', disconnectSerial);

    // Periodic heartbeat
    setInterval(function () {
        if (state.isMaster && state.serialReader && state.serialReader.running) {
            broadcastPresence();
        }
    }, 5000);
}

// ========== T Screen ==========
function initTScreen(deviceType) {
    tUI.deviceName.textContent = CONFIG.DEVICES[deviceType].label;
    tUI.statusText.textContent = '等待指向...';
    tUI.statusBadge.textContent = '未被指向';
    tUI.statusDisplay.className = 't-status-display red';

    // Initialize PubNub
    initPubNub();
}

// ========== Serial Connection ==========
function startSerialConnection() {
    if (!navigator.serial) {
        logMsg('❌ 当前浏览器不支持 Web Serial API');
        pUI.statusText.textContent = '❌ 不支持 Web Serial';
        return;
    }

    state.serialReader = SerialReader.create();
    state.serialReader.onData = onData;

    SerialReader.requestPort(state.serialReader).then(function () {
        state.isMaster = true;
        pUI.statusText.textContent = '已连接';
        pUI.statusDot.className = 'status-dot on';
        pUI.btnConnect.classList.add('hidden');
        pUI.btnDisconnect.classList.remove('hidden');
        logMsg('✅ 串口已连接，开始读取数据...');
        SerialReader.startReading(state.serialReader);
    }).catch(function (err) {
        logMsg('❌ 串口连接失败: ' + err.message);
        pUI.statusText.textContent = '❌ 连接失败';
    });
}

function disconnectSerial() {
    if (state.serialReader) {
        SerialReader.close(state.serialReader);
        state.isMaster = false;
        pUI.statusText.textContent = '未连接';
        pUI.statusDot.className = 'status-dot off';
        pUI.btnConnect.classList.remove('hidden');
        pUI.btnDisconnect.classList.add('hidden');
        logMsg('⚠️ 串口已断开');
    }
}

// ========== Data Processing ==========
// 严格对齐 point_demo_test1.py 的数据处理逻辑：
// 1. 每收到一条数据，存入对应设备的原始数据队列（最多 SMOOTHING_WINDOW=5 条）
// 2. 计算窗口均值 → EMA(alpha=0.3) 平滑
// 3. 更新极坐标图 + 图例
// 4. 调用 computeBestIdx() 判断指向（和 Python 完全一致）
function onData(addr, dis, azi) {
    if (addr === null || dis === null || azi === null) return;

    // Map addr string to index (01→0, 02→1, 03→2)
    var idx = parseInt(addr, 10) - 1;
    if (idx < 0 || idx > 2) return;

    try {
        processData(idx, dis, azi);
    } catch(e) {
        console.error('[main.onData] crash:', e);
    }
}

function processData(idx, dis, azi) {

    var dev = state.devices[idx];
    if (!dev) {
        dev = { smoothedDis: dis, smoothedAzi: azi, history: [] };
        state.devices[idx] = dev;
    }

    // Step 1: Push raw data into window buffer (max SMOOTHING_WINDOW entries)
    dev.history.push({ dis: dis, azi: azi });
    if (dev.history.length > CONFIG.DATA.smoothingWindow) {
        dev.history.shift();
    }

    // Step 2: Compute window average then apply EMA smoothing
    var avgDis = 0, avgAzi = 0;
    for (var i = 0; i < dev.history.length; i++) {
        avgDis += dev.history[i].dis;
        avgAzi += dev.history[i].azi;
    }
    avgDis /= dev.history.length;
    avgAzi /= dev.history.length;

    var alpha = CONFIG.DATA.smoothAlpha;
    dev.smoothedDis = alpha * avgDis + (1 - alpha) * dev.smoothedDis;
    dev.smoothedAzi = alpha * avgAzi + (1 - alpha) * dev.smoothedAzi;

    var aziDeg = parseFloat((dev.smoothedAzi / CONFIG.DATA.aziToDeg).toFixed(1));
    var disMm  = Math.round(dev.smoothedDis);

    // Step 3: Update polar plot and legend
    state.polarPlot.updateDevice(idx, disMm, aziDeg);

    updateLegend(idx, disMm, aziDeg);

    // Step 4: Compute best_idx across ALL devices (same as Python's compute_best_idx)
    var newBestIdx = computeBestIdx();

    // If best_idx changed, update highlight and broadcast
    if (newBestIdx !== state.currentBestIdx) {
        state.currentBestIdx = newBestIdx;
        updateHighlight(newBestIdx);
        broadcastPointingState(newBestIdx);
    }

    // Render polar plot with current highlight
    state.polarPlot.setHighlight(state.currentBestIdx);
    state.polarPlot.render();
}

/**
 * 更新图例文字
 */
function updateLegend(idx, dis, azi) {
    var legendItem = document.getElementById('legend-' + idx);
    if (legendItem) {
        var dataSpan = legendItem.querySelector('.legend-data');
        if (dataSpan) {
            dataSpan.textContent = '距离: ' + dis + 'mm  角度: ' + azi + '°';
        }
    }
}

/**
 * 严格对齐 point_demo_test1.py 中的 compute_best_idx()
 */
function computeBestIdx() {
    for (var i = 0; i < 3; i++) {
        var dev = state.devices[i];
        if (!dev) continue;

        var lastDis = dev.smoothedDis;
        var lastAzi = dev.smoothedAzi / CONFIG.DATA.aziToDeg;  // 转为度数

        // 必须有有效数据
        if (lastDis == null || lastAzi == null) continue;

        // 距离条件
        if (lastDis < CONFIG.DATA.distStableRange) continue;

        // 角度条件
        if (Math.abs(lastAzi) > CONFIG.DATA.aziPointingThreshold) continue;

        // 第一个满足全部条件的设备即是被指向的设备
        return i;
    }
    return -1;  // 无设备满足条件
}

/**
 * 更新极坐标图高亮 + UI 指示器
 */
function updateHighlight(bestIdx) {
    if (bestIdx >= 0) {
        var targetType = 'T' + (bestIdx + 1);
        var dev = state.devices[bestIdx];
        var dis = Math.round(dev.smoothedDis);
        var azi = parseFloat((dev.smoothedAzi / CONFIG.DATA.aziToDeg).toFixed(1));

        pUI.pointingTarget.textContent = CONFIG.DEVICE_ADDRS[bestIdx] + ' (' + targetType + ')';
        pUI.pointingStatus.textContent = '指向中 | 距离:' + dis + 'mm 角度:' + azi + '°';
        logMsg('🎯 指向 ' + targetType + ' (距离:' + dis + 'mm, 角度:' + azi + '°)');
    } else {
        pUI.pointingTarget.textContent = '--';
        pUI.pointingStatus.textContent = '等待串口数据...';
    }
}

/**
 * 通过 PubNub 广播当前指向状态给所有 T 设备
 */
function broadcastPointingState(bestIdx) {
    if (!state.pubnub) return;

    if (bestIdx >= 0) {
        var targetType = 'T' + (bestIdx + 1);
        var dev = state.devices[bestIdx];
        var dis = Math.round(dev.smoothedDis);
        var azi = parseFloat((dev.smoothedAzi / CONFIG.DATA.aziToDeg).toFixed(1));

        broadcastMessage({
            type: 'point_at',
            target: targetType,
            dis: dis,
            azi: azi,
        });
    } else {
        broadcastMessage({
            type: 'point_stop',
        });
    }
}

// ========== PubNub Message Handler ==========
function onPubNubMessage(msg, senderId) {
    // Ignore messages from self
    if (senderId === state.deviceId) return;

    switch (msg.type) {
        case 'presence':
            if (state.deviceType === 'P') {
                logMsg('[房间] 设备加入: ' + msg.deviceType + ' (' + msg.deviceId.substr(-6) + ')');
            }
            break;

        case 'raw_data':
            // Raw radar data — P already displays locally
            break;

        case 'point_at':
            handlePointAt(msg);
            break;

        case 'point_stop':
            handlePointStop();
            break;
    }
}

function handlePointAt(msg) {
    if (state.deviceType === msg.target) {
        // This T device is being pointed at → turn GREEN!
        tUI.statusDisplay.className = 't-status-display green';
        tUI.deviceIcon.textContent = '🟢';
        tUI.statusText.textContent = '被指向中！';
        tUI.statusBadge.textContent = '距离: ' + msg.dis + 'mm | 角度: ' + msg.azi + '°';
    }
}

function handlePointStop() {
    if (state.deviceType && state.deviceType !== 'P') {
        // Reset T device display
        tUI.statusDisplay.className = 't-status-display red';
        tUI.deviceIcon.textContent = '🔴';
        tUI.statusText.textContent = '等待指向...';
        tUI.statusBadge.textContent = '未被指向';
    }
}

// ========== Logging ==========
function logMsg(text) {
    var time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    var entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = '[' + time + '] ' + text;
    pUI.logContent.appendChild(entry);
    pUI.logContent.scrollTop = pUI.logContent.scrollHeight;
}
