const vm=require("vm"),fs=require("fs");
const L={},shown=[],posted=[],opened=[];
const tabs=[{url:"https://x.github.io/borrowa/home.html",postMessage:m=>posted.push(m),focus:async()=>{},navigate:async u=>opened.push("nav:"+u)}];
const self={registration:{scope:"https://x.github.io/borrowa/",showNotification:async(t,o)=>shown.push({t,o})},
 addEventListener:(n,f)=>L[n]=f, skipWaiting(){}, clients:{claim:async()=>{},matchAll:async()=>tabs,openWindow:async u=>opened.push("open:"+u)}};
vm.runInNewContext(fs.readFileSync(require("path").join(__dirname,"..","public","sw.js"),"utf8"),{self,URL,Promise,console});
const run=async(n,e)=>{let p;e.waitUntil=x=>p=x;L[n](e);await p;};
(async()=>{
 await run("push",{data:{json:()=>({data:{title:"Hi",body:"B",url:"requests.html",tag:"t1",kind:"request"}})}});
 console.log(JSON.stringify(shown[0]),JSON.stringify(posted));
 await run("push",{data:{json:()=>({data:{title:"Evil",url:"https://evil.com/x"}})}});
 console.log("evil url ->",shown[1].o.data.url,"| no tag:",!("renotify" in shown[1].o));
 await run("push",{data:{json:()=>{throw 1},text:()=>"plain"}});
 console.log("plain text ->",shown[2].o.body);
 await run("notificationclick",{notification:{close(){},data:{url:"https://x.github.io/borrowa/chat.html?id=c1"}}});
 console.log(opened);
})();
