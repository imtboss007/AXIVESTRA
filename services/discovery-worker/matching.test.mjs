import test from "node:test";
import assert from "node:assert/strict";
import {scoreDiscoveryMatch,E11_MATCH_CRITERIA} from "./matching.mjs";

const candidate={
 geography:["India","Karnataka"],type:"manufacturing",ticket:{min:5,max:20},
 instrument:["equity","debt"],collateral:["real_estate"],stage:["growth"],mandate:["SME"]
};
const evidence=[{evidence_id:"ev-1",source_id:"src-1",source_published_at:"2026-11-20T00:00:00Z"}];
const criteria={
 geography:{value:["India"],weight:2},
 type:{value:["manufacturing"],weight:2,required:true},
 ticket:{value:{min:8,max:15},weight:2},
 instrument:{value:["equity"],weight:1},
 collateral:{value:["real_estate"],weight:1},
 stage:{value:["growth"],weight:1},
 mandate:{value:["SME"],weight:1},
 evidence_freshness:{maxAgeDays:30,weight:2}
};

test("E11 scores all eight matrix criteria and explains each component",()=>{
 const result=scoreDiscoveryMatch({candidate,criteria,evidence,now:"2026-11-22T00:00:00Z"});
 assert.deepEqual(result.components.map(x=>x.criterion),E11_MATCH_CRITERIA);
 assert.equal(result.score,100);
 assert.equal(result.confidence,1);
 assert.equal(result.eligible,true);
 assert.equal(result.method,"deterministic_weighted_rules_v1");
 assert.equal(result.requiresHumanReview,true);
 assert.equal(result.positives.length,8);
});

test("E11 records negative factors and required mismatches as blockers",()=>{
 const result=scoreDiscoveryMatch({
  candidate:{...candidate,type:"retail",instrument:["debt"]},
  criteria,evidence,now:"2026-11-22T00:00:00Z"
 });
 assert.equal(result.eligible,false);
 assert.deepEqual(result.blockers,["type"]);
 assert.ok(result.negatives.some(x=>x.criterion==="instrument"));
 assert.ok(result.score<100);
});

test("E11 missing facts stay unknown, earn no points and lower confidence",()=>{
 const result=scoreDiscoveryMatch({
  candidate:{type:"manufacturing"},
  criteria:{type:{value:"manufacturing",weight:1},geography:{value:"India",weight:1}},
  evidence:[],now:"2026-11-22T00:00:00Z"
 });
 assert.equal(result.components.find(x=>x.criterion==="geography").status,"unknown");
 assert.equal(result.score,50);
 assert.equal(result.confidence,0.25);
 assert.deepEqual(result.unknown,["geography"]);
});

test("E11 freshness uses newest evidence date and reports stale evidence",()=>{
 const result=scoreDiscoveryMatch({
  candidate:{type:"manufacturing"},
  criteria:{evidence_freshness:{maxAgeDays:7,weight:1}},
  evidence:[
   {evidence_id:"old",source_id:"s1",source_published_at:"2026-10-01T00:00:00Z"},
   {evidence_id:"new",source_id:"s2",source_published_at:"2026-11-20T00:00:00Z"}
  ],
  now:"2026-11-22T00:00:00Z"
 });
 assert.equal(result.components[0].status,"match");
 assert.match(result.components[0].reason,/within the 7-day limit/);
});

test("E11 never invents score from empty criteria and validates weights",()=>{
 assert.equal(scoreDiscoveryMatch({candidate,criteria:{},evidence:[]}).score,0);
 assert.throws(()=>scoreDiscoveryMatch({criteria:{type:{value:"x",weight:-1}}}),/non-negative/);
});

test("E11 uses exact configured criteria only and does not evaluate person profile attributes",()=>{
 const result=scoreDiscoveryMatch({
  candidate:{type:"manufacturing",person_age:34,personal_income:100},
  criteria:{type:{value:"manufacturing",weight:1},personal_income:{value:100,weight:10}},
  evidence:[]
 });
 assert.equal(result.components.length,1);
 assert.equal(result.score,100);
});
