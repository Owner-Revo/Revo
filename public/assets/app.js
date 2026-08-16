const app=document.getElementById("app");
let page="home",selectedGuild="",mobile=false;
const items=[
["home","⌂","الرئيسية","main"],["economy","◈","اقتصاد Revo","main"],["top","♛","Top 100","main"],
["overview","▦","نظرة عامة","server"],["commands","⌘","Register Commands","server"],["welcome","✦","الترحيب","server"],
["xp","↗","XP & Levels","server"],["tickets","▣","Ticket System","premium"],["protection","◇","Protection","premium"],
["premium","◆","Premium Center","premium"],["settings","⚙","الإعدادات","server"]
];
const premiumPages=["tickets","protection","premium"];
const titles=Object.fromEntries(items.map(x=>[x[0],x[2]]));

function nav(x){return `<button class="nav ${page===x[0]?"active":""}" onclick="go('${x[0]}')"><span class="nav-icon">${x[1]}</span><span>${x[2]}</span>${x[3]==="premium"?"<span style='margin-right:auto;color:#a88cff'>◆</span>":""}</button>`}
function shell(){
app.innerHTML=`<div class="mobile-overlay" id="overlay" onclick="toggleSide()"></div>
<aside class="sidebar" id="sidebar">
<div class="brand"><span class="brand-logo">R</span><span>Revo<small>CONTROL CENTER</small></span></div>
<div class="profile"><div class="avatar">Y</div><div><b>Revo Admin</b><div class="tiny muted">Discord Account</div></div></div>
<div class="section">MAIN</div>${items.filter(x=>x[3]==="main").map(nav).join("")}
<div class="section">SERVER</div>
<select class="server-select" onchange="selectedGuild=this.value;render()"><option value="">اختيار السيرفر</option><option value="revo">Revo Community</option><option value="store">Revo Store</option></select>
${items.filter(x=>x[3]!=="main").map(nav).join("")}
<div class="section">ACCOUNT</div><button class="nav" onclick="toast('تسجيل الخروج سيتم ربطه مع Discord OAuth')">↪ <span>تسجيل الخروج</span></button>
</aside>
<main class="main"><header class="topbar"><div class="top-left"><button class="btn mobile-btn" onclick="toggleSide()">☰</button><span class="page-title" id="pageTitle">الرئيسية</span></div><div class="avatar">R</div></header><section class="content" id="view"></section></main>`;
render();
}
function toggleSide(){document.getElementById("sidebar").classList.toggle("open");document.getElementById("overlay").classList.toggle("show")}
function go(p){page=p;toggleSideIfMobile();render()}
function toggleSideIfMobile(){if(window.innerWidth<=1000){document.getElementById("sidebar").classList.remove("open");document.getElementById("overlay").classList.remove("show")}}
function head(code,title,desc,actions=""){return `<div class="hero"><div class="eyebrow">${code}</div><h1>${title}</h1><p class="muted">${desc}</p>${actions?`<div class="hero-actions">${actions}</div>`:""}</div>`}
function serverRequired(){return !selectedGuild?`<div class="card empty"><h3>اختار سيرفر أولًا</h3><p>اختار السيرفر من القائمة الجانبية لعرض إعداداته.</p></div>`:""}
function premiumLock(){return head("PREMIUM","🔒 Revo Premium","هذه الصفحة متاحة فقط للسيرفرات التي لديها اشتراك Premium.")+`<div class="locked"><div><b>Premium Required</b><div class="tiny muted">فعّل Premium لفتح جميع أدوات الحماية والتكتات ومميزات البوت.</div></div><button class="btn primary" onclick="go('premium')">عرض Premium</button></div>`}
function render(){
document.getElementById("pageTitle").textContent=titles[page]||"Dashboard";
if(premiumPages.includes(page)&&selectedGuild!=="revo"){document.getElementById("view").innerHTML=premiumLock();return}
({home,economy,top,overview,commands,welcome,xp,tickets,protection,premium,settings}[page]||home)();
}
function home(){
document.getElementById("view").innerHTML=head("REVO DASHBOARD","أهلًا بك في لوحة تحكم Revo 👋","تحكم في اقتصاد Revo، السيرفرات، الأنظمة، Premium، وسجلات البوت من مكان واحد.",`<button class="btn primary" onclick="go('economy')">فتح الاقتصاد</button><button class="btn" onclick="go('overview')">إدارة السيرفر</button>`)
+`<div class="stats"><div class="card stat"><small>رصيد Revo</small><strong>157,895</strong></div><div class="card stat"><small>Daily</small><strong>5,000</strong></div><div class="card stat"><small>Top Rank</small><strong>#12</strong></div><div class="card stat"><small>Bot Status</small><strong class="green">● ONLINE</strong></div></div>
<div class="grid"><div class="card"><div class="card-head"><h3>نشاط Revo</h3><span class="pill">آخر 30 يوم</span></div><div class="chart">${[38,54,47,76,60,88,66,96,58,78,90,70,84].map(h=>`<i class="bar" style="height:${h}%"></i>`).join("")}</div></div>
<div class="card"><div class="card-head"><h3>آخر التحويلات</h3><button class="btn" onclick="go('economy')">عرض الكل</button></div>${["Youssef → Ahmed","Mohamed → Khaled","Revo Store → Youssef","Omar → Youssef"].map((x,i)=>`<div class="row"><div class="grow"><b>${x}</b><div class="tiny muted">منذ ${i+2} دقيقة</div></div><b class="green">+${(i+1)*2500} R</b></div>`).join("")}</div></div>
<div class="card"><div class="card-head"><h3>الوصول السريع</h3><span class="pill premium">REVO</span></div><div class="feature-grid">${[["Daily","استلم هديتك اليومية"],["Top 100","شاهد ترتيب الأعضاء"],["XP","إدارة نظام المستويات"],["Tickets","نظام التكتات"],["Protection","حماية السيرفر"],["Premium","إدارة الاشتراك"]].map(x=>`<div class="feature" onclick="go('${x[0]==="Daily"?"economy":x[0].toLowerCase()}')"><h4>${x[0]}</h4><p>${x[1]}</p></div>`).join("")}</div></div>`;
}
function economy(){
document.getElementById("view").innerHTML=head("REVO ECONOMY","اقتصاد Revo","الرصيد، Daily، التحويلات، وسجل العمليات.")
+`<div class="stats"><div class="card stat"><small>رصيدك</small><strong>157,895</strong></div><div class="card stat"><small>Daily</small><strong>5,000</strong></div><div class="card stat"><small>الوارد</small><strong>94,200</strong></div><div class="card stat"><small>الصادر</small><strong>31,450</strong></div></div>
<div class="card"><div class="card-head"><h3>سجل التحويلات</h3><button class="btn" onclick="toast('تم تحديث السجل')">تحديث</button></div><div class="table-wrap"><table class="table"><thead><tr><th>العملية</th><th>المبلغ</th><th>الوقت</th><th>الحالة</th></tr></thead><tbody>${["+25,000","-10,000","+5,500","-2,000","+12,000"].map((x,i)=>`<tr><td>تحويل Revo</td><td class="${x[0]=="+"?"green":"red"}">${x} R</td><td>اليوم 14:${20+i}</td><td><span class="pill">مكتملة</span></td></tr>`).join("")}</tbody></table></div></div>`;
}
function top(){
document.getElementById("view").innerHTML=head("TOP 100","أغنى أعضاء Revo","ترتيب الأعضاء حسب الرصيد.")+`<div class="card"><div class="card-head"><h3>Leaderboard</h3><span class="pill">100 عضو</span></div>${["Youssef","Ahmed","Mohamed","Khaled","Omar","Mostafa","Ali"].map((x,i)=>`<div class="row"><b style="width:28px">#${i+1}</b><div class="avatar">${x[0]}</div><div class="grow"><b>${x}</b><div class="tiny muted">Member</div></div><b>${425800-i*38700} R</b></div>`).join("")}</div>`;
}
function overview(){
document.getElementById("view").innerHTML=head("SERVER OVERVIEW",selectedGuild?"Revo Community":"اختار سيرفر","نظرة عامة على حالة البوت وأنظمة السيرفر.",`<button class="btn primary" onclick="toast('تم تحديث البيانات')">تحديث البيانات</button>`)+serverRequired()+(selectedGuild?`<div class="stats"><div class="card stat"><small>Premium</small><strong class="green">ACTIVE</strong></div><div class="card stat"><small>Prefix</small><strong>?</strong></div><div class="card stat"><small>Members</small><strong>12.8K</strong></div><div class="card stat"><small>Systems</small><strong>18</strong></div></div><div class="card"><div class="card-head"><h3>حالة الأنظمة</h3><span class="pill premium">SERVER DATA</span></div>${["Economy","Welcome","XP & Levels","Protection","Tickets","Functions"].map(x=>`<div class="row"><div class="grow">${x}</div><span class="green">● Enabled</span><button class="btn" onclick="toast('فتح إعدادات ${x}')">إدارة</button></div>`).join("")}</div>`:"");
}
function commands(){generic("Register Commands","COMMANDS","تفعيل وإخفاء أوامر السلاش والبريفكس لكل سيرفر.");}
function welcome(){generic("نظام الترحيب","WELCOME","إعداد الترحيب، الرومات، الرسائل، والرتب.");}
function xp(){generic("XP & Levels","XP SYSTEM","إدارة XP واللفلات والرتب والـLeaderboard.");}
function tickets(){generic("Ticket System","PREMIUM TICKETS","نظام تكتات Premium احترافي مع Panels وClaim وTranscript وPoints.");}
function protection(){generic("Protection","PREMIUM PROTECTION","حماية متقدمة من السبام والبوتات والـRaid وتعديلات السيرفر.");}
function premium(){document.getElementById("view").innerHTML=head("PREMIUM CENTER","Revo Premium","إدارة مميزات Premium والاشتراك.")+`<div class="premium-banner"><b>Premium Active</b><div class="tiny muted">السيرفر المحدد مشترك في Premium.</div></div><div class="card"><div class="card-head"><h3>Premium Features</h3><span class="pill premium">UNLOCKED</span></div><div class="feature-grid">${["Bot Avatar","Bot Banner","Bot Nickname","Room Emoji","Room Sticker","Auto React","Outline Rooms","Premium Protection","Premium Tickets","Publisher Salary","Advanced Logs","Custom Ticket Prefix"].map(x=>`<div class="feature"><h4>${x}</h4><p>متاح للسيرفر المشترك ويمكن إدارته من لوحة التحكم.</p><button class="btn primary" onclick="toast('تم فتح إعداد ${x}')">إدارة</button></div>`).join("")}</div></div>`;}
function settings(){generic("إعدادات السيرفر","SETTINGS","الإعدادات العامة، Prefix، Logs، والصلاحيات.");}
function generic(title,key,desc){
document.getElementById("view").innerHTML=head(key,title,desc)+serverRequired()+(selectedGuild?`<div class="card"><div class="card-head"><h3>إعدادات النظام</h3><button class="btn primary" onclick="toast('تم حفظ الإعدادات')">حفظ التغييرات</button></div>${["تفعيل النظام","الروم الأساسية","الرسالة","الرتب","الصلاحيات","السجلات","Cooldown","Auto Delete"].map((x,i)=>`<div class="setting"><div><b>${x}</b><div class="tiny muted">${i===0?"تشغيل أو إيقاف النظام":"تخصيص إعدادات "+x}</div></div>${i===0?'<button class="switch on"></button>':'<button class="btn">تعديل</button>'}</div>`).join("")}</div>`:"");
}
shell();