// Closed browser metadata. Only the Host owns checked attachment bytes.
import { validWorkspaceFileRoot, workspaceFilePathReason, workspaceFileContentFits } from "../workspace-file/index.mjs";
import { validModelOptions } from "../runtime-options/index.mjs";
export const CONTEXT_LIMITS = Object.freeze({textBytes:65536,fileBytes:8388608,sendBytes:16777216,items:8,cacheBytes:67108864,cacheEntries:64,idleMs:600000});
const own=(v,k)=>Object.hasOwn(v,k);
const data=(v)=>Boolean(v&&Object.getPrototypeOf(v)===Object.prototype&&Reflect.ownKeys(v).every(k=>typeof k==="string"&&own(Object.getOwnPropertyDescriptor(v,k),"value")));
const closed=(v,required,optional=[])=>data(v)&&required.every(k=>own(v,k))&&Reflect.ownKeys(v).every(k=>[...required,...optional].includes(k));
const id=(v)=>typeof v==="string"&&/^[A-Za-z0-9_.:-]{1,128}$/u.test(v);
const hex=(v)=>typeof v==="string"&&/^[a-f0-9]{64}$/u.test(v);
const uint=(v)=>Number.isSafeInteger(v)&&v>=0;
const bytes=(v)=>new globalThis.TextEncoder().encode(v).length;
const mimeTypes=["text/plain","image/png","image/jpeg","image/gif","image/webp","application/pdf"];
export function validContextSelection(v){return closed(v,["version","start","end"])&&hex(v.version)&&uint(v.start)&&uint(v.end)&&v.start<v.end;}
export function validContextDescriptor(v){
 if(!closed(v,["capabilityId","workspaceId","workspacePath","path","name","source","version","digest","mime","size"],["range"]))return false;
 return id(v.capabilityId)&&id(v.workspaceId)&&validWorkspaceFileRoot(v.workspacePath)&&!workspaceFilePathReason(v.path)&&v.name===v.path.split("/").at(-1)&&["file","selection"].includes(v.source)&&hex(v.version)&&hex(v.digest)&&mimeTypes.includes(v.mime)&&uint(v.size)&&v.size<=(v.mime==="text/plain"?CONTEXT_LIMITS.textBytes:CONTEXT_LIMITS.fileBytes)&&(v.source==="selection"?v.mime==="text/plain"&&closed(v.range,["start","end"])&&uint(v.range.start)&&uint(v.range.end)&&v.range.start<v.range.end:!own(v,"range"));
}
function array(v){return Array.isArray(v)&&Object.getPrototypeOf(v)===Array.prototype&&Reflect.ownKeys(v).every(k=>k==="length"||(typeof k==="string"&&/^(0|[1-9][0-9]*)$/.test(k)&&Number(k)<v.length&&own(Object.getOwnPropertyDescriptor(v,k),"value")))&&Object.keys(v).length===v.length;}
export function validContextList(v){return array(v)&&v.length<=CONTEXT_LIMITS.items&&v.every(validContextDescriptor)&&new Set(v.map(d=>d.capabilityId)).size===v.length&&v.reduce((n,d)=>n+d.size,0)<=CONTEXT_LIMITS.sendBytes;}
export function contextModelSupports(options,descriptors){
 if(!validModelOptions(options)||!options.capabilities||!validContextList(descriptors))return false;
 return descriptors.every(d=>{const modality=d.mime==="application/pdf"?"pdf":d.mime.startsWith("image/")?"image":"text";return options.capabilities.input.some(input=>input.startsWith(modality));});
}
const invalid=()=>{throw new Error("INVALID_REQUEST");};
const reasons=["missing_file","path_missing","path_denied","file_changed","protected_source","too_large","unsupported_content","selection_changed","capacity_exceeded"];
function canonicalImage(value,d){
 if(typeof value!=="string"||value.length>Math.ceil(CONTEXT_LIMITS.fileBytes/3)*4+64)return false;
 const prefix=`data:${d.mime};base64,`; if(!value.startsWith(prefix))return false;
 const encoded=value.slice(prefix.length); if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))return false;
 const pad=encoded.endsWith("==")?2:encoded.endsWith("=")?1:0;
 const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
 return encoded.length/4*3-pad===d.size&&(!pad||(alphabet.indexOf(encoded.at(-pad-1))&(pad===2?15:3))===0);
}
export function validateContextObservation(v){
 if(!data(v))invalid(); const available=v.status==="available";
 if(!closed(v,["runtimeEpoch","revision","workspaceId","workspacePath","path","status",...(available?["descriptor","preview"]:["reason"])])||!id(v.runtimeEpoch)||!uint(v.revision)||!id(v.workspaceId)||!validWorkspaceFileRoot(v.workspacePath)||workspaceFilePathReason(v.path)==="invalid_path")invalid();
 if(!available){if(!["unavailable","unsupported"].includes(v.status)||!reasons.includes(v.reason))invalid();return v;}
 const d=v.descriptor,p=v.preview;
 if(!validContextDescriptor(d)||d.workspaceId!==v.workspaceId||d.workspacePath!==v.workspacePath||d.path!==v.path)invalid();
 if(d.mime==="text/plain"){if(!closed(p,["kind","text"])||p.kind!=="text"||!workspaceFileContentFits(p.text)||bytes(p.text)!==d.size)invalid();}
 else if(d.mime==="application/pdf"){if(!closed(p,["kind"])||p.kind!=="pdf")invalid();}
 else if(!closed(p,["kind","dataUrl"])||p.kind!=="image"||!canonicalImage(p.dataUrl,d))invalid();
 return v;
}
