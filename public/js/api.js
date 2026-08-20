const $ = (s,p=document)=>p.querySelector(s);
const $$ = (s,p=document)=>[...p.querySelectorAll(s)];
function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function fmt(n){return Number(n||0).toLocaleString('en-US');}
function toast(msg,bad=false){const t=$('#toast');t.textContent=msg;t.className=bad?'show bad':'show';clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.className='',2600);}
async function api(url,opts={}){const r=await fetch(url,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(opts.headers||{})},...opts});if(r.status===401){location.href='/?error=session_expired';return null;}let d=null;try{d=await r.json()}catch{}if(!r.ok)throw new Error(d?.error||`HTTP ${r.status}`);return d;}
function gurl(path){const id=localStorage.getItem('revo_guild');return id?`${path}?guildId=${encodeURIComponent(id)}`:path;}
