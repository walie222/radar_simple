/* ============================================
   主逻辑
   ============================================ */

// ========== Global State ==========
var state = {
    deviceId: generateDeviceId(),
    deviceType: null,     // 'P' or 'T1'/'T2'/'T3'
    serialReader: null,
    polarPlot: null,
    devices: [null, null, null],
    lastPointedAt: -1,
    pointingStartTime: null,
    pointingTimer: null,
    isMaster: false,       // Whether this tab is the master P instance
    pubnub: null,          // PubNub instance
};

// ========== DOM References ==========
var screens = {
    registration: document.getElementById('registration-screen'),
    pScreen:      document.getElementById('p-screen'),
    tScreen:      document.getElementById('t-screen'),
};

var pUI = {
    status:         document.getElementById('status'),
    polarContainer: document.getElementById('polar-container'),
    logContainer:   document.getElementById('log-container'),
    btnDisconnect:  document.getElementById('btn-disconnect'),
    btnRefresh:     document.getElementById('btn-refresh'),
    pointingTime:   document.getElementById('pointing-time'),
    targetLabel:    document.getElementById('target-label'),
    targetDis:      document.getElementById('target-dis'),
    targetAzi:      document.getElementById('target-azi'),
};

var tUI = {
    status:        document.getElementById('t-status'),
    deviceName:    document.getElementById('device-name'),
    activeDot:     document.getElementById('active-dot'),
    distanceInfo:  document.getElementById('distance-info'),
    azimuthInfo:   document.getElementById('azimuth-info'),
    btnBack:       document.getElementById('btn-back'),
};

// ========== Init ==========
document.addEventListener('DOMContentLoaded', function () {
    initRegistration();
});

// ========== Registration ==========
function initRegistration() {
    var options = document.querySelectorAll('.role-option');
    for (var i = 0; i < options.length; i++) {
        options[i].addEventListener('click', (function (opt) {
            return function () { selectRole(opt.dataset.role); };
        })(options[i]));
    }
}

function selectRole(role) {
    state.deviceType = role;

    // Show room info before entering
    showRoomInfo(role);
}

function showRoomInfo(role) {
    // Hide registration screen
    screens.registration.style.display = 'none';

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
        screens.pScreen.style.display = 'flex';
        initPScreen();
    } else {
        screens.tScreen.style.display = 'flex';
        initTScreen(deviceType);
    }
}

// ========== PubNub Setup ==========
function initPubNub() {
    // Initialize PubNub client
    state.pubnub = new PubNub({
        publishKey: CONFIG.PUBNUB.publishKey,
        subscribeKey: CONFIG.PUBNUB.subscribeKey,
        uuid: state.deviceId,
    });

    // Subscribe to the room channel
    state.pubnub.subscribe({ channels: [CONFIG.CHANNEL_NAME] });

    // Listen for messages
    state.pubnub.addListener({
        message: function (m) {
            onPubNubMessage(m.message, m.publisher);
        },
        status: function (statusEvent) {
            if (statusEvent.category === 'PNConnectedCategory') {
                logMsg('[PubNub] 已连接到房间 ' + CONFIG.ROOM_CODE);
                // Announce presence after connecting
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
    pUI.status.textContent = '⏳ 等待串口连接...';
    pUI.targetLabel.textContent = '--';
    pUI.targetDis.textContent = '--';
    pUI.targetAzi.textContent = '--';

    // Initialize PubNub for cross-device communication
    initPubNub();

    // Initialize polar plot
    state.polarPlot = createPolarPlot(pUI.polarContainer);

    // Start serial connection
    startSerialConnection();

    // Handle disconnect button
    pUI.btnDisconnect.addEventListener('click', disconnectSerial);

    // Handle refresh button
    pUI.btnRefresh.addEventListener('click', function () {
        location.reload();
    });

    // Periodic heartbeat to announce presence
    setInterval(function () {
        if (state.isMaster && state.serialReader && state.serialReader.connected) {
            broadcastPresence();
        }
    }, 5000);
}

// ========== T Screen ==========
function initTScreen(deviceType) {
    tUI.deviceName.textContent = CONFIG.DEVICES[deviceType].label;
    tUI.activeDot.textContent = '🔴';
    tUI.distanceInfo.textContent = '--';
    tUI.azimuthInfo.textContent = '--';
    tUI.status.textContent = '⏳ 等待主控连接...';

    // Initialize PubNub for cross-device communication
    initPubNub();

    // Handle back button
    tUI.btnBack.addEventListener('click', function () {
        location.reload();
    });
}

// ========== Serial Connection ==========
function startSerialConnection() {
    if (!navigator.serial) {
        logMsg('❌ 当前浏览器不支持 Web Serial API');
        pUI.status.textContent = '❌ 不支持 Web Serial';
        return;
    }

    state.serialReader = new SerialReader(CONFIG.SERIAL.baudRate, onData);

    state.serialReader.connect().then(function () {
        state.isMaster = true;
        logMsg('✅ 串口已连接，开始读取数据...');
        pUI.status.textContent = '✅ 串口已连接';
        state.serialReader.startReading();
    }).catch(function (err) {
        logMsg('❌ 串口连接失败: ' + err.message);
        pUI.status.textContent = '❌ 连接失败';
    });
}

function disconnectSerial() {
    if (state.serialReader) {
        state.serialReader.disconnect();
        state.isMaster = false;
        logMsg('⚠️ 串口已断开');
        pUI.status.textContent = '⚠️ 串口已断开';
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
        dev = {
            smoothedDis: dis,
            smoothedAzi: azi,
            history: [],
        };
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

    // Exponential moving average
    var alpha = CONFIG.DATA.smoothAlpha;
    dev.smoothedDis = alpha * avgDis + (1 - alpha) * dev.smoothedDis;
    dev.smoothedAzi = alpha * avgAzi + (1 - alpha) * dev.smoothedAzi;

    // Convert to degrees
    var aziDeg = (dev.smoothedAzi / CONFIG.DATA.aziToDeg).toFixed(1);
    var disMm  = Math.round(dev.smoothedDis);

    // Update polar plot
    state.polarPlot.update(idx, {
        dis: disMm,
        azi: aziDeg,
    });

    // Pointing logic
    checkPointing(idx, disMm, aziDeg);

    // ===== BROADCAST TO TARGET DEVICES VIA PUBNUB =====
    var targetLabel = CONFIG.CONFIG ? CONFIG.DEVICE_ADDRS[idx] : ('0' + (idx + 1));
    var targetType = 'T' + (idx + 1);

    // Broadcast raw data for all devices to see
    broadcastMessage({
        type: 'raw_data',
        addr: addr,
        dis: disMm,
        azi: aziDeg,
    });
}

function checkPointing(idx, dis, azi) {
    var now = Date.now();
    var stableRange = CONFIG.DATA.pointingStableRange;

    if (state.lastPointedAt !== idx) {
        state.lastPointedAt = idx;
        state.pointingStartTime = now;
    }

    // Update UI
    updateTargetInfo(idx, dis, azi);

    // Check if pointing conditions are met
    if (Math.abs(azi) <= CONFIG.DATA.pointingAziLimit &&
        dis >= stableRange && dis <= stableRange + 500) {
        var elapsed = ((now - state.pointingStartTime) / 1000).toFixed(1);
        pUI.pointingTime.textContent = elapsed + 's';

        if (!state.pointingTimer) {
            state.pointingTimer = setInterval(function () {
                var e = ((Date.now() - state.pointingStartTime) / 1000).toFixed(1);
                pUI.pointingTime.textContent = e + 's';
            }, 100);
        }

        // Broadcast pointing event when stable
        if (parseFloat(elapsed) >= 1.0) {
            var targetType = 'T' + (idx + 1);
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
        pUI.pointingTime.textContent = '0.0s';

        // Broadcast pointing release
        broadcastMessage({
            type: 'point_stop',
        });
    }
}

function updateTargetInfo(idx, dis, azi) {
    pUI.targetLabel.textContent = CONFIG.DEVICE_ADDRS[idx] + ' (T' + (idx + 1) + ')';
    pUI.targetDis.textContent = dis + ' mm';
    pUI.targetAzi.textContent = azi + '°';
}

// ========== PubNub Message Handler ==========
function onPubNubMessage(msg, senderId) {
    // Ignore messages from self
    if (senderId === state.deviceId) return;

    switch (msg.type) {
        case 'presence':
            // Another device joined the room
            if (state.deviceType === 'P') {
                logMsg('[房间] 设备加入: ' + msg.deviceType + ' (' + msg.deviceId.substr(-6) + ')');
            }
            break;

        case 'raw_data':
            // Raw radar data from P → display on all devices
            if (state.deviceType === 'P') {
                // P already displays locally via onData
            }
            break;

        case 'point_at':
            // P is pointing at a target → activate that target's screen
            handlePointAt(msg);
            break;

        case 'point_stop':
            // P stopped pointing → deactivate all targets
            handlePointStop();
            break;
    }
}

function handlePointAt(msg) {
    if (state.deviceType === msg.target) {
        // This T device is being pointed at → turn green!
        tUI.activeDot.textContent = '🟢';
        tUI.activeDot.classList.add('active');
        tUI.distanceInfo.textContent = msg.dis + ' mm';
        tUI.azimuthInfo.textContent = msg.azi + '°';
        tUI.status.textContent = '🟢 被指向中！';
    }
}

function handlePointStop() {
    if (state.deviceType && state.deviceType !== 'P') {
        // Reset T device display
        tUI.activeDot.textContent = '🔴';
        tUI.activeDot.classList.remove('active');
        tUI.distanceInfo.textContent = '--';
        tUI.azimuthInfo.textContent = '--';
        tUI.status.textContent = '⏳ 等待主控连接...';
    }
}

// ========== Logging ==========
function logMsg(text) {
    var time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    var entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = '[' + time + '] ' + text;
    pUI.logContainer.appendChild(entry);
    pUI.logContainer.scrollTop = pUI.logContainer.scrollHeight;
}
