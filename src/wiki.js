const axios = require('axios');
const cache = new Map();
const POS_TTL_MS = 24 * 60 * 60 * 1000;
const NEG_TTL_MS = 12 * 60 * 60 * 1000;
function now(){return Date.now();}
function get(k){const v=cache.get(k); if(!v) return undefined; if(now()>v.t){cache.delete(k); return undefined;} return v.v;}
function set(k,v,ms){cache.set(k,{v,t:now()+ms});}
async function getSummary(city, country){
  const key = city+'|'+country;
  const c = get(key); if(c!==undefined) return c;
  const tries = [city+', '+country, city];
  for(const t of tries){
    try{
      const url = 'https://en.wikipedia.org/api/rest_v1/page/summary/'+encodeURIComponent(t);
      const res = await axios.get(url,{timeout:10000, headers:{'User-Agent':'pollu-cities-min/1.0'}});
      if(res.status===200 && res.data && res.data.extract){
        const out = { extract: res.data.extract, description: res.data.description||null, type: res.data.type||null };
        set(key,out,POS_TTL_MS); return out;
      }
    }catch(e){}
  }
  set(key,null,NEG_TTL_MS); return null;
}
module.exports = { getSummary };
