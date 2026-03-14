<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
    <title>Loonx Gifts</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <script src="https://unpkg.com/@tonconnect/ui@latest/dist/tonconnect-ui.min.js"></script>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        /* --- GLOBAL STYLES --- */
        :root { --bg: #09090b; --card: #18181b; --accent: #00ff88; --text: #ffffff; --sub: #a1a1aa; }
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: -apple-system, sans-serif; -webkit-tap-highlight-color: transparent; }
        body { background: var(--bg); color: var(--text); overflow: hidden; height: 100vh; display: flex; flex-direction: column; }
        
        /* --- LOADER --- */
        #loader { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: #000; z-index: 9999; display: flex; flex-direction: column; justify-content: center; align-items: center; transition: opacity 0.5s; }
        .spinner { width: 50px; height: 50px; border: 3px solid rgba(255,255,255,0.1); border-top: 3px solid #fff; border-radius: 50%; animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        
        /* --- HEADER --- */
        header { padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; background: rgba(9,9,11,0.8); backdrop-filter: blur(10px); z-index: 10; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .user-box { display: flex; align-items: center; gap: 10px; cursor: pointer; }
        .avatar { width: 40px; height: 40px; border-radius: 12px; background: var(--card); border: 1px solid var(--accent); }
        .u-name { font-weight: 800; font-size: 15px; }
        .u-online { font-size: 11px; color: var(--accent); display: flex; align-items: center; gap: 4px; }
        .dot { width: 6px; height: 6px; background: var(--accent); border-radius: 50%; box-shadow: 0 0 5px var(--accent); }
        .bal-box { text-align: right; }
        .bal-val { font-size: 18px; font-weight: 900; }
        .bal-sub { font-size: 9px; color: var(--sub); text-transform: uppercase; }

        /* --- LAYOUT & PAGES --- */
        .content { flex: 1; overflow-y: auto; padding: 20px; padding-bottom: 90px; }
        .page { display: none; animation: fadeIn 0.3s; }
        .page.active { display: block; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

        /* --- CARDS & BUTTONS --- */
        .game-card { background: var(--card); border-radius: 18px; padding: 15px; margin-bottom: 15px; display: flex; align-items: center; gap: 15px; border: 1px solid rgba(255,255,255,0.05); }
        .game-card:active { transform: scale(0.98); }
        .g-icon { width: 50px; height: 50px; border-radius: 12px; display: flex; justify-content: center; align-items: center; font-size: 24px; }
        .ic-crash { background: linear-gradient(135deg, #ff0055, #ff007f); }
        .ic-mines { background: linear-gradient(135deg, #00ff88, #00b0ff); }
        .ic-coin { background: linear-gradient(135deg, #ffcc00, #ff8800); }
        
        .btn { width: 100%; padding: 15px; background: var(--accent); color: #000; border: none; border-radius: 12px; font-weight: 800; font-size: 16px; margin-top: 10px; }
        .btn-outline { background: transparent; border: 1px solid var(--sub); color: var(--text); }
        input.bet-input { width: 100%; padding: 15px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; border-radius: 12px; font-size: 18px; text-align: center; outline: none; margin-bottom: 10px; }

        /* --- HOT BAR --- */
        .hot-bar { position: fixed; bottom: 0; left: 0; width: 100%; background: rgba(24,24,27,0.95); backdrop-filter: blur(10px); display: flex; justify-content: space-around; padding: 15px 0 25px; border-top: 1px solid rgba(255,255,255,0.05); z-index: 100; }
        .nav-item { color: var(--sub); font-size: 11px; font-weight: 700; text-align: center; text-decoration: none; }
        .nav-item.active { color: var(--accent); }
        .nav-item svg { width: 24px; height: 24px; fill: currentColor; display: block; margin: 0 auto 4px; }

        /* --- TOAST --- */
        #toast { position: fixed; top: -100px; left: 50%; transform: translateX(-50%); background: var(--card); padding: 15px 30px; border-radius: 12px; border: 1px solid var(--accent); z-index: 10000; transition: 0.3s; font-weight: bold; }
        #toast.show { top: 20px; }
        #toast.error { border-color: #ff3b30; color: #ff3b30; }

        /* --- GAMES UI --- */
        .game-area { background: var(--card); border-radius: 20px; padding: 30px 20px; text-align: center; margin-bottom: 20px; min-height: 200px; display: flex; flex-direction: column; justify-content: center; border: 1px solid rgba(255,255,255,0.05); }
        #crash-mult { font-size: 48px; font-weight: 900; color: var(--text); text-shadow: 0 0 20px rgba(255,255,255,0.2); }
        
        .mines-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; max-width: 300px; margin: 0 auto; }
        .mine-cell { aspect-ratio: 1; background: rgba(255,255,255,0.05); border-radius: 8px; display: flex; justify-content: center; align-items: center; font-size: 24px; transition: 0.2s; }
        .mine-cell.open-gem { background: rgba(0,255,136,0.2); border: 1px solid var(--accent); }
        .mine-cell.open-bomb { background: rgba(255,59,48,0.2); border: 1px solid #ff3b30; }

        /* --- PROFILE & HISTORY --- */
        .history-item { display: flex; justify-content: space-between; padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 14px; }
        .hist-win { color: var(--accent); }
        .hist-lose { color: #ff3b30; }
        
        /* --- ADMIN PANEL --- */
        #admin-panel { display: none; position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.9); z-index: 9000; padding: 40px 20px; }
    </style>
</head>
<body>

    <div id="loader">
        <div class="spinner"></div>
        <h2 style="margin-top:20px; letter-spacing: 2px;">LOONX GIFTS</h2>
    </div>

    <header id="header-area">
        <div class="user-box">
            <div class="avatar"></div>
            <div>
                <div class="u-name" id="ui-name">Player</div>
                <div class="u-online"><div class="dot"></div> Онлайн: <span id="ui-online">1</span></div>
            </div>
        </div>
        <div class="bal-box">
            <div class="bal-val"><span id="ui-balance">0.00</span></div>
            <div class="bal-sub">TON BALANCE</div>
        </div>
    </header>

    <div class="content">
        
        <div id="page-games" class="page active">
            <h3 style="margin-bottom: 15px;">Все игры</h3>
            <div class="game-card" onclick="openGame('crash')">
                <div class="g-icon ic-crash">🚀</div>
                <div><b>CRASH</b><br><small class="bal-sub">Успей забрать до взрыва</small></div>
            </div>
            <div class="game-card" onclick="openGame('mines')">
                <div class="g-icon ic-mines">💣</div>
                <div><b>MINES</b><br><small class="bal-sub">Обойди мины, забери алмазы</small></div>
            </div>
            <div class="game-card" onclick="openGame('coinflip')">
                <div class="g-icon ic-coin">🪙</div>
                <div><b>COINFLIP</b><br><small class="bal-sub">Шанс 50/50 на удвоение</small></div>
            </div>
        </div>

        <div id="page-crash" class="page">
            <h3 style="margin-bottom: 15px; text-align:center;">CRASH</h3>
            <div class="game-area">
                <div id="crash-mult">1.00x</div>
            </div>
            <input type="number" id="crash-bet" class="bet-input" placeholder="Сумма ставки">
            <button class="btn" id="crash-btn" onclick="actionCrash()">ПОСТАВИТЬ</button>
            <button class="btn btn-outline" style="margin-top:10px;" onclick="nav('games')">НАЗАД</button>
        </div>

        <div id="page-mines" class="page">
            <h3 style="margin-bottom: 15px; text-align:center;">MINES</h3>
            <div class="game-area" style="padding: 15px;">
                <div class="mines-grid" id="mines-grid"></div>
            </div>
            <input type="number" id="mines-bet" class="bet-input" placeholder="Сумма ставки">
            <button class="btn" id="mines-btn" onclick="startMines()">НАЧАТЬ (5 МИН)</button>
            <button class="btn btn-outline" style="margin-top:10px;" onclick="nav('games')">НАЗАД</button>
        </div>

        <div id="page-wallet" class="page">
            <h3 style="margin-bottom: 15px; text-align:center;">Депозит</h3>
            <div style="background:var(--card); padding:20px; border-radius:20px; text-align:center; border: 1px solid rgba(255,255,255,0.05);">
                <div id="ton-connect-btn" style="display:flex; justify-content:center; margin-bottom:20px;"></div>
                <input type="number" id="dep-amount" class="bet-input" placeholder="Сумма пополнения (TON)">
                <button class="btn" onclick="sendDeposit()">ПОПОЛНИТЬ</button>
            </div>
        </div>

        <div id="page-profile" class="page">
            <h3 style="margin-bottom: 15px;">Профиль и История</h3>
            
            <div style="display:flex; gap:10px; margin-bottom: 20px;">
                <a href="https://t.me/Loonxnews" target="_blank" class="btn btn-outline" style="flex:1; text-align:center; text-decoration:none; font-size:12px;">📣 Канал</a>
                <a href="https://t.me/LoonxGift_Support" target="_blank" class="btn btn-outline" style="flex:1; text-align:center; text-decoration:none; font-size:12px;">🆘 Саппорт</a>
            </div>

            <div style="background:var(--card); border-radius:18px; padding:15px; border: 1px solid rgba(255,255,255,0.05);">
                <h4 style="margin-bottom: 10px; color:var(--sub);">Последние игры</h4>
                <div id="history-list">
                    <div style="text-align:center; color:var(--sub); padding:10px;">История пуста</div>
                </div>
            </div>
        </div>
    </div>

    <div class="hot-bar">
        <a href="#" class="nav-item active" onclick="nav('games', this)">
            <svg viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>Игры
        </a>
        <a href="#" class="nav-item" onclick="nav('wallet', this)">
            <svg viewBox="0 0 24 24"><path d="M21 18v1c0 1.1-.9 2-2 2H5c-1.11 0-2-.9-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.11 0-2-.9-2-2v8c0 1.1.89 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>Кошелек
        </a>
        <a href="#" class="nav-item" onclick="nav('profile', this)">
            <svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>Профиль
        </a>
    </div>

    <div id="toast">Сообщение</div>

    <div id="admin-panel">
        <h2 style="color:var(--accent); text-align:center; margin-bottom: 20px;">[ ADM ENGINE ]</h2>
        <div style="background:var(--card); padding:20px; border-radius:12px; border:1px solid var(--accent);">
            <p>RTP Control: <input type="range" min="1" max="100" value="85" style="width:100%"></p>
            <p>Выдать баланс ID:</p>
            <input type="text" class="bet-input">
            <button class="btn">ВЫДАТЬ</button>
            <button class="btn btn-outline" style="margin-top:20px;" onclick="document.getElementById('admin-panel').style.display='none'">ЗАКРЫТЬ</button>
        </div>
    </div>

    <script src="script.js"></script>
</body>
</html>
