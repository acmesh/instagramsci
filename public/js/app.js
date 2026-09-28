/* Instagramsci — app orchestration (Phase 2).
   Renders from the api layer (live Supabase or demo seed), manages auth state,
   gates posting/reacting to approved members, and drives the admin review page. */
import { MODE } from "./config.js?v=20260927";
import * as Auth from "./auth.js?v=20260927";
import * as API from "./api.js?v=20260927";

const LIVE = MODE !== "demo";   // postgres or supabase = live backend

const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c =>
  ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));

let FEED = [];   // current feed (normalized post objects)

/* ===================== THEME ===================== */
function applyTheme(t){
  document.documentElement.setAttribute("data-theme", t);
  try{ localStorage.setItem("igs-theme", t); }catch(e){}
  const lbl=$("#themeLabel"); if(lbl) lbl.textContent = t==="dark"?"Light mode":"Dark mode";
  const ic=$("#themeIcon");   if(ic)  ic.textContent  = t==="dark"?"☀":"☾";
}
function initTheme(){
  let t="light";
  try{ t=localStorage.getItem("igs-theme") ||
       (matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"); }catch(e){}
  applyTheme(t);
}
const toggleTheme = () =>
  applyTheme(document.documentElement.getAttribute("data-theme")==="dark"?"light":"dark");

/* ===================== POST CARD ===================== */
/* The author and admins can delete a post (the API enforces the same rule). */
function canDelete(p){
  if(!LIVE || !Auth.isSignedIn()) return false;
  return Auth.isAdmin() || p.handle === Auth.currentProfile().handle;
}
function avatar(a, handle){
  return a.avatar
    ? `<img src="${esc(a.avatar)}" alt="Avatar of @${esc(handle)}" loading="lazy"/>`
    : `<span class="avph" aria-hidden="true">${esc((a.name || handle || "?").slice(0,1).toUpperCase())}</span>`;
}
function postCard(p){
  const a = p.author || {};
  const meta = a.pron ? ` · ${esc(a.pron)}` : "";
  const extra = p.manifestoLink
    ? `<div class="postlink"><a href="#manifesto" data-go="manifesto">Read the Manifesto →</a></div>`
    : (p.caption ? `<div class="attrib" style="font-style:normal;color:var(--text-2)">${esc(p.caption)}</div>` : "");
  const mine = p.mine || [];
  const onR = mine.includes("resonate"), onC = mine.includes("collect"), onA = mine.includes("amplify");
  // Posts without a photo are notes: no media block, bigger text.
  const media = p.image ? `
    <div class="media">
      <div class="imgwrap"><img src="${esc(p.image)}" alt="${esc(p.alt)}" loading="lazy"/></div>
      <span class="altbadge">ALT ✓</span>
    </div>` : "";
  return `
  <article class="card${p.pinned?" pinned":""}${p.image?"":" note"}" id="post-${esc(p.id)}">
    ${p.pinned?`<div class="pinflag">✦ First post · pinned</div>`:""}
    <div class="head">
      ${avatar(a, p.handle)}
      <div class="who"><b>${esc(a.name)}</b><br><small>@${esc(p.handle)}${meta}</small></div>
      ${p.tag?`<span class="pill">${esc(p.tag)}</span>`:""}
      ${canDelete(p)?`<button class="postdel" data-delpost="${esc(p.id)}">Delete</button>`:""}
    </div>
    ${media}
    <div class="aphorism"><span class="q">“</span>${esc(p.aphorism)}<span class="q">”</span></div>
    ${p.attrib?`<div class="attrib">— ${esc(p.attrib)}</div>`:""}
    ${extra}
    <div class="actions" data-id="${esc(p.id)}">
      <button class="act resonate${onR?" on":""}" data-kind="resonate" aria-pressed="${onR}">
        <span class="ic" aria-hidden="true">✊</span><span class="lbl">${onR?"Resonates":"Resonate"}</span>
        <span class="count">${p.reactions.resonate}</span>
      </button>
      <button class="act discuss" data-post="${esc(p.id)}">
        <span class="ic" aria-hidden="true">❝</span><span class="lbl">Discuss</span>
        <span class="count">${p.comments}</span>
      </button>
      <button class="act collect${onC?" on":""}" data-kind="collect" aria-pressed="${onC}">
        <span class="ic" aria-hidden="true">❏</span><span class="lbl">Collect</span>
        <span class="count">${p.reactions.collect}</span>
      </button>
      <button class="act amplify${onA?" on":""}" data-kind="amplify" aria-pressed="${onA}">
        <span class="ic" aria-hidden="true">⇄</span><span class="lbl">Amplify</span>
        <span class="count">${p.reactions.amplify}</span>
      </button>
    </div>
    <div class="comments" id="cm-${esc(p.id)}" hidden></div>
  </article>`;
}

/* ===================== RENDER ===================== */
const COMMONS_TAGS = ["#Commons","#Care","#Energy"];
const FILTER = { tab:"latest", tag:null };   // feed tab + theme picked in Explore

async function loadFeed(){
  FEED = await API.getFeed();
  renderFeed();
  renderGrids();
}
function renderFeed(){
  let list = FEED;
  if(FILTER.tab === "commons") list = list.filter(p => p.tags.some(t => COMMONS_TAGS.includes(t)));
  if(FILTER.tag) list = list.filter(p => p.tags.includes(FILTER.tag));
  const bar = $("#filterBar");
  bar.hidden = !FILTER.tag;
  if(FILTER.tag) bar.innerHTML = `Showing <b>${esc(FILTER.tag)}</b> <button data-clear-filter>Show all</button>`;
  $("#feed").innerHTML = list.length ? list.map(postCard).join("")
    : `<p class="sub" style="text-align:center">Nothing here yet.</p>`;
}
const short = (s, n) => s.length > n ? s.slice(0, n).trimEnd() + "…" : s;
const tile = (p) => p.image
  ? `<div class="tile" data-tile="${esc(p.id)}" role="button" tabindex="0">
       <img src="${esc(p.image)}" alt="${esc(p.alt)}" loading="lazy"/>
       <div class="ov">“${esc(short(p.aphorism, 52))}”</div></div>`
  : `<div class="tile text" data-tile="${esc(p.id)}" role="button" tabindex="0">
       <div class="tq">“${esc(short(p.aphorism, 90))}”</div></div>`;
function renderGrids(){
  $("#tagcloud").innerHTML = API.TAGS.map(t=>`<button class="tagbtn" data-tag="${esc(t)}">${esc(t)}</button>`).join("");
  $("#exploreGrid").innerHTML = FEED.map(tile).join("");
}
/* Open a post from a grid tile: show the full feed and scroll to its card. */
function showPost(id){
  FILTER.tag = null; setTab("latest");
  go("feed"); renderFeed();
  document.getElementById("post-" + id)?.scrollIntoView({ block:"start", behavior:"instant" });
}

/* ===================== PROFILE ===================== */
function openProfile(){
  const signed = Auth.isSignedIn();
  let p = signed ? Auth.currentProfile() : null;
  if(!p && !LIVE){   // demo placeholder so the page isn't empty
    p = { handle:"you", display_name:"You", pronouns:"she/they",
          bio:"Demo profile — connect a backend and log in to see yours.",
          avatar_url:"https://i.pravatar.cc/160?img=15" };
  }
  $("#profileGuest").style.display = p ? "none" : "block";
  $("#profileBody").style.display  = p ? "block" : "none";
  if(!p) return;
  const av = $("#pAvatar"); av.style.visibility = "visible"; av.src = p.avatar_url || "";
  $("#pName").textContent   = p.display_name || p.handle || "You";
  $("#pHandle").textContent = "@" + (p.handle || "you") + (p.pronouns ? " · " + p.pronouns : "");
  $("#pBio").textContent    = p.bio || "";
  const mine = FEED.filter(x => x.handle === p.handle);
  $("#pStatPosts").textContent      = mine.length;
  $("#pStatResonance").textContent  = mine.reduce((s,x)=>s+(x.reactions.resonate||0), 0);
  $("#pStatCollect").textContent    = mine.reduce((s,x)=>s+(x.reactions.collect||0), 0);
  $("#profileGrid").innerHTML = mine.map(tile).join("");
  $("#profileEmpty").style.display = mine.length ? "none" : "block";
}

/* ===================== AUTH UI ===================== */
function renderAuth(){
  const signedIn = Auth.isSignedIn();
  const p = Auth.currentProfile();
  // show admin entries to real admins; also in demo mode so they can be previewed
  const adminish = Auth.isAdmin() || !LIVE;
  $("#navAdmin").style.display = adminish ? "flex" : "none";
  $("#navUsers").style.display = adminish ? "flex" : "none";
  $("#navSettings").style.display = (Auth.isSignedIn() || !LIVE) ? "flex" : "none";

  const box = $("#authArea");
  if(signedIn){
    const status = Auth.isApproved()
      ? `<span class="statuschip ok">approved</span>`
      : `<span class="statuschip wait">pending review</span>`;
    box.innerHTML = `
      <div class="me">
        <img src="${esc(p.avatar_url||'')}" alt="" onerror="this.style.visibility='hidden'"/>
        <div><b style="font-size:14px">@${esc(p.handle)}</b><br><small>${status}</small></div>
      </div>
      <button class="navitem" data-auth="logout"><span class="ic">⎋</span> Log out</button>`;
  } else {
    box.innerHTML = `
      <button class="navitem" data-go="login"><span class="ic">→</span> Log in</button>
      <button class="navitem" data-go="join"><span class="ic">✎</span> Apply to join</button>`;
  }

  // Bottom bar (mobile): the account slot opens your profile, or login when signed out
  const bb = $("#bbMe");
  if(bb){
    bb.dataset.go = signedIn ? "profile" : "login";
    bb.textContent = signedIn ? "☺" : "→";
    bb.title = signedIn ? "Profile" : "Log in";
    bb.setAttribute("aria-label", bb.title);
  }

  // Topbar control (on phones only "Log in" shows; the rest is in the bottom bar and menu)
  const top = $("#authTop");
  if(top){
    top.innerHTML = signedIn
      ? `<button class="topauth" data-go="profile" title="Your profile">@${esc(p.handle)}</button>
         <button class="topauth ghost" data-auth="logout">Log out</button>`
      : `<button class="topauth" data-go="login">Log in</button>`;
  }
}

/* Can the current user act (post/react)? In demo mode, allow everything. */
function canAct(){ return !LIVE || Auth.isApproved(); }
function requireApproval(){
  if(canAct()) return true;
  if(!Auth.isSignedIn()){ go("login"); flash("Please log in (or apply) to take part."); }
  else flash("Your account is awaiting approval. You can read everything meanwhile.");
  return false;
}

/* ===================== VIEWS ===================== */
const TITLES={feed:"Home",explore:"Explore",compose:"Compose",profile:"Profile",
  manifesto:"Manifesto",join:"Apply to join",login:"Log in",admin:"Member review",
  users:"Members",settings:"Settings"};
const VIEWS = Object.keys(TITLES);
let CURRENT = null;   // view on screen, or null while the landing page shows

/* Each view has a URL (#feed, #compose…) so reload keeps you in place and the
   phone's back gesture moves between views instead of leaving the site. */
function go(view, { fromHistory=false } = {}){
  if(!VIEWS.includes(view)) view = "feed";
  CURRENT = view;
  if(!fromHistory && location.hash !== "#" + view) history.pushState(null, "", "#" + view);
  setDrawer(false);
  document.body.classList.add("in-app");
  $$(".view").forEach(v=>v.classList.remove("active"));
  const el=$("#view-"+view); if(el) el.classList.add("active");
  $("#viewTitle").textContent = TITLES[view]||"";
  $("#feedTabs").style.display = view==="feed"?"flex":"none";
  $$(".rail .navitem").forEach(n=>n.classList.toggle("active", n.dataset.go===view));
  $$(".bottombar button").forEach(n=>n.classList.toggle("active", n.dataset.go===view));
  if(view==="admin") renderAdmin();
  if(view==="users") renderUsers();
  if(view==="settings") openSettings();
  if(view==="profile") openProfile();
  window.scrollTo({ top:0, behavior:"instant" });   // a new page, not a smooth scroll
}
function showLanding(){
  CURRENT = null;
  setDrawer(false);
  document.body.classList.remove("in-app");
  window.scrollTo({ top:0, behavior:"instant" });
}
function onHistory(){
  const v = location.hash.slice(1);
  if(!v) showLanding();
  else if(v !== CURRENT) go(v, { fromHistory:true });
}

/* ===================== MOBILE DRAWER ===================== */
function setDrawer(open){
  document.body.classList.toggle("drawer-open", open);
  $("[data-drawer]")?.setAttribute("aria-expanded", String(open));
}

/* Feed tabs (Latest / Commons) */
function setTab(name){
  FILTER.tab = name;
  $$("#feedTabs .tab").forEach(x=>x.classList.toggle("active", x.dataset.tab===name));
}

/* ===================== FLASH (toast) ===================== */
let flashT;
function flash(msg){
  let el=$("#flash");
  if(!el){ el=document.createElement("div"); el.id="flash"; document.body.appendChild(el); }
  el.textContent=msg; el.classList.add("show");
  clearTimeout(flashT); flashT=setTimeout(()=>el.classList.remove("show"), 3200);
}

/* ===================== IMAGE SHRINK ===================== */
/* Phone photos are often 5-15 MB. Shrink them in the browser before upload:
   faster on mobile data, and well under the server's 8 MB cap. The server
   re-encodes anyway (that's where EXIF/GPS is stripped); this is only size.
   If the browser can't decode the file, the original goes up unchanged. */
async function shrinkImage(file, maxSide){
  if(file.type === "image/gif") return file;          // keep it as is; the server handles it
  try{
    const bmp = await createImageBitmap(file, { imageOrientation:"from-image" });
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if(scale === 1 && file.size < 1.5 * 1024 * 1024){ bmp.close?.(); return file; }
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);   // transparent PNG -> white, not black
    ctx.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.88));
    if(!blob) return file;
    return new File([blob], (file.name || "photo").replace(/\.\w+$/, "") + ".jpg", { type:"image/jpeg" });
  }catch(e){ return file; }
}

/* ===================== COMPOSE ===================== */
function wireCompose(){
  const form=$("#composeForm"), file=$("#composeFile"), drop=$("#composeDrop");
  if(!form) return;
  const aph=$("#cAph"), count=$("#cAphCount"), altRow=$("#cAltRow"), share=$("#composeShare");
  const DROP_HTML = drop.innerHTML;
  let picked = null;   // the photo to upload, already shrunk

  $("#cTagsHint").textContent = "Themes: " + API.TAGS.map(t => t.slice(1).toLowerCase()).join(", ");
  aph.addEventListener("input", ()=>{ count.textContent = aph.value.length; });

  async function setImage(f){
    if(!f) return;
    if(!f.type.startsWith("image/")){ flash("That file isn't an image."); return; }
    drop.textContent = "Preparing photo…";
    picked = await shrinkImage(f, 2048);
    drop.innerHTML = `<img src="${URL.createObjectURL(picked)}" alt="Selected photo preview"/>Photo ready. Tap to change it.`;
    altRow.hidden = false;
  }
  drop.addEventListener("click", ()=>file.click());
  drop.addEventListener("keydown", e=>{ if(e.key==="Enter" || e.key===" "){ e.preventDefault(); file.click(); } });
  file.addEventListener("change", ()=>setImage(file.files[0]));
  drop.addEventListener("dragover", e=>{ e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", ()=>drop.classList.remove("over"));
  drop.addEventListener("drop", e=>{ e.preventDefault(); drop.classList.remove("over"); setImage(e.dataTransfer.files[0]); });

  function resetCompose(){
    form.reset(); picked = null;
    drop.innerHTML = DROP_HTML; altRow.hidden = true; count.textContent = "0";
  }
  function busy(on){ share.disabled = on; share.textContent = on ? "Posting…" : "Share your idea"; }

  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    if(!requireApproval()) return;
    const aphorism=aph.value.trim(), altText=$("#cAlt").value.trim();
    if(!aphorism){ flash("Write your aphorism first."); aph.focus(); return; }
    if(picked && !altText){ flash("Describe the photo in the alt text field."); $("#cAlt").focus(); return; }
    if(!LIVE){ flash("Demo mode: connect a backend to publish for real."); return; }
    busy(true);   // also blocks a second tap while the upload runs
    try{
      await API.createPost({
        file:picked, aphorism, altText,
        attribution:$("#cAttr").value.trim(),
        tagLabels:$("#cTags").value.split(/[\s,]+/).filter(Boolean)
      });
    }catch(err){ busy(false); flash("Could not post: " + err.message); return; }
    // The post is saved. Nothing below may report "could not post".
    busy(false); resetCompose(); flash("Posted ✦");
    FILTER.tag = null; setTab("latest");
    try{ await loadFeed(); }catch(err){ /* the feed refreshes on the next visit */ }
    go("feed");
  });
}

/* ===================== JOIN / SIGNUP ===================== */
function wireJoin(){
  const form=$("#joinForm"); if(!form) return;
  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const payload={
      email:$("#jEmail").value.trim(),
      password:$("#jPass").value,
      handle:$("#jHandle").value.trim(),
      origin:$("#jOrigin").value.trim(),
      intentions:$("#jIntent").value.trim()
    };
    try{
      await Auth.signUp(payload);
      form.style.display="none";
      $("#joinDone").classList.add("show");
      renderAuth();
      window.scrollTo({top:0});
    }catch(err){ flash("Could not submit: "+err.message); }
  });
}

/* ===================== LOGIN (with optional 2FA step) ===================== */
function wireLogin(){
  const form=$("#loginForm"); if(!form) return;
  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    if(!LIVE){ flash("Demo mode: connect a backend to enable real login."); return; }
    try{
      const res = await Auth.signIn({
        email:$("#lEmail").value.trim(),
        password:$("#lPass").value,
        code:$("#lCode").value.trim()
      });
      if(res && res.twofa_required){
        $("#lCodeRow").style.display = "block";       // reveal the code field
        $("#lCode").focus();
        flash(res.error || "Enter the 6-digit code from your authenticator app.");
        return;
      }
      $("#lCodeRow").style.display = "none"; $("#lCode").value = "";
      renderAuth(); await loadFeed(); go("feed"); flash("Welcome back.");
    }catch(err){ flash("Login failed: "+err.message); }
  });
}

/* ===================== SETTINGS ===================== */
function needLive(){
  if(MODE !== "postgres"){ flash("Demo mode — connect your backend to save changes."); return false; }
  return true;
}
function openSettings(){
  const signed = Auth.isSignedIn();
  $("#settingsGuest").style.display = signed ? "none" : "block";
  $("#settingsBody").style.display  = signed ? "block" : "none";
  if(signed) populateSettings();
}
function populateSettings(){
  const p = Auth.currentProfile() || {};
  $("#setName").value  = p.display_name || "";
  $("#setPron").value  = p.pronouns || "";
  $("#setBio").value   = p.bio || "";
  $("#setEmail").value = p.email || "";
  const av = $("#setAvatar"); av.style.visibility = "visible"; av.src = p.avatar_url || "";
  $("#twofaOff").style.display   = p.has_2fa ? "none" : "block";
  $("#twofaOn").style.display    = p.has_2fa ? "block" : "none";
  $("#twofaSetup").style.display = "none";
}
function wireSettings(){
  if(!$("#setSaveProfile")) return;
  $("#setAvatarBtn").addEventListener("click", ()=>$("#setAvatarFile").click());
  $("#setAvatarFile").addEventListener("change", async ()=>{
    const f=$("#setAvatarFile").files[0]; if(!f || !needLive()) return;
    try{ await Auth.uploadAvatar(await shrinkImage(f, 1024)); populateSettings(); renderAuth(); flash("Avatar updated."); }
    catch(e){ flash("Could not upload: "+e.message); }
  });
  $("#setSaveProfile").addEventListener("click", async ()=>{
    if(!needLive()) return;
    try{
      await Auth.updateProfile({ display_name:$("#setName").value.trim(),
        bio:$("#setBio").value.trim(), pronouns:$("#setPron").value.trim() });
      renderAuth(); flash("Profile saved.");
    }catch(e){ flash("Could not save: "+e.message); }
  });
  $("#setSaveEmail").addEventListener("click", async ()=>{
    if(!needLive()) return;
    try{
      await Auth.changeEmail({ email:$("#setEmail").value.trim(), password:$("#setEmailPass").value });
      $("#setEmailPass").value=""; flash("Email updated.");
    }catch(e){ flash(e.message); }
  });
  $("#setSavePass").addEventListener("click", async ()=>{
    if(!needLive()) return;
    try{
      await Auth.changePassword({ current_password:$("#setCurPass").value, new_password:$("#setNewPass").value });
      $("#setCurPass").value=""; $("#setNewPass").value=""; flash("Password changed.");
    }catch(e){ flash(e.message); }
  });
  // ---- 2FA ----
  $("#twofaStart").addEventListener("click", async ()=>{
    if(!needLive()) return;
    try{
      const d = await Auth.twofaSetup();
      $("#twofaSecret").textContent = d.secret;
      $("#twofaSetup").style.display = "block";
      const mod = await import("https://esm.sh/qrcode@1.5.4");      // loaded only when needed
      const toDataURL = (mod.default || mod).toDataURL;
      $("#twofaQR").src = await toDataURL(d.otpauth_uri, { margin:1, width:200 });
    }catch(e){ flash("Could not start 2FA: "+e.message); }
  });
  $("#twofaConfirm").addEventListener("click", async ()=>{
    if(!needLive()) return;
    try{ await Auth.twofaEnable($("#twofaCode").value.trim()); populateSettings(); flash("Two-factor authentication enabled ✦"); }
    catch(e){ flash(e.message); }
  });
  $("#twofaDisable").addEventListener("click", async ()=>{
    if(!needLive()) return;
    try{ await Auth.twofaDisable($("#twofaDisPass").value); $("#twofaDisPass").value=""; populateSettings(); flash("Two-factor authentication disabled."); }
    catch(e){ flash(e.message); }
  });
}

/* ===================== ADMIN REVIEW ===================== */
async function renderAdmin(){
  const wrap=$("#adminList");
  if(LIVE && !Auth.isAdmin()){ wrap.innerHTML=`<p class="sub">Admins only.</p>`; return; }
  wrap.innerHTML=`<p class="sub">Loading applications…</p>`;
  const apps=await API.listPendingApplications();
  if(!apps.length){ wrap.innerHTML=`<p class="sub">No pending applications. 🎉</p>`; return; }
  wrap.innerHTML=apps.map(a=>`
    <div class="appcard" data-app="${esc(a.id)}">
      <div class="apphead"><b>${esc(a.handle||"(no handle)")}</b><small>${esc(a.email||"")}</small></div>
      ${a.origin?`<div class="apporigin">From: ${esc(a.origin)}</div>`:""}
      <div class="appintent">${esc(a.intentions)}</div>
      <div class="appactions">
        <button class="btn primary" data-approve="${esc(a.id)}">Approve</button>
        <button class="btn ghost" data-reject="${esc(a.id)}">Reject</button>
      </div>
    </div>`).join("");
}

/* ===================== MEMBERS (admin) ===================== */
let MY_ID = null;   // current admin's user id (to protect own row)
async function renderUsers(){
  const wrap=$("#usersList");
  if(LIVE && !Auth.isAdmin()){ wrap.innerHTML=`<p class="sub">Admins only.</p>`; return; }
  wrap.innerHTML=`<p class="sub">Loading members…</p>`;
  let users=[], me=null;
  try{ ({users, me}=await API.listUsers()); }
  catch(e){ wrap.innerHTML=`<p class="sub">Couldn't load members: ${esc(e.message)}</p>`; return; }
  MY_ID=me;
  if(!users.length){ wrap.innerHTML=`<p class="sub">No approved members yet.</p>`; return; }
  wrap.innerHTML=users.map(u=>{
    const self=u.id===me;
    const chip=u.is_admin?`<span class="statuschip ok">admin</span>`
      :u.is_blocked?`<span class="statuschip wait">blocked</span>`
      :`<span class="statuschip ok">active</span>`;
    const actions=self?`<span class="hint">that's you</span>`:`
      ${u.is_blocked
        ? `<button class="btn ghost" data-unblock="${esc(u.id)}">Unblock</button>`
        : `<button class="btn ghost" data-block="${esc(u.id)}">Block</button>`}
      <button class="btn danger" data-deluser="${esc(u.id)}" data-handle="${esc(u.handle)}">Delete</button>`;
    return `<div class="userrow" data-user="${esc(u.id)}">
      <div class="uinfo"><b>@${esc(u.handle)}</b> ${chip}<br><small>${esc(u.email||"")}</small></div>
      <div class="uactions">${actions}</div>
    </div>`;
  }).join("");
}

/* ===================== INIT ===================== */
async function init(){
  initTheme();

  // backend / demo notice
  $("#feedNote").textContent =
    MODE === "postgres" ? "Live · self-hosted PostgreSQL" :
    MODE === "supabase" ? "Live · Supabase" :
    "Demo mode · backend not configured (see SETUP_POSTGRES.md). Posting & login are simulated.";

  if(LIVE){ await Auth.initSession(); Auth.onAuthChange(()=>{ renderAuth(); }); }
  renderAuth();
  await loadFeed();
  wireCompose(); wireJoin(); wireLogin(); wireSettings();

  // Start where the URL says. Signed-in members skip the landing page.
  const start = location.hash.slice(1);
  if(VIEWS.includes(start)) go(start, { fromHistory:true });
  else if(Auth.isSignedIn()){ history.replaceState(null, "", "#feed"); go("feed", { fromHistory:true }); }
  window.addEventListener("popstate", onHistory);
  window.addEventListener("hashchange", onHistory);
  document.addEventListener("keydown", e=>{
    if(e.key === "Escape") setDrawer(false);
    const t = e.target.closest?.("[data-tile]");
    if(t && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); showPost(t.dataset.tile); }
  });

  // delegated clicks: navigation, theme, auth, reactions, admin
  document.addEventListener("click", async (e)=>{
    const nav=e.target.closest("[data-go]");
    if(nav){ e.preventDefault(); go(nav.dataset.go); return; }
    if(e.target.closest("[data-drawer]")){ setDrawer(!document.body.classList.contains("drawer-open")); return; }
    if(e.target.closest("[data-drawer-close]")){ setDrawer(false); return; }
    if(e.target.closest("[data-theme-toggle]")){ toggleTheme(); return; }
    if(e.target.closest("[data-auth='logout']")){
      await Auth.signOut(); renderAuth(); await loadFeed(); go("feed"); flash("Logged out."); return;
    }
    const tileEl=e.target.closest("[data-tile]");
    if(tileEl){ showPost(tileEl.dataset.tile); return; }
    const tagEl=e.target.closest("[data-tag]");
    if(tagEl){ FILTER.tag = tagEl.dataset.tag; setTab("latest"); go("feed"); renderFeed(); return; }
    if(e.target.closest("[data-clear-filter]")){ FILTER.tag = null; renderFeed(); return; }
    const del=e.target.closest("[data-delpost]");
    if(del){
      if(!confirm("Delete this post? This can't be undone.")) return;
      try{
        await API.deletePost(del.dataset.delpost);
        FEED = FEED.filter(p => String(p.id) !== del.dataset.delpost);
        renderFeed(); renderGrids(); flash("Post deleted.");
      }catch(err){ flash("Could not delete: " + err.message); }
      return;
    }
    const disc=e.target.closest(".act.discuss");
    if(disc){ await toggleComments(disc.dataset.post); return; }
    const cbtn=e.target.closest("[data-comment]");
    if(cbtn){ await submitComment(cbtn.dataset.comment); return; }
    const react=e.target.closest(".act[data-kind]");
    if(react){ await onReact(react); return; }
    const ap=e.target.closest("[data-approve]");
    if(ap){
      try{ await API.approveApplication(ap.dataset.approve); flash("Approved ✦"); }catch(err){ flash(err.message); }
      renderAdmin(); return;
    }
    const rj=e.target.closest("[data-reject]");
    if(rj){
      try{ await API.rejectApplication(rj.dataset.reject); flash("Rejected"); }catch(err){ flash(err.message); }
      renderAdmin(); return;
    }
    const bl=e.target.closest("[data-block]");
    if(bl){ try{ await API.blockUser(bl.dataset.block); flash("Member blocked."); }catch(err){ flash(err.message); } renderUsers(); return; }
    const ub=e.target.closest("[data-unblock]");
    if(ub){ try{ await API.unblockUser(ub.dataset.unblock); flash("Member unblocked."); }catch(err){ flash(err.message); } renderUsers(); return; }
    const du=e.target.closest("[data-deluser]");
    if(du){
      if(confirm(`Delete @${du.dataset.handle}? This removes their account and all their posts and comments. This cannot be undone.`)){
        try{ await API.deleteUser(du.dataset.deluser); flash("Member deleted."); }catch(err){ flash(err.message); }
        renderUsers();
      }
      return;
    }
  });

  $$("#feedTabs .tab").forEach(t=>t.addEventListener("click",()=>{
    setTab(t.dataset.tab); renderFeed();
  }));
}

async function onReact(btn){
  if(!requireApproval()) return;
  const kind=btn.dataset.kind;
  const c=btn.querySelector(".count"); let n=+c.textContent;
  const on=btn.classList.toggle("on");
  if(kind==="resonate") btn.querySelector(".lbl").textContent = on?"Resonates":"Resonate";
  btn.setAttribute("aria-pressed", on);
  c.textContent = on ? n+1 : n-1;                 // optimistic
  if(LIVE){
    try{ await API.toggleReaction(btn.closest(".actions").dataset.id, kind); }
    catch(e){ btn.classList.toggle("on"); c.textContent=n; flash("Could not react: "+e.message); }
  }
}

/* ===================== COMMENTS ===================== */
function timeago(iso){
  const d = new Date(iso), s = (Date.now() - d.getTime())/1000;
  if(s < 60)     return "just now";
  if(s < 3600)   return Math.floor(s/60) + "m";
  if(s < 86400)  return Math.floor(s/3600) + "h";
  if(s < 604800) return Math.floor(s/86400) + "d";
  return d.toLocaleDateString();
}
async function toggleComments(postId){
  const box = document.getElementById("cm-" + postId);
  if(!box) return;
  if(!box.hidden){ box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<div class="sub" style="padding:8px 2px">Loading…</div>`;
  await renderComments(postId, box);
}
async function renderComments(postId, box){
  let list = [];
  try{ list = await API.getComments(postId); }
  catch(e){ box.innerHTML = `<div class="sub" style="padding:8px 2px">Couldn't load comments.</div>`; return; }
  const items = list.length ? list.map(c=>`
    <div class="comment">
      <img src="${esc(c.avatar_url||"")}" alt="" onerror="this.style.visibility='hidden'"/>
      <div class="cmain">
        <div class="chead"><b>@${esc(c.handle)}</b><span class="ctime">${timeago(c.created_at)}</span></div>
        <div class="cbody">${esc(c.body)}</div>
      </div>
    </div>`).join("") : `<div class="sub" style="padding:6px 2px">No comments yet — start the thread.</div>`;
  const form = canAct()
    ? `<div class="cform">
         <textarea id="ci-${esc(postId)}" rows="2" placeholder="Add a comment…"></textarea>
         <button class="btn primary" data-comment="${esc(postId)}">Comment</button>
       </div>`
    : `<div class="hint" style="padding:6px 2px">Log in as an approved member to comment.</div>`;
  box.innerHTML = `<div class="clist">${items}</div>${form}`;
}
async function submitComment(postId){
  if(!requireApproval()) return;
  const ta = document.getElementById("ci-" + postId);
  const body = (ta?.value || "").trim();
  if(!body){ flash("Write something first."); return; }
  if(!LIVE){ flash("Demo mode — connect a backend to post comments."); return; }
  try{
    await API.addComment(postId, body);
    await renderComments(postId, document.getElementById("cm-" + postId));
    const cnt = document.querySelector(`.act.discuss[data-post="${postId}"] .count`);
    if(cnt) cnt.textContent = +cnt.textContent + 1;
    flash("Comment posted.");
  }catch(e){ flash("Could not comment: " + e.message); }
}

document.addEventListener("DOMContentLoaded", init);
