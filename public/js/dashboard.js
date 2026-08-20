document.addEventListener('DOMContentLoaded', () => {
  initSidebar();
  initMobileMenu();
  initThemeToggle();
  initGuildSelection();
});

let serverData = {};
let currentGuildId = null;
let dailyTarget = null;
let dailyRewardAmount = 5000;

function gurl(path) {
  return currentGuildId ? `${path}?guildId=${encodeURIComponent(currentGuildId)}` : path;
}

async function api(url, options) {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    return await res.json();
  } catch (e) {
    console.error('API error', url, e);
    return null;
  }
}

async function initGuildSelection() {
  const data = await api('/api/guilds');
  if (!data) return loadAll();
  const select = document.getElementById('guildSelect');
  select.innerHTML = '<option value="">اختر سيرفر...</option>' + (data.guilds || []).map(g =>
    `<option value="${g.id}">${g.name}</option>`
  ).join('');
  currentGuildId = data.selectedGuildId || ((data.guilds || [])[0] && data.guilds[0].id) || null;
  if (currentGuildId) select.value = currentGuildId;
  select.addEventListener('change', async () => {
    currentGuildId = select.value || null;
    if (!currentGuildId) return;
    const res = await api('/api/guild/select', { method: 'POST', body: JSON.stringify({ guildId: currentGuildId }) });
    if (res && res.ok) loadAll();
    else showToast('تعذر اختيار السيرفر', true);
  });
  loadAll();
}

async function loadAll() {
  const [user, leaderboard, transfers, stats, shortcuts, welcome, protection, level, tickets, autoresponse] = await Promise.all([
    api(gurl('/api/user')),
    api(gurl('/api/leaderboard')),
    api(gurl('/api/transfers')),
    api(gurl('/api/guild/stats')),
    api(gurl('/api/guild/shortcuts')),
    api(gurl('/api/guild/welcome')),
    api(gurl('/api/guild/protection')),
    api(gurl('/api/guild/level')),
    api(gurl('/api/guild/tickets')),
    api(gurl('/api/guild/autoresponse')),
  ]);

  if (user) renderUser(user);
  if (leaderboard) renderLeaderboard(leaderboard);
  if (transfers) renderTransfers(transfers);
  if (stats) { serverData.stats = stats; renderServerStats(stats); }
  if (shortcuts) renderShortcuts(shortcuts);
  if (welcome) renderWelcome(welcome);
  if (protection) renderProtection(protection);
  if (level) renderLevel(level);
  if (tickets) renderTickets(tickets);
  if (autoresponse) renderAutoResponse(autoresponse);
  startCountdown();
  initDailyClaim(user);
}

function formatNumber(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return n.toLocaleString('en');
}

function formatBalance(n) {
  return Number(n || 0).toLocaleString('en');
}

function renderUser(data) {
  const { account, avatar, globalName, username, guilds, daily } = data;
  const acc = account || {};
  if (daily && daily.reward) dailyRewardAmount = daily.reward;
  document.getElementById('userName').textContent = globalName || username;
  document.getElementById('userTag').textContent = username;
  document.getElementById('userBalance').textContent = formatBalance(acc.balance);
  document.getElementById('userLevel').textContent = acc.level || 1;
  document.getElementById('userXp').textContent = `${Number(acc.xp || 0).toLocaleString('en')} / ${Number(acc.maxXp || 3000).toLocaleString('en')} XP`;
  document.getElementById('userRank').textContent = acc.globalRank ? '#' + Number(acc.globalRank).toLocaleString('en') : '—';
  document.getElementById('userGuilds').textContent = (guilds?.length || 1).toLocaleString('en');
  const xpPercent = Math.min(100, ((acc.xp || 0) / (acc.maxXp || 3000)) * 100);
  const xpFill = document.querySelector('.xp-fill');
  if (xpFill) xpFill.style.width = xpPercent + '%';
  if (avatar) {
    const img = document.getElementById('userAvatar');
    if (img) img.src = avatar;
    const imgLg = document.getElementById('userAvatarLg');
    if (imgLg) imgLg.src = avatar;
  }
  const roleBadge = document.getElementById('userRoleBadge');
  if (roleBadge) roleBadge.textContent = acc.isOwner ? 'المالك' : acc.isAdmin ? 'مدير' : acc.isVip ? 'VIP' : 'عضو';
  const badge = document.getElementById('premiumBadge');
  if (badge) badge.textContent = acc.isVip ? 'Premium' : 'عادي';
  const expiry = document.getElementById('premiumExpiry');
  if (expiry) {
    if (account && account.nextVipRewardAt) {
      const d = new Date(account.nextVipRewardAt);
      const months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
      expiry.textContent = `ينتهي في ${d.getDate()} ${months[d.getMonth()]}`;
    } else {
      expiry.textContent = 'غير مفعل';
    }
  }
  document.querySelectorAll('.daily-sub').forEach(el => {
    el.textContent = `احصل على ${Number(dailyRewardAmount).toLocaleString('en')} كوينز كل 24 ساعة`;
  });
  dailyTarget = account?.nextDailyRewardAt ? new Date(account.nextDailyRewardAt).getTime() : null;
  updateDailyButtons();
  if (!account && currentGuildId) showToast('لا يوجد حساب لك في هذا السيرفر بعد', true);
}

function updateDailyButtons() {
  const available = !dailyTarget || dailyTarget <= Date.now();
  document.querySelectorAll('.daily-btn').forEach(btn => {
    btn.disabled = !available;
    btn.textContent = available ? 'استلم المكافأة' : 'استلمت المكافأة اليوم';
  });
}

function renderLeaderboard(data) {
  if (!data) return;
  const list = document.getElementById('leaderboardList');
  list.innerHTML = data.map(u => `
    <div class="lb-item">
      <span class="lb-rank ${u.rank <= 3 ? 'top-3' : ''}">${String(u.rank).padStart(2, '0')}</span>
      <div class="lb-avatar">${u.initials}</div>
      <span class="lb-name">${u.tag}</span>
      <span class="lb-balance">${formatBalance(u.balance)}</span>
    </div>
  `).join('') || '<p class="empty-note">لا توجد بيانات بعد</p>';
}

function renderTransfers(data) {
  if (!data) return;
  const list = document.getElementById('transferList');
  list.innerHTML = data.map(t => `
    <div class="transfer-item">
      <div class="transfer-avatar">${t.fromInitials}</div>
      <div class="transfer-info">
        <p class="transfer-name">${t.from}</p>
        <p class="transfer-type">${t.kind || 'تحويل بنكي'}</p>
      </div>
      <span class="transfer-amount ${t.amount > 0 ? 'positive' : 'negative'}">
        ${t.amount > 0 ? '+' : ''}${formatBalance(Math.abs(t.amount))} ${t.amount > 0 ? '↑' : '↓'}
      </span>
      <span class="transfer-time">${t.timeAgo}</span>
    </div>
  `).join('') || '<p class="empty-note">لا توجد تحويلات بعد</p>';
}

function renderShortcuts(data) {
  if (!data) return;
  const list = document.getElementById('shortcutsList');
  list.innerHTML = data.map(s => `
    <div class="shortcut-item">
      <span>${s.trigger}</span>
      <span class="shortcut-cmd">${s.command}</span>
    </div>
  `).join('') || '<p class="empty-note">لا توجد اختصارات</p>';
}

function renderServerStats(stats) {
  if (!stats) return;
  document.getElementById('serverName').textContent = stats.name || 'Revo Community';
  document.getElementById('serverId').textContent = 'ID: ' + (stats.id || '-');
  document.getElementById('serverMembers').textContent = Number(stats.memberCount || 0).toLocaleString('en');
  const statsGrid = document.querySelector('.stats-grid');
  if (statsGrid && stats.stats) {
    statsGrid.innerHTML = Object.entries(stats.stats).map(([key, v]) => `
      <div class="stat-metric">
        <div class="stat-metric-header">
          <span class="stat-metric-label">${metricLabel(key)}</span>
          <span class="stat-metric-change ${v.change >= 0 ? 'positive' : 'negative'}">${v.change >= 0 ? '+' : ''}${v.change}%</span>
        </div>
        <p class="stat-metric-value">${v.value}</p>
      </div>
    `).join('');
  }
  if (stats.systems) {
    document.querySelectorAll('[data-system]').forEach(el => {
      const key = el.dataset.system;
      const on = stats.systems[key];
      const badge = el.querySelector('.system-badge');
      if (badge) {
        badge.classList.toggle('active', !!on);
        badge.classList.toggle('inactive', !on);
        badge.textContent = on ? 'مفعل' : 'معطل';
      }
    });
  }
  serverData.stats = stats;
}

function metricLabel(key) {
  return { messages: 'الرسائل', newMembers: 'الأعضاء الجدد', activeMembers: 'الأعضاء النشطين', transfers: 'التحويلات' }[key] || key;
}

function renderWelcome(data) {
  if (!data) return;
  document.getElementById('welcomeEnabled').checked = !!data.enabled;
  document.getElementById('welcomeChannel').value = data.welcomeChannel || '';
  document.getElementById('welcomeMessage').value = data.welcomeMessage || '';
  document.getElementById('welcomeType').value = data.welcomeType || 'message';
  document.getElementById('welcomeDM').checked = !!data.welcomeDM;
  document.getElementById('welcomeAutoRole').value = data.autoRole || '';
  const badge = document.querySelector('[data-system="welcome"] .system-badge');
  if (badge) { badge.classList.toggle('active', !!data.enabled); badge.textContent = data.enabled ? 'مفعل' : 'معطل'; }
}

function renderProtection(data) {
  if (!data) return;
  document.getElementById('protectionLogs').checked = data.logsEnabled !== false;
  const list = document.getElementById('protectionList');
  const protection = data.protection || {};
  const keys = Object.keys(protection);
  list.innerHTML = keys.length ? keys.map(k => `
    <div class="control-row">
      <span>${protectionLabel(k)}</span>
      <label class="switch">
        <input type="checkbox" data-protection-key="${k}" ${protection[k]?.enabled !== false ? 'checked' : ''}>
        <span class="slider"></span>
      </label>
    </div>
  `).join('') : '<p class="empty-note">لا توجد أنظمة حماية مفعلة بعد</p>';
  list.querySelectorAll('input[data-protection-key]').forEach(input => {
    input.addEventListener('change', saveProtection);
  });
}

function protectionLabel(key) {
  const map = { antiRaid: 'مكافحة الهجوم', antiSpam: 'مكافحة السبام', antiLink: 'مكافحة الروابط', antiAlt: 'مكافحة الحسابات الجديدة', antiNuke: 'مكافحة التخريب', antiToken: 'حماية التوكن' };
  return map[key] || key;
}

async function saveProtection() {
  const data = await api(gurl('/api/guild/protection'));
  const protection = data?.protection || {};
  document.querySelectorAll('input[data-protection-key]').forEach(input => {
    const key = input.dataset.protectionKey;
    protection[key] = { ...(protection[key] || {}), enabled: input.checked };
  });
  await api(gurl('/api/guild/protection'), { method: 'POST', body: JSON.stringify({ protection }) });
  showToast('تم حفظ إعدادات الحماية');
}

function renderLevel(data) {
  if (!data) return;
  const c = data.config || {};
  document.getElementById('levelEnabled').checked = !!c.enabled;
  document.getElementById('levelXpPerMessage').value = c.xpPerMessage ?? 10;
  document.getElementById('levelMaxLevel').value = c.maxLevel ?? 100;
  document.getElementById('levelMaxXp').value = c.maxXp ?? 3000;
  document.getElementById('levelCooldown').value = c.cooldownMs ?? 10000;
  document.getElementById('levelMultiplier').value = c.multiplier ?? 1;
  document.getElementById('levelUpMode').value = c.levelUpMode || 'same';
  document.getElementById('levelMembers').textContent = Number(data.memberCount || 0).toLocaleString('en');
  const top = document.getElementById('levelTop');
  top.innerHTML = (data.top || []).map((m, i) => `
    <div class="lb-item">
      <span class="lb-rank ${i < 3 ? 'top-3' : ''}">${String(i + 1).padStart(2, '0')}</span>
      <div class="lb-avatar">${String(m.userId).slice(0, 2).toUpperCase()}</div>
      <span class="lb-name">${m.userId}</span>
      <span class="lb-balance">المستوى ${m.level} · ${formatBalance(m.xp)} XP</span>
    </div>
  `).join('') || '<p class="empty-note">لا يوجد أعضاء بعد</p>';
  const badge = document.querySelector('[data-system="level"] .system-badge');
  if (badge) { badge.classList.toggle('active', !!c.enabled); badge.textContent = c.enabled ? 'مفعل' : 'معطل'; }
}

async function saveLevel() {
  const payload = {
    enabled: document.getElementById('levelEnabled').checked,
    xpPerMessage: +document.getElementById('levelXpPerMessage').value,
    maxLevel: +document.getElementById('levelMaxLevel').value,
    maxXp: +document.getElementById('levelMaxXp').value,
    cooldownMs: +document.getElementById('levelCooldown').value,
    multiplier: +document.getElementById('levelMultiplier').value,
    levelUpMode: document.getElementById('levelUpMode').value,
  };
  const res = await api(gurl('/api/guild/level'), { method: 'POST', body: JSON.stringify(payload) });
  if (res?.ok) showToast('تم حفظ إعدادات المستويات');
  else showToast('تعذر الحفظ (قاعدة البيانات غير متصلة)', true);
}

function renderTickets(data) {
  if (!data) return;
  document.getElementById('openTickets').textContent = Number(data.openTickets || 0).toLocaleString('en');
  const list = document.getElementById('ticketPanelsList');
  list.innerHTML = (data.panels || []).map(p => `
    <div class="control-row">
      <span>${p.emoji || '🎫'} ${p.name}</span>
      <span class="system-badge ${p.enabled ? 'active' : 'inactive'}">${p.enabled ? 'مفعل' : 'معطل'}</span>
    </div>
  `).join('') || '<p class="empty-note">لا توجد لوحات تذاكر بعد</p>';
  const badge = document.querySelector('[data-system="tickets"] .system-badge');
  if (badge) { const on = (data.panels || []).some(p => p.enabled); badge.classList.toggle('active', on); badge.textContent = on ? 'مفعل' : 'معطل'; }
}

function renderAutoResponse(data) {
  if (!data) return;
  const list = document.getElementById('autoRespList');
  list.innerHTML = (data.autoResponses || []).map(r => `
    <div class="control-row">
      <span>${r.trigger}</span>
      <span class="auto-resp-preview">${r.response}</span>
      <label class="switch">
        <input type="checkbox" data-arp-id="${r.responseId}" ${r.enabled ? 'checked' : ''}>
        <span class="slider"></span>
      </label>
      <button class="btn-remove" data-arp-remove="${r.responseId}" title="حذف">×</button>
    </div>
  `).join('') || '<p class="empty-note">لا توجد ردود تلقائية بعد</p>';
  list.querySelectorAll('input[data-arp-id]').forEach(input => {
    input.addEventListener('change', async () => {
      await api(gurl('/api/guild/autoresponse'), { method: 'POST', body: JSON.stringify({ action: 'toggle', responseId: input.dataset.arpId, enabled: input.checked }) });
      showToast('تم تحديث الرد التلقائي');
    });
  });
  list.querySelectorAll('button[data-arp-remove]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api(gurl('/api/guild/autoresponse'), { method: 'POST', body: JSON.stringify({ action: 'remove', responseId: btn.dataset.arpRemove }) });
      btn.closest('.control-row').remove();
      showToast('تم حذف الرد التلقائي');
    });
  });
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#addAutoResp')) {
    const trigger = document.getElementById('newAutoTrigger').value.trim();
    const response = document.getElementById('newAutoResponse').value.trim();
    if (!trigger || !response) return showToast('أدخل الكلمة والرد', true);
    api(gurl('/api/guild/autoresponse'), { method: 'POST', body: JSON.stringify({ action: 'add', trigger, response }) }).then(() => {
      document.getElementById('newAutoTrigger').value = '';
      document.getElementById('newAutoResponse').value = '';
      loadAll();
      showToast('تمت إضافة الرد التلقائي');
    });
  }
  if (e.target.closest('#saveWelcome')) saveWelcome();
  if (e.target.closest('#saveLevel')) saveLevel();
});

async function saveWelcome() {
  const payload = {
    enabled: document.getElementById('welcomeEnabled').checked,
    welcomeChannel: document.getElementById('welcomeChannel').value.trim(),
    welcomeMessage: document.getElementById('welcomeMessage').value,
    welcomeType: document.getElementById('welcomeType').value,
    welcomeDM: document.getElementById('welcomeDM').checked,
    autoRole: document.getElementById('welcomeAutoRole').value.trim() || null,
  };
  const res = await api(gurl('/api/guild/welcome'), { method: 'POST', body: JSON.stringify(payload) });
  if (res?.ok) showToast('تم حفظ إعدادات الترحيب');
  else showToast('تعذر الحفظ (قاعدة البيانات غير متصلة)', true);
}

function startCountdown() {
  function tick() {
    const diff = dailyTarget ? Math.max(0, dailyTarget - Date.now()) : 0;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    document.getElementById('cdHours').textContent = hh;
    document.getElementById('cdMinutes').textContent = mm;
    document.getElementById('cdSeconds').textContent = ss;
    document.getElementById('cdHours2').textContent = hh;
    document.getElementById('cdMinutes2').textContent = mm;
    document.getElementById('cdSeconds2').textContent = ss;
    if (!dailyTarget || diff <= 0) {
      updateDailyButtons();
      return;
    }
    setTimeout(tick, 1000);
  }
  tick();
}

function initDailyClaim(user) {
  document.querySelectorAll('.daily-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'جاري الاستلام...';
      const result = await api('/api/daily/claim', { method: 'POST' });
      if (result && result.claimed) {
        btn.textContent = 'تم الاستلام! +' + formatBalance(result.amount);
        dailyTarget = new Date(result.nextClaimAt).getTime();
        if (result.balance != null) {
          document.getElementById('userBalance').textContent = formatBalance(result.balance);
          document.getElementById('panelBalance').textContent = formatBalance(result.balance);
        }
        showToast('تم استلام ' + formatBalance(result.amount) + ' كوينز');
        setTimeout(() => { updateDailyButtons(); }, 3000);
        startCountdown();
      } else if (result && result.nextClaimAt) {
        dailyTarget = new Date(result.nextClaimAt).getTime();
        showToast('لا يمكنك الاستلام الآن', true);
        updateDailyButtons();
        startCountdown();
      } else {
        btn.textContent = 'تعذر الاستلام (قاعدة البيانات غير متصلة)';
        showToast('تعذر الاستلام (قاعدة البيانات غير متصلة)', true);
        setTimeout(() => { updateDailyButtons(); }, 3000);
      }
    });
  });
}

function initSidebar() {
  const btns = document.querySelectorAll('.sidebar-btn');
  const sections = document.querySelectorAll('.content-section');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const section = btn.dataset.section;
      sections.forEach(s => s.classList.toggle('active', s.dataset.section === section));
      document.querySelector('.app').classList.remove('menu-open');
    });
  });
}

function initMobileMenu() {
  const toggle = document.querySelector('.menu-toggle');
  const app = document.querySelector('.app');
  const overlay = document.querySelector('.sidebar-overlay');
  if (toggle && app) toggle.addEventListener('click', () => app.classList.toggle('menu-open'));
  if (overlay && app) overlay.addEventListener('click', () => app.classList.remove('menu-open'));
}

function initThemeToggle() {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    document.body.classList.toggle('light-mode');
    btn.querySelector('span').textContent = document.body.classList.contains('light-mode') ? 'الوضع الليلي' : 'الوضع النهاري';
  });
}

let toastTimer = null;
function showToast(msg, isError) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = isError ? 'show error' : 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.className = '', 2500);
}