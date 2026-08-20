document.addEventListener('DOMContentLoaded', () => {
  initSidebar();
  initMobileMenu();
  initThemeToggle();
  initSearch();
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
  const [user, leaderboard, transfers, stats, shortcuts, welcome, protection, level, tickets, autoresponse, botInfo] = await Promise.all([
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
    api('/api/bot/info'),
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
  if (botInfo) renderBotInfo(botInfo);
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
  document.getElementById('userGuilds').textContent = (guilds?.length || 0).toLocaleString('en');
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
  const panelBalance = document.getElementById('panelBalance');
  if (panelBalance) panelBalance.textContent = formatBalance(acc.balance);
  if (!account && currentGuildId) showToast('لا يوجد حساب مالي لك حتى الآن في هذا السيرفر', true);
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
  const render = (items) => items.map(t => `
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
  ['transferList','panelTransfers','historyList'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = render(data);
  });
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

function renderBotInfo(data) {
  const ownerName = data.owner?.globalName || data.owner?.username || 'مالك Revo';
  const ownerTag = data.owner?.username ? `@${data.owner.username}` : data.owner?.mention || '';
  const ownerNameEl = document.getElementById('ownerName');
  const ownerTagEl = document.getElementById('ownerTag');
  const ownerAvatar = document.getElementById('ownerAvatar');
  const ownerNameCard = document.getElementById('ownerNameCard');
  const ownerTagCard = document.getElementById('ownerTagCard');
  const botStatus = document.getElementById('botStatusText');
  const botGuildCount = document.getElementById('botGuildCount');
  const botBannerStatus = document.getElementById('botBannerStatus');
  if (ownerNameEl) ownerNameEl.textContent = ownerName;
  if (ownerTagEl) ownerTagEl.textContent = data.owner?.mention || ownerTag;
  if (ownerAvatar && data.owner?.avatar) ownerAvatar.src = data.owner.avatar;
  if (ownerNameCard) ownerNameCard.textContent = ownerName;
  if (ownerTagCard) ownerTagCard.textContent = data.owner?.mention || ownerTag;
  if (botStatus) botStatus.textContent = data.online ? 'متصل ويعمل' : 'غير متصل';
  if (botBannerStatus) botBannerStatus.textContent = data.online ? 'متصل • يعمل الآن' : 'غير متصل • تحقق من البوت';
  const botName = data.bot?.globalName || data.bot?.username || 'REVO BOT';
  document.title = `${botName} — لوحة التحكم`;
  if (botGuildCount) botGuildCount.textContent = Number(data.guildCount || 0).toLocaleString('en');
  const dbStatus = document.getElementById('dbStatusText');
  if (dbStatus) dbStatus.textContent = data.database ? 'متصلة' : 'غير متصلة';
}

function initSearch() {
  const input = document.getElementById('searchInput');
  if (!input) return;
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll('.sidebar-btn').forEach(btn => {
      const label = btn.textContent.trim().toLowerCase();
      btn.style.display = !q || label.includes(q) ? '' : 'none';
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
/* ===== REVO PRO MAX — Full Bot Control Layer ===== */
let botCatalog = { commands: [], systems: [] };
let fullConfig = {};
let guildResources = { channels: [], roles: [] };

async function loadProMaxData() {
  const [catalog, config, resources] = await Promise.all([
    api('/api/bot/catalog'),
    api(gurl('/api/guild/full-config')),
    api(gurl('/api/guild/resources')),
  ]);
  if (catalog) { botCatalog = catalog; renderCommandCenter(catalog); renderCommandGroups(catalog); }
  if (config) { fullConfig = config; renderAdvancedConfig(config); }
  if (resources) guildResources = resources;
}

function renderCommandCenter(data) {
  const grid = document.getElementById('commandGrid');
  const cat = document.getElementById('commandCategory');
  const search = document.getElementById('commandSearch');
  if (!grid) return;
  const cats = [...new Set(data.commands.map(c => c.category))];
  if (cat) cat.innerHTML = '<option value="all">كل الأقسام</option>' + cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  const render = () => {
    const q = (search?.value || '').toLowerCase().trim();
    const c = cat?.value || 'all';
    const list = data.commands.filter(x => (c === 'all' || x.category === c) && (!q || x.name.toLowerCase().includes(q) || x.description.toLowerCase().includes(q)));
    grid.innerHTML = list.map(x => `<div class="command-card"><div class="command-icon">/</div><div><strong>${escapeHtml(x.name)}</strong><span>${escapeHtml(x.category)}</span><p>${escapeHtml(x.description)}</p></div></div>`).join('') || '<div class="empty-state">لا توجد نتائج</div>';
  };
  search?.addEventListener('input', render); cat?.addEventListener('change', render); render();
}

function renderCommandGroups(data) {
  const map = { moderation: ['إدارة'], voice: ['الصوت'] };
  for (const [id, cats] of Object.entries(map)) {
    const el = document.getElementById(id + 'Grid'); if (!el) continue;
    el.innerHTML = data.commands.filter(c => cats.includes(c.category)).map(x => `<div class="command-card"><div class="command-icon">${id === 'voice' ? '🔊' : '🛡️'}</div><div><strong>/${escapeHtml(x.name)}</strong><span>${escapeHtml(x.category)}</span><p>${escapeHtml(x.description)}</p></div></div>`).join('');
  }
}

function renderAdvancedConfig(cfg) {
  const f = cfg.functionConfig || {};
  const fg = document.getElementById('functionGrid');
  if (fg) {
    const labels = { promotion:'ترقية', demotion:'تخفيض', separation:'فصل', roleSelector:'اختيار الرتبة' };
    fg.innerHTML = Object.entries(labels).map(([k,v]) => `<label class="switch-row"><span>${v}</span><label class="switch"><input type="checkbox" data-fn="${k}" ${f.enabled?.[k] !== false ? 'checked':''}><span class="slider"></span></label></label>`).join('');
  }
  const sl = cfg.slash || {};
  const sg = document.getElementById('slashGrid');
  if (sg) sg.innerHTML = botCatalog.commands.filter(c => c.name !== 'setup-system').slice(0, 70).map(c => `<label class="switch-row"><span>/${escapeHtml(c.name)}</span><label class="switch"><input type="checkbox" data-slash="${escapeHtml(c.name)}" ${(sl.enabledCommands||[]).includes(c.name) ? 'checked':''}><span class="slider"></span></label></label>`).join('');
  const pub = cfg.publisher || {};
  const pe = document.getElementById('publisherEnabled'); if (pe) pe.checked = !!pub.enabled;
  const pr = document.getElementById('publisherReward'); if (pr) pr.value = pub.rewardAmount || 25000;
  const pc = document.getElementById('publisherCooldown'); if (pc) pc.value = Math.round((pub.cooldownMs || 90000000)/3600000);
  const pm = document.getElementById('publisherMention'); if (pm) pm.value = pub.mentionMode || 'everyone';
  document.getElementById('publisherTotalRewards')?.replaceChildren(document.createTextNode(Number(pub.statistics?.totalRewards||0).toLocaleString('en')));
  document.getElementById('publisherTotalRevo')?.replaceChildren(document.createTextNode(Number(pub.statistics?.totalRevo||0).toLocaleString('en')));
  const rooms = cfg.rooms || {};
  const set = (id, arr) => { const e=document.getElementById(id); if(e)e.value=(arr||[]).join(','); };
  set('roomEmojiChannels', rooms.emoji); set('roomStickerChannels', rooms.sticker); set('roomOutlineChannels', rooms.outline?.channels); set('roomAutoChannels', rooms.autorec?.channels);
  const oi=document.getElementById('roomOutlineImage'); if(oi)oi.value=rooms.outline?.image||'';
  const oe=document.getElementById('roomAutoEmoji'); if(oe)oe.value=rooms.autorec?.emoji||'';
  const logs=cfg.logs||{}; const gl=document.getElementById('globalLogChannel'); if(gl)gl.value=logs.globalChannelId||'';
  const ll=document.getElementById('logsList'); if(ll){ const events=logs.events||{}; const names=Object.keys(events).length?Object.keys(events):['ban','kick','warn','member_join','member_leave','role_create','role_delete','channel_create','channel_delete','message_delete','message_edit','voice_join','voice_leave','protection_violation','ticket_open','ticket_close']; ll.innerHTML=names.map(k=>`<label class="switch-row log-row"><span>${escapeHtml(k)}</span><label class="switch"><input type="checkbox" data-log="${escapeHtml(k)}" ${events[k]?.enabled !== false?'checked':''}><span class="slider"></span></label></label>`).join(''); }
}

function escapeHtml(v){ return String(v??'').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function ids(v){ return String(v||'').split(',').map(x=>x.trim()).filter(Boolean); }

async function saveAdvancedControls() {
  const fn = {};
  document.querySelectorAll('[data-fn]').forEach(i => fn[i.dataset.fn]=i.checked);
  if (Object.keys(fn).length) await api(gurl('/api/guild/function'), {method:'POST', body:JSON.stringify({enabled:fn,allowedRoles:fullConfig.functionConfig?.allowedRoles||{},roleCategories:fullConfig.functionConfig?.roleCategories||[]})});
  const enabledCommands=[]; document.querySelectorAll('[data-slash]:checked').forEach(i=>enabledCommands.push(i.dataset.slash));
  await api(gurl('/api/guild/slash'), {method:'POST',body:JSON.stringify({enabledCommands,registeredCommands:fullConfig.slash?.registeredCommands||[],comeSlashEnabled:!!fullConfig.slash?.comeSlashEnabled,comePrefixEnabled:!!fullConfig.slash?.comePrefixEnabled})});
  showToast('تم حفظ أنظمة التحكم المتقدمة');
}

document.addEventListener('click', async e => {
  if (e.target.closest('#saveFunctions') || e.target.closest('#saveSlash')) await saveAdvancedControls();
  if (e.target.closest('#savePublisher')) {
    const res=await api(gurl('/api/guild/publisher'),{method:'POST',body:JSON.stringify({enabled:document.getElementById('publisherEnabled')?.checked,rewardAmount:+document.getElementById('publisherReward')?.value||25000,cooldownMs:(+document.getElementById('publisherCooldown')?.value||25)*3600000,mentionMode:document.getElementById('publisherMention')?.value,categories:fullConfig.publisher?.categories||[],channels:fullConfig.publisher?.channels||[]})});
    showToast(res?.ok?'تم حفظ متجر الناشرين':'تعذر الحفظ',!res?.ok);
  }
  if (e.target.closest('#saveRooms')) {
    const res=await api(gurl('/api/guild/rooms'),{method:'POST',body:JSON.stringify({emoji:ids(document.getElementById('roomEmojiChannels')?.value),sticker:ids(document.getElementById('roomStickerChannels')?.value),outline:{channels:ids(document.getElementById('roomOutlineChannels')?.value),image:document.getElementById('roomOutlineImage')?.value||null},autorec:{channels:ids(document.getElementById('roomAutoChannels')?.value),emoji:document.getElementById('roomAutoEmoji')?.value||null}})});
    showToast(res?.ok?'تم حفظ أنظمة الرومات':'تعذر الحفظ',!res?.ok);
  }
  if (e.target.closest('#saveLogs')) {
    const events={}; document.querySelectorAll('[data-log]').forEach(i=>events[i.dataset.log]={enabled:i.checked});
    const res=await api(gurl('/api/guild/logs'),{method:'POST',body:JSON.stringify({globalChannelId:document.getElementById('globalLogChannel')?.value.trim()||null,events})});
    showToast(res?.ok?'تم حفظ إعدادات السجلات':'تعذر الحفظ',!res?.ok);
  }
});

const oldLoadAll = loadAll;
loadAll = async function(){ await oldLoadAll(); await loadProMaxData(); };

function renderSystemCatalog(data){
  const el=document.getElementById('systemCatalog'); if(!el) return;
  el.innerHTML=(data.systems||[]).map(s=>`<div class="system-card"><div class="system-card-head"><span class="system-card-icon">${s.icon}</span><div><h3>${escapeHtml(s.name)}</h3><p>${s.items.length} أدوات مرتبطة</p></div></div><div class="system-card-tags">${s.items.map(x=>`<span>/${escapeHtml(x)}</span>`).join('')}</div></div>`).join('');
}
const oldRenderCommandCenter = renderCommandCenter;
renderCommandCenter = function(data){ oldRenderCommandCenter(data); renderSystemCatalog(data); };
