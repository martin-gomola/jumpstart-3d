import { appendFile, mkdir, realpath, writeFile } from "node:fs/promises";
import { join, sep, dirname } from "node:path";
import { randomUUID, createHash } from "node:crypto";
const digest = value => createHash("sha256").update(value).digest("hex");
const bytes = value => { try { return Buffer.byteLength(JSON.stringify(value)); } catch { return 0; } };
export function traceValue(value, key = "", depth = 0) {
  if (/^(password|secret|token|api[_-]?key|authorization|cookie|accessToken|refreshToken)$/i.test(key)) return "[redacted]";
  if (/^(base64|dataUrl|imageDataUrl|assetData|bytes|vertices|triangles|normals|positions)$/i.test(key) && value != null) return { omitted: true, bytes: bytes(value), sha256: digest(JSON.stringify(value)) };
  if (depth > 24) return { omitted: true, reason: "depth" };
  if (typeof value === "string") return value.replace(/\/(?:Users|home)\/[^/\s]+/g,"[home]").replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g,"[redacted]").replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,"[redacted]").replace(/Bearer\s+[A-Za-z0-9._-]{10,}/gi,"Bearer [redacted]").replace(/(https?:\/\/)[^/\s:@]+:[^@\s]+@/gi,"$1[redacted]@").replace(/([?&](?:token|key|signature|auth|api[_-]?key|access[_-]?token)=)[^&\s]+/gi,"$1[redacted]");
  if (Array.isArray(value)) return value.map(v=>traceValue(v,"",depth+1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,traceValue(v,k,depth+1)]));
  return value;
}
export function createAgentTrace({ exportsDir, enabled = false, maxBytes = 32*1024*1024, maxCalls = 1000, write = appendFile } = {}) {
  const sessionId=randomUUID(), startedAt=new Date().toISOString();
  let file, queue=Promise.resolve(), total=0, calls=0, failures=0, incomplete=0, error;
  async function record(entry) {
    queue=queue.then(async()=>{
      if (error) return;
      try {
        if (!file) {
          await mkdir(exportsDir,{recursive:true}); const dir=join(exportsDir,"agent-traces"); await mkdir(dir,{recursive:true});
          const [root, actual]=await Promise.all([realpath(exportsDir),realpath(dir)]);
          if (!actual.startsWith(root+sep)) throw new Error("Trace directory must remain within managed exports");
          file=join(actual,`${sessionId}.jsonl`);
        }
        const safe=traceValue(entry);
        for (const [i,image] of (entry.result?.images || []).entries()) {
          const match=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(image.dataUrl || "");
          if (!match) continue;
          const data=Buffer.from(match[2],"base64");
          if (total+data.byteLength>maxBytes) throw new Error("Trace image budget reached");
          const name=`${entry.callId}-${i}.${match[1] === "png" ? "png" : "jpg"}`;
          await writeFile(join(dirname(file),name),data,{mode:0o600,flag:"wx"}); total+=data.byteLength;
          safe.result.images[i].artifact={file:`agent-traces/${name}`,bytes:data.byteLength,sha256:digest(data)};
        }
        const line=JSON.stringify(safe)+"\n";
        if (Buffer.byteLength(line)>1024*1024 || total+Buffer.byteLength(line)>maxBytes) throw new Error("Trace byte budget reached");
        await write(file,line,{mode:0o600}); total+=Buffer.byteLength(line);
      } catch (e) { error=traceValue(e.message); incomplete++; }
    });
    await queue;
  }
  return {
    status: () => ({ enabled, sessionId:enabled?sessionId:null, startedAt, status:!enabled?"disabled":error?"incomplete":"recording", calls, failures, bytes:total, incomplete, ...(error?{error}:{}), localOnly:true, limits:{maxBytes,maxCalls} }),
    async run(name,args,operation,transport) {
      if (!enabled) return operation();
      if (++calls>maxCalls) { error="Trace call budget reached"; incomplete++; return operation(); }
      const callId=randomUUID(), start=performance.now();
      await record({version:1,event:"call",sessionId,callId,sequence:calls,at:new Date().toISOString(),transport,name,args,inputBytes:bytes(args)});
      let result, failure;
      try { result=await operation(); return result; }
      catch(e) { failure=e.message; throw e; }
      finally {
        if (failure || result?.valid===false) failures++;
        await record({version:1,event:"result",sessionId,callId,name,at:new Date().toISOString(),elapsedMs:performance.now()-start,outputBytes:bytes(result),...(failure?{error:failure}:{result})});
      }
    },
  };
}
