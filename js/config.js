/* ============================================
   配置
   ============================================ */

var CONFIG = {
    // PubNub 跨设备通信配置（与 radar_demoo-master 使用同一套 key）
    PUBNUB: {
        publishKey: 'pub-c-8f6fe818-ef2e-4122-9993-e790f721c8ea',
        subscribeKey: 'sub-c-632c8bc5-da75-4b54-af01-a18aae16138a',
    },

    // 房间配置：固定单房间模式，所有设备加入同一个房间
    ROOM_CODE: 'RADAR01',  // 固定房间号，所有设备自动加入此房间
    CHANNEL_NAME: 'room-RADAR01-main',  // PubNub channel name

    // 串口配置（与 point_demo_test1.py 对齐）
    SERIAL: {
        baudRate: 115200,
    },

    // 数据处理参数（与 point_demo_test1.py 完全一致）
    DATA: {
        smoothingWindow: 5,             // SMOOTHING_WINDOW
        aziToDeg: 100.0,               // AZI_TO_DEG
        maxDisplayAzi: 90,             // MAX_DISPLAY_AZI
        aziOutlierThreshold: 3000,     // AZI_OUTLIER_THRESHOLD
        disOutlierThreshold: 2000,     // DIS_OUTLIER_THRESHOLD
        pointingAziLimit: 1000,        // POINTING_AZI_LIMIT
        pointingStableRange: 1000,     // POINTING_STABLE_RANGE
        smoothAlpha: 0.3,              // SMOOTH_ALPHA
        updateIntervalMs: 1000,        // UPDATE_INTERVAL_MS (每秒处理)
        distStableRange: 800,          // DIST_STABLE_RANGE — 指向最小距离阈值(mm)
        aziPointingThreshold: 5,       // AZI_POINTING_THRESHOLD — 指向最大角度阈值(°)
    },

    // 设备定义
    DEVICES: {
        P:  { label: 'P (主控)', icon: '🎯' },
        T1: { label: 'T1',     icon: '🔴' },
        T2: { label: 'T2',     icon: '🔴' },
        T3: { label: 'T3',     icon: '🔴' },
    },

    // 目标设备地址映射 (addr 01→T1索引0, 02→T2索引1, 03→T3索引2)
    DEVICE_ADDRS: ['01', '02', '03'],
    DEVICE_COLORS: ['#e74c3c', '#3498db', '#2ecc71'], // 红色、蓝色、绿色
};

// 生成唯一设备ID
function generateDeviceId() {
    return 'radar_' + Math.random().toString(36).substr(2, 8) + Date.now().toString(36);
}
