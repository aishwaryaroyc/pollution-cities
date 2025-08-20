require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const axios = require('axios');
const { getSummary } = require('./wiki');

const app = express();
app.use(morgan('dev'));

const BASE = process.env.POLLUTION_API_BASE_URL;
const LOGIN_PATH = process.env.AUTH_LOGIN_PATH;
const POLLUTION_PATH = process.env.POLLUTION_API_PATH;
const USER = process.env.POLLUTION_API_USERNAME;
const PASS = process.env.POLLUTION_API_PASSWORD;
const DEFAULT_COUNTRIES = (process.env.POLLUTION_COUNTRIES).split(',').map(s=>s.trim().toUpperCase()).filter(Boolean);
const PAGE_LIMIT = Number(process.env.POLLUTION_PAGE_LIMIT || 100);

// token
let tokenValue = null, tokenExpiry = 0;
async function getToken(){
  const now = Date.now();
  if(tokenValue && now < tokenExpiry) return tokenValue;
  const url = BASE.replace(/\/$/, '') + LOGIN_PATH;
  const bodies = [{username:USER,password:PASS},{user:USER,password:PASS},{email:USER,password:PASS}];
  for(const body of bodies){
    try{
      const res = await axios.post(url, body, {timeout:12000, headers:{'Content-Type':'application/json',Accept:'application/json'}, validateStatus:()=>true});
      if(res.status>=200 && res.status<300 && res.data){
        const tok = res.data.accessToken || res.data.token || res.data.jwt || res.data.access_token;
        if(tok){
          const ttl = Number(res.data.expiresIn || res.data.expires_in || 900);
          tokenValue = tok; tokenExpiry = now + ttl*1000; return tokenValue;
        }
      }
    }catch(e){}
  }
  throw new Error('Auth failed: /auth/login');
}

// basic limiter: 5 req / 10s
const windowMs = 10000, maxCalls = 5, calls = [];
async function throttle(){
  const now = Date.now();
  while(calls.length && now - calls[0] > windowMs) calls.shift();
  if(calls.length < maxCalls){ calls.push(now); return; }
  const wait = windowMs - (now - calls[0]) + 25;
  await new Promise(r=>setTimeout(r, wait));
  return throttle();
}

// helpers
function toTitle(s){ return s.replace(/\S+/g, w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()); }
function cleanCity(n){ if(typeof n!=='string') return ''; return toTitle(n.replace(/\s+/g,' ').trim()); }
function isCity(n){
  if(!n) return false;
  const s = n.trim(), low = s.toLowerCase();
  if(s.length<2) return false;
  const tokens = ['province','state','region','district','neighborhood','neighbourhood','suburb','industrial','powerplant','power plant','factory','refinery','mine','works','airport','station','port','harbor','harbour','junction','test','unknown','n/a'];
  if(tokens.some(t=>low.includes(t))) return false;
  const digits = (s.match(/\d/g)||[]).length;
  if(digits >= Math.min(3, Math.floor(s.length/2))) return false;
  if(/^[A-Z]{2,}$/.test(s)) return false;
  return true;
}

async function fetchPage(token, country, page, limit){
  const url = BASE.replace(/\/$/, '') + POLLUTION_PATH;
  await throttle();
  const res = await axios.get(url, { timeout:12000, headers:{Accept:'application/json', Authorization:`Bearer ${token}`}, params:{country, page, limit}, validateStatus:()=>true });
  if(res.status===401) throw Object.assign(new Error('Unauthorized'), {code:401});
  if(res.status<200 || res.status>=300) throw new Error('Upstream '+res.status);
  return res.data || {};
}

async function fetchCountry(country){
  const rows = [];
  let token = await getToken();
  let page=1, totalPages=1;
  do{
    let data;
    try{
      data = await fetchPage(token, country, page, PAGE_LIMIT);
    }catch(e){
      if(e.code===401){ tokenValue=null; tokenExpiry=0; token=await getToken(); data=await fetchPage(token, country, page, PAGE_LIMIT); }
      else{ throw e; }
    }
    const list = Array.isArray(data.results) ? data.results : [];
    for(const r of list){
      const city = cleanCity(r.name || r.city || '');
      const aqi = Number.isFinite(Number(r.pollution)) ? Number(r.pollution) : undefined;
      rows.push({ country: country.toUpperCase(), city, aqi });
    }
    totalPages = Number(data?.meta?.totalPages) || 1;
    page++;
  }while(page<=totalPages);
  return rows;
}

app.get('/health', (req,res)=>res.json({ok:true}));

app.get('/cities', async (req,res)=>{
  try{
    const countries = typeof req.query.countries==='string' ? req.query.countries.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean) : DEFAULT_COUNTRIES;
    let combined=[];
    for(const c of countries){ combined = combined.concat(await fetchCountry(c)); }

    // filter + dedupe
    const seen=new Set(), out=[];
    for(const r of combined){
      if(!isCity(r.city)) continue;
      const key = r.country+'|'+r.city.toLowerCase();
      if(seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }

    // enrich sequentially
    for(let i=0;i<out.length;i++){
      const s = await getSummary(out[i].city, out[i].country);
      out[i].description = s?.extract || null;
      const text = (s?.type+' '+s?.description+' '+s?.extract||'').toLowerCase();
      if(/district|neighborhood|neighbourhood|suburb|power plant|powerplant|industrial|factory|refinery|mine|works/.test(text)){
        out.splice(i,1); i--;
      }
    }

    out.sort((a,b)=>(b.aqi??-Infinity)-(a.aqi??-Infinity));
    res.json(out);
  }catch(err){
    console.error(err);
    res.status(502).json({error: err.message || 'Upstream error'});
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log('Server listening on http://localhost:'+PORT));
