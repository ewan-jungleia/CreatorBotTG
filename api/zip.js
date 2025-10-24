import { getJSON } from './_kv.js';

export default async function handler(req,res){
  try{
    const key = String(req.query.key||'').trim();
    if(!key) return res.status(400).send('missing key');
    const data = await getJSON(key);
    if(!data?.b64 || !data?.filename) return res.status(404).send('not found');

    const buf = Buffer.from(data.b64, 'base64');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${data.filename}"`);
    return res.status(200).send(buf);
  }catch(e){
    return res.status(200).send('error');
  }
}
