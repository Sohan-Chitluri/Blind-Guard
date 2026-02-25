/* ============================================================
   BlindGuard Dashboard — Main Application Logic
   ============================================================ */

(function () {
    'use strict';

    /* ---- Constants ---- */
    const BAUD_RATE = 115200;
    const CHART_POINTS = 120;
    const FALL_THRESHOLD = 2.5;
    const FREEFALL_THRESHOLD = 0.5;
    const MAX_LOG_ENTRIES = 200;

    /* ---- State ---- */
    const state = {
        port: null,
        reader: null,
        connected: false,
        demoMode: false,
        demoInterval: null,
        startTime: null,
        packetCount: 0,

        accelHistory: [],
        axHistory: [],
        ayHistory: [],
        azHistory: [],

        fallCount: 0,
        obstacleCount: 0,

        lat: '—',
        lng: '—',
        hasGpsFix: false,

        esp32Online: false,
        esp8266Linked: false,
        lastObstacleTime: 0,

        lineBuffer: '',
    };

    /* ---- DOM Refs ---- */
    const dom = {
        btnConnect: document.getElementById('btn-connect'),
        btnDemo: document.getElementById('btn-demo'),
        btnClearLog: document.getElementById('btn-clear-log'),
        connectionStatus: document.getElementById('connection-status'),
        statusText: document.getElementById('status-text'),

        esp32Status: document.getElementById('esp32-status'),
        esp32Indicator: document.getElementById('esp32-indicator'),
        esp8266Status: document.getElementById('esp8266-status'),
        esp8266Indicator: document.getElementById('esp8266-indicator'),

        fallCount: document.getElementById('fall-count'),
        obstacleCount: document.getElementById('obstacle-count'),

        accelCanvas: document.getElementById('accel-canvas'),
        accelLiveValue: document.getElementById('accel-live-value'),

        gpsLat: document.getElementById('gps-lat'),
        gpsLng: document.getElementById('gps-lng'),
        gpsFixBadge: document.getElementById('gps-fix-badge'),
        gpsFixText: document.getElementById('gps-fix-text'),

        logContainer: document.getElementById('log-container'),

        uptime: document.getElementById('uptime'),
        packetCountEl: document.getElementById('packet-count'),

        cardFalls: document.getElementById('card-falls'),
        cardObstacles: document.getElementById('card-obstacles'),
        cardEsp32: document.getElementById('card-esp32'),
        cardEsp8266: document.getElementById('card-esp8266'),
    };

    const ctx = dom.accelCanvas.getContext('2d');

    /* ============================================================
       SERIAL MANAGER
    ============================================================ */

    async function serialConnect() {
        if (!('serial' in navigator)) {
            addLog('system', 'Web Serial API not supported. Use Chrome or Edge.');
            return;
        }

        try {
            state.port = await navigator.serial.requestPort();
            await state.port.open({ baudRate: BAUD_RATE });

            state.connected = true;
            state.startTime = Date.now();
            updateConnectionUI('connected');
            setEsp32Online(true);
            addLog('system', 'Serial port connected at ' + BAUD_RATE + ' baud');

            readLoop();
        } catch (err) {
            if (err.name !== 'NotFoundError') {
                addLog('system', 'Connection error: ' + err.message);
            }
        }
    }

    async function serialDisconnect() {
        try {
            if (state.reader) {
                await state.reader.cancel();
                state.reader = null;
            }
            if (state.port) {
                await state.port.close();
                state.port = null;
            }
        } catch (e) { /* ignore */ }

        state.connected = false;
        updateConnectionUI('disconnected');
        setEsp32Online(false);
        setEsp8266Linked(false);
        addLog('system', 'Serial port disconnected');
    }

    async function readLoop() {
        const decoder = new TextDecoderStream();
        const readableStreamClosed = state.port.readable.pipeTo(decoder.writable);
        state.reader = decoder.readable.getReader();

        try {
            while (true) {
                const { value, done } = await state.reader.read();
                if (done) break;
                if (value) processChunk(value);
            }
        } catch (err) {
            if (state.connected) {
                addLog('system', 'Read error: ' + err.message);
            }
        } finally {
            state.reader.releaseLock();
        }
    }

    function processChunk(chunk) {
        state.lineBuffer += chunk;
        const lines = state.lineBuffer.split('\n');
        state.lineBuffer = lines.pop();  // keep incomplete trailing line

        for (const raw of lines) {
            const line = raw.trim();
            if (line.length === 0) continue;
            parseLine(line);
        }
    }

    /* ============================================================
       DATA PARSER
    ============================================================ */

    function parseLine(line) {
        if (line.startsWith('DATA:')) {
            parseDataLine(line.substring(5));
        } else if (line.startsWith('EVENT:')) {
            parseEvent(line.substring(6));
        }
    }

    function parseDataLine(payload) {
        const parts = {};
        payload.split(',').forEach(segment => {
            const [key, val] = segment.split('=');
            if (key && val !== undefined) parts[key.trim()] = val.trim();
        });

        state.packetCount++;

        const accel = parseFloat(parts.accel) || 0;
        const axVal = parseFloat(parts.ax) || 0;
        const ayVal = parseFloat(parts.ay) || 0;
        const azVal = parseFloat(parts.az) || 0;

        // Push to history
        pushHistory(state.accelHistory, accel);
        pushHistory(state.axHistory, axVal);
        pushHistory(state.ayHistory, ayVal);
        pushHistory(state.azHistory, azVal);

        // Live value
        dom.accelLiveValue.textContent = accel.toFixed(2);

        // Color the live value based on thresholds
        if (accel > FALL_THRESHOLD) {
            dom.accelLiveValue.style.color = 'var(--accent-red)';
        } else if (accel < FREEFALL_THRESHOLD) {
            dom.accelLiveValue.style.color = 'var(--accent-amber)';
        } else {
            dom.accelLiveValue.style.color = 'var(--accent-cyan)';
        }

        // Fall & obstacle counts from firmware
        const falls = parseInt(parts.falls);
        const obstacles = parseInt(parts.obstacles);

        if (!isNaN(falls) && falls !== state.fallCount) {
            state.fallCount = falls;
            updateCounter(dom.fallCount, falls, dom.cardFalls, 'flash-red');
        }

        if (!isNaN(obstacles) && obstacles !== state.obstacleCount) {
            state.obstacleCount = obstacles;
            updateCounter(dom.obstacleCount, obstacles, dom.cardObstacles, 'flash-amber');
        }

        // Obstacle flag — infer ESP8266 link
        const obstacleNow = parts.obstacle === '1';
        if (obstacleNow) {
            state.lastObstacleTime = Date.now();
            setEsp8266Linked(true);
        }

        // GPS
        const lat = parts.lat;
        const lng = parts.lng;
        if (lat && lng && lat !== '0' && lng !== '0') {
            state.lat = lat;
            state.lng = lng;
            state.hasGpsFix = true;
            dom.gpsLat.textContent = lat;
            dom.gpsLng.textContent = lng;
            dom.gpsFixBadge.classList.add('has-fix');
            dom.gpsFixText.textContent = 'Fix OK';
        }
    }

    function parseEvent(event) {
        switch (event) {
            case 'FALL_DETECTED':
                addLog('fall', 'Fall detected! Impact → free-fall pattern confirmed.');
                flashCard(dom.cardFalls, 'flash-red');
                break;
            case 'OBSTACLE_ALERT':
                addLog('obstacle', 'Obstacle detected within 50 cm range.');
                flashCard(dom.cardObstacles, 'flash-amber');
                setEsp8266Linked(true);
                state.lastObstacleTime = Date.now();
                break;
            case 'BOOT':
                addLog('system', 'ESP32 booting...');
                break;
            case 'MPU_OK':
                addLog('system', 'MPU6050 accelerometer connected successfully.');
                break;
            case 'MPU_FAIL':
                addLog('system', 'MPU6050 connection FAILED.');
                break;
            case 'ESPNOW_OK':
                addLog('system', 'ESP-NOW protocol initialized.');
                break;
            case 'ESPNOW_FAIL':
                addLog('system', 'ESP-NOW initialization FAILED.');
                break;
            case 'READY':
                addLog('system', 'System ready — all modules online.');
                setEsp32Online(true);
                dom.cardEsp32.classList.add('alert');
                break;
            default:
                addLog('system', event);
        }
    }

    /* ============================================================
       CHART ENGINE (Canvas)
    ============================================================ */

    function resizeCanvas() {
        const container = dom.accelCanvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        dom.accelCanvas.width = container.clientWidth * dpr;
        dom.accelCanvas.height = container.clientHeight * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function drawChart() {
        const w = dom.accelCanvas.parentElement.clientWidth;
        const h = dom.accelCanvas.parentElement.clientHeight;

        ctx.clearRect(0, 0, w, h);

        const padTop = 10;
        const padBot = 24;
        const chartH = h - padTop - padBot;

        // Auto-range Y
        let yMax = 3;
        for (const v of state.accelHistory) { if (v > yMax) yMax = v; }
        for (const v of state.axHistory) { if (Math.abs(v) > yMax) yMax = Math.abs(v); }
        for (const v of state.ayHistory) { if (Math.abs(v) > yMax) yMax = Math.abs(v); }
        for (const v of state.azHistory) { if (Math.abs(v) > yMax) yMax = Math.abs(v); }
        yMax = Math.ceil(yMax + 0.5);
        const yMin = -yMax;
        const yRange = yMax - yMin;

        // Grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        const gridSteps = 6;
        for (let i = 0; i <= gridSteps; i++) {
            const y = padTop + (chartH / gridSteps) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();

            // Label
            const val = (yMax - (yRange / gridSteps) * i).toFixed(1);
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.font = '10px "JetBrains Mono", monospace';
            ctx.fillText(val + 'g', 4, y - 3);
        }

        // Threshold lines
        drawThreshold(w, padTop, chartH, yMin, yRange, FALL_THRESHOLD, 'rgba(239,68,68,0.25)', 'Impact ▲');
        drawThreshold(w, padTop, chartH, yMin, yRange, FREEFALL_THRESHOLD, 'rgba(245,158,11,0.2)', 'Free-fall ▼');

        // Draw data lines
        drawLine(state.accelHistory, w, padTop, chartH, yMin, yRange, '#06b6d4', 2.2, 0.8);
        drawLine(state.axHistory, w, padTop, chartH, yMin, yRange, '#8b5cf6', 1.2, 0.35);
        drawLine(state.ayHistory, w, padTop, chartH, yMin, yRange, '#22d3ee', 1.2, 0.35);
        drawLine(state.azHistory, w, padTop, chartH, yMin, yRange, '#a78bfa', 1.2, 0.35);
    }

    function drawThreshold(w, padTop, chartH, yMin, yRange, value, color, label) {
        const y = padTop + chartH - ((value - yMin) / yRange) * chartH;

        ctx.strokeStyle = color;
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = color;
        ctx.font = '9px "Inter", sans-serif';
        ctx.fillText(label, w - ctx.measureText(label).width - 8, y - 4);
    }

    function drawLine(data, w, padTop, chartH, yMin, yRange, color, lineWidth, alpha) {
        if (data.length < 2) return;

        const step = w / (CHART_POINTS - 1);

        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();

        for (let i = 0; i < data.length; i++) {
            const x = i * step;
            const y = padTop + chartH - ((data[i] - yMin) / yRange) * chartH;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }

        ctx.stroke();
        ctx.globalAlpha = 1;

        // Glow for main line
        if (lineWidth > 1.5) {
            ctx.globalAlpha = 0.15;
            ctx.strokeStyle = color;
            ctx.lineWidth = lineWidth + 4;
            ctx.beginPath();
            for (let i = 0; i < data.length; i++) {
                const x = i * step;
                const y = padTop + chartH - ((data[i] - yMin) / yRange) * chartH;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    }

    /* ============================================================
       EVENT LOG
    ============================================================ */

    function addLog(type, message) {
        const logEmpty = dom.logContainer.querySelector('.log-empty');
        if (logEmpty) logEmpty.remove();

        const entry = document.createElement('div');
        entry.className = 'log-entry';

        const badge = document.createElement('span');
        badge.className = 'log-badge ' + type;
        badge.textContent = type.toUpperCase();

        const msg = document.createElement('span');
        msg.className = 'log-message';
        msg.textContent = message;

        const time = document.createElement('span');
        time.className = 'log-time';
        time.textContent = new Date().toLocaleTimeString('en-US', { hour12: false });

        entry.append(badge, msg, time);
        dom.logContainer.appendChild(entry);

        // Limit entries
        while (dom.logContainer.children.length > MAX_LOG_ENTRIES) {
            dom.logContainer.removeChild(dom.logContainer.firstChild);
        }

        // Auto-scroll
        dom.logContainer.scrollTop = dom.logContainer.scrollHeight;
    }

    function clearLog() {
        dom.logContainer.innerHTML = '<div class="log-empty"><span>No events yet. Connect to device or start demo mode.</span></div>';
    }

    /* ============================================================
       UI HELPERS
    ============================================================ */

    function updateConnectionUI(status) {
        const badge = dom.connectionStatus;
        const text = dom.statusText;
        const btn = dom.btnConnect;

        badge.className = 'status-badge ' + status;

        if (status === 'connected') {
            text.textContent = 'Connected';
            btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 016 6v4a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm5 0a.5.5 0 01.5.5v4a.5.5 0 01-1 0V6a.5.5 0 01.5-.5z"/><path d="M14 8A6 6 0 102 8a6 6 0 0012 0z"/></svg> Disconnect';
            btn.classList.add('connected');
        } else if (status === 'demo') {
            text.textContent = 'Demo Mode';
            badge.className = 'status-badge demo';
        } else {
            text.textContent = 'Disconnected';
            btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a2 2 0 0 1 2 2v2H6V3a2 2 0 0 1 2-2zm3 4V3a3 3 0 1 0-6 0v2H3.5A1.5 1.5 0 0 0 2 6.5v7A1.5 1.5 0 0 0 3.5 15h9a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 12.5 5H11z"/></svg> Connect';
            btn.classList.remove('connected');
        }
    }

    function setEsp32Online(online) {
        state.esp32Online = online;
        dom.esp32Status.textContent = online ? 'Online' : 'Offline';
        dom.esp32Indicator.className = 'stat-indicator ' + (online ? 'online' : 'offline');
        if (online) dom.cardEsp32.classList.add('alert');
        else dom.cardEsp32.classList.remove('alert');
    }

    function setEsp8266Linked(linked) {
        state.esp8266Linked = linked;
        dom.esp8266Status.textContent = linked ? 'Linked' : 'No Signal';
        dom.esp8266Indicator.className = 'stat-indicator ' + (linked ? 'online' : 'offline');
        if (linked) dom.cardEsp8266.classList.add('alert');
    }

    function updateCounter(el, value, card, flashClass) {
        el.textContent = value;
        flashCard(card, flashClass);
    }

    function flashCard(card, cls) {
        card.classList.remove(cls);
        void card.offsetWidth;  // reflow
        card.classList.add(cls);
        setTimeout(() => card.classList.remove(cls), 700);
    }

    function pushHistory(arr, val) {
        arr.push(val);
        if (arr.length > CHART_POINTS) arr.shift();
    }

    function updateUptime() {
        if (!state.startTime) {
            dom.uptime.textContent = 'Uptime: —';
            return;
        }
        const s = Math.floor((Date.now() - state.startTime) / 1000);
        const m = Math.floor(s / 60);
        const h = Math.floor(m / 60);
        const display = h > 0
            ? `${h}h ${m % 60}m ${s % 60}s`
            : m > 0
                ? `${m}m ${s % 60}s`
                : `${s}s`;
        dom.uptime.textContent = 'Uptime: ' + display;
    }

    function updatePacketCount() {
        dom.packetCountEl.textContent = 'Packets: ' + state.packetCount;
    }

    /* ============================================================
       DEMO MODE
    ============================================================ */

    function startDemo() {
        if (state.connected) return;

        state.demoMode = true;
        state.startTime = Date.now();
        state.packetCount = 0;
        state.fallCount = 0;
        state.obstacleCount = 0;
        state.accelHistory = [];
        state.axHistory = [];
        state.ayHistory = [];
        state.azHistory = [];

        dom.btnDemo.classList.add('active');
        updateConnectionUI('demo');
        setEsp32Online(true);
        addLog('system', 'Demo mode started — generating simulated data');

        let tick = 0;
        let simFallCooldown = 0;
        let simObstacleCooldown = 0;

        state.demoInterval = setInterval(() => {
            tick++;

            // Normal walking motion
            let accel = 1.0 + Math.sin(tick * 0.15) * 0.08 + (Math.random() - 0.5) * 0.06;
            let axVal = 0.02 + Math.sin(tick * 0.1) * 0.05 + (Math.random() - 0.5) * 0.04;
            let ayVal = 0.01 + Math.cos(tick * 0.12) * 0.04 + (Math.random() - 0.5) * 0.03;
            let azVal = 0.98 + Math.sin(tick * 0.08) * 0.03 + (Math.random() - 0.5) * 0.02;
            let fallFlag = 0;
            let obstacleFlag = 0;

            simFallCooldown--;
            simObstacleCooldown--;

            // Simulate fall event every ~12 seconds
            if (tick % 240 === 100 && simFallCooldown <= 0) {
                // Impact spike phase
                accel = 3.0 + Math.random() * 1.5;
                axVal = 1.5 + Math.random();
                ayVal = 1.0 + Math.random();
                azVal = 0.2;
                simFallCooldown = 60;
            } else if (tick % 240 === 104 && simFallCooldown > 0) {
                // Free-fall phase
                accel = 0.15 + Math.random() * 0.2;
                axVal = 0.05;
                ayVal = 0.05;
                azVal = 0.1;
                fallFlag = 1;
                state.fallCount++;
                parseEvent('FALL_DETECTED');
            }

            // Simulate obstacle alerts every ~8 seconds
            if (tick % 160 === 60 && simObstacleCooldown <= 0) {
                obstacleFlag = 1;
                state.obstacleCount++;
                parseEvent('OBSTACLE_ALERT');
                setEsp8266Linked(true);
                simObstacleCooldown = 40;
            }

            // Build simulated DATA line
            const simLine = `accel=${accel.toFixed(3)},ax=${axVal.toFixed(3)},ay=${ayVal.toFixed(3)},az=${azVal.toFixed(3)},fall=${fallFlag},obstacle=${obstacleFlag},falls=${state.fallCount},obstacles=${state.obstacleCount},lat=17.3850,lng=78.4867`;
            parseDataLine(simLine);

            // Simulate GPS fix after a few seconds
            if (tick === 30) {
                state.hasGpsFix = true;
                dom.gpsFixBadge.classList.add('has-fix');
                dom.gpsFixText.textContent = 'Fix OK';
                addLog('gps', 'GPS fix acquired — location tracking active');
            }

            // Check ESP8266 timeout (6 seconds)
            if (state.esp8266Linked && Date.now() - state.lastObstacleTime > 6000) {
                setEsp8266Linked(false);
            }

        }, 50);
    }

    function stopDemo() {
        state.demoMode = false;
        if (state.demoInterval) {
            clearInterval(state.demoInterval);
            state.demoInterval = null;
        }
        dom.btnDemo.classList.remove('active');
        updateConnectionUI('disconnected');
        setEsp32Online(false);
        setEsp8266Linked(false);
        addLog('system', 'Demo mode stopped');
    }

    /* ============================================================
       RENDER LOOP
    ============================================================ */

    function render() {
        drawChart();
        updateUptime();
        updatePacketCount();

        // Timeout ESP8266 link if no obstacle data for 10 seconds
        if (state.esp8266Linked && !state.demoMode && Date.now() - state.lastObstacleTime > 10000) {
            setEsp8266Linked(false);
        }

        requestAnimationFrame(render);
    }

    /* ============================================================
       INIT
    ============================================================ */

    function init() {
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        // Connect button
        dom.btnConnect.addEventListener('click', () => {
            if (state.demoMode) stopDemo();

            if (state.connected) {
                serialDisconnect();
            } else {
                serialConnect();
            }
        });

        // Demo button
        dom.btnDemo.addEventListener('click', () => {
            if (state.connected) return;

            if (state.demoMode) {
                stopDemo();
            } else {
                startDemo();
            }
        });

        // Clear log
        dom.btnClearLog.addEventListener('click', clearLog);

        // Start render loop
        requestAnimationFrame(render);

        // Welcome log
        addLog('system', 'BlindGuard Dashboard v1.0 initialized');
        addLog('system', 'Click "Connect" for serial or "Demo" for simulation');
    }

    // Boot
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
