const Module = require("module");
const handlers = {}; const sent = []; const deleted = []; 
const tokenDocs = [
  {id:"tA",uid:"alice",broadcast:true},{id:"tB",uid:"bob",broadcast:true},{id:"tC",uid:"carol",broadcast:false},{id:"tDead",uid:"bob",broadcast:true},{id:"tU2",uid:"u2",broadcast:false}];
const mk = (name)=>(opts,fn)=>{ handlers[name]=fn; return {opts,fn}; };
const stubs = {
 "firebase-functions/v2/firestore": { onDocumentWritten:(o,f)=>f, onDocumentCreated:(o,f)=>({o,f}), onDocumentUpdated:(o,f)=>({o,f}) },
 "firebase-functions/v2/scheduler": { onSchedule:(o,f)=>f },
 "firebase-functions/v2/https": { onCall:(o,f)=>f, HttpsError: class extends Error{} },
};
const store = {"pushThrottle":{}, users:{u1:{name:"Asha"}}, chats:{c1:{participants:["u1","u2"]}}};
const mkQuery = (filter)=>{ const q={ orderBy(){return q}, limit(){return q}, startAfter(){return q},
  async get(){ const docs=tokenDocs.filter(filter).map(d=>({id:d.id,get:k=>k==="token"?d.id:d[k]})); return {docs,size:docs.length}; } }; return q; };
const db = {
  collection:(c)=>({ where:(f,op,v)=>mkQuery(d=>d[f]===v), add:async()=>{} }),
  doc:(p)=>({ path:p, async get(){ const [c,id]=p.split("/"); const v=(store[c]||{})[id]; return {exists:!!v, get:k=>v&&v[k]}; }}),
  runTransaction: async (fn)=>fn({ get: async(ref)=>{ const k=ref.path.split("/")[1]; const v=store.pushThrottle[k]; return {exists:!!v,get:()=>v.at}; }, set:(ref,val)=>{store.pushThrottle[ref.path.split("/")[1]]=val;} }),
  batch:()=>({ delete:(r)=>deleted.push(r.path), commit:async()=>{} }),
};
const admin = { apps:[1], initializeApp(){}, firestore:Object.assign(()=>db,{FieldPath:{documentId:()=>"id"},FieldValue:{serverTimestamp:()=>"ts"},Timestamp:{now:()=>0,fromMillis:()=>0}}),
  messaging:()=>({ async sendEachForMulticast(m){ sent.push(m); return {successCount:m.tokens.length-(m.tokens.includes("tDead")?1:0), responses:m.tokens.map(t=>t==="tDead"?{success:false,error:{code:"messaging/registration-token-not-registered"}}:{success:true})}; } }) };
stubs["firebase-admin"]=admin;
const orig = Module._load;
Module._load = function(r,...a){ if(stubs[r]) return stubs[r]; return orig.call(this,r,...a); };
const ix = require(require("path").join(__dirname,"..","functions","index.js"));
const names=["pushOnItem","pushOnRequest","pushOnOffer","pushOnNotification","pushOnChatMessage"];
console.log("exports present:", names.every(n=>ix[n]), Object.keys(ix).length, "total");
(async()=>{
  const ev=(data,params={},before)=>({data:{data:()=>data,before:{data:()=>before},after:{data:()=>data}},params});
  await ix.pushOnItem.f(ev({title:"Drill",userId:"alice",pickupLocation:"Block B"},{id:"i1"}));
  console.log("item -> tokens:", sent[0].tokens, "| data:", JSON.stringify(sent[0].data), "| dead deleted:", deleted);
  sent.length=0;
  await ix.pushOnItem.f(ev({title:"Drill2",userId:"alice"},{id:"i2"}));
  console.log("2nd item within 5 min throttled:", sent.length===0);
  await ix.pushOnChatMessage.f(ev({senderId:"u1"},{chatId:"c1",id:"m1"}));
  console.log("chat -> sent:", sent.length, JSON.stringify(sent[0].data));
  sent.length=0;
  await ix.pushOnOffer.f(ev({userId:"bob",offerCount:1,title:"Ladder"},{id:"r1"},{offerCount:0}));
  console.log("offer -> tokens:", sent[0].tokens);
  sent.length=0;
  await ix.pushOnOffer.f(ev({userId:"bob",offerCount:1},{id:"r1"},{offerCount:1}));
  console.log("no new offer -> nothing sent:", sent.length===0);
  await ix.pushOnNotification.f(ev({recipientId:"alice",type:"item_claimed",itemTitle:"Drill",claimedByName:"Ravi"},{id:"n1"}));
  console.log("notification:", JSON.stringify(sent.at(-1).data));
})().catch(e=>{console.error("FAIL",e);process.exit(1)});
