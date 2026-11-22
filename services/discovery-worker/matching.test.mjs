import test from "node:test";
import assert from "node:assert/strict";
import { scoreWorkspaceFit,scoreWorkspaceCandidates,validateMatchCriteria } from "./matching.mjs";

const criteria={
  schemaVersion:1,
  minimumCoverage:0.6,
  weights:{
    geography:15,type:10,ticket:20,instrument:10,
    collateral:10,stage:10,mandate:10,evidence_freshness:15
  },
  dimensions:{
    geography:{countries:["IN"],states:["Karnataka"]},
    type:{anyOf:["manufacturer","industrial supplier"],exclude:["broker"]},
    ticket:{currency:"INR",minimum:5000000,maximum:50000000},
    instrument:{anyOf:["secured term loan"]},
    collateral:{anyOf:["commercial property"]},
    stage:{anyOf:["growth"]},
    mandate:{anyOf:["working capital"]},
    evidence_freshness:{maxAgeDays:365}
  }
};
const asOf="2026-11-22T12:00:00.000Z";
const evidence=[
  ...["geography","type","ticket","instrument","collateral","stage","mandate"].map((dimension,i)=>({
    dimension,sourceId:"source-"+dimension,evidenceId:"evidence-"+dimension,
    sourceConfidence:0.9-i*0.02,publishedAt:"2026-10-01T00:00:00.000Z",
    capturedAt:"2026-10-02T00:00:00.000Z"
  }))
];
const candidate={
  id:"candidate-1",canonicalEntityId:"entity-1",
  geography:{country:"IN",state:"Karnataka",city:"Bengaluru"},
  type:["manufacturer"],ticket:{amount:12000000,currency:"INR"},
  instrument:["secured term loan"],collateral:["commercial property"],
  stage:["growth"],mandate:["working capital"],evidence
};

test("E11 scores every matrix dimension and emits component-level positive rationale",()=>{
  const result=scoreWorkspaceFit({criteria,candidate,asOf});
  assert.equal(result.matchScore,100);
  assert.equal(result.state,"review_required");
  assert.equal(result.reviewState,"pending_review");
  assert.equal(result.coverage,100);
  assert.equal(result.components.length,8);
  assert.equal(result.components.every(item=>item.status==="assessed"),true);
  assert.equal(result.rationale.positive.length,8);
  assert.equal(result.rationale.negative.length,0);
  assert.equal(result.evidenceRefs.evidenceIds.length,7);
  assert.ok(result.confidence>70 && result.confidence<=100);
});

test("E11 scores negative matches and explains exclusions rather than hiding them",()=>{
  const result=scoreWorkspaceFit({
    criteria,candidate:{...candidate,type:["broker"],stage:["early"]},asOf
  });
  const type=result.components.find(item=>item.dimension==="type");
  const stage=result.components.find(item=>item.dimension==="stage");
  assert.equal(type.score,0);
  assert.match(type.reason,/excluded/);
  assert.equal(stage.score,0);
  assert.equal(result.rationale.negative.length,2);
});

test("E11 leaves missing source-backed dimensions unknown and exposes coverage/confidence",()=>{
  const result=scoreWorkspaceFit({
    criteria,candidate:{...candidate,ticket:undefined,evidence:evidence.filter(item=>item.dimension!=="ticket")},asOf
  });
  const ticket=result.components.find(item=>item.dimension==="ticket");
  assert.equal(ticket.status,"unknown");
  assert.equal(ticket.score,null);
  assert.equal(result.coverage,80);
  assert.equal(result.state,"review_required");
  assert.ok(result.confidence<90);
});

test("E11 does not convert incompatible currencies",()=>{
  const result=scoreWorkspaceFit({
    criteria,candidate:{...candidate,ticket:{amount:12000000,currency:"USD"}},asOf
  });
  const ticket=result.components.find(item=>item.dimension==="ticket");
  assert.equal(ticket.status,"unknown");
  assert.match(ticket.reason,/no conversion/);
});

test("E11 freshness uses the oldest evidence used, with a visible stale factor",()=>{
  const oldEvidence=evidence.map(item=>item.dimension==="type"
    ? {...item,publishedAt:"2024-01-01T00:00:00.000Z"} : item);
  const result=scoreWorkspaceFit({criteria,candidate:{...candidate,evidence:oldEvidence},asOf});
  const freshness=result.components.find(item=>item.dimension==="evidence_freshness");
  assert.equal(freshness.status,"assessed");
  assert.ok(freshness.score<100);
  assert.equal(freshness.factor,"warning");
  assert.match(freshness.reason,/Oldest evidence/);
  assert.ok(result.confidence<90);
});

test("E11 refuses ungrounded candidate values without matching evidence",()=>{
  const result=scoreWorkspaceFit({
    criteria,candidate:{...candidate,evidence:evidence.filter(item=>item.dimension!=="collateral")},asOf
  });
  const collateral=result.components.find(item=>item.dimension==="collateral");
  assert.equal(collateral.status,"unknown");
  assert.equal(collateral.score,null);
});

test("E11 validates weights, ranges, unsupported keys and minimum coverage",()=>{
  assert.doesNotThrow(()=>validateMatchCriteria(criteria));
  assert.throws(()=>validateMatchCriteria({...criteria,weights:{...criteria.weights,type:9}}),/sum to 100/);
  assert.throws(()=>validateMatchCriteria({...criteria,dimensions:{...criteria.dimensions,extra:{anyOf:["x"]}}}),/unsupported dimension/);
  assert.throws(()=>validateMatchCriteria({...criteria,dimensions:{...criteria.dimensions,ticket:{currency:"INR",minimum:10,maximum:1}}}),/cannot exceed/);
  assert.throws(()=>validateMatchCriteria({...criteria,minimumCoverage:0.01}),/minimumCoverage/);
});

test("E11 batch matching is deterministic and has stable tie ordering",()=>{
  const result=scoreWorkspaceCandidates({
    criteria,candidates:[
      {...candidate,id:"z",canonicalEntityId:"z"},
      {...candidate,id:"a",canonicalEntityId:"a"}
    ],asOf
  });
  assert.deepEqual(result.map(item=>item.canonicalEntityId),["a","z"]);
  assert.equal(result[0].matchScore,result[1].matchScore);
});

test("E11 never treats fit score or confidence as approval or a credit decision",()=>{
  const result=scoreWorkspaceFit({criteria,candidate,asOf});
  assert.equal(result.reviewState,"pending_review");
  assert.equal(Object.hasOwn(result,"approved"),false);
  assert.equal(Object.hasOwn(result,"creditDecision"),false);
});
