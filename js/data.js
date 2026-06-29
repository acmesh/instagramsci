/* Instagramsci — seed content.
   The post shape mirrors the Supabase `posts` schema (see ARCHITECTURE.md),
   so swapping this array for a live query later is a one-place change. */

export const PROFILES = {
  instagramsci: { name:"Instagramsci", pron:"", avatar:"assets/instagramsci.jpg", house:true },
  you:          { name:"You", pron:"she/they", avatar:"https://i.pravatar.cc/120?img=15" },
  "rosa.l":     { name:"Rosa L.", pron:"she/her", avatar:"https://i.pravatar.cc/120?u=rosa.l" },
  "mutual.aid": { name:"Mutual Aid Collective", pron:"they/them", avatar:"https://i.pravatar.cc/120?u=mutual.aid" },
  "energy.commons": { name:"Energy Commons", pron:"", avatar:"https://i.pravatar.cc/120?u=energy.commons" },
  "kropotkina": { name:"Kropotkina", pron:"she/her", avatar:"https://i.pravatar.cc/120?u=kropotkina" }
};

export const TAGS = ["#Commons","#Labour","#Care","#Energy","#Decentralization",
                     "#Climate","#Cooperation","#Housing","#Solidarity"];

/* ---- THE FIRST POST ----
   Pinned, founding post from the house account. Carries a genuine, attributed
   Gramsci sentence; `manifestoLink` renders "Read the Manifesto →" in place of
   a caption (the "rest" of the welcome lives on the Manifesto page).
   Source: Selections from the Prison Notebooks, Q3 §34 — Hoare & Nowell-Smith
   translation (1971). Note: the popular "now is the time of monsters" rendering
   is a loose paraphrase; we use the well-documented translation here. */
export const FIRST_POST = {
  id: "0001",
  handle: "instagramsci",
  pinned: true,
  image: "assets/instagramsci.jpg",
  alt: "Illustrated portrait of Antonio Gramsci on an ochre background — the face of Instagramsci.",
  aphorism: "The crisis consists precisely in the fact that the old is dying and the new cannot be born; in this interregnum a great variety of morbid symptoms appear.",
  attrib: "Antonio Gramsci, Prison Notebooks (trans. Hoare & Nowell-Smith)",
  manifestoLink: true,
  tag: "#Commons",
  reactions: { resonate: 1, collect: 0 },
  created_at: "2026-06-26T13:45:00Z"
};

export const POSTS = [
  FIRST_POST,
  {
    id:"0003", handle:"rosa.l",
    image:"https://images.unsplash.com/photo-1521791136064-7986c2920216?w=800&q=70",
    alt:"Workers gathered outside a factory gate at dawn",
    aphorism:"The strike is not a pause in work — it is a rehearsal of freedom.",
    attrib:null, tag:"#Labour", reactions:{resonate:88, collect:19}, created_at:"2026-06-24T18:20:00Z"
  },
  {
    id:"0004", handle:"mutual.aid",
    image:"https://images.unsplash.com/photo-1517048676732-d65bc937f952?w=800&q=70",
    alt:"Hands passing a box of food across a table",
    aphorism:"Solidarity is not charity. It is the refusal to be made strangers.",
    attrib:null, tag:"#Care", reactions:{resonate:140, collect:41}, created_at:"2026-06-24T11:00:00Z"
  },
  {
    id:"0005", handle:"energy.commons",
    image:"https://images.unsplash.com/photo-1509391366360-2e959784a276?w=800&q=70",
    alt:"Rooftop solar panels over a dense neighbourhood",
    aphorism:"When the sun is owned by everyone, the grid becomes a conversation.",
    attrib:null, tag:"#Energy", reactions:{resonate:73, collect:22}, created_at:"2026-06-23T16:40:00Z"
  },
  {
    id:"0006", handle:"kropotkina",
    image:"https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=800&q=70",
    alt:"A community garden tended by many people",
    aphorism:"Cooperation is not the exception in nature. It is the rule we were taught to forget.",
    attrib:null, tag:"#Decentralization", reactions:{resonate:101, collect:33}, created_at:"2026-06-23T08:10:00Z"
  }
];
