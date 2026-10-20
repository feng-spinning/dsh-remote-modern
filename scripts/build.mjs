import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
await mkdir(new URL('../lib/', import.meta.url), { recursive: true });
for (const name of ['socks', 'ssh-config']) {
  const source = await readFile(new URL(`../src/upstream-${name}.ts`, import.meta.url), 'utf8');
  await writeFile(new URL(`../lib/${name}.js`, import.meta.url), stripTypeScriptTypes(source, { mode: 'strip' }));
}
const client = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
const guest = await readFile(new URL('../src/desktop-guest.js', import.meta.url), 'utf8');
const references = (await readFile(new URL('../src/session-reference.js', import.meta.url), 'utf8')).replaceAll('export ', '');
const unified = await readFile(new URL('../src/unified-client.js', import.meta.url), 'utf8');
await writeFile(new URL('../lib/client.js', import.meta.url), `window.__ModuleLoader__.load({id:"dsh-remote-modern",factory:(require)=>{\nconst React=require("react");\nconst {writeClipboard}=require("@deepseek-ai/dsh-client-ui-primitives");\n${references}\n${guest}\n${unified}\n${client}\nreturn {name:"ssh-remote-modern-client",inject:["slots","connection","workspaces","sessions","uiWorkspace","layout","remote"],apply};\n}});\n`);
