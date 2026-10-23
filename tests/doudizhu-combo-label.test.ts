import test from 'node:test';
import assert from 'node:assert/strict';
import {classify,comboLabel} from '../lib/doudizhu-rules';
test('triple with pair is labeled clearly without changing its combination kind',()=>{
 const combo=classify(['5s','5h','5d','2s','2h'])!;
 assert.equal(combo.kind,'triple-pair');
 assert.equal(comboLabel(combo),'triple with pair');
});
