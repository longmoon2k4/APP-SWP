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
  loadingTitle.textContent = 'Đang khởi động ứng dụng...';
  loadingSub.textContent = 'Đang kiểm tra kết nối cơ sở dữ liệu...';
  retryBtn.style.display = 'none';
  try {
    const res = await window.electronAPI.startupCheck();
    if (res?.ok) {
        loadingTitle.textContent = 'Tất cả dịch vụ đều hoạt động';
        loadingSub.textContent = 'Sẵn sàng - chọn một hành động';
        setTimeout(()=>{
          loadingCard.style.display = 'none';
          // show mode selection first
          const modeCard = document.getElementById('mode-card');
          if (modeCard) modeCard.style.display = 'block';
        }, 600);
    } else {
      loadingTitle.textContent = 'Khởi động bị lỗi...';
      loadingSub.textContent = res?.message || 'Lỗi không xác định';
      retryBtn.style.display = 'inline-block';
      showToast('Khởi động thất bại: ' + (res?.message||'error'));
    }
  } catch (err) {
    loadingTitle.textContent = 'Khởi động bị lỗi...';
    loadingSub.textContent = err.message;
    retryBtn.style.display = 'inline-block';
    showToast('Khởi động bị lỗi: ' + err.message,4000);
  }
}

retryBtn.addEventListener('click', ()=>{ doStartupCheck(); });

// run on load
window.addEventListener('DOMContentLoaded', () => { doStartupCheck(); });

// initialize theme ASAP
initTheme();

// mode selection handlers
const chooseLogin = document.getElementById('choose-login');
const chooseBuy = document.getElementById('choose-buy');
chooseLogin?.addEventListener('click', ()=>{
  document.getElementById('mode-card').style.display = 'none';
  loginCard.style.display = 'block';
});
chooseBuy?.addEventListener('click', async ()=>{
  const buyUrl = 'https://smiledev.id.vn'; // change to real URL
  if (window.electronAPI?.openExternal) {
    await window.electronAPI.openExternal(buyUrl);
  } else {
    // fallback: open in new tab (if running in browser)
    window.open(buyUrl, '_blank');
  }
});

// Login handling (after startup check shows loginCard)
const loginBtn = document.getElementById('login-btn');
const clearBtn = document.getElementById('clear-btn');
const loginIdentifier = document.getElementById('login-identifier');
const loginPhone = document.getElementById('login-phone');
const loginFullname = document.getElementById('login-fullname');
const loginStore = document.getElementById('login-store');
const loginRole = document.getElementById('login-role');
const loginPassword = document.getElementById('login-password');
const loginStatus = document.getElementById('login-status');
const loginErrors = document.getElementById('login-errors');

function showErrors(msg){
  if (!loginErrors) return;
  loginErrors.textContent = msg;
  loginErrors.style.display = msg ? 'block' : 'none';
}

function clearForm(){
  loginIdentifier.value = '';
  loginPhone.value = '';
  loginFullname.value = '';
  loginStore.value = '';
  loginRole.value = '';
  loginPassword.value = '';
  showErrors('');
}

clearBtn?.addEventListener('click', (e)=>{ e.preventDefault(); clearForm(); showToast('Cleared form',1200); });

async function attemptLogin(){
  showErrors('');
  loginStatus.textContent = 'Logging in...';
  try {
    const payload = {
      identifier: loginIdentifier.value.trim(),
      phone: loginPhone.value.trim(),
      fullname: loginFullname.value.trim(),
      store: loginStore.value.trim(),
      role: loginRole.value,
      password: loginPassword.value,
      options: {
        strict: document.getElementById('opt-strict')?.checked ?? false,
        includeDisabled: document.getElementById('opt-include-disabled')?.checked ?? false,
        orderByLastLogin: document.getElementById('opt-last-login')?.checked ?? false
      }
    };

    // basic validation
    if (!payload.identifier && !payload.phone) {
      showErrors('Vui lòng nhập tên người dùng / email hoặc số điện thoại.');
      loginStatus.textContent = 'Waiting for input';
      return;
    }

    // prefer extended IPC if available
    let res;
    if (window.electronAPI?.authLoginEx) {
      res = await window.electronAPI.authLoginEx(payload);
    } else if (window.electronAPI?.authLogin) {
      // fallback: keep old signature (identifier, pass)
      res = await window.electronAPI.authLogin(payload.identifier || payload.phone, payload.password);
    } else {
      loginStatus.textContent = 'authLogin not available';
      showToast('authLogin not available',2000);
      return;
    }

    if (res?.ok) {
      const username = res.user?.username || res.user?.id || 'user';
      loginStatus.textContent = 'Logged in as ' + username;
      showToast('Welcome ' + username,2500);
      // hide login-card and show session card with logout/back buttons
      setTimeout(()=>{
        document.getElementById('login-card').style.display = 'none';
        const sc = document.getElementById('session-card');
        const su = document.getElementById('session-user');
        if (su) su.textContent = username;
        if (sc) sc.style.display = 'block';
      }, 400);
    } else {
      loginStatus.textContent = 'Login failed: ' + (res?.message ?? 'unknown');
      showErrors(res?.details || res?.message || 'Login failed');
      showToast('Login failed: ' + (res?.message ?? 'unknown'),3500);
    }
  } catch (err) {
    loginStatus.textContent = 'Error: ' + err.message;
    showErrors(err.message);
    showToast('Error: ' + err.message,4000);
  }
}

loginBtn.addEventListener('click', async () => { await attemptLogin(); });

loginPassword.addEventListener('keyup', (e)=>{ if (e.key === 'Enter') attemptLogin(); });

// session actions: back to selection and logout
const btnBack = document.getElementById('btn-back');
const btnLogout = document.getElementById('btn-logout');
btnBack?.addEventListener('click', ()=>{
  document.getElementById('session-card').style.display = 'none';
  const modeCard = document.getElementById('mode-card');
  if (modeCard) modeCard.style.display = 'block';
});
btnLogout?.addEventListener('click', ()=>{
  // clear any client session state (if implemented later)
  document.getElementById('session-card').style.display = 'none';
  const modeCard = document.getElementById('mode-card');
  if (modeCard) modeCard.style.display = 'block';
  showToast('Đã đăng xuất', 1800);
  // reset login UI
  clearForm();
  loginStatus.textContent = 'Not logged in';
});

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

