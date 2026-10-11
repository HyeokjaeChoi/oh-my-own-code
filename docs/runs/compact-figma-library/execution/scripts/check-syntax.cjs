// Static JavaScript parse only. Does not execute Figma or app tests.
const fs=require('fs'),path=require('path');const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const dir=__dirname;for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.js'))){new AsyncFunction(fs.readFileSync(path.join(dir,f),'utf8'));process.stdout.write(f+': parsed\n')}
