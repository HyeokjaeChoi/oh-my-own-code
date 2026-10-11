import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AssistantRuntimeProvider, MessagePrimitive, ThreadPrimitive, useExternalStoreRuntime} from '@assistant-ui/react';
import {MarkdownTextPrimitive} from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';
function Text(){return <MarkdownTextPrimitive smooth={false} defer={true} remarkPlugins={[remarkGfm]}/>}
function Message(){return <MessagePrimitive.Root><MessagePrimitive.Parts components={{Text}}/></MessagePrimitive.Root>}
function Probe(){const runtime=useExternalStoreRuntime({messages:[{id:'m',role:'assistant',content:[{type:'text',text:'# Known\n\n**bold**\n\n```ts\nconst x=1;\n```\n\n|a|b|\n|-|-|\n|1|2|\n\n<script>bad()</script>'}]}],convertMessage:(m)=>m,isRunning:false,onNew:async()=>{}});return <AssistantRuntimeProvider runtime={runtime}><ThreadPrimitive.Root><ThreadPrimitive.Messages components={{AssistantMessage:Message,UserMessage:Message}}/></ThreadPrimitive.Root></AssistantRuntimeProvider>}
const html=renderToStaticMarkup(<Probe/>);
if(!html.includes('<h1>Known</h1>')||!html.includes('<strong>bold</strong>')||!html.includes('<table>')||!html.includes('&lt;script&gt;bad()&lt;/script&gt;')||html.includes('<script>'))throw Error('Actual Markdown runtime incompatibility');
console.log(JSON.stringify({pass:true,html,scope:'Isolated pinned real external runtime SSR; not browser or app integration'}));
