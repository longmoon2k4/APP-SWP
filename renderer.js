const toast = document.getElementById('toast');
const themeToggle = document.getElementById('theme-toggle');
const appLogo = document.getElementById('app-logo');
const loadingCard = document.getElementById('loading-card');
const loadingTitle = document.getElementById('loading-title');
const loadingSub = document.getElementById('loading-sub');
const retryBtn = document.getElementById('retry-btn');
const loginCard = document.getElementById('login-card');

function showToast(msg, timeout=3000){
  toast.textContent = msg;
  toast.style.display = 'block';
  setTimeout(()=>{ toast.style.display = 'none'; }, timeout);
}

// Theme handling: persist in localStorage, swap CSS variables for light theme and swap logo
function applyTheme(theme){
  const root = document.documentElement;
  if (theme === 'light'){
    root.classList.add('light-theme');
    if (appLogo) appLogo.src = 'img/white.png';
    if (themeToggle) themeToggle.textContent = '☀️';
  } else {
    root.classList.remove('light-theme');
    if (appLogo) appLogo.src = 'img/black.png';
    if (themeToggle) themeToggle.textContent = '🌙';
  }
  // microinteraction on toggle
  if (themeToggle){
    themeToggle.animate([
      { transform: 'scale(1)' },
      { transform: 'scale(1.15)' },
      { transform: 'scale(1)' }
    ], { duration: 220, easing: 'ease-out' });
  }
}

function initTheme(){
  const saved = localStorage.getItem('theme') || 'dark';
  applyTheme(saved);
  if (themeToggle){
    themeToggle.addEventListener('click', ()=>{
      const current = localStorage.getItem('theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      localStorage.setItem('theme', next);
      applyTheme(next);
      showToast('Switched to ' + next + ' theme', 1500);
    });
  }
}

async function doStartupCheck(){
  loadingTitle.textContent = 'Starting application';
  loadingSub.textContent = 'Checking database connection...';
  retryBtn.style.display = 'none';
  try {
    const res = await window.electronAPI.startupCheck();
    if (res?.ok) {
      loadingTitle.textContent = 'All services OK';
      loadingSub.textContent = 'Ready — opening login';
      setTimeout(()=>{
        loadingCard.style.display = 'none';
        loginCard.style.display = 'block';
      }, 600);
    } else {
      loadingTitle.textContent = 'Startup error';
      loadingSub.textContent = res?.message || 'Unknown error';
      retryBtn.style.display = 'inline-block';
      showToast('Startup failed: ' + (res?.message||'error'));
    }
  } catch (err) {
    loadingTitle.textContent = 'Startup error';
    loadingSub.textContent = err.message;
    retryBtn.style.display = 'inline-block';
    showToast('Startup exception: ' + err.message,4000);
  }
}

retryBtn.addEventListener('click', ()=>{ doStartupCheck(); });

// run on load
window.addEventListener('DOMContentLoaded', () => { doStartupCheck(); });

// initialize theme ASAP
initTheme();

// Login handling (after startup check shows loginCard)
const loginBtn = document.getElementById('login-btn');
const loginIdentifier = document.getElementById('login-identifier');
const loginPassword = document.getElementById('login-password');
const loginStatus = document.getElementById('login-status');

loginBtn.addEventListener('click', async () => {
  loginStatus.textContent = 'Logging in...';
  try {
    if (!window.electronAPI?.authLogin) {
      loginStatus.textContent = 'authLogin not available';
      showToast('authLogin not available',2000);
      return;
    }
    const id = loginIdentifier.value.trim();
    const pw = loginPassword.value;
    const res = await window.electronAPI.authLogin(id, pw);
    if (res?.ok) {
      loginStatus.textContent = 'Logged in as ' + res.user.username;
      showToast('Welcome ' + res.user.username,2500);
    } else {
      loginStatus.textContent = 'Login failed: ' + (res?.message ?? 'unknown');
      showToast('Login failed: ' + (res?.message ?? 'unknown'),3500);
    }
  } catch (err) {
    loginStatus.textContent = 'Error: ' + err.message;
    showToast('Error: ' + err.message,4000);
  }
});

loginPassword.addEventListener('keyup', (e)=>{ if (e.key === 'Enter') loginBtn.click(); });

// --- Starfield background ---
(() => {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let stars = [];
  let starOpacity = 1; // eased brightness for theme crossfade
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  function resize(){
    const { innerWidth:w, innerHeight:h } = window;
    canvas.width = Math.floor(w * DPR);
    canvas.height = Math.floor(h * DPR);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(DPR,0,0,DPR,0,0);
    // regenerate stars based on area
    const count = Math.floor((w*h)/10000);
    stars = new Array(count).fill(0).map(()=>({
      x: Math.random()*w,
      y: Math.random()*h,
      r: Math.random()*1.7 + 0.2,
      a: Math.random()*1,
      v: (Math.random()*0.02)+0.005,
      driftX: (Math.random()*0.15 - 0.075),
      driftY: (Math.random()*0.06 - 0.03)
    }));
  }
  function step(){
    const { width, height } = canvas;
    ctx.clearRect(0,0,width,height);
    const isLight = document.documentElement.classList.contains('light-theme');
    const target = isLight ? 0.15 : 1;
    starOpacity += (target - starOpacity) * 0.05; // ease
    for (const s of stars){
      s.a += s.v;
      const alpha = 0.3 + 0.7*(0.5+0.5*Math.sin(s.a));
      // slow drift for dark theme only
      if (!isLight){
        s.x += s.driftX;
        s.y += s.driftY;
        if (s.x < 0) s.x += width; else if (s.x > width) s.x -= width;
        if (s.y < 0) s.y += height; else if (s.y > height) s.y -= height;
      }
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
      ctx.fillStyle = `rgba(238, 244, 255, ${alpha * starOpacity})`;
      ctx.fill();
    }
    requestAnimationFrame(step);
  }
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(step);
})();

// --- Clouds for light theme ---
(() => {
  const canvas = document.getElementById('cloud-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  let clouds = [];
  function resize(){
    const { innerWidth:w, innerHeight:h } = window;
    canvas.width = Math.floor(w * DPR);
    canvas.height = Math.floor(h * DPR);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(DPR,0,0,DPR,0,0);
    // create a few layered clouds
    const count = 6;
    clouds = new Array(count).fill(0).map((_,i)=>({
      x: Math.random()*w,
      y: h*0.15 + i* (h*0.12/count),
      scale: 0.8 + Math.random()*0.8,
      speed: 0.15 + Math.random()*0.2
    }));
  }
  function drawCloud(x,y,scale){
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.shadowColor = 'rgba(15,23,42,0.12)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(x, y, 30*scale, 0, Math.PI*2);
    ctx.arc(x+35*scale, y-10*scale, 24*scale, 0, Math.PI*2);
    ctx.arc(x+70*scale, y, 34*scale, 0, Math.PI*2);
    ctx.arc(x+45*scale, y+12*scale, 28*scale, 0, Math.PI*2);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  function step(){
    const { width, height } = canvas;
    ctx.clearRect(0,0,width,height);
    if (document.documentElement.classList.contains('light-theme')){
      for (const c of clouds){
        c.x += c.speed;
        if (c.x - 100 > width) c.x = -120;
        drawCloud(c.x, c.y, c.scale);
      }
    }
    requestAnimationFrame(step);
  }
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(step);
})();

// --- Sun bobbing ---
(() => {
  const sun = document.getElementById('sun');
  if (!sun) return;
  let t = 0;
  function step(){
    const isLight = document.documentElement.classList.contains('light-theme');
    if (isLight){
      t += 0.01;
      const dy = Math.sin(t) * 4; // gentle bob
      sun.style.transform = `translateY(${dy}px)`;
    }
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
})();

