import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { useAsync } from '../src/hooks/useAsync';

test('changing range clears previously loaded data while the new request is pending', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  let finish!: (value:string)=>void;
  const pending = new Promise<string>(resolve=>{finish=resolve});
  function Probe({range}:{range:number}) {
    const result=useAsync(()=>range===7?Promise.resolve('7 days'):pending,[range]);
    return React.createElement('span',null,result.data ?? 'pending');
  }
  const root=createRoot(document.getElementById('root')!);
  try {
    await act(async()=>root.render(React.createElement(Probe,{range:7})));
    assert.equal(document.getElementById('root')!.textContent,'7 days');
    await act(async()=>root.render(React.createElement(Probe,{range:30})));
    assert.equal(document.getElementById('root')!.textContent,'pending');
    await act(async()=>finish('30 days'));
    assert.equal(document.getElementById('root')!.textContent,'30 days');
  } finally { await act(async()=>root.unmount());dom.window.close(); }
});

test('late response cannot replace the latest selected range', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  let first!: (value:string)=>void;
  let second!: (value:string)=>void;
  const oldRequest=new Promise<string>(resolve=>{first=resolve});
  const newRequest=new Promise<string>(resolve=>{second=resolve});
  function Probe({range}:{range:number}) {
    const result=useAsync(()=>range===7?oldRequest:newRequest,[range]);
    return React.createElement('span',null,result.data);
  }
  const root=createRoot(document.getElementById('root')!);
  try {
    await act(async()=>root.render(React.createElement(Probe,{range:7})));
    await act(async()=>root.render(React.createElement(Probe,{range:30})));
    await act(async()=>second('30 days'));
    assert.equal(document.getElementById('root')!.textContent,'30 days');
    await act(async()=>first('7 days'));
    assert.equal(document.getElementById('root')!.textContent,'30 days');
  } finally { await act(async()=>root.unmount());dom.window.close(); }
});
