/* Instagramsci — data access layer (mode-aware).
   POSTGRES (Python API) · SUPABASE · DEMO (seed). Render code consumes ONE shape:
     { id, handle, author:{name,avatar,pron}, image, alt, aphorism, attrib,
       caption, tag, pinned, manifestoLink, reactions:{resonate,collect}, created_at } */
import { MODE } from "./config.js";
import { supabase } from "./supabase.js";
import { req } from "./rest.js";
import { PROFILES, TAGS as SEED_TAGS, POSTS as SEED_POSTS } from "./data.js";

export const TAGS = SEED_TAGS;

/* ---------- normalizers ---------- */
function fromSeed(p){
  const pr = PROFILES[p.handle] || { name:p.handle, avatar:"" };
  return {
    id:p.id, handle:p.handle,
    author:{ name:pr.name, avatar:pr.avatar, pron:pr.pron || "" },
    image:p.image, alt:p.alt, aphorism:p.aphorism, attrib:p.attrib || null,
    caption:p.caption || null, tag:p.tag || "", pinned:!!p.pinned,
    manifestoLink:!!p.manifestoLink,
    reactions:{ resonate:p.reactions?.resonate ?? 0, collect:p.reactions?.collect ?? 0,
                amplify:p.reactions?.amplify ?? 0 },
    comments:p.comments ?? 0, mine:p.mine || [],
    created_at:p.created_at
  };
}
// post_feed rows have identical column names in both Supabase and the Python API
function fromRow(r){
  const firstTag = (r.tags || "").split(" ").filter(Boolean)[0] || "";
  return {
    id:r.id, handle:r.handle,
    author:{ name:r.display_name || r.handle, avatar:r.avatar_url || "", pron:r.pronouns || "" },
    image:r.image_url, alt:r.alt_text, aphorism:r.aphorism, attrib:r.attribution || null,
    caption:r.caption || null, tag:firstTag, pinned:!!r.pinned,
    manifestoLink:!!r.pinned,
    reactions:{ resonate:Number(r.resonate_count)||0, collect:Number(r.collect_count)||0,
                amplify:Number(r.amplify_count)||0 },
    comments:Number(r.comment_count)||0, mine:r.my_kinds || [],
    created_at:r.created_at
  };
}

/* ---------- feed ---------- */
export async function getFeed(){
  if(MODE === "postgres"){
    const d = await req("/feed");
    return (d.posts || []).map(fromRow);
  }
  if(MODE === "supabase"){
    const { data, error } = await supabase.from("post_feed").select("*")
      .order("pinned",{ascending:false}).order("created_at",{ascending:false});
    if(error){ console.warn("getFeed:", error.message); return []; }
    return data.map(fromRow);
  }
  return SEED_POSTS.map(fromSeed);
}

/* ---------- create post (approved members) ---------- */
export async function createPost({ file, aphorism, altText, attribution, caption, tagLabels }){
  if(MODE === "postgres"){
    const fd = new FormData();
    if(file) fd.append("image", file);
    fd.append("aphorism", aphorism);
    fd.append("alt_text", altText);
    if(attribution) fd.append("attribution", attribution);
    if(caption) fd.append("caption", caption);
    if(tagLabels?.length) fd.append("tags", tagLabels.join(" "));
    return req("/posts", { method:"POST", form:true, body:fd, auth:true });
  }
  if(MODE === "supabase"){
    const { data:u } = await supabase.auth.getUser();
    const uid = u?.user?.id; if(!uid) throw new Error("Not signed in.");
    let imageUrl = null;
    if(file){
      const path = `${uid}/${Date.now()}-${file.name.replace(/[^\w.\-]/g,"_")}`;
      const up = await supabase.storage.from("media").upload(path, file);
      if(up.error) throw up.error;
      imageUrl = supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
    }
    const { data:post, error } = await supabase.from("posts").insert({
      author_id:uid, image_url:imageUrl, aphorism, alt_text:altText,
      attribution:attribution||null, caption:caption||null
    }).select("id").single();
    if(error) throw error;
    const labels = (tagLabels||[]).map(s=>s.trim()).filter(Boolean);
    if(labels.length){
      const { data:tags } = await supabase.from("tags").select("id,label").in("label", labels);
      if(tags?.length) await supabase.from("post_tags").insert(tags.map(t=>({post_id:post.id,tag_id:t.id})));
    }
    return post;
  }
  return { demo:true };
}

/* ---------- reactions ---------- */
export async function toggleReaction(postId, kind){
  if(MODE === "postgres") return req(`/posts/${postId}/react`, { method:"POST", body:{kind}, auth:true });
  if(MODE === "supabase"){
    const { data:u } = await supabase.auth.getUser();
    const uid = u?.user?.id; if(!uid) throw new Error("Not signed in.");
    const { data:exists } = await supabase.from("reactions").select("post_id")
      .eq("post_id",postId).eq("user_id",uid).eq("kind",kind).maybeSingle();
    if(exists){
      await supabase.from("reactions").delete().eq("post_id",postId).eq("user_id",uid).eq("kind",kind);
      return { on:false };
    }
    await supabase.from("reactions").insert({ post_id:postId, user_id:uid, kind });
    return { on:true };
  }
  return { demo:true };
}

/* ---------- comments ---------- */
export async function getComments(postId){
  if(MODE === "postgres"){
    const d = await req(`/posts/${postId}/comments`);
    return d.comments || [];
  }
  return (DEMO_COMMENTS[postId] || []).slice();   // demo (and supabase fallback)
}
export async function addComment(postId, body){
  if(MODE === "postgres"){
    const d = await req(`/posts/${postId}/comments`, { method:"POST", body:{ body }, auth:true });
    return d.comment;
  }
  const c = { id:Date.now(), body, handle:"you", display_name:"You",
              avatar_url:"", created_at:new Date().toISOString() };
  (DEMO_COMMENTS[postId] = DEMO_COMMENTS[postId] || []).push(c);
  return c;
}
let DEMO_COMMENTS = {};

/* ---------- admin: applications ---------- */
export async function listPendingApplications(){
  if(MODE === "postgres"){
    const d = await req("/admin/applications", { auth:true });
    return d.applications || [];
  }
  if(MODE === "supabase"){
    const { data, error } = await supabase.from("membership_applications").select("*")
      .eq("status","pending").order("created_at",{ascending:true});
    if(error){ console.warn("listPending:", error.message); return []; }
    return data;
  }
  return DEMO_APPS.slice();
}
export async function approveApplication(id){
  if(MODE === "postgres") return req(`/admin/applications/${id}/approve`, { method:"POST", auth:true });
  if(MODE === "supabase"){ const { error } = await supabase.rpc("approve_member",{app_id:id}); if(error) throw error; return; }
  DEMO_APPS = DEMO_APPS.filter(a=>a.id!==id);
}
export async function rejectApplication(id){
  if(MODE === "postgres") return req(`/admin/applications/${id}/reject`, { method:"POST", auth:true });
  if(MODE === "supabase"){ const { error } = await supabase.rpc("reject_member",{app_id:id}); if(error) throw error; return; }
  DEMO_APPS = DEMO_APPS.filter(a=>a.id!==id);
}

/* Demo applications so the admin page is explorable without a backend. */
let DEMO_APPS = [
  { id:"demo-1", handle:"@silvia", email:"silvia@example.org", origin:"Bologna housing co-op",
    intentions:"I want to share images from our tenants' union and learn from others organizing around the commons.",
    created_at:"2026-06-26T08:00:00Z" },
  { id:"demo-2", handle:"@tomas", email:"tomas@example.org", origin:"Energy community, Lisbon",
    intentions:"Documenting a community solar project; hoping to post aphorisms on shared infrastructure.",
    created_at:"2026-06-26T10:30:00Z" }
];
