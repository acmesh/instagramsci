/* Instagramsci — authentication layer (mode-aware).
   Routes to the Python REST API (postgres), Supabase, or demo. Exposes a single
   interface to the app: profile with is_approved / is_admin. */
import { MODE } from "./config.js";
import { supabase } from "./supabase.js";
import { req, setToken, getToken } from "./rest.js";

let _profile = null;

export function currentProfile(){ return _profile; }
export const isSignedIn = () => Boolean(_profile);
export const isApproved = () => Boolean(_profile && _profile.is_approved);
export const isAdmin    = () => Boolean(_profile && _profile.is_admin);

/* ---------------- POSTGRES (Python API) ---------------- */
async function pgSignUp(p){
  const d = await req("/auth/signup", { method:"POST", body:p });
  setToken(d.token); _profile = d.profile; return d;
}
async function pgSignIn({ email, password, code }){
  const d = await req("/auth/login", { method:"POST", body:{ email, password, code } });
  if(d.twofa_required) return { twofa_required:true, error:d.error };   // needs a code
  setToken(d.token); _profile = d.profile; return { profile:d.profile };
}
async function pgInit(){
  if(!getToken()) return null;
  try { _profile = (await req("/me", { auth:true })).profile; }
  catch(e){ setToken(null); _profile = null; }
  return _profile;
}

/* ---------------- SUPABASE ---------------- */
async function sbLoadProfile(userId){
  if(!userId){ _profile = null; return null; }
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
  _profile = error ? null : data; return _profile;
}

/* ---------------- public API ---------------- */
export async function signUp(p){
  if(MODE === "postgres") return pgSignUp(p);
  if(MODE === "supabase"){
    const { data, error } = await supabase.auth.signUp({
      email:p.email, password:p.password,
      options:{ data:{ handle:p.handle, origin:p.origin, intentions:p.intentions } }
    });
    if(error) throw error;
    if(data.user) await sbLoadProfile(data.user.id);
    return data;
  }
  return { demo:true };
}

export async function signIn(p){
  if(MODE === "postgres") return pgSignIn(p);
  if(MODE === "supabase"){
    const { data, error } = await supabase.auth.signInWithPassword(p);
    if(error) throw error;
    await sbLoadProfile(data.user.id);
    return data;
  }
  return { demo:true };
}

export async function signOut(){
  if(MODE === "postgres") setToken(null);
  else if(MODE === "supabase") await supabase.auth.signOut();
  _profile = null;
}

export async function initSession(){
  if(MODE === "postgres") return pgInit();
  if(MODE === "supabase"){
    const { data } = await supabase.auth.getSession();
    if(data.session?.user) await sbLoadProfile(data.session.user.id);
    return _profile;
  }
  return null;
}

export function onAuthChange(cb){
  if(MODE === "supabase"){
    supabase.auth.onAuthStateChange(async (_e, session) => {
      await sbLoadProfile(session?.user?.id); cb(_profile);
    });
  }
  // postgres/demo: no cross-tab listener needed
}

/* ---------------- account & profile (postgres only; demo = no-op) ----------------
   These power the Settings page. Supabase mode isn't wired for them in this build. */
const PG = () => MODE === "postgres";

export async function updateProfile({ display_name, bio, pronouns }){
  if(!PG()) return { demo:true };
  const d = await req("/me", { method:"PATCH", body:{ display_name, bio, pronouns }, auth:true });
  _profile = d.profile; return d;
}
export async function uploadAvatar(file){
  if(!PG()) return { demo:true };
  const fd = new FormData(); fd.append("avatar", file);
  const d = await req("/me/avatar", { method:"POST", form:true, body:fd, auth:true });
  _profile = d.profile; return d;
}
export async function changeEmail({ email, password }){
  if(!PG()) return { demo:true };
  const d = await req("/me/email", { method:"POST", body:{ email, password }, auth:true });
  _profile = d.profile; return d;
}
export async function changePassword({ current_password, new_password }){
  if(!PG()) return { demo:true };
  return req("/me/password", { method:"POST", body:{ current_password, new_password }, auth:true });
}
export async function twofaSetup(){
  if(!PG()) return { demo:true };
  return req("/me/2fa/setup", { method:"POST", auth:true });   // { secret, otpauth_uri }
}
export async function twofaEnable(code){
  if(!PG()) return { demo:true };
  const d = await req("/me/2fa/enable", { method:"POST", body:{ code }, auth:true });
  if(_profile) _profile.has_2fa = true; return d;
}
export async function twofaDisable(password){
  if(!PG()) return { demo:true };
  const d = await req("/me/2fa/disable", { method:"POST", body:{ password }, auth:true });
  if(_profile) _profile.has_2fa = false; return d;
}
