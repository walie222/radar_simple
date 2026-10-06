/* ============================================
   配置
   ============================================ */

var CONFIG = {
    // BroadcastChannel 名称（同一浏览器不同标签页通信）
    CHANNEL_NAME: 'radar-demo-channel',

    // 串口配置（与 point_demo_test1.py 对齐）
    SERIAL: {
        baudRate: 115200,
    },

    // 数据处理参数（与 point_demo_test1.py 完全一致）
    DATA: {
        smoothingWindow: 5,       // SMOOTHING_WINDOW
        aziToDeg: 100.0,         // AZI_TO_DEG
        maxDisplayAzi: 90,       // MAX_DISPLAY_AZI
        aziOutlierThreshold: 3000, // AZI_OUTLIER_THRESHOLD
        disOutlierThreshold: 2000, // DIS_OUTLIER_THRESHOLD
        pointingAziLimit: 1000,   // POINTING_AZI_LIMIT
        pointingStableRange: 1000, // POINTING_STABLE_RANGE
        smoothAlpha: 0.3,         // SMOOTH_ALPHA
        updateIntervalMs: 1000,   // UPDATE_INTERVAL_MS (每秒处理)
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
