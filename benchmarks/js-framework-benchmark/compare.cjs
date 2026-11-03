// Pools the raw samples of two runs and scores the medians of the pooled values.
const fs=require("fs"),path=require("path");const dirs=process.argv.slice(2);
const weights={"01_run1k":0.64280248137063,"02_replace1k":0.5607178150466176,"03_update10th1k_x16":0.5643800750716564,"04_select1k":0.1925635870170522,"05_swap1k":0.13200612879341714,"06_remove-one-1k":0.5277091212292658,"07_create10k":0.5644449600965534,"08_create1k-after1k_x2":0.5508359820582848,"09_clear1k_x8":0.4225836631419211};
const order=["vanillajs","solid","hel","svelte","vue","react-hooks"];const data={};
for(const dir of dirs)for(const f of fs.readdirSync(dir)){const d=JSON.parse(fs.readFileSync(path.join(dir,f)));const n=order.find(o=>d.framework.startsWith(o+"-"));if(!n||!weights[d.benchmark])continue;((data[n]??={})[d.benchmark]??=[]).push(...d.values.total.values);}
const med=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)]};
const best={};for(const b in weights)best[b]=Math.min(...order.map(n=>med(data[n][b])));
const rows=order.map(n=>{let s=0,w=0;for(const b in weights){s+=weights[b]*Math.log(med(data[n][b])/best[b]);w+=weights[b];}return[n,Math.exp(s/w)]}).sort((a,b)=>a[1]-b[1]);
console.log(["benchmark".padEnd(28),...order.map(o=>o.padStart(10))].join(""));
for(const b in weights)console.log([b.padEnd(28),...order.map(o=>med(data[o][b]).toFixed(1).padStart(10))].join(""));
for(const[n,v]of rows)console.log(n.padEnd(14),v.toFixed(3));
