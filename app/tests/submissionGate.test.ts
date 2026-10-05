import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubmissionGate } from '../src/utils/submissionGate';

test('a pending submission prevents a second write and allows the next submission after completion',async()=>{
  const run=createSubmissionGate();
  let finish!:()=>void;
  let writes=0;
  const pending=new Promise<void>(resolve=>{finish=resolve});
  const first=run(async()=>{writes++;await pending});
  await run(async()=>{writes++});
  assert.equal(writes,1);
  finish();await first;
  await run(async()=>{writes++});
  assert.equal(writes,2);
});
test('a failed submission releases the gate for an explicit retry',async()=>{
  const run=createSubmissionGate();
  await assert.rejects(run(async()=>{throw new Error('failed')}),/failed/);
  let retried=false;
  await run(async()=>{retried=true});
  assert.equal(retried,true);
});
