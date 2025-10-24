import JSZip from 'jszip';

function readmeText({ title }) {
  return `# ${title}

Bot écho minimal pour Telegram, déployable sur Vercel.

## Prérequis
- Créer un bot via BotFather et récupérer le \`TELEGRAM_BOT_TOKEN\`.

## Déploiement sur Vercel
1. Définis la variable d'environnement \`TELEGRAM_BOT_TOKEN\` dans Vercel.
2. Déploie ce repo. L'URL de l'API sera \`https://<app>.vercel.app/api/bot\`.
3. Configure le webhook :
   \`https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<app>.vercel.app/api/bot\`.

## Utilisation
Écris un message au bot : il renvoie le même texte.`;
}

function indexJS() {
  return `export default async function handler(req,res){
  if (req.method==='GET') return res.status(200).send('OK');
  if (req.method!=='POST') return res.status(405).json({ok:false});

  const TG = process.env.TELEGRAM_BOT_TOKEN;
  if(!TG) return res.status(200).json({ok:false, error:'no TELEGRAM_BOT_TOKEN'});

  try{
    const upd = req.body || {};
    const msg = upd.message;
    const cb  = upd.callback_query;

    const chatId = msg?.chat?.id || cb?.message?.chat?.id;
    const textIn = msg?.text ?? cb?.data ?? '';

    if(chatId){
      await fetch(\`https://api.telegram.org/bot\${TG}/sendMessage\`,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ chat_id: chatId, text: textIn })
      });
      if(cb?.id){
        await fetch(\`https://api.telegram.org/bot\${TG}/answerCallbackQuery\`,{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ callback_query_id: cb.id })
        });
      }
    }
    return res.status(200).json({ok:true});
  }catch(e){
    return res.status(200).json({ok:false, error:String(e)});
  }
}`;
}

function packageJSON() {
  return {
    name: "echo-bot",
    private: true,
    type: "module",
    engines: { node: "20.x" },
    dependencies: {},
    scripts: {}
  };
}

export async function buildEchoBotZip({ title }) {
  const zip = new JSZip();
  zip.file('README.md', readmeText({ title }));
  zip.file('api/bot.js', indexJS());
  zip.file('package.json', JSON.stringify(packageJSON(), null, 2) + '\n');

  const content = await zip.generateAsync({ type:'nodebuffer' });
  const b64 = content.toString('base64');
  const filename = `${title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'bot'}-echo.zip`;
  return { filename, b64 };
}
