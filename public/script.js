const tg = window.Telegram.WebApp;
const socket = io();
let user = null; let mode = 'real'; let adminPass = '';
let globalRtp = { crash: 90, mines: 90, coinflip: 90 };
let maintenance = { crash: false, mines: false, coinflip: false };
let adminWalletAddress = '';

// ИСПРАВЛЕНИЕ 1: Правильный TON Manifest
const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: 'https://loonxgift.onrender.com/tonconnect-manifest.json', 
    buttonRootId: 'ton-connect-btn'
});

const $ = id => document.getElementById(id);
function showToast(msg, dur=3000) {
    const c = $('toast-container'), t = document.createElement('div'); 
    t.className = 'toast'; t.innerText = msg; c.appendChild(t); setTimeout(() => t.remove(), dur);
}
function copyText(text) { navigator.clipboard.writeText(text).then(() => showToast('Скопировано!')); }

window.onload = async () => {
    tg.expand();
    const res = await fetch('/api/auth', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(tg.initDataUnsafe.user || {id: "123", username: "Dev", photo_url: ""})
    });
    const data = await res.json();
    if(data.error === "BLOCKED") return document.body.innerHTML = "<h1 style='color:red; text-align:center; margin-top:50px;'>ВЫ ЗАБЛОКИРОВАНЫ</h1>";
    
    user = data.user; globalRtp = data.rtp; maintenance = data.maintenance;
    adminWalletAddress = data.adminWallet || '';
    $('dep-wallet').innerText = adminWalletAddress || 'Кошелек не настроен'; $('dep-memo').innerText = user.id;
    
    $('loader').style.opacity = '0'; setTimeout(() => $('loader').style.display = 'none', 500);
    
    const avaUrl = user.avatar || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
    $('user-ava').src = avaUrl; $('profile-ava').src = avaUrl;
    $('profile-name').innerText = user.username || 'Игрок';
    updateUI(); renderWithdrawHistory();
};

function updateUI() {
    const bal = mode === 'real' ? user.balance : user.demo_balance;
    $('bal-val').innerText = bal.toFixed(2);
    $('bal-mode').innerText = mode === 'real' ? 'REAL TON' : 'DEMO TON';
    $('bal-mode').style.color = mode === 'demo' ? 'var(--neon-blue)' : 'var(--neon)';
    $('bal-mode').style.borderColor = mode === 'demo' ? 'var(--neon-blue)' : 'var(--neon)';
    
    $('p-bets').innerText = user.stats.bets; $('p-wins').innerText = user.stats.wins;
    $('p-plus').innerText = user.stats.plus.toFixed(2) + ' TON'; $('p-minus').innerText = user.stats.minus.toFixed(2) + ' TON';
}
function toggleMode() { mode = mode === 'real' ? 'demo' : 'real'; updateUI(); showToast(`Режим: ${mode}`); }
function nav(pageId, el) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active')); $('page-'+pageId).classList.add('active');
    if(el) { document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active')); el.classList.add('active'); }
}
function navGame(game) { if(maintenance[game]) return showToast('Тех. перерыв'); nav(game); }
function setBet(game, amount) { $(game+'-bet').value = amount; } // ИСПРАВЛЕНИЕ 2: Кнопки ставок

// ИСПРАВЛЕНИЕ 10: История выводов в кошельке
function renderWithdrawHistory() {
    const c = $('w-history-list');
    if(!user.withdrawHistory || user.withdrawHistory.length === 0) return c.innerHTML = '<div style="text-align:center; color:#555;">Пусто</div>';
    c.innerHTML = user.withdrawHistory.map(w => {
        let cls = w.status === 'Подтверждено' ? 'approved' : (w.status === 'Отклонено' ? 'rejected' : 'pending');
        let rsn = w.reason ? `<br><span style="color:var(--neon-red)">Причина: ${w.reason}</span>` : '';
        return `
            <div class="w-history-item ${cls}">
                <div><img src="${user.avatar}" style="width:20px; border-radius:50%; vertical-align:middle;"> <b>${w.amount} TON</b><br><span style="color:#888">${w.time}</span></div>
                <div style="text-align:right;">${w.status} ${rsn}</div>
            </div>`;
    }).join('');
}

// CRASH (ИСПРАВЛЕНИЕ 8: Градиент цвета кэфа)
function getCrashColor(x) {
    if(x < 1.3) return '#ff0055'; // Красный
    if(x < 1.6) return '#ffcc00'; // Желтый
    if(x < 2.0) return '#aaff00'; // Светло-зеленый
    return '#00ff88'; // Ядовито зеленый
}
socket.on('crashHistoryUpdate', hist => {
    $('cr-history').innerHTML = hist.map(x => `<div class="cr-badge" style="color:${getCrashColor(x)}; border-color:${getCrashColor(x)};">${x}x</div>`).join('');
});
let curCrash = {}; let myCrashBets = []; let isCashingOut = false;
socket.on('crashData', d => {
    curCrash = d; const btn = $('cr-btn');
    if(d.status === 'waiting') { 
        $('cr-x').innerText = 'ЖДЕМ'; $('cr-timer').innerText = `СТАРТ: ${d.timer}с`; $('cr-x').style.color = '#fff'; 
        if(myCrashBets.length===0) { btn.innerText='ПОСТАВИТЬ'; btn.disabled=false; btn.style.background='var(--neon)'; }
    }
    if(d.status === 'running') { 
        $('cr-x').innerText = d.multiplier + 'x'; $('cr-timer').innerText = '🚀 В ПОЛЕТЕ'; $('cr-x').style.color = getCrashColor(d.multiplier);
        if(myCrashBets.length>0) { btn.innerText = `ЗАБРАТЬ ${(myCrashBets[0]*d.multiplier).toFixed(2)}`; btn.style.background='var(--neon-red)'; btn.disabled=false; }
        else { btn.innerText='ОЖИДАНИЕ'; btn.disabled=true; btn.style.background='#555'; }
    }
    if(d.status === 'crashed') { $('cr-x').innerText = 'BOOM!'; $('cr-x').style.color = 'var(--neon-red)'; myCrashBets=[]; btn.innerText='ПОСТАВИТЬ'; btn.disabled=false; btn.style.background='var(--neon)'; isCashingOut=false; }
});
async function playCrash() {
    if(isCashingOut) return; const curBal = mode==='real'?user.balance:user.demo_balance;
    if(curCrash.status==='waiting') {
        let bet = parseFloat($('cr-bet').value); if(isNaN(bet)||bet<0.1) return showToast('Ошибка ставки'); if(bet>curBal) return showToast('Нет средств');
        isCashingOut=true; const r=await fetch('/api/bet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:user.id,game:'Crash',bet,win:0,mode})}); isCashingOut=false;
        if(r.ok){ user=await r.json(); updateUI(); myCrashBets.push(bet); $('cr-btn').innerText='В ИГРЕ'; $('cr-btn').disabled=true; showToast('Принято'); }
    } else if(curCrash.status==='running' && myCrashBets.length>0) {
        isCashingOut=true; const win=myCrashBets[0]*curCrash.multiplier;
        const r=await fetch('/api/bet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:user.id,game:'Crash',bet:0,win,mode})});
        if(r.ok){ user=await r.json(); updateUI(); myCrashBets=[]; showToast(`+${win.toFixed(2)} TON`); } isCashingOut=false;
    }
}

// MINES (ИСПРАВЛЕНИЕ 2: Открытие поля)
let miActive = false; let bombs = []; let miBet = 0; let openedCells = 0; let currentMinesWin = 0;
function playMines() {
    if(miActive) { reqBet('Mines', 0, currentMinesWin).then(ok=>{if(ok){miActive=false; $('mi-btn').innerText='ИГРАТЬ'; showToast(`Забрал ${currentMinesWin.toFixed(2)}`);}}); return; }
    miBet = parseFloat($('mi-bet').value); const curBal = mode==='real'?user.balance:user.demo_balance;
    if(isNaN(miBet)||miBet<0.1||miBet>curBal) return showToast('Ошибка ставки');
    reqBet('Mines', miBet, 0).then(ok=>{
        if(ok){
            bombs=[]; while(bombs.length<5){let r=Math.floor(Math.random()*25); if(!bombs.includes(r))bombs.push(r);}
            miActive=true; openedCells=0; currentMinesWin=miBet; $('mi-btn').innerText=`ЗАБРАТЬ ${currentMinesWin.toFixed(2)}`; renderMines();
        }
    });
}
function renderMines() {
    $('mine-grid').innerHTML='';
    for(let i=0;i<25;i++) {
        let c = document.createElement('div'); c.className='m-cell';
        c.onclick=()=>{
            if(!miActive || c.classList.contains('open')) return;
            let hit = bombs.includes(i); if(!hit && Math.random()>(globalRtp.mines/100)){ hit=true; bombs[0]=i; }
            if(hit) { 
                miActive=false; $('mi-btn').innerText='ИГРАТЬ'; showToast('БУМ!'); 
                // ПОКАЗЫВАЕМ ВСЕ ПОЛЕ ПРИ ПРОИГРЫШЕ
                document.querySelectorAll('.m-cell').forEach((cell, idx) => {
                    cell.innerText = bombs.includes(idx) ? '💣' : '💎';
                    if(bombs.includes(idx)) cell.style.background = 'var(--neon-red)';
                });
            } else { 
                c.innerText='💎'; c.classList.add('open'); c.style.borderColor='var(--neon)'; openedCells++;
                currentMinesWin = miBet*(1+openedCells*0.2); $('mi-btn').innerText=`ЗАБРАТЬ ${currentMinesWin.toFixed(2)}`; 
            }
        }; $('mine-grid').appendChild(c);
    }
}

// COINFLIP (ИСПРАВЛЕНИЕ 4: Настоящий RTP)
let cSide='L'; let isFlipping=false;
function setSide(s){if(isFlipping)return; cSide=s; $('side-l').classList.toggle('active',s==='L'); $('side-x').classList.toggle('active',s==='X');}
async function playCoin() {
    if(isFlipping) return; const bet=parseFloat($('co-bet').value); const curBal = mode==='real'?user.balance:user.demo_balance;
    if(isNaN(bet)||bet<0.1||bet>curBal) return showToast('Ошибка ставки');
    isFlipping=true; $('co-btn').innerText='КРУТИМ...';
    
    // Формула: если RTP 100, то шанс 50% (т.к кэф х2). Если RTP 90, шанс 45%.
    const winChance = (globalRtp.coinflip / 100) * 0.5; 
    const isWin = Math.random() < winChance;
    const result = isWin ? cSide : (cSide === 'L' ? 'X' : 'L');
    
    const coin = $('coin-3d'); coin.style.transform = `rotateY(${result==='L'?1800:1980}deg)`;
    setTimeout(async () => {
        const win = result===cSide ? bet*2 : 0; showToast(win>0?`+${win.toFixed(2)}`:`Проигрыш`); 
        await reqBet('Coinflip', bet, win);
        coin.style.transition='none'; coin.style.transform=`rotateY(${result==='L'?0:180}deg)`; setTimeout(()=>coin.style.transition='transform 2s',50);
        isFlipping=false; $('co-btn').innerText='КРУТИТЬ';
    }, 2000);
}

async function reqBet(game,bet,win) {
    const r=await fetch('/api/bet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:user.id,game,bet,win,mode})});
    if(r.ok){ user=await r.json(); updateUI(); return true; } return false;
}

// ФИНАНСЫ И ПРОМО
async function withdraw() {
    const amount=parseFloat($('with-amount').value), address=$('with-addr').value;
    if(amount>user.balance||amount<5) return showToast('Ошибка (Мин 5 TON)');
    const r=await fetch('/api/withdraw',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:user.id,address,amount})});
    if(r.ok){ user=await r.json(); updateUI(); renderWithdrawHistory(); showToast('Заявка создана'); $('with-amount').value=''; }
}
async function activatePromo() {
    const code=$('promo-code').value; const r=await fetch('/api/promo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:user.id,code})});
    if(r.ok){ user=await r.json(); updateUI(); showToast('Активировано!'); } else showToast('Ошибка промо');
}

// ADMIN (ИСПРАВЛЕНИЯ 5, 6, 7, 9)
let aTaps=0; let adData={}; let currentSearch = '';
async function checkAdmin(){ aTaps++; if(aTaps>=5){ aTaps=0; let p=prompt('Admin Pass:'); if(p){adminPass=p; loadAdmin();} } }
function switchAdminTab(tab){ document.querySelectorAll('.admin-tab').forEach(t=>t.classList.remove('active')); event.target.classList.add('active'); renderAdmin(tab); }

async function loadAdmin() {
    const r=await fetch('/api/admin/data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:adminPass})});
    if(r.ok){ adData=await r.json(); $('admin-modal').style.display='block'; renderAdmin('withdraws'); } else showToast('Неверный пароль');
}

function renderAdmin(tab) {
    const c = $('admin-content');
    if(tab==='withdraws') {
        c.innerHTML = adData.withdraws.map(w=>`
            <div style="background:#1a1a1a; padding:10px; margin-bottom:5px; border-radius:5px;">
                <b>ID:</b> ${w.userId} | <b>${w.amount} TON</b><br><code>${w.address}</code><br>
                <button class="btn" style="padding:5px; background:var(--neon)" onclick="adminW('${w._id}', 'approve')">ОДОБРИТЬ</button>
                <button class="btn" style="padding:5px; background:var(--neon-red)" onclick="adminW('${w._id}', 'reject')">ОТКЛОНИТЬ</button>
            </div>`).join('') || 'Нет заявок';
    }
    if(tab==='promo') {
        c.innerHTML = adData.promos.map(p=>`
            <div style="padding:10px; border-bottom:1px solid #333;" onclick="alert('Активации:\\n' + JSON.stringify(${JSON.stringify(p.activatedBy).replace(/"/g, '&quot;')}, null, 2))">
                <b>${p.code}</b> | Осталось: ${p.limit - p.activations} | ${p.amount} TON<br><span style="font-size:10px;color:var(--neon)">Нажми, чтобы увидеть кто активировал</span>
            </div>`).join('');
    }
    if(tab==='rtp') {
        c.innerHTML = `
            <textarea id="ad-bot-msg" class="input-box" style="font-size:12px; height:60px;" placeholder="Сообщение ВСЕМ в бота"></textarea>
            <button class="btn" style="padding:8px; margin-bottom:20px;" onclick="adminBotBroadcast()">ОТПРАВИТЬ ВСЕМ В БОТА</button>
            <div>RTP Crash: ${adData.rtp.crash} | Mines: ${adData.rtp.mines} | Coin: ${adData.rtp.coinflip}</div>
        `;
    }
    if(tab==='users') {
        let filtered = adData.users.filter(u => u.username?.toLowerCase().includes(currentSearch) || u.id.includes(currentSearch));
        c.innerHTML = `
            <input type="text" class="input-box" placeholder="Поиск (ID / Юзер)" oninput="currentSearch=this.value.toLowerCase(); renderAdmin('users')">
            ${filtered.map(u=>`
            <div style="padding:10px; border-bottom:1px solid #333; position:relative;">
                <img src="${u.avatar}" style="width:25px; border-radius:50%; vertical-align:middle;"> 
                <a href="tg://user?id=${u.id}" style="color:var(--text); text-decoration:none;"><b>${u.username}</b></a> 
                (${u.balance.toFixed(2)} TON)
                ${u.isBlocked ? '<span style="color:red; font-size:10px;">[BANNED]</span>' : ''}
                <br>
                <button style="background:var(--neon-blue); color:#000; border:none; padding:4px; margin-top:5px; border-radius:4px;" onclick="adminMsgUser('${u.id}')">Написать в Бота</button>
                <button style="background:${u.isBlocked?'#888':'red'}; color:#fff; border:none; padding:4px; margin-top:5px; border-radius:4px;" onclick="adminBan('${u.id}', ${!u.isBlocked})">${u.isBlocked?'Разбанить':'ЗАБАНИТЬ'}</button>
            </div>`).join('')}`;
    }
}
async function adminW(wId, action) {
    let reason = ''; if(action === 'reject') reason = prompt('Укажите причину отказа (покажется юзеру):') || 'Нарушение правил';
    await fetch('/api/admin/withdraw_action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:adminPass,wId,action,reason})}); loadAdmin();
}
async function adminBan(userId, doBan) {
    await fetch('/api/admin/user_action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:adminPass,userId,action:doBan?'ban':'unban'})}); loadAdmin();
}
async function adminMsgUser(userId) {
    let msg = prompt('Текст сообщения юзеру в ЛС бота:'); if(!msg)return;
    await fetch('/api/admin/user_action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:adminPass,userId,action:'message',msg})}); showToast('Отправлено');
}
async function adminBotBroadcast() {
    let text = $('ad-bot-msg').value; if(!text)return;
    await fetch('/api/admin/broadcast_bot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:adminPass,text})}); showToast('Отправлено ВСЕМ'); $('ad-bot-msg').value='';
}
