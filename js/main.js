/* ============================================
   主逻辑 — 对齐当前 index.html 结构
   ============================================ */

// ========== Global State ==========
var state = {
    deviceId: generateDeviceId(),
    deviceType: null,       // 'P' or 'T1'/'T2'/'T3'
    serialReader: null,
    polarPlot: null,
    devices: [null, null, null],
    lastPointedAt: -1,
    pointingStartTime: null,
    pointingTimer: null,
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
document.addEventListener('DOMContentLoaded', function () {
    initRegistration();
});

// ========== Registration ==========
function initRegistration() {
    // Device type selection
    for (var i = 0; i < regUI.deviceButtons.length; i++) {
        (function (btn) {
            btn.addEventListener('click', function () {
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
    state.polarPlot = createPolarPlot(pUI.polarCanvas);

    // Connect/disconnect buttons
    pUI.btnConnect.addEventListener('click', startSerialConnection);
    pUI.btnDisconnect.addEventListener('click', disconnectSerial);

    // Periodic heartbeat
    setInterval(function () {
        if (state.isMaster && state.serialReader && state.serialReader.connected) {
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

    state.serialReader = new SerialReader(CONFIG.SERIAL.baudRate, onData);

    state.serialReader.connect().then(function () {
        state.isMaster = true;
        pUI.statusText.textContent = '已连接';
        pUI.statusDot.className = 'status-dot on';
        pUI.btnConnect.classList.add('hidden');
        pUI.btnDisconnect.classList.remove('hidden');
        logMsg('✅ 串口已连接，开始读取数据...');
        state.serialReader.startReading();
    }).catch(function (err) {
        logMsg('❌ 串口连接失败: ' + err.message);
        pUI.statusText.textContent = '❌ 连接失败';
    });
}

function disconnectSerial() {
    if (state.serialReader) {
        state.serialReader.disconnect();
        state.isMaster = false;
        pUI.statusText.textContent = '未连接';
        pUI.statusDot.className = 'status-dot off';
        pUI.btnConnect.classList.remove('hidden');
        pUI.btnDisconnect.classList.add('hidden');
        logMsg('⚠️ 串口已断开');
    }
}

// ========== Data Processing ==========
function onData(addr, dis, azi) {
    if (addr === null || dis === null || azi === null) return;

    // Map addr string to index (01→0, 02→1, 03→2)
    var idx = parseInt(addr, 10) - 1;
    if (idx < 0 || idx > 2) return;

    var dev = state.devices[idx];
    if (!dev) {
        dev = { smoothedDis: dis, smoothedAzi: azi, history: [] };
        state.devices[idx] = dev;
    }

    // Apply smoothing
    dev.history.push({ dis: dis, azi: azi });
    if (dev.history.length > CONFIG.DATA.smoothingWindow) {
        dev.history.shift();
    }

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

    var aziDeg = (dev.smoothedAzi / CONFIG.DATA.aziToDeg).toFixed(1);
    var disMm  = Math.round(dev.smoothedDis);

    // Update polar plot
    state.polarPlot.update(idx, { dis: disMm, azi: aziDeg });

    // Update legend
    updateLegend(idx, disMm, aziDeg);

    // Pointing logic
    checkPointing(idx, disMm, aziDeg);

    // Broadcast raw data via PubNub
    broadcastMessage({
        type: 'raw_data',
        addr: addr,
        dis: disMm,
        azi: aziDeg,
    });
}

function updateLegend(idx, dis, azi) {
    var legendItem = document.getElementById('legend-' + idx);
    if (legendItem) {
        var dataSpan = legendItem.querySelector('.legend-data');
        if (dataSpan) {
            dataSpan.textContent = '距离: ' + dis + 'mm  角度: ' + azi + '°';
        }
    }
}

function checkPointing(idx, dis, azi) {
    var now = Date.now();
    var stableRange = CONFIG.DATA.pointingStableRange;

    if (state.lastPointedAt !== idx) {
        state.lastPointedAt = idx;
        state.pointingStartTime = now;
    }

    // Update pointing indicator
    var targetType = 'T' + (idx + 1);
    pUI.pointingTarget.textContent = CONFIG.DEVICE_ADDRS[idx] + ' (' + targetType + ')';

    // Check pointing conditions
    if (Math.abs(azi) <= CONFIG.DATA.pointingAziLimit &&
        dis >= stableRange && dis <= stableRange + 500) {

        var elapsed = ((now - state.pointingStartTime) / 1000).toFixed(1);
        pUI.pointingStatus.textContent = '指向中 ' + elapsed + 's';

        if (!state.pointingTimer) {
            state.pointingTimer = setInterval(function () {
                var e = ((Date.now() - state.pointingStartTime) / 1000).toFixed(1);
                pUI.pointingStatus.textContent = '指向中 ' + e + 's';
            }, 100);
        }

        // Broadcast pointing event when stable (>1s)
        if (parseFloat(elapsed) >= 1.0) {
            broadcastMessage({
                type: 'point_at',
                target: targetType,
                dis: dis,
                azi: azi,
                duration: parseFloat(elapsed),
            });
        }
    } else {
        // Reset pointing timer
        if (state.pointingTimer) {
            clearInterval(state.pointingTimer);
            state.pointingTimer = null;
        }
        pUI.pointingStatus.textContent = '等待稳定指向...';

        // Broadcast pointing release
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
