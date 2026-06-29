/* Instagramsci — REST client for the Python + Postgres backend.
   A thin fetch wrapper with a bearer token kept in localStorage. */
import { API_BASE } from "./config.js";

const TKEY = "igs-token";
export const getToken = () => { try { return localStorage.getItem(TKEY); } catch(e){ return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(TKEY, t) : localStorage.removeItem(TKEY); } catch(e){} };

export async function req(path, { method="GET", body, auth=false, form=false } = {}){
  const headers = {};
  if(auth){ const t = getToken(); if(t) headers["Authorization"] = "Bearer " + t; }
  let payload;
  if(form){ payload = body; }                       // FormData: let the browser set content-type
  else if(body !== undefined){ headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }

  const res = await fetch(API_BASE + path, { method, headers, body: payload });
  let data = {};
  try { data = await res.json(); } catch(e){}
  if(!res.ok) throw new Error(data.error || ("Request failed (" + res.status + ")"));
  return data;
}
