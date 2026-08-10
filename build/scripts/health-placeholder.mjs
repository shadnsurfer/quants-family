#!/usr/bin/env node
// Minimal health endpoint so M0's gate (localhost:4321/health) is reachable before the real dashboard exists.
// The real Next.js app replaces this from M4 on. Kept dependency-free.
import { createServer } from "node:http";
const port = process.env.PORT || 4321;
createServer((req,res)=>{
  if (req.url === "/health") { res.writeHead(200,{"content-type":"application/json"}); res.end(JSON.stringify({ok:true,stage:"harness"})); return; }
  res.writeHead(200,{"content-type":"text/plain"}); res.end("quants build harness — dashboard arrives at M4");
}).listen(port,()=>console.log("health placeholder on http://localhost:"+port));
