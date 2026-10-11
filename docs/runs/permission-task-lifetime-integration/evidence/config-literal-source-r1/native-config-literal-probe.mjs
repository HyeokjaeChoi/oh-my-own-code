import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import ts from '/Users/hyukjaechoi/Projects/oh-my-own-code/node_modules/typescript/lib/typescript.js';
import {nativeSkillsConfig} from '/Users/hyukjaechoi/Projects/oh-my-own-code/apps/desktop-app/src/native-skills-config.mjs';
const product='/Users/hyukjaechoi/Projects/oh-my-own-code/';
const install=product+'apps/desktop-app/runtime-event-host/.generated/install/';
const sourcePath='node_modules/@opencode/core/dist/chunks/config-s4enseaf.js';
const bytes=await readFile(install+sourcePath);
const sha=createHash('sha256').update(bytes).digest('hex');
const receipt=JSON.parse(await readFile(install+'../receipt.json','utf8'));
assert.equal(receipt.installEntries.find(r=>r.path===sourcePath)?.sha256,sha);
const ast=ts.createSourceFile(sourcePath,bytes.toString(),ts.ScriptTarget.Latest,true);
let expression;
for(const statement of ast.statements)if(ts.isVariableStatement(statement))for(const d of statement.declarationList.declarations)if(d.name.getText(ast)==='substitute2')expression=d.initializer.getText(ast);
assert.ok(expression);
// Exact original generator body. Only its Effect.fn declaration adapter and
// external process environment/file continuation are explicit scripted standins.
// This is a pure source-expression probe, not Effect/Native/runtime evidence.
const factory=new Function('Effect','process','substituteFiles',`return (${expression});`);
const retained=await realpath(await mkdtemp(path.join(tmpdir(),'omoc-config-literal-')));
async function config(name){const root=path.join(retained,name,'opencode/event-host/darwin-arm64');const builtin=path.join(root,'builtins/workbench-skills');await mkdir(builtin,{recursive:true,mode:0o700});await writeFile(path.join(builtin,'package.json'),JSON.stringify({name:'@oh-my-own-code/workbench-skills',private:true,type:'module',version:'1.0.0'}),{flag:'wx',mode:0o600});await writeFile(path.join(builtin,'server.mjs'),'// synthetic only\n',{flag:'wx',mode:0o600});return{root,text:nativeSkillsConfig(root,'c'.repeat(64))};}
const envConfig=await config('{env:OMOC_LITERAL}');
const fileConfig=await config('{file:synthetic.txt}');
const Effect={fn:()=>generator=>(...args)=>generator(...args)};
test('app resource path remains literal under original ConfigVariable env substitution',()=>{const substitute=factory(Effect,{env:{OMOC_LITERAL:'SYNTHETIC_REPLACEMENT'}},()=>{throw Error('unexpected_file_factory')});const result=substitute({type:'virtual',text:envConfig.text,dir:'/scripted/workspace'}).next();assert.equal(result.done,true);assert.equal(JSON.parse(result.value).plugins[0].package,path.join(envConfig.root,'builtins/workbench-skills'));});
test('app resource path cannot enter original ConfigVariable file continuation',()=>{const substitute=factory(Effect,{env:{}},()=>{throw Error('synthetic_file_factory_reached')});const result=substitute({type:'virtual',text:fileConfig.text,dir:'/scripted/workspace'}).next();assert.equal(result.done,true);assert.equal(JSON.parse(result.value).plugins[0].package,path.join(fileConfig.root,'builtins/workbench-skills'));});
console.log(JSON.stringify({retained,consumerSourceSha256:sha,scope:'Node synthetic directories plus exact original pure generator expression; scripted Effect.fn adapter/process/file canary; no original Native import or external file read'}));
