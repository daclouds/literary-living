import {createHash} from 'node:crypto';
export async function ensureNode(sandbox){
 const runtime='export PATH="$HOME/.local/literary-node/bin:$PATH"; ';
 const check=await sandbox.process.executeCommand(runtime+'node --version');
 if(check.exitCode===0&&/^v(2[4-9]|[3-9]\d)\./.test(check.result.trim()))return;
 const base='https://nodejs.org/dist/latest-v24.x/';
 const sums=await fetch(base+'SHASUMS256.txt');if(!sums.ok)throw new Error('Cannot retrieve official Node.js checksums.');
 const row=(await sums.text()).split('\n').find(l=>/node-v24\.\d+\.\d+-linux-x64\.tar\.gz$/.test(l));
 if(!row)throw new Error('Official Linux x64 Node.js 24 archive not found.');
 const [sha,name]=row.trim().split(/\s+/);
 const arch=await sandbox.process.executeCommand('uname -m');if(arch.result.trim()!=='x86_64')throw new Error('Automatic runtime installation currently supports Linux x64 only.');
 const response=await fetch(base+name);if(!response.ok)throw new Error('Cannot download official Node.js archive.');
 const buffer=Buffer.from(await response.arrayBuffer());if(createHash('sha256').update(buffer).digest('hex')!==sha)throw new Error('Official Node.js SHA256 mismatch.');
 await sandbox.fs.uploadFile(buffer,'/tmp/literary-node.tar.gz');
 const command=`printf '%s  /tmp/literary-node.tar.gz\\n' '${sha}' | sha256sum -c - && mkdir -p "$HOME/.local/literary-node" && tar -xzf /tmp/literary-node.tar.gz --strip-components=1 -C "$HOME/.local/literary-node"`;
 const r=await sandbox.process.executeCommand(command,undefined,undefined,120);if(r.exitCode!==0)throw new Error('Verified runtime installation failed: '+r.result);
 console.log('Official Node.js 24 installed and checksum verified.');
}
