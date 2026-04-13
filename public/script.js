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
let rtpObj = { crash: 90, mines: 90, coinflip: 90, spin: 94, mine: 40, upgrade: 85, cases: 78 };
let maintenance = { crash: false, mines: false, coinflip: false, battle: false, spin: false, mine: false, upgrade: false, case: false };
let gameSettings = {}; // Настройки механик из админки
let adminWalletAddress='';
let adminWallet48='';
let isShowDemo = false;

// Загружаем публичные настройки механик игр
async function loadGameSettings() {
    try {
        const r = await fetch('/api/game_settings');
        if(r.ok){ const d = await r.json(); if(d.ok) gameSettings = d.settings || {}; }
    } catch(e) {}
}

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
        'qb-upgrade':  'up-bet',
        'qb-plinko':   'pl-bet',
        'qb-duck':     'dk-bet',
    };
    Object.entries(targets).forEach(([elId, betId]) => {
        const el = $(elId);
        if (el) el.innerHTML = makeButtons(betId);
    });
}

window.onload = async () => {
    tg.expand();
    if(tg.setHeaderColor) tg.setHeaderColor('#050508');
    if(tg.setBackgroundColor) tg.setBackgroundColor('#050508');
    if(tg.setBottomBarColor) tg.setBottomBarColor('#050508');
    function applySafeArea(){
        const c=tg.contentSafeAreaInset?(tg.contentSafeAreaInset.top||0):0;
        const sa=tg.safeAreaInset?(tg.safeAreaInset.top||0):0;
        const bot=tg.safeAreaInset?(tg.safeAreaInset.bottom||0):0;
        document.documentElement.style.setProperty('--sa-top',Math.max(c,sa)+'px');
        document.documentElement.style.setProperty('--sa-bot',bot+'px');
    }
    applySafeArea(); setTimeout(applySafeArea,300); setTimeout(applySafeArea,1000);
    try{tg.onEvent('safeAreaChanged',applySafeArea);}catch(e){}
    try{tg.onEvent('contentSafeAreaChanged',applySafeArea);}catch(e){}
    loadBanner(); loadCasinoSound();
    renderQuickBets();
    loadBanner();
    loadGameSettings(); // Загружаем настройки механик из админки
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
    rtpObj = data.rtp || { crash: 90, mines: 90, coinflip: 90, spin: 94, upgrade: 85, cases: 78 };
    maintenance = data.maintenance || {};
    // Нормализуем ключи (сервер может вернуть maintenance_mine вместо mine)
    if(maintenance.maintenance_mine !== undefined) maintenance.mine = maintenance.maintenance_mine;
    if(maintenance.maintenance_mines !== undefined) maintenance.mines = maintenance.maintenance_mines;
    isShowDemo = data.config ? data.config.showDemo : false;
    
    adminWalletAddress=data.adminWallet||'';
    adminWallet48=data.wallet48||'';
    // Регистрируем юзера в онлайн-трекере
    socket.emit('register_online', data.user?.id || user?.id);
    // Восстанавливаем последнюю страницу
    try{
        const lastPage = localStorage.getItem('lx_lastPage');
        if(lastPage && MAIN_PAGES.has(lastPage) && lastPage !== 'games') {
            const navEl = document.querySelector(`.nav-item[onclick*="${lastPage}"]`);
            nav(lastPage, navEl);
        }
    }catch(e){}
    if($('dep-wallet')) $('dep-wallet').innerText = adminWalletAddress || 'Кошелек не настроен на сервере';
    if($('dep-memo')) $('dep-memo').innerText = user.id;

    if($('loader')) { $('loader').style.opacity = '0'; setTimeout(() => $('loader').style.display = 'none', 500); }
    
    const avaUrl = user.photo || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
    if($('user-ava')) $('user-ava').src = avaUrl; 
    if($('profile-ava')) $('profile-ava').src = avaUrl;
    if($('profile-name')) $('profile-name').innerText = user.username || 'Игрок';
    if($('profile-id')) {
        $('profile-id').innerText = user.id;
        $('profile-id').style.cursor = 'pointer';
        $('profile-id').onclick = () => {
            navigator.clipboard.writeText(user.id).then(() => showToast('ID скопирован!')).catch(() => {
                const t = document.createElement('textarea');
                t.value = user.id; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
                showToast('ID скопирован!');
            });
        };
    }
    
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
    if($('ref-pending')) $('ref-pending').innerText = (user.referralPending || 0).toFixed(2);
    // Грузим детали рефералов с сервера
    loadRefDetails();
}


// ════ REFERRAL DETAILS ════
async function loadRefDetails() {
    const el = $('ref-list');
    if(!el) return;
    try{
        const r = await fetch('/api/ref/details',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:user.id})});
        if(!r.ok) return;
        const d = await r.json();
        // Обновляем pending
        if($('ref-pending')) $('ref-pending').innerText = (d.pending||0).toFixed(2);
        if($('btn-ref-claim')) $('btn-ref-claim').style.display = d.pending>0.01 ? 'block':'none';
        if(!d.details||!d.details.length){
            el.innerHTML='<div style="color:#555;text-align:center;padding:16px;">Нет рефералов</div>';return;
        }
        el.innerHTML = d.details.map(r=>{
            const ava = r.photo
                ? `<img src="${r.photo}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid var(--neon);flex-shrink:0;">`
                : `<div style="width:40px;height:40px;border-radius:50%;background:#1a1a2e;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">👤</div>`;
            const myShare = Number((Math.min(r.depositsCounted,10)*r.totalDeposited/Math.max(r.depositsCounted||1,1)*0.1).toFixed(2));
            return `<div style="display:flex;align-items:center;gap:10px;background:#0a0a0a;border:1px solid #1a1a2e;border-radius:12px;padding:10px;margin-bottom:8px;">
                ${ava}
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:800;font-size:13px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.username}</div>
                    <div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap;">
                        <span style="color:#00ff88;font-size:11px;font-weight:700;" title="Внёс депозитов">💰 ${r.totalDeposited.toFixed(2)} TON</span>
                        <span style="color:#00e5ff;font-size:11px;font-weight:700;" title="Ваша доля 10%">✨ +${r.myEarnings.toFixed(2)}</span>
                    </div>
                    <div style="color:#555;font-size:10px;margin-top:2px;">Депозитов: ${r.depositsCounted}/10 учтено</div>
                </div>
                <div style="text-align:right;font-size:12px;color:#888;">${r.balance.toFixed(2)}<br><span style="font-size:9px;">баланс</span></div>
            </div>`;
        }).join('');
    }catch(e){}
}
async function claimRefBonus() {
    const btn = $('btn-ref-claim');if(btn){btn.disabled=true;btn.innerText='...';}
    try{
        const r = await fetch('/api/ref/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:user.id})});
        const d = await r.json();
        if(r.ok){user=d.user;updateUI();playSound('win');flyToBalance(d.claimed);showToast('Получено +'+d.claimed+' TON');}
        else showToast('❌ '+(d.error||'Ошибка'));
    }catch(e){showToast('❌ Ошибка');}
    if(btn){btn.disabled=false;btn.innerText='Забрать кэш';}
}

// ════ WALLET TABS ════
function switchWalletTab(tab) {
    const depPanel = $('wallet-dep-panel');
    const wdPanel  = $('wallet-wd-panel');
    const btnDep   = $('wt-dep');
    const btnWd    = $('wt-wd');
    if(tab === 'dep') {
        if(depPanel) depPanel.style.display = '';
        if(wdPanel)  wdPanel.style.display  = 'none';
        if(btnDep){btnDep.classList.add('wtab-active');btnDep.classList.remove('wtab-inactive');}
        if(btnWd)  { btnWd.classList.remove('wtab-active'); btnWd.classList.add('wtab-inactive'); }
    } else {
        if(depPanel) depPanel.style.display = 'none';
        if(wdPanel)  wdPanel.style.display  = '';
        if(btnWd)  { btnWd.classList.add('wtab-active'); btnWd.classList.remove('wtab-inactive'); }
        if(btnDep) { btnDep.classList.remove('wtab-active'); btnDep.classList.add('wtab-inactive'); }
        renderWithdrawHistory('withdraws');
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

const MAIN_PAGES=new Set(['games','profile','wallet','promo','gifts']);
function nav(pageId,el){
    if(pageId!=='mine'&&typeof killAllPickaxes==='function')killAllPickaxes();
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    if($('page-'+pageId))$('page-'+pageId).classList.add('active');
    if(el){document.querySelectorAll('.nav-item').forEach(i=>i.classList.remove('active'));el.classList.add('active');}
    try{if(tg&&tg.BackButton){if(MAIN_PAGES.has(pageId))tg.BackButton.hide();else tg.BackButton.show();}}catch(e){}
    if(pageId==='wallet') setTimeout(()=>renderWithdrawHistory(),50);
    if(pageId==='promo') setTimeout(()=>loadRefDetails(),50);
    if(pageId==='gifts') setTimeout(()=>loadGiftsPage(),50);
    // Сохраняем последнюю страницу
    try{ if(MAIN_PAGES.has(pageId)) localStorage.setItem('lx_lastPage', pageId); }catch(e){}
}


try{if(tg&&tg.BackButton){tg.BackButton.onClick(function(){
    if(typeof killAllPickaxes==='function')killAllPickaxes();
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    const gp=$('page-games');if(gp)gp.classList.add('active');
    const gn=document.querySelector('.nav-item');
    if(gn){document.querySelectorAll('.nav-item').forEach(i=>i.classList.remove('active'));gn.classList.add('active');}
    tg.BackButton.hide();
});}}catch(e){}
function navGame(game){
    let mKey=game;if(game==='coin')mKey='coinflip';
    if(game==='cases'||game==='case'){nav('cases');loadCasesPage();return;}
    if(maintenance[mKey])return showToast('Временно тех. перерыв');
    if(game!=='mine')killAllPickaxes();
    nav(game);
    if(game==='battle')renderBattleLobbies();
    if(game==='spin')initSpinPage();
    if(game==='mine'){mineIsActive=true;initMineGrid();}
    if(game==='upgrade')setTimeout(initUpgradePage,60);
}

function setQuickBet(inputId, amount, btn) {
    // Spin bet change confirmation with bonus reset
    if (inputId === 'sp-bet' && spinProgressValue > 0) {
        const prev = parseFloat($(inputId)?.value) || 0;
        if (prev !== amount) {
            if (!confirm('Вы уверены? Прогресс бонуса будет сброшен!')) return;
            spinProgressValue = 0;
            updateSpinProgress(0);
        }
    }
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
    if($('dep-gift')) $('dep-gift').style.display = type === 'gift' ? 'block' : 'none';
}

async function payWithTonConnect() {
    if (!tonConnectUI) return showToast('TON Connect не загружен. Перезагрузите страницу.');
    if(!tonConnectUI||!tonConnectUI.wallet){showToast('Подключи кошелёк!');try{await tonConnectUI.openModal();}catch(e){}return;}
    const amount = parseFloat($('tc-amount').value);
    if(isNaN(amount) || amount < 0.5) return showToast('Минимум 0.5 TON');
    if(!adminWalletAddress) return showToast('Кошелек получателя не настроен');

    const addr=adminWallet48||adminWalletAddress.trim().replace(/[\r\n]/g,'');
    if(!addr||addr.length<10)return showToast('Кошелёк казино не загружен');

    // Build comment payload (BOC cell) with user ID for TON Connect
    let payloadBoc = "";
    try {
        if (!window.TonWeb) {
            showToast('Загрузка модуля оплаты...');
            await new Promise((resolve, reject) => {
                let tries = 0;
                const check = setInterval(() => {
                    tries++;
                    if (window.TonWeb) { clearInterval(check); resolve(); }
                    else if (tries > 50) { clearInterval(check); reject(new Error('TonWeb timeout')); }
                }, 200);
            });
        }
        const cell = new TonWeb.boc.Cell();
        cell.bits.writeUint(0, 32); // text comment op code
        cell.bits.writeString(String(user.id));
        const boc = await cell.toBoc();
        payloadBoc = TonWeb.utils.bytesToBase64(boc);
    } catch(e) {
        console.error('Payload error:', e);
    }

    const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages: [{
            address: addr,
            amount: (amount * 1e9).toString(),
            ...(payloadBoc ? { payload: payloadBoc } : {})
        }]
    };

    try {
        await tonConnectUI.sendTransaction(transaction);
        showToast('Транзакция отправлена! Проверка через 20 сек...');

        // Auto-check deposit after delay (blockchain confirmation takes time)
        let checkAttempts = 0;
        const maxAttempts = 6;
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
                    if (d.success && d.added > 0) {
                        user = d.user;
                        updateUI();
                        renderWithdrawHistory();
                        showToast(`+${d.added.toFixed(2)} TON зачислено!`);
                        flyToBalance(d.added);
                        return;
                    }
                }
            } catch(e) {}

            if (checkAttempts < maxAttempts) {
                showToast(`Проверка ${checkAttempts}/${maxAttempts}... Ожидание подтверждения.`);
                setTimeout(autoCheck, 20000);
            } else {
                showToast('Автопроверка завершена. Нажмите "ПРОВЕРИТЬ ОПЛАТУ" вручную.');
            }
        };
        setTimeout(autoCheck, 20000);
    } catch (e) {
        console.error('TON Connect error:', e);
        const msg = e?.message || String(e);
        if (msg.includes('reject') || msg.includes('cancel') || msg.includes('Cancelled')) {
            showToast('Транзакция отменена');
        } else {
            showToast('Ошибка транзакции: ' + msg.slice(0, 80));
        }
    }
}

function renderWithdrawHistory(activeTab) {
    const list = $('w-history-list');
    if(!list) return;
    const tab = activeTab || list.dataset.tab || 'deposits';
    list.dataset.tab = tab;

    // Табы
    const tabs = `<div style="display:flex;gap:8px;margin-bottom:14px;">
        <button onclick="renderWithdrawHistory('deposits')" class="wtab-btn ${tab==='deposits'?'wtab-active':'wtab-inactive'}">Пополнения</button>
        <button onclick="renderWithdrawHistory('withdraws')" class="wtab-btn ${tab==='withdraws'?'wtab-dep-w':'wtab-inactive'}">Выводы</button>
    </div>`;

    let html = '';
    if (tab === 'deposits') {
        const deps = user.depositHistory || [];
        if(!deps.length) html = '<div style="color:#555;text-align:center;padding:20px;">Нет пополнений</div>';
        else html = deps.map(d => {
            const isPromo = d.hash && d.hash.startsWith('PROMO');
            const isAdmin = d.hash && d.hash.startsWith('ADMIN');
            const label = isPromo ? 'Промокод' : isAdmin ? 'Выдано' : 'Депозит';
            return `<div class="w-history-item approved" style="border-left:3px solid var(--neon);">
                <div><b>${label}:</b> +${d.amount} TON<br><span style="color:#888;font-size:10px;">${d.time||''}</span></div>
                <div style="text-align:right;color:var(--neon);">+${d.amount}</div>
            </div>`;
        }).join('');
    } else {
        const wds = user.withdrawHistory || [];
        if(!wds.length) html = '<div style="color:#555;text-align:center;padding:20px;">Нет выводов</div>';
        else html = wds.map(w => {
            let cls = w.status==='Подтверждено'?'approved':(w.status==='Отклонено'?'rejected':'pending');
            let rsn = w.reason?`<br><span style="color:var(--neon-red);font-size:10px;">Причина: ${w.reason}</span>`:'';
            return `<div class="w-history-item ${cls}">
                <div><b>Вывод:</b> ${w.amount} TON<br><span style="color:#888;font-size:10px;">${w.time||''}</span></div>
                <div style="text-align:right;">${w.status}${rsn}</div>
            </div>`;
        }).join('');
    }
    list.innerHTML = tabs + html;
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
        if(list.children.length > 15) list.lastChild.remove();
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
    if($('cr-history')) $('cr-history').innerHTML = hist.slice(0,6).map(x => `<div class="cr-badge" style="color:${getCrashColor(x)};border-color:${getCrashColor(x)};">${x}x</div>`).join('');
});


function adjustAutoCash(delta) {
    const inp = $('cr-auto');
    if (!inp) return;
    let v = parseFloat(inp.value) || 0;
    v = Math.round((v + delta) * 100) / 100;
    if (v < 1.01) { inp.value = ''; return; }
    inp.value = v.toFixed(2);
}
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

// Smooth crash counter state
let _crashTarget = 1.00;
let _crashCurrent = 1.00;
let _crashAnimId = null;

function _crashAnimate() {
    if (!$('cr-x')) { _crashAnimId = null; return; }
    const diff = _crashTarget - _crashCurrent;
    if (Math.abs(diff) < 0.002) {
        _crashCurrent = _crashTarget;
    } else {
        _crashCurrent += diff * 0.35;
    }
    $('cr-x').innerText = _crashCurrent.toFixed(2) + 'x';
    if (Math.abs(_crashTarget - _crashCurrent) > 0.002) {
        _crashAnimId = requestAnimationFrame(_crashAnimate);
    } else {
        _crashAnimId = null;
    }
}

socket.on('crashData', d => {
    curCrash = d; const btn = $('cr-btn');
    // Auto cashout check — applies to ALL bets placed this round
    if (d.status === 'running' && myCrashBets.length > 0) {
        const autoVal = parseFloat($('cr-auto')?.value);
        if (!isNaN(autoVal) && autoVal >= 1.01 && parseFloat(d.multiplier) >= autoVal) {
            if (!isCashingOut) {
                isCashingOut = true;
                const mult = parseFloat(d.multiplier);
                // Cash out all bets sequentially
                (async () => {
                    let totalWin = 0;
                    const betsToClose = [...myCrashBets];
                    myCrashBets = [];
                    for (const autoBet of betsToClose) {
                        const autoWin = parseFloat((autoBet * mult).toFixed(2));
                        try {
                            const r = await fetch('/api/bet', {method:'POST',headers:{'Content-Type':'application/json'},
                                body:JSON.stringify({id:user.id,game:'Crash',bet:0,win:autoWin,mode:crMode})
                            });
                            if (r.ok) { user = await r.json(); totalWin += autoWin; }
                        } catch(e) {}
                    }
                    updateUI();
                    if (totalWin > 0) { showToast('АВТО: +'+totalWin.toFixed(2)+' TON'); flyToBalance(totalWin); }
                    isCashingOut = false;
                })();
            }
        }
    }
    if(!btn) return;
    if(d.status === 'waiting') {
        _crashCurrent = 1.00; _crashTarget = 1.00;
        if (_crashAnimId) { cancelAnimationFrame(_crashAnimId); _crashAnimId = null; }
        if($('cr-x')) { $('cr-x').innerText = 'ЖДЕМ'; $('cr-x').style.color = '#fff'; $('cr-x').style.textShadow = 'none'; }
        if($('cr-timer')) $('cr-timer').innerText = `СТАРТ: ${d.timer}с`;
        if(myCrashBets.length === 0) { btn.innerText = 'ПОСТАВИТЬ'; btn.style.background = 'var(--neon)'; btn.disabled = false; }
        else if (myCrashBets.length === 1) { btn.innerText = 'ПОСТАВИТЬ 2-Ю СТАВКУ'; btn.style.background = 'var(--neon)'; btn.disabled = false; }
        else { btn.innerText = 'МАКС. СТАВОК (2)'; btn.style.background = '#555'; btn.disabled = true; }
    }
    if(d.status === 'running') {
        const col = getCrashColor(d.multiplier);
        if($('cr-x')) {
            _crashTarget = parseFloat(d.multiplier);
            if (!_crashAnimId) {
                _crashAnimId = requestAnimationFrame(_crashAnimate);
            }
            $('cr-x').style.color = col;
            $('cr-x').style.textShadow = `0 0 20px ${col}40`;
        }
        if($('cr-timer')) $('cr-timer').innerText = '🚀 В ПОЛЕТЕ';
        if (myCrashBets.length > 0) { btn.innerText = `ЗАБРАТЬ ${(myCrashBets[0] * d.multiplier).toFixed(2)} TON`; btn.style.background = 'var(--neon-red)'; btn.disabled = false; }
        else { btn.innerText = 'ОЖИДАНИЕ'; btn.style.background = '#555'; btn.disabled = true; }
    }
    if(d.status === 'crashed') {
        if (_crashAnimId) { cancelAnimationFrame(_crashAnimId); _crashAnimId = null; }
        _crashCurrent = 1.00; _crashTarget = 1.00;
        const crashPage = document.getElementById('page-crash');
        if (crashPage && crashPage.classList.contains('active')) playSound('break');
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
    
    // Количество бомб из настроек админки (по умолчанию 5, максимум из gameSettings)
    const maxBombs = Number(gameSettings['game_mines_max_bombs']) || 24;
    const bombCount = Math.min(5, maxBombs); // Ставим 5 или меньше если лимит меньше
    
    isMinesProcessing = true; $('mi-btn').disabled = true; miMode = mode;
    reqBet('Mines', miBet, 0, miMode).then(success => {
        isMinesProcessing = false; $('mi-btn').disabled = false;
        if(success) {
            bombs = []; while(bombs.length<bombCount) { let r=Math.floor(Math.random()*25); if(!bombs.includes(r)) bombs.push(r); }
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
                currentMinesWin = miBet * (1 + openedCells * 0.12); $('mi-btn').innerText = `ЗАБРАТЬ ${currentMinesWin.toFixed(2)} TON`;
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
    const cfMaxBet = Number(gameSettings['game_coinflip_max_bet']) || 25;
    if(isNaN(bet) || bet < 0.1 || bet > cfMaxBet) return showToast(`Мин 0.1, Макс ${cfMaxBet} TON`);
    if(bet > curBal) return showToast('Недостаточно средств!');

    playSound('click');
    isFlipping = true; $('co-btn').innerText = 'КРУТИМ...'; $('co-btn').disabled = true;
    let coMode = mode; 
    
    const winChance = ((rtpObj.coinflip || 90) / 100) * 0.5; 
    const isWin = Math.random() < winChance;
    const result = isWin ? cSide : (cSide === 'L' ? 'X' : 'L');
    const cfWinMult = Number(gameSettings['game_coinflip_win_mult']) || 1.9;
    
    const coin = $('coin-3d');
    const rotation = result === 'L' ? 1800 : 1980;
    coin.style.transition = 'transform 2s cubic-bezier(0.2, 0.8, 0.2, 1)';
    coin.style.transform = `rotateY(${rotation}deg)`;
    
    setTimeout(async () => {
        const win = result === cSide ? Number((bet * cfWinMult).toFixed(2)) : 0;
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
            actionBtn = `<button class="btn" style="background:rgba(255,34,85,.15);border:1px solid rgba(255,34,85,.4);color:#ff2255;padding:7px 14px;font-size:12px;font-weight:800;border-radius:10px;" onclick="cancelBattle('${l._id}')">Отмена</button>`;
        } else {
            actionBtn = `<button class="btn" style="background:var(--neon);color:#000;padding:8px 14px;font-size:12px;font-weight:900;border-radius:10px;" onclick="openBattleGame('${l._id}')">${imIn ? 'Смотреть' : 'Войти'}</button>`;
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
async function checkRealDeposit(btn,silent){
    if(btn){btn.innerText='ПРОВЕРЯЕМ...';btn.disabled=true;}
    try{const r=await fetch('/api/check_deposit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:user.id})});
        const d=await r.json();
        if(r.ok&&(d.success||d.added>0)){
            if(d.user)user=d.user;updateUI();renderWithdrawHistory();
            if(d.added>0){playSound('win');showToast('+'+Number(d.added).toFixed(2)+' TON');flyToBalance(d.added);}
        }else if(!silent)showToast(d.error||'Оплата не найдена');
    }catch(e){if(!silent)showToast('Ошибка соединения');}
    if(btn){btn.innerText='ПРОВЕРИТЬ ОПЛАТУ';btn.disabled=false;}
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

async function activatePromo(){
    const input=$('promo-code');
    const code=(input?input.value:'').trim();if(!code)return showToast('Введи промокод');
    const r=await fetch('/api/promo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:user.id,code})});
    if(r.ok){
        const d=await r.json();user=d.user||d;updateUI();if(input)input.value='';
        const amt=d.amount||0;showToast('Промокод активирован'+(amt>0?' +'+amt+' TON':'')+'!');
        if(amt>0){playSound('win');flyToBalance(amt);}
    }else{const e=await r.json();showToast(e.error||'Ошибка промо');}
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
        c.innerHTML = '<div class="adm-block" style="text-align:center;padding:20px;color:var(--neon);">Загрузка логов...</div>';
        loadAdminLogs(1, '');
    } else if (tab === 'stats') {
        loadAdminGameStats();
    } else if (tab === 'gifts_admin') {
        adminViewGifts();
    } else {
        renderAdminContent(tab); 
    }
}

let adData = {};
async function loadAdminData() {
    const r = await fetch('/api/admin/data', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass}) });
    if(r.ok) {
        const admD = await r.json();
        adData = admD;
        adData.onlineIds = admD.onlineIds || [];
        $('admin-modal').style.display = 'flex';
        switchAdminTab('withdraws');
    } else showToast('Неверный пароль');
}

async function searchAdminUsers(query, filterType = currentAdminFilter) {
    adminSearchQuery = query;
    currentAdminFilter = filterType;
    const r = await fetch('/api/admin/search_user', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, query, filterType}) });
    if(r.ok) {
        const d = await r.json();
        adData.users = d.users;
        if(filterType === 'online') adData.onlineCount = d.onlineCount;
        renderAdminContent('users');
    }
}

async function loadTopReferrals() {
    currentAdminFilter = 'ref';
    const c = $('admin-content');
    if(c) c.innerHTML = '<div class="adm-block" style="text-align:center;padding:20px;color:var(--neon);">Загрузка...</div>';
    const r = await fetch('/api/admin/top_referrals', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass:adminPass}) });
    if(!r.ok){ if(c) c.innerHTML='<div style="color:red;text-align:center;">Ошибка</div>'; return; }
    const data = await r.json();
    const users = data.users || [];
    const rows = users.map((u,i)=>`
        <div class="adm-user-card" onclick="adminViewUser('${u.id}',1)">
            <div style="flex-shrink:0;width:22px;text-align:center;font-size:13px;font-weight:900;color:${i===0?'#ffe060':i===1?'#aaa':i===2?'#cd7f32':'#555'};">${i+1}</div>
            <img src="${u.photo||'https://cdn-icons-png.flaticon.com/512/149/149071.png'}" class="adm-user-ava" style="flex-shrink:0;">
            <div class="adm-user-info">
                <div class="adm-user-name">${u.username||'Без имени'}</div>
                <div style="font-size:11px;color:#ce93d8;font-weight:700;">👥 ${u.refCount} рефералов · ${(u.referralEarnings||0).toFixed(2)} TON заработано</div>
            </div>
            <div style="text-align:right;flex-shrink:0;font-size:12px;color:#aaa;">${(u.balance||0).toFixed(2)}</div>
        </div>`).join('');
    if(c) c.innerHTML = `
<div class="adm-block">
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-bottom:10px;">
        <button class="adm-filt-btn" onclick="searchAdminUsers('','balance')">Баланс</button>
        <button class="adm-filt-btn" onclick="searchAdminUsers('','new')">Новые</button>
        <button class="adm-filt-btn" onclick="searchAdminUsers('','banned')">Забан</button>
        <button class="adm-filt-btn adm-filt-online" onclick="searchAdminUsers('','online')">Онлайн</button>
        <button class="adm-filt-btn adm-filt-active" style="color:#ce93d8;border-color:rgba(206,147,216,.4);">Реф</button>
    </div>
    <div style="font-size:11px;color:#888;">Топ по количеству рефералов</div>
</div>
<div class="adm-block" style="padding:0;">${rows||'<div class="adm-empty" style="padding:20px;">Нет рефералов</div>'}</div>`;
}

async function adminViewUser(userId, page = 1) {
    const r = await fetch('/api/admin/user_details', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({pass:adminPass, userId, page})
    });
    if(!r.ok){showToast('Ошибка');return;}
    const d = await r.json();
    const u = d.user;
    const c = $('admin-content');
    if(!c) return;
    const wl = Math.max(0,(u.wagerRequired||0)-(u.wagerCompleted||0));
    c.innerHTML = `
<div class="adm-block" style="display:flex;align-items:center;gap:12px;">
    <img src="${u.photo||'https://cdn-icons-png.flaticon.com/512/149/149071.png'}" style="width:52px;height:52px;border-radius:50%;border:2px solid var(--neon);object-fit:cover;flex-shrink:0;">
    <div style="flex:1;min-width:0;">
        <a href="https://t.me/${u.username||''}" target="_blank" style="font-size:16px;font-weight:900;color:#fff;margin-bottom:2px;text-decoration:none;display:block;">
            ${u.username||'Без имени'} <span style="font-size:11px;color:#00e5ff;opacity:0.7;">↗</span>
        </a>
        <div style="font-size:12px;color:#888;">ID: ${u.id}</div>
        ${u.isBlocked?'<span class="adm-badge-ban" style="font-size:11px;">ЗАБЛОКИРОВАН</span>':''}
    </div>
    <div style="text-align:right;flex-shrink:0;">
        <div style="font-size:20px;font-weight:900;color:var(--neon);">${(u.balance||0).toFixed(2)}</div>
        <div style="font-size:10px;color:#888;">TON</div>
    </div>
</div>
<div class="adm-block" style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;">
    <div class="adm-stat-card"><div class="adm-stat-label">Ставок</div><b class="adm-stat-val">${u.stats?.bets||0}</b></div>
    <div class="adm-stat-card"><div class="adm-stat-label">Побед</div><b class="adm-stat-val" style="color:var(--neon);">${u.stats?.wins||0}</b></div>
    <div class="adm-stat-card"><div class="adm-stat-label">Выиграл</div><b class="adm-stat-val" style="color:var(--neon);">${(u.stats?.plus||0).toFixed(2)}</b></div>
    <div class="adm-stat-card"><div class="adm-stat-label">Проиграл</div><b class="adm-stat-val" style="color:#ff2255;">${(u.stats?.minus||0).toFixed(2)}</b></div>
    <div class="adm-stat-card"><div class="adm-stat-label">Депозиты</div><b class="adm-stat-val">${(u.totalDeposited||0).toFixed(2)}T</b></div>
    <div class="adm-stat-card"><div class="adm-stat-label">Отыгрыш</div><b class="adm-stat-val" style="color:${wl>0?'#ffcc00':'var(--neon)'};">${wl.toFixed(2)}T</b></div>
</div>
<div class="adm-block">
    <div class="adm-block-title">ИЗМЕНИТЬ БАЛАНС</div>
    <div style="display:flex;gap:8px;">
        <input type="number" id="ad-bal-val" class="input-box" placeholder="Сумма TON" step="0.5" min="0.01" style="flex:1;">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
        <button style="background:linear-gradient(135deg,#00ff88,#00c060);color:#000;padding:10px;border-radius:10px;font-weight:900;border:none;cursor:pointer;" onclick="adminChangeBal('${u.id}','add')">+ Выдать</button>
        <button style="background:#1a0808;border:1px solid #ff2255;color:#ff2255;padding:10px;border-radius:10px;font-weight:900;cursor:pointer;" onclick="adminChangeBal('${u.id}','sub')">- Списать</button>
    </div>
</div>
<div class="adm-block">
    <div class="adm-block-title">ДЕЙСТВИЯ</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button onclick="adminBan('${u.id}',${!u.isBlocked})" style="${u.isBlocked?'background:linear-gradient(135deg,#00ff88,#00c060);color:#000;':'background:#2a0808;border:1px solid #ff2255;color:#ff2255;'} padding:10px;border-radius:10px;font-weight:800;border:${u.isBlocked?'none':'1px solid #ff2255'};cursor:pointer;">${u.isBlocked?'Разбанить':'Забанить'}</button>
        <button onclick="adminMsgUser('${u.id}')" style="background:#0d2a33;border:1px solid #00e5ff44;color:#00e5ff;padding:10px;border-radius:10px;font-weight:800;cursor:pointer;">Написать в бота</button>
        <button onclick="adminGiveGift('${u.id}')" style="background:#1a0d2a;border:1px solid rgba(206,147,216,.4);color:#ce93d8;padding:10px;border-radius:10px;font-weight:800;cursor:pointer;grid-column:span 2;">Выдать подарок</button>
    </div>
</div>
<div class="adm-block">
    <div class="adm-block-title">ИСТОРИЯ СТАВОК</div>
    <div style="font-size:10px;color:#555;margin-bottom:8px;">Всего ставок: ${d.totalBets||0} | Страница ${d.page||1} из ${d.totalPages||1}</div>
    ${(d.bets||[]).map(b=>{
        const profit=b.result||0;
        const pColor=profit>0?'var(--neon)':'#ff2255';
        const modeTag=b.mode==='Demo'?'<span style="color:#00e5ff;font-size:9px;">[D]</span>':'';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04);">
            <div>
                <div style="font-size:12px;font-weight:700;color:#ddd;">${b.game} ${modeTag}</div>
                <div style="font-size:10px;color:#555;">${b.timeMsk||String(b.createdAt||'').slice(0,10)||'—'} · ${b.amount}T × ${b.multiplier||'?'}</div>
            </div>
            <div style="text-align:right;font-size:14px;font-weight:900;color:${pColor};">${profit>0?'+':''}${profit.toFixed(2)}</div>
        </div>`;
    }).join('') || '<div class="adm-empty">Нет ставок</div>'}
    ${(d.totalPages||1)>1?`<div style="display:flex;gap:6px;margin-top:10px;align-items:center;">
        <button onclick="adminViewUser('${u.id}',${Math.max(1,(d.page||1)-1)})" class="adm-ok-btn" style="flex:1;${(d.page||1)<=1?'opacity:.4;pointer-events:none;':''}">←</button>
        <span style="flex:2;text-align:center;color:#888;font-size:12px;">${d.page||1} / ${d.totalPages||1}</span>
        <button onclick="adminViewUser('${u.id}',${Math.min(d.totalPages||1,(d.page||1)+1)})" class="adm-ok-btn" style="flex:1;${(d.page||1)>=(d.totalPages||1)?'opacity:.4;pointer-events:none;':''}">→</button>
    </div>`:''}
</div>
<button onclick="renderAdminContent('users')" class="adm-back-btn" style="margin-top:4px;">← Назад к списку</button>
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

    // ── ВЫВОДЫ / ДЕПОЗИТЫ ──────────────────────────────────────────
    if(tab === 'withdraws') {
        const profit = (adData.totalDeposited||0) - (adData.totalWithdrawn||0);
        c.innerHTML = `
<div class="adm-block" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;text-align:center;">
    <div class="adm-stat-card" style="border-color:rgba(0,229,255,.2);">
        <div class="adm-stat-label">Всего депозитов</div>
        <div class="adm-stat-val" style="color:var(--neon);">${(adData.totalDeposited||0).toFixed(2)}</div>
        <div class="adm-stat-sub">TON</div>
    </div>
    <div class="adm-stat-card" style="border-color:rgba(255,34,85,.2);">
        <div class="adm-stat-label">Всего выводов</div>
        <div class="adm-stat-val" style="color:#ff2255;">${(adData.totalWithdrawn||0).toFixed(2)}</div>
        <div class="adm-stat-sub">TON</div>
    </div>
</div>
<div class="adm-block" style="text-align:center;padding:10px;">
    <div class="adm-stat-label">Прибыль казино</div>
    <div style="font-size:26px;font-weight:900;color:${profit>=0?'var(--neon)':'#ff2255'};">${profit>=0?'+':''}${profit.toFixed(2)} TON</div>
</div>
<div class="adm-block">
    <div class="adm-block-title">ОЖИДАЮТ ВЫПЛАТЫ (${adData.withdraws.length})</div>
    ${adData.withdraws.length ? adData.withdraws.map(w => `
        <div class="adm-wd-card">
            <div class="adm-wd-top">
                <a href="tg://user?id=${w.userId}" class="adm-wd-user">@${w.username||w.userId}</a>
                <span class="adm-wd-amount">${w.amount} TON</span>
            </div>
            <div class="adm-wd-addr">${w.address}</div>
            <div class="adm-wd-time">${w.time||''}</div>
            <div style="display:flex;gap:6px;margin-top:8px;">
                <button class="adm-approve-btn" onclick="adminW('${w._id}','approve')">Одобрить</button>
                <button class="adm-reject-btn" onclick="adminW('${w._id}','reject')">Отклонить</button>
            </div>
        </div>`).join('') : '<div class="adm-empty">Нет заявок</div>'}
</div>
<div class="adm-block">
    <div class="adm-block-title">ПОСЛЕДНИЕ ДЕПОЗИТЫ</div>
    ${(adData.latestDeposits||[]).map(d=>`
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05);">
            <a href="tg://user?id=${d.userId}" style="color:var(--neon);font-weight:700;font-size:13px;">@${d.username}</a>
            <div style="text-align:right;">
                <div style="font-weight:800;color:#fff;">+${d.amount} TON</div>
                <div style="font-size:10px;color:#555;">${d.time||''}</div>
            </div>
        </div>`).join('') || '<div class="adm-empty">Нет депозитов</div>'}
</div>`;
    }

    // ── ПРОМО ──────────────────────────────────────────────────────
    if(tab === 'promo') {
        c.innerHTML = `
<div class="adm-block">
    <div class="adm-block-title">СОЗДАТЬ ПРОМОКОД</div>
    <div class="adm-rtp-row" style="margin-bottom:8px;">
        <input type="text" id="ad-pr-code" class="input-box" placeholder="Код" style="flex:1;text-transform:uppercase;">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
        <input type="number" id="ad-pr-sum" class="input-box" placeholder="Сумма TON" step="0.5" min="0.1">
        <input type="number" id="ad-pr-lim" class="input-box" placeholder="Лимит" min="1">
    </div>
    <button class="btn" style="background:linear-gradient(135deg,#00e5ff,#0097a7);color:#000;font-weight:900;" onclick="adminPromo()">Создать промокод</button>
</div>
<div class="adm-block">
    <div class="adm-block-title">АКТИВНЫЕ ПРОМОКОДЫ (${(adData.promos||[]).length})</div>
    ${(adData.promos||[]).map(p=>{
        const used=p.usedBy.length, left=p.limit-used;
        const pct=Math.round(used/p.limit*100);
        return `<div class="adm-promo-card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <b style="color:#fff;font-size:15px;letter-spacing:1px;">${p.code}</b>
                <button onclick="adminDelPromo('${p._id}')" class="adm-del-btn">Удалить</button>
            </div>
            <div style="display:flex;gap:12px;font-size:12px;margin-bottom:6px;">
                <span>Сумма: <b style="color:#00e5ff;">${p.amount} TON</b></span>
                <span>Осталось: <b style="color:${left>0?'var(--neon)':'#ff2255'}">${left}/${p.limit}</b></span>
            </div>
            <div class="adm-promo-bar"><div class="adm-promo-fill" style="width:${pct}%"></div></div>
        </div>`;
    }).join('') || '<div class="adm-empty">Нет промокодов</div>'}
</div>`;
    }

    try{if(tg&&tg.BackButton)tg.BackButton.show();}catch(e){}

    // ── НАСТРОЙКИ ──────────────────────────────────────────────────
    if(tab === 'rtp') {
        const rtpGames=[
            {id:'crash',label:'Crash',color:'#ff2255',def:90},
            {id:'mines',label:'Mines',color:'#00ff88',def:90},
            {id:'coinflip',label:'Coinflip',color:'#ffcc00',def:90},
            {id:'spin',label:'Spin',color:'#ff6b00',def:90},
            {id:'mine',label:'Mine',color:'#c87020',def:50},
            {id:'upgrade',label:'Upgrade',color:'#00e5ff',def:85},
            {id:'cases',label:'Case',color:'#ce93d8',def:78},
        ];
        const maintGames=['crash','mines','coinflip','battle','spin','mine','upgrade','case'];
        c.innerHTML = `
<div class="adm-block">
    <div class="adm-block-title">RTP ПО ИГРАМ</div>
    <div class="adm-rtp-grid">
        ${rtpGames.map(g=>`<div class="adm-rtp-row">
            <div class="adm-rtp-label" style="color:${g.color}">${g.label}</div>
            <input type="number" id="rtp-${g.id}" value="${adData.rtp[g.id]||g.def}" class="input-box adm-rtp-inp">
            <button class="adm-ok-btn" style="border-color:${g.color};color:${g.color}" onclick="adminRTP('${g.id}')">OK</button>
        </div>`).join('')}
    </div>
</div>
<div class="adm-block">
    <div class="adm-block-title">ФИНАНСЫ</div>
    <div class="adm-rtp-row" style="margin-bottom:8px;">
        <div class="adm-rtp-label">Мин. вывод (TON)</div>
        <input type="number" id="min-wd-val" value="${adData.minWithdraw||5}" class="input-box adm-rtp-inp" step="0.5" min="0.5">
        <button class="adm-ok-btn" onclick="adminSetMinWithdraw()">OK</button>
    </div>
    <div class="adm-rtp-row">
        <div class="adm-rtp-label">Вейджер x</div>
        <input type="number" id="wager-mult" value="${adData.wagerMultiplier||2}" class="input-box adm-rtp-inp" step="0.5" min="1">
        <button class="adm-ok-btn" onclick="adminSetWager()">OK</button>
    </div>
    <p style="font-size:10px;color:#555;margin-top:6px;">Промо и выдача от адм. не учитываются в отыгрыше</p>
</div>
<div class="adm-block">
    <div class="adm-block-title">ТЕХ. РАБОТЫ</div>
    <div class="adm-maint-grid">
        ${maintGames.map(g=>`<label class="adm-maint-item">
            <input type="checkbox" ${(adData.maintenance[g]||adData.maintenance[g+'s'])?'checked':''} onchange="adminMaint('${g}',this.checked)">
            <span>${g.charAt(0).toUpperCase()+g.slice(1)}</span>
        </label>`).join('')}
    </div>
</div>
<div class="adm-block">
    <div class="adm-block-title">КЕЙСЫ</div>
    <button class="btn" style="background:linear-gradient(135deg,#ce93d8,#9c27b0);font-weight:900;margin-bottom:0;" onclick="adminShowCaseSettings()">Настройки кейсов</button>
</div>
<div class="adm-block">
    <div class="adm-block-title">ПРОЧЕЕ</div>
    <label class="adm-maint-item" style="margin-bottom:10px;"><input type="checkbox" ${isShowDemo?'checked':''} onchange="adminDemoToggle(this.checked)"><span>Показывать Demo ставки</span></label>
    <button class="btn" style="background:linear-gradient(135deg,#ff6b00,#ffcc00);color:#000;font-weight:900;margin-bottom:8px;" onclick="adminOpenSettingsPanel()">Баннер + Музыка</button>
    <button class="btn" style="background:linear-gradient(135deg,#ce93d8,#6a1b9a);font-weight:900;margin-bottom:8px;" onclick="adminOpenGameAndCaseSettings()">Настройки механик игр</button>
    <button class="btn" style="background:#1a0808;border:1px solid #ff2255;color:#ff2255;" onclick="adminBotBroadcast()">Рассылка в бота</button>
    <textarea id="ad-bot-msg" class="input-box" style="height:48px;font-size:12px;margin-top:8px;" placeholder="Текст рассылки..."></textarea>
    <button class="btn" style="background:#1a0808;border:1px solid #ff2255;color:#ff2255;margin-top:8px;" onclick="adminReset()">Обнулить историю ставок</button>
</div>`;
    }

    // ── ЮЗЕРЫ ─────────────────────────────────────────────────────
    if(tab === 'users') {
        const usersHtml = (adData.users||[]).map(u=>{
            const refCount = Array.isArray(u.referrals) ? u.referrals.length : 0;
            return `
        <div class="adm-user-card" onclick="adminViewUser('${u.id}',1)">
            <div style="position:relative;flex-shrink:0;">
                <img src="${u.photo||'https://cdn-icons-png.flaticon.com/512/149/149071.png'}" class="adm-user-ava">
                ${u.isOnline?'<div class="adm-online-dot"></div>':''}
            </div>
            <div class="adm-user-info">
                <div class="adm-user-name">
                    ${u.username||'Без имени'}
                    ${u.isBlocked?'<span class="adm-badge-ban">БАН</span>':''}
                    ${u.isOnline?'<span class="adm-badge-online">онлайн</span>':''}
                </div>
                <div class="adm-user-bal">${(u.balance||0).toFixed(2)} TON${refCount>0?` · <span style="color:#ce93d8;font-size:10px;">👥 ${refCount}</span>`:''}</div>
            </div>
            <div class="adm-user-arr">›</div>
        </div>`;
        }).join('');
        c.innerHTML = `
<div class="adm-block">
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-bottom:10px;">
        <button class="adm-filt-btn ${currentAdminFilter==='balance'?'adm-filt-active':''}" onclick="searchAdminUsers(adminSearchQuery,'balance')">Баланс</button>
        <button class="adm-filt-btn ${currentAdminFilter==='new'?'adm-filt-active':''}" onclick="searchAdminUsers(adminSearchQuery,'new')">Новые</button>
        <button class="adm-filt-btn ${currentAdminFilter==='banned'?'adm-filt-active':''}" onclick="searchAdminUsers(adminSearchQuery,'banned')">Забан</button>
        <button class="adm-filt-btn adm-filt-online ${currentAdminFilter==='online'?'adm-filt-active adm-filt-online-active':''}" onclick="searchAdminUsers(adminSearchQuery,'online')">Онлайн</button>
        <button class="adm-filt-btn ${currentAdminFilter==='ref'?'adm-filt-active':''}" style="color:#ce93d8;" onclick="loadTopReferrals()">Реф</button>
    </div>
    <input type="text" class="input-box" placeholder="Поиск по ID или нику..." value="${adminSearchQuery}" oninput="searchAdminUsers(this.value)" style="margin-bottom:6px;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:11px;color:#888;">Всего: <b style="color:#fff;">${adData.totalUsers||0}</b></div>
        <div style="font-size:11px;color:#00ff88;font-weight:700;">● Онлайн: ${adData.onlineIds?.length||0}</div>
    </div>
</div>
<div class="adm-block" style="padding:0;">
    ${usersHtml || '<div class="adm-empty" style="padding:20px;">Нет пользователей</div>'}
</div>`;
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


async function adminGiveGift(userId) {
    // Show inline form in admin
    const c = $('admin-content');
    if (!c) return;
    const formId = 'admin-gift-form-'+userId;
    if ($(formId)) { $(formId).remove(); return; }
    const existing = document.getElementById('admin-gift-form-main');
    if (existing) existing.remove();
    const form = document.createElement('div');
    form.id = 'admin-gift-form-main';
    form.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:999999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px);';
    form.innerHTML = `
    <div style="background:#0d0d1e;border:1px solid rgba(255,255,255,.1);border-radius:18px;padding:20px;width:100%;max-width:360px;">
        <div style="font-size:14px;font-weight:800;color:#fff;margin-bottom:16px;">Выдать подарок</div>
        <div style="font-size:11px;color:var(--sub);margin-bottom:6px;font-weight:600;">ССЫЛКА НА ПОДАРОК (t.me/nft/...)</div>
        <input id="ag-url" class="input-box" placeholder="https://t.me/nft/GiftName или пусто" style="margin-bottom:8px;">
        <div style="font-size:11px;color:var(--sub);margin-bottom:6px;font-weight:600;">НАЗВАНИЕ (если нет ссылки)</div>
        <input id="ag-name" class="input-box" placeholder="Название подарка" style="margin-bottom:8px;">
        <div style="font-size:11px;color:var(--sub);margin-bottom:6px;font-weight:600;">URL КАРТИНКИ</div>
        <input id="ag-img" class="input-box" placeholder="https://...jpg (необязательно)" style="margin-bottom:8px;">
        <div style="font-size:11px;color:var(--sub);margin-bottom:6px;font-weight:600;">ЦЕНА (TON)</div>
        <input id="ag-price" class="input-box" type="number" placeholder="0" step="0.1" min="0" style="margin-bottom:16px;">
        <div style="display:flex;gap:8px;">
            <button onclick="document.getElementById('admin-gift-form-main').remove()" style="flex:1;padding:12px;background:#1a1a2e;border:1px solid rgba(255,255,255,.1);color:#aaa;border-radius:10px;cursor:pointer;font-weight:700;">Отмена</button>
            <button onclick="submitAdminGift('${userId}')" style="flex:2;padding:12px;background:linear-gradient(135deg,var(--neon),#00c060);color:#000;border:none;border-radius:10px;cursor:pointer;font-weight:900;">Выдать</button>
        </div>
    </div>`;
    document.body.appendChild(form);
}
async function submitAdminGift(userId) {
    const giftUrl = $('ag-url')?.value?.trim() || '';
    const name = $('ag-name')?.value?.trim() || '';
    const imageUrl = $('ag-img')?.value?.trim() || '';
    const price = parseFloat($('ag-price')?.value) || 0;
    if (!giftUrl && !name) return showToast('Укажи ссылку или название');
    const form = document.getElementById('admin-gift-form-main');
    if (form) { const btn = form.querySelector('button:last-child'); if(btn){btn.disabled=true;btn.innerText='Загрузка...';} }
    const r = await fetch('/api/admin/give_gift', {method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({pass:adminPass, userId, giftUrl, name: name||undefined, imageUrl: imageUrl||undefined, price})});
    const d = await r.json();
    if (form) form.remove();
    if(r.ok) showToast('✅ Подарок выдан: '+d.gift?.name);
    else showToast('❌ '+(d.error||'Ошибка'));
}
async function adminViewGifts() {
    const c = $('admin-content');
    if(!c) return;
    c.innerHTML = '<div style="text-align:center;padding:20px;color:var(--neon);">Загрузка...</div>';
    const r = await fetch('/api/admin/gifts_list', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:adminPass})});
    const d = await r.json();
    const gifts = d.gifts||[];
    c.innerHTML = `<div class="adm-block"><div class="adm-block-title">ПОДАРКИ ПОЛЬЗОВАТЕЛЕЙ (${gifts.length})</div>
    ${gifts.map(g=>`<div style="background:#111;border:1px solid #1a1a1a;border-radius:10px;padding:10px;margin-bottom:8px;display:flex;gap:10px;align-items:center;">
        ${g.imageUrl?`<img src="${g.imageUrl}" style="width:40px;height:40px;border-radius:8px;object-fit:cover;" onerror="this.style.display='none'">`:'<div style="width:40px;height:40px;background:#222;border-radius:8px;display:flex;align-items:center;justify-content:center;">🎁</div>'}
        <div style="flex:1;min-width:0;">
            <div style="font-weight:800;color:#fff;font-size:13px;">${g.name}</div>
            <div style="font-size:11px;color:var(--sub);">@${g.ownerUsername||g.userId} · ${g.price?g.price+' TON':'—'}</div>
            ${g.withdrawRequested?'<div style="font-size:10px;color:#ff2255;font-weight:700;">ЗАЯВКА НА ВЫВОД</div>':''}
        </div>
        <button onclick="adminDeleteGift('${g._id}')" style="background:#2a0808;border:1px solid #ff2255;color:#ff2255;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:11px;">Удалить</button>
    </div>`).join('')||'<div class="adm-empty">Нет подарков</div>'}
    </div>`;
}
async function adminDeleteGift(giftId) {
    if(!confirm('Удалить подарок?')) return;
    const r = await fetch('/api/admin/delete_gift', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:adminPass,giftId})});
    if(r.ok) { showToast('Удалено'); adminViewGifts(); }
    else showToast('Ошибка');
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
    await fetch('/api/admin/set_rtp', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, game, value}) });
    rtpObj[game] = Number(value);
    showToast('RTP сохранен!');
}
async function adminMaint(game, state) {
    await fetch('/api/admin/maintenance', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass, game, state}) }); 
    adData.maintenance[game] = state;
    // Синхронизируем глобальный maintenance для мгновенного эффекта
    maintenance[game] = state;
    showToast('Тех. работы ' + game + ': ' + (state ? 'ВКЛЮЧЕНЫ' : 'ВЫКЛЮЧЕНЫ'));
}
async function adminSetMinWithdraw(){
    const val=parseFloat($('min-wd-val')?.value);if(isNaN(val)||val<0.5)return showToast('Мин 0.5 TON');
    const r=await fetch('/api/admin/set_min_withdraw',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:adminPass,value:val})});
    if(r.ok)showToast('✅ Мин вывод: '+val+' TON');else showToast('Ошибка');
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
    c.innerHTML = '<div class="adm-block" style="text-align:center;padding:20px;color:var(--neon);">Загрузка...</div>';
    try {
        const r = await fetch('/api/admin/game_stats', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass: adminPass}) });
        if (!r.ok) { c.innerHTML = '<div style="color:red;">Ошибка загрузки</div>'; return; }
        const data = await r.json();
        const stats = data.stats;
        const gameNames = { Crash:'Crash', Mines:'Mines', Coinflip:'Coinflip', Battle:'Battle', Spin:'Spin', Mine:'Mine', Upgrade:'Upgrade', Case:'Case' };
        const colors = { Crash:'#ff0055', Mines:'#00ff88', Coinflip:'#ffcc00', Battle:'#8a2be2', Spin:'#ff6b00', Mine:'#c87020', Upgrade:'#00e5ff', Case:'#ce93d8' };
        let totalBet = 0, totalPayout = 0, totalPlays = 0;
        Object.values(stats).forEach(s => { totalBet += s.totalBet; totalPayout += s.totalPayout; totalPlays += s.playCount; });
        const totalProfit = totalBet - totalPayout;
        let html = `
            <div class="adm-block" style="text-align:center;margin-bottom:10px;">
                <div style="font-size:10px;color:#555;margin-bottom:6px;letter-spacing:2px;">ОБЩИЙ ИТОГ</div>
                <div style="font-size:26px;font-weight:900;color:${totalProfit>=0?'var(--neon)':'#ff2255'};">${totalProfit>=0?'+':''}${totalProfit.toFixed(2)} TON</div>
                <div style="font-size:11px;color:#555;margin-top:6px;">Ставок: ${totalPlays} | Ввод: ${totalBet.toFixed(2)} | Выплаты: ${totalPayout.toFixed(2)}</div>
            </div>`;
        for (const [game, s] of Object.entries(stats)) {
            const profit = s.totalBet - s.totalPayout;
            html += `
            <div class="adm-block" style="margin-bottom:6px;border-left:3px solid ${colors[game]||'#888'};">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <div style="font-weight:900;color:${colors[game]||'#fff'};font-size:14px;">${gameNames[game]||game}</div>
                        <div style="font-size:11px;color:#555;margin-top:3px;">Игр: ${s.playCount} | Ввод: ${s.totalBet.toFixed(2)} | Вывод: ${s.totalPayout.toFixed(2)}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:16px;font-weight:900;color:${profit>=0?'var(--neon)':'#ff2255'};">${profit>=0?'+':''}${profit.toFixed(2)}</div>
                        <div style="display:flex;gap:4px;margin-top:6px;">
                        <button class="adm-ok-btn" style="border-color:rgba(0,229,255,.3);font-size:10px;padding:4px 8px;" onclick="adminShowGameUsers('${game}')">👥</button>
                        <button class="adm-del-btn" style="font-size:10px;padding:4px 8px;" onclick="adminResetGameStats('${game}')">Сброс</button>
                        </div>
                    </div>
                </div>
            </div>`;
        }
        html += `<button class="btn" style="background:rgba(255,0,0,.15);border:1px solid rgba(255,0,0,.3);color:#ff2255;margin-top:8px;" onclick="adminResetGameStats('')">Сбросить всю статистику</button>`;
        html += `<button class="btn" style="margin-top:8px;background:linear-gradient(135deg,#ce93d8,#9c27b0);color:#000;font-weight:800;padding:10px;" onclick="adminShowCaseStats()">Статистика кейсов</button>`;
        c.innerHTML = html;
    } catch (e) {
        c.innerHTML = '<div style="color:red;">Сбой сети</div>';
    }
}


async function loadBanner(){
    const bw=$('banner-widget');if(!bw)return;bw.style.display='none';
    try{const r=await fetch('/api/banner');if(!r.ok)return;
        const d=await r.json();if(!d.banner||!d.banner.active)return;
        const b=d.banner;
        if(b.imageUrl){bw.style.display='block';bw.innerHTML=b.linkUrl?'<a href="'+b.linkUrl+'" target="_blank" style="display:block;height:100%;"><img src="'+b.imageUrl+'" style="width:100%;height:100%;object-fit:cover;border-radius:10px;"><\/a>':'<img src="'+b.imageUrl+'" style="width:100%;height:100%;object-fit:cover;border-radius:10px;">';}
        else if(b.text){bw.style.display='flex';bw.style.alignItems='center';bw.style.justifyContent='center';bw.innerHTML='<span style="color:#fff;font-size:13px;padding:0 14px;">'+b.text+'<\/span>';}
    }catch(e){}
}
let casinoAudio=null;let _soundBlobUrl=null;
async function loadCasinoSound(){
    try{const r=await fetch('/api/casino_sound');if(!r.ok)return;
        const d=await r.json();if(!d.sound||!d.sound.enabled)return;
        const su=d.sound.soundUrl;if(!su)return;
        if(casinoAudio){casinoAudio.pause();casinoAudio=null;}
        if(_soundBlobUrl){URL.revokeObjectURL(_soundBlobUrl);_soundBlobUrl=null;}
        const vol=Math.min(1,Math.max(0,parseFloat(d.sound.volume)||0.3));
        let audioUrl=su;
        if(su.startsWith('data:audio')){
            try{const arr=su.split(',');const mime=arr[0].match(/:(.*?);/)[1];
                const bstr=atob(arr[1]);let n=bstr.length;const u8=new Uint8Array(n);
                while(n--)u8[n]=bstr.charCodeAt(n);
                const blob=new Blob([u8],{type:mime});_soundBlobUrl=URL.createObjectURL(blob);audioUrl=_soundBlobUrl;
            }catch(e){audioUrl=su;}
        }
        casinoAudio=new Audio(audioUrl);casinoAudio.loop=true;casinoAudio.volume=vol;
        const tryPlay=()=>{if(casinoAudio)casinoAudio.play().catch(()=>{});};
        tryPlay();
        document.addEventListener('click',tryPlay,{once:true,passive:true});
        document.addEventListener('touchstart',tryPlay,{once:true,passive:true});
    }catch(e){}
}
async function adminSaveBanner(){
    const st=$('bnr-st');if(st){st.innerText='Сохраняем...';st.style.color='#aaa';}
    let imageUrl=($('bnr-img')?.value||'').trim();
    // Если выбран файл с устройства — конвертируем в base64
    if(_pendingBannerBlob){
        if(_pendingBannerBlob.size>5*1024*1024){if(st){st.innerText='❌ Файл >5MB!';st.style.color='#ff2255';}return;}
        try{imageUrl=await new Promise((res,rej)=>{const rd=new FileReader();rd.onload=e=>res(e.target.result);rd.onerror=rej;rd.readAsDataURL(_pendingBannerBlob);});}
        catch(e){if(st){st.innerText='❌ Ошибка чтения файла';st.style.color='#ff2255';}return;}
    }
    const body={imageUrl,linkUrl:($('bnr-link')?.value||'').trim(),text:($('bnr-text')?.value||'').trim(),active:$('bnr-active')?.checked!==false};
    try{const r=await fetch('/api/admin/set_banner',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:adminPass,...body})});
        const d=await r.json();if(st){st.innerText=r.ok?'✅ Сохранено!':'❌ '+(d.error||'Ошибка');st.style.color=r.ok?'#00ff88':'#ff2255';}
        if(r.ok){_pendingBannerBlob=null;loadBanner();}
    }catch(e){if(st){st.innerText='❌ Ошибка';st.style.color='#ff2255';}}
}
async function adminClearBanner(){
    try{await fetch('/api/admin/set_banner',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:adminPass,imageUrl:'',linkUrl:'',text:'',active:false})});
        loadBanner();const st=$('bnr-st');if(st){st.innerText='Скрыт';st.style.color='#aaa';}
    }catch(e){}
}
let _pendingSoundBlob=null;
let _pendingBannerBlob=null;
function bnrFileLoad(input){
    const file=input.files[0];if(!file)return;
    const maxMB=5;
    if(file.size>maxMB*1024*1024){showToast('Файл >'+maxMB+'MB! Используй URL.');return;}
    const fn=$('bnr-fname');if(fn)fn.innerText='📄 '+file.name+' ('+Math.round(file.size/1024)+'KB)';
    _pendingBannerBlob=file;
    if($('bnr-img'))$('bnr-img').value='';
    showToast('Картинка выбрана. Нажми Сохранить.');
}
function sndFileLoad(input){
    const file=input.files[0];if(!file)return;
    if(file.size>8*1024*1024){showToast('Файл >8MB! Используй URL.');return;}
    const fn=$('snd-fname');if(fn)fn.innerText='📄 '+file.name+' ('+Math.round(file.size/1024)+'KB)';
    _pendingSoundBlob=file;if($('snd-url'))$('snd-url').value='';
    showToast('Файл выбран. Нажми Сохранить.');
}
async function adminSaveSound(){
    const st=$('snd-st');if(st){st.innerText='Сохраняем...';st.style.color='#aaa';}
    const vol=parseFloat($('snd-num')?.value||0.3);const enabled=$('snd-on')?.checked!==false;
    let soundUrl='';
    if(_pendingSoundBlob){
        if(_pendingSoundBlob.size>8*1024*1024){if(st){st.innerText='❌ Файл >8MB! Используй URL.';st.style.color='#ff2255';}return;}
        try{soundUrl=await new Promise((res,rej)=>{const rd=new FileReader();rd.onload=e=>res(e.target.result);rd.onerror=rej;rd.readAsDataURL(_pendingSoundBlob);});}
        catch(e){if(st){st.innerText='❌ Ошибка чтения файла';st.style.color='#ff2255';}return;}
    }else{soundUrl=($('snd-url')?.value.trim()||'');}
    if(!soundUrl&&enabled){if(st){st.innerText='❌ Укажи файл или URL';st.style.color='#ff2255';}return;}
    try{const r=await fetch('/api/admin/set_casino_sound',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:adminPass,soundUrl,volume:vol,enabled})});
        const d=await r.json();if(st){st.innerText=r.ok?'✅ Сохранено!':'❌ '+(d.error||'Ошибка');st.style.color=r.ok?'#00ff88':'#ff2255';}
        if(r.ok){_pendingSoundBlob=null;loadCasinoSound();}
    }catch(e){if(st){st.innerText='❌ '+e.message;st.style.color='#ff2255';}}
}
function adminOpenSettingsPanel(){
    const c=$('admin-content');if(!c)return;
    c.innerHTML=`<div>
<h4 style="color:#ffcc00;margin:0 0 8px;">📢 Баннер</h4>
<div style="background:#111;border-radius:10px;padding:12px;border:1px solid #222;margin-bottom:14px;">
<p style="color:#888;font-size:11px;margin:0 0 8px;">URL картинки в разделе Игры. Статический — скроллируется вместе.</p>
<label style="display:flex;align-items:center;gap:8px;background:#1a1a2e;border:1px dashed #ffcc00;border-radius:8px;padding:10px;cursor:pointer;color:#ffcc00;font-size:13px;margin-bottom:6px;">
📷 Загрузить фото с устройства<input type="file" id="bnr-file" accept="image/*" onchange="bnrFileLoad(this)" style="display:none;"></label>
<div id="bnr-fname" style="color:#888;font-size:11px;margin-bottom:6px;min-height:14px;"></div>
<label style="color:#aaa;font-size:11px;">ИЛИ вставьте URL картинки</label><input id="bnr-img" class="input-box" placeholder="https://...jpg" style="margin-bottom:6px;">
<label style="color:#aaa;font-size:11px;">Ссылка при нажатии</label><input id="bnr-link" class="input-box" placeholder="https://..." style="margin-bottom:6px;">
<label style="color:#aaa;font-size:11px;">Текст (если нет картинки)</label><input id="bnr-text" class="input-box" placeholder="🎁 Акция!" style="margin-bottom:8px;">
<label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#ccc;margin-bottom:10px;"><input type="checkbox" id="bnr-active" checked style="width:16px;height:16px;"> Показывать</label>
<div style="display:flex;gap:8px;"><button class="btn" style="flex:1;background:linear-gradient(135deg,#ffcc00,#ff8c00);color:#000;font-weight:800;" onclick="adminSaveBanner()">✅ Сохранить</button>
<button class="btn" style="flex:1;background:#2a0808;border:1px solid #ff2255;color:#ff2255;" onclick="adminClearBanner()">🗑 Скрыть</button></div>
<div id="bnr-st" style="margin-top:8px;font-size:12px;text-align:center;min-height:16px;"></div>
</div>
<h4 style="color:#00ff88;margin:0 0 8px;">🎵 Музыка казино</h4>
<div style="background:#111;border-radius:10px;padding:12px;border:1px solid #222;margin-bottom:14px;">
<p style="color:#888;font-size:11px;margin:0 0 8px;">Играет у всех. Макс файл: 8MB.</p>
<label style="display:flex;align-items:center;gap:8px;background:#1a1a2e;border:1px dashed #0097a7;border-radius:8px;padding:10px;cursor:pointer;color:#00e5ff;font-size:13px;margin-bottom:6px;">
📁 Выбрать mp3 с телефона<input type="file" id="snd-file" accept="audio/*" onchange="sndFileLoad(this)" style="display:none;"></label>
<div id="snd-fname" style="color:#888;font-size:11px;margin-bottom:8px;min-height:14px;"></div>
<label style="color:#aaa;font-size:11px;">ИЛИ URL (mp3/ogg)</label><input id="snd-url" class="input-box" placeholder="https://...mp3" style="margin-bottom:8px;">
<label style="color:#aaa;font-size:11px;">Громкость</label>
<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><input type="range" id="snd-rng" min="0" max="1" step="0.05" value="0.3" oninput="$('snd-num').value=parseFloat(this.value).toFixed(2)" style="flex:1;">
<input type="number" id="snd-num" class="input-box" step="0.05" min="0" max="1" value="0.30" oninput="$('snd-rng').value=this.value" style="width:60px;"></div>
<label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#ccc;margin-bottom:10px;"><input type="checkbox" id="snd-on" checked style="width:16px;height:16px;"> Включить</label>
<button class="btn" style="background:linear-gradient(135deg,#00ff88,#00c060);color:#000;font-weight:800;" onclick="adminSaveSound()">✅ Сохранить звук</button>
<div id="snd-st" style="margin-top:8px;font-size:12px;text-align:center;min-height:16px;"></div>
</div>
<h4 style="color:#ce93d8;margin:0 0 8px;">⚙️ Настройки механик игр</h4>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
${['crash','mines','coinflip','spin','mine','upgrade','battle'].map(g=>'<button class="btn" style="background:#0d0d1e;border:1px solid rgba(206,147,216,.2);color:#ce93d8;padding:10px;font-size:13px;font-weight:700;border-radius:10px;" onclick="adminShowGameSettings(\''+g+'\')">'+'⚙ '+g+'<\/button>').join('')}
</div>
</div>`;
    fetch('/api/banner').then(r=>r.json()).then(d=>{if(!d.banner)return;const b=d.banner;
        if($('bnr-img'))$('bnr-img').value=b.imageUrl||'';if($('bnr-link'))$('bnr-link').value=b.linkUrl||'';
        if($('bnr-text'))$('bnr-text').value=b.text||'';if($('bnr-active'))$('bnr-active').checked=b.active!==false;
    }).catch(()=>{});
    fetch('/api/casino_sound').then(r=>r.json()).then(d=>{if(!d.sound)return;const snd=d.sound;
        if($('snd-url'))$('snd-url').value=(!snd.soundUrl||snd.soundUrl.startsWith('data:'))?'':snd.soundUrl;
        const v=snd.volume||0.3;if($('snd-rng'))$('snd-rng').value=v;if($('snd-num'))$('snd-num').value=v.toFixed(2);
        if($('snd-on'))$('snd-on').checked=snd.enabled!==false;
    }).catch(()=>{});
}

function adminOpenGameAndCaseSettings() {
    const c=$('admin-content');if(!c)return;
    const games=['crash','mines','coinflip','spin','mine','upgrade','battle'];
    let html=`<div>
<div class="adm-block-title" style="margin-bottom:12px;">НАСТРОЙКИ МЕХАНИК ИГР</div>
<div class="adm-maint-grid">
${games.map(g=>`<button onclick="adminShowGameSettings('${g}')" style="background:#0d0d1e;border:1px solid rgba(206,147,216,.25);color:#ce93d8;padding:12px 6px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;-webkit-tap-highlight-color:transparent;">${g.charAt(0).toUpperCase()+g.slice(1)}</button>`).join('')}
</div>
<div class="adm-block-title" style="margin:14px 0 10px;">НАСТРОЙКИ КЕЙСОВ</div>
<button onclick="adminShowCaseSettings()" style="width:100%;background:linear-gradient(135deg,#ce93d8,#9c27b0);color:#000;padding:12px;border-radius:10px;font-weight:900;border:none;cursor:pointer;font-size:14px;">Открыть настройки кейсов</button>
</div>`;
    c.innerHTML=html;
}
async function adminShowGameSettings(game){
    const c=$('admin-content');if(!c)return;
    let settings={};
    try{const r=await fetch('/api/admin/get_game_settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:adminPass})});if(r.ok){const d=await r.json();settings=d.settings||{};}}catch(e){}
    const GS={crash:[{k:'crash_house_edge',l:'💰 Преимущество казино (%)',d:5,min:1,max:30},{k:'crash_max_mult',l:'🔝 Макс мульт',d:1000,min:10,max:9999}],
        coinflip:[{k:'coinflip_win_mult',l:'✅ Мульт победы',d:1.9,min:1.1,max:2.5,ss:0.01},{k:'coinflip_max_bet',l:'💰 Макс ставка',d:25,min:1,max:500}],
        spin:[{k:'spin_x3',l:'X×3',d:2.5,min:0.5,max:20,ss:0.1},{k:'spin_x4',l:'X×4',d:6,min:1,max:50,ss:0.1},{k:'spin_x5',l:'X×5',d:12,min:2,max:100,ss:0.1},{k:'spin_l3',l:'L×3',d:0.9,min:0.1,max:10,ss:0.1},{k:'spin_l4',l:'L×4',d:2.2,min:0.5,max:20,ss:0.1},{k:'spin_l5',l:'L×5',d:4.5,min:1,max:40,ss:0.1}],
        mine:[{k:'mine_tnt_pct',l:'💣 Шанс TNT (%)',d:3,min:0,max:30,ss:0.5},{k:'mine_book_pct',l:'📚 Шанс книги (%)',d:2,min:0,max:20,ss:0.5},{k:'mine_chest_pct',l:'📦 Шанс сундука (%)',d:0.5,min:0,max:10,ss:0.1},{k:'mine_grass',l:'🌿 Мульт: трава',d:0.01,min:0,max:1,ss:0.01},{k:'mine_dirt',l:'🪨 Земля',d:0.03,min:0,max:1,ss:0.01},{k:'mine_stone',l:'⚙️ Камень',d:0.06,min:0,max:1,ss:0.01},{k:'mine_redstone',l:'🔴 Редстоун',d:0.09,min:0,max:2,ss:0.01},{k:'mine_gold',l:'🟡 Золото',d:0.12,min:0,max:2,ss:0.01},{k:'mine_diamond',l:'💎 Алмаз',d:0.16,min:0,max:3,ss:0.01},{k:'mine_obsidian',l:'🟣 Обсидиан',d:0.20,min:0,max:3,ss:0.01},{k:'mine_dur_wood',l:'🪓 Прочн: деревянная',d:1,min:1,max:10},{k:'mine_dur_stone',l:'🪓 Прочн: каменная',d:2,min:1,max:15},{k:'mine_dur_iron',l:'🪓 Прочн: железная',d:3,min:1,max:20},{k:'mine_dur_gold',l:'🪓 Прочн: золотая',d:4,min:1,max:25},{k:'mine_dur_diamond',l:'🪓 Прочн: алмазная',d:5,min:1,max:30}],
        upgrade:[{k:'upg_max_chance',l:'🎯 Макс шанс (%)',d:90,min:10,max:99},{k:'upg_max_bet',l:'💰 Макс ставка',d:25,min:1,max:500}],
        battle:[{k:'btl_fee_pct',l:'💸 Комиссия (%)',d:5,min:0,max:20},{k:'btl_min',l:'💰 Мин ставка',d:0.5,min:0.1,max:10,ss:0.1},{k:'btl_max',l:'💰 Макс ставка',d:150,min:1,max:1000}],
        mines:[{k:'mines_max_bombs',l:'💣 Макс бомб',d:24,min:1,max:24}],cases:[{k:'cases_max_win',l:'🎁 Макс выплата x',d:10,min:1,max:100}]};
    const icons={crash:'🚀',mines:'💣',coinflip:'🪙',spin:'🎰',mine:'⛏️',upgrade:'⬆️',battle:'⚔️',cases:'🎁'};
    const fs=GS[game]||[];
    let html=`<div><div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #222;">
<button class="adm-back-btn" onclick="adminOpenGameAndCaseSettings()">← Назад</button>
<b style="color:#fff;font-size:14px;">${icons[game]||'🎮'} ${game}</b></div>`;
    if(!fs.length)html+='<p style="color:#888;text-align:center;">Нет параметров</p>';
    else{html+='<p style="color:#888;font-size:11px;margin-bottom:10px;">RTP — в RTP вкладке. Здесь механика.</p>';
        fs.forEach(f=>{const v=settings['game_'+f.k]!==undefined?settings['game_'+f.k]:f.d;
            html+=`<div style="margin-bottom:8px;"><label style="color:#ccc;font-size:12px;display:block;margin-bottom:2px;">${f.l}</label>
<div style="display:flex;gap:6px;"><input type="number" id="gs_${f.k}" class="input-box" style="flex:1;" value="${v}" min="${f.min!==undefined?f.min:''}" max="${f.max!==undefined?f.max:''}" step="${f.ss||1}">
<button onclick="adminSaveGS('${f.k}')" style="background:#0d2a33;border:1px solid #00e5ff;color:#00e5ff;padding:7px 10px;border-radius:8px;cursor:pointer;font-size:12px;">💾</button></div></div>`;});}
    html+='</div>';c.innerHTML=html;
}
async function adminSaveGS(key){const el=document.getElementById('gs_'+key);if(!el)return;
    const val=parseFloat(el.value)||0;
    try{const r=await fetch('/api/admin/set_game_setting',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:adminPass,key:'game_'+key,value:val})});
        const d=await r.json();showToast(r.ok?'✅ '+key+' = '+val:'❌ '+(d.error||'?'));
        if(r.ok) loadGameSettings(); // Обновляем настройки механик на клиенте
    }catch(e){showToast('❌ Ошибка');}
}
async function adminShowGameUsers(game){
    const c=$('admin-content');if(!c)return;
    const icons={crash:'🚀',mines:'💣',coinflip:'🪙',spin:'🎰',mine:'⛏️',upgrade:'⬆️',battle:'⚔️',cases:'🎁'};
    c.innerHTML='<div style="text-align:center;padding:20px;color:var(--neon);">Загрузка...</div>';
    try{const r=await fetch('/api/admin/game_user_stats',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:adminPass,game})});
        const data=await r.json();if(!r.ok){c.innerHTML='<div style="color:red;">'+(data.error||'Ошибка')+'</div>';return;}
        const users=data.users||[];
        let html=`<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #222;">
<button class="btn" style="padding:6px 12px;width:auto;background:#1a1a2e;border:1px solid #00e5ff44;color:#00e5ff;font-size:12px;" onclick="loadAdminGameStats()">← Назад</button>
<b style="color:#fff;font-size:14px;">${icons[game]||'🎮'} ${game} — игроки</b></div>`;
        if(!users.length)html+='<div style="color:#888;text-align:center;padding:20px;">Нет данных</div>';
        users.forEach(u=>{const pColor=u.profit<=0?'#00ff88':'#ff2255';
            html+=`<div style="background:#111;border:1px solid #1a1a1a;border-radius:10px;padding:12px;margin-bottom:8px;">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
<div><b style="color:#fff;">${u.username}</b><br><span style="color:#555;font-size:10px;">${u.userId}</span></div>
<div style="font-size:16px;font-weight:900;color:${pColor};">${u.profit>=0?'+':''}${u.profit} TON</div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:8px;">
<div style="background:#0a0a0a;border-radius:6px;padding:6px;text-align:center;"><div style="color:#888;font-size:10px;">Игр</div><b>${u.playCount}</b></div>
<div style="background:#0a0a0a;border-radius:6px;padding:6px;text-align:center;"><div style="color:#888;font-size:10px;">Ставки</div><b>${u.totalBet}T</b></div>
<div style="background:#0a0a0a;border-radius:6px;padding:6px;text-align:center;"><div style="color:#888;font-size:10px;">Выплаты</div><b>${u.totalPayout}T</b></div>
</div>
<button style="width:100%;background:#2a0808;border:1px solid #ff2255;color:#ff2255;border-radius:8px;padding:7px;cursor:pointer;font-size:12px;" onclick="adminRemoveUserGame('${game}','${u.userId}',this)">🗑️ Очистить историю</button>
</div>`;});
        c.innerHTML=html;
    }catch(e){c.innerHTML='<div style="color:red;">Ошибка</div>';}
}
async function adminRemoveUserGame(game,userId,btn){
    if(!confirm('Удалить стату '+userId+' по '+game+'?'))return;
    btn.disabled=true;btn.innerText='...';
    try{const r=await fetch('/api/admin/remove_user_game_stats',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:adminPass,game,userId})});
        const d=await r.json();if(r.ok){btn.closest('[style]').style.opacity='0.4';btn.innerText='✓ Удалено ('+d.deleted+')';}
        else{btn.innerText='Ошибка';btn.disabled=false;}
    }catch(e){btn.innerText='Ошибка';btn.disabled=false;}
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

const SPIN_SYMS_ANIM=['N','L','X','L','G','L','X','N','L','L','X','L'];

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

let _spinBetPrev = 0;
function initSpinPage() {
    if (!$('spin-grid')) return;
    buildSpinGrid();
    updateSpinProgress(spinProgressValue);
    updateSpinUI();
    // Bet change listener for bonus reset confirmation
    const spBetInput = $('sp-bet');
    if (spBetInput && !spBetInput._hasChangeListener) {
        _spinBetPrev = parseFloat(spBetInput.value) || 0;
        spBetInput.addEventListener('change', () => {
            const newVal = parseFloat(spBetInput.value) || 0;
            if (newVal !== _spinBetPrev && spinProgressValue > 0) {
                if (!confirm('Вы уверены? Прогресс бонуса будет сброшен!')) {
                    spBetInput.value = _spinBetPrev;
                    return;
                }
                spinProgressValue = 0;
                updateSpinProgress(0);
            }
            _spinBetPrev = newVal;
        });
        spBetInput._hasChangeListener = true;
    }
    // Pre-fill idle grid with nice pattern
    const symbols=['L','N','X','L','G','X','N','L','X','L','L','X','L','N','L'];
    for(let r=0;r<3;r++){for(let c=0;c<5;c++){const cell=$(`sc-${r}-${c}`);if(cell){const sym=symbols[r*5+c]||'L';cell.className=`spin-cell sym-${sym}`;cell.innerText=sym==='G'?'🎁':sym;}}}
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
// ══════════════════════════════════════════
//  MINE GAME v3 — clean, minimal, beautiful
// ══════════════════════════════════════════

const MINE_BLOCK_CLASS = {
    grass:'grass-blk', dirt:'dirt-blk', stone:'stone-blk',
    redstone:'redstone-blk', gold_block:'gold-blk', gold:'gold-blk',
    diamond_block:'diamond-blk', diamond:'diamond-blk',
    obsidian:'obsidian-blk', tnt:'tnt-blk', book:'book-blk', unknown:'unknown-blk'
};
const MC_ROWS = 6, MC_COLS = 5, INV_ROWS = 3, INV_COLS = 5;

let mineIsSpinning    = false;
let mineBookCount     = 0;
let mineAutoRemaining = 0;
let minePersistGrid   = null;
let mineLastBet       = 1;
let mineRunningTotal  = 0;
let mineIsActive      = false;
let grid_current      = null; // текущий grid для TNT 2x2
const _pickaxeEls     = new Set();

// ── Прочность из adminSettings ──────────────────────────────
function getPickDur(type) {
    const g = gameSettings || {};
    return {
        wooden:  Number(g['game_mine_dur_wood'])    || 1,
        stone:   Number(g['game_mine_dur_stone'])   || 2,
        iron:    Number(g['game_mine_dur_iron'])    || 3,
        golden:  Number(g['game_mine_dur_gold'])    || 4,
        diamond: Number(g['game_mine_dur_diamond']) || 5,
    }[type] || 1;
}

function getPickaxeImg(t) { return `/sprites/pick_${t||'wooden'}.png`; }

// ── RAF-анимация одного свойства ────────────────────────────
function _anim(el, prop, from, to, dur, ease, cb) {
    let t0 = null;
    const run = ts => {
        if (!t0) t0 = ts;
        const t = Math.min((ts - t0) / dur, 1);
        el.style[prop] = (from + (to - from) * ease(t)) + 'px';
        if (t < 1) requestAnimationFrame(run);
        else if (cb) cb();
    };
    requestAnimationFrame(run);
}
const easeOut  = t => 1 - Math.pow(1 - t, 3);
const easeIn   = t => t * t;
const easeBounce = t => {
    // небольшой отскок при приземлении
    if (t < 0.75) return easeIn(t / 0.75);
    const s = (t - 0.75) / 0.25;
    return 1 + Math.sin(s * Math.PI) * 0.09;
};

// ── Убить все летящие элементы ──────────────────────────────
function killAllPickaxes() {
    _pickaxeEls.forEach(el => { try { el.remove(); } catch(e){} });
    _pickaxeEls.clear();
    mineIsActive = false;
}

// ── Полоса прочности ────────────────────────────────────────
let _durMax = 0, _durLeft = 0;
function initDurabilityBar(type, count, override) {
    const dur = override || getPickDur(type) * (count || 1);
    _durMax = dur; _durLeft = dur;
    const wrap = $('mine-dur-wrap'), bar = $('mine-dur-bar'), cnt = $('mine-dur-count');
    if (wrap) wrap.style.display = 'flex';
    if (bar)  { bar.style.width = '100%'; bar.className = 'mine-dur-bar-inner'; }
    if (cnt)  cnt.textContent = `${dur} / ${dur}`;
}
function consumeDurability(hits) {
    if (_durMax <= 0) return;
    _durLeft = Math.max(0, _durLeft - hits);
    const pct = _durLeft / _durMax;
    const bar = $('mine-dur-bar'), cnt = $('mine-dur-count');
    if (bar) { bar.style.width = (pct * 100).toFixed(1) + '%'; bar.className = 'mine-dur-bar-inner' + (pct < 0.25 ? ' dur-crit' : pct < 0.55 ? ' dur-low' : ''); }
    if (cnt)  cnt.textContent = `${_durLeft} / ${_durMax}`;
}
function hideDurabilityBar() { const w = $('mine-dur-wrap'); if (w) w.style.display = 'none'; }

// ── Счётчик с анимацией ─────────────────────────────────────
function animateCounter(el, from, to, ms) {
    if (!el) return;
    const t0 = performance.now(), d = to - from;
    const run = now => {
        const p = Math.min((now - t0) / ms, 1), e = 1 - Math.pow(1 - p, 3);
        el.innerText = (from + d * e).toFixed(2);
        if (p < 1) requestAnimationFrame(run);
    };
    requestAnimationFrame(run);
}

// ── Частицы разбивки ────────────────────────────────────────
const _PART_CLR = {
    grass:['#4a8c2a','#6cb040','#3a7020'], dirt:['#8b6040','#a07050','#6b4a30'],
    stone:['#777','#999','#666'], redstone:['#990000','#dd2020','#ff5555'],
    gold_block:['#c8a000','#ffe060','#deb800'], gold:['#c8a000','#ffe060','#deb800'],
    diamond_block:['#006b9a','#00e4ff','#4acce0'], diamond:['#006b9a','#00e4ff','#4acce0'],
    obsidian:['#0e0420','#6030a0','#3010a0'],
    tnt:['#cc1010','#ff4040','#ffaa00'], book:['#4c1090','#ffd700','#c080ff'],
};
function spawnBreakParticles(blockEl, type, count) {
    if (!blockEl) return;
    const rect = blockEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const clr = _PART_CLR[type] || _PART_CLR.stone;
    const n = count || 10;
    for (let i = 0; i < n; i++) {
        const p = document.createElement('div');
        const angle = (i / n) * Math.PI * 2 + Math.random() * 0.4;
        const spd = 28 + Math.random() * 52;
        const vx = Math.cos(angle) * spd, vy = Math.sin(angle) * spd - 18;
        const sz = 2 + Math.random() * 3;
        p.style.cssText = `position:fixed;width:${sz}px;height:${sz}px;background:${clr[i%clr.length]};left:${cx}px;top:${cy}px;border-radius:1px;z-index:9800;pointer-events:none;`;
        document.body.appendChild(p);
        let ms = 0;
        const id = setInterval(() => {
            ms += 16; const t = ms / 1000;
            p.style.transform = `translate(${vx*t}px,${vy*t+280*t*t}px) rotate(${ms*0.3}deg)`;
            p.style.opacity = String(Math.max(0, 1 - ms / 460));
            if (ms >= 460) { clearInterval(id); p.remove(); }
        }, 16);
    }
}

// ── Вспышка при ударе (лёгкая) ─────────────────────────────
function flashBlock(blkEl) {
    if (!blkEl) return;
    blkEl.style.filter = 'brightness(2)';
    setTimeout(() => { blkEl.style.filter = ''; }, 55);
}

// ── Разрушение блока ────────────────────────────────────────
function doBreakBlock(blkEl, blk, onFullyGone) {
    if (!blkEl) { if (onFullyGone) onFullyGone(); return; }
    blkEl.classList.remove('cracking-1', 'cracking-2', 'cracking-3', 'crack-hit');
    // Показываем цвет блока перед исчезновением
    blkEl.className = `mc-blk ${MINE_BLOCK_CLASS[blk.type] || 'stone-blk'}`;
    if (blk.win > 0) {
        // Попап +X.XX над блоком
        const rect = blkEl.getBoundingClientRect();
        const pop = document.createElement('div');
        pop.className = 'block-win-popup';
        pop.textContent = `+${blk.win.toFixed(2)}`;
        pop.style.left = (rect.left + rect.width / 2) + 'px';
        pop.style.top  = rect.top + 'px';
        document.body.appendChild(pop);
        pop.addEventListener('animationend', () => pop.remove());
        // Обновляем счётчик
        const prev = mineRunningTotal;
        mineRunningTotal = Number((mineRunningTotal + blk.win).toFixed(3));
        const rt = $('mine-running-total');
        if (rt) { rt.classList.add('has-win'); animateCounter(rt, prev, mineRunningTotal, 420); }
    }
    spawnBreakParticles(blkEl, blk.type, 11);
    playSound('break');
    setTimeout(() => {
        blkEl.style.transition = 'transform 0.16s ease-in, opacity 0.12s';
        blkEl.style.transform  = 'scale(0.05)';
        blkEl.style.opacity    = '0';
        blkEl.dataset.revealed = '1';
        setTimeout(() => {
            blkEl.style.visibility = 'hidden';
            blkEl.style.transform  = '';
            blkEl.style.opacity    = '';
            if (onFullyGone) onFullyGone();
        }, 180);
    }, 100);
}

// ── ВОРКЕР-КИРКА ─────────────────────────────────────────────
// Каждая кирка — отдельный элемент, отдельный воркер.
// Несколько кирок в одном столбце падают с задержкой (stagger).
// Нет дедупликации — каждая кирка работает независимо.
function spawnPickaxeWorker(blockQueue, pickType, startDelay, onAllDone, onBlockBroken, maxDur) {
    if (!blockQueue.length) { if (onAllDone) setTimeout(onAllDone, startDelay); return; }

    // Создаём элемент кирки — позиционируется над первым блоком
    const pEl = document.createElement('img');
    pEl.src = getPickaxeImg(pickType);
    pEl.style.cssText = 'position:fixed;width:24px;height:24px;z-index:99999;pointer-events:none;image-rendering:pixelated;opacity:0;transform:translate(-50%,-100%) rotate(0deg);transform-origin:bottom center;transition:none;';
    document.body.appendChild(pEl);
    _pickaxeEls.add(pEl);

    const removePick = () => { _pickaxeEls.delete(pEl); if (pEl.parentNode) pEl.remove(); };

    let qi = 0;
    let remainDur = maxDur > 0 ? maxDur : 999;

    // Уничтожить кирку: просто исчезает на месте
    function breakPick(cb) {
        pEl.style.transition = 'opacity 0.12s ease';
        pEl.style.opacity = '0';
        setTimeout(() => { removePick(); if (cb) cb(); }, 130);
    }

    function processNext() {
        if (!mineIsActive) { removePick(); return; }
        if (qi >= blockQueue.length || remainDur <= 0) {
            breakPick(() => { if (onAllDone) onAllDone(); });
            return;
        }

        const blk = blockQueue[qi];
        const blkEl = $(`mc-blk-${blk.r}-${blk.c}`);
        if (!blkEl || blkEl.dataset.revealed === '1') { qi++; setTimeout(processNext, 20); return; }

        const tntDmg = parseInt(blkEl.dataset.tntDmg || '0');
        const adjHits = Math.max(1, blk.hits - tntDmg);
        const hitsCanDo = Math.min(adjHits, remainDur);
        const willBreak = hitsCanDo >= adjHits;

        const rect = blkEl.getBoundingClientRect();
        if (rect.width === 0) { setTimeout(processNext, 80); return; }

        const bx     = rect.left + rect.width / 2;
        const hoverY = rect.top - 6;
        const hitY   = rect.top + rect.height * 0.28;

        // Появляемся над блоком мгновенно (уже в своём столбце)
        pEl.style.transition = 'none';
        pEl.style.left    = bx + 'px';
        pEl.style.top     = hoverY + 'px';
        pEl.style.opacity = '1';
        pEl.style.transform = 'translate(-50%, -100%) rotate(0deg)';

        qi++;
        remainDur -= hitsCanDo;
        blkEl.classList.add('cracking-1');

        // Небольшая пауза перед первым ударом
        setTimeout(() => doHits(hitsCanDo, 0), 120);

        function doHits(left, num) {
            if (!mineIsActive) { removePick(); return; }
            const swing = num % 2 === 0 ? -28 : 28;
            pEl.style.transform = `translate(-50%, -100%) rotate(${swing}deg)`;

            _anim(pEl, 'top', hoverY, hitY, 170, easeIn, () => {
                if (!mineIsActive) { removePick(); return; }
                pEl.style.transform = 'translate(-50%, -100%) rotate(0deg)';
                playSound('hit');
                flashBlock(blkEl);

                blkEl.classList.remove('cracking-1', 'cracking-2', 'cracking-3');
                const prog = (num + 1) / adjHits;
                blkEl.classList.add(prog >= 0.75 && willBreak ? 'cracking-3' : prog >= 0.4 ? 'cracking-2' : 'cracking-1');

                if (left <= 1) {
                    if (willBreak) {
                        doBreakBlock(blkEl, blk, () => { if (onBlockBroken) onBlockBroken(blk.r, blk.c); });
                        _anim(pEl, 'top', hitY, hoverY, 190, easeOut, () => {
                            if (!mineIsActive) { removePick(); return; }
                            setTimeout(processNext, 80);
                        });
                    } else {
                        _anim(pEl, 'top', hitY, hoverY, 170, easeOut, () => {
                            if (!mineIsActive) { removePick(); return; }
                            breakPick(() => { if (onAllDone) onAllDone(); });
                        });
                    }
                } else {
                    _anim(pEl, 'top', hitY, hoverY, 200, easeOut, () => {
                        if (!mineIsActive) { removePick(); return; }
                        setTimeout(() => doHits(left - 1, num + 1), 60);
                    });
                }
            });
        }
    }

    setTimeout(processNext, startDelay);
}

// ── Взрыв ТНТ (область 2×2 от позиции) ─────────────────────
function tntExplode(r, c) {
    const shaft = $('mc-shaft');
    if (shaft) {
        const flash = document.createElement('div');
        flash.style.cssText = 'position:absolute;inset:0;background:rgba(255,140,0,0.55);z-index:9998;pointer-events:none;border-radius:4px;transition:background 0.06s;';
        shaft.appendChild(flash);
        setTimeout(() => { flash.style.background = 'rgba(255,255,180,0.70)'; }, 60);
        setTimeout(() => { flash.style.background = 'rgba(255,80,0,0.18)'; }, 140);
        setTimeout(() => flash.remove(), 320);
    }
    // 2×2 область: [r,c], [r,c+1], [r+1,c], [r+1,c+1] — дамажим соседей
    const affected = [[r,c],[r,c+1],[r+1,c],[r+1,c+1]];
    affected.forEach(([nr, nc]) => {
        if (nr < 0 || nr >= MC_ROWS || nc < 0 || nc >= MC_COLS) return;
        const adj = $(`mc-blk-${nr}-${nc}`);
        if (!adj || adj.dataset.revealed === '1') return;
        adj.dataset.tntDmg = '10'; // instant break
        flashBlock(adj);
        spawnBreakParticles(adj, adj.dataset.blockType || 'stone', 7);
    });
    // Взрывные частицы
    const blkEl = $(`mc-blk-${r}-${c}`);
    if (blkEl) {
        const rect = blkEl.getBoundingClientRect();
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        for (let i = 0; i < 24; i++) {
            const p = document.createElement('div');
            const angle = (i / 24) * Math.PI * 2;
            const spd = 55 + Math.random() * 95;
            const vx = Math.cos(angle) * spd, vy = Math.sin(angle) * spd - 35;
            const sz = 3 + Math.random() * 7;
            const clr = i % 3 === 0 ? '#ff8800' : i % 3 === 1 ? '#ffdd00' : '#ff3300';
            p.style.cssText = `position:fixed;width:${sz}px;height:${sz}px;background:${clr};border-radius:50%;left:${cx}px;top:${cy}px;z-index:9900;pointer-events:none;`;
            document.body.appendChild(p);
            let ms = 0;
            const id = setInterval(() => {
                ms += 16; const t = ms / 1000;
                p.style.transform = `translate(${vx*t}px,${vy*t+320*t*t}px)`;
                p.style.opacity = String(Math.max(0, 1 - ms / 600));
                if (ms >= 600) { clearInterval(id); p.remove(); }
            }, 16);
        }
    }
}

// ── Падение ТНТ с 2×2 взрывом ────────────────────────────────
function dropTNT(col, blk, onDone) {
    const blkEl = $(`mc-blk-${blk.r}-${blk.c}`);
    if (!blkEl || blkEl.dataset.revealed === '1') { if (onDone) onDone(); return; }
    const rect = blkEl.getBoundingClientRect();
    if (rect.width === 0) { setTimeout(() => dropTNT(col, blk, onDone), 80); return; }

    const tntEl = document.createElement('img');
    tntEl.src = '/sprites/block_tnt.png';
    const startTop = rect.top - rect.height - 24;
    tntEl.style.cssText = `position:fixed;width:${rect.width}px;height:${rect.height}px;z-index:99999;pointer-events:none;image-rendering:pixelated;left:${rect.left}px;top:${startTop}px;`;
    document.body.appendChild(tntEl);
    _pickaxeEls.add(tntEl);

    // Падение с отскоком
    _anim(tntEl, 'top', startTop, rect.top, 480, easeBounce, () => {
        // Быстрое мигание перед взрывом
        let blink = 0;
        const blinkId = setInterval(() => {
            blink++;
            tntEl.style.filter = blink % 2 === 0 ? 'brightness(4)' : '';
            if (blink >= 5) {
                clearInterval(blinkId);
                _pickaxeEls.delete(tntEl); tntEl.remove();
                playSound('explode');
                // 2×2 взрыв: ломаем блок [r,c] и [r,c+1] если есть
                const blks2x2 = [blk];
                // Добавляем второй блок (правый) если есть
                const blkRight = blk.c + 1 < MC_COLS ? 
                    { r: blk.r, c: blk.c + 1, type: grid_current ? (grid_current[blk.r]||[])[blk.c+1] : 'stone', win: 0, hits: 1 } : null;
                tntExplode(blk.r, blk.c);
                // Ломаем главный блок
                doBreakBlock(blkEl, blk, () => {
                    if (onDone) onDone();
                });
            }
        }, 55);
    });
}

// ── Хотбар: рендер ──────────────────────────────────────────
let currentHotbar = null;

function renderMineHotbar(hotbar) {
    currentHotbar = hotbar || Array(INV_ROWS * INV_COLS).fill(null).map(() => ({ type: 'empty' }));
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
                img.style.cssText = 'width:68%;height:68%;object-fit:contain;image-rendering:pixelated;';
                cell.appendChild(img);
                cell.dataset.slotType = 'pickaxe';
                cell.dataset.pickType = slot.pickaxeType || 'wooden';
            } else if (slot && slot.type === 'book') {
                const img = document.createElement('img');
                img.src = '/sprites/block_book.png';
                img.style.cssText = 'width:76%;height:76%;object-fit:contain;image-rendering:pixelated;';
                cell.appendChild(img);
                cell.dataset.slotType = 'book';
                cell.className += ' inv-book';
            } else if (slot && slot.type === 'tnt') {
                const img = document.createElement('img');
                img.src = '/sprites/block_tnt.png';
                img.style.cssText = 'width:76%;height:76%;object-fit:contain;image-rendering:pixelated;';
                cell.appendChild(img);
                cell.dataset.slotType = 'tnt';
                cell.className += ' inv-tnt';
            }
            inv.appendChild(cell);
        }
    }
}

// ── Хотбар: slot-machine reveal (быстрая смена → стоп) ─────
function revealMineHotbar(hotbar, onDone) {
    currentHotbar = hotbar || Array(INV_ROWS * INV_COLS).fill(null).map(() => ({ type: 'empty' }));
    const inv = $('mc-inventory');
    if (!inv) { renderMineHotbar(hotbar); if (onDone) onDone(); return; }

    // Сначала все ячейки — пустые
    inv.innerHTML = '';
    for (let r = 0; r < INV_ROWS; r++) {
        for (let c = 0; c < INV_COLS; c++) {
            const cell = document.createElement('div');
            cell.className = 'inv-cell';
            cell.id = `inv-${r}-${c}`;
            inv.appendChild(cell);
        }
    }

    // Типы для рандомной прокрутки
    const SPIN_TYPES = ['pickaxe_wooden','pickaxe_stone','pickaxe_iron','pickaxe_golden','pickaxe_diamond','tnt','book','empty'];
    const SPIN_IMGS = {
        pickaxe_wooden:  '/sprites/pick_wooden.png',
        pickaxe_stone:   '/sprites/pick_stone.png',
        pickaxe_iron:    '/sprites/pick_iron.png',
        pickaxe_golden:  '/sprites/pick_golden.png',
        pickaxe_diamond: '/sprites/pick_diamond.png',
        tnt:             '/sprites/block_tnt.png',
        book:            '/sprites/block_book.png',
        empty:           null,
    };

    function slotTypeOf(slot) {
        if (!slot || slot.type === 'empty') return 'empty';
        if (slot.type === 'pickaxe') return 'pickaxe_' + (slot.pickaxeType || 'wooden');
        return slot.type;
    }

    function renderCellType(cell, typeStr) {
        cell.innerHTML = '';
        cell.className = 'inv-cell';
        const imgSrc = SPIN_IMGS[typeStr];
        if (imgSrc) {
            const img = document.createElement('img');
            img.src = imgSrc;
            img.style.cssText = 'width:70%;height:70%;object-fit:contain;image-rendering:pixelated;';
            cell.appendChild(img);
        }
    }

    // Крутим все ячейки одновременно с быстрой сменой
    const SPIN_DURATION = 700;   // мс суммарной прокрутки
    const FRAME_MS      = 80;    // мс между сменой символа
    let elapsed = 0;
    const spinId = setInterval(() => {
        elapsed += FRAME_MS;
        // В каждом кадре — рандомный символ в каждой ячейке
        for (let r = 0; r < INV_ROWS; r++) {
            for (let c = 0; c < INV_COLS; c++) {
                const cell = $(`inv-${r}-${c}`);
                if (!cell) continue;
                const rndType = SPIN_TYPES[Math.floor(Math.random() * SPIN_TYPES.length)];
                renderCellType(cell, rndType);
            }
        }
        if (elapsed >= SPIN_DURATION) {
            clearInterval(spinId);
            // Стоп: показываем финальный результат столбец за столбцом
            for (let c = 0; c < MC_COLS; c++) {
                setTimeout(() => {
                    for (let r = 0; r < INV_ROWS; r++) {
                        const idx = r * INV_COLS + c;
                        const cell = $(`inv-${r}-${c}`);
                        if (!cell) continue;
                        const slot = currentHotbar[idx];
                        const finalType = slotTypeOf(slot);
                        renderCellType(cell, finalType);
                        // Проставляем data-атрибуты для последующей логики
                        if (slot && slot.type === 'pickaxe') {
                            cell.dataset.slotType = 'pickaxe';
                            cell.dataset.pickType = slot.pickaxeType || 'wooden';
                        } else if (slot && slot.type === 'tnt') {
                            cell.dataset.slotType = 'tnt';
                            cell.className += ' inv-tnt';
                        } else if (slot && slot.type === 'book') {
                            cell.dataset.slotType = 'book';
                            cell.className += ' inv-book';
                        }
                        // Короткий flash при остановке
                        cell.style.background = 'rgba(255,255,255,0.06)';
                        setTimeout(() => { cell.style.background = ''; }, 120);
                    }
                }, c * 60);
            }
            const stopTime = MC_COLS * 60 + 150;
            setTimeout(() => { if (onDone) onDone(); }, stopTime);
        }
    }, FRAME_MS);
}

// ── Шахта: инициализация ────────────────────────────────────
function initMineShaft(keepPersist, idlePreview) {
    const shaft = $('mc-shaft');
    if (!shaft) return;
    shaft.innerHTML = '';
    const IDLE = [
        ['grass','grass','grass','grass','grass'],
        ['dirt','stone','stone','stone','redstone'],
        ['stone','stone','redstone','redstone','redstone'],
        ['stone','redstone','gold','gold','gold'],
        ['redstone','gold','gold','diamond','diamond'],
        ['gold','diamond','diamond','obsidian','obsidian'],
    ];
    for (let r = 0; r < MC_ROWS; r++) {
        for (let c = 0; c < MC_COLS; c++) {
            const blk = document.createElement('div');
            blk.id = `mc-blk-${r}-${c}`;
            const pt = keepPersist && minePersistGrid ? minePersistGrid[r][c] : null;
            if (pt) {
                blk.className = `mc-blk ${MINE_BLOCK_CLASS[pt] || 'stone-blk'}`;
                blk.dataset.revealed = '1';
            } else {
                const pool = IDLE[r];
                blk.className = `mc-blk ${MINE_BLOCK_CLASS[pool[Math.floor(Math.random() * pool.length)]] || 'stone-blk'}`;
            }
            shaft.appendChild(blk);
        }
    }
    for (let i = 0; i < MC_COLS; i++) {
        const ch = $(`mc-chest-${i}`);
        if (ch) ch.classList.remove('open', 'open-anim');
    }
    const rt = $('mine-running-total');
    if (rt) { rt.textContent = '0.00'; rt.classList.remove('has-win'); }
    mineRunningTotal = 0;
}

// ── Сундук ──────────────────────────────────────────────────
function openChest(col, mult, isActivated) {
    openChestWithAnim(col, mult, isActivated, 0);
}
function openChestWithAnim(col, mult, isActivated, baseWin) {
    const ch = $(`mc-chest-${col}`);
    playSound('chest');
    if (ch) { ch.classList.add('open', 'open-anim'); setTimeout(() => ch.classList.remove('open-anim'), 600); }

    if (isActivated && ch) {
        const tag = document.createElement('div');
        tag.className = 'mine-chest-mult-popup';
        tag.innerHTML = `<div class="cmp-label">БАЛАНС</div><div class="cmp-mult">×${mult}</div>`;
        ch.appendChild(tag);
        setTimeout(() => { if (tag.parentNode) tag.parentNode.removeChild(tag); }, 3000);
        showToast(`x${mult}`, 2500);
    } else if (ch) {
        const tag = document.createElement('div');
        tag.className = 'chest-mult-tag';
        tag.textContent = `×${mult}`;
        ch.appendChild(tag);
        setTimeout(() => { if (tag.parentNode) tag.parentNode.removeChild(tag); }, 2800);
    }
}

// ── ОСНОВНОЕ РАСКРЫТИЕ шахты ────────────────────────────────
// Простая надёжная логика: доверяем серверу полностью.
// blockWins[r][c] > 0 → этот блок сломан и имеет выигрыш.
// Кирки назначаются по столбцам согласно hotbar.
// Stagger 200ms между кирками в одном столбце.
function revealMineShaft(grid, blockWins, serverWin, balanceBefore, chestMults, isAutoSpin, chestActivated) {
    const HITS = { grass:1, dirt:1, stone:1, redstone:2, gold:2, gold_block:2, diamond:3, diamond_block:3, obsidian:4 };
    grid_current = grid;

    // 1. Обновляем вид блоков
    for (let r = 0; r < MC_ROWS; r++) {
        for (let c = 0; c < MC_COLS; c++) {
            const el = $(`mc-blk-${r}-${c}`);
            if (!el) continue;
            const type = grid[r][c];
            if (!type) { el.dataset.revealed='1'; el.style.visibility='hidden'; continue; }
            if (isAutoSpin && el.dataset.revealed==='1') continue;
            el.className = `mc-blk ${MINE_BLOCK_CLASS[type]||'stone-blk'}`;
            el.dataset.revealed='0'; el.dataset.blockType=type; el.dataset.tntDmg='0';
            el.style.cssText=''; el.style.visibility='visible';
        }
    }

    // 2. Читаем hotbar — кирки и ТНТ
    const hotbar = currentHotbar || [];
    const picks = [], tnts = [];
    let bookCount = 0;
    hotbar.forEach((slot, idx) => {
        if (!slot) return;
        const col = idx % MC_COLS;
        if (slot.type === 'pickaxe') picks.push({ col, idx, pType: slot.pickaxeType || 'wooden' });
        else if (slot.type === 'tnt') tnts.push({ col, idx });
        else if (slot.type === 'book') bookCount++;
    });
    if (bookCount > 0) mineBookCount += bookCount;

    // 3. Строим карту выигрышей из сервера
    // Блок сломан если blockWins[r][c] > 0 ИЛИ он в списке TNT-сломанных
    const winMap = {}; // "r,c" → win
    for (let r = 0; r < MC_ROWS; r++) {
        for (let c = 0; c < MC_COLS; c++) {
            const bw = (blockWins && blockWins[r]) ? Number(blockWins[r][c]) : 0;
            winMap[`${r},${c}`] = bw;
        }
    }

    // 4. Для кирок — строим очередь блоков по столбцу
    // Берём блоки сверху вниз согласно прочности кирки
    const RANK = { wooden:0, stone:1, iron:2, golden:3, diamond:4 };
    const tntCols = new Set(tnts.map(t => t.col));

    // Группируем кирки по столбцам
    const pickByCol = {};
    picks.forEach(ps => {
        if (!pickByCol[ps.col]) pickByCol[ps.col] = [];
        pickByCol[ps.col].push(ps);
    });

    // Для каждого столбца с кирками строим очереди блоков
    // Кирки в одном столбце работают последовательно: pick1 берёт первые N блоков, pick2 — следующие
    const colWork = {}; // col → [{pType, blocks:[{r,c,type,win,hits}], dur}]
    Object.entries(pickByCol).forEach(([colStr, colPicks]) => {
        const col = parseInt(colStr);
        if (tntCols.has(col)) return; // TNT занял этот столбец

        // Все блоки в столбце (сверху вниз), только не-revealed
        const colQ = [];
        for (let r = 0; r < MC_ROWS; r++) {
            const el = $(`mc-blk-${r}-${col}`);
            if (!el || el.dataset.revealed==='1') continue;
            const type = grid[r][col]; if (!type) continue;
            colQ.push({ r, c: col, type, win: winMap[`${r},${col}`] || 0, hits: HITS[type] || 1 });
        }
        if (!colQ.length) return;

        // Назначаем блоки кирками
        colWork[col] = [];
        let bIdx = 0;
        colPicks.forEach(ps => {
            const dur = getPickDur(ps.pType);
            let rem = dur, myBlocks = [];
            while (rem > 0 && bIdx < colQ.length) {
                const blk = colQ[bIdx];
                const hc = Math.min(blk.hits, rem);
                myBlocks.push({ ...blk });
                rem -= hc; bIdx++;
            }
            colWork[col].push({ pType: ps.pType, blocks: myBlocks, dur, ps });
        });
    });

    // 5. Трекаем сломанные блоки для сундуков
    const liveColBroken = Array(MC_COLS).fill(0);
    for (let c = 0; c < MC_COLS; c++) {
        for (let r = 0; r < MC_ROWS; r++) {
            const el = $(`mc-blk-${r}-${c}`);
            if (el && el.dataset.revealed==='1') liveColBroken[c]++;
        }
    }
    const openedChests = new Set();
    const colMults = chestMults || [2,2,2,2,2];
    const srvAct   = chestActivated || [];

    function onBlockBroken(r, c) {
        liveColBroken[c]++;
        if (liveColBroken[c] >= MC_ROWS && !openedChests.has(c)) {
            openedChests.add(c);
            setTimeout(() => openChestWithAnim(c, colMults[c]||2, srvAct[c]===true, serverWin), 350);
        }
    }

    mineIsActive = true;
    mineRunningTotal = 0;

    // 6. Фаза ТНТ — 2×2 взрыв во все стороны
    const tntPhase = tnts.length > 0 ? tnts.length * 600 + 400 : 0;
    tnts.forEach((ts, i) => {
        setTimeout(() => {
            if (!mineIsActive) return;
            // Убираем из хотбара
            const ir = Math.floor(ts.idx / MC_COLS), ic = ts.idx % MC_COLS;
            const iCell = $(`inv-${ir}-${ic}`);
            if (iCell) { iCell.innerHTML=''; iCell.className='inv-cell'; delete iCell.dataset.slotType; }

            // Находим целевые блоки 2×2 вокруг TNT-позиции (не ограничено одним столбцом)
            // TNT падает в первый блок столбца, взрывает 2×2 вокруг него
            const colQ = [];
            for (let r = 0; r < MC_ROWS; r++) {
                const el = $(`mc-blk-${r}-${ts.col}`);
                if (!el || el.dataset.revealed==='1') continue;
                const type = grid[r][ts.col]; if (!type) continue;
                colQ.push({ r, c: ts.col, type, win: winMap[`${r},${ts.col}`] || 0, hits:1 });
                break; // первый нетронутый блок
            }
            if (!colQ[0]) { playSound('explode'); return; }
            const targetR = colQ[0].r;
            const targetC = ts.col;

            dropTNT(ts.col, colQ[0], () => {
                // Взрыв 2×2: все 4 блока вокруг
                const blast = [
                    [targetR, targetC],
                    [targetR, targetC+1],
                    [targetR+1, targetC],
                    [targetR+1, targetC+1],
                ];
                blast.forEach(([br, bc], bi) => {
                    if (br < 0 || br >= MC_ROWS || bc < 0 || bc >= MC_COLS) return;
                    const blkEl = $(`mc-blk-${br}-${bc}`);
                    if (!blkEl || blkEl.dataset.revealed==='1') return;
                    const type = grid[br][bc]; if (!type) return;
                    const blk = { r:br, c:bc, type, win: winMap[`${br},${bc}`] || 0, hits:1 };
                    setTimeout(() => {
                        doBreakBlock(blkEl, blk, () => onBlockBroken(br, bc));
                    }, bi * 80);
                });
            });
        }, i * 600);
    });

    // 7. Фаза кирок: все столбцы параллельно, внутри столбца — stagger 200ms
    setTimeout(() => {
        Object.entries(colWork).forEach(([colStr, workList]) => {
            workList.forEach(({ pType, blocks, dur, ps }, pi) => {
                // Убираем кирку из хотбара
                const ir = Math.floor(ps.idx / MC_COLS), ic = ps.idx % MC_COLS;
                const iCell = $(`inv-${ir}-${ic}`);
                if (iCell) { iCell.innerHTML=''; iCell.className='inv-cell'; delete iCell.dataset.slotType; delete iCell.dataset.pickType; }

                const delay = pi * 200; // stagger между кирками в одном столбце
                if (blocks.length > 0) {
                    spawnPickaxeWorker(blocks, pType, delay, null, onBlockBroken, dur);
                }
            });
        });
    }, tntPhase);

    // 8. Длительность: максимальное время по всем столбцам
    let maxMs = 0;
    Object.values(colWork).forEach(workList => {
        let t = 0;
        workList.forEach(({ blocks, dur }, pi) => {
            let sub = pi * 200, rem = dur;
            blocks.forEach(blk => {
                const hc = Math.min(blk.hits, rem);
                sub += hc * (170 + 200 + 60) + 400;
                rem -= hc;
            });
            t = Math.max(t, sub);
        });
        maxMs = Math.max(maxMs, t);
    });
    const estReveal = tntPhase + maxMs + 1400;

    // 9. Финал
    setTimeout(() => {
        if (!mineIsActive) return;
        mineRunningTotal = serverWin;
        const rt = $('mine-running-total');
        if (rt) {
            if (serverWin > 0) { rt.classList.add('has-win'); rt.textContent = serverWin.toFixed(2); }
            else { rt.textContent = '0.00'; rt.classList.remove('has-win'); }
        }
        if (serverWin > 0) {
            playSound('win');
            const balSpan = $('bal-val');
            if (balSpan) animateCounter(balSpan, balanceBefore, balanceBefore + serverWin, 1000);
            flyToBalance(serverWin);
            showToast('+' + serverWin.toFixed(2) + ' TON');
        }
        updateUI();
        if (mineBookCount >= 3 || mineAutoRemaining > 0) {
            if (mineBookCount >= 3) { mineBookCount -= 3; mineAutoRemaining = Math.max(mineAutoRemaining, 1); }
            showMineBonusOverlay(mineAutoRemaining, () => autoSpinMine());
        } else {
            const sEl = $('mine-book-status');
            if (sEl) sEl.style.display = 'none';
        }
    }, estReveal);

    return estReveal + 400;
}


function setupMineTextures() {
    ['/sprites/block_grass.png','/sprites/block_dirt.png','/sprites/block_stone.png',
     '/sprites/block_redstone.png','/sprites/block_gold.png','/sprites/block_diamond.png',
     '/sprites/block_obsidian.png','/sprites/block_tnt.png','/sprites/block_book.png',
     '/sprites/chest_closed.png','/sprites/chest_open.png',
     '/sprites/crack_1.png','/sprites/crack_2.png','/sprites/crack_3.png'
    ].forEach(src => { const i = new Image(); i.src = src; });
}

function initMineGrid() { setupMineTextures(); renderMineHotbar(null); initMineShaft(false, true); }

async function autoSpinMine() {
    if (mineIsSpinning || !user) return;
    const btn = $('mn-btn');
    mineIsSpinning = true;
    if (btn) btn.disabled = true;
    const balBefore = user.balance || 0;
    const currentGrid = [];
    for (let r = 0; r < MC_ROWS; r++) {
        const row = [];
        for (let c = 0; c < MC_COLS; c++) {
            const el = $(`mc-blk-${r}-${c}`);
            row.push(el && el.dataset.revealed === '1' ? null : (el && el.dataset.blockType ? el.dataset.blockType : null));
        }
        currentGrid.push(row);
    }
    try {
        const resp = await fetch('/api/mine', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: user.id, bet: 0, mode, autoSpin: true, persistGrid: currentGrid }) });
        const data = await resp.json();
        if (!resp.ok) { mineIsSpinning = false; if (btn) btn.disabled = false; return; }
        user = data.user;
        if (typeof data.freeSpinsLeft === 'number') mineAutoRemaining = data.freeSpinsLeft;
        revealMineHotbar(data.hotbar, () => {
            const t = revealMineShaft(data.grid, data.blockWins, data.win, balBefore, data.chestMults, true, data.chestActivated);
            setTimeout(() => { mineIsSpinning = false; if (btn) btn.disabled = false; }, t + 100);
        });
    } catch(e) { mineIsSpinning = false; if (btn) btn.disabled = false; }
}

async function playMine() {
    if (!user) return showToast('Загрузка...');
    if (mineIsSpinning) return;
    if (maintenance.mine) return showToast('Тех. обслуживание');
    const betInput = $('mn-bet'), btn = $('mn-btn');
    let betVal = parseFloat(betInput ? betInput.value : 0);
    if (!betVal || betVal < 0.1) { showToast('Мин. ставка 0.1 TON'); return; }
    if (betVal > 25) { betVal = 25; if (betInput) betInput.value = 25; }
    mineLastBet = betVal;
    mineBookCount = 0; minePersistGrid = null;
    const sEl2 = $('mine-book-status');
    if (sEl2) sEl2.style.display = 'none';
    playSound('click');
    mineIsSpinning = true;
    if (btn) btn.disabled = true;
    const balBefore = user.balance || 0;
    renderMineHotbar(null);
    initMineShaft(false, true);
    try {
        const resp = await fetch('/api/mine', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: user.id, bet: betVal, mode }) });
        const data = await resp.json();
        if (!resp.ok) { showToast(data.error || 'Ошибка'); mineIsSpinning = false; if (btn) btn.disabled = false; return; }
        user = data.user;
        if (typeof data.freeSpinsLeft === 'number') mineAutoRemaining = data.freeSpinsLeft;
        revealMineHotbar(data.hotbar, () => {
            const t = revealMineShaft(data.grid, data.blockWins, data.win, balBefore, data.chestMults, false, data.chestActivated);
            setTimeout(() => { mineIsSpinning = false; if (btn) btn.disabled = false; }, t + 100);
        });
    } catch(e) { showToast('Ошибка соединения'); mineIsSpinning = false; if (btn) btn.disabled = false; }
}

// Mine bonus overlay — показывает на весь экран как в спинах
function showMineBonusOverlay(count, onDone) {
    // Убираем надпись книг
    const sEl = $('mine-book-status');
    if (sEl) sEl.style.display = 'none';

    const ov = document.createElement('div');
    ov.style.cssText = `
        position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.82);
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        backdrop-filter:blur(4px);pointer-events:all;opacity:0;transition:opacity 0.25s;
    `;
    ov.innerHTML = `
        <div style="text-align:center;">
            <div style="font-size:52px;font-weight:900;color:#00ff88;letter-spacing:2px;line-height:1;">${count}</div>
            <div style="font-size:15px;font-weight:700;color:rgba(255,255,255,.55);letter-spacing:3px;margin-top:8px;text-transform:uppercase;">Бесплатный спин</div>
        </div>
    `;
    document.body.appendChild(ov);
    requestAnimationFrame(() => { ov.style.opacity = '1'; });
    setTimeout(() => {
        ov.style.opacity = '0';
        setTimeout(() => { ov.remove(); if (onDone) onDone(); }, 260);
    }, 1600);
}

// showFreeSpinActivation — для спинов (без изменений)
function showFreeSpinActivation(count) {
    const overlay = $('freespin-overlay'), countEl = $('freespin-overlay-count');
    if (!overlay) return;
    if (countEl) countEl.innerText = count;
    overlay.style.display = 'flex';
    setTimeout(() => {
        overlay.style.opacity = '0'; overlay.style.transition = 'opacity 0.4s';
        setTimeout(() => { overlay.style.display = 'none'; overlay.style.opacity = '1'; overlay.style.transition = ''; }, 400);
    }, 2100);
}


// ════════════════════════════════════════
//  GIFTS PAGE
// ════════════════════════════════════════
function goToGiftPay() {
    // Navigate to wallet → Gift Pay tab
    const walletNavItem = document.querySelector('.nav-item:nth-child(4)');
    nav('wallet', walletNavItem);
    setTimeout(() => {
        switchWalletTab('dep');
        setTimeout(() => {
            const giftTab = document.querySelectorAll('.w-tab')[2];
            if (giftTab) switchDepTab('gift', giftTab);
        }, 150);
    }, 100);
}

async function loadGiftsPage() {
    const c = $('gifts-content');
    if (!c || !user) return;

    // Beautiful loading skeleton
    c.innerHTML = `
    <div style="padding:0 0 20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
            <div style="font-size:13px;font-weight:800;color:#fff;letter-spacing:.5px;">Мои подарки</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            ${[1,2,3,4].map(()=>`<div style="background:#0d0d1e;border:1px solid rgba(255,255,255,.05);border-radius:16px;aspect-ratio:1;animation:pulse 1.4s ease-in-out infinite;"></div>`).join('')}
        </div>
    </div>`;

    try {
        const r = await fetch('/api/gifts/list', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ id: user.id })
        });
        const d = await r.json();
        const gifts = d.gifts || [];

        if (!gifts.length) {
            c.innerHTML = `
            <div style="min-height:65vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;text-align:center;">
                <div style="width:88px;height:88px;background:linear-gradient(135deg,rgba(0,229,255,.06),rgba(0,229,255,.02));border:1px solid rgba(0,229,255,.1);border-radius:24px;display:flex;align-items:center;justify-content:center;margin-bottom:20px;">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(0,229,255,.35)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M20 12v10H4V12"/><path d="M22 7H2v5h20V7z"/><path d="M12 22V7"/>
                        <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/>
                        <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>
                    </svg>
                </div>
                <div style="font-size:17px;font-weight:900;color:#fff;margin-bottom:8px;">Нет подарков</div>
                <div style="font-size:12px;color:rgba(255,255,255,.35);margin-bottom:28px;line-height:1.6;max-width:240px;">
                    Отправьте Telegram-подарок на @msgp2p и он появится здесь автоматически
                </div>
                <button onclick="goToGiftPay()" style="background:linear-gradient(135deg,#00e5ff,#0097a7);color:#000;font-weight:900;border:none;border-radius:14px;padding:14px 36px;font-size:14px;cursor:pointer;letter-spacing:.5px;box-shadow:0 8px 24px rgba(0,229,255,.2);">Пополнить подарком</button>
            </div>`;
            return;
        }

        c.innerHTML = `
        <div style="padding:0 0 24px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
                <div style="font-size:13px;font-weight:800;color:#fff;">Мои подарки</div>
                <div style="font-size:11px;color:rgba(255,255,255,.35);background:rgba(255,255,255,.05);padding:4px 10px;border-radius:20px;">${gifts.length} шт.</div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                ${gifts.map(g => {
                    const priceStr = g.price ? g.price.toFixed(2) + ' TON' : '—';
                    return `
                    <div onclick="openGiftDetail('${g._id}')"
                        style="background:#0a0a18;border:1px solid rgba(255,255,255,.07);border-radius:18px;overflow:hidden;cursor:pointer;transition:transform .12s,border-color .15s,box-shadow .15s;-webkit-tap-highlight-color:transparent;"
                        ontouchstart="this.style.transform='scale(.95)';this.style.borderColor='rgba(0,229,255,.3)'"
                        ontouchend="this.style.transform='';this.style.borderColor='rgba(255,255,255,.07)'">
                        <!-- Image -->
                        <div style="width:100%;aspect-ratio:1;background:linear-gradient(135deg,#0d0d22,#14142e);position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;">
                            ${g.imageUrl
                                ? `<img src="${g.imageUrl}" style="width:100%;height:100%;object-fit:cover;" loading="lazy" onerror="this.style.display='none';this.parentNode.querySelector('.gift-fallback').style.display='flex'">`
                                : ''}
                            <div class="gift-fallback" style="display:${g.imageUrl?'none':'flex'};flex-direction:column;align-items:center;gap:6px;">
                                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="1.5"><path d="M20 12v10H4V12"/><path d="M22 7H2v5h20V7z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>
                            </div>
                            ${g.price ? `<div style="position:absolute;bottom:8px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.75);backdrop-filter:blur(4px);border:1px solid rgba(0,255,136,.3);border-radius:20px;padding:3px 10px;font-size:11px;font-weight:800;color:#00ff88;white-space:nowrap;">${priceStr}</div>` : ''}
                        </div>
                        <!-- Info -->
                        <div style="padding:10px 12px 12px;">
                            <div style="font-size:12px;font-weight:800;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:3px;">${g.name}</div>
                            <div style="font-size:10px;color:rgba(255,255,255,.35);">${g.price ? priceStr : 'Цена не указана'}</div>
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>`;
    } catch(e) {
        c.innerHTML = `<div style="text-align:center;padding:40px;color:rgba(255,34,85,.7);font-size:13px;">Ошибка загрузки</div>`;
    }
}

async function openGiftDetail(giftId) {
    const existOv = $('gift-detail-ov');
    if (existOv) existOv.remove();

    // Create overlay with loading state
    const ov = document.createElement('div');
    ov.id = 'gift-detail-ov';
    ov.style.cssText = 'position:fixed;inset:0;background:#050508;z-index:99999;display:flex;flex-direction:column;overflow-y:auto;opacity:0;transition:opacity .18s;';
    ov.innerHTML = `<div style="height:100%;display:flex;align-items:center;justify-content:center;">
        <div style="width:36px;height:36px;border:3px solid rgba(0,229,255,.15);border-top-color:#00e5ff;border-radius:50%;animation:spin .8s linear infinite;"></div>
    </div>`;
    document.body.appendChild(ov);
    requestAnimationFrame(() => { ov.style.opacity = '1'; });

    try {
        const r = await fetch('/api/gifts/get', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ id: user.id, giftId })
        });
        const d = await r.json();
        const g = d.gift;
        if (!g) { showToast('Подарок не найден'); ov.remove(); return; }

        const priceStr = g.price ? g.price.toFixed(2) + ' TON' : '—';

        ov.innerHTML = `
        <!-- Header -->
        <div style="position:sticky;top:0;background:#050508;border-bottom:1px solid rgba(255,255,255,.05);padding:14px 16px;display:flex;align-items:center;gap:12px;z-index:10;">
            <button onclick="document.getElementById('gift-detail-ov').remove()"
                style="background:none;border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.5);border-radius:10px;padding:8px 14px;cursor:pointer;font-size:12px;font-weight:700;flex-shrink:0;">← Назад</button>
            <span style="font-size:14px;font-weight:800;color:#fff;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${g.name}</span>
        </div>

        <!-- NFT Image block -->
        <div style="padding:24px 20px 0;display:flex;justify-content:center;">
            <div style="width:min(260px,80vw);height:min(260px,80vw);border-radius:22px;background:linear-gradient(135deg,#0d0d22,#14142e);border:1px solid rgba(255,255,255,.08);overflow:hidden;display:flex;align-items:center;justify-content:center;box-shadow:0 20px 60px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.04);">
                ${g.imageUrl
                    ? `<img src="${g.imageUrl}" style="width:100%;height:100%;object-fit:cover;" onerror="this.src='';this.parentNode.innerHTML='<div style=font-size:80px;opacity:.3>🎁</div>'">`
                    : `<div style="font-size:80px;opacity:.3;">🎁</div>`}
            </div>
        </div>

        <!-- Price highlight -->
        <div style="padding:20px 20px 0;display:flex;justify-content:center;">
            <div style="background:linear-gradient(135deg,rgba(0,255,136,.08),rgba(0,229,255,.05));border:1px solid rgba(0,255,136,.2);border-radius:14px;padding:14px 28px;text-align:center;">
                <div style="font-size:10px;color:rgba(255,255,255,.35);font-weight:700;letter-spacing:2px;margin-bottom:4px;">СТОИМОСТЬ</div>
                <div style="font-size:24px;font-weight:900;color:#00ff88;line-height:1;">${priceStr}</div>
                ${!g.price ? '<div style="font-size:10px;color:rgba(255,255,255,.25);margin-top:4px;">Цена будет добавлена</div>' : ''}
            </div>
        </div>

        <!-- Info block -->
        <div style="padding:16px 20px;">
            <div style="background:#0a0a18;border:1px solid rgba(255,255,255,.06);border-radius:16px;overflow:hidden;margin-bottom:16px;">
                <div style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.04);display:flex;justify-content:space-between;align-items:center;">
                    <span style="color:rgba(255,255,255,.4);font-size:12px;">Название</span>
                    <span style="color:#fff;font-weight:700;font-size:13px;max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;">${g.name}</span>
                </div>
                <div style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.04);display:flex;justify-content:space-between;align-items:center;">
                    <span style="color:rgba(255,255,255,.4);font-size:12px;">Владелец</span>
                    <span style="color:#00e5ff;font-weight:700;font-size:12px;">@${user.username || user.id}</span>
                </div>
                <div style="padding:14px 16px;display:flex;justify-content:space-between;align-items:center;">
                    <span style="color:rgba(255,255,255,.4);font-size:12px;">Статус</span>
                    <span style="color:#00ff88;font-weight:700;font-size:12px;display:flex;align-items:center;gap:6px;">
                        <span style="width:6px;height:6px;background:#00ff88;border-radius:50%;display:inline-block;"></span>
                        В кошельке
                    </span>
                </div>
            </div>

            <!-- Action buttons -->
            <button onclick="withdrawGift('${g._id}')"
                style="width:100%;padding:17px;background:linear-gradient(135deg,#00e5ff,#0097a7);color:#000;border:none;border-radius:14px;font-weight:900;font-size:15px;cursor:pointer;letter-spacing:.5px;box-shadow:0 8px 24px rgba(0,229,255,.2);margin-bottom:10px;">
                Вывести / Продать
            </button>
            <div style="text-align:center;color:rgba(255,255,255,.2);font-size:11px;line-height:1.5;padding:0 10px;">
                Комиссия 0.3 TON · Подарок передаётся администратору для вывода
            </div>
        </div>`;
    } catch(e) {
        showToast('Ошибка загрузки');
        ov.remove();
    }
}

async function withdrawGift(giftId) {
    const bal = mode === 'real' ? user.balance : user.demo_balance;
    if (bal < 0.3) return showToast('Нужно 0.3 TON на балансе');
    if (!confirm('Вывести подарок? Спишется 0.3 TON')) return;
    try {
        const r = await fetch('/api/gifts/withdraw', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ id: user.id, giftId })
        });
        const d = await r.json();
        if (!r.ok) return showToast(d.error || 'Ошибка');
        user = d.user;
        updateUI();
        showToast('Заявка создана!');
        const ov = $('gift-detail-ov');
        if (ov) ov.remove();
        loadGiftsPage();
    } catch(e) { showToast('Ошибка'); }
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
                    const sym = grid[r][c]||'L';
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

// ===================== CASES GAME =====================
let casesConfig = [];
let caseIsOpening = false;
let currentCaseId = null;
let caseOpenCount = 1; // 1-5


// ════ CASE6: Бесплатный кейс Лоникс Гифт ════
let case6Status = null; // {available, nextAvailableAt}
let case6TimerInterval = null;

async function checkCase6Status() {
    try {
        const r = await fetch('/api/cases/free_status', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:user.id,caseId:'case6'})});
        case6Status = await r.json();
    } catch(e) { case6Status = {available:true}; }
    return case6Status;
}

function formatCountdown(nextAvailableAt) {
    if(!nextAvailableAt) return '';
    const diff = new Date(nextAvailableAt) - new Date();
    if(diff <= 0) return '';
    const h = Math.floor(diff/3600000);
    const m = Math.floor((diff%3600000)/60000);
    const sec = Math.floor((diff%60000)/1000);
    return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}`;
}

function startCase6Timer(nextAvailableAt, onExpire) {
    if(case6TimerInterval) clearInterval(case6TimerInterval);
    case6TimerInterval = setInterval(() => {
        const timeStr = formatCountdown(nextAvailableAt);
        const el = document.getElementById('case6-timer');
        if(el) el.innerText = timeStr || '';
        if(!timeStr) {
            clearInterval(case6TimerInterval);
            case6Status = {available:true};
            if(onExpire) onExpire();
        }
    }, 1000);
}

function showCase6ChannelBottomSheet(cfg) {
    const freeCase = casesConfig.find(c=>c.id==='case6') || cfg;
    const channels = (freeCase.channels) || cfg.channels || [];
    let channelHtml = '';
    if(channels.length === 0) {
        channelHtml = '<p style="color:#888;font-size:13px;text-align:center;">Подпишитесь на канал LoonxGift</p>';
    } else {
        channelHtml = channels.map(ch => `
            <a href="https://t.me/${ch.replace('@','')}" target="_blank" class="case6-channel-btn">
                ${ch}
            </a>`).join('');
    }
    
    // Удаляем старый если есть
    const old = document.getElementById('case6-sheet');
    if(old) old.remove();
    
    const sheet = document.createElement('div');
    sheet.id = 'case6-sheet';
    sheet.className = 'case6-bottom-sheet';
    sheet.innerHTML = `
        <div class="case6-sheet-handle"></div>
        <div class="case6-sheet-title">Для открытия подпишитесь</div>
        <p class="case6-sheet-desc">Откройте Лоникс Гифт бесплатно — подпишитесь на каналы и нажмите Проверить</p>
        <div class="case6-channels-list">
            ${channelHtml}
        </div>
        <button class="btn case6-check-btn" id="case6-check-btn" onclick="checkCase6Subscriptions()">
            Проверить подписку
        </button>
        <button class="case6-skip-btn" onclick="document.getElementById('case6-sheet').remove()">Отмена</button>
    `;
    document.body.appendChild(sheet);
    // Анимация снизу
    requestAnimationFrame(() => {
        requestAnimationFrame(() => { sheet.classList.add('case6-sheet-open'); });
    });
}

async function checkCase6Subscriptions() {
    const btn = document.getElementById('case6-check-btn');
    if(btn) { btn.disabled=true; btn.innerText='Проверяем...'; }
    
    // Проверяем через Telegram bot API
    try {
        const r = await fetch('/api/cases/check_subscriptions', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({id:user.id, caseId:'case6'})
        });
        const d = await r.json();
        
        if(d.ok || d.subscribed) {
            // Подписан - закрываем и открываем кейс
            const sheet = document.getElementById('case6-sheet');
            if(sheet) sheet.remove();
            playCaseOpen('case6', 0);
        } else {
            if(btn) { btn.disabled=false; btn.innerText='Проверить подписку'; }
            showToast(d.error || 'Необходимо подписаться на все каналы');
        }
    } catch(e) {
        if(btn) { btn.disabled=false; btn.innerText='Проверить подписку'; }
        showToast('Ошибка проверки');
    }
}
async function loadCasesPage() {
    caseOpenCount = 1;
    if (casesConfig.length === 0) {
        try {
            const r = await fetch('/api/cases/config');
            const d = await r.json();
            casesConfig = d.cases || [];
        } catch(e) { showToast('Ошибка загрузки кейсов'); return; }
    }
    // Загружаем статус бесплатного кейса
    await checkCase6Status();
    renderCasesList();
}

function renderCasesList() {
    const page = $('page-cases');
    if (!page) return;
    
    // Сортируем: case6 (free) первым
    const sorted = [...casesConfig].sort((a,b)=>(a.isFree?-1:0)-(b.isFree?-1:0));
    
    page.innerHTML = `<div class="cases-page">
        <div class="cases-section-label">ВЫБЕРИТЕ КЕЙС</div>
        <div class="cases-grid">
            ${sorted.map(c => {
                if(c.isFree) {
                    // Бесплатный кейс
                    const st = case6Status || {};
                    const avail = st.available !== false;
                    const timerStr = !avail ? formatCountdown(st.nextAvailableAt) : '';
                    return `<div class="case-card case-card-free" onclick="openCaseDetail('${c.id}')" id="case6-card">
                        <div class="case-free-badge">БОНУС</div>
                        <div class="case-img-wrap">
                            <img src="/${c.img}" alt="${c.name}" class="case-img" onerror="this.style.opacity='0.3'">
                            <div class="case-glow case-glow-gold"></div>
                        </div>
                        <div class="case-name" style="color:#ffcc00;">${c.name}</div>
                        ${avail
                            ? `<div class="case-price-row case-price-free">Открыть бесплатно</div>`
                            : `<div class="case-price-row" style="color:#888;font-size:11px;gap:4px;">
                                <span id="case6-timer-list">${timerStr}</span>
                               </div>`
                        }
                    </div>`;
                }
                return `<div class="case-card" onclick="openCaseDetail('${c.id}')">
                    <div class="case-img-wrap">
                        <img src="/${c.img}" alt="${c.name}" class="case-img" onerror="this.style.opacity='0.3'">
                        <div class="case-glow"></div>
                    </div>
                    <div class="case-name">${c.name}</div>
                    <div class="case-price-row">
                        <img src="/toncoin-ton-logo.png" class="case-ton-ic">
                        <span>${c.price} TON</span>
                    </div>
                </div>`;
            }).join('')}
        </div>
    </div>`;
    
    // Запускаем таймер в списке
    if(case6Status && !case6Status.available && case6Status.nextAvailableAt) {
        const timerEl = document.getElementById('case6-timer-list');
        if(timerEl) {
            if(case6TimerInterval) clearInterval(case6TimerInterval);
            case6TimerInterval = setInterval(() => {
                const t = formatCountdown(case6Status.nextAvailableAt);
                if(timerEl) timerEl.innerText = t;
                if(!t) { clearInterval(case6TimerInterval); case6Status={available:true}; renderCasesList(); }
            }, 1000);
        }
    }
}

async function openCaseDetail(caseId) {
    currentCaseId = caseId;
    caseOpenCount = 1;

    // Для бесплатного кейса - всегда берём свежий конфиг (каналы могут поменяться)
    let cfg = casesConfig.find(c => c.id === caseId);
    if(cfg && cfg.isFree) {
        try {
            const r = await fetch('/api/cases/config?_t='+Date.now());
            const d = await r.json();
            casesConfig = d.cases || casesConfig;
            cfg = casesConfig.find(c => c.id === caseId) || cfg;
        } catch(e) {}
    }
    if (!cfg) return;

    if(cfg.isFree) {
        await checkCase6Status();
        if(case6Status && !case6Status.available) {
            renderCaseDetail(cfg);
            // Запускаем таймер
            if(case6Status.nextAvailableAt) startCase6Timer(case6Status.nextAvailableAt, ()=>{case6Status={available:true};renderCaseDetail(cfg);});
            return;
        }
        const channels = cfg.channels || [];
        renderCaseDetail(cfg);
        if(channels.length > 0) {
            setTimeout(()=>showCase6ChannelBottomSheet(cfg), 100);
        }
        return;
    }
    renderCaseDetail(cfg);
}

function renderCaseDetail(cfg) {
    const page = $('page-cases');
    if(!page) return;
    const totalW = cfg.drops.reduce((s,d)=>s+d.w, 0);
    const isFree = cfg.isFree === true;
    const cost = isFree ? 0 : Number((cfg.price * caseOpenCount).toFixed(2));
    const st = case6Status || {};
    const avail = !isFree || st.available !== false;
    
    page.innerHTML = `<div class="case-detail">
        <button class="case-back-btn" onclick="renderCasesList()">НАЗАД</button>
        
        <div class="case-detail-header">
            <div class="case-detail-img-wrap">
                <img src="/${cfg.img}" alt="${cfg.name}" class="case-detail-img" onerror="this.style.opacity='0.3'">
                <div class="case-detail-glow"></div>
            </div>
            <div class="case-detail-info">
                <div class="case-detail-name" style="${isFree?'color:#ffcc00;':''}">${cfg.name}</div>
                ${isFree
                    ? (avail
                        ? `<div class="case-price-free-badge">БЕСПЛАТНО</div>`
                        : `<div style="font-size:13px;color:#888;">Доступно через <span id="case6-timer" style="color:#ffcc00;font-weight:900;"></span></div>`)
                    : `<div class="case-detail-price"><img src="/toncoin-ton-logo.png" class="case-ton-ic"><span>${cfg.price} TON</span></div>`
                }
            </div>
        </div>
        
        ${!isFree ? `<!-- Счётчик количества -->
        <div class="case-count-row">
            <div class="case-count-label">Количество</div>
            <div class="case-counter">
                <button class="case-cnt-btn" onclick="setCaseCount(${Math.max(1,caseOpenCount-1)}, '${cfg.id}')">−</button>
                <div class="case-cnt-val" id="case-cnt-val">${caseOpenCount}</div>
                <button class="case-cnt-btn" onclick="setCaseCount(${Math.min(5,caseOpenCount+1)}, '${cfg.id}')">+</button>
            </div>
            <div class="case-total-cost" id="case-total-cost">
                <img src="/toncoin-ton-logo.png" class="case-ton-ic">
                <span id="case-total-num">${cost}</span> TON
            </div>
        </div>` : ''}
        
        <!-- Рулетки (1-5 штук) -->
        <div class="case-roulettes-container" id="case-roulettes-container"></div>
        
        <!-- Результаты -->
        <div id="case-results-grid" style="display:none;"></div>
        
        <!-- Кнопка открытия -->
        ${isFree
            ? (avail
                ? `<button id="case-open-btn" class="btn" style="background:var(--neon);color:#000;font-weight:900;" onclick="openFreeCase('${cfg.id}')">Открыть Лоникс Гифт</button>`
                : `<button id="case-open-btn" class="btn" disabled style="background:#1a1a2e;color:#555;cursor:not-allowed;">Недоступно — ждите таймера</button>`)
            : `<button id="case-open-btn" class="btn case-open-btn" onclick="playCaseOpen('${cfg.id}', ${cfg.price})">Открыть за ${cost} TON</button>`
        }
        
        <!-- Список дропов -->
        <div class="case-drops-title">ВОЗМОЖНЫЕ ВЫИГРЫШИ</div>
        <div class="case-drops-grid">
            ${cfg.drops.map(d => {
                const pct = (d.w/totalW*100).toFixed(1);
                let rar = '';
                if(d.val >= cfg.price*5) rar='drop-jackpot';
                else if(d.val >= cfg.price*2) rar='drop-rare';
                else if(d.val >= cfg.price*0.9) rar='drop-mid';
                return `<div class="case-drop-item ${rar}">
                    <img src="/toncoin-ton-logo.png" class="drop-ton-ic">
                    <div class="drop-val">${d.val}</div>
                    <div class="drop-pct">${pct}%</div>
                </div>`;
            }).join('')}
        </div>
    </div>`;
}

function setCaseCount(n, caseId) {
    caseOpenCount = Math.min(5, Math.max(1, n));
    const cfg = casesConfig.find(c=>c.id===caseId);
    if(!cfg) return;
    const cost = Number((cfg.price * caseOpenCount).toFixed(2));
    const cntEl = $('case-cnt-val');
    const costEl = $('case-total-num');
    const btnEl  = $('case-open-btn');
    if(cntEl) cntEl.innerText = caseOpenCount;
    if(costEl) costEl.innerText = cost;
    if(btnEl) btnEl.innerText = `Открыть за ${cost} TON`;
}

function buildRouletteStrip(drops, winVal) {
    const totalW = drops.reduce((s,d)=>s+d.w, 0);
    const strip = [];
    for(let i=0;i<62;i++){
        let r=Math.random()*totalW;
        let picked=drops[drops.length-1].val;
        for(const d of drops){r-=d.w;if(r<=0){picked=d.val;break;}}
        strip.push(picked);
    }
    // Near-miss: редкие призы рядом с позицией 50 но не на ней
    if(drops.length > 3) {
        const big = drops[drops.length-2].val;
        strip[47] = big;
        strip[53] = big;
    }
    strip[50] = winVal; // реальный результат ровно по центру
    return strip;
}


async function openFreeCase(caseId) {
    // Свежий конфиг для актуальных каналов
    try{const r=await fetch('/api/cases/config?_t='+Date.now());const d=await r.json();casesConfig=d.cases||casesConfig;}catch(e){}
    const cfg = casesConfig.find(c=>c.id===caseId);
    if(!cfg) return;
    const channels = cfg.channels || [];
    if(channels.length > 0) {
        showCase6ChannelBottomSheet(cfg);
    } else {
        playCaseOpen(caseId, 0);
    }
}
async function playCaseOpen(caseId, price) {
    if (caseIsOpening) return;
    const cfg = casesConfig.find(c=>c.id===caseId);
    if(!cfg) return;
    // Бесплатный кейс: только 1, только если доступен
    const realCount = cfg.isFree ? 1 : caseOpenCount;
    const totalCost = Number((price * realCount).toFixed(2));
    if(cfg.isFree && case6Status && !case6Status.available) {
        return showToast('Кейс ещё не доступен');
    }
    const bal = mode==='demo' ? user.demo_balance : user.balance;
    if (!cfg.isFree && bal < totalCost) return showToast('Недостаточно средств');
    
    const btn = $('case-open-btn');
    if(!btn) return;
    
    caseIsOpening = true;
    btn.disabled = true;
    btn.innerText = 'Открываем...';
    const resGrid = $('case-results-grid');
    if(resGrid) resGrid.style.display='none';
    
    // Запрашиваем сервер
    let serverData;
    try {
        const r = await fetch('/api/cases/open', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({id:user.id, caseId, mode, count: realCount})
        });
        serverData = await r.json();
        if(!r.ok){ showToast(serverData.error||'Ошибка'); caseIsOpening=false; btn.disabled=false; btn.innerText=`Открыть за ${totalCost} TON`; return; }
    } catch(e) { showToast('Ошибка соединения'); caseIsOpening=false; btn.disabled=false; btn.innerText=`Открыть за ${totalCost} TON`; return; }
    
    const results = serverData.results || [serverData.win];
    
    // Рендерим рулетки
    const container = $('case-roulettes-container');
    if(!container) return;
    container.innerHTML = '';
    
    const ITEM_W = 80;
    const rouletteEls = [];
    
    results.forEach((winVal, idx) => {
        const strip = buildRouletteStrip(cfg.drops, winVal);
        const wrap = document.createElement('div');
        wrap.className = 'case-roulette-wrap';
        wrap.id = `rl-wrap-${idx}`;
        wrap.innerHTML = `
            <div class="case-roulette-pointer"></div>
            <div class="case-roulette" id="rl-${idx}">
                ${strip.map(v=>{
                    let cls='rl-item';
                    if(v>=cfg.price*5)cls+=' rl-jackpot';
                    else if(v>=cfg.price*2)cls+=' rl-rare';
                    else if(v>=cfg.price*0.9)cls+=' rl-mid';
                    return `<div class="${cls}"><img src="/toncoin-ton-logo.png" class="rl-ton"><span>${v}</span></div>`;
                }).join('')}
            </div>`;
        container.appendChild(wrap);
        rouletteEls.push({id:`rl-${idx}`, winVal});
    });
    
    // Небольшая задержка чтобы DOM отрисовался
    await new Promise(res=>setTimeout(res,60));
    
    // Запускаем анимации с небольшим сдвигом между лентами
    const ITEM_FULL = 81; // 78px item + 3px gap
    const spinPromises = rouletteEls.map(({id, winVal}, idx) => {
        return new Promise(async (resolve) => {
            const rl = $(id);
            if(!rl){ resolve(); return; }
            
            // Ждём рендер для получения реальной ширины
            await new Promise(r2=>setTimeout(r2, idx * 150 + 20));
            
            const wrap = rl.parentElement;
            const containerW = wrap ? wrap.offsetWidth : 320;
            const centerX = containerW / 2; // пиксель-центр контейнера
            // Позиция левого края item[50]: 50 * ITEM_FULL + 3 (padding-left)
            const item50Left = 50 * ITEM_FULL + 6;
            const item50Center = item50Left + ITEM_FULL / 2 - 6;
            // translateX чтобы item50Center совпал с centerX контейнера
            const targetPos = item50Center - centerX;
            
            rl.style.transition = 'none';
            rl.style.transform = 'translateX(0px)';
            await new Promise(r2=>requestAnimationFrame(()=>requestAnimationFrame(r2)));
            
            const spinDuration = 4200 + idx * 250;
            // Сначала быстро до targetPos * 0.7, потом замедляемся точно
            rl.style.transition = `transform ${spinDuration}ms cubic-bezier(0.12, 0.0, 0.04, 1.0)`;
            rl.style.transform = `translateX(-${targetPos}px)`;
            
            await new Promise(r2=>setTimeout(r2, spinDuration + 50));
            
            // Убеждаемся что стоим точно
            rl.style.transition = 'none';
            rl.style.transform = `translateX(-${targetPos}px)`;
            
            // Подсвечиваем выигрышный элемент
            const items = rl.querySelectorAll('.rl-item');
            if(items[50]) items[50].classList.add('rl-winner');
            
            resolve();
        });
    });
    
    await Promise.all(spinPromises);
    
    // Показываем результаты
    user = serverData.user;
    updateUI();
    
    const totalWin = serverData.totalWin;
    const totalProfit = serverData.totalProfit;
    const isProfit = totalProfit >= 0;
    
    if(resGrid) {
        resGrid.style.display = 'grid';
        resGrid.style.gridTemplateColumns = results.length === 1 ? '1fr' : results.length <= 2 ? '1fr 1fr' : results.length <= 4 ? '1fr 1fr' : '1fr 1fr 1fr';
        resGrid.style.gap = '8px';
        resGrid.style.marginBottom = '12px';
        
        let resHtml = results.map(v => {
            const diff = v - price;
            const pos = diff >= 0;
            return `<div class="case-single-result ${pos?'csw-pos':'csw-neg'}">
                <img src="/toncoin-ton-logo.png" class="csr-ton">
                <div class="csr-val">${v}</div>
                <div class="csr-diff" style="color:${pos?'#00ff88':'#ff2255'}">${pos?'+':''}${diff.toFixed(2)}</div>
            </div>`;
        }).join('');
        
        if(results.length > 1) {
            resHtml += `<div class="case-total-result ${isProfit?'ctr-pos':'ctr-neg'}" style="grid-column:1/-1;">
                <span>Итого: </span>
                <img src="/toncoin-ton-logo.png" class="csr-ton">
                <span class="ctr-sum">${totalWin}</span>
                <span style="color:${isProfit?'#00ff88':'#ff2255'};font-size:13px;">${isProfit?'+':''}${totalProfit.toFixed(2)}</span>
            </div>`;
        }
        
        resHtml += `<button class="btn cr-collect-btn" onclick="caseCollect('${caseId}', ${price})" style="grid-column:1/-1;background:var(--neon);color:#000;font-weight:900;">Забрать ${price > 0 ? price.toFixed(2) + ' TON' : 'кэш'}</button>`;
        resGrid.innerHTML = resHtml;
    }
    
    if(isProfit){ playSound('win'); flyToBalance(totalWin); }
    else playSound('hit');
    
    // Обновляем статус case6
    if(cfg && cfg.isFree) {
        case6Status = {available:false, nextAvailableAt: new Date(Date.now()+24*3600000).toISOString()};
        startCase6Timer(case6Status.nextAvailableAt, ()=>{ case6Status={available:true}; });
    }
    
    caseIsOpening = false;
    btn.disabled = false;
    btn.innerText = cfg && cfg.isFree ? 'Лоникс Гифт открыт!' : `Открыть ещё раз (${Number((price*(cfg?.isFree?1:caseOpenCount)).toFixed(2))} TON)`;
}

function caseCollect(caseId, price) {
    const res=$('case-results-grid');
    if(res) res.style.display='none';
    const container=$('case-roulettes-container');
    if(container) container.innerHTML='';
    const btn=$('case-open-btn');
    if(btn) btn.innerText=`Открыть за ${Number((price*caseOpenCount).toFixed(2))} TON`;
}

// Admin: настройка кейсов
function adminShowCaseSettings(selectedCaseId) {
    if(selectedCaseId) { adminShowSingleCaseSettings(selectedCaseId); return; }
    const c=$('admin-content');if(!c)return;
    fetch('/api/cases/config?_t='+Date.now()).then(r=>r.json()).then(d=>{
        casesConfig=d.cases||[];
        const cases=d.cases||[];
        let html='<div>';
        html+=`<button onclick="adminShowCaseStats()" style="background:linear-gradient(135deg,#ce93d8,#9c27b0);color:#000;padding:9px 14px;border-radius:10px;cursor:pointer;font-size:13px;font-weight:800;width:100%;margin-bottom:12px;border:none;">Статистика всех кейсов</button>`;
        cases.forEach(cas=>{
            html+=`<div class="adm-block" style="margin-bottom:8px;">
<div style="display:flex;justify-content:space-between;align-items:center;">
<div><b style="color:#fff;">${cas.name}</b><span style="color:#888;font-size:11px;margin-left:8px;">${cas.isFree?'БЕСПЛАТНЫЙ':cas.price+' TON'}</span></div>
<div style="display:flex;gap:6px;">
<button onclick="adminShowCaseStats('${cas.id}')" style="background:#0d2a33;border:1px solid #ce93d844;color:#ce93d8;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:11px;">Стата</button>
<button onclick="adminShowCaseSettings('${cas.id}')" style="background:#0d2a33;border:1px solid #00e5ff;color:#00e5ff;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:11px;">Ред.</button>
</div>
</div></div>`;
        });
        html+='</div>';
        c.innerHTML=html;
    });
}

async function adminShowCaseStats(caseId) {
    const c=$('admin-content');if(!c)return;
    c.innerHTML='<div class="adm-block" style="text-align:center;padding:20px;color:var(--neon);">Загрузка статистики...</div>';
    try {
        const r=await fetch('/api/admin/case_stats',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:adminPass,caseId})});
        const d=await r.json();
        if(!r.ok){c.innerHTML='<div style="color:red;">Ошибка</div>';return;}
        const stats=d.stats||[];
        let html=`<div class="adm-block">
<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
<button onclick="adminShowCaseSettings()" class="adm-back-btn">← Назад</button>
<div class="adm-block-title" style="margin-bottom:0;">${caseId?'Стата: '+caseId:'Статистика кейсов'}</div>
</div>`;
        let totalBet=0,totalPayout=0,totalOpens=0;
        stats.forEach(cs=>{totalBet+=cs.totalBet;totalPayout+=cs.totalPayout;totalOpens+=cs.openCount;});
        const totalP=totalBet-totalPayout;
        html+=`<div style="text-align:center;margin-bottom:10px;">
<div style="font-size:10px;color:#888;margin-bottom:4px;">ИТОГО КЕЙСЫ</div>
<div style="font-size:22px;font-weight:900;color:${totalP>=0?'var(--neon)':'#ff2255'};">${totalP>=0?'+':''}${totalP.toFixed(2)} TON</div>
<div style="font-size:11px;color:#555;margin-top:4px;">Открытий: ${totalOpens} | Ввод: ${totalBet.toFixed(2)} | Выплаты: ${totalPayout.toFixed(2)}</div>
</div></div>`;
        stats.forEach(cs=>{
            const profit=cs.totalBet-cs.totalPayout;
            html+=`<div class="adm-block">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
<b style="color:#ce93d8;font-size:14px;">${cs.caseName}</b>
<span style="font-size:16px;font-weight:900;color:${profit>=0?'var(--neon)':'#ff2255'}">${profit>=0?'+':''}${profit.toFixed(2)}</span>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:8px;">
<div class="adm-stat-chip"><span>Открытий</span><b>${cs.openCount}</b></div>
<div class="adm-stat-chip"><span>Ввод</span><b>${cs.totalBet.toFixed(2)}T</b></div>
<div class="adm-stat-chip"><span>Выплаты</span><b>${cs.totalPayout.toFixed(2)}T</b></div>
</div>
${cs.topPlayers&&cs.topPlayers.length?`<div style="font-size:11px;color:#555;margin-bottom:4px;">Топ игроков:</div>
${cs.topPlayers.slice(0,5).map(p=>`<div class="adm-player-row"><span>${p.username}</span><span style="color:#00e5ff;">x${p.count} | ${p.won.toFixed(2)} TON</span></div>`).join('')}`:''}
</div>`;
        });
        c.innerHTML=html;
    }catch(e){c.innerHTML='<div style="color:#ff2255;padding:20px;text-align:center;">Ошибка соединения</div>';}
}

function adminShowSingleCaseSettings(caseId) {
    const c=$('admin-content');if(!c)return;
    // Загружаем конфиг
    fetch('/api/cases/config').then(r=>r.json()).then(d=>{
        const cases=d.cases||[];
        const cfg=cases.find(x=>x.id===caseId);
        if(!cfg){c.innerHTML='<div style="color:red;">Кейс не найден</div>';return;}
        // Обновляем casesConfig
        casesConfig=cases;
        const totalW=cfg.drops.reduce((s,x)=>s+x.w,0);
        const ev=cfg.drops.reduce((s,x)=>s+x.val*x.w/totalW,0);
        const rtp=cfg.isFree?'—':(ev/cfg.price*100).toFixed(1)+'%';
        let html=`<div>
<div class="adm-block" style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
<button onclick="adminShowCaseSettings()" class="adm-back-btn">← Назад</button>
<b style="color:#fff;font-size:15px;">${cfg.name}</b>
<span style="margin-left:auto;font-size:11px;color:#888;">RTP: ${rtp}</span>
</div>`;
        // Бесплатный кейс
        if(cfg.isFree){
            html+=`<div class="adm-block">
<div class="adm-block-title">БОНУСНЫЙ КЕЙС</div>
<div class="adm-rtp-row" style="margin-bottom:8px;">
<div class="adm-rtp-label">Кулдаун (часов)</div>
<input type="number" id="c6_cooldown" class="input-box adm-rtp-inp" value="${cfg.cooldownHours||24}" min="1" max="720">
<button class="adm-ok-btn" onclick="adminSaveCase6Settings()">OK</button>
</div>
<div class="adm-block-title" style="margin-top:8px;">Каналы для подписки</div>
<div id="c6-channels" style="margin-bottom:8px;">
${(cfg.channels||[]).map((ch,i)=>`<div class="adm-channel-row">
<input type="text" id="c6ch_${i}" class="input-box" value="${ch}" style="flex:1;" placeholder="@channel">
<button onclick="this.parentNode.remove()" class="adm-del-btn">X</button>
</div>`).join('')}
</div>
<button onclick="adminAddChannel6()" class="adm-add-btn">+ Добавить канал</button>
</div>`;
        } else {
            html+=`<div class="adm-block">
<div class="adm-rtp-row">
<div class="adm-rtp-label">Цена кейса</div>
<input type="number" id="cp_${cfg.id}" class="input-box adm-rtp-inp" value="${cfg.price}" step="0.5" min="0.1">
<button class="adm-ok-btn" onclick="adminSaveCasePrice('${cfg.id}')">OK</button>
</div>
</div>`;
        }
        // Дропы
        html+=`<div class="adm-block">
<div class="adm-block-title">ДРОПЫ (сумма : вес)</div>
<div id="drops_${cfg.id}">
${cfg.drops.map((d,i)=>`<div class="adm-drop-row">
<input type="number" id="dv_${cfg.id}_${i}" class="input-box adm-drop-inp" value="${d.val}" step="0.01">
<span class="adm-drop-sep">:</span>
<input type="number" id="dw_${cfg.id}_${i}" class="input-box adm-drop-inp" value="${d.w}">
<span class="adm-drop-pct">${(d.w/totalW*100).toFixed(1)}%</span>
<button onclick="adminRemoveDrop('${cfg.id}',${i})" class="adm-del-btn">X</button>
</div>`).join('')}
</div>
<button onclick="adminAddDrop('${cfg.id}')" class="adm-add-btn" style="margin-top:4px;">+ Позиция</button>
<div style="display:flex;gap:8px;margin-top:10px;">
<button onclick="adminSaveCaseDrops('${cfg.id}',${cfg.drops.length})" class="btn" style="flex:1;background:linear-gradient(135deg,#00e5ff,#0097a7);color:#000;font-weight:900;">Сохранить дропы</button>
<button onclick="adminShowCaseStats('${cfg.id}')" class="btn" style="flex:1;background:#0d2a33;border:1px solid #ce93d844;color:#ce93d8;">Статистика</button>
</div>
</div>
</div>`;
        c.innerHTML=html;
    });
}


async function adminSaveCase6Settings(){
    const cooldown=parseInt(document.getElementById('c6_cooldown')?.value||24);
    const chInputs=document.querySelectorAll('[id^="c6ch_"]');
    const channels=Array.from(chInputs).map(el=>el.value.trim().replace(/^@/,'')).filter(v=>v);
    const r=await fetch('/api/admin/set_case_config',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({pass:adminPass,caseId:'case6',cooldownHours:cooldown,channels})
    });
    if(r.ok){
        showToast('Настройки Лоникс Гифт сохранены');
        casesConfig=[];
        // Перезагружаем конфиг чтобы case6Status был актуальным
        await checkCase6Status();
    }else showToast('Ошибка сохранения');
}
function adminAddChannel6(){
    const cont=document.getElementById('c6-channels');if(!cont)return;
    const i=cont.querySelectorAll('[id^="c6ch_"]').length;
    const div=document.createElement('div');
    div.className='adm-channel-row';
    div.innerHTML=`<input type="text" id="c6ch_${i}" class="input-box" style="flex:1;" placeholder="@channel (без @)">
<button onclick="this.parentNode.remove()" class="adm-del-btn">X</button>`;
    cont.appendChild(div);
}
let _dropCounts={};
function adminAddDrop(caseId){
    const cas=casesConfig.find(x=>x.id===caseId)||(window._caseAdminData||[]).find(x=>x.id===caseId);
    const container=document.getElementById('drops_'+caseId);if(!container)return;
    const idx=container.querySelectorAll('[id^="dv_"]').length;
    const div=document.createElement('div');div.style.cssText='display:flex;gap:6px;margin-bottom:4px;align-items:center;';
    div.innerHTML=`<input type="number" id="dv_${caseId}_${idx}" class="input-box" value="1" step="0.01" style="width:70px;"><span style="color:#555;">:</span><input type="number" id="dw_${caseId}_${idx}" class="input-box" value="100" style="width:70px;"><span style="color:#888;font-size:10px;">new</span><button onclick="this.parentNode.remove()" style="background:#2a0808;border:1px solid #ff2255;color:#ff2255;padding:3px 7px;border-radius:4px;cursor:pointer;font-size:10px;">X</button>`;
    container.appendChild(div);
}
function adminRemoveDrop(caseId,idx){
    const el=document.getElementById('drops_'+caseId);if(!el)return;
    const rows=el.querySelectorAll('div');if(rows[idx])rows[idx].remove();
}
async function adminSaveCasePrice(caseId){
    const v=parseFloat(document.getElementById('cp_'+caseId)?.value||0);if(!v||v<=0)return showToast('Неверная цена');
    const r=await fetch('/api/admin/set_case_config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:adminPass,caseId,price:v})});
    if(r.ok){showToast('Цена сохранена');casesConfig=[];}else showToast('Ошибка');
}
async function adminSaveCaseDrops(caseId, origLen){
    const container=document.getElementById('drops_'+caseId);if(!container)return;
    const dvEls=container.querySelectorAll('[id^="dv_"]');
    const dwEls=container.querySelectorAll('[id^="dw_"]');
    const drops=[];
    dvEls.forEach((el,i)=>{
        const v=parseFloat(el.value);const w=parseInt(dwEls[i]?.value||0);
        if(v>0&&w>0)drops.push({val:v,w});
    });
    if(drops.length<2)return showToast('Минимум 2 дропа');
    const r=await fetch('/api/admin/set_case_config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:adminPass,caseId,drops})});
    if(r.ok){const totalW=drops.reduce((s,d)=>s+d.w,0);const ev=drops.reduce((s,d)=>s+d.val*d.w/totalW,0);const price=parseFloat(document.getElementById('cp_'+caseId)?.value||1);showToast('Сохранено. RTP='+(ev/price*100).toFixed(1)+'%');casesConfig=[];}
    else{const d=await r.json();showToast('Ошибка: '+(d.error||'?'));}
}

// ===================== UPGRADE GAME =====================
let isUpgrading=false,upgChance=50;
function upgMult(c){if(c<=10)return Math.round((20+(9.6-20)*(c-1)/9)*100)/100;return Math.max(1.01,Math.floor(96/c*100)/100);}
function upgColor(c){const t=c/90;let r,g,b;if(t<0.55){const ss=t/0.55;r=255;g=Math.round(34+(200-34)*ss);b=Math.round(85*(1-ss));}else{const ss=(t-0.55)/0.45;r=Math.round(255*(1-ss));g=Math.round(200+(230-200)*ss);b=Math.round(118*ss);}return 'rgb('+r+','+g+','+b+')';}
function upgRefresh(){const bet=parseFloat($('up-bet')?$('up-bet').value:0)||0,c=Math.min(90,upgChance),mult=upgMult(c),color=upgColor(c);const disk=document.querySelector('.upg-disk');if(disk)disk.style.background='conic-gradient('+color+' 0% '+c+'%,#1a1a2e '+c+'% 100%)';if($('upg-chance-pct')){$('upg-chance-pct').innerText=c+'%';$('upg-chance-pct').style.color=color;}if($('upg-slider-val'))$('upg-slider-val').innerText=c+'%';if($('upg-mult-val'))$('upg-mult-val').innerText='x'+mult;if($('upg-win-val'))$('upg-win-val').innerText='+'+parseFloat((bet*(mult-1)).toFixed(2))+' TON';}
function upgSetChance(v){if(isUpgrading)return;upgChance=Math.max(1,Math.min(90,parseInt(v)||50));if($('upg-slider'))$('upg-slider').value=upgChance;upgRefresh();playSound('click');}
function upgSetBet(v){if($('up-bet'))$('up-bet').value=v;upgRefresh();playSound('click');}
function initUpgradePage(){upgChance=50;if($('upg-slider'))$('upg-slider').value=50;upgRefresh();}
function upgSpinDisk(winPct,isWin,onDone){const disk=document.querySelector('.upg-disk');if(!disk){if(onDone)onDone();return;}const winA=(Math.min(winPct,90)/100)*360;let targetR;if(isWin){const lo=360-winA,hi=360,mg=Math.max(4,winA*0.07);targetR=(lo+mg)+Math.random()*((hi-mg)-(lo+mg));}else{const lo=0,hi=360-winA,mg=Math.max(4,(360-winA)*0.07);targetR=(lo+mg)+Math.random()*((hi-mg)-(lo+mg));}const spinMs=2500+Math.random()*3000,totalRot=(3+Math.floor(spinMs/1000))*360+targetR;disk.style.transition='none';disk.style.transform='rotate(0deg)';requestAnimationFrame(()=>requestAnimationFrame(()=>{disk.style.transition='transform '+spinMs+'ms cubic-bezier(0.15,0.0,0.08,1.0)';disk.style.transform='rotate('+totalRot+'deg)';}));setTimeout(()=>{disk.style.transition='none';disk.style.transform='rotate('+targetR+'deg)';if(onDone)onDone();},spinMs+80);}
async function playUpgrade(){if(isUpgrading)return;const betVal=parseFloat($('up-bet')?.value);if(isNaN(betVal)||betVal<0.1||betVal>25)return showToast('Мин 0.1, Макс 25 TON');if(betVal>(mode==='demo'?user.demo_balance:user.balance))return showToast('Недостаточно средств');isUpgrading=true;const btn=$('up-btn'),sldr=$('upg-slider'),resEl=$('upgrade-result');if(btn){btn.disabled=true;btn.innerText='...';}if(sldr)sldr.disabled=true;if(resEl){resEl.innerText='';resEl.style.color='';}playSound('click');try{const r=await fetch('/api/upgrade',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:user.id,bet:betVal,chance:upgChance,mode})});const data=await r.json();if(!r.ok){showToast(data.error||'Ошибка');return;}upgSpinDisk(upgChance,data.win>0,()=>{user=data.user;updateUI();upgRefresh();const profit=data.profit!==undefined?data.profit:(data.win>0?data.win-betVal:-betVal);if(resEl){resEl.innerText=data.win>0?'+'+profit.toFixed(2)+' TON (x'+data.multiplier+')':'-'+betVal.toFixed(2)+' TON';resEl.style.color=data.win>0?'#00ff88':'#ff0055';}if(data.win>0){playSound('win');flyToBalance(profit);showToast('+'+profit.toFixed(2)+' TON');}else showToast('-'+betVal.toFixed(2)+' TON');});}catch(e){showToast('Ошибка соединения');}finally{setTimeout(()=>{isUpgrading=false;if(btn){btn.disabled=false;btn.innerText='АПГРЕЙД ⬆️';}if(sldr)sldr.disabled=false;},7000);}
}
// ===================== PLINKO GAME =====================
let plinkoRisk = 'medium';
let isPlinkoing = false;
function setPlinkoRisk(risk, btn) {
    plinkoRisk = risk;
    if (btn) {
        const parent = btn.closest('div');
        if (parent) parent.querySelectorAll('.qb-btn').forEach(b => b.classList.remove('qb-sel'));
        btn.classList.add('qb-sel');
    }
}

async function playPlinko() {
    if (isPlinkoing) return;
    const betVal = parseFloat($('pl-bet')?.value);
    if (isNaN(betVal) || betVal < 0.1 || betVal > 25) return showToast('Мин 0.1, Макс 25 TON');
    const bal = mode === 'demo' ? user.demo_balance : user.balance;
    if (betVal > bal) return showToast('Недостаточно средств');
    isPlinkoing = true;
    const btn = $('pl-btn');
    if (btn) btn.disabled = true;
    playSound('click');
    try {
        const r = await fetch('/api/plinko', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: user.id, bet: betVal, mode, risk: plinkoRisk }) });
        const data = await r.json();
        if (!r.ok) { showToast(data.error || 'Ошибка'); return; }
        user = data.user; updateUI();
        // Animate plinko ball on canvas
        animatePlinkoBall(data.path, data.slotIndex, data.multiplier, data.win, betVal);
    } catch (e) { showToast('Ошибка соединения'); } finally { isPlinkoing = false; if (btn) btn.disabled = false; }
}

function animatePlinkoBall(path, slotIndex, mult, win, bet) {
    const canvas = $('plinko-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const rows = 12;
    const slotCount = 13;
    const pinR = 3;
    const ballR = 6;
    const padTop = 30, padBot = 40;
    const rowH = (H - padTop - padBot) / rows;

    // Draw background pins
    ctx.clearRect(0, 0, W, H);
    for (let r = 0; r < rows; r++) {
        const pinsInRow = r + 3;
        const rowW = (pinsInRow - 1) * (W / (slotCount + 1));
        const startX = (W - rowW) / 2;
        for (let p = 0; p < pinsInRow; p++) {
            ctx.beginPath();
            ctx.arc(startX + p * (rowW / (pinsInRow - 1 || 1)), padTop + r * rowH, pinR, 0, Math.PI * 2);
            ctx.fillStyle = '#444';
            ctx.fill();
        }
    }

    // Draw slot multipliers at bottom
    const mults = plinkoRisk === 'high' ? [10, 3, 1.5, 0.5, 0.3, 0.2, 0.3, 0.5, 1.5, 3, 10, 3, 1.5] :
                  plinkoRisk === 'low' ? [1.2, 1.1, 1.0, 0.7, 0.5, 0.3, 0.2, 0.3, 0.5, 0.7, 1.0, 1.1, 1.2] :
                  [2.0, 1.5, 1.2, 0.8, 0.5, 0.3, 0.2, 0.3, 0.5, 0.8, 1.2, 1.5, 2.0];

    for (let i = 0; i < slotCount; i++) {
        const x = (i + 0.5) * (W / slotCount);
        ctx.fillStyle = i === slotIndex ? '#e040fb' : '#222';
        ctx.fillRect(x - 10, H - padBot + 5, 20, 25);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 8px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(mults[i] + 'x', x, H - padBot + 22);
    }

    // Animate ball falling
    const ballPath = [];
    let bx = W / 2;
    for (let r = 0; r < rows; r++) {
        const dir = (path && path[r] !== undefined) ? path[r] : (Math.random() > 0.5 ? 1 : -1);
        bx += dir * (W / (slotCount + 1)) * 0.4;
        bx = Math.max(ballR, Math.min(W - ballR, bx));
        ballPath.push({ x: bx, y: padTop + r * rowH });
    }
    const finalX = (slotIndex + 0.5) * (W / slotCount);
    ballPath.push({ x: finalX, y: H - padBot });

    let frame = 0;
    const totalFrames = ballPath.length * 6;
    const drawFrame = () => {
        const idx = Math.min(Math.floor(frame / 6), ballPath.length - 1);
        const pos = ballPath[idx];

        // Redraw pins
        ctx.clearRect(0, 0, W, H);
        for (let r = 0; r < rows; r++) {
            const pinsInRow = r + 3;
            const rowW2 = (pinsInRow - 1) * (W / (slotCount + 1));
            const startX = (W - rowW2) / 2;
            for (let p = 0; p < pinsInRow; p++) {
                ctx.beginPath();
                ctx.arc(startX + p * (rowW2 / (pinsInRow - 1 || 1)), padTop + r * rowH, pinR, 0, Math.PI * 2);
                ctx.fillStyle = '#444';
                ctx.fill();
            }
        }
        // Slot labels
        for (let i = 0; i < slotCount; i++) {
            const sx = (i + 0.5) * (W / slotCount);
            ctx.fillStyle = i === slotIndex ? '#e040fb' : '#222';
            ctx.fillRect(sx - 10, H - padBot + 5, 20, 25);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 8px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(mults[i] + 'x', sx, H - padBot + 22);
        }
        // Ball
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, ballR, 0, Math.PI * 2);
        ctx.fillStyle = '#e040fb';
        ctx.shadowColor = '#e040fb';
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;

        frame++;
        if (frame < totalFrames) {
            requestAnimationFrame(drawFrame);
        } else {
            // Done
            const result = $('plinko-result');
            if (result) {
                result.innerText = win > 0 ? `${mult}x = +${win.toFixed(2)} TON` : `${mult}x = -${bet.toFixed(2)} TON`;
                result.style.color = win >= bet ? '#00ff88' : '#ff0055';
            }
            if (win > 0) { playSound('win'); flyToBalance(win); }
        }
    };
    requestAnimationFrame(drawFrame);
}

// ===================== DUCK GAME =====================
let isDuckPlaying = false;
function initDuckPond() {
    const pond = $('duck-pond');
    if (!pond) return;
    pond.innerHTML = '';
    for (let i = 0; i < 15; i++) {
        const cell = document.createElement('div');
        cell.style.cssText = 'aspect-ratio:1; background:#1a1a1a; border-radius:10px; border:1px solid #333; display:flex; align-items:center; justify-content:center; font-size:28px; cursor:pointer; transition:0.2s;';
        cell.innerText = '🌊';
        cell.dataset.idx = i;
        pond.appendChild(cell);
    }
}

async function playDuck() {
    if (isDuckPlaying) return;
    const betVal = parseFloat($('dk-bet')?.value);
    if (isNaN(betVal) || betVal < 0.1 || betVal > 25) return showToast('Мин 0.1, Макс 25 TON');
    const bal = mode === 'demo' ? user.demo_balance : user.balance;
    if (betVal > bal) return showToast('Недостаточно средств');
    isDuckPlaying = true;
    const btn = $('dk-btn');
    if (btn) btn.disabled = true;
    playSound('click');
    try {
        const duckCount = 3 + Math.floor(Math.random() * 3);
        const r = await fetch('/api/duck', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: user.id, bet: betVal, mode, duckCount }) });
        const data = await r.json();
        if (!r.ok) { showToast(data.error || 'Ошибка'); return; }
        user = data.user; updateUI();
        // Reveal ducks on pond
        const pond = $('duck-pond');
        if (pond) {
            const cells = pond.querySelectorAll('div');
            const duckPositions = data.duckPositions || [];
            cells.forEach((c, i) => {
                setTimeout(() => {
                    if (duckPositions.includes(i)) {
                        c.innerText = '🦆';
                        c.style.background = data.win > 0 ? '#1b3a1b' : '#3a1b1b';
                        c.style.borderColor = data.win > 0 ? '#00ff88' : '#ff0055';
                    } else {
                        c.innerText = '🌊';
                        c.style.background = '#111';
                    }
                }, i * 80);
            });
            setTimeout(() => {
                const result = $('duck-result');
                if (result) {
                    result.innerText = data.win > 0 ? `+${data.win.toFixed(2)} TON` : `-${betVal.toFixed(2)} TON`;
                    result.style.color = data.win > 0 ? '#00ff88' : '#ff0055';
                }
                if (data.win > 0) { playSound('win'); flyToBalance(data.win); }
            }, 15 * 80 + 200);
        }
    } catch (e) { showToast('Ошибка соединения'); } finally {
        setTimeout(() => { isDuckPlaying = false; if (btn) btn.disabled = false; initDuckPond(); }, 15 * 80 + 1500);
    }
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
