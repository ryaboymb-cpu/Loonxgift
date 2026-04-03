// ФИКС ДЛЯ TON CONNECT
const tonwebScript = document.createElement('script');
tonwebScript.src = 'https://unpkg.com/tonweb@0.0.60/dist/tonweb.js';
document.head.appendChild(tonwebScript);

const tg = window.Telegram.WebApp;
const socket = io();
let user = null; 
let mode = 'real';

// ═══ SOUND SYSTEM (Web Audio API) ═══
let _audioCtx = null;
let _bgMusicGain = null;
let _bgMusicPlaying = false;
let _soundEnabled = true;

function getAudioCtx() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    return _audioCtx;
}

function playSound(name) {
    if (!_soundEnabled) return;
    try {
        const ctx = getAudioCtx();
        const now = ctx.currentTime;
        const g = ctx.createGain();
        g.connect(ctx.destination);
        if (name === 'hit') {
            g.gain.setValueAtTime(0.15, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
            const o = ctx.createOscillator();
            o.type = 'square';
            o.frequency.setValueAtTime(800 + Math.random() * 400, now);
            o.frequency.exponentialRampToValueAtTime(200, now + 0.06);
            o.connect(g); o.start(now); o.stop(now + 0.08);
            const n = ctx.createBufferSource();
            const nb = ctx.createBuffer(1, ctx.sampleRate * 0.04, ctx.sampleRate);
            const nd = nb.getChannelData(0);
            for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * 0.3;
            n.buffer = nb;
            const ng = ctx.createGain();
            ng.gain.setValueAtTime(0.08, now);
            ng.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
            n.connect(ng); ng.connect(ctx.destination);
            n.start(now); n.stop(now + 0.04);
        } else if (name === 'break') {
            g.gain.setValueAtTime(0.2, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
            const n = ctx.createBufferSource();
            const nb = ctx.createBuffer(1, ctx.sampleRate * 0.18, ctx.sampleRate);
            const nd = nb.getChannelData(0);
            for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length);
            n.buffer = nb; n.connect(g); n.start(now); n.stop(now + 0.2);
        } else if (name === 'chest') {
            g.gain.setValueAtTime(0.12, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
            const o = ctx.createOscillator();
            o.type = 'sine';
            o.frequency.setValueAtTime(600, now);
            o.frequency.linearRampToValueAtTime(1200, now + 0.15);
            o.frequency.linearRampToValueAtTime(1600, now + 0.3);
            o.connect(g); o.start(now); o.stop(now + 0.4);
        } else if (name === 'win') {
            g.gain.setValueAtTime(0.1, now);
            g.gain.linearRampToValueAtTime(0.15, now + 0.2);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
            const o = ctx.createOscillator();
            o.type = 'sine';
            const notes = [523, 659, 784, 1047];
            notes.forEach((f, i) => {
                o.frequency.setValueAtTime(f, now + i * 0.12);
            });
            o.connect(g); o.start(now); o.stop(now + 0.6);
        } else if (name === 'click') {
            g.gain.setValueAtTime(0.08, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
            const o = ctx.createOscillator();
            o.type = 'sine';
            o.frequency.setValueAtTime(1200, now);
            o.connect(g); o.start(now); o.stop(now + 0.04);
        } else if (name === 'explode') {
            // Only play explosion in mine game
            const minePage = document.getElementById('page-mine');
            if (!minePage || !minePage.classList.contains('active')) return;
            // Softer, deeper TNT explosion
            g.gain.setValueAtTime(0.18, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
            const n = ctx.createBufferSource();
            const nb = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
            const nd = nb.getChannelData(0);
            for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nd.length, 0.7);
            n.buffer = nb;
            const lp = ctx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.setValueAtTime(400, now);
            lp.frequency.exponentialRampToValueAtTime(80, now + 0.25);
            n.connect(lp); lp.connect(g); n.start(now); n.stop(now + 0.35);
            const o = ctx.createOscillator();
            o.type = 'sine';
            o.frequency.setValueAtTime(80, now);
            o.frequency.exponentialRampToValueAtTime(25, now + 0.3);
            const og = ctx.createGain();
            og.gain.setValueAtTime(0.12, now);
            og.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
            o.connect(og); og.connect(ctx.destination); o.start(now); o.stop(now + 0.3);
        } else if (name === 'spin') {
            g.gain.setValueAtTime(0.06, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
            const o = ctx.createOscillator();
            o.type = 'triangle';
            o.frequency.setValueAtTime(400, now);
            o.frequency.linearRampToValueAtTime(800, now + 0.1);
            o.connect(g); o.start(now); o.stop(now + 0.15);
        }
    } catch(e) {}
}

let _bgAudioEl = null;
function startBgMusic() {
    if (_bgMusicPlaying) return;
    _bgMusicPlaying = true;
    try {
        // Try to play custom mp3 first (place your bg.mp3 in /public/ folder)
        _bgAudioEl = new Audio('/bg.mp3');
        _bgAudioEl.loop = true;
        _bgAudioEl.volume = 0.15;
        _bgAudioEl.play().catch(() => {
            // If no custom mp3, fall back to synthesized ambient music
            _bgAudioEl = null;
            startSynthBgMusic();
        });
    } catch(e) {
        startSynthBgMusic();
    }
}
function startSynthBgMusic() {
    try {
        const ctx = getAudioCtx();
        _bgMusicGain = ctx.createGain();
        _bgMusicGain.gain.value = 0.03;
        _bgMusicGain.connect(ctx.destination);
        const bassNotes = [65.41, 73.42, 82.41, 87.31, 73.42, 65.41];
        let noteIdx = 0;
        function playNote() {
            if (!_bgMusicPlaying) return;
            const now = ctx.currentTime;
            const o1 = ctx.createOscillator();
            o1.type = 'sine';
            o1.frequency.value = bassNotes[noteIdx % bassNotes.length];
            const g1 = ctx.createGain();
            g1.gain.setValueAtTime(0.04, now);
            g1.gain.exponentialRampToValueAtTime(0.001, now + 3.5);
            o1.connect(g1); g1.connect(_bgMusicGain);
            o1.start(now); o1.stop(now + 3.8);
            noteIdx++;
            setTimeout(playNote, 3200);
        }
        playNote();
    } catch(e) {}
}

function stopBgMusic() {
    _bgMusicPlaying = false;
    if (_bgAudioEl) { _bgAudioEl.pause(); _bgAudioEl = null; }
    if (_bgMusicGain) { _bgMusicGain.gain.value = 0; _bgMusicGain = null; }
}

document.addEventListener('click', () => { if (!_bgMusicPlaying) startBgMusic(); }, { once: true });
document.addEventListener('touchstart', () => { if (!_bgMusicPlaying) startBgMusic(); }, { once: true });
let adminPass = '';
let globalRtp = 90;
let rtpObj = { crash: 90, mines: 90, coinflip: 90, spin: 94, mine: 40 };
let maintenance = { crash: false, mines: false, coinflip: false, battle: false, spin: false, mine: false };
let adminWalletAddress = '';
let isShowDemo = false;

// TON CONNECT
let tonConnectUI = null;
try {
    tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
        manifestUrl: window.location.origin + '/tonconnect-manifest.json',
        buttonRootId: 'ton-connect-btn'
    });
} catch(e) {
    console.error('TON Connect init error:', e);
}

const $ = id => document.getElementById(id);

function showToast(msg, dur = 3000) {
    if(!msg) return;
    const container = $('toast-container');
    const t = document.createElement('div'); 
    t.className = 'toast'; 
    t.innerText = msg;
    container.appendChild(t); 
    setTimeout(() => t.remove(), dur);
}

// Анимация улетающего баланса
function flyToBalance(amount) {
    if(amount <= 0) return;
    const el = document.createElement('div');
    el.innerText = `+${amount.toFixed(2)}`;
    el.style.position = 'fixed';
    el.style.left = '50%';
    el.style.top = '50%';
    el.style.transform = 'translate(-50%, -50%) scale(1)';
    el.style.color = 'var(--neon)';
    el.style.fontWeight = 'bold';
    el.style.fontSize = '26px';
    el.style.textShadow = '0 0 15px var(--neon)';
    el.style.zIndex = '9999';
    el.style.transition = 'all 0.8s cubic-bezier(0.25, 1, 0.5, 1)';
    el.style.pointerEvents = 'none';
    document.body.appendChild(el);

    setTimeout(() => {
        const target = $('bal-val') ? $('bal-val').getBoundingClientRect() : {left: 20, top: 20};
        el.style.left = `${target.left + 20}px`;
        el.style.top = `${target.top}px`;
        el.style.transform = 'translate(0, 0) scale(0.3)';
        el.style.opacity = '0';
    }, 50);

    setTimeout(() => el.remove(), 850);
}

socket.on('global_alert', msg => { showToast(`📢 УВЕДОМЛЕНИЕ: ${msg}`, 6000); });
function copyText(text) { if(!text) return; navigator.clipboard.writeText(text).then(() => showToast('Скопировано!')); }

const ctx = $('stars-bg').getContext('2d');
let w = $('stars-bg').width = window.innerWidth;
let h = $('stars-bg').height = window.innerHeight;
let stars = Array(120).fill().map(() => ({ x: Math.random()*w, y: Math.random()*h, s: Math.random()*2 + 0.5, speed: Math.random()*1 + 0.2 }));
function draw() {
    ctx.clearRect(0,0,w,h); ctx.fillStyle = '#fff';
    stars.forEach(s => {
        ctx.fillRect(s.x, s.y, s.s, s.s);
        s.y += s.speed;
        if(s.y > h) { s.y = 0; s.x = Math.random()*w; }
    });
    requestAnimationFrame(draw);
} draw();

function getMskTime() {
    return new Date().toLocaleTimeString("ru-RU", {timeZone: "Europe/Moscow"});
}

function renderQuickBets() {
    const vals = [0.1, 0.5, 1, 5, 10, 25];
    function makeButtons(targetId) {
        return vals.map(v =>
            `<button type="button" class="qb-btn" onclick="setQuickBet('${targetId}',${v},this)">${v}</button>`
        ).join('');
    }
    const targets = {
        'qb-crash':    'cr-bet',
        'qb-mines':    'mi-bet',
        'qb-coinflip': 'co-bet',
        'qb-spin':     'sp-bet',
        'qb-mine':     'mn-bet',
    };
    Object.entries(targets).forEach(([elId, betId]) => {
        const el = $(elId);
        if (el) el.innerHTML = makeButtons(betId);
    });
}

window.onload = async () => {
    tg.expand();
    renderQuickBets(); 
    
    const res = await fetch('/api/auth', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(tg.initDataUnsafe.user || {id: "1", first_name: "Dev", username: "DevUser", photo_url: ""})
    });
    const data = await res.json();
    if(data.error === "BLOCKED") {
        document.body.innerHTML = "<h1 style='color:red; text-align:center; margin-top:50px;'>ВЫ ЗАБЛОКИРОВАНЫ</h1>";
        return;
    }

    user = data.user;
    rtpObj = data.rtp || { crash: 90, mines: 90, coinflip: 90, spin: 94 };
    maintenance = data.maintenance || { crash: false, mines: false, coinflip: false, battle: false, spin: false };
    isShowDemo = data.config ? data.config.showDemo : false;
    
    adminWalletAddress = data.adminWallet || '';
    if($('dep-wallet')) $('dep-wallet').innerText = adminWalletAddress || 'Кошелек не настроен на сервере';
    if($('dep-memo')) $('dep-memo').innerText = user.id;

    if($('loader')) { $('loader').style.opacity = '0'; setTimeout(() => $('loader').style.display = 'none', 500); }
    
    const avaUrl = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
    if($('user-ava')) $('user-ava').src = avaUrl; 
    if($('profile-ava')) $('profile-ava').src = avaUrl;
    if($('profile-name')) $('profile-name').innerText = user.username || 'Игрок';
    if($('profile-id')) $('profile-id').innerText = user.id; 
    
    updateUI();
    renderWithdrawHistory();
    renderBattleLobbies();

    setTimeout(() => {
        document.querySelectorAll('.nav-item').forEach(nav => {
            const attr = nav.getAttribute('onclick');
            if (attr && (attr.includes("'promo'") || attr.includes('"promo"'))) {
                nav.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:24px;height:24px;margin-bottom:3px;opacity:0.8;display:block;margin:0 auto;">
                    <path d="M15 5v2"/><path d="M15 11v2"/><path d="M15 17v2"/><path d="M5 5h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V7a2 2 0 0 1 2-2z"/>
                </svg>
                <span style="font-size:10px;">Промо</span>`;
            }
        });
    }, 500);
};

function updateUI() {
    if(!user) return;
    const bal = mode === 'real' ? (user.balance || 0) : (user.demo_balance || 0);
    if($('bal-val')) $('bal-val').innerText = bal.toFixed(2);
    if($('bal-mode')) {
        $('bal-mode').innerText = mode === 'real' ? 'REAL TON' : 'DEMO TON';
        $('bal-mode').style.color = mode === 'demo' ? 'var(--neon-blue)' : 'var(--neon)';
        $('bal-mode').style.borderColor = mode === 'demo' ? 'var(--neon-blue)' : 'var(--neon)';
    }
    
    if(user.stats) {
        if($('p-bets')) $('p-bets').innerText = user.stats.bets || 0; 
        if($('p-wins')) $('p-wins').innerText = user.stats.wins || 0;
        if($('p-plus')) $('p-plus').innerText = (user.stats.plus || 0).toFixed(2) + ' TON'; 
        if($('p-minus')) $('p-minus').innerText = (user.stats.minus || 0).toFixed(2) + ' TON';
    }

    if($('ref-link')) $('ref-link').innerText = `https://t.me/LoonxGift_Bot?start=${user.id}`;
    if($('ref-count')) $('ref-count').innerText = user.referrals ? user.referrals.length : 0;
    if($('ref-earned')) $('ref-earned').innerText = (user.referralEarnings || 0).toFixed(2) + ' TON';
    
    if($('ref-list')) {
        if(!user.referrals || user.referrals.length === 0) {
            $('ref-list').innerHTML = '<div style="color:#555; text-align:center;">У вас пока нет рефералов</div>';
        } else {
            $('ref-list').innerHTML = user.referrals.map(r => `
                <div style="display:flex; justify-content:space-between; border-bottom:1px solid #222; padding:5px 0;">
                    <span><span style="color:var(--neon);">ID:</span> ${r.id}</span>
                    <span style="color:var(--neon-blue);">+${(r.earnedForMe || 0).toFixed(2)} TON</span>
                </div>
            `).join('');
        }
    }
}

function toggleMode() {
    if (isCrashBetting || isCashingOut || myCrashBets.length > 0 || miActive || isFlipping || currentBattle) {
        return showToast('Сначала завершите активные ставки и игры!');
    }
    mode = mode === 'real' ? 'demo' : 'real'; 
    updateUI(); 
    showToast(`Включен ${mode} режим`); 
}

function nav(pageId, el) {
    // Если уходим с mine — убить все анимации кирок
    if (pageId !== 'mine' && typeof killAllPickaxes === 'function') killAllPickaxes();
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active')); 
    if($('page-'+pageId)) $('page-'+pageId).classList.add('active');
    if(el) { document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active')); el.classList.add('active'); }
}

function navGame(game) { 
    let mKey = game;
    if(game === 'coin') mKey = 'coinflip'; 
    if (maintenance[mKey]) return showToast('Временно тех. перерыв');
    // При уходе с Mine — убить все анимации кирок
    if (game !== 'mine') killAllPickaxes();
    nav(game); 
    if(game === 'battle') renderBattleLobbies();
    if(game === 'spin') initSpinPage();
    if(game === 'mine') { mineIsActive = true; initMineGrid(); }
}

function setQuickBet(inputId, amount, btn) {
    if ($(inputId)) $(inputId).value = amount;
    if (btn) {
        const parent = btn.closest('.quick-bets');
        if (parent) parent.querySelectorAll('.qb-btn').forEach(b => b.classList.remove('qb-sel'));
        btn.classList.add('qb-sel');
    }
}

function switchDepTab(type, el) {
    document.querySelectorAll('.w-tab').forEach(b => { b.classList.remove('active'); b.style.background='#222'; b.style.color='#fff'; });
    el.classList.add('active'); el.style.background='var(--neon)'; el.style.color='#000';
    if($('dep-manual')) $('dep-manual').style.display = type === 'manual' ? 'block' : 'none';
    if($('dep-connect')) $('dep-connect').style.display = type === 'connect' ? 'block' : 'none';
}

async function payWithTonConnect() {
    if (!tonConnectUI) return showToast('TON Connect не загружен. Перезагрузите страницу.');
    if (!tonConnectUI.connected) return showToast('Сначала подключите кошелек!');
    const amount = parseFloat($('tc-amount').value);
    if(isNaN(amount) || amount < 0.5) return showToast('Минимум 0.5 TON');
    if(!adminWalletAddress) return showToast('Кошелек получателя не настроен');

    // Build comment payload with user ID
    let payloadBase64 = "";
    try {
        if (!window.TonWeb) {
            showToast('Загрузка TonWeb...');
            await new Promise((resolve, reject) => {
                let tries = 0;
                const check = setInterval(() => {
                    tries++;
                    if (window.TonWeb) { clearInterval(check); resolve(); }
                    else if (tries > 30) { clearInterval(check); reject(new Error('TonWeb not loaded')); }
                }, 200);
            });
        }
        const tonweb = new TonWeb();
        const cell = new tonweb.boc.Cell();
        cell.bits.writeUint(0, 32);
        cell.bits.writeString(String(user.id));
        const bocBytes = await cell.toBoc();
        payloadBase64 = TonWeb.utils.bytesToBase64(bocBytes);
    } catch(e) {
        console.error('Comment payload error:', e);
    }

    const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages: [{
            address: adminWalletAddress,
            amount: (amount * 1e9).toString(),
            ...(payloadBase64 ? { payload: payloadBase64 } : {})
        }]
    };

    try {
        await tonConnectUI.sendTransaction(transaction);
        showToast('Транзакция отправлена! Автоматическая проверка через 20 сек...');

        // Auto-check deposit after delay (blockchain confirmation takes time)
        let checkAttempts = 0;
        const maxAttempts = 5;
        const autoCheck = async () => {
            checkAttempts++;
            try {
                const r = await fetch('/api/check_deposit', {
                    method: 'POST',
                    headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({id: user.id})
                });
                if (r.ok) {
                    const d = await r.json();
                    user = d.user;
                    updateUI();
                    renderWithdrawHistory();
                    showToast(`+${d.added} TON зачислено!`);
                    flyToBalance(d.added);
                    return; // success
                }
            } catch(e) {}

            if (checkAttempts < maxAttempts) {
                showToast(`Проверка ${checkAttempts}/${maxAttempts}... Ожидание подтверждения.`);
                setTimeout(autoCheck, 15000);
            } else {
                showToast('Автопроверка завершена. Нажмите "ПРОВЕРИТЬ ОПЛАТУ" вручную.');
                if($('dep-manual')) $('dep-manual').style.display = 'block';
                if($('dep-connect')) $('dep-connect').style.display = 'none';
            }
        };
        setTimeout(autoCheck, 20000);
    } catch (e) {
        console.error('TON Connect error:', e);
        if (e && e.message && e.message.includes('User rejected')) {
            showToast('Транзакция отменена пользователем');
        } else {
            showToast('Ошибка отправки транзакции. Попробуйте еще раз.');
        }
    }
}

function renderWithdrawHistory() {
    const list = $('w-history-list');
    if(!list) return;
    
    let wHtml = '';
    if(!user.withdrawHistory || user.withdrawHistory.length === 0) wHtml = '<div style="color:#555; text-align:center;">Нет выводов</div>';
    else {
        wHtml = user.withdrawHistory.map(w => {
            let cls = w.status === 'Подтверждено' ? 'approved' : (w.status === 'Отклонено' ? 'rejected' : 'pending');
            let rsn = w.reason ? `<br><span style="color:var(--neon-red); font-size:10px;">Причина: ${w.reason}</span>` : '';
            return `
                <div class="w-history-item ${cls}">
                    <div><b>ВЫВОД:</b> ${w.amount} TON<br><span style="color:#888; font-size:10px;">${w.time || ''}</span></div>
                    <div style="text-align:right;">${w.status} ${rsn}</div>
                </div>`;
        }).join('');
    }

    let dHtml = '<h4 style="color:var(--neon); margin-top:20px; text-align:center;">ИСТОРИЯ ДЕПОЗИТОВ</h4>';
    if(!user.depositHistory || user.depositHistory.length === 0) dHtml += '<div style="color:#555; text-align:center;">Нет депозитов</div>';
    else {
        dHtml += user.depositHistory.map(d => `
            <div class="w-history-item approved" style="border-left: 3px solid var(--neon);">
                <div><b>ДЕПОЗИТ:</b> ${d.amount} TON<br><span style="color:#888; font-size:10px;">${d.time || ''}</span></div>
                <div style="text-align:right; color:var(--neon);">Успешно</div>
            </div>`).join('');
    }

    list.innerHTML = wHtml + dHtml;
}

if($('online-c')) socket.on('online', c => $('online-c').innerText = c);
socket.on('rtpUpdate', r => rtpObj = r); 
socket.on('maintenanceUpdate', m => maintenance = m); 
socket.on('configUpdate', c => isShowDemo = c.showDemo);

socket.on('init_history', bets => { 
    if($('feed-list')) { 
        $('feed-list').innerHTML = ''; 
        bets.forEach(b => addLiveBetToDOM(b, true)); 
    }
});
socket.on('newHistoryEntry', b => addLiveBetToDOM(b, false));

function addLiveBetToDOM(b, isInit) {
    const list = $('feed-list');
    if(!list) return;
    if(b.mode === 'Demo' && !isShowDemo) return; 

    const d = document.createElement('div'); d.className = 'live-bet-item';
    const isWin = b.result > 0;
    const modeTag = b.mode === 'Demo' ? '<span style="color:var(--neon-blue); font-size:9px;">[DEMO]</span>' : '<span style="color:var(--neon); font-size:9px;">[REAL]</span>';
    const timeHtml = b.timeMsk ? `<span style="font-size:9px; color:#555; margin-left:5px;">${b.timeMsk}</span>` : '';
    const nameStr = b.username.includes('VS') ? `<span style="font-size:9px;">${b.username}</span>` : `${b.username} <span style="color:var(--neon); font-size:9px;">(${(b.balance||0).toFixed(2)} T)</span>`;

    d.innerHTML = `
        <div class="live-user">
            <img src="${b.avatar || 'https://cdn-icons-png.flaticon.com/512/149/149071.png'}" class="live-ava">
            <span>${nameStr} ${timeHtml}<br><b style="color:var(--sub); font-size:10px;">(${b.game})</b> ${modeTag}</span>
        </div>
        <span style="font-weight:bold; color:${isWin?'var(--neon)':'var(--neon-red)'}">${isWin ? '+'+b.result : b.result}</span>
    `;
    
    if (isInit) {
        list.appendChild(d);
    } else {
        list.prepend(d);
        if(list.children.length > 10) list.lastChild.remove();
    }
}

// CRASH
let curCrash = {}; let myCrashBets = []; let isCashingOut = false; let isCrashBetting = false; let crMode = mode; 

function getCrashColor(x) {
    const val = parseFloat(x);
    if(val < 1.3) return '#ff0055'; 
    if(val < 1.6) return '#ffcc00'; 
    if(val < 2.0) return '#aaff00'; 
    return '#00ff88'; 
}

socket.on('crashHistoryUpdate', hist => {
    if($('cr-history')) $('cr-history').innerHTML = hist.map(x => `<div class="cr-badge" style="color:${getCrashColor(x)}; border-color:${getCrashColor(x)};">${x}x</div>`).join('');
});

socket.on('crashBetsUpdate', bets => {
    if(!$('cr-live-bets')) return;
    if(bets.length === 0) $('cr-live-bets').innerHTML = '<div style="text-align:center; color:#555; padding:10px;">Ставок пока нет</div>';
    else {
        $('cr-live-bets').innerHTML = bets.map(b => {
            const modeTag = b.mode === 'demo' ? '<span style="color:var(--neon-blue); font-size:9px;">[D]</span>' : '<span style="color:var(--neon); font-size:9px;">[R]</span>';
            let statusHtml = `<span style="color:var(--text);">${b.bet} TON</span>`;
            if (b.cashedOut) statusHtml = `<span style="color:var(--neon); font-weight:bold;">Вывел ${b.win.toFixed(2)}</span>`;
            else if (curCrash.status === 'crashed') statusHtml = `<span style="color:var(--neon-red);">Проиграл</span>`;
            return `<div class="live-bet-item"><div class="live-user"><img src="${b.avatar}" class="live-ava"> <span>${b.username} ${modeTag}</span></div>${statusHtml}</div>`
        }).join('');
    }
});

socket.on('crashData', d => {
    curCrash = d; const btn = $('cr-btn');
    if(!btn) return;
    if(d.status === 'waiting') { 
        if($('cr-x')) { $('cr-x').innerText = 'ЖДЕМ'; $('cr-x').style.color = '#fff'; $('cr-x').style.textShadow = 'none'; }
        if($('cr-timer')) $('cr-timer').innerText = `СТАРТ: ${d.timer}с`; 
        if(myCrashBets.length === 0) { btn.innerText = 'ПОСТАВИТЬ'; btn.style.background = 'var(--neon)'; btn.disabled = false; } 
        else if (myCrashBets.length === 1) { btn.innerText = 'ПОСТАВИТЬ 2-Ю СТАВКУ'; btn.style.background = 'var(--neon)'; btn.disabled = false; } 
        else { btn.innerText = 'МАКС. СТАВОК (2)'; btn.style.background = '#555'; btn.disabled = true; }
    }
    if(d.status === 'running') {
        const col = getCrashColor(d.multiplier);
        if($('cr-x')) {
            $('cr-x').innerText = d.multiplier + 'x';
            $('cr-x').style.color = col;
            $('cr-x').style.textShadow = `0 0 20px ${col}40`;
            // Smooth pulse animation on multiplier update
            $('cr-x').style.transform = 'scale(1.04)';
            setTimeout(() => { if($('cr-x')) $('cr-x').style.transform = 'scale(1)'; }, 60);
        }
        if($('cr-timer')) $('cr-timer').innerText = '🚀 В ПОЛЕТЕ';
        if (myCrashBets.length > 0) { btn.innerText = `ЗАБРАТЬ ${(myCrashBets[0] * d.multiplier).toFixed(2)} TON`; btn.style.background = 'var(--neon-red)'; btn.disabled = false; }
        else { btn.innerText = 'ОЖИДАНИЕ'; btn.style.background = '#555'; btn.disabled = true; }
    }
    if(d.status === 'crashed') {
        playSound('break');
        if($('cr-x')) { $('cr-x').innerText = 'BOOM!'; $('cr-x').style.color = 'var(--neon-red)'; $('cr-x').style.textShadow = `0 0 20px rgba(255,0,85,0.4)`; }
        if(myCrashBets.length > 0) myCrashBets = []; 
        btn.innerText = 'ПОСТАВИТЬ'; btn.style.background = 'var(--neon)'; btn.disabled = false; isCashingOut = false;
    }
});

async function playCrash() {
    if(isCashingOut || isCrashBetting) return; 
    const btn = $('cr-btn'); const curBal = mode === 'real' ? user.balance : user.demo_balance;
    if(curCrash.status === 'waiting') {
        if (myCrashBets.length >= 2) return showToast('Максимум 2 ставки!');
        let crBet = parseFloat($('cr-bet').value); 
        if(isNaN(crBet) || crBet < 0.1 || crBet > 25) return showToast('Мин 0.1, Макс 25 TON');
        if(crBet > curBal) return showToast('Недостаточно средств!');
        
        playSound('click');
        isCrashBetting = true; btn.disabled = true;
        crMode = mode;
        const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game:'Crash', bet:crBet, win:0, mode: crMode}) });
        isCrashBetting = false; btn.disabled = false;
        
        if(r.ok) { user = await r.json(); updateUI(); myCrashBets.push(crBet); btn.innerText = myCrashBets.length === 1 ? 'ПОСТАВИТЬ 2-Ю СТАВКУ' : 'МАКС. СТАВОК (2)'; if(myCrashBets.length===2) btn.disabled=true; showToast('Принято!'); } 
        else { showToast('Ошибка ставки!'); }
    } else if(curCrash.status === 'running' && myCrashBets.length > 0) {
        playSound('click');
        isCashingOut = true; const win = myCrashBets[0] * curCrash.multiplier;
        const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game:'Crash', bet:0, win:win, mode: crMode}) });
        if(r.ok) { user = await r.json(); updateUI(); myCrashBets.shift(); playSound('win'); showToast(`+ ${win.toFixed(2)} TON!`); flyToBalance(win); if (myCrashBets.length > 0) btn.innerText = `ЗАБРАТЬ ${(myCrashBets[0] * curCrash.multiplier).toFixed(2)} TON`; else { btn.innerText = 'ОЖИДАНИЕ'; btn.style.background = '#555'; btn.disabled = true; } }
        else { showToast('Не успел!'); } isCashingOut = false;
    }
}

// MINES
let miActive = false; let bombs = []; let miBet = 0; let openedCells = 0; let currentMinesWin = 0; 
let isMinesProcessing = false; let miMode = mode;

function playMines() {
    if(isMinesProcessing) return;
    const curBal = mode === 'real' ? user.balance : user.demo_balance;
    if(miActive) { 
        isMinesProcessing = true;
        $('mi-btn').disabled = true;
        reqBet('Mines', 0, currentMinesWin, miMode).then(ok => { 
            isMinesProcessing = false;
            $('mi-btn').disabled = false;
            if(ok) { miActive = false; $('mi-btn').innerText='ИГРАТЬ'; showToast(`Забрал ${currentMinesWin.toFixed(2)} TON!`); flyToBalance(currentMinesWin); renderMines(true); }
        }); 
        return; 
    }
    miBet = parseFloat($('mi-bet').value); 
    if(isNaN(miBet) || miBet < 0.1 || miBet > 25) return showToast('Мин 0.1, Макс 25 TON');
    if(miBet > curBal) return showToast('Нет средств!');
    
    isMinesProcessing = true; $('mi-btn').disabled = true; miMode = mode;
    reqBet('Mines', miBet, 0, miMode).then(success => {
        isMinesProcessing = false; $('mi-btn').disabled = false;
        if(success) {
            bombs = []; while(bombs.length<5) { let r=Math.floor(Math.random()*25); if(!bombs.includes(r)) bombs.push(r); }
            miActive = true; openedCells = 0; currentMinesWin = miBet; $('mi-btn').innerText = `ЗАБРАТЬ ${currentMinesWin.toFixed(2)} TON`; renderMines(); showToast('Ищи кристаллы!');
        }
    });
}

function renderMines(isEnd = false) {
    if(!$('mine-grid')) return;
    $('mine-grid').innerHTML = '';
    for(let i=0; i<25; i++) {
        let c = document.createElement('div'); c.className = 'm-cell';
        if(isEnd && miActive===false) {
             c.innerText = bombs.includes(i) ? '💣' : '💎';
             c.style.opacity = '0.5';
             $('mine-grid').appendChild(c);
             continue;
        }
        // Show empty cells before game starts (field is visible)
        if(!miActive) {
            c.style.cursor = 'default';
        }
        c.onclick = () => {
            if(!miActive || c.classList.contains('open') || isMinesProcessing) return;
            playSound('click');
            let hitBomb = bombs.includes(i);
            if (!hitBomb) { if (Math.random() > ((rtpObj.mines||90) / 100)) { hitBomb = true; bombs[0] = i; } }

            if(hitBomb) {
                playSound('break');
                miActive=false; $('mi-btn').innerText='ИГРАТЬ'; showToast('БУМ!');
                const cells = document.querySelectorAll('.m-cell');
                cells.forEach((cell, idx) => {
                    cell.innerText = bombs.includes(idx) ? '💣' : '💎';
                    if(bombs.includes(idx)) { cell.style.background = 'var(--neon-red)'; cell.style.borderColor = 'var(--neon-red)'; }
                });
            } else {
                playSound('hit');
                c.innerText='💎'; c.classList.add('open'); c.style.borderColor='var(--neon)'; openedCells++;
                currentMinesWin = miBet * (1 + openedCells * 0.2); $('mi-btn').innerText = `ЗАБРАТЬ ${currentMinesWin.toFixed(2)} TON`;
            }
        }; $('mine-grid').appendChild(c);
    }
}
// Show mines grid on page load
setTimeout(() => renderMines(), 300);

// COINFLIP
let cSide = 'L'; let isFlipping = false;
function setSide(s) { 
    if(isFlipping) return; 
    cSide = s; 
    $('side-l').classList.toggle('active', s==='L'); 
    $('side-x').classList.toggle('active', s==='X'); 
    
    $('side-l').style.boxShadow = s === 'L' ? '0 0 15px var(--neon)' : 'none';
    $('side-l').style.borderColor = s === 'L' ? 'var(--neon)' : '#333';
    
    $('side-x').style.boxShadow = s === 'X' ? '0 0 15px var(--neon-red)' : 'none';
    $('side-x').style.borderColor = s === 'X' ? 'var(--neon-red)' : '#333';
}

setTimeout(() => setSide('L'), 500);

async function playCoin() {
    if(isFlipping) return;
    const curBal = mode === 'real' ? user.balance : user.demo_balance;
    const bet = parseFloat($('co-bet').value); 
    if(isNaN(bet) || bet < 0.1 || bet > 25) return showToast('Мин 0.1, Макс 25 TON');
    if(bet > curBal) return showToast('Недостаточно средств!');

    playSound('click');
    isFlipping = true; $('co-btn').innerText = 'КРУТИМ...'; $('co-btn').disabled = true;
    let coMode = mode; 
    
    const winChance = ((rtpObj.coinflip || 90) / 100) * 0.5; 
    const isWin = Math.random() < winChance;
    const result = isWin ? cSide : (cSide === 'L' ? 'X' : 'L');
    
    const coin = $('coin-3d');
    const rotation = result === 'L' ? 1800 : 1980;
    coin.style.transition = 'transform 2s cubic-bezier(0.2, 0.8, 0.2, 1)';
    coin.style.transform = `rotateY(${rotation}deg)`;
    
    setTimeout(async () => {
        const win = result === cSide ? bet*2 : 0;
        if (win > 0) playSound('win');
        showToast(win > 0 ? `Победа! +${win.toFixed(2)}` : `Проигрыш: ${result}`); 
        await reqBet('Coinflip', bet, win, coMode);
        if(win > 0) flyToBalance(win); 
        
        setTimeout(() => {
            coin.style.transition = 'none'; 
            coin.style.transform = `rotateY(${result === 'L' ? 0 : 180}deg)`; 
            isFlipping = false; $('co-btn').innerText = 'КРУТИТЬ'; $('co-btn').disabled = false;
        }, 500);
    }, 2000);
}


// --- BATTLE ROULETTE КЛИЕНТ ---
let battleLobbies = [];
let currentBattle = null;

socket.on('battleUpdate', () => { renderBattleLobbies(); });

socket.on('battleSpin', ({lobbyId, winnerId}) => {
    if(currentBattle && currentBattle._id === lobbyId) {
        currentBattle.status = 'spinning';
        $('battle-join-area').style.display = 'none'; 
        
        const wheel = $('battle-wheel');
        const timerObj = $('battle-timer');
        
        timerObj.className = 'timer-pulse';
        timerObj.innerText = 'РУЛЕТКА КРУТИТСЯ!';
        
        wheel.style.transition = 'transform 5s cubic-bezier(0.2, 0.8, 0.2, 1)';
        
        let totalPool = currentBattle.players.reduce((s, p) => s + p.bet, 0);
        let startAngle = 0;
        let winAngle = 0;
        
        for(let p of currentBattle.players) {
            let slice = (p.bet / totalPool) * 360;
            if(p.id === winnerId) { winAngle = startAngle + (slice / 2); break; }
            startAngle += slice;
        }
        
        const rotations = 3600; 
        const finalTransform = rotations + (270 - winAngle);
        wheel.style.transform = `rotate(${finalTransform}deg)`;
        
        setTimeout(() => {
            const winner = currentBattle.players.find(p => p.id === winnerId);
            const pureWin = totalPool - winner.bet; 
            
            timerObj.className = 'timer-pulse';
            timerObj.innerText = `ПОБЕДИЛ: ${winner.username}!`;
            timerObj.style.color = winner.color;
            timerObj.style.textShadow = `0 0 15px ${winner.color}`;
            currentBattle.status = 'finished'; // Устанавливаем статус завершено локально
            
            showToast(`${winner.username} забирает чистыми +${pureWin.toFixed(2)} TON!`);
            if (winner.id === user.id) flyToBalance(totalPool); 
        }, 5000);
    }
});

function openBattleModal() {
    if(mode === 'demo') return showToast('Battle Roulette доступна только на REAL TON!');
    $('battle-modal').style.display = 'flex';
}

async function createBattleLobby() {
    const bet = parseFloat($('b-bet').value);
    
    if(isNaN(bet) || bet < 0.5 || bet > 150) return showToast('Ваша ставка от 0.5 до 150 TON'); 
    
    const r = await fetch('/api/battle/create', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, bet}) });
    if(r.ok) { user = await r.json(); updateUI(); $('battle-modal').style.display='none'; showToast('Лобби создано!'); }
    else { const e = await r.json(); showToast(e.error || 'Ошибка'); }
}

async function submitBattleJoin() {
    if(!currentBattle) return;
    const betStr = $('battle-join-bet').value;
    const bet = parseFloat(betStr);
    
    if(isNaN(bet) || bet < 0.5 || bet > 150) {
        return showToast(`Сумма от 0.5 до 150 TON`);
    }
    
    const r = await fetch('/api/battle/join', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, lobbyId: currentBattle._id, bet}) });
    if(r.ok) { 
        const d = await r.json(); user = d.user; updateUI(); showToast('Вы вошли в лобби!'); 
        $('battle-join-area').style.display = 'none'; 
        openBattleGame(d.lobby); 
    } else { const e = await r.json(); showToast(e.error || 'Ошибка'); }
}


async function cancelBattle(lobbyId) {
    if(!confirm('Отменить лобби и вернуть TON?')) return;
    const r = await fetch('/api/battle/cancel', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, lobbyId}) });
    if(r.ok) { user = await r.json(); updateUI(); showToast('Лобби отменено!'); }
    else showToast('Ошибка отмены');
}

async function renderBattleLobbies() {
    const r = await fetch('/api/battle/list');
    if(!r.ok) return;
    battleLobbies = await r.json();
    
    const list = $('battle-lobbies');
    if(!list) return;

    if($('my-lobbies-chk') && $('my-lobbies-chk').checked) {
        battleLobbies.sort((a,b) => {
            let aMine = a.players.some(p => p.id === user.id) ? -1 : 1;
            let bMine = b.players.some(p => p.id === user.id) ? -1 : 1;
            return aMine - bMine;
        });
    }

    list.innerHTML = battleLobbies.map(l => {
        const creator = l.players[0];
        const isMine = l.creatorId === user.id;
        const imIn = l.players.some(p => p.id === user.id);
        
        let actionBtn = '';
        if(l.status === 'finished') {
            actionBtn = `<button class="btn" style="background:#444; color:#aaa; padding:5px 10px; font-size:12px;" disabled>ЗАВЕРШЕНО</button>`;
        } else if(isMine && l.players.length === 1) {
            actionBtn = `<button class="btn" style="background:var(--neon-red); padding:5px; font-size:12px;" onclick="cancelBattle('${l._id}')">ОТМЕНА</button>`;
        } else {
            actionBtn = `<button class="btn" style="background:var(--neon); color:#000; padding:5px 10px; font-size:12px; font-weight:bold;" onclick="openBattleGame('${l._id}')">${imIn ? 'СМОТРЕТЬ' : 'ВОЙТИ / СМОТРЕТЬ'}</button>`;
        }

        const timeStr = new Date(l.createdAt).toLocaleTimeString("ru-RU", {timeZone:"Europe/Moscow", hour:"2-digit", minute:"2-digit"});
        
        return `
        <div style="background:#1a1a1a; border:1px solid ${isMine?'var(--neon)':'#333'}; padding:10px; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:10px;">
                <img src="${creator.avatar}" style="width:30px; border-radius:50%; opacity: ${l.status==='finished'?'0.5':'1'};">
                <div style="opacity: ${l.status==='finished'?'0.5':'1'};">
                    <b style="color:var(--text);">${creator.username}</b> <span style="font-size:10px; color:#555;">[${timeStr}]</span><br>
                    <span style="font-size:10px; color:var(--neon-blue);">Игроков: ${l.players.length}/4</span>
                </div>
            </div>
            <div>${actionBtn}</div>
        </div>`;
    }).join('') || '<div style="text-align:center; color:#555;">Нет открытых лобби</div>';
}

function openBattleGame(lobbyId) {
    if(mode === 'demo') { showToast('Только REAL TON!'); return; }
    let lobby = typeof lobbyId === 'string' ? battleLobbies.find(l => l._id === lobbyId) : lobbyId;
    if(!lobby) return;
    currentBattle = lobby;
    
    $('battle-game-modal').style.display = 'flex';
    $('battle-wheel').style.transition = 'none';
    $('battle-wheel').style.transform = 'rotate(0deg)';
    
    $('battle-timer').className = 'timer-wait';
    $('battle-timer').style.color = '#fff';
    $('battle-timer').style.textShadow = 'none';
    
    drawBattleWheel(lobby);
    renderBattlePlayers(lobby);
    
    const imIn = lobby.players.some(p => p.id === user.id);
    if (!imIn && lobby.status === 'waiting' && lobby.players.length < 4) {
        $('battle-join-area').style.display = 'block';
        $('battle-join-bet').placeholder = `Сумма (0.5 - 150 TON)`;
    } else {
        $('battle-join-area').style.display = 'none';
    }

    const updateTimer = () => {
        if(!currentBattle) return;
        if(currentBattle.status === 'finished') {
            $('battle-timer').innerText = 'БИТВА ОКОНЧЕНА';
            return;
        }
        if(currentBattle.status !== 'waiting') return;
        
        const timerObj = $('battle-timer');
        
        if(currentBattle.players.length < 2) {
            timerObj.className = 'timer-wait';
            timerObj.innerText = 'ОЖИДАНИЕ ИГРОКОВ...';
            setTimeout(updateTimer, 1000);
            return;
        }

        if (!currentBattle.timerEndTime) {
            timerObj.innerText = 'ПОДГОТОВКА...';
            setTimeout(updateTimer, 1000);
            return;
        }

        const endTime = new Date(currentBattle.timerEndTime).getTime();
        const left = Math.floor((endTime - Date.now()) / 1000);
        
        if(left > 0) {
            let m = Math.floor(left / 60); let s = left % 60;
            timerObj.className = 'timer-pulse';
            timerObj.innerText = `СТАРТ ЧЕРЕЗ: 0${m}:${s<10?'0'+s:s}`;
            timerObj.style.color = '#fff';
            timerObj.style.textShadow = 'none'; 
            setTimeout(updateTimer, 1000);
        } else {
            timerObj.className = 'timer-pulse';
            timerObj.innerText = 'ЗАПУСК...';
        }
    };
    updateTimer();
}

function closeBattleGame() {
    $('battle-game-modal').style.display = 'none';
    currentBattle = null;
}

function drawBattleWheel(lobby) {
    const canvas = $('battle-wheel');
    const ctx = canvas.getContext('2d');
    
    const dpr = window.devicePixelRatio || 1;
    const baseSize = 280; 
    canvas.style.width = baseSize + 'px';
    canvas.style.height = baseSize + 'px';
    canvas.width = baseSize * dpr;
    canvas.height = baseSize * dpr;
    
    ctx.scale(dpr, dpr);
    
    const cw = baseSize / 2;
    const ch = baseSize / 2;
    
    ctx.clearRect(0, 0, baseSize, baseSize);
    
    const totalPool = lobby.players.reduce((sum, p) => sum + p.bet, 0);
    let startAngle = 0;
    
    for (let p of lobby.players) {
        let sliceAngle = (p.bet / totalPool) * 2 * Math.PI;
        
        ctx.beginPath();
        ctx.moveTo(cw, ch);
        ctx.arc(cw, ch, cw - 4, startAngle, startAngle + sliceAngle); 
        ctx.closePath();
        
        let gradient = ctx.createLinearGradient(cw - baseSize/2, ch - baseSize/2, cw + baseSize/2, ch + baseSize/2);
        gradient.addColorStop(0, p.color);
        gradient.addColorStop(1, '#1a1a1a');
        
        ctx.fillStyle = gradient;
        ctx.fill();
        
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#0a0a0a';
        ctx.stroke();

        ctx.save();
        ctx.translate(cw, ch);
        ctx.rotate(startAngle + sliceAngle / 2);
        ctx.textAlign = "right";
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 13px sans-serif";
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 4;
        ctx.fillText(p.username, cw - 20, 4);
        ctx.restore();
        
        startAngle += sliceAngle;
    }
    
    ctx.beginPath();
    ctx.arc(cw, ch, 25, 0, 2 * Math.PI);
    ctx.fillStyle = '#111';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#222';
    ctx.stroke();
    
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#555";
    ctx.font = "bold 10px sans-serif";
    ctx.fillText("TON", cw, ch);
}

function renderBattlePlayers(lobby) {
    const totalPool = lobby.players.reduce((sum, p) => sum + p.bet, 0);
    $('battle-players').innerHTML = lobby.players.map(p => {
        const perc = ((p.bet / totalPool) * 100).toFixed(1);
        return `
        <div style="background:#111; border-left:4px solid ${p.color}; padding:8px; border-radius:6px; flex: 1 1 45%; max-width:48%; text-align:left;">
            <img src="${p.avatar}" style="width:20px; border-radius:50%; vertical-align:middle;"> 
            <span style="font-size:12px; font-weight:bold;">${p.username}</span><br>
            <span style="font-size:12px; color:var(--neon);">${p.bet} TON</span> <span style="font-size:10px; color:#888;">(${perc}%)</span>
        </div>`;
    }).join('');
}

// ФИНАНСЫ И ПРОМО
async function checkRealDeposit(btn) {
    btn.innerText = "ПРОВЕРЯЕМ..."; btn.disabled = true;
    const r = await fetch('/api/check_deposit', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id}) });
    if(r.ok) { const d = await r.json(); user = d.user; updateUI(); renderWithdrawHistory(); showToast(`+${d.added} TON`); } 
    else { const e = await r.json(); showToast(e.error || 'Не найдено'); } 
    btn.innerText = "ПРОВЕРИТЬ ОПЛАТУ"; btn.disabled = false;
}

async function withdraw() {
    const a = parseFloat($('with-amount').value); 
    const ad = $('with-addr').value;
    
    if(!ad || !ad.trim()) return showToast('Введите адрес кошелька!');
    if(a > user.balance || a < 5) return showToast('Ошибка (Мин 5 TON)');
    
    const btn = document.querySelector('.btn-withdraw'); btn.disabled = true; btn.innerText = "СОЗДАНИЕ...";
    const r = await fetch('/api/withdraw', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, address:ad, amount:a}) });
    btn.disabled = false; btn.innerText = "СОЗДАТЬ ЗАЯВКУ";
    
    if(r.ok) { user = await r.json(); updateUI(); renderWithdrawHistory(); showToast('Заявка создана!'); $('with-amount').value=''; $('with-addr').value=''; } 
    else showToast('Ошибка вывода');
}

async function activatePromo() {
    const code = $('promo-code').value;
    const r = await fetch('/api/promo', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, code}) });
    if(r.ok) { 
        user = await r.json(); 
        updateUI(); 
        showToast('Активирован!'); 
        $('promo-code').value=''; 
    } else { 
        const e = await r.json(); 
        showToast(e.error || 'Ошибка промо');
    }
}

async function reqBet(game, bet, win, reqMode = mode) {
    try {
        const r = await fetch('/api/bet', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:user.id, game, bet, win, mode: reqMode}) });
        if(r.ok) { 
            user = await r.json(); 
            updateUI(); 
            return true; 
        } else { 
            const err = await r.json();
            showToast(err.error || 'Ошибка баланса'); 
            return false; 
        }
    } catch(e) {
        showToast('Сбой сети');
        return false;
    }
}

// АДМИН ПАНЕЛЬ
let aTaps = 0; let adminSearchQuery = ''; let currentAdminFilter = 'balance';
async function checkAdmin() { aTaps++; if(aTaps >= 5) { aTaps = 0; let p = prompt('Пароль:'); if(p) { adminPass = p; loadAdminData(); } } }

function switchAdminTab(tab) { 
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active')); 
    if (typeof event !== 'undefined' && event && event.target) event.target.classList.add('active');
    
    if (tab === 'logs') {
        const c = $('admin-content');
        c.innerHTML = '<div style="text-align:center; padding:20px; color:var(--neon);">Загрузка логов...</div>';
        loadAdminLogs(1, '');
    } else if (tab === 'stats') {
        loadAdminGameStats();
    } else {
        renderAdminContent(tab); 
    }
}

let adData = {};
async function loadAdminData() {
    const r = await fetch('/api/admin/data', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass}) });
    if(r.ok) { adData = await r.json(); $('admin-modal').style.display = 'flex'; switchAdminTab('withdraws'); } else showToast('Неверный пароль');
}

async function searchAdminUsers(query, filterType = currentAdminFilter) {
    adminSearchQuery = query;
    currentAdminFilter = filterType;
    const r = await fetch('/api/admin/search_user', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, query, filterType}) });
    if(r.ok) { const d = await r.json(); adData.users = d.users; renderAdminContent('users'); }
}

async function adminViewUser(userId, page = 1) {
    const r = await fetch('/api/admin/user_details', { 
        method:'POST', 
        headers:{'Content-Type':'application/json'}, 
        body:JSON.stringify({pass: adminPass, userId, page}) 
    });
    
    if(!r.ok) return showToast('Ошибка загрузки юзера');
    const data = await r.json();
    const u = data.user;
    const hist = data.history || [];
    const totalPages = data.pagination ? data.pagination.totalPages : 1;
    const deposits = data.deposits || [];
    const withdrawals = data.withdrawals || [];
    const totalUserDep = data.totalUserDeposited || 0;
    const totalUserWith = data.totalUserWithdrawn || 0;
    const wagerReq = data.wagerRequired || 0;
    const wagerDone = data.wagerCompleted || 0;
    const wagerLeft = Math.max(0, wagerReq - wagerDone);

    const c = $('admin-content');
    c.innerHTML = `
        <button onclick="renderAdminContent('users')" class="btn" style="margin-bottom:15px; background:#333; font-size:12px;">← НАЗАД К СПИСКУ</button>

        <div style="background:#1a1a1a; padding:15px; border-radius:8px; margin-bottom:15px; border:1px solid var(--neon);">
            <h3 style="color:var(--neon); margin-bottom:5px;">${u.username || 'Игрок'} (ID: ${u.id})</h3>
            <p style="font-size:14px; margin-bottom:5px;"><b>Баланс:</b> <span style="color:var(--neon); font-weight:bold;">${u.balance.toFixed(2)} TON</span></p>
            <p style="font-size:12px; color:#888; margin-bottom:3px;">Реф. доход: ${(u.referralEarnings || 0).toFixed(2)} TON | Промо: ${(u.stats?.promo || 0).toFixed(2)} TON</p>
            <p style="font-size:12px; color:#888; margin-bottom:3px;">Всего проиграно: ${(u.stats?.minus || 0).toFixed(2)} TON | Выиграно: ${(u.stats?.plus || 0).toFixed(2)} TON</p>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:10px 0; background:#111; padding:10px; border-radius:6px;">
                <div style="text-align:center;"><div style="font-size:10px; color:#888;">ПОПОЛНЕНО</div><div style="color:var(--neon); font-weight:bold;">${totalUserDep.toFixed(2)} TON</div></div>
                <div style="text-align:center;"><div style="font-size:10px; color:#888;">ВЫВЕДЕНО</div><div style="color:var(--neon-red); font-weight:bold;">${totalUserWith.toFixed(2)} TON</div></div>
                <div style="text-align:center;"><div style="font-size:10px; color:#888;">ОТЫГРЫШ</div><div style="color:#ffcc00; font-weight:bold;">${wagerDone.toFixed(2)} / ${wagerReq.toFixed(2)}</div></div>
                <div style="text-align:center;"><div style="font-size:10px; color:#888;">ОСТАЛОСЬ</div><div style="color:${wagerLeft > 0 ? 'var(--neon-red)' : 'var(--neon)'}; font-weight:bold;">${wagerLeft.toFixed(2)} TON</div></div>
            </div>

            <div style="display:flex; gap:10px; margin-bottom:10px;">
                <input type="number" id="ad-bal-val" class="input-box" placeholder="Сумма TON" style="margin-bottom:0;">
            </div>
            <div style="display:flex; gap:10px; margin-bottom:10px;">
                <button class="btn" style="background:var(--neon); color:#000; font-size:12px;" onclick="adminChangeBal('${u.id}', 'add')">ВЫДАТЬ</button>
                <button class="btn" style="background:var(--neon-red); font-size:12px;" onclick="adminChangeBal('${u.id}', 'sub')">ЗАБРАТЬ</button>
            </div>
            <div style="display:flex; gap:10px;">
                <button class="btn" style="background:var(--neon-blue); color:#000; font-size:12px;" onclick="adminMsgUser('${u.id}')">НАПИСАТЬ В ЛС</button>
                <button class="btn" style="background:${u.isBlocked?'#555':'red'}; font-size:12px;" onclick="adminBan('${u.id}', ${!u.isBlocked}); setTimeout(()=>adminViewUser('${u.id}',1), 500)">${u.isBlocked?'РАЗБАН':'БАН'}</button>
            </div>
        </div>

        <h4 style="color:var(--neon-blue); margin-bottom:8px;">Депозиты (${deposits.length})</h4>
        <div style="max-height:120px; overflow-y:auto; background:#111; border-radius:6px; margin-bottom:15px; padding:5px;">
            ${deposits.length > 0 ? deposits.map(d => `<div style="padding:4px 8px; border-bottom:1px solid #222; font-size:11px;"><span style="color:var(--neon);">+${d.amount} TON</span> <span style="color:#666;">${d.time || ''}</span></div>`).join('') : '<div style="color:#555; text-align:center; padding:10px;">Нет депозитов</div>'}
        </div>

        <h4 style="color:var(--neon-red); margin-bottom:8px;">Выводы (${withdrawals.length})</h4>
        <div style="max-height:120px; overflow-y:auto; background:#111; border-radius:6px; margin-bottom:15px; padding:5px;">
            ${withdrawals.length > 0 ? withdrawals.map(w => `<div style="padding:4px 8px; border-bottom:1px solid #222; font-size:11px;"><span style="color:var(--neon-red);">-${w.amount} TON</span> <span style="color:${w.status==='approved'?'var(--neon)':w.status==='rejected'?'#ff4444':'#ffcc00'}">${w.status}</span> <span style="color:#666;">${w.time || ''}</span></div>`).join('') : '<div style="color:#555; text-align:center; padding:10px;">Нет выводов</div>'}
        </div>

        <h4 style="color:var(--neon-blue); margin-top:10px; margin-bottom:10px;">История ставок (Стр. ${page} / ${totalPages})</h4>
        <div style="overflow-x:auto;">
            <table style="width:100%; font-size:11px; text-align:left; border-collapse: collapse; background:#111; border-radius:8px;">
                <tr style="background:#222; border-bottom:1px solid #444;">
                    <th style="padding:10px;">Время</th>
                    <th>Игра</th>
                    <th>Ставка -> Результат</th>
                    <th>Баланс</th>
                </tr>
                ${hist.length > 0 ? hist.map(h => `
                <tr style="border-bottom:1px solid #222;">
                    <td style="padding:8px; color:#666;">${h.timeMsk || '---'}</td>
                    <td style="font-weight:bold;">${h.game}</td>
                    <td style="color:${h.result > 0 ? 'var(--neon)' : '#ff4d4d'}">
                        ${h.amount} -> ${h.result > 0 ? '+' : ''}${h.result}
                    </td>
                    <td style="color:#aaa;">${(h.balanceAfter || 0).toFixed(2)}</td>
                </tr>
                `).join('') : '<tr><td colspan="4" style="padding:20px; text-align:center; color:#555;">История пуста</td></tr>'}
            </table>
        </div>

        <div style="display:flex; justify-content:space-between; margin-top:15px; margin-bottom:30px;">
            <button class="btn" style="width:48%; background:#222; font-size:12px;" onclick="adminViewUser('${u.id}', ${page > 1 ? page - 1 : 1})" ${page === 1 ? 'disabled' : ''}>← Назад</button>
            <button class="btn" style="width:48%; background:#222; font-size:12px;" onclick="adminViewUser('${u.id}', ${page + 1})" ${page >= totalPages ? 'disabled' : ''}>Вперед →</button>
        </div>
    `;
}

async function adminChangeBal(userId, type) {
    const valInput = document.getElementById('ad-bal-val');
    const amountStr = valInput.value;
    const amount = parseFloat(amountStr);
    
    if(isNaN(amount) || amount <= 0) {
        return showToast('Введите корректную сумму больше 0');
    }
    
    try {
        const response = await fetch('/api/admin/change_balance', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ pass: adminPass, userId: userId, amount: amount, type: type }) 
        });

        const result = await response.json();

        if (response.ok) {
            showToast(type === 'add' ? `✅ Начислено ${amount} TON` : `📉 Списано ${amount} TON`);
            valInput.value = ''; 
            adminViewUser(userId, 1); 
            
            if (adData.users) {
                const userInList = adData.users.find(u => String(u.id) === String(userId));
                if (userInList) userInList.balance = result.newBalance; 
            }
            if (user && String(userId) === String(user.id)) {
                user.balance = result.newBalance;
                updateUI();
            }
        } else {
            showToast(`❌ Ошибка: ${result.error || 'Сервер отклонил запрос'}`);
        }
    } catch (e) {
        console.error('Ошибка баланса:', e);
        showToast('🆘 Сбой сети');
    }
}

function renderAdminContent(tab) {
    const c = $('admin-content');
    if(tab === 'withdraws') {
        c.innerHTML = `
            <div style="background:#222; padding:10px; border-radius:8px; margin-bottom:15px; text-align:center;">
                <div style="color:var(--neon); font-size:18px;"><b>ВСЕГО ДЕПОВ:</b> ${adData.totalDeposited.toFixed(2)} TON</div>
                <div style="color:var(--neon-red); font-size:18px;"><b>ВСЕГО ВЫВОДОВ:</b> ${adData.totalWithdrawn.toFixed(2)} TON</div>
            </div>
            <h4 style="color:var(--neon);">ОЖИДАЮТ ВЫПЛАТЫ</h4>
            ${adData.withdraws.map(w => `
                <div style="background:#1a1a1a; padding:10px; border-radius:8px; margin-bottom:10px;">
                    <b>ID:</b> ${w.userId} <br> <b>Сумма:</b> ${w.amount} TON <br> <code style="word-break: break-all; font-size:10px;">${w.address}</code><br>
                    <button class="btn" style="padding:8px; margin-top:5px;" onclick="adminW('${w._id}', 'approve')">ОДОБРИТЬ</button>
                    <button class="btn" style="padding:8px; margin-top:5px; background:var(--neon-red);" onclick="adminW('${w._id}', 'reject')">ОТКЛОНИТЬ (ВЕРНУТЬ)</button>
                </div>
            `).join('') || '<div style="color:#555;">Нет заявок</div>'}
            
            <hr>
            <h4 style="color:var(--neon);">ПОСЛЕДНИЕ ДЕПОЗИТЫ</h4>
            ${adData.latestDeposits.map(d => `
                <div style="padding:8px; border-bottom:1px solid #333;">
                    <a href="tg://user?id=${d.userId}" style="color:var(--neon); text-decoration:none;"><b>@${d.username}</b></a>
                    (ID: ${d.userId}) <br>
                    Пополнил: <b style="color:#fff;">${d.amount} TON</b> <span style="font-size:10px; color:#888;">[${d.time}]</span>
                </div>
            `).join('') || '<div style="color:#555;">Нет депозитов</div>'}
        `;
    }
    if(tab === 'promo') { 
        c.innerHTML = `
            <input type="text" id="ad-pr-code" class="input-box" style="padding:10px; font-size:14px;" placeholder="Код">
            <input type="number" id="ad-pr-sum" class="input-box" style="padding:10px; font-size:14px;" placeholder="Сумма TON">
            <input type="number" id="ad-pr-lim" class="input-box" style="padding:10px; font-size:14px;" placeholder="Лимит активаций">
            <button class="btn" style="padding:10px;" onclick="adminPromo()">СОЗДАТЬ ПРОМО</button><hr>
            ${adData.promos.map(p => {
                const usedListHtml = p.usedBy.map(uid => `<a href="tg://user?id=${uid}" style="color:var(--neon);">ID: ${uid}</a>`).join(', ');
                return `
                <div style="padding:8px; border-bottom:1px solid #222;">
                    <div><b>${p.code}</b> - ${p.amount} TON | Осталось: <span style="color:var(--neon)">${p.limit - p.usedBy.length}</span> из ${p.limit}</div>
                    <div style="font-size:10px; margin-top:5px; max-height:40px; overflow-y:auto; background:#111; padding:5px;">Использовали: ${usedListHtml || 'Никто'}</div>
                    <button style="background:var(--neon-red); color:#fff; border:none; padding:4px 8px; border-radius:4px; margin-top:5px;" onclick="adminDelPromo('${p._id}')">Удалить</button>
                </div>
            `}).join('')}
        `;
    }
    if(tab === 'rtp') {
        c.innerHTML = `
            <h4 style="color:var(--neon);">РАССЫЛКА В БОТА</h4>
            <textarea id="ad-bot-msg" class="input-box" style="height:60px; font-size:12px;" placeholder="Сообщение ВСЕМ в бота..."></textarea>
            <button class="btn" style="padding:8px; margin-top:0; margin-bottom:20px; background:var(--neon-blue); color:#000;" onclick="adminBotBroadcast()">ОТПРАВИТЬ ВСЕМ</button>
            <hr>
            <h4 style="color:var(--neon);">ОБНУЛЕНИЕ</h4>
            <button class="btn" style="padding:8px; background:red; margin-bottom:20px;" onclick="adminReset()">ОБНУЛИТЬ ИСТОРИЮ (Баланс останется)</button>
            <hr>
            <h4 style="color:var(--neon); margin-bottom:10px;">RTP</h4>
            <div><b>Crash RTP (%):</b> <input type="number" id="rtp-crash" value="${adData.rtp.crash||90}" class="input-box" style="padding:5px; width:70px; display:inline-block;"> <button class="btn" style="padding:5px; width:auto; display:inline-block;" onclick="adminRTP('crash')">OK</button></div>
            <div><b>Mines RTP (%):</b> <input type="number" id="rtp-mines" value="${adData.rtp.mines||90}" class="input-box" style="padding:5px; width:70px; display:inline-block;"> <button class="btn" style="padding:5px; width:auto; display:inline-block;" onclick="adminRTP('mines')">OK</button></div>
            <div><b>Coinflip RTP (%):</b> <input type="number" id="rtp-coinflip" value="${adData.rtp.coinflip||90}" class="input-box" style="padding:5px; width:70px; display:inline-block;"> <button class="btn" style="padding:5px; width:auto; display:inline-block;" onclick="adminRTP('coinflip')">OK</button></div>
            <div><b>🎰 Spin RTP (%):</b> <input type="number" id="rtp-spin" value="${adData.rtp.spin||40}" class="input-box" style="padding:5px; width:70px; display:inline-block;"> <button class="btn" style="padding:5px; width:auto; display:inline-block; background:linear-gradient(90deg,#ff6b00,#ff0055);" onclick="adminRTP('spin')">OK</button></div>
            <div><b>⛏️ Mine RTP (%):</b> <input type="number" id="rtp-mine" value="${adData.rtp.mine||40}" class="input-box" style="padding:5px; width:70px; display:inline-block;"> <button class="btn" style="padding:5px; width:auto; display:inline-block; background:linear-gradient(90deg,#7a4920,#c07030);" onclick="adminRTP('mine')">OK</button></div>
            <hr>
            <h4 style="color:var(--neon); margin-bottom:10px;">ОТЫГРЫШ (ВЕЙДЖЕР)</h4>
            <div><b>Множитель отыгрыша (x):</b> <input type="number" id="wager-mult" value="${adData.wagerMultiplier || 2}" class="input-box" style="padding:5px; width:70px; display:inline-block;" step="0.5" min="1" max="20"> <button class="btn" style="padding:5px; width:auto; display:inline-block; background:#ffcc00; color:#000;" onclick="adminSetWager()">OK</button></div>
            <p style="font-size:10px; color:#666; margin-bottom:15px;">Каждый депозит нужно отыграть xN от суммы перед выводом</p>
            <hr>
            <h4 style="color:var(--neon); margin-bottom:10px;">ОТКЛЮЧЕНИЕ ИГР (ТЕХ. РАБОТЫ)</h4>
            <label><input type="checkbox" ${adData.maintenance.crash ? 'checked' : ''} onchange="adminMaint('crash', this.checked)"> Crash</label><br>
            <label><input type="checkbox" ${adData.maintenance.mines ? 'checked' : ''} onchange="adminMaint('mines', this.checked)"> Mines</label><br>
            <label><input type="checkbox" ${adData.maintenance.coinflip ? 'checked' : ''} onchange="adminMaint('coinflip', this.checked)"> Coinflip</label><br>
            <label><input type="checkbox" ${adData.maintenance.battle ? 'checked' : ''} onchange="adminMaint('battle', this.checked)"> Battle Roulette</label><br>
            <label><input type="checkbox" ${adData.maintenance.spin ? 'checked' : ''} onchange="adminMaint('spin', this.checked)"> 🎰 Spin</label><br>
            <label><input type="checkbox" ${adData.maintenance.mine ? 'checked' : ''} onchange="adminMaint('mine', this.checked)"> ⛏️ Mine</label><br>
            <hr>
            <h4 style="color:var(--neon); margin-bottom:10px;">ОТОБРАЖЕНИЕ В ИСТОРИИ</h4>
            <label><input type="checkbox" ${isShowDemo ? 'checked' : ''} onchange="adminDemoToggle(this.checked)"> Показывать Demo ставки</label><br>
        `;
    }
    if(tab === 'users') { 
        let usersHtml = (adData.users || []).map(u => `
            <div style="padding:10px; border-bottom:1px solid #222; position:relative; display:flex; flex-direction:column; gap:8px;">
                <div style="display:flex; align-items:center; gap:10px;" onclick="adminViewUser('${u.id}', 1)">
                    <img src="${u.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png'}" style="width:30px; border-radius:50%;"> 
                    <div>
                        <b style="color:var(--text); text-decoration:underline;">${u.username}</b> 
                        (${u.balance.toFixed(2)} TON)
                        ${u.isBlocked ? '<span style="background:red; padding:2px 5px; border-radius:4px; font-size:10px;">ЗАБАНЕН</span>' : ''}
                    </div>
                </div>
                <div style="display:flex; gap:5px;">
                    <button style="background:var(--neon-blue); color:#000; border:none; padding:5px; border-radius:4px; flex:1;" onclick="adminMsgUser('${u.id}')">В ЛС БОТА</button>
                    <button style="background:${u.isBlocked?'#555':'red'}; color:#fff; border:none; padding:5px; border-radius:4px; flex:1;" onclick="adminBan('${u.id}', ${!u.isBlocked})">${u.isBlocked?'РАЗБАНИТЬ':'БАН'}</button>
                </div>
            </div>
            `).join('');

        c.innerHTML = `
            <div style="text-align:center; color:var(--neon-blue); font-weight:bold; margin-bottom:10px;">Всего юзеров: ${adData.totalUsers}</div>
            
            <div style="display:flex; justify-content:space-around; background:#111; padding:10px; border-radius:8px; margin-bottom:10px; font-size:12px;">
                <label><input type="radio" name="u_filt" ${currentAdminFilter==='balance'?'checked':''} onchange="searchAdminUsers(adminSearchQuery, 'balance')"> Топ Баланс</label>
                <label><input type="radio" name="u_filt" ${currentAdminFilter==='new'?'checked':''} onchange="searchAdminUsers(adminSearchQuery, 'new')"> Новые</label>
                <label><input type="radio" name="u_filt" ${currentAdminFilter==='banned'?'checked':''} onchange="searchAdminUsers(adminSearchQuery, 'banned')"> Забаненые</label>
            </div>
            
            <input type="text" class="input-box" placeholder="Поиск (ID / Юзер)" value="${adminSearchQuery}" oninput="searchAdminUsers(this.value)">
            <p style="font-size:10px; color:var(--sub); margin-top:5px; text-align:center;">*Нажми на логин юзера для полной статистики</p>
            <div style="margin-top:10px;">${usersHtml}</div>
        `;
    }
}

// НОВЫЙ ФУНКЦИОНАЛ ЛОГОВ АДМИНА
let currentLogsPage = 1;
let currentLogsDate = '';

async function loadAdminLogs(page = 1, dateQuery = '') {
    currentLogsPage = page;
    currentLogsDate = dateQuery;
    const c = $('admin-content');
    
    try {
        const r = await fetch('/api/admin/logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pass: adminPass, page: page, date: dateQuery, limit: 30 })
        });
        
        if(r.ok) {
            const data = await r.json();
            renderLogsUI(data.logs, data.totalPages, page);
        } else {
            c.innerHTML = '<div style="color:red; text-align:center;">Ошибка загрузки логов</div>';
        }
    } catch(e) {
        c.innerHTML = '<div style="color:red; text-align:center;">Сбой сети</div>';
    }
}

function renderLogsUI(logs, totalPages, page) {
    const c = $('admin-content');
    
    let logsHtml = logs.length > 0 ? logs.map(l => `
        <tr style="border-bottom:1px solid #222;">
            <td style="padding:6px; color:#888; white-space:nowrap;">${l.date} ${l.time}</td>
            <td style="padding:6px; color:var(--neon-blue); font-weight:bold;">${l.adminUser || 'Система'}</td>
            <td style="padding:6px; color:#fff;">${l.action}</td>
        </tr>
    `).join('') : '<tr><td colspan="3" style="text-align:center; padding:15px; color:#555;">Логи не найдены</td></tr>';

    c.innerHTML = `
        <h4 style="color:var(--neon); margin-bottom:10px;">Журнал действий</h4>
        <div style="display:flex; gap:10px; margin-bottom:15px;">
            <input type="text" id="log-date-search" class="input-box" placeholder="Поиск по дате (напр. 06.08)" value="${currentLogsDate}" style="margin:0; flex:1;">
            <button class="btn" style="width:auto; padding:0 15px; background:var(--neon-blue);" onclick="loadAdminLogs(1, document.getElementById('log-date-search').value)">ПОИСК</button>
        </div>
        
        <div style="overflow-x:auto;">
            <table style="width:100%; font-size:11px; text-align:left; border-collapse: collapse; background:#111; border-radius:8px;">
                <tr style="background:#222;">
                    <th style="padding:8px;">Дата/Время</th>
                    <th style="padding:8px;">Инициатор</th>
                    <th style="padding:8px;">Действие</th>
                </tr>
                ${logsHtml}
            </table>
        </div>
        
        <div style="display:flex; justify-content:space-between; margin-top:15px; margin-bottom:20px;">
            <button class="btn" style="width:48%; background:#333;" onclick="loadAdminLogs(${page > 1 ? page - 1 : 1}, currentLogsDate)" ${page === 1 ? 'disabled' : ''}>← Назад</button>
            <div style="color:#555; font-size:12px; align-self:center;">Стр ${page} из ${totalPages || 1}</div>
            <button class="btn" style="width:48%; background:#333;" onclick="loadAdminLogs(${page + 1}, currentLogsDate)" ${page >= totalPages ? 'disabled' : ''}>Вперед →</button>
        </div>
    `;
}

async function adminW(wId, action) {
    let reason = ''; if(action === 'reject') reason = prompt('Причина отклонения (увидит юзер):') || 'Нарушение правил';
    await fetch('/api/admin/withdraw_action', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, wId, action, reason}) }); loadAdminData();
}

async function adminBan(userId, doBan) {
    await fetch('/api/admin/user_action', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, userId, action: doBan?'ban':'unban'}) }); searchAdminUsers(adminSearchQuery);
}
async function adminMsgUser(userId) {
    let msg = prompt('Сообщение в ЛС от бота:'); if(!msg)return;
    await fetch('/api/admin/user_action', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, userId, action: 'message', msg}) }); showToast('Отправлено');
}

async function adminBotBroadcast() {
    const text = $('ad-bot-msg').value; if(!text) return;
    await fetch('/api/admin/bot_broadcast', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, text}) });
    $('ad-bot-msg').value = ''; showToast('Разослано всем!');
}

async function adminReset() {
    if(!confirm('ТОЧНО ОБНУЛИТЬ ИСТОРИЮ?')) return;
    await fetch('/api/admin/reset_all_stats', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass}) }); showToast('История стерта');
}

async function adminPromo() {
    const code = $('ad-pr-code').value; const amount = $('ad-pr-sum').value; const limit = $('ad-pr-lim').value;
    await fetch('/api/admin/promo_create', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, code, amount, limit}) }); loadAdminData();
}
async function adminDelPromo(pId) {
    if(!confirm('Удалить этот промокод?')) return;
    await fetch('/api/admin/promo_delete', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, pId}) }); loadAdminData();
}
async function adminRTP(game) {
    const value = $(`rtp-${game}`).value;
    await fetch('/api/admin/set_rtp', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, game, value}) }); showToast('RTP сохранен!');
}
async function adminMaint(game, state) {
    await fetch('/api/admin/maintenance', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, game, state}) }); 
    adData.maintenance[game] = state; showToast(`Статус ${game} обновлен!`);
}
async function adminSetWager() {
    const value = $('wager-mult').value;
    await fetch('/api/admin/set_wager', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, value}) });
    showToast(`Множитель отыгрыша: x${value}`);
    adData.wagerMultiplier = Number(value);
}
async function adminDemoToggle(state) {
    await fetch('/api/admin/config', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, showDemo: state}) }); 
    showToast('Отображение демо обновлено!'); isShowDemo = state;
}

async function loadAdminGameStats() {
    const c = $('admin-content');
    c.innerHTML = '<div style="text-align:center; padding:20px; color:var(--neon);">Загрузка статистики...</div>';
    try {
        const r = await fetch('/api/admin/game_stats', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass}) });
        if (!r.ok) { c.innerHTML = '<div style="color:red;">Ошибка загрузки</div>'; return; }
        const data = await r.json();
        const stats = data.stats;
        const gameNames = { Crash:'🚀 Crash', Mines:'💣 Mines', Coinflip:'🪙 Coinflip', Battle:'⚔️ Battle', Spin:'🎰 Spin', Mine:'⛏️ Mine' };
        const colors = { Crash:'#ff0055', Mines:'#00ff88', Coinflip:'#ffcc00', Battle:'#8a2be2', Spin:'#ff6b00', Mine:'#c87020' };
        let totalBet = 0, totalPayout = 0, totalPlays = 0;
        Object.values(stats).forEach(s => { totalBet += s.totalBet; totalPayout += s.totalPayout; totalPlays += s.playCount; });
        const totalProfit = totalBet - totalPayout;
        let html = `
            <div style="background:#1a1a1a; padding:15px; border-radius:8px; margin-bottom:15px; text-align:center; border:1px solid ${totalProfit >= 0 ? 'var(--neon)' : 'var(--neon-red)'};">
                <div style="font-size:10px; color:#888; margin-bottom:5px;">ОБЩИЙ ИТОГ</div>
                <div style="font-size:22px; font-weight:900; color:${totalProfit >= 0 ? 'var(--neon)' : 'var(--neon-red)'};">${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} TON</div>
                <div style="font-size:11px; color:#666; margin-top:5px;">Ставок: ${totalPlays} | Ввод: ${totalBet.toFixed(2)} | Выплаты: ${totalPayout.toFixed(2)}</div>
            </div>`;
        for (const [game, s] of Object.entries(stats)) {
            const profit = s.totalBet - s.totalPayout;
            html += `
            <div style="background:#111; padding:12px; border-radius:8px; margin-bottom:8px; border-left:3px solid ${colors[game] || '#888'};">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div style="font-weight:900; color:${colors[game] || '#fff'}; font-size:14px;">${gameNames[game] || game}</div>
                        <div style="font-size:11px; color:#666; margin-top:3px;">Игр: ${s.playCount} | Ввод: ${s.totalBet.toFixed(2)} | Вывод: ${s.totalPayout.toFixed(2)}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:16px; font-weight:900; color:${profit >= 0 ? 'var(--neon)' : 'var(--neon-red)'};">${profit >= 0 ? '+' : ''}${profit.toFixed(2)}</div>
                        <button style="background:#333; color:#ff4444; border:none; padding:3px 8px; border-radius:4px; font-size:10px; margin-top:4px;" onclick="adminResetGameStats('${game}')">СБРОС</button>
                    </div>
                </div>
            </div>`;
        }
        html += `<button class="btn" style="background:red; margin-top:15px; padding:10px;" onclick="adminResetGameStats('')">СБРОСИТЬ ВСЮ СТАТИСТИКУ</button>`;
        c.innerHTML = html;
    } catch (e) {
        c.innerHTML = '<div style="color:red;">Сбой сети</div>';
    }
}

async function adminResetGameStats(game) {
    if (!confirm(game ? `Сбросить статистику ${game}?` : 'Сбросить ВСЮ статистику?')) return;
    await fetch('/api/admin/reset_game_stats', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, game}) });
    showToast('Статистика сброшена');
    loadAdminGameStats();
}

// ===================== SPIN GAME =====================
let spinBet = 0.5;
let spinFreeSpins = 0;
let spinFreeSpinsMult = 1;
let spinProgressValue = 0;
let spinIsSpinning = false;
let spinAnimInterval = null;

const SPIN_SYMS_ANIM = ['L','L','X','L','G','L','X','L','L'];

const SPIN_PAYLINES_FE = [
    [1,1,1,1,1],  // 0: средний ряд
    [0,0,0,0,0],  // 1: верхний ряд
    [2,2,2,2,2],  // 2: нижний ряд
    [0,1,2,1,0],  // 3: V-вниз
    [2,1,0,1,2],  // 4: V-вверх
    [0,0,1,2,2],  // 5: ступенька вниз
    [2,2,1,0,0],  // 6: ступенька вверх
    [1,0,1,0,1],  // 7: зигзаг верх
    [0,1,0,1,0],  // 8: зигзаг низ
    [1,2,1,2,1],  // 9: зигзаг низ2
    [2,1,2,1,2],  // 10: зигзаг верх2
    [0,1,1,1,2],  // 11: прогиб вниз
    [2,1,1,1,0],  // 12: прогиб вверх
    [1,1,0,1,1],  // 13: впадина вверх
    [1,1,2,1,1],  // 14: впадина вниз
];

function initSpinPage() {
    if (!$('spin-grid')) return;
    buildSpinGrid();
    updateSpinProgress(spinProgressValue);
    updateSpinUI();
    // Pre-fill idle grid with nice pattern
    const symbols = ['L','L','X','L','G','X','L','L','X','L','L','X','L','X','L'];
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 5; c++) {
            const cell = $(`sc-${r}-${c}`);
            if (cell) {
                const sym = symbols[r * 5 + c];
                cell.className = `spin-cell sym-${sym}`;
                cell.innerText = sym === 'G' ? '🎁' : sym;
            }
        }
    }
}

function buildSpinGrid() {
    const grid = $('spin-grid');
    if (!grid) return;
    grid.innerHTML = '';
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 5; c++) {
            const cell = document.createElement('div');
            cell.className = 'spin-cell sym-L';
            cell.id = `sc-${r}-${c}`;
            cell.innerText = 'L';
            grid.appendChild(cell);
        }
    }
}

function updateSpinProgress(val) {
    spinProgressValue = Math.max(0, Math.min(100, val));
    const fill = $('spin-progress-fill');
    if (fill) fill.style.width = spinProgressValue + '%';
    const label = $('spin-progress-label');
    if (label) label.innerText = `БОНУС ПРОГРЕСС: ${Math.round(spinProgressValue)}%`;
}

function updateSpinUI() {
    const btn = $('sp-btn');
    const badge = $('spin-free-badge');
    const betInput = $('sp-bet');
    const betLock = $('sp-bet-lock');
    if (!btn) return;
    if (spinFreeSpins > 0) {
        btn.innerText = `🎰 ФРИСПИН ×${spinFreeSpinsMult} (${spinFreeSpins} ост.)`;
        btn.style.background = 'linear-gradient(90deg,#ff0055,#ff6b00)';
        btn.style.boxShadow = '0 0 20px rgba(255,0,85,0.4)';
        if (badge) { badge.style.display = 'block'; badge.innerText = `🎰 ${spinFreeSpins} ост. | Множитель: ×${spinFreeSpinsMult}`; }
        if (betInput) { betInput.disabled = true; betInput.style.opacity = '0.4'; }
        if (betLock) betLock.style.display = 'block';
    } else {
        btn.innerText = 'КРУТИТЬ 🎰';
        btn.style.background = '';
        btn.style.boxShadow = '';
        if (badge) badge.style.display = 'none';
        if (betInput) { betInput.disabled = false; betInput.style.opacity = '1'; }
        if (betLock) betLock.style.display = 'none';
        spinFreeSpinsMult = 1;
    }
}

// ========= MINE GAME =========
const MINE_BLOCK_CLASS = {
    grass:'grass-blk', dirt:'dirt-blk',
    stone:'stone-blk', redstone:'redstone-blk', gold:'gold-blk',
    diamond:'diamond-blk', obsidian:'obsidian-blk',
    tnt:'tnt-blk', book:'book-blk', unknown:'unknown-blk'
};
const MC_ROWS = 6;
const MC_COLS = 5;
const INV_ROWS = 3;
const INV_COLS = 5;
let mineIsSpinning    = false;
let mineBookCount     = 0;
let mineAutoRemaining = 0;
let minePersistGrid   = null;
let mineLastBet       = 1;
let mineRunningTotal  = 0;

// ── Инвентарь: 5×3 пустых ячеек (заполняются во время раскрытия) ──
function getPickaxeImg(type) {
    return `/sprites/pick_${type || 'wooden'}.png`;
}

const PICKAXE_DURABILITY = { wooden:1, stone:2, iron:3, golden:4, diamond:5 };

// ── Инициализация и обновление полосы прочности ──
let _durMax = 0;
let _durLeft = 0;
function initDurabilityBar(pickaxeType, pickaxeCount, overrideDur) {
    const dur = overrideDur || (PICKAXE_DURABILITY[pickaxeType] || 10) * (pickaxeCount || 1);
    _durMax  = dur;
    _durLeft = dur;
    const wrap  = $('mine-dur-wrap');
    const bar   = $('mine-dur-bar');
    const count = $('mine-dur-count');
    if (wrap)  wrap.style.display  = 'flex';
    if (bar)   { bar.style.width   = '100%'; bar.className = 'mine-dur-bar-inner'; }
    if (count) count.textContent   = `${dur} / ${dur}`;
}
function consumeDurability(hits) {
    if (_durMax <= 0) return;
    _durLeft = Math.max(0, _durLeft - hits);
    const pct    = _durLeft / _durMax;
    const bar    = $('mine-dur-bar');
    const count  = $('mine-dur-count');
    if (bar) {
        bar.style.width = (pct * 100).toFixed(1) + '%';
        bar.className = 'mine-dur-bar-inner' + (pct < 0.25 ? ' dur-crit' : pct < 0.55 ? ' dur-low' : '');
    }
    if (count) count.textContent = `${_durLeft} / ${_durMax}`;
}
function hideDurabilityBar() {
    const wrap = $('mine-dur-wrap');
    if (wrap) wrap.style.display = 'none';
}

let currentHotbar = null;

function renderMineHotbar(hotbar) {
    const defaultSlots = Array(INV_ROWS * INV_COLS).fill(null).map(() => ({type:'empty'}));
    currentHotbar = hotbar || defaultSlots;
    const inv = $('mc-inventory');
    if (!inv) return;
    inv.innerHTML = '';
    for (let r = 0; r < INV_ROWS; r++) {
        for (let c = 0; c < INV_COLS; c++) {
            const idx = r * INV_COLS + c;
            const cell = document.createElement('div');
            cell.className = 'inv-cell';
            cell.id = `inv-${r}-${c}`;
            const slot = currentHotbar[idx];
            if (slot && slot.type === 'pickaxe') {
                const img = document.createElement('img');
                img.src = getPickaxeImg(slot.pickaxeType || 'wooden');
                img.style.cssText = 'width:70%;height:70%;object-fit:contain;image-rendering:pixelated;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));';
                cell.appendChild(img);
                cell.dataset.slotType = 'pickaxe';
                cell.dataset.pickType = slot.pickaxeType;
            } else if (slot && slot.type === 'book') {
                const img = document.createElement('img');
                img.src = '/sprites/block_book.png';
                img.style.cssText = 'width:80%;height:80%;object-fit:contain;image-rendering:pixelated;';
                cell.appendChild(img);
                cell.dataset.slotType = 'book';
                cell.className += ' inv-book';
            } else if (slot && slot.type === 'tnt') {
                const img = document.createElement('img');
                img.src = '/sprites/block_tnt.png';
                img.style.cssText = 'width:80%;height:80%;object-fit:contain;image-rendering:pixelated;';
                cell.appendChild(img);
                cell.dataset.slotType = 'tnt';
                cell.className += ' inv-tnt';
            }
            inv.appendChild(cell);
        }
    }
}

// ── Шахта: 6×5 блоков (верхний ряд — трава) ──
function initMineShaft(keepPersist, idlePreview) {
    const shaft = $('mc-shaft');
    if (!shaft) return;
    shaft.innerHTML = '';
    const IDLE_BY_ROW = [
        ['grass','grass','grass','grass','grass'],
        ['dirt','stone','stone','stone','stone','redstone'],
        ['stone','stone','stone','redstone','redstone','redstone'],
        ['stone','redstone','redstone','gold','gold','gold'],
        ['redstone','gold','gold','gold','diamond','diamond'],
        ['gold','diamond','diamond','diamond','obsidian','obsidian'],
    ];
    for (let r = 0; r < MC_ROWS; r++) {
        for (let c = 0; c < MC_COLS; c++) {
            const blk = document.createElement('div');
            blk.id = `mc-blk-${r}-${c}`;
            const persistType = keepPersist && minePersistGrid ? minePersistGrid[r][c] : null;
            if (persistType) {
                blk.className = `mc-blk ${MINE_BLOCK_CLASS[persistType] || 'stone-blk'}`;
                blk.dataset.revealed = '1';
            } else if (idlePreview) {
                const pool = IDLE_BY_ROW[r];
                const t = pool[Math.floor(Math.random() * pool.length)];
                blk.className = `mc-blk ${MINE_BLOCK_CLASS[t] || 'stone-blk'}`;
            } else {
                const pool = IDLE_BY_ROW[r];
                const t = pool[Math.floor(Math.random() * pool.length)];
                blk.className = `mc-blk ${MINE_BLOCK_CLASS[t] || 'stone-blk'}`;
            }
            shaft.appendChild(blk);
        }
    }
    // Сбросить сундуки и счётчик
    for (let i = 0; i < MC_COLS; i++) {
        const ch = $(`mc-chest-${i}`);
        if (ch) ch.classList.remove('open', 'open-anim');
    }
    const rt = $('mine-running-total');
    if (rt) { rt.textContent = '0.00 TON'; rt.classList.remove('has-win'); }
    const wd = $('mine-win-display');
    if (wd) { wd.innerText = ''; wd.style.color = ''; wd.classList.remove('show'); }
    mineRunningTotal = 0;
}

// Плавная анимация числа (считает от start до end)
function animateCounter(el, start, end, durationMs, prefix, suffix) {
    if (!el) return;
    const startTime = performance.now();
    const diff = end - start;
    function step(now) {
        const p = Math.min((now - startTime) / durationMs, 1);
        const eased = 1 - Math.pow(1 - p, 3);  // ease-out cubic
        el.innerText = prefix + (start + diff * eased).toFixed(2) + suffix;
        if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

// ── Анимация одного свойства через RAF ──
function _animProp(el, prop, from, to, dur, easeFn, cb) {
    let t0 = null;
    function frame(ts) {
        if (!t0) t0 = ts;
        const t = Math.min((ts - t0) / dur, 1);
        el.style[prop] = (from + (to - from) * easeFn(t)) + 'px';
        if (t < 1) requestAnimationFrame(frame);
        else if (cb) cb();
    }
    requestAnimationFrame(frame);
}
// Анимация X+Y одновременно (ease-in-out)
function _animXY(el, x0, y0, x1, y1, dur, cb) {
    let t0 = null;
    function frame(ts) {
        if (!t0) t0 = ts;
        const t = Math.min((ts - t0) / dur, 1);
        const e = t < 0.5 ? 2*t*t : 1 - 2*(1-t)*(1-t);
        el.style.left = (x0 + (x1 - x0) * e) + 'px';
        el.style.top  = (y0 + (y1 - y0) * e) + 'px';
        if (t < 1) requestAnimationFrame(frame);
        else if (cb) cb();
    }
    requestAnimationFrame(frame);
}

// ── Флаг активности Mine-игры (для чистки анимаций при выходе) ──
let mineIsActive = false;
const _pickaxeEls = new Set();

function killAllPickaxes() {
    _pickaxeEls.forEach(el => { try { if (el.parentNode) el.parentNode.removeChild(el); } catch(e){} });
    _pickaxeEls.clear();
    mineIsActive = false;
}

function tntExplode(r, c) {
    playSound('explode');
    const shaft = $('mc-shaft');
    if (shaft) {
        const flash = document.createElement('div');
        flash.style.cssText = 'position:absolute;inset:0;background:rgba(255,100,0,0.5);z-index:9998;pointer-events:none;border-radius:4px;';
        shaft.appendChild(flash);
        setTimeout(() => { flash.style.background = 'rgba(255,255,200,0.6)'; }, 80);
        setTimeout(() => { flash.style.background = 'rgba(255,60,0,0.3)'; }, 160);
        setTimeout(() => flash.remove(), 300);
    }
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr >= MC_ROWS || nc < 0 || nc >= MC_COLS) continue;
            const adjEl = $(`mc-blk-${nr}-${nc}`);
            if (!adjEl || adjEl.dataset.revealed === '1') continue;
            adjEl.dataset.tntDmg = (parseInt(adjEl.dataset.tntDmg||'0') + 3).toString();
            adjEl.classList.add('crack-hit');
            spawnBreakParticles(adjEl, adjEl.dataset.blockType || 'stone');
            setTimeout(() => adjEl.classList.remove('crack-hit'), 150);
        }
    }
}

function doBreakBlock(blkEl, blk, onDone, onBlockFullyGone) {
    blkEl.classList.remove('cracking-1','cracking-2','cracking-3','crack-hit');
    const oreClass = MINE_BLOCK_CLASS[blk.type] || 'stone-blk';
    blkEl.className = `mc-blk ${oreClass}`;

    // Показать выигрыш блока
    if (blk.win > 0) {
        spawnBlockWinPopup(blkEl, blk.win);
        mineRunningTotal += blk.win;
        const rt = $('mine-running-total');
        if (rt) { rt.classList.add('has-win'); animateCounter(rt, mineRunningTotal - blk.win, mineRunningTotal, 350, '', ' TON'); }
    }
    spawnBreakParticles(blkEl, blk.type);


    // Флэш 160мс → блок исчезает НА МЕСТЕ (но НЕ удаляется из DOM — сохраняет сетку)
    setTimeout(() => {
        blkEl.style.transition = 'transform 0.18s cubic-bezier(0.5,0,1,1), opacity 0.14s';
        blkEl.style.transform = 'scale(0.04)';
        blkEl.style.opacity = '0';
        blkEl.dataset.revealed = '1';
        setTimeout(() => {
            blkEl.style.visibility = 'hidden';
            blkEl.style.transform = '';
            blkEl.style.opacity = '';
            if (onBlockFullyGone) onBlockFullyGone();
        }, 200);
    }, 160);

    if (onDone) setTimeout(onDone, 110);
}

// ── ВОРКЕР-КИРКА: обрабатывает очередь до конца прочности ──
// maxDur   — хит-пойнты этой кирки; когда заканчиваются — кирка ломается
// onBlockBroken(r,c) — вызывается после того как конкретный блок полностью исчез
function spawnPickaxeWorker(blockQueue, pickaxeType, workerIdx, onWorkerDone, onBlockBroken, maxDur) {
    if (!blockQueue.length) { if (onWorkerDone) onWorkerDone(); return; }

    let qi = 0;
    let remainDur = (maxDur && maxDur > 0) ? maxDur : 999;

    function processNext() {
        if (!mineIsActive) return;
        if (qi >= blockQueue.length) { if (onWorkerDone) onWorkerDone(); return; }

        const blk = blockQueue[qi];
        const blkEl = $(`mc-blk-${blk.r}-${blk.c}`);
        if (!blkEl || blkEl.dataset.revealed === '1') { qi++; processNext(); return; }

        const tntDmg = parseInt(blkEl.dataset.tntDmg || '0');
        blk.hits = Math.max(1, blk.hits - tntDmg);
        const hitsCanDo = Math.min(blk.hits, remainDur);
        const willBreak = hitsCanDo < blk.hits;
        const blockWillBreak = hitsCanDo >= blk.hits;

        if (hitsCanDo <= 0) {
            // Прочность ноль — кирка ломается не начиная
            doPickaxeBreak(blkEl, () => { if (onWorkerDone) onWorkerDone(); }, false);
            return;
        }

        qi++;
        remainDur -= hitsCanDo;

        const shaft = $('mc-shaft');
        const bx = blkEl.offsetLeft + blkEl.offsetWidth / 2;
        const blockTop = blkEl.offsetTop;
        const startY = blockTop - 26;
        const hoverY = blockTop - 12;
        const hitY   = blockTop + 2;

        const pUrl = getPickaxeImg(pickaxeType);
        const el = document.createElement('img');
        el.src = pUrl;
        el.style.cssText = `position:absolute;width:20px;height:20px;z-index:9999;pointer-events:none;image-rendering:pixelated;left:${bx}px;top:${startY}px;transform:translate(-50%,-100%);`;
        shaft.appendChild(el);
        _pickaxeEls.add(el);

        function removeEl() {
            _pickaxeEls.delete(el);
            if (el.parentNode) el.parentNode.removeChild(el);
        }

        _animProp(el, 'top', startY, hoverY, 180, t => t*t, () => {
            if (!mineIsActive) { removeEl(); return; }
            blkEl.classList.add('cracking-1');
            doHits(hitsCanDo, 0);
        });

        function doHits(hitsLeft, hitNum) {
            if (!mineIsActive) { removeEl(); return; }
            const swingAngle = hitNum % 2 === 0 ? -25 : 25;
            el.style.transform = `translate(-50%,-100%) rotate(${swingAngle}deg)`;

            _animProp(el, 'top', hoverY, hitY, 120, t => t*t, () => {
                if (!mineIsActive) { removeEl(); return; }
                el.style.transform = `translate(-50%,-100%) rotate(0deg)`;
                playSound('hit');
                blkEl.classList.add('crack-hit');
                setTimeout(() => blkEl.classList.remove('crack-hit'), 80);

                blkEl.classList.remove('cracking-1','cracking-2','cracking-3');
                const progress = (hitNum + 1) / blk.hits;
                if (progress >= 0.9 && blockWillBreak) blkEl.classList.add('cracking-3');
                else if (progress >= 0.5)              blkEl.classList.add('cracking-2');
                else                                    blkEl.classList.add('cracking-1');

                if (hitsLeft <= 1) {
                    if (blockWillBreak) {
                        playSound('break');
                        doBreakBlock(blkEl, blk, null, () => {
                            if (onBlockBroken) onBlockBroken(blk.r, blk.c);
                        });
                        _animProp(el, 'top', hitY, startY, 200, t => 1-(1-t)*(1-t), () => {
                            removeEl();
                            setTimeout(processNext, 100);
                        });
                    } else {
                        blkEl.classList.add('cracking-2');
                        _animProp(el, 'top', hitY, hoverY, 100, t => 1-(1-t)*(1-t), () => {
                            if (!mineIsActive) { removeEl(); return; }
                            doPickaxeBreak(null, () => { removeEl(); if (onWorkerDone) onWorkerDone(); }, true, el, bx, hoverY);
                        });
                    }
                } else {
                    _animProp(el, 'top', hitY, hoverY, 140, t => {
                        const bounce = 1 - Math.pow(1-t, 2);
                        return bounce;
                    }, () => {
                        if (!mineIsActive) { removeEl(); return; }
                        setTimeout(() => doHits(hitsLeft - 1, hitNum + 1), 50);
                    });
                }
            });
        }
    }

    // Анимация излома кирки: вибрация → покраснение → исчезновение
    // useExisting=true → анимируем уже существующий элемент `existingEl`
    function doPickaxeBreak(blkEl, cb, useExisting, existingEl, bx, hoverY) {
        let el = existingEl;

        function removeEl() {
            if (!el) return;
            _pickaxeEls.delete(el);
            if (el.parentNode) el.parentNode.removeChild(el);
        }

        function shakeAndBreak(el) {
            el.style.filter = 'hue-rotate(100deg) saturate(2) brightness(1.6)';
            let shakeN = 0;
            const baseL = parseFloat(el.style.left);
            const shakeId = setInterval(() => {
                shakeN++;
                el.style.left = (baseL + (shakeN % 2 === 0 ? 5 : -5)) + 'px';
                if (shakeN >= 6) {
                    clearInterval(shakeId);
                    el.style.transition = 'opacity 0.2s, transform 0.2s';
                    el.style.opacity = '0';
                    el.style.transform = 'translate(-50%,-50%) rotate(200deg) scale(0.15)';
                    setTimeout(() => { removeEl(); if (cb) cb(); }, 220);
                }
            }, 35);
        }

        if (useExisting && el) {
            shakeAndBreak(el);
            return;
        }

        if (!blkEl) { if (cb) cb(); return; }
        const shaft = $('mc-shaft');
        const bxx   = blkEl.offsetLeft + blkEl.offsetWidth / 2;
        const byy   = blkEl.offsetTop;
        const sY    = byy - 30;
        const hov   = byy - 12;

        const pUrl = getPickaxeImg(pickaxeType);
        el = document.createElement('img');
        el.src = pUrl;
        el.style.cssText = `position:absolute;width:20px;height:20px;z-index:9999;pointer-events:none;image-rendering:pixelated;transform:translate(-50%,-100%);left:${bxx}px;top:${sY}px;`;
        shaft.appendChild(el);
        _pickaxeEls.add(el);

        _animProp(el, 'top', sY, hov, 140, t => t*t, () => {
            if (!mineIsActive) { removeEl(); if(cb)cb(); return; }
            shakeAndBreak(el);
        });
    }

    setTimeout(processNext, workerIdx * 90);
}


// ──── Сбор книжки ────
function collectBook(blockEl) {
    mineBookCount++;
    if (blockEl) {
        blockEl.classList.add('book-collect');
        setTimeout(() => blockEl.classList.remove('book-collect'), 600);
    }
    const statusEl = $('mine-book-status');
    if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.innerHTML = `📚 Книжки: ${mineBookCount}/3${mineBookCount >= 3 ? ' — <b>АВТО-СПИНЫ!</b>' : ''}`;
    }
    if (mineBookCount >= 3) {
        mineBookCount = 0;
        showToast('📚 3 КНИЖКИ! 3 АВТО-СПИНА!', 3000);
    }
}

// ──── Снимок текущей сетки ────
function buildCurrentGrid() {
    const g = [];
    for (let r = 0; r < MC_ROWS; r++) {
        const row = [];
        for (let c = 0; c < MC_COLS; c++) {
            const el = $(`mc-blk-${r}-${c}`);
            row.push(el && el.dataset.revealed === '1' ? (el.dataset.blockType || null) : null);
        }
        g.push(row);
    }
    return g;
}

// ─── Всплывающий попап с выигрышем у блока ───
function spawnBlockWinPopup(blockEl, amount) {
    if (!blockEl || amount <= 0) return;
    const rect = blockEl.getBoundingClientRect();
    const pop = document.createElement('div');
    pop.className = 'block-win-popup';
    pop.textContent = `+${amount.toFixed(2)}`;
    pop.style.left = (rect.left + rect.width / 2) + 'px';
    pop.style.top  = (rect.top) + 'px';
    document.body.appendChild(pop);
    pop.addEventListener('animationend', () => pop.remove());
}

// ─── Анимация полёта предмета из сетки в хотбар ───
function flyItemToHotbar(blkEl, blockType, gridRow, gridCol) {
    const inv = $('mc-inventory');
    if (!blkEl || !inv) { fillInvCell(gridRow, gridCol, blockType, null); return; }

    let targetCell = null;
    for (let r = 0; r < INV_ROWS; r++) {
        for (let c = 0; c < MC_COLS; c++) {
            const candidate = $(`inv-${r}-${c}`);
            if (candidate && !candidate.dataset.hasPick && !candidate.dataset.slotType && !candidate.classList.contains('filled')) {
                targetCell = candidate;
                break;
            }
        }
        if (targetCell) break;
    }
    if (!targetCell) { fillInvCell(gridRow, gridCol, blockType, null); return; }

    const srcRect = blkEl.getBoundingClientRect();
    const dstRect = targetCell.getBoundingClientRect();

    const flyer = document.createElement('div');
    flyer.style.cssText = `
        position:fixed; z-index:99999; pointer-events:none;
        width:${blkEl.offsetWidth}px; height:${blkEl.offsetHeight}px;
        left:${srcRect.left}px; top:${srcRect.top}px;
        transition: all 0.45s cubic-bezier(0.25,0.1,0.25,1);
        image-rendering:pixelated; border-radius:3px;
    `;

    const spriteMap = { book: '/sprites/block_book.png', tnt: '/sprites/block_tnt.png' };
    const img = document.createElement('img');
    img.src = spriteMap[blockType] || '/sprites/block_stone.png';
    img.style.cssText = 'width:100%;height:100%;image-rendering:pixelated;';
    flyer.appendChild(img);
    document.body.appendChild(flyer);

    requestAnimationFrame(() => {
        flyer.style.left = (dstRect.left + dstRect.width/2 - blkEl.offsetWidth/2) + 'px';
        flyer.style.top = (dstRect.top + dstRect.height/2 - blkEl.offsetHeight/2) + 'px';
        flyer.style.transform = 'scale(0.5)';
        flyer.style.opacity = '0.7';
    });

    setTimeout(() => {
        flyer.remove();
        fillInvCell(1, targetCell.id.split('-')[2], blockType, null);
    }, 480);
}

// ─── Заполнить ячейку инвентаря найденным блоком ───
function fillInvCell(row, col, blockType, pickaxeType) {
    let targetRow = row, targetCol = col;

    // Книга и ТНТ — специальные предметы, идут в свободную ячейку
    if (blockType === 'book' || blockType === 'tnt') {
        const inv = $('mc-inventory');
        if (inv) {
            let found = false;
            for (let r = 0; r < INV_ROWS && !found; r++) {
                for (let c = 0; c < MC_COLS; c++) {
                    const candidate = $(`inv-${r}-${c}`);
                    if (candidate && !candidate.dataset.hasPick && !candidate.dataset.slotType && !candidate.classList.contains('filled')) {
                        targetRow = r; targetCol = c;
                        found = true;
                        break;
                    }
                }
            }
        }
    }

    const cell = $(`inv-${targetRow}-${targetCol}`);
    if (!cell) return;
    cell.innerHTML = '';
    delete cell.dataset.hasPick;

    const spriteUrls = {
        book: '/sprites/block_book.png', tnt: '/sprites/block_tnt.png',
        grass: '/sprites/block_grass.png', dirt: '/sprites/block_dirt.png',
        stone: '/sprites/block_stone.png', redstone: '/sprites/block_redstone.png',
        gold: '/sprites/block_gold.png', diamond: '/sprites/block_diamond.png',
        obsidian: '/sprites/block_obsidian.png'
    };
    if (blockType === 'book') {
        cell.className = 'inv-cell filled inv-book';
    } else if (blockType === 'tnt') {
        cell.className = 'inv-cell filled inv-tnt';
    } else {
        cell.className = 'inv-cell filled inv-block';
    }
    const img = document.createElement('img');
    img.src = spriteUrls[blockType] || '/sprites/block_stone.png';
    img.style.cssText = 'width:78%;height:78%;image-rendering:pixelated;object-fit:contain;';
    cell.appendChild(img);
}

// ─── Частицы разбивки блока ───
function spawnBreakParticles(blockEl, blockType) {
    if (!blockEl) return;
    const rect = blockEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const clrs = {
        grass:    ['#4a8c2a','#6cb040','#3a7020'],
        dirt:     ['#8b6040','#a07050','#6b4a30'],
        stone:    ['#888','#aaa','#777'],
        redstone: ['#880000','#cc2020','#ff4444'],
        gold:     ['#c8a000','#ffe060','#deb800'],
        diamond:  ['#006b9a','#00e4ff','#4acce0'],
        obsidian: ['#0e0420','#6030a0','#3010a0'],
        tnt:      ['#cc1010','#ff4040','#ff8888'],
        book:     ['#4c1090','#ffd700','#c080ff'],
    };
    const c = clrs[blockType] || clrs.stone;
    for (let i = 0; i < 12; i++) {
        const p = document.createElement('div');
        const angle = Math.random() * Math.PI * 2;
        const speed = 30 + Math.random() * 55;
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed - 20;
        const size = 2 + Math.random() * 4;
        p.style.cssText = `position:fixed;width:${size}px;height:${size}px;background:${c[i % c.length]};left:${cx}px;top:${cy}px;border-radius:1px;z-index:9800;pointer-events:none;image-rendering:pixelated;`;
        document.body.appendChild(p);
        let elapsed = 0;
        const id = setInterval(() => {
            elapsed += 16;
            const t = elapsed / 1000;
            p.style.transform = `translate(${vx*t}px,${vy*t + 300*t*t}px) rotate(${elapsed*0.25}deg)`;
            p.style.opacity = String(Math.max(0, 1 - elapsed / 480));
            if (elapsed >= 480) { clearInterval(id); p.remove(); }
        }, 16);
    }
}

// ─── Основное раскрытие: grid[r][c] из сервера, blockWins[r][c] ───
function revealMineShaft(grid, blockWins, win, balanceBefore, chestMults, isAutoSpin) {
    const BLOCK_HITS_MAP = { grass:1, dirt:1, stone:1, redstone:2, gold:2, diamond:3, obsidian:4 };
    const PICKAXE_MOD_MAP = { wooden:0, stone:0, iron:0, golden:0, diamond:0 };
    const hotbar = currentHotbar || [];

    for (let r = 0; r < MC_ROWS; r++) {
        for (let c = 0; c < MC_COLS; c++) {
            const blkEl = $(`mc-blk-${r}-${c}`);
            if (!blkEl) continue;
            const type = grid[r][c];
            // Skip null blocks (already broken in auto-spin)
            if (!type) {
                blkEl.dataset.revealed = '1';
                blkEl.style.visibility = 'hidden';
                continue;
            }
            if (isAutoSpin && blkEl.dataset.revealed === '1') continue;
            blkEl.className = `mc-blk ${MINE_BLOCK_CLASS[type] || 'stone-blk'}`;
            blkEl.dataset.revealed = '0';
            blkEl.dataset.blockType = type;
            blkEl.dataset.tntDmg = '0';
            blkEl.style.cssText = '';
            blkEl.style.visibility = 'visible';
        }
    }

    const pickSlots = [];
    const tntCols = [];
    let bookCount = 0;
    hotbar.forEach((slot, idx) => {
        const col = idx % MC_COLS; // map flat index to column
        if (slot.type === 'pickaxe') pickSlots.push({ col, idx, pType: slot.pickaxeType || 'wooden' });
        else if (slot.type === 'tnt') tntCols.push(col);
        else if (slot.type === 'book') bookCount++;
    });

    // Deduplicate: if two pickaxes target same column, keep stronger one
    const colPickMap = {};
    const PICK_RANK = { wooden:0, stone:1, iron:2, golden:3, diamond:4 };
    pickSlots.forEach(ps => {
        if (!colPickMap[ps.col] || PICK_RANK[ps.pType] > PICK_RANK[colPickMap[ps.col].pType]) {
            colPickMap[ps.col] = ps;
        }
    });
    const uniquePickSlots = Object.values(colPickMap);

    uniquePickSlots.forEach(ps => {
        let mult = 1;
        const leftIdx = ps.idx - 1;
        const rightIdx = ps.idx + 1;
        if (leftIdx >= 0 && hotbar[leftIdx] && hotbar[leftIdx].type === 'book') mult *= 1.5;
        if (rightIdx < hotbar.length && hotbar[rightIdx] && hotbar[rightIdx].type === 'book') mult *= 1.5;
        ps.durMult = mult;
    });

    if (bookCount > 0) {
        mineBookCount += bookCount;
        const statusEl = $('mine-book-status');
        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.innerHTML = `📚 Книги: ${mineBookCount}/3${mineBookCount >= 3 ? ' — АВТО-СПИН!' : ''}`;
        }
    }

    const allBlocks = [];
    for (let r = 0; r < MC_ROWS; r++) {
        for (let c = 0; c < MC_COLS; c++) {
            const blkEl = $(`mc-blk-${r}-${c}`);
            if (!blkEl || blkEl.dataset.revealed === '1') continue;
            const type = grid[r][c];
            const bwin = (blockWins && blockWins[r]) ? (blockWins[r][c] || 0) : 0;
            allBlocks.push({ r, c, type, win: bwin, hits: Math.max(1, BLOCK_HITS_MAP[type] || 2) });
        }
    }

    const colBlocks = Array.from({ length: MC_COLS }, (_, c) =>
        allBlocks.filter(b => b.c === c).sort((a, b) => a.r - b.r)
    );

    uniquePickSlots.forEach(ps => {
        const pMod = PICKAXE_MOD_MAP[ps.pType] || 0;
        (colBlocks[ps.col] || []).forEach(b => { b.hits = Math.max(1, b.hits + pMod); });
    });

    const brokenSet = new Set();
    tntCols.forEach(col => {
        const q = colBlocks[col] || [];
        if (q.length > 0) brokenSet.add(`${q[0].r},${q[0].c}`);
    });
    uniquePickSlots.forEach(ps => {
        const dur = Math.floor((PICKAXE_DURABILITY[ps.pType] || 2) * (ps.durMult || 1));
        let rem = dur;
        for (const blk of (colBlocks[ps.col] || [])) {
            if (brokenSet.has(`${blk.r},${blk.c}`)) continue;
            if (rem >= blk.hits) { rem -= blk.hits; brokenSet.add(`${blk.r},${blk.c}`); }
            else break;
        }
    });

    const brokenWinSum = allBlocks.filter(b => brokenSet.has(`${b.r},${b.c}`)).reduce((s,b) => s + b.win, 0);
    const scaleFactor = (brokenWinSum > 0 && win > 0) ? win / brokenWinSum : 0;
    allBlocks.forEach(b => {
        b.win = brokenSet.has(`${b.r},${b.c}`) ? parseFloat((b.win * scaleFactor).toFixed(4)) : 0;
    });

    const liveColBroken = Array(MC_COLS).fill(0);
    const openedChests = new Set();
    const colChestMults = chestMults || [2, 2, 2, 2, 2];

    for (let c = 0; c < MC_COLS; c++) {
        for (let r = 0; r < MC_ROWS; r++) {
            const blkEl = $(`mc-blk-${r}-${c}`);
            if (blkEl && blkEl.dataset.revealed === '1') liveColBroken[c]++;
        }
    }

    function onBlockBroken(r, c) {
        liveColBroken[c]++;
        if (liveColBroken[c] >= MC_ROWS && !openedChests.has(c)) {
            openedChests.add(c);
            const thisChestMult = colChestMults[c] || 2;
            setTimeout(() => {
                playSound('chest');
                const ch = $(`mc-chest-${c}`);
                if (!ch) return;
                ch.classList.add('open', 'open-anim');
                setTimeout(() => ch.classList.remove('open-anim'), 600);
                const pop = document.createElement('div');
                pop.className = 'chest-mult-tag';
                pop.textContent = `×${thisChestMult}`;
                ch.appendChild(pop);
                setTimeout(() => { if (pop.parentNode) pop.parentNode.removeChild(pop); }, 3000);
            }, 250);
        }
    }

    const tntPhaseTime = tntCols.length > 0 ? tntCols.length * 500 + 400 : 0;

    tntCols.forEach((col, idx) => {
        setTimeout(() => {
            const colQ = colBlocks[col] || [];
            if (colQ.length === 0) return;
            const target = colQ[0];
            const blkEl = $(`mc-blk-${target.r}-${target.c}`);
            if (!blkEl || blkEl.dataset.revealed === '1') return;
            // Find the TNT cell in any row of the inventory
            let hotbarCell = null;
            for (let ir = 0; ir < INV_ROWS; ir++) {
                for (let ic = 0; ic < INV_COLS; ic++) {
                    const c = $(`inv-${ir}-${ic}`);
                    if (c && c.dataset.slotType === 'tnt') { hotbarCell = c; break; }
                }
                if (hotbarCell) break;
            }
            const shaft = $('mc-shaft');
            if (!shaft) return;

            const tntEl = document.createElement('img');
            tntEl.src = '/sprites/block_tnt.png';
            const bw = blkEl.offsetWidth || 36;
            const bh = blkEl.offsetHeight || 36;
            tntEl.style.cssText = `position:absolute;width:${bw}px;height:${bh}px;z-index:9999;pointer-events:none;image-rendering:pixelated;left:${blkEl.offsetLeft}px;top:-${bh}px;transition:top 0.35s cubic-bezier(0.55,0,1,0.45);`;
            shaft.style.position = 'relative';
            shaft.appendChild(tntEl);

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    tntEl.style.top = blkEl.offsetTop + 'px';
                });
            });

            setTimeout(() => {
                tntEl.remove();
                playSound('explode');
                tntExplode(target.r, target.c);
                doBreakBlock(blkEl, target, null, () => onBlockBroken(target.r, target.c));
                if (hotbarCell) { hotbarCell.innerHTML = ''; hotbarCell.className = 'inv-cell'; }
            }, 400);
        }, idx * 500);
    });

    const N = uniquePickSlots.length;
    let longestQ = 0;
    uniquePickSlots.forEach((ps, wi) => {
        const dur = Math.floor((PICKAXE_DURABILITY[ps.pType] || 1) * (ps.durMult || 1));
        let d = dur, t = 0;
        for (const b of (colBlocks[ps.col] || [])) {
            if (brokenSet.has(`${b.r},${b.c}`) && tntCols.includes(ps.col)) continue;
            const hc = Math.min(b.hits, d);
            if (hc <= 0) { t += 500; break; }
            t += hc * 300 + 350;
            d -= hc;
            if (d <= 0) { t += 400; break; }
        }
        longestQ = Math.max(longestQ, t + wi * 150);
    });

    const estimatedReveal = tntPhaseTime + longestQ + N * 120 + 400;

    mineIsActive = true;
    setTimeout(() => {
        uniquePickSlots.forEach((ps, wi) => {
            const dur = Math.floor((PICKAXE_DURABILITY[ps.pType] || 1) * (ps.durMult || 1));
            setTimeout(() => {
                // Remove pickaxe from hotbar cell when it starts working
                const invIdx = ps.idx;
                const invRow = Math.floor(invIdx / MC_COLS);
                const invCol = invIdx % MC_COLS;
                const invCell = $(`inv-${invRow}-${invCol}`);
                if (invCell) {
                    invCell.innerHTML = '';
                    invCell.className = 'inv-cell';
                    delete invCell.dataset.slotType;
                    delete invCell.dataset.pickType;
                    delete invCell.dataset.hasPick;
                }
                spawnPickaxeWorker(colBlocks[ps.col] || [], ps.pType, wi, null, onBlockBroken, dur);
            }, wi * 150);
        });
    }, tntPhaseTime);

    const afterReveal = estimatedReveal + 500;
    setTimeout(() => {
        const newBal = user ? (user.balance || 0) : (balanceBefore + win);
        if (win > 0) {
            playSound('win');
            const balSpan = $('bal-val');
            if (balSpan) animateCounter(balSpan, balanceBefore, newBal, 900, '', '');
            flyToBalance(win);
            if (win > mineLastBet) showToast(`💰 +${win.toFixed(2)} TON!`);
        }
        updateUI();

        // Check if books collected >= 3 — trigger auto-spin
        const shouldAutoSpin = mineBookCount >= 3 || mineAutoRemaining > 0;
        if (mineBookCount >= 3) {
            mineBookCount -= 3;
            mineAutoRemaining = Math.max(mineAutoRemaining, 1);
        }

        if (mineAutoRemaining > 0) {
            mineAutoRemaining--;
            const statusEl = $('mine-book-status');
            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.innerHTML = `🎁 АВТО-СПИН! Блоки сохранены...`;
            }
            showToast('📚 БОНУС! Бесплатный спин!', 2500);
            setTimeout(() => autoSpinMine(), 1500);
        } else {
            const statusEl = $('mine-book-status');
            if (statusEl && statusEl.style.display !== 'none') {
                statusEl.innerHTML = '✅ Серия завершена!';
                setTimeout(() => statusEl.style.display = 'none', 2000);
            }
        }
    }, afterReveal);

    return afterReveal + 400;
}

function setupMineTextures() {
    const imgs = [
        '/sprites/block_grass.png', '/sprites/block_dirt.png',
        '/sprites/block_stone.png', '/sprites/block_redstone.png',
        '/sprites/block_gold.png', '/sprites/block_diamond.png',
        '/sprites/block_obsidian.png', '/sprites/block_tnt.png',
        '/sprites/block_book.png', '/sprites/chest_closed.png',
        '/sprites/chest_open.png', '/sprites/crack_1.png',
        '/sprites/crack_2.png', '/sprites/crack_3.png'
    ];
    imgs.forEach(src => { const i = new Image(); i.src = src; });
}

function initMineGrid() {
    setupMineTextures();
    renderMineHotbar(null);
    initMineShaft(false, true);
}

async function autoSpinMine() {
    if (mineIsSpinning) return;
    if (!user) return;
    const btn = $('mn-btn');
    mineIsSpinning = true;
    if (btn) btn.disabled = true;
    const balanceBefore = user ? (user.balance || 0) : 0;

    // Build current grid state: broken blocks = null, intact = type
    const currentGrid = [];
    for (let r = 0; r < MC_ROWS; r++) {
        const row = [];
        for (let c = 0; c < MC_COLS; c++) {
            const el = $(`mc-blk-${r}-${c}`);
            if (el && el.dataset.revealed === '1') {
                row.push(null); // broken block stays broken
            } else if (el && el.dataset.blockType) {
                row.push(el.dataset.blockType);
            } else {
                row.push(null);
            }
        }
        currentGrid.push(row);
    }

    try {
        const resp = await fetch('/api/mine', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: user.id, bet: 0, mode, autoSpin: true, persistGrid: currentGrid })
        });
        const data = await resp.json();
        if (!resp.ok) { mineIsSpinning = false; if (btn) btn.disabled = false; return; }
        user = data.user;
        if (typeof data.freeSpinsLeft === 'number') mineAutoRemaining = data.freeSpinsLeft;
        renderMineHotbar(data.hotbar);
        const totalTime = revealMineShaft(data.grid, data.blockWins, data.win, balanceBefore, data.chestMults, true);
        setTimeout(() => { mineIsSpinning = false; if (btn) btn.disabled = false; }, totalTime + 100);
    } catch(e) {
        mineIsSpinning = false; if (btn) btn.disabled = false;
    }
}

async function playMine() {
    if (!user) return showToast('Загрузка...');
    if (mineIsSpinning) return;
    if (maintenance.mine) return showToast('⚙️ Игра на техническом обслуживании');

    const betInput = $('mn-bet');
    const btn      = $('mn-btn');

    let betVal = parseFloat(betInput ? betInput.value : 0);
    if (!betVal || betVal < 0.1) { showToast('Мин. ставка 0.1 TON'); return; }
    if (betVal > 25) { betVal = 25; if (betInput) betInput.value = 25; }
    mineLastBet = betVal;

    mineBookCount  = 0;
    minePersistGrid = null;
    const statusEl = $('mine-book-status');
    if (statusEl) statusEl.style.display = 'none';

    playSound('click');
    mineIsSpinning = true;
    if (btn) btn.disabled = true;
    const balanceBefore = user ? (user.balance || 0) : 0;
    renderMineHotbar(null);
    initMineShaft(false, true);

    try {
        const resp = await fetch('/api/mine', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: user.id, bet: betVal, mode })
        });
        const data = await resp.json();
        if (!resp.ok) { showToast(data.error || 'Ошибка'); mineIsSpinning = false; if (btn) btn.disabled = false; return; }
        user = data.user;
        if (typeof data.freeSpinsLeft === 'number') mineAutoRemaining = data.freeSpinsLeft;

        renderMineHotbar(data.hotbar);
        const totalTime = revealMineShaft(data.grid, data.blockWins, data.win, balanceBefore, data.chestMults, false);
        setTimeout(() => { mineIsSpinning = false; if (btn) btn.disabled = false; }, totalTime + 100);

    } catch(e) {
        showToast('Ошибка соединения');
        mineIsSpinning = false;
        if (btn) btn.disabled = false;
    }
}

function showFreeSpinActivation(count) {
    const overlay = $('freespin-overlay');
    const countEl = $('freespin-overlay-count');
    if (!overlay) return;
    if (countEl) countEl.innerText = count;
    overlay.style.display = 'flex';
    // Закрыть через 2.5 секунды
    setTimeout(() => {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.4s';
        setTimeout(() => {
            overlay.style.display = 'none';
            overlay.style.opacity = '1';
            overlay.style.transition = '';
        }, 400);
    }, 2100);
}

function startSpinAnim() {
    let frame = 0;
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 5; c++) {
            const cell = $(`sc-${r}-${c}`);
            if (cell) { cell.className = 'spin-cell spinning'; cell.style.borderColor = '#333'; cell.style.boxShadow = ''; }
        }
    }
    spinAnimInterval = setInterval(() => {
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 5; c++) {
                const cell = $(`sc-${r}-${c}`);
                if (cell) {
                    const sym = SPIN_SYMS_ANIM[(frame + r + c * 3) % SPIN_SYMS_ANIM.length];
                    cell.innerText = sym === 'G' ? '🎁' : sym;
                }
            }
        }
        frame++;
    }, 100);
}

async function stopSpinAnim(grid, hiddenGs) {
    return new Promise(resolve => {
        setTimeout(() => {
            clearInterval(spinAnimInterval);
            spinAnimInterval = null;

            // Reveal result
            for (let r = 0; r < 3; r++) {
                for (let c = 0; c < 5; c++) {
                    const cell = $(`sc-${r}-${c}`);
                    const sym = grid[r][c];
                    if (cell) {
                        cell.className = `spin-cell sym-${sym}`;
                        cell.style.borderColor = '';
                        cell.style.boxShadow = '';
                        cell.innerText = sym === 'G' ? '🎁' : sym;
                    }
                }
            }

            // Animate G symbols (gift reveal)
            for (let r = 0; r < 3; r++) {
                for (let c = 0; c < 5; c++) {
                    if (grid[r][c] === 'G') {
                        const cell = $(`sc-${r}-${c}`);
                        if (cell) { cell.classList.add('gift-reveal'); setTimeout(() => cell.classList.remove('gift-reveal'), 600); }
                    }
                }
            }

            // Animate hidden G with glitch after 400ms
            if (hiddenGs && hiddenGs.length > 0) {
                setTimeout(() => {
                    hiddenGs.forEach(({ row, col }) => {
                        const cell = $(`sc-${row}-${col}`);
                        if (cell) {
                            cell.classList.add('hidden-g-anim');
                            cell.innerText = '🎁';
                            setTimeout(() => cell.classList.remove('hidden-g-anim'), 700);
                        }
                    });
                }, 350);
            }

            resolve();
        }, 1500);
    });
}

function highlightSpinWins(winLines, grid) {
    if (!winLines || !winLines.length) return;
    winLines.forEach(wl => {
        const line = SPIN_PAYLINES_FE[wl.lineIndex];
        if (!line) return;
        for (let col = 0; col < wl.count; col++) {
            const row = line[col];
            const cell = $(`sc-${row}-${col}`);
            if (cell) {
                cell.classList.add('win-cell');
                // X impact animation
                if (wl.symbol === 'X') {
                    cell.classList.add('x-impact');
                    setTimeout(() => cell.classList.remove('x-impact'), 450);
                }
                setTimeout(() => cell.classList.remove('win-cell'), 2000);
            }
        }
    });
}

async function playSpin() {
    if (spinIsSpinning) return;
    const isFreeSpins = spinFreeSpins > 0;

    if (!isFreeSpins) {
        const betVal = parseFloat($('sp-bet') ? $('sp-bet').value : 0);
        if (isNaN(betVal) || betVal < 0.1 || betVal > 25) return showToast('Мин 0.1, Макс 25 TON');
        const bal = mode === 'demo' ? user.demo_balance : user.balance;
        if (betVal > bal) return showToast('Недостаточно средств');
        spinBet = betVal;
    }
    playSound('spin');

    spinIsSpinning = true;
    const btn = $('sp-btn');
    if (btn) { btn.disabled = true; }

    const winDisp = $('spin-win-display');
    if (winDisp) winDisp.style.display = 'none';

    if (isFreeSpins) spinFreeSpins--;

    startSpinAnim();

    try {
        const r = await fetch('/api/spin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: user.id, bet: spinBet, mode,
                freeSpinsMode: isFreeSpins,
                currentMultiplier: spinFreeSpinsMult
            })
        });

        const data = await r.json();
        if (!r.ok) {
            clearInterval(spinAnimInterval);
            for (let ri = 0; ri < 3; ri++) for (let ci = 0; ci < 5; ci++) { const c = $(`sc-${ri}-${ci}`); if(c) { c.className='spin-cell sym-L'; c.innerText='L'; } }
            showToast(data.error || 'Ошибка');
            return;
        }

        user = data.user;

        await stopSpinAnim(data.grid, data.hiddenGs);

        if (data.win > 0) {
            playSound('win');
            if (winDisp) { winDisp.innerText = `+${data.win.toFixed(2)} TON`; winDisp.style.display = 'block'; }
            highlightSpinWins(data.winLines, data.grid);
            flyToBalance(data.win);
            showToast(`💰 +${data.win.toFixed(2)} TON!`);
        }

        // Progress bar
        updateSpinProgress(data.progressValue);

        // Bonus triggered
        if (data.bonusTriggered) {
            const bonusMult = Math.min(7, spinFreeSpinsMult * 2);
            spinFreeSpins += data.bonusSpins || 1;
            spinFreeSpinsMult = bonusMult;
            showToast(`🎁 БОНУС! +${data.bonusSpins || 1} фриспин! Множитель ×${spinFreeSpinsMult}!`, 4000);
        }

        // Free spins won from scatter G (max 8, нет ре-триггера во фриспинах)
        if (data.freeSpinsWon > 0 && !isFreeSpins) {
            spinFreeSpins = Math.min(8, spinFreeSpins + data.freeSpinsWon);
            spinFreeSpinsMult = 1;
            // Показываем оверлей активации по центру
            showFreeSpinActivation(spinFreeSpins);
        }

        // В режиме фриспинов: X на выигрышной линии = +1 к множителю (максимум +1 за спин)
        if (isFreeSpins) {
            const xBonus = data.xCountInGrid > 0 ? 1 : 0; // +1 только если есть X на линии, не на каждый X
            const newMult = Math.min(7, spinFreeSpinsMult + xBonus);
            if (xBonus > 0 && newMult > spinFreeSpinsMult) showToast(`⚡ Множитель ×${newMult}!`, 2000);
            spinFreeSpinsMult = newMult;
            if (data.gForExtraSpins > 0) { spinFreeSpins += data.gForExtraSpins; showToast(`🎁 +${data.gForExtraSpins} фриспин!`, 2000); }
        }

        updateSpinUI();
        updateUI();

    } catch(e) {
        clearInterval(spinAnimInterval);
        showToast('Ошибка соединения');
    } finally {
        spinIsSpinning = false;
        if (btn) {
            btn.disabled = false;
            updateSpinUI();
        }
    }
}
