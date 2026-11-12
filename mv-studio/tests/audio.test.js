import test from 'node:test';
import assert from 'node:assert/strict';
import { mixStems, wavBlob, TRACKS } from '../audio-utils.js';
test('karaoke excludes vocals and normalizes both channels together',()=>{
  const stems=Object.fromEntries(TRACKS.map(key=>[key,{left:new Float32Array([key==='vocals'?100:.5]),right:new Float32Array([key==='vocals'?100:.25])}]));
  const mix=mixStems(stems,{drums:1,bass:1,other:1,vocals:0});
  assert.equal(mix.left[0],1);assert.equal(mix.right[0],.5);assert.equal(mix.peak,1.5);
});
test('WAV header, interleaving and full-scale signed PCM are valid',async()=>{
  const bytes=await wavBlob(new Float32Array([-1,.5]),new Float32Array([1,0])).arrayBuffer();
  const v=new DataView(bytes);assert.equal(v.getUint32(24,true),44100);assert.equal(v.getUint32(40,true),8);
  assert.equal(v.getInt16(44,true),-32768);assert.equal(v.getInt16(46,true),32767);assert.equal(v.getInt16(48,true),16384);
});
