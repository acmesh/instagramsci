/* Instagramsci — REST client for the Python + Postgres backend.
   A thin fetch wrapper with a bearer token kept in localStorage. */
import { API_BASE } from "./config.js?v=20260927";

const TKEY = "igs-token";
export const getToken = () => { try { return localStorage.getItem(TKEY); } catch(e){ return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(TKEY, t) : localStorage.removeItem(TKEY); } catch(e){} };

export async function req(path, { method="GET", body, auth=false, form=false } = {}){
  const headers = {};
  if(auth){ const t = getToken(); if(t) headers["Authorization"] = "Bearer " + t; }
  let payload;
  if(form){ payload = body; }                       // FormData: let the browser set content-type
  else if(body !== undefined){ headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }

  let res;
  try { res = await fetch(API_BASE + path, { method, headers, body: payload }); }
  catch(e){ throw new Error("Can't reach the server. Check your connection and try again."); }
  let data = {};
  try { data = await res.json(); } catch(e){}
  if(!res.ok){
    // Apache answers some errors itself, in HTML, so there's no JSON message.
    const fallback = res.status === 413 ? "That file is too large (max 8 MB)."
                   : res.status >= 500 ? "The server had a problem. Try again in a minute."
                   : "Request failed (" + res.status + ")";
    throw new Error(data.error || fallback);
  }
  return data;
}
