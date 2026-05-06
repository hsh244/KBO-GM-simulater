/**
 * =====================================================================
 * KBO GM Simulator - Core Game Logic Engine
 *[통합 버전]: 로컬스토리지, 에이징 커브, 특별 훈련, 트레이드, FA 경매, 재정
 * =====================================================================
 */

/* =====================================================================[1. 전역 변수 및 상태 관리]
===================================================================== */
const LMD_CAP_LIMIT = 137.0; 
const LMD_MERC_CAP_LIMIT = 40.0;
const INITIAL_CASH = 50.0;   
const TEAM_NAMES =['KIA', '삼성', 'LG', '두산', 'KT', 'SSG', '롯데', '한화', 'NC', '키움'];

const SEASON_EVENTS = {
    '01-01': { id: 'broadcast_contract', title: '방송사 계약', desc: '새해 첫 업무로 방송권 중계 계약을 체결해야 합니다.', requiresAction: true, navMain: 'schedule', navSubPrefix: 's', navSubId: 'sch-broadcast' },
    '01-08': { id: 'season_preview', title: '시즌 프리뷰', desc: '10개 구단 예상 순위 및 주목할 선수 리포트가 발간되었습니다.', requiresAction: true, navMain: 'schedule', navSubPrefix: 's', navSubId: 'sch-briefing' },
    '01-15': { id: 'merc_bidding', title: '외국인 용병 입찰', desc: '용병 샐러리캡 40억 한도 내에서 외국인 선수를 입찰하세요.', requiresAction: true, navMain: 'roster', navSubPrefix: 'r', navSubId: 'roster-merc' },
    '01-22': { id: 'tryouts', title: '트라이아웃', desc: '전년도 방출자 및 가상 독립리그 선수 트라이아웃이 시작되었습니다.' },
    '02-01': { id: 'asian_quota', title: '아시아 쿼터 선발', desc: '아시아 쿼터 샐러리캡 한도 내에서 선수를 영입하세요.' },
    '02-08': { id: 'coach_contract', title: '코칭스태프 계약', desc: '새로운 코칭스태프를 구성하고 계약을 체결하세요.' },
    '02-15': { id: 'spring_camp', title: '스프링캠프', desc: '스프링캠프 장소를 선택하고 훈련을 진행하세요.' },
    '11-08': { id: 'rookie_draft', title: '신인 드래프트', desc: '신인 유망주 5라운드 지명이 시작됩니다.' },
    '11-15': { id: 'protected_list', title: '보호선수 명단 제출', desc: '20인/25인 보호선수 명단을 설정하여 제출하세요.' },
    '11-22': { id: 'fa_market', title: 'FA 시장 개장', desc: 'FA 시장이 열렸습니다. 필요한 선수를 영입하세요.', requiresAction: true, navMain: 'roster', navSubPrefix: 'r', navSubId: 'roster-fa' },
    '12-01': { id: 'merc_contract', title: '외국인 용병 최종 계약', desc: '내년 시즌을 함께할 외국인 용병과 최종 계약을 맺으세요.' },
    '12-08': { id: 'finishing_camp', title: '마무리 캠프', desc: '시즌을 마무리하는 훈련을 진행하세요.' },
    '12-25': { id: 'salary_nego', title: '연봉 협상 및 방출', desc: '기존 선수들과의 연봉 협상 및 잉여 전력 방출을 진행하세요.' }
};

let gameState = {
    currentDate: '2026-01-01', 
    userTeam: '',
    leagueData: {
        teams: {},
        players: []
    },
    transactionLog: [], 
    matchLogs:[],
    tradeCooldowns: {}, // AI 팀별 트레이드 쿨다운 날짜
    activeFABids: {},   // FA 진행 상태 저장
    completedEvents: {},
    pendingEvent: null,
    faMarket: [],
    mercMarket: []
};

let nameDB = null;

/* =====================================================================[2. 핵심 유틸리티 (숫자, 등급 변환)]
===================================================================== */
// 지저분한 난수 생성기 (Anti-rounding)
function generateMessyNumber(num, isDecimal = false) {
    if (isDecimal) {
        let str = num.toFixed(3);
        if (str.endsWith('0')) {
            let modifier = (Math.random() > 0.5 ? 1 : -1) * (Math.floor(Math.random() * 3) + 1);
            return parseFloat((parseFloat(str) + (modifier * 0.001)).toFixed(3));
        }
        return parseFloat(str);
    } else {
        let n = Math.round(num);
        if (n % 5 === 0 && n !== 0) {
            let modifier = (Math.random() > 0.5 ? 1 : -1) * (Math.floor(Math.random() * 3) + 1);
            n += modifier;
        }
        return n;
    }
}

// 1~100 스탯을 14단계 알파벳 등급으로 변환 (안개 시스템 UI용)
function getGradeFromStat(val) {
    if (val >= 95) return "S";
    if (val >= 90) return "A+";
    if (val >= 85) return "A";
    if (val >= 80) return "A-";
    if (val >= 75) return "B+";
    if (val >= 70) return "B";
    if (val >= 65) return "B-";
    if (val >= 60) return "C+";
    if (val >= 55) return "C";
    if (val >= 50) return "C-";
    if (val >= 45) return "D+";
    if (val >= 40) return "D";
    if (val >= 35) return "D-";
    return "F";
}

// 선수 평균 오버롤 계산
function getPlayerOverallStat(p) {
    if (p.isPitcher) return (p.stats.stf + p.stats.ctl + p.stats.sta) / 3;
    else return (p.stats.con + p.stats.pow + p.stats.eye + p.stats.def) / 4;
}

// 알파벳 등급을 내부 트레이드 가치 계산용 숫자로 변환
function getGradeScore(grade) {
    if(!grade) return 10;
    if(grade.includes('S')) return 100;
    if(grade.includes('A')) return 80;
    if(grade.includes('B')) return 60;
    if(grade.includes('C')) return 40;
    return 20; // D or F
}

/* =====================================================================
    [3. 이름 생성 엔진 (Name Generator & Integrity)]
===================================================================== */
async function initNameGenerator() {
    try {
        const response = await fetch('./names.json');
        nameDB = await response.json();
        console.log("[LMD] 이름 생성 데이터베이스 로드 완료.");
    } catch (error) {
        console.warn("[LMD Warn] names.json 로드 실패. 예비(Fallback) 작명 DB를 가동합니다.", error);
        nameDB = {
            korean: {
                surnames:["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임"],
                givenNames:["민수", "지훈", "성진", "준호", "도현", "현우", "건우", "우진", "민재", "동주", "도영"]
            },
            usa_latin: {
                firstNames: ["J.", "M.", "크리스", "데이비드"],
                lastNames:["스미스", "로드리게스", "윌리엄스", "존슨"]
            },
            japan: {
                lastNames: ["사토", "다나카", "스즈키", "다카하시"],
                firstNames: ["켄지", "쇼", "다이키", "렌"]
            },
            blacklist: ["유재석", "손흥민", "김타자", "이투수"]
        };
    }
}

function getRandomItem(array) {
    return array[Math.floor(Math.random() * array.length)];
}

function generatePlayerName(nationality = 'KOR') {
    if (!nameDB) return nationality === 'KOR' ? "김야구" : "J.도우";

    let isBlacklisted = true;
    let finalName = "";
    let attempts = 0; 

    while (isBlacklisted && attempts < 10) {
        if (nationality === 'KOR') {
            finalName = getRandomItem(nameDB.korean.surnames) + getRandomItem(nameDB.korean.givenNames);
        } else if (nationality === 'USA/LATIN') {
            let first = getRandomItem(nameDB.usa_latin.firstNames);
            let last = getRandomItem(nameDB.usa_latin.lastNames);
            finalName = first.endsWith('.') ? first + last : first + " " + last;
        } else if (nationality === 'JPN') {
            finalName = getRandomItem(nameDB.japan.lastNames) + " " + getRandomItem(nameDB.japan.firstNames);
        } else {
            finalName = "Unknown";
        }

        const hasForbiddenWord = nameDB.blacklist.some(forbidden => finalName.includes(forbidden));
        if (!hasForbiddenWord) isBlacklisted = false;
        attempts++;
    }

    if (isBlacklisted) return nationality === 'KOR' ? "김무명" : "J.도우";
    return finalName;
}

/* =====================================================================
    [4. 세이브 / 로드 / UI 컨트롤]
===================================================================== */
function saveGame() {
    localStorage.setItem('kbo_save_data', JSON.stringify(gameState));
    showToast("✓ 자동 저장됨");
}

function createToastContainer() {
    if (!document.getElementById('toast-container')) {
        const style = document.createElement('style');
        style.innerHTML = `
            #toast-container { position: fixed; bottom: 80px; right: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 10px; }
            .toast {
                background: rgba(0, 0, 0, 0.85); color: #48c774; border: 1px solid #48c774; padding: 10px 20px; border-radius: 5px; 
                font-family: 'Courier New', monospace; font-size: 13px; font-weight: bold;
                opacity: 0; transform: translateY(10px); transition: all 0.3s ease; box-shadow: 0 4px 6px rgba(0,0,0,0.5);
            }
            .toast.show { opacity: 1; transform: translateY(0); }
        `;
        document.head.appendChild(style);
        const div = document.createElement('div');
        div.id = 'toast-container';
        document.body.appendChild(div);
    }
}

function showToast(msg) {
    const container = document.getElementById('toast-container');
    if(!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast show'; toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 2000);
}

function openSaveLoad() {
    const data = btoa(unescape(encodeURIComponent(JSON.stringify(gameState))));
    showModal("데이터 수동 관리", `
        <p style="font-size:13px;">[백업 코드]</p><textarea id="save-data" readonly>${data}</textarea><hr style="border-color:#333; margin:15px 0;">
        <p style="font-size:13px;">[불러오기]</p><textarea id="load-data"></textarea>
        <button class="btn primary" style="margin-top:10px;" onclick="executeManualLoad()">코드 기반 복구</button>
        <h4 style="margin-top:30px; color:#f25c54;">Danger Zone</h4>
        <button class="btn danger" onclick="resetSaveData()">데이터 완전 초기화 (새 게임)</button>
    `);
}

function executeManualLoad() {
    try { 
        gameState = JSON.parse(decodeURIComponent(escape(atob(document.getElementById('load-data').value)))); 
        document.getElementById('dash-team-name').innerText = gameState.userTeam; 
        saveGame(); updateUI(); closeModal(); 
    } catch(e) { alert("손상된 데이터 코드입니다."); }
}

function resetSaveData() {
    if(confirm("모든 세이브 데이터가 삭제됩니다. 계속하시겠습니까?")) {
        localStorage.removeItem('kbo_save_data'); location.reload();
    }
}

function switchTab(tabId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + tabId).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    event.currentTarget.classList.add('active');
    document.querySelector('main').scrollTo(0, 0); 
}

function switchSubTab(prefix, subId) {
    const parentView = document.getElementById(`view-${prefix==='r'?'roster':'schedule'}`);
    parentView.querySelectorAll('.sub-view').forEach(v => v.classList.remove('active'));
    document.getElementById('sub-' + subId).classList.add('active');
    parentView.querySelectorAll(`.sub-btn-${prefix}`).forEach(btn => btn.classList.remove('active'));
    event.currentTarget.classList.add('active');
}

function showModal(t, h) { 
    let m = document.getElementById('modal');
    if(m) { document.getElementById('modal-title').innerText = t; document.getElementById('modal-body').innerHTML = h; m.style.display = 'flex'; }
}
function closeModal() { let m = document.getElementById('modal'); if(m) m.style.display = 'none'; }

function addTransactionLog(msg) {
    gameState.transactionLog.unshift(`[${gameState.currentDate}] ${msg}`);
    if(gameState.transactionLog.length > 50) gameState.transactionLog.pop();
    const inbox = document.getElementById('dash-inbox');
    if(inbox) inbox.innerHTML = gameState.transactionLog.join('<br>');
}

/* =====================================================================[5. 게임 부트 및 로스터 초기화]
===================================================================== */
window.onload = async () => {
    createToastContainer(); 
    await initNameGenerator();

    const savedData = localStorage.getItem('kbo_save_data');
    if (savedData) {
        try {
            gameState = JSON.parse(savedData);
            document.getElementById('dash-team-name').innerText = gameState.userTeam;
            document.getElementById('team-selection-screen').style.display = 'none';
            document.getElementById('game-ui').style.display = 'flex';
            updateUI(); showToast("세이브 데이터를 불러왔습니다.");
        } catch (e) {
            console.error("세이브 로드 실패", e); renderTeamSelection();
        }
    } else {
        renderTeamSelection();
    }
};

function renderTeamSelection() {
    const container = document.getElementById('team-buttons');
    container.innerHTML = '';
    TEAM_NAMES.forEach(team => {
        const btn = document.createElement('button'); btn.className = 'btn primary'; btn.style.margin = '0';
        btn.innerText = team; btn.onclick = () => startGame(team); container.appendChild(btn);
    });
}

async function startGame(selectedTeam) {
    gameState.userTeam = selectedTeam;
    document.getElementById('dash-team-name').innerText = selectedTeam;
    document.getElementById('team-selection-screen').style.display = 'none';
    document.getElementById('game-ui').style.display = 'flex';
    await initGame();
}

async function initGame() {
    gameState.tradeCooldowns = {};
    gameState.activeFABids = {};
    gameState.completedEvents = {};
    gameState.pendingEvent = null;

    TEAM_NAMES.forEach(name => {
        gameState.leagueData.teams[name] = { 
            name: name, wins: 0, draws: 0, losses: 0, streak: 0, cash: INITIAL_CASH, capLimit: LMD_CAP_LIMIT,
            homeGamesThisMonth: 0, coachesSalary: 9.0, financeLog: null 
        };
    });

    try {
        const flowRes = await fetch('./season_flow.json');
        if (!flowRes.ok) throw new Error("HTTP error " + flowRes.status);
        const flowData = await flowRes.json();
        console.log("[LMD] season_flow.json 로드 완료.");
    } catch (error) {
        console.warn("[SYSTEM] season_flow.json 로드 실패.", error);
        alert("[경고] season_flow.json 파일을 불러오지 못했습니다.\nGitHub 저장소에 파일이 정상적으로 업로드되었는지 확인해주세요.");
    }

    try {
        const rosterRes = await fetch('./roster.json');
        if (!rosterRes.ok) throw new Error("HTTP error " + rosterRes.status);
        const rosterData = await rosterRes.json();
        parseAndLoadExternalRoster(rosterData);
    } catch (error) {
        console.warn("[SYSTEM] roster.json 로드 실패. 자체 엔진을 가동합니다.", error);
        alert("[경고] roster.json 파일을 불러오지 못해 임시(가상) 로스터가 생성되었습니다.\nGitHub 저장소 파일 상태(대소문자, 업로드 여부)를 점검해주세요.");
        generateFallbackRoster();
    }

    addTransactionLog(`[취임] ${gameState.userTeam} 신임 단장 부임. 2026 시즌 준비 완료.`);
    renderMarketList(); updateUI(); saveGame();
}

function parseAndLoadExternalRoster(dataArray) {
    gameState.leagueData.players =[];
    
    // roster.json의 긴 팀명을 game_logic.js의 짧은 팀명으로 변환하기 위한 맵
    const teamMap = {
        "KIA Tigers": "KIA", "삼성라이온즈": "삼성", "LG 트윈스": "LG", 
        "두산베어스": "두산", "KT Wiz": "KT", "SSG 랜더스": "SSG", 
        "롯데 자이언츠": "롯데", "한화이글스": "한화", "NC 다이노스": "NC", "키움 히어로즈": "키움"
    };

    dataArray.forEach((p, idx) => {
        let isP = p.type === 'Pitcher';
        let posStr = p.position;
        if(posStr === 'Starter') posStr = 'SP';
        if(posStr === 'Bullpen' || posStr === 'Setup') posStr = 'RP';
        if(posStr === 'Closer') posStr = 'CP';
        if(posStr === 'Bench') posStr = isP ? 'RP' : '1B'; 
        if(posStr === '2nd Team') posStr = isP ? 'RP' : 'LF';

        let mappedTeam = teamMap[p.team] || p.team;

        let player = {
            id: `${mappedTeam}-${idx}`, team: mappedTeam, name: p.name, age: p.age,
            isPitcher: isP, pos: posStr, tier: p.tier, 
            salary: Math.floor(Math.random() * 10) + 0.5,
            gradeCurr: ['S', 'A', 'B', 'C', 'D'][Math.floor(Math.random()*5)],
            hidden: { gradePot: ['S', 'A', 'B', 'C'][Math.floor(Math.random()*4)], adaptability: Math.floor(Math.random() * 100) },
            seasonRecords: { G: 0, IP: 0, ER: 0, PA: 0, H: 0 },
            stats: isP ? { vel: Math.floor(Math.random()*20)+135, stf: Math.floor(Math.random()*50)+40, ctl: Math.floor(Math.random()*50)+40, sta: Math.floor(Math.random()*50)+40 } 
                       : { con: Math.floor(Math.random()*50)+40, pow: Math.floor(Math.random()*50)+40, eye: Math.floor(Math.random()*50)+40, def: Math.floor(Math.random()*50)+40 }
        };
        gameState.leagueData.players.push(player);
    });
}

function generateFallbackRoster() {
    const reqBatters =['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']; 
    TEAM_NAMES.forEach(team => {
        let t1SP=0, t1RP=0, t1CP=0; let t1B=0; let filledBatters =[];
        for(let i=0; i<50; i++) {
            const isPitcher = i < 25;
            let tier = 2; let pos = '';

            if (isPitcher) {
                if (t1SP < 5) { pos = 'SP'; tier = 1; t1SP++; }
                else if (t1CP < 1) { pos = 'CP'; tier = 1; t1CP++; }
                else if (t1RP < 7) { pos = 'RP'; tier = 1; t1RP++; }
                else { pos =['SP','RP','CP'][Math.floor(Math.random()*3)]; tier = 2; }
            } else {
                if (filledBatters.length < reqBatters.length) { pos = reqBatters[filledBatters.length]; tier = 1; filledBatters.push(pos); } 
                else if (t1B < 15) { pos =['C', ...reqBatters][Math.floor(Math.random()*9)]; tier = 1; } 
                else { pos =['C', ...reqBatters][Math.floor(Math.random()*9)]; tier = 2; }
                t1B++;
            }

            gameState.leagueData.players.push({
                id: `${team}-${i}`, team: team, name: generatePlayerName('KOR'), age: Math.floor(Math.random() * 18) + 19,
                isPitcher: isPitcher, pos: pos, tier: tier, salary: Math.floor(Math.random() * 10) + 0.5,
                gradeCurr: ['S', 'A', 'B', 'C', 'D'][Math.floor(Math.random()*5)],
                hidden: { gradePot: ['S', 'A', 'B', 'C'][Math.floor(Math.random()*4)], adaptability: Math.floor(Math.random() * 100) },
                seasonRecords: { G: 0, IP: 0, ER: 0, PA: 0, H: 0 },
                stats: isPitcher ? { vel: Math.floor(Math.random()*20)+135, stf: Math.floor(Math.random()*50)+40, ctl: Math.floor(Math.random()*50)+40, sta: Math.floor(Math.random()*50)+40 } 
                           : { con: Math.floor(Math.random()*50)+40, pow: Math.floor(Math.random()*50)+40, eye: Math.floor(Math.random()*50)+40, def: Math.floor(Math.random()*50)+40 }
            });
        }
    });
}

/* =====================================================================[6. 시뮬레이션 엔진 및 에이징 커브]
===================================================================== */
function resolvePendingEvent() {
    if (!gameState.pendingEvent) return;
    let currentYear = new Date(gameState.currentDate).getFullYear();
    let eventYearKey = `${currentYear}-${gameState.pendingEvent.id}`;
    
    gameState.completedEvents[eventYearKey] = true;
    addTransactionLog(`[일정 완료] ${gameState.pendingEvent.title}`);
    gameState.pendingEvent = null;
    closeModal();
    updateUI();
    saveGame();
}

function forceNavigateToEvent(mainTab, subTabPrefix, subTabId) {
    closeModal();
    document.querySelector(`button[onclick="switchTab('${mainTab}')"]`).click();
    setTimeout(() => {
        let subBtn = document.querySelector(`button[onclick="switchSubTab('${subTabPrefix}', '${subTabId}')"]`);
        if(subBtn) subBtn.click();
    }, 50);
}

function signBroadcastContract(amount, broadcaster) {
    if (gameState.pendingEvent && gameState.pendingEvent.id === 'broadcast_contract') {
        const myTeam = gameState.leagueData.teams[gameState.userTeam];
        myTeam.cash += amount;
        addTransactionLog(`[계약] ${broadcaster}와 ${amount}억 원에 중계권 계약을 체결했습니다.`);
        alert(`${broadcaster}와 성공적으로 계약했습니다!\n구단 자금에 ${amount}억 원이 입금되었습니다.`);
        resolvePendingEvent();
    } else {
        alert("현재 방송사 계약 진행 기간이 아닙니다.");
    }
}

function completeSeasonBriefing() {
    if (gameState.pendingEvent && gameState.pendingEvent.id === 'season_preview') {
        alert("시즌 브리핑 열람을 완료했습니다. 이제 다음 날짜로 넘어갈 수 있습니다.");
        resolvePendingEvent();
    } else {
        alert("현재 시즌 프리뷰 열람 기간이 아닙니다.");
    }
}

function showEventModal(eventConfig) {
    let buttonHtml = `<button class="btn primary" onclick="resolvePendingEvent()">일정 확인 및 완료</button>`;
    
    if (eventConfig.requiresAction) {
        buttonHtml = `<button class="btn" style="background-color:var(--accent-blue); color:white; font-weight:bold; border:none;" onclick="forceNavigateToEvent('${eventConfig.navMain}', '${eventConfig.navSubPrefix}', '${eventConfig.navSubId}')">해당 탭으로 이동하여 완료하기 ➔</button>`;
    }

    showModal("⚠️ 필수 시즌 일정 발생", `
        <div style="text-align:center; padding: 20px;">
            <h3 style="color:var(--accent-blue);">${eventConfig.title}</h3>
            <p>${eventConfig.desc}</p>
            <p style="font-size:13px; color:var(--accent-red); margin:20px 0;">이 일정을 완료해야만 다음 날짜로 시뮬레이션할 수 있습니다.</p>
            ${buttonHtml}
        </div>
    `);
}

function advanceDays(days) {
    if (gameState.pendingEvent) {
        showEventModal(gameState.pendingEvent);
        return;
    }

    for(let d=0; d<days; d++) {
        let currentDateObj = new Date(gameState.currentDate);
        let monthStr = String(currentDateObj.getMonth() + 1).padStart(2, '0');
        let dayStr = String(currentDateObj.getDate()).padStart(2, '0');
        let dateKey = `${monthStr}-${dayStr}`;
        
        let eventConfig = SEASON_EVENTS[dateKey];
        if (eventConfig) {
            let eventYearKey = `${currentDateObj.getFullYear()}-${eventConfig.id}`;
            if (!gameState.completedEvents) gameState.completedEvents = {};
            if (!gameState.completedEvents[eventYearKey]) {
                gameState.pendingEvent = eventConfig;

                if (eventConfig.id === 'fa_market') generateFAMarket();
                if (eventConfig.id === 'merc_bidding') generateMercMarket();

                showEventModal(eventConfig);
                updateUI();
                saveGame();
                return; // 필수 이벤트 발생 시 락(Lock)을 걸고 시뮬레이션 중단
            }
        }

        let oldMonth = currentDateObj.getMonth();
        let oldYear = currentDateObj.getFullYear();
        
        currentDateObj.setDate(currentDateObj.getDate() + 1);
        gameState.currentDate = currentDateObj.toISOString().split('T')[0];
        
        if (currentDateObj.getMonth() !== oldMonth) calculateMonthlyFinance(oldMonth, oldYear);
        if (currentDateObj.getFullYear() !== oldYear) executeYearlyTransition(currentDateObj.getFullYear());

        let currentMonth = currentDateObj.getMonth();
        // 정규 시즌(3월~9월)에만 무작위 시뮬레이션 경기 진행
        if (currentMonth >= 2 && currentMonth <= 8) {
            const shuffled = [...TEAM_NAMES].sort(() => 0.5 - Math.random());
            const dailyResults =[];
            for(let i=0; i<5; i++) {
                dailyResults.push(simulateMatch(shuffled[i*2], shuffled[i*2+1]));
            }
            gameState.matchLogs.unshift({ date: gameState.currentDate, matches: dailyResults });
            if(gameState.matchLogs.length > 50) gameState.matchLogs.pop();
        }
    }

    addTransactionLog(`${days}일간의 일정을 진행했습니다.`); 
    updateUI(); saveGame();
}

function executeYearlyTransition(newYear) {
    let msgList =[];
    
    gameState.leagueData.players.forEach(p => {
        if (p.tier === 'RELEASED') return; 
        
        p.age += 1;
        p.trainedThisYear = false; // 특별 훈련 플래그 초기화

        let r = Math.random(); let dropAmount = 0;

        if (p.age >= 38) { if (r < 0.7) { dropAmount = 3; p.retiring = true; } } 
        else if (p.age >= 35) { if (r < 0.5) dropAmount = 2; } 
        else if (p.age >= 32) { if (r < 0.3) dropAmount = 1.5; } 
        else if (p.age >= 29) { if (r < 0.1) dropAmount = 1; }

        if (p.winnersCurse && p.age < 35 && Math.random() < 0.4) {
            dropAmount = Math.max(dropAmount, 2); 
            p.winnersCurse = false; 
        }

        if (dropAmount > 0) {
            let actualDrops = Math.ceil(dropAmount);
            if (p.isPitcher) {
                let targetStats = ['stf', 'sta', 'ctl'];
                for (let i=0; i<actualDrops; i++) {
                    let target = targetStats[Math.floor(Math.random() * (i===0?2:3))];
                    p.stats[target] = Math.max(1, p.stats[target] - 5);
                }
                if (actualDrops >= 2 && Math.random() < 0.5) p.stats.vel -= 1;
            } else {
                let targetStats = ['eye', 'def', 'con', 'pow'];
                for (let i=0; i<actualDrops; i++) {
                    let target = targetStats[Math.floor(Math.random() * (i===0?2:4))];
                    p.stats[target] = Math.max(1, p.stats[target] - 5);
                }
            }
            if (p.team === gameState.userTeam && actualDrops >= 2) {
                msgList.push(`${p.name}(${p.age}): 노쇠화로 폼이 크게 하락했습니다.`);
            }
        }
    });

    addTransactionLog(`[새해] ${newYear}년이 밝았습니다. 에이징 커브가 적용되었습니다.`);
    if (msgList.length > 0) alert("[에이징 커브 리포트]\n" + msgList.join('\n'));
    saveGame();
}

function calculateMonthlyFinance(monthIndex, year) {
    const sortedTeams = Object.values(gameState.leagueData.teams).sort((a, b) => b.wins - a.wins);

    sortedTeams.forEach((team, index) => {
        let rank = index + 1;
        let avgAttendance = rank <= 3 ? 18000 + Math.random() * 4000 : (rank <= 7 ? 10000 + Math.random() * 5000 : 4000 + Math.random() * 4000);
        let gateRaw = team.homeGamesThisMonth * avgAttendance * 0.00015;
        let gateReceipts = generateMessyNumber(gateRaw, true);
        let broadcastIncome = monthIndex === 0 ? generateMessyNumber(50.0, true) : 0;
        let playerSalaryRaw = (monthIndex >= 1 && monthIndex <= 10) ? (calculateTeamPayroll(team.name) / 10.0) : 0;
        let playerSalary = generateMessyNumber(playerSalaryRaw, true);
        let coachSalary = generateMessyNumber(team.coachesSalary / 12.0, true);
        let opCost = generateMessyNumber(10.0, true);
        
        let netIncome = generateMessyNumber((gateReceipts + broadcastIncome) - (playerSalary + coachSalary + opCost), true);

        team.cash += netIncome;
        team.financeLog = { monthStr: `${year}년 ${monthIndex + 1}월`, homeGames: team.homeGamesThisMonth, gateReceipts: gateReceipts.toFixed(1), broadcastIncome: broadcastIncome.toFixed(1), playerSalary: playerSalary.toFixed(1), coachSalary: coachSalary.toFixed(1), opCost: opCost.toFixed(1), netIncome: netIncome.toFixed(1) };
        team.homeGamesThisMonth = 0;
    });
    addTransactionLog(`[결산] ${monthIndex + 1}월 구단 재정 결산 완료.`);
}

function getMissingPositions(teamName) {
    let t1Batters = gameState.leagueData.players.filter(p => p.team === teamName && p.tier === 1 && !p.isPitcher);
    let hasPos = { 'C':0, '1B':0, '2B':0, '3B':0, 'SS':0, 'LF':0, 'CF':0, 'RF':0 };
    t1Batters.forEach(p => { if(hasPos[p.pos] !== undefined) hasPos[p.pos]++; });
    let missing = 0; for(let key in hasPos) { if(hasPos[key] === 0) missing++; }
    return missing;
}

function simulateMatch(teamA, teamB) {
    let scoreA = Math.round(Math.random() * 7); let scoreB = Math.round(Math.random() * 7);
    let missA = getMissingPositions(teamA); let missB = getMissingPositions(teamB);
    
    if(missA > 0) { scoreB += (missA * 2); if(teamA === gameState.userTeam) addTransactionLog(`[수비붕괴] 1군 포지션 결원으로 실책 연발! 대량 실점했습니다.`); }
    if(missB > 0) { scoreA += (missB * 2); }
    if(scoreA === scoreB) scoreA += 1;

    let tA = gameState.leagueData.teams[teamA], tB = gameState.leagueData.teams[teamB];
    tA.homeGamesThisMonth++;

    if(scoreA > scoreB) { tA.wins++; tB.losses++; tA.streak=tA.streak>0?tA.streak+1:1; tB.streak=tB.streak<0?tB.streak-1:-1; } 
    else { tB.wins++; tA.losses++; tB.streak=tB.streak>0?tB.streak+1:1; tA.streak=tA.streak<0?tA.streak-1:-1; }
    
    gameState.leagueData.players.filter(p => p.team === teamA || p.team === teamB).forEach(p => {
        if(p.tier === 1) { 
            if(p.isPitcher) { p.seasonRecords.G++; p.seasonRecords.IP+=0.3; p.seasonRecords.ER+=Math.floor(Math.random()*2); } 
            else { p.seasonRecords.G++; p.seasonRecords.PA+=3; p.seasonRecords.H+=Math.floor(Math.random()*2); }
        }
    });
    return { teamA, scoreA, teamB, scoreB };
}

/* =====================================================================
    [7. 로스터 훈련 및 방출]
===================================================================== */
function releasePlayer(pid) {
    let p = gameState.leagueData.players.find(x => x.id === pid);
    if(!p) return;
    if(confirm(`[방출 경고] ${p.name} 선수를 방출하시겠습니까?\n방출되어도 잔여 연봉은 샐러리캡에 계속 적용됩니다.`)) {
        p.tier = 'RELEASED'; addTransactionLog(`[방출] ${p.pos} ${p.name} 방출됨.`); updateUI(); saveGame();
    }
}

function executeTraining() {
    let currentMonth = new Date(gameState.currentDate).getMonth();
    // 비시즌 (11, 12, 1월) 
    if (currentMonth !== 10 && currentMonth !== 11 && currentMonth !== 0) {
        return alert("특별 훈련은 비시즌(11월~1월)에만 진행할 수 있습니다.");
    }

    const team = gameState.leagueData.teams[gameState.userTeam];
    if(team.cash < 0.5) return alert("현금이 부족합니다. (필요: 0.5억)");
    let select = document.getElementById('train-player-select');
    if(!select.value) return alert("선수를 선택하세요.");
    
    let p = gameState.leagueData.players.find(x => x.id === select.value);
    if (p.trainedThisYear) return alert("이번 오프시즌에 이미 특별 훈련을 받았습니다. (연 1회 제한)");

    team.cash -= 0.5;
    p.trainedThisYear = true;
    
    let roll = Math.random() * 100;
    let suc = (p.hidden.gradePot === 'S' || p.hidden.gradePot === 'A') ? 50 : 30;
    
    if(roll < suc) {
        if(p.isPitcher) p.stats.stf += 5; else p.stats.pow += 5;
        alert(`[대성공] ${p.name} 선수의 기량이 발전했습니다!`); addTransactionLog(`[훈련 성공] ${p.name} 기량 스텝업.`);
    } else if (roll < suc + 30) {
        if(p.isPitcher) p.stats.ctl -= 5; else p.stats.con -= 5;
        alert(`[부작용] 무리한 폼 교정으로 ${p.name}의 밸런스 붕괴.`); addTransactionLog(`[부작용] ${p.name} 스탯 하락.`);
    } else {
        alert(`[훈련 실패] 소득 없이 종료. (0.5억 증발)`); addTransactionLog(`[훈련 실패] ${p.name} 적응 실패.`);
    }
    updateUI(); saveGame();
}

function checkLuxuryTax() {
    const team = gameState.leagueData.teams[gameState.userTeam]; 
    const payroll = calculateTeamPayroll(gameState.userTeam, false);
    const mercPayroll = calculateTeamPayroll(gameState.userTeam, true);
    let penalty = 0;
    if (payroll > LMD_CAP_LIMIT) penalty += (payroll - LMD_CAP_LIMIT) * 2.0;
    if (mercPayroll > LMD_MERC_CAP_LIMIT) penalty += (mercPayroll - LMD_MERC_CAP_LIMIT) * 2.0;
    
    if (penalty > 0) {
        team.cash -= penalty;
        addTransactionLog(`[사치세 징수] 초과로 ${penalty.toFixed(1)}억 차감.`); alert(`사치세가 부과되었습니다.\n차감액: ${penalty.toFixed(1)}억 원`);
        saveGame();
    } else { alert("정상 운영 중입니다."); }
    updateUI();
}

/* =====================================================================
    [8. 악덕 단장 트레이드 시스템]
===================================================================== */
function calculateTradeValue(player) {
    let baseValue = getGradeScore(getGradeFromStat(getPlayerOverallStat(player))) + getGradeScore(player.hidden.gradePot);
    let ageMod = 0.5; 
    if (player.age <= 24) ageMod = 1.2;
    else if (player.age <= 29) ageMod = 1.0;
    else if (player.age <= 34) ageMod = 0.8;
    return baseValue * ageMod;
}

function evaluateTrade(userPlayerIds, aiPlayerIds, aiTeamName) {
    if (gameState.tradeCooldowns && gameState.tradeCooldowns[aiTeamName]) {
        if (new Date(gameState.currentDate) < new Date(gameState.tradeCooldowns[aiTeamName])) {
            return { success: false, msg: `[협상 불가] ${aiTeamName} 단장은 당신의 전화를 무시하고 있습니다.` };
        }
    }

    let userPlayers = gameState.leagueData.players.filter(p => userPlayerIds.includes(p.id));
    let aiPlayers = gameState.leagueData.players.filter(p => aiPlayerIds.includes(p.id));
    let userTotalValue = 0; let aiTotalValue = 0;

    userPlayers.forEach(p => userTotalValue += calculateTradeValue(p));

    for (let p of aiPlayers) {
        if (p.age <= 24 && (p.hidden.gradePot.includes('S') || p.hidden.gradePot.includes('A'))) {
            return { success: false, msg: `[협상 결렬] ${p.name} 선수는 프랜차이즈의 미래입니다. 안 팝니다.` };
        }
        aiTotalValue += calculateTradeValue(p);
    }

    let aiDemandedValue = aiTotalValue * 1.5; // 호구 페널티

    if (userTotalValue < aiDemandedValue * 0.8) {
        let cdDate = new Date(gameState.currentDate); cdDate.setDate(cdDate.getDate() + 28);
        gameState.tradeCooldowns[aiTeamName] = cdDate.toISOString().split('T')[0];
        return { success: false, msg: `[협상 결렬] "이런 쓰레기 제안으로 내 시간을 뺏지 마시오." (4주간 거래 불가)` };
    }

    if (userTotalValue >= aiDemandedValue * 1.1) return { success: true, msg: `[거래 성사] "손해보는 장사지만, 이번 한 번만 수락해 드리죠."` };
    return { success: false, msg: `[거래 거절] "수지가 안 맞습니다. 더 이득이 되는 카드를 가져오세요."` };
}

// UI에서 호출할 더미 함수 (추후 UI 연결 필요)
function executeTrade(userPlayerIds, aiPlayerIds, aiTeamName) {
    let res = evaluateTrade(userPlayerIds, aiPlayerIds, aiTeamName);
    alert(res.msg);
    if(res.success) {
        gameState.leagueData.players.forEach(p => {
            if(userPlayerIds.includes(p.id)) p.team = aiTeamName;
            if(aiPlayerIds.includes(p.id)) p.team = gameState.userTeam;
        });
        addTransactionLog(`[트레이드 성사] ${gameState.userTeam} <-> ${aiTeamName}`);
        updateUI(); saveGame();
    }
}

/* =====================================================================[9. FA 시장 및 경매 / 보상 시스템]
===================================================================== */
function generateFAMarket() {
    if (gameState.faMarket && gameState.faMarket.length > 0) return; // 이미 생성됨
    if (!gameState.faMarket) gameState.faMarket = [];
    
    let candidates = gameState.leagueData.players.filter(p => p.tier === 1 && p.age >= 28 && p.team && p.team !== 'FA' && !p.isMercenary);
    // 무작위 추출
    candidates.sort(() => 0.5 - Math.random());
    let faPlayers = candidates.slice(0, Math.floor(Math.random() * 6) + 10); // 10~15명
    
    faPlayers.forEach(p => {
        p.originalTeam = p.team; // 원소속팀 저장
        p.team = 'FA'; // FA로 전환
        gameState.faMarket.push(p.id);
    });
    addTransactionLog(`[FA 시장 개장] ${faPlayers.length}명의 선수가 FA 시장에 나왔습니다.`);
}

function generateMercMarket() {
    if (gameState.mercMarket && gameState.mercMarket.length > 0) return; // 이미 생성됨
    if (!gameState.mercMarket) gameState.mercMarket = [];
    const reqBatters =['1B', '3B', 'LF', 'CF', 'RF'];
    
    for(let i=0; i<50; i++) {
        const isPitcher = i < 25;
        let pos = isPitcher ? 'SP' : reqBatters[Math.floor(Math.random()*reqBatters.length)];
        let p = {
            id: `merc-${new Date().getTime()}-${i}`, team: 'FA', name: generatePlayerName('USA/LATIN'), age: Math.floor(Math.random() * 8) + 24,
            isPitcher: isPitcher, pos: pos, tier: 1, salary: 0,
            gradeCurr: ['S', 'A', 'B'][Math.floor(Math.random()*3)],
            hidden: { gradePot: ['S', 'A', 'B'][Math.floor(Math.random()*3)], adaptability: Math.floor(Math.random() * 100) },
            seasonRecords: { G: 0, IP: 0, ER: 0, PA: 0, H: 0 },
            stats: isPitcher ? { vel: Math.floor(Math.random()*20)+140, stf: Math.floor(Math.random()*50)+45, ctl: Math.floor(Math.random()*50)+45, sta: Math.floor(Math.random()*50)+45 } 
                        : { con: Math.floor(Math.random()*50)+45, pow: Math.floor(Math.random()*50)+45, eye: Math.floor(Math.random()*50)+45, def: Math.floor(Math.random()*50)+45 },
            isMercenary: true, nationality: 'USA/LATIN'
        };
        gameState.leagueData.players.push(p);
        gameState.mercMarket.push(p.id);
    }
    addTransactionLog(`[용병 시장] 50명의 새로운 외국인 선수가 풀에 등록되었습니다.`);
}

function renderMarketList() {
    const faBody = document.getElementById('fa-list-body');
    const mercBody = document.getElementById('merc-list-body');
    
    if(faBody) {
        faBody.innerHTML = '';
        if (!gameState.faMarket) gameState.faMarket = [];
        let fas = gameState.leagueData.players.filter(p => gameState.faMarket.includes(p.id));
        if (fas.length === 0) {
            faBody.innerHTML = '<tr><td colspan="5" class="text-muted">FA 시장이 닫혀있거나 매물이 없습니다.</td></tr>';
        } else {
            fas.forEach(p => {
                let overallGrade = getGradeFromStat(getPlayerOverallStat(p));
                faBody.innerHTML += `<tr><td class="left">${p.name}(${p.age})</td><td>${p.pos}</td><td>${p.originalTeam}</td><td>${overallGrade}</td><td><button class="btn-sm primary" onclick="openFANegotiation('${p.id}')">협상</button></td></tr>`;
            });
        }
    }

    if(mercBody) {
        mercBody.innerHTML = '';
        if (!gameState.mercMarket) gameState.mercMarket = [];
        let mercs = gameState.leagueData.players.filter(p => gameState.mercMarket.includes(p.id));
        if (mercs.length === 0) {
            mercBody.innerHTML = '<tr><td colspan="5" class="text-muted">용병 시장이 닫혀있거나 매물이 없습니다.</td></tr>';
        } else {
            mercs.forEach(p => {
                let overallGrade = getGradeFromStat(getPlayerOverallStat(p));
                mercBody.innerHTML += `<tr><td class="left">${p.name}(${p.age})</td><td>${p.pos}</td><td>${p.nationality}</td><td>${overallGrade}</td><td><button class="btn-sm danger" onclick="openMercNegotiation('${p.id}')">계약 제안</button></td></tr>`;
            });
        }
    }
}

function openFANegotiation(playerId) {
    let p = gameState.leagueData.players.find(x => x.id === playerId);
    if(!p) return;
    
    let bonus = parseFloat(prompt(`[${p.name} FA 협상]\n계약금(Signing Bonus)을 제시하세요. (단위: 억)\n현재 구단 자금: ${gameState.leagueData.teams[gameState.userTeam].cash.toFixed(1)}억`));
    if(isNaN(bonus) || bonus < 0) return;
    
    let salary = parseFloat(prompt(`[${p.name} FA 협상]\n연봉(Annual Salary)을 제시하세요. (단위: 억)\n*샐러리캡에 반영됩니다.`));
    if(isNaN(salary) || salary <= 0) return;

    let defaultYears = 4;
    let yearsInput = prompt(`[${p.name} FA 협상]\n계약 기간(Years)을 제시하세요. (기본 4년)`, defaultYears);
    let years = parseInt(yearsInput);
    if(isNaN(years) || years <= 0) years = defaultYears;

    processFAOffer(playerId, bonus, salary, years);
}

function processFAOffer(playerId, bonus, salary, years) {
    let p = gameState.leagueData.players.find(x => x.id === playerId);
    let myTeam = gameState.leagueData.teams[gameState.userTeam];
    
    if (myTeam.cash < bonus) return alert("구단 현금이 부족하여 계약금을 지불할 수 없습니다.");
    
    let playerOverallScore = getPlayerOverallStat(p);
    // 시장 가치: 능력치 * 나이 배율 등을 단순화하여 임시 적용
    let ageMod = 1.0;
    if (p.age >= 34) ageMod = 0.6;
    else if (p.age >= 31) ageMod = 0.8;
    else if (p.age <= 28) ageMod = 1.2;

    let demandedTotal = (playerOverallScore * 0.4 * ageMod) * years;
    let myTotalOffer = bonus + (salary * years);

    if (myTotalOffer < demandedTotal) {
        alert(`[FA 결렬] 에이전트: "제시하신 조건(총액 ${myTotalOffer.toFixed(1)}억)은 시장 평가액(${demandedTotal.toFixed(1)}억)에 크게 못 미칩니다."\n${p.name} 선수가 협상 테이블에서 일어났습니다.`);
        // 실패 시 다른 AI 팀이 채가게 설정 (FA 마켓에서 삭제)
        let rival = TEAM_NAMES.filter(t => t !== gameState.userTeam)[Math.floor(Math.random() * 9)];
        p.team = rival;
        p.salary = (demandedTotal / years) * 1.1; // AI는 약간 더 높은 연봉을 줌
        gameState.faMarket = gameState.faMarket.filter(id => id !== playerId);
        addTransactionLog(`[FA 이적] ${p.name} -> ${rival} (총액 ${(p.salary * years).toFixed(1)}억)`);
        updateUI(); saveGame();
        return;
    }

    // 계약 성공
    myTeam.cash -= bonus;
    p.salary = salary;
    p.team = gameState.userTeam;
    gameState.faMarket = gameState.faMarket.filter(id => id !== playerId);

    alert(`[FA 영입 성공] ${p.name} 선수와 계약금 ${bonus}억, 연봉 ${salary}억, 기간 ${years}년에 계약을 체결했습니다!`);
    addTransactionLog(`[FA 영입] ${p.name} 영입 (총액 ${myTotalOffer}억)`);
    updateUI(); saveGame();
}

function openMercNegotiation(playerId) {
    let p = gameState.leagueData.players.find(x => x.id === playerId);
    if(!p) return;
    
    let salary = parseFloat(prompt(`[외국인 용병 ${p.name} 협상]\n단년 계약 연봉을 제시하세요. (단위: 억)\n현재 외국인 샐러리캡 여유: ${(LMD_MERC_CAP_LIMIT - calculateTeamPayroll(gameState.userTeam, true)).toFixed(1)}억`));
    if(isNaN(salary) || salary <= 0) return;

    processMercOffer(playerId, salary);
}

function processMercOffer(playerId, salary) {
    let p = gameState.leagueData.players.find(x => x.id === playerId);
    let myTeam = gameState.leagueData.teams[gameState.userTeam];
    
    let playerOverallScore = getPlayerOverallStat(p);
    let demandedSalary = playerOverallScore * 0.12;

    if (salary < demandedSalary) {
        alert(`[용병 계약 결렬] 에이전트: "이 금액(${salary}억)으로는 KBO에 가지 않겠습니다. (최소 ${demandedSalary.toFixed(1)}억 요구)"`);
        gameState.mercMarket = gameState.mercMarket.filter(id => id !== playerId);
        updateUI(); saveGame();
        return;
    }

    let currentMercCap = calculateTeamPayroll(gameState.userTeam, true);
    if (currentMercCap + salary > LMD_MERC_CAP_LIMIT) {
        return alert(`외국인 샐러리캡 초과! (현재: ${currentMercCap.toFixed(1)}억 + 영입 시 ${salary}억 > 한도 ${LMD_MERC_CAP_LIMIT}억)\n계약을 체결할 수 없습니다.`);
    }

    // 계약 성공
    p.salary = salary;
    p.team = gameState.userTeam;
    gameState.mercMarket = gameState.mercMarket.filter(id => id !== playerId);

    let adp = Math.floor(Math.random() * 100);
    let msg = `[용병 영입 성공] ${p.name} 선수와 연봉 ${salary}억에 단년 계약 체결!\n(적응도: ${adp}/100)`;
    if(adp < 30) msg += `\n-> [주의] 한국 문화 적응에 어려움을 겪고 있습니다.`;

    alert(msg);
    addTransactionLog(`[용병 영입] ${p.name} (연봉 ${salary}억)`);
    updateUI(); saveGame();
}

function generateUnprotectedList(aiTeamName) {
    let aiPlayers = gameState.leagueData.players.filter(p => p.team === aiTeamName);
    aiPlayers.sort((a, b) => calculateTradeValue(b) - calculateTradeValue(a));
    return aiPlayers.slice(20); // 21번째부터 반환
}

function executeFACompensation(selectedPlayerId, lostPlayerObj, aiTeamName) {
    let myTeam = gameState.leagueData.teams[gameState.userTeam];
    let compCash = 0; let grade = lostPlayerObj.gradeCurr;
    
    if (grade.includes('S')) compCash = lostPlayerObj.salary * 3.0; 
    else if (grade.includes('A')) compCash = lostPlayerObj.salary * 2.0; 
    else if (grade.includes('B')) compCash = lostPlayerObj.salary * 1.0; 

    compCash = generateMessyNumber(compCash, true);
    myTeam.cash += compCash;

    let compPlayer = gameState.leagueData.players.find(p => p.id === selectedPlayerId);
    if (compPlayer) {
        compPlayer.team = gameState.userTeam; 
        alert(`[FA 보상] 현금 ${compCash}억 원과 보상선수 ${compPlayer.name} 획득.`);
    } else {
        alert(`[FA 보상] 현금 ${compCash}억 원을 획득했습니다.`);
    }
    updateUI(); saveGame();
}

/* =====================================================================
    [10. UI 렌더링 (안개 시스템 적용)]
===================================================================== */
function calculateTeamPayroll(teamName, isMerc = false) { 
    return gameState.leagueData.players.filter(p => p.team === teamName && p.tier !== 'RELEASED' && !!p.isMercenary === isMerc).reduce((sum, p) => sum + p.salary, 0); 
}

function updateUI() {
    document.getElementById('header-date').innerText = gameState.currentDate; 
    document.getElementById('dash-date').innerText = gameState.currentDate;

    const sortedTeams = Object.values(gameState.leagueData.teams).sort((a, b) => b.wins - a.wins);
    const myTeamIndex = sortedTeams.findIndex(t => t.name === gameState.userTeam);
    const myTeam = sortedTeams[myTeamIndex];
    const myPayroll = calculateTeamPayroll(gameState.userTeam, false);
    const myMercPayroll = calculateTeamPayroll(gameState.userTeam, true);
    const myCapRate = Math.round((myPayroll / LMD_CAP_LIMIT) * 100);
    const myMercCapRate = Math.round((myMercPayroll / LMD_MERC_CAP_LIMIT) * 100);
    const myWinRate = myTeam.wins + myTeam.losses === 0 ? ".000" : (myTeam.wins / (myTeam.wins + myTeam.losses)).toFixed(3);

    document.getElementById('dash-rank').innerText = `${myTeamIndex + 1}위`;
    document.getElementById('dash-record').innerText = `${myTeam.wins}W - ${myTeam.losses}L`;
    document.getElementById('dash-winrate').innerText = myWinRate.replace('0.', '.');
    document.getElementById('dash-streak').innerText = myTeam.streak === 0 ? "-" : (myTeam.streak > 0 ? `${myTeam.streak}연승` : `${Math.abs(myTeam.streak)}연패`);
    let elDashCash = document.getElementById('dash-cash');
    if (elDashCash) elDashCash.innerText = `${myTeam.cash.toFixed(1)}억`;
    
    let elDashCapRate = document.getElementById('dash-caprate');
    if (elDashCapRate) elDashCapRate.innerText = `${myCapRate}%`;

    let elUiCash = document.getElementById('ui-cash');
    if (elUiCash) elUiCash.innerText = `${myTeam.cash.toFixed(1)}억 원`;
    
    let elUiCap = document.getElementById('ui-cap');
    if (elUiCap) elUiCap.innerText = `${myPayroll.toFixed(1)}억 (${myCapRate}%)`;

    let elUiMercCap = document.getElementById('ui-merc-cap');
    if (elUiMercCap) elUiMercCap.innerText = `${myMercPayroll.toFixed(1)}억 (${myMercCapRate}%)`;

    const receiptBox = document.getElementById('finance-receipt-container');
    if(myTeam.financeLog && receiptBox) {
        const log = myTeam.financeLog;
        receiptBox.innerHTML = `
            <div class="receipt-box">
                <div class="receipt-title">${log.monthStr} 재정 결산 리포트</div>
                <div class="receipt-section">수입 (Income)</div>
                <div class="receipt-item"><span>관중 수입 (${log.homeGames}경기)</span> <span class="text-green">+${log.gateReceipts}억</span></div>
                <div class="receipt-item"><span>중계권료 수익</span> <span class="text-green">+${log.broadcastIncome}억</span></div>
                <div class="receipt-section">지출 (Expense)</div>
                <div class="receipt-item"><span>선수단 연봉 할부</span> <span class="text-red">-${log.playerSalary}억</span></div>
                <div class="receipt-item"><span>코칭스태프 연봉</span> <span class="text-red">-${log.coachSalary}억</span></div>
                <div class="receipt-item"><span>기본 구단 운영비</span> <span class="text-red">-${log.opCost}억</span></div>
                <div class="receipt-total">
                    <span>월간 순이익 (Net)</span> 
                    <span class="${log.netIncome >= 0 ? 'text-green' : 'text-red'}">${log.netIncome >= 0 ? '+' : ''}${log.netIncome}억</span>
                </div>
            </div>
        `;
    }

    const myPlayers = gameState.leagueData.players.filter(p => p.team === gameState.userTeam).sort((a,b) => a.tier - b.tier);
    const tbodyP = document.querySelector('#pitcher-table tbody'); const tbodyB = document.querySelector('#batter-table tbody');
    const tbodyRel = document.querySelector('#release-list-body'); const trainSelect = document.getElementById('train-player-select');
    
    if(tbodyP) tbodyP.innerHTML = ''; 
    if(tbodyB) tbodyB.innerHTML = ''; 
    if(tbodyRel) tbodyRel.innerHTML = ''; 
    if(trainSelect) trainSelect.innerHTML = '';

    myPlayers.forEach(p => {
        if(p.tier === 'RELEASED') {
            if(tbodyRel) tbodyRel.innerHTML += `<tr><td class="left text-muted">${p.name}(${p.age})</td><td>${p.pos}</td><td>방출됨</td></tr>`; 
            return; 
        }

        let overallGrade = getGradeFromStat(getPlayerOverallStat(p));
        if(trainSelect) trainSelect.innerHTML += `<option value="${p.id}">${p.tier===2?'[2군]':'[1군]'} ${p.pos} ${p.name} - ${overallGrade}</option>`;
        
        const tr = document.createElement('tr');
        if(p.tier === 2) tr.style.color = 'var(--text-muted)';
        let btnHtml = `<button class="btn-sm danger" onclick="releasePlayer('${p.id}')">방출</button>`;
        let nameDisplay = p.retiring ? `<span style="color:#ff6b6b">${p.name}(${p.age}) 🛑</span>` : `${p.name}(${p.age})`;

        if(p.isPitcher && tbodyP) {
            let era = p.seasonRecords.IP > 0 ? ((p.seasonRecords.ER * 9) / Math.floor(p.seasonRecords.IP)).toFixed(2) : '-';
            tr.innerHTML = `
                <td>${p.tier===2 ? '2군' : p.pos}</td><td class="left">${nameDisplay}</td><td>${overallGrade}/${p.hidden.gradePot}</td>
                <td>${p.stats.vel}</td><td>${getGradeFromStat(p.stats.stf)}</td><td>${getGradeFromStat(p.stats.ctl)}</td><td>${getGradeFromStat(p.stats.sta)}</td>
                <td>${era}</td><td class="right">${p.salary.toFixed(1)}</td><td>${btnHtml}</td>
            `;
            tbodyP.appendChild(tr);
        } else if(!p.isPitcher && tbodyB) {
            let avg = p.seasonRecords.PA > 0 ? (p.seasonRecords.H / p.seasonRecords.PA).toFixed(3).replace('0.','.') : '-';
            tr.innerHTML = `
                <td>${p.tier===2 ? '2군' : p.pos}</td><td class="left">${nameDisplay}</td><td>${overallGrade}/${p.hidden.gradePot}</td>
                <td>${getGradeFromStat(p.stats.con)}</td><td>${getGradeFromStat(p.stats.pow)}</td><td>${getGradeFromStat(p.stats.eye)}</td><td>${getGradeFromStat(p.stats.def)}</td>
                <td>${avg}</td><td class="right">${p.salary.toFixed(1)}</td><td>${btnHtml}</td>
            `;
            tbodyB.appendChild(tr);
        }
    });
    if(tbodyRel && tbodyRel.innerHTML === '') tbodyRel.innerHTML = '<tr><td colspan="3" class="text-muted">방출된 선수가 없습니다.</td></tr>';

    const tbodyS = document.querySelector('#standings-table tbody'); 
    if(tbodyS) {
        tbodyS.innerHTML = '';
        sortedTeams.forEach((t, i) => {
            const cRate = Math.round((calculateTeamPayroll(t.name) / t.capLimit) * 100);
            const wRate = t.wins + t.losses === 0 ? ".000" : (t.wins / (t.wins + t.losses)).toFixed(3).replace('0.', '.');
            const tr = document.createElement('tr');
            if(t.name === gameState.userTeam) tr.style.backgroundColor = 'rgba(77, 171, 247, 0.1)';
            tr.innerHTML = `<td>${i + 1}</td><td class="left">${t.name}</td><td>${t.wins}-${t.losses}</td><td>${wRate}</td><td class="right text-green">${t.cash.toFixed(1)}</td><td class="right ${cRate > 100 ? 'text-red' : ''}">${cRate}%</td>`;
            tbodyS.appendChild(tr);
        });
    }

    const schBox = document.getElementById('schedule-list');
    if(schBox && gameState.matchLogs.length > 0) {
        schBox.innerHTML = gameState.matchLogs.map(log => `
            <div class="schedule-day"><div class="schedule-date">[${log.date}] Result</div>
            ${log.matches.map(m => `<div class="match-row"><div class="match-team ${m.teamA===gameState.userTeam?'my-team-highlight':''}">${m.teamA}</div><div class="match-score">${m.scoreA} - ${m.scoreB}</div><div class="match-team ${m.teamB===gameState.userTeam?'my-team-highlight':''}">${m.teamB}</div></div>`).join('')}
            </div>`).join('');
    }

    const inbox = document.getElementById('dash-inbox');
    if(inbox) inbox.innerHTML = gameState.transactionLog.join('<br>');
}