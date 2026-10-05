import test from 'node:test';
import assert from 'node:assert/strict';
import { responseError } from '../src/services/responseError';

test('structured errors preserve actionable messages and data impact',()=>{
  assert.deepEqual(responseError(400,{code:400,message:'出生日期不能晚于今天',affectsData:false}),{code:400,message:'出生日期不能晚于今天',affectsData:false});
  assert.equal(responseError(502,'<html>upstream error</html>').message,'请求失败（502）');
  assert.equal(responseError(500,{message:{detail:'bad'}}).message,'请求失败（500）');
});
